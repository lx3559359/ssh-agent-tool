const redacted = '[REDACTED]'
const exactSensitiveKeys = new Set([
  'password',
  'passphrase',
  'token',
  'secret',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'authorization',
  'proxy_authorization',
  'cookie',
  'cookies',
  'set_cookie',
  'access_token',
  'refresh_token',
  'ssh_password',
  'agent',
  'aws_secret_access_key'
])

function isSensitiveKey (key) {
  const normalized = String(key).replace(/-/g, '_').toLowerCase()
  return exactSensitiveKeys.has(normalized) ||
    /_(?:secret|token|password|api_key)$/.test(normalized) ||
    /credential$/.test(normalized)
}

function redactData (value, ancestors) {
  if (typeof value === 'string') return redactPlainText(value)
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return redacted
    ancestors.add(value)
    const output = value.map(item => redactData(item, ancestors))
    ancestors.delete(value)
    return output
  }
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) return redacted
    ancestors.add(value)
    const output = Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? redacted : redactData(item, ancestors)
    ]))
    ancestors.delete(value)
    return output
  }
  return value
}

export function redactSensitiveData (value) {
  return redactData(value, new WeakSet())
}

function redactPrivateKeys (text) {
  return text.replace(
    /-----BEGIN ([^-\r\n]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/gi,
    redacted
  )
}

function redactCredentialValues (text, pattern) {
  return text.replace(pattern, (match, prefix, doubleQuoted, singleQuoted) => {
    if (doubleQuoted !== undefined) return `${prefix}"${redacted}"`
    if (singleQuoted !== undefined) return `${prefix}'${redacted}'`
    return `${prefix}${redacted}`
  })
}

function redactJsonCredentialValues (text) {
  return text.replace(
    /("(?:password|token|apiKey|api_key|secret|passphrase|privateKey)"\s*:\s*)(?:"(?:\\.|[^"\\])*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/gi,
    `$1"${redacted}"`
  )
}

function redactAuthorizationValues (text) {
  const quotedPattern = /(\bAuthorization\s*[:=]\s*[A-Za-z][A-Za-z0-9_-]*\s+)(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)')/gi
  const unquotedPattern = /(\bAuthorization\s*[:=]\s*[A-Za-z][A-Za-z0-9_-]*\s+)(?!["'])[^\r\n;]+/gi
  return redactCredentialValues(text, quotedPattern).replace(
    unquotedPattern,
    `$1${redacted}`
  )
}

function redactCliOptionValues (text) {
  return redactCredentialValues(
    text,
    /((?:^|[\s;&])--(?:api[-_]?key|password|passphrase|token|secret)(?:[ \t]+|=))(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'|[^\s;&]+)/gim
  )
}

function redactProviderKeys (text) {
  return text.replace(
    /(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9][A-Za-z0-9_-]{19,}(?!\.(?:service|socket|target|timer|path|mount|automount|swap|slice|scope|device|snapshot)(?=$|[^A-Za-z0-9_-]))(?=$|[^A-Za-z0-9_-])/gim,
    `$1${redacted}`
  )
}

function redactPlainText (value) {
  let text = String(value ?? '')
  text = redactPrivateKeys(text)
  text = redactJsonCredentialValues(text)
  text = redactAuthorizationValues(text)
  text = text.replace(
    /(\b(?:Cookie|Set-Cookie)\s*:\s*)[^\r\n]+/gi,
    `$1${redacted}`
  )
  text = redactCliOptionValues(text)
  text = redactCredentialValues(
    text,
    /((?:^|[\s;&])(?:-b|--cookie)(?:[ \t]+|=))(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'|[^\s;&]+)/gim
  )
  text = redactCredentialValues(
    text,
    /(\bBearer\s+)(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'|[^\s,;&]+)/gi
  )
  text = redactCredentialValues(
    text,
    /(\b(?:X-API-Key|API[ _-]*Key)\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'|[^\s,;&]+)/gi
  )
  text = redactCredentialValues(
    text,
    /(\b(?:AWS_SECRET_ACCESS_KEY|[A-Za-z_][A-Za-z0-9_]*_(?:SECRET|TOKEN|PASSWORD|API_KEY))\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'|[^\s,;&]+)/gi
  )
  text = redactCredentialValues(
    text,
    /(\b(?:password|passphrase|token|secret|SSHPASS)\b\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'|[^\s,;&]+)/gi
  )
  text = text.replace(
    /([?&](?:access_token|refresh_token|token|api_key|apikey|password|secret)=)[^&#\s]*/gi,
    `$1${redacted}`
  )
  text = text.replace(
    /(\b(?:ssh|sftp):\/\/[^:\s/@]+:)[^@\s/]+(@)/gi,
    `$1${redacted}$2`
  )
  text = redactCredentialValues(
    text,
    /(\bsshpass\s+(?:(?:-v|-e)\s+|(?:-f|-d|-P)\s+\S+\s+)*(?:-p(?:\s+|(?=\S))|--password(?:\s+|=)))(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'|[^\s;&]+)/gi
  )
  return redactProviderKeys(text)
}

export function redactAuditText (value) {
  const text = String(value ?? '')
  try {
    return JSON.stringify(redactSensitiveData(JSON.parse(text)))
  } catch {
    return redactPlainText(text)
  }
}

export function createIncrementalAuditRedactor () {
  let pending = ''
  let closed = false

  function commit (final) {
    if (!pending) return ''
    let commitIndex = final ? pending.length : pending.lastIndexOf('\n') + 1
    const privateKeyStart = pending.lastIndexOf('-----BEGIN ')
    const privateKeyEnd = pending.lastIndexOf('-----END ')
    if (
      privateKeyStart >= 0 &&
      privateKeyStart > privateKeyEnd &&
      privateKeyStart < commitIndex
    ) {
      commitIndex = privateKeyStart
    }
    if (!commitIndex) return ''
    const value = pending.slice(0, commitIndex)
    pending = pending.slice(commitIndex)
    return redactAuditText(value)
  }

  return {
    push (value, { final = false } = {}) {
      if (closed) throw new Error('Incremental audit redactor is closed')
      pending += String(value ?? '')
      const output = commit(final)
      if (final) closed = true
      return output
    },
    flush () {
      if (closed) return ''
      closed = true
      return commit(true)
    }
  }
}
