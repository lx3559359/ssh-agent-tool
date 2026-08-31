export const managedInputProtocolVersion = 2

const defaultAckTimeoutMs = 2000
const managedRequestIdPattern = /^[a-f0-9]{32}$/
const managedInputStatuses = new Set([
  'accepted',
  'written',
  'rejected',
  'interrupted'
])

function createRequestId () {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(
    bytes,
    byte => byte.toString(16).padStart(2, '0')
  ).join('')
}

function transportError (message) {
  const error = new Error(message)
  error.name = 'ManagedInputTransportError'
  return error
}

function abortError (message) {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function deferred () {
  let resolveDeferred
  let rejectDeferred
  let settled = false
  const promise = new Promise((resolve, reject) => {
    resolveDeferred = value => {
      if (settled) return
      settled = true
      resolve(value)
    }
    rejectDeferred = error => {
      if (settled) return
      settled = true
      reject(error)
    }
  })
  promise.catch(() => {})
  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred,
    settled: () => settled
  }
}

export function createManagedTerminalTransport (options = {}) {
  if (typeof options.send !== 'function') {
    throw new TypeError('Managed input transport requires a sender')
  }
  const send = options.send
  const nextRequestId = typeof options.createRequestId === 'function'
    ? options.createRequestId
    : createRequestId
  const now = typeof options.now === 'function' ? options.now : Date.now
  const recordAck = typeof options.recordAck === 'function'
    ? options.recordAck
    : null
  const ackTimeoutMs = Math.max(
    1,
    Number(options.ackTimeoutMs) || defaultAckTimeoutMs
  )
  const capabilityTimeoutMs = Math.max(
    1,
    Number(options.capabilityTimeoutMs) || defaultAckTimeoutMs
  )
  const readiness = deferred()
  const pending = new Map()
  let protocolVersion = null
  let capabilityRequested = false
  let capabilityTimer = null
  let disposed = false

  function clearCapabilityTimer () {
    if (!capabilityTimer) return
    clearTimeout(capabilityTimer)
    capabilityTimer = null
  }

  function clearSubmission (submission) {
    clearTimeout(submission.ackTimer)
    submission.ackTimer = null
    if (pending.get(submission.requestId) === submission) {
      pending.delete(submission.requestId)
    }
  }

  function rejectSubmission (submission, error) {
    submission.accepted.reject(error)
    submission.written.reject(error)
    clearSubmission(submission)
  }

  function requestCapabilities () {
    if (disposed || capabilityRequested) return false
    capabilityRequested = true
    capabilityTimer = setTimeout(() => {
      capabilityTimer = null
      readiness.reject(transportError('受控输入能力确认超时'))
    }, capabilityTimeoutMs)
    try {
      send({ action: 'managed-input-capabilities-request' })
      return true
    } catch (error) {
      clearCapabilityTimer()
      readiness.reject(transportError('受控输入能力请求发送失败'))
      return false
    }
  }

  function ready () {
    if (disposed) {
      return Promise.reject(transportError('受控输入通道已关闭'))
    }
    return readiness.promise
  }

  function submit (command) {
    if (disposed) throw transportError('受控输入通道已关闭')
    if (protocolVersion !== managedInputProtocolVersion) {
      throw transportError('受控输入协议尚未就绪')
    }
    if (typeof command !== 'string' || !command.length) {
      throw transportError('受控输入命令无效')
    }
    const requestId = String(nextRequestId() || '')
    if (!managedRequestIdPattern.test(requestId) || pending.has(requestId)) {
      throw transportError('受控输入请求标识无效')
    }
    const accepted = deferred()
    const written = deferred()
    const submission = {
      requestId,
      accepted,
      written,
      phase: 'pending',
      sentAt: Number(now()),
      ackTimer: null
    }
    submission.ackTimer = setTimeout(() => {
      rejectSubmission(submission, transportError('受控输入确认超时'))
    }, ackTimeoutMs)
    pending.set(requestId, submission)
    try {
      send({ action: 'managed-input', requestId, command })
    } catch (error) {
      rejectSubmission(submission, transportError('受控输入发送失败'))
      throw transportError('受控输入发送失败')
    }
    return Object.freeze({
      requestId,
      accepted: accepted.promise,
      written: written.promise
    })
  }

  function recordAcknowledgement (submission) {
    if (!recordAck) return
    let durationMs
    try {
      durationMs = Math.max(0, Number(now()) - submission.sentAt)
      Promise.resolve(recordAck(durationMs)).catch(() => {})
    } catch (error) {}
  }

  function handleCapabilities (message) {
    clearCapabilityTimer()
    if (message.protocolVersion !== managedInputProtocolVersion) {
      readiness.reject(transportError('受控输入协议版本不兼容'))
      return true
    }
    protocolVersion = message.protocolVersion
    readiness.resolve(true)
    return true
  }

  function handleStatus (message) {
    if (!managedRequestIdPattern.test(String(message.requestId || '')) ||
      !managedInputStatuses.has(message.status)) {
      return true
    }
    const submission = pending.get(message.requestId)
    if (!submission) return true
    if (message.status === 'accepted') {
      if (submission.phase !== 'pending') return true
      submission.phase = 'accepted'
      clearTimeout(submission.ackTimer)
      submission.ackTimer = null
      submission.accepted.resolve(true)
      recordAcknowledgement(submission)
      return true
    }
    if (message.status === 'written') {
      if (submission.phase !== 'accepted') {
        rejectSubmission(
          submission,
          transportError('受控输入状态顺序无效')
        )
        return true
      }
      submission.written.resolve(true)
      clearSubmission(submission)
      return true
    }
    if (message.status === 'rejected') {
      rejectSubmission(submission, transportError('受控输入请求被拒绝'))
      return true
    }
    const error = abortError('受控输入写入已中断')
    if (submission.phase === 'pending') submission.accepted.reject(error)
    submission.written.reject(error)
    clearSubmission(submission)
    return true
  }

  function handleControlMessage (message) {
    if (!message || typeof message !== 'object') return false
    if (message.action === 'managed-input-capabilities') {
      return handleCapabilities(message)
    }
    if (message.action === 'managed-input-status') {
      return handleStatus(message)
    }
    return false
  }

  function interrupt () {
    if (disposed || protocolVersion !== managedInputProtocolVersion) return false
    send({ action: 'managed-input-interrupt' })
    return true
  }

  function dispose () {
    if (disposed) return false
    disposed = true
    clearCapabilityTimer()
    const error = transportError('受控输入通道已关闭')
    readiness.reject(error)
    for (const submission of [...pending.values()]) {
      rejectSubmission(submission, error)
    }
    return true
  }

  return Object.freeze({
    requestCapabilities,
    ready,
    submit,
    handleControlMessage,
    interrupt,
    dispose
  })
}
