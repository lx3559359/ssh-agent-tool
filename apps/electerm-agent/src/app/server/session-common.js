/**
 * terminal/sftp/serial class
 */

const activeRunCmdExecutions = Symbol('activeRunCmdExecutions')

const DEFAULT_RUN_CMD_TIMEOUT_MS = 15000
const MAX_RUN_CMD_TIMEOUT_MS = 60000
const DEFAULT_RUN_CMD_OUTPUT_BYTES = 32 * 1024
const MAX_RUN_CMD_OUTPUT_BYTES = 128 * 1024

function normalizeRunCmdBound (value, fallback, maximum) {
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.min(maximum, Math.max(1, Math.floor(number)))
}

function normalizeMaxOutputBytes (value) {
  return normalizeRunCmdBound(
    value,
    DEFAULT_RUN_CMD_OUTPUT_BYTES,
    MAX_RUN_CMD_OUTPUT_BYTES
  )
}

function normalizeTimeoutMs (value) {
  return normalizeRunCmdBound(
    value,
    DEFAULT_RUN_CMD_TIMEOUT_MS,
    MAX_RUN_CMD_TIMEOUT_MS
  )
}

function normalizeCollectorLimit (value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return undefined
  return Math.max(0, Math.floor(bytes))
}

function utf8SafeEnd (buffer) {
  if (!buffer.length) return 0
  let lead = buffer.length - 1
  while (lead >= 0 && (buffer[lead] & 0xc0) === 0x80) lead -= 1
  if (lead < 0) return 0
  const byte = buffer[lead]
  const expected = byte < 0x80
    ? 1
    : byte >= 0xc2 && byte <= 0xdf
      ? 2
      : byte >= 0xe0 && byte <= 0xef
        ? 3
        : byte >= 0xf0 && byte <= 0xf4 ? 4 : 1
  return buffer.length - lead < expected ? lead : buffer.length
}

function utf8SafeStart (buffer) {
  let start = 0
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start += 1
  return start
}

function outputTruncationSeparator (limit) {
  const candidates = [
    '\n[ShellPilot output truncated]\n',
    '\n[...]\n',
    '...'
  ]
  const text = candidates.find(value => Buffer.byteLength(value) <= limit)
  return Buffer.from(text || '~'.repeat(limit))
}

function createBoundedOutputCollector (maxOutputBytes) {
  const limit = normalizeCollectorLimit(maxOutputBytes)
  if (limit === undefined) {
    throw new Error('maxOutputBytes must be a non-negative finite number.')
  }
  const storage = Buffer.alloc(limit)
  const headCapacity = Math.floor(limit / 2)
  const tailCapacity = limit - headCapacity
  let headLength = 0
  let tailLength = 0
  let tailStart = 0
  let totalBytes = 0

  function appendTail (source) {
    if (!tailCapacity || !source.length) return
    if (source.length >= tailCapacity) {
      source.copy(
        storage,
        headCapacity,
        source.length - tailCapacity
      )
      tailStart = 0
      tailLength = tailCapacity
      return
    }

    const writeStart = (tailStart + tailLength) % tailCapacity
    const overflow = Math.max(0, tailLength + source.length - tailCapacity)
    if (overflow) tailStart = (tailStart + overflow) % tailCapacity
    tailLength = Math.min(tailCapacity, tailLength + source.length)
    const firstLength = Math.min(source.length, tailCapacity - writeStart)
    source.copy(storage, headCapacity + writeStart, 0, firstLength)
    if (firstLength < source.length) {
      source.copy(storage, headCapacity, firstLength)
    }
  }

  function tailBuffers () {
    if (!tailLength) return []
    const firstLength = Math.min(tailLength, tailCapacity - tailStart)
    const parts = [storage.subarray(
      headCapacity + tailStart,
      headCapacity + tailStart + firstLength
    )]
    if (firstLength < tailLength) {
      parts.push(storage.subarray(
        headCapacity,
        headCapacity + tailLength - firstLength
      ))
    }
    return parts
  }

  return {
    append (value) {
      const source = Buffer.isBuffer(value) ? value : Buffer.from(value)
      totalBytes += source.length
      let offset = 0
      if (headLength < headCapacity) {
        const length = Math.min(headCapacity - headLength, source.length)
        source.copy(storage, headLength, 0, length)
        headLength += length
        offset = length
      }
      appendTail(source.subarray(offset))
    },
    get retainedBytes () {
      return headLength + tailLength
    },
    get truncated () {
      return totalBytes > limit
    },
    toString () {
      const head = storage.subarray(0, headLength)
      const tails = tailBuffers()
      if (totalBytes <= limit) {
        return Buffer.concat([head, ...tails], headLength + tailLength)
          .toString('utf8')
      }
      const separator = outputTruncationSeparator(limit)
      const dataBudget = limit - separator.length
      const headBudget = Math.floor(dataBudget / 2)
      const tailBudget = dataBudget - headBudget
      const boundedHead = head.subarray(0, Math.min(head.length, headBudget))
      const safeHead = boundedHead.subarray(0, utf8SafeEnd(boundedHead))
      if (!tails.length) {
        return Buffer.concat([safeHead, separator]).toString('utf8')
      }
      const tail = tails.length === 1
        ? tails[0]
        : Buffer.concat(tails, tailLength)
      const boundedTail = tail.subarray(Math.max(0, tail.length - tailBudget))
      const tailStart = utf8SafeStart(boundedTail)
      const safeTailEnd = utf8SafeEnd(boundedTail)
      const safeTail = boundedTail.subarray(
        Math.min(tailStart, safeTailEnd),
        safeTailEnd
      )
      return Buffer.concat([safeHead, separator, safeTail]).toString('utf8')
    }
  }
}

function executionMap (session) {
  if (!session[activeRunCmdExecutions]) {
    session[activeRunCmdExecutions] = new Map()
  }
  return session[activeRunCmdExecutions]
}

function normalizeExecutionId (value) {
  if (value === undefined || value === null || value === '') return ''
  const id = String(value)
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(id)) {
    throw new Error('Invalid run-cmd executionId.')
  }
  return id
}

function cancellationError (message = 'Remote command cancelled.') {
  const error = new Error(message)
  error.name = 'RunCmdCancelledError'
  return error
}

function terminateExecStream (stream) {
  if (!stream) return
  try {
    stream.signal?.('TERM')
  } catch {}
  try {
    if (typeof stream.close === 'function') stream.close()
    else if (typeof stream.destroy === 'function') stream.destroy()
  } catch {
    try {
      stream.destroy?.()
    } catch {}
  }
}

exports.createBoundedOutputCollector = createBoundedOutputCollector

exports.commonExtends = function (Cls) {
  Cls.prototype.customEnv = function (envs) {
    if (!envs) {
      return {}
    }
    return envs.split(' ').reduce((p, k) => {
      const [key, value] = k.split('=')
      if (key && value) {
        p[key] = value
      }
      return p
    }, {})
  }

  Cls.prototype.getEnv = function (initOptions = this.initOptions) {
    return {
      LANG: initOptions.envLang || 'en_US.UTF-8',
      ...this.customEnv(initOptions.setEnv)
    }
  }

  Cls.prototype.getExecOpts = function () {
    return {
      env: this.getEnv()
    }
  }

  Cls.prototype.runCmd = function (cmd, conn, options = {}) {
    let executionId
    try {
      executionId = normalizeExecutionId(options.executionId)
    } catch (error) {
      return Promise.reject(error)
    }
    const executions = executionMap(this)
    if (executionId && executions.has(executionId)) {
      const error = new Error('run-cmd executionId is already active.')
      error.name = 'RunCmdExecutionConflictError'
      return Promise.reject(error)
    }

    return new Promise((resolve, reject) => {
      const client = conn || this.conn || this.client
      const maxOutputBytes = normalizeMaxOutputBytes(options.maxOutputBytes)
      const timeoutMs = normalizeTimeoutMs(options.timeoutMs)
      const stdoutLimit = maxOutputBytes
        ? Math.max(1, Math.ceil(maxOutputBytes * 0.75))
        : 0
      const stderrLimit = maxOutputBytes ? maxOutputBytes - stdoutLimit : 0
      const stdoutCollector = stdoutLimit
        ? createBoundedOutputCollector(stdoutLimit)
        : null
      const stderrCollector = maxOutputBytes
        ? createBoundedOutputCollector(stderrLimit)
        : null
      let r = ''
      let settled = false
      let timer
      const entry = {
        stream: null,
        cancel: (error = cancellationError()) => {
          if (settled) return false
          finish(reject, error)
          terminateExecStream(entry.stream)
          return true
        }
      }
      const finish = (callback, value) => {
        if (settled) return false
        settled = true
        clearTimeout(timer)
        if (executionId && executions.get(executionId) === entry) {
          executions.delete(executionId)
        }
        callback(value)
        return true
      }
      const boundedResult = (code = null, signal = null) => ({
        stdout: stdoutCollector?.toString() || '',
        stderr: stderrCollector?.toString() || '',
        code: typeof code === 'number' && Number.isFinite(code) ? code : null,
        signal: signal == null ? null : String(signal),
        truncated: stdoutCollector?.truncated === true ||
          stderrCollector?.truncated === true
      })
      if (executionId) executions.set(executionId, entry)

      try {
        client.exec(cmd, this.getExecOpts(), (err, stream) => {
          if (settled) {
            terminateExecStream(stream)
            return
          }
          if (err) {
            finish(reject, err)
            return
          }
          if (stream) {
            entry.stream = stream
            if (timeoutMs) {
              timer = setTimeout(() => {
                const error = new Error(`Command timed out after ${timeoutMs}ms`)
                error.name = 'RunCmdTimeoutError'
                finish(reject, error)
                terminateExecStream(stream)
              }, timeoutMs)
            }
            stream
              .on('data', function (data) {
                if (settled) return
                if (stdoutCollector) stdoutCollector.append(data)
                else r += data.toString()
              })
              .on('error', error => {
                finish(reject, error)
              })
              .on('close', (code, signal) => {
                finish(resolve, maxOutputBytes
                  ? boundedResult(code, signal)
                  : r)
              })
            if (stderrCollector && stream.stderr?.on) {
              stream.stderr.on('data', data => {
                if (!settled) stderrCollector.append(data)
              })
            }
          } else {
            finish(resolve, maxOutputBytes ? boundedResult() : '')
          }
        })
      } catch (error) {
        finish(reject, error)
      }
    })
  }

  Cls.prototype.cancelRunCmd = function (executionId) {
    let id
    try {
      id = normalizeExecutionId(executionId)
    } catch {
      return false
    }
    if (!id) return false
    const entry = executionMap(this).get(id)
    return entry ? entry.cancel() : false
  }

  Cls.prototype.cancelAllRunCmd = function () {
    const executions = executionMap(this)
    let cancelled = 0
    for (const entry of [...executions.values()]) {
      if (entry.cancel()) cancelled += 1
    }
    executions.clear()
    return cancelled
  }

  const originalKill = Cls.prototype.kill
  if (typeof originalKill === 'function') {
    Cls.prototype.kill = function (...args) {
      this.cancelAllRunCmd()
      return originalKill.apply(this, args)
    }
  }

  return Cls
}
