const tokenPattern = /^[a-f0-9]{32,128}$/
const markerName = 'SHELLPILOT_OPS'
const markerOsc = 697
const maxMarkerLength = 2048

function shellQuote (value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`
}

function encodeUtf8Base64 (value) {
  const bytes = new TextEncoder().encode(String(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function assertPtyTaskToken (value) {
  const token = String(value || '')
  if (!tokenPattern.test(token)) {
    throw new Error('PTY 运维任务令牌无效')
  }
  return token
}

export function createPtyTaskToken () {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('PTY 运维任务缺少安全随机源')
  }
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(
    bytes,
    byte => byte.toString(16).padStart(2, '0')
  ).join('')
}

export function buildPtyTaskCommand ({ token: providedToken, script }) {
  const token = assertPtyTaskToken(providedToken)
  const encodedScript = encodeUtf8Base64(script)
  const marker = `\\033]${markerOsc};${markerName};%s`
  return [
    `__sp_token=${shellQuote(token)};`,
    `__sp_script=${shellQuote(encodedScript)};`,
    '__sp_status=125;',
    'if __sp_uid="$(id -u 2>/dev/null)" && __sp_user="$(id -un 2>/dev/null)" && [ -n "$__sp_uid" ] && [ -n "$__sp_user" ]; then',
    '  __sp_uid64="$(printf %s "$__sp_uid" | base64 | tr -d "\\r\\n")";',
    '  __sp_user64="$(printf %s "$__sp_user" | base64 | tr -d "\\r\\n")";',
    `  printf '${marker};start;%s;%s\\007' "$__sp_token" "$__sp_uid64" "$__sp_user64";`,
    '  printf %s "$__sp_script" | base64 -d | sh;',
    '  __sp_status=$?;',
    `  printf '${marker};end;%s\\007' "$__sp_token" "$__sp_status";`,
    'else',
    '  printf "无法识别当前 Shell 有效身份\\n";',
    'fi;',
    'sh -c "exit $__sp_status"'
  ].join(' ')
}

function decodeUtf8Base64 (value) {
  const encoded = String(value || '')
  if (!encoded || encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('PTY 运维任务身份字段编码无效')
  }
  try {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('PTY 运维任务身份字段编码无效')
  }
}

function isHighSurrogate (value) {
  const code = value.charCodeAt(0)
  return code >= 0xD800 && code <= 0xDBFF
}

function isLowSurrogate (value) {
  const code = value.charCodeAt(0)
  return code >= 0xDC00 && code <= 0xDFFF
}

function isValidIdentityUsername (value) {
  if (!value || value.length > 256) return false
  return Array.from(value).every(char => {
    const code = char.codePointAt(0)
    return code > 0x1F && code !== 0x7F
  })
}

export function createTerminalTextSanitizer () {
  let mode = 'text'
  let pendingCr = false
  let pendingHighSurrogate = ''

  function appendNormalized (value, output) {
    if (pendingCr) {
      output.push('\n')
      pendingCr = false
      if (value === '\n') return
    }
    if (value === '\r') {
      pendingCr = true
    } else {
      output.push(value)
    }
  }

  function appendPrintable (value, output) {
    if (pendingHighSurrogate) {
      if (isLowSurrogate(value)) {
        appendNormalized(pendingHighSurrogate + value, output)
        pendingHighSurrogate = ''
        return
      }
      pendingHighSurrogate = ''
    }
    if (isHighSurrogate(value)) {
      pendingHighSurrogate = value
      return
    }
    if (isLowSurrogate(value)) return
    appendNormalized(value, output)
  }

  function push (chunk) {
    const input = String(chunk || '')
    const output = []
    for (let index = 0; index < input.length; index += 1) {
      const value = input[index]
      const code = value.charCodeAt(0)
      if (mode === 'osc') {
        if (value === '\u0007' || code === 0x9C) mode = 'text'
        else if (value === '\u001b') mode = 'osc-escape'
        continue
      }
      if (mode === 'osc-escape') {
        if (value === '\\' || value === '\u0007' || code === 0x9C) {
          mode = 'text'
        } else if (value !== '\u001b') {
          mode = 'osc'
        }
        continue
      }
      if (mode === 'csi') {
        if (code >= 0x40 && code <= 0x7E) mode = 'text'
        else if (value === '\u001b') mode = 'escape'
        continue
      }
      if (mode === 'escape-intermediate') {
        if (value === '\u001b') mode = 'escape'
        else if (code < 0x20 || code > 0x2F) mode = 'text'
        continue
      }
      if (mode === 'escape') {
        if (value === '[') mode = 'csi'
        else if (value === ']') mode = 'osc'
        else if (value === '\u001b') mode = 'escape'
        else if (code >= 0x20 && code <= 0x2F) mode = 'escape-intermediate'
        else mode = 'text'
        continue
      }

      if (value === '\u001b') {
        pendingHighSurrogate = ''
        mode = 'escape'
      } else if (code === 0x9B) {
        pendingHighSurrogate = ''
        mode = 'csi'
      } else if (code === 0x9D) {
        pendingHighSurrogate = ''
        mode = 'osc'
      } else if ((code >= 0 && code < 0x20 &&
        value !== '\t' && value !== '\r' && value !== '\n') ||
        code === 0x7F || (code >= 0x80 && code <= 0x9F)) {
        pendingHighSurrogate = ''
      } else {
        appendPrintable(value, output)
      }
    }
    return output.join('')
  }

  function finish () {
    const output = []
    pendingHighSurrogate = ''
    if (pendingCr) output.push('\n')
    pendingCr = false
    mode = 'text'
    return output.join('')
  }

  return Object.freeze({ push, finish })
}

export function createPtyTaskOutputParser ({ token: providedToken }) {
  const token = assertPtyTaskToken(providedToken)
  const prefix = `\u001b]${markerOsc};${markerName};`
  const sanitizer = createTerminalTextSanitizer()
  let pending = ''
  let started = false
  let ended = false
  let effectiveIdentity = null
  let completedExitCode = null

  function appendVisible (value, output) {
    if (!started || ended || !value) return
    const clean = sanitizer.push(value)
    if (clean) output.push(clean)
  }

  function consumeMarker (value, output) {
    const fields = value.split(';')
    if (fields[0] !== token) {
      throw new Error('PTY 运维任务边界令牌不匹配')
    }
    if (fields[1] === 'start') {
      if (started || ended || fields.length !== 4) {
        throw new Error('PTY 运维任务开始边界无效')
      }
      const uid = decodeUtf8Base64(fields[2])
      const username = decodeUtf8Base64(fields[3])
      if (!/^\d+$/.test(uid) || !isValidIdentityUsername(username)) {
        throw new Error('PTY 运维任务有效身份无效')
      }
      started = true
      effectiveIdentity = Object.freeze({ uid, username })
      return
    }
    if (fields[1] === 'end') {
      const exitCode = Number(fields[2])
      if (!started || ended || fields.length !== 3 ||
        !/^\d+$/.test(fields[2]) || !Number.isInteger(exitCode) ||
        exitCode < 0 || exitCode > 255) {
        throw new Error('PTY 运维任务结束边界无效')
      }
      ended = true
      completedExitCode = exitCode
      const tail = sanitizer.finish()
      if (tail) output.push(tail)
      return
    }
    throw new Error('PTY 运维任务边界阶段无效')
  }

  function push (chunk) {
    pending += String(chunk || '')
    const output = []
    while (pending) {
      const markerStart = pending.indexOf(prefix)
      if (markerStart < 0) {
        const flushLength = Math.max(0, pending.length - prefix.length + 1)
        appendVisible(pending.slice(0, flushLength), output)
        pending = pending.slice(flushLength)
        break
      }
      appendVisible(pending.slice(0, markerStart), output)
      pending = pending.slice(markerStart)
      const markerEnd = pending.indexOf('\u0007')
      if (markerEnd < 0) {
        if (pending.length > maxMarkerLength) {
          throw new Error('PTY 运维任务边界过长')
        }
        break
      }
      if (markerEnd > maxMarkerLength) {
        throw new Error('PTY 运维任务边界过长')
      }
      const marker = pending.slice(prefix.length, markerEnd)
      pending = pending.slice(markerEnd + 1)
      consumeMarker(marker, output)
    }
    return { output }
  }

  return Object.freeze({
    push,
    identity: () => effectiveIdentity,
    exitCode: () => completedExitCode,
    started: () => started,
    ended: () => ended
  })
}
