const authoritativeMissingCodes = new Set([
  2,
  'ENOENT',
  'SFTP_NO_SUCH_FILE'
])

const authoritativeExistsCodes = new Set([
  11,
  'EEXIST',
  'SFTP_FILE_ALREADY_EXISTS'
])

const accessDeniedCodes = new Set([
  '3',
  'EACCES',
  'EPERM',
  'PERMISSION_DENIED',
  'SSH_FX_PERMISSION_DENIED',
  'SFTP_PERMISSION_DENIED'
])

const transientTransportCodes = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENOTCONN'
])

const structuredFailureKeys = [
  'releaseError',
  'cleanupError',
  'cleanupRetryError',
  'teardownError',
  'destroyError',
  'abandonError',
  'settlementError'
]

const structuredFailureArrayKeys = [
  'errors',
  'cleanupErrors',
  'releaseErrors',
  'teardownErrors'
]

const recoveryErrorNodeBudget = 64
const recoveryErrorEdgeBudget = 128
const cleanupErrorAttachmentBudget = 32
const cleanupErrorAdditionBudget = 8

export const remoteFileCleanupErrorsTruncatedCode =
  'REMOTE_FILE_CLEANUP_ERRORS_TRUNCATED'

const cleanupErrorsTruncatedMarker = Object.freeze({
  code: remoteFileCleanupErrorsTruncatedCode,
  message: 'Remote file cleanup errors were truncated'
})

const incompleteRecoveryClassification = Object.freeze({
  accessDenied: false,
  identityFailure: false,
  transientTransportFailure: false,
  settlementUncertain: true,
  inspectionIncomplete: true,
  failClosed: true
})

function isObjectLike (value) {
  return Boolean(value) && (
    typeof value === 'object' || typeof value === 'function'
  )
}

function closeErrorIterator (iterator) {
  try {
    const returnMethod = iterator?.return
    if (typeof returnMethod === 'function') {
      Reflect.apply(returnMethod, iterator, [])
    }
  } catch {}
}

function snapshotErrorIterable (source, limit) {
  const values = []
  if (source === undefined || source === null) {
    return { values, incomplete: false, truncated: false }
  }
  let iterator
  try {
    const iteratorMethod = source[Symbol.iterator]
    if (typeof iteratorMethod !== 'function') {
      return { values, incomplete: true, truncated: true }
    }
    iterator = Reflect.apply(iteratorMethod, source, [])
  } catch {
    return { values, incomplete: true, truncated: true }
  }
  if (!isObjectLike(iterator)) {
    return { values, incomplete: true, truncated: true }
  }
  let nextMethod
  try {
    nextMethod = iterator.next
  } catch {
    closeErrorIterator(iterator)
    return { values, incomplete: true, truncated: true }
  }
  if (typeof nextMethod !== 'function') {
    closeErrorIterator(iterator)
    return { values, incomplete: true, truncated: true }
  }
  for (let count = 0; count < limit; count += 1) {
    let step
    try {
      step = Reflect.apply(nextMethod, iterator, [])
      if (!isObjectLike(step)) throw new TypeError('Invalid iterator result')
      if (step.done) return { values, incomplete: false, truncated: false }
      values.push(step.value)
    } catch {
      closeErrorIterator(iterator)
      return { values, incomplete: true, truncated: true }
    }
  }
  closeErrorIterator(iterator)
  return { values, incomplete: false, truncated: true }
}

export function appendRemoteFileCleanupErrors (primaryError, additions) {
  try {
    const added = snapshotErrorIterable(
      additions,
      cleanupErrorAdditionBudget
    )
    let existingSource
    let propertyIncomplete = false
    try {
      existingSource = primaryError?.cleanupErrors
    } catch {
      propertyIncomplete = true
    }
    const existingLimit = Math.max(
      0,
      cleanupErrorAttachmentBudget - added.values.length - 1
    )
    const existing = snapshotErrorIterable(existingSource, existingLimit)
    const errors = []
    for (const value of existing.values) errors.push(value)
    for (const value of added.values) errors.push(value)
    const truncated = propertyIncomplete || existing.incomplete ||
      existing.truncated || added.incomplete || added.truncated
    if (truncated) {
      if (errors.length >= cleanupErrorAttachmentBudget) errors.pop()
      errors.push(cleanupErrorsTruncatedMarker)
    }
    const frozenErrors = Object.freeze(errors)
    let attached = false
    try {
      if (primaryError && Object.isExtensible(primaryError)) {
        primaryError.cleanupErrors = frozenErrors
        attached = true
      }
    } catch {}
    return Object.freeze({
      errors: frozenErrors,
      attached,
      inspectionIncomplete: truncated,
      truncated
    })
  } catch {
    return Object.freeze({
      errors: Object.freeze([cleanupErrorsTruncatedMarker]),
      attached: false,
      inspectionIncomplete: true,
      truncated: true
    })
  }
}

function readErrorProperty (error, key) {
  try {
    return { ok: true, value: error[key] }
  } catch {
    return { ok: false, value: undefined }
  }
}

function hasOwnErrorProperty (error, key) {
  try {
    return {
      ok: true,
      value: Object.prototype.hasOwnProperty.call(error, key)
    }
  } catch {
    return { ok: false, value: false }
  }
}

function coerceErrorText (value, uppercase = false) {
  try {
    const text = String(value ?? '').trim()
    return {
      ok: true,
      value: uppercase ? text.toUpperCase() : text
    }
  } catch {
    return { ok: false, value: '' }
  }
}

function inspectRemoteFileRecoveryError (error) {
  const pending = []
  const queued = new Set()
  const visited = new Set()
  const codes = []
  const details = []
  let inspectionIncomplete = false
  let settlementUncertain = false
  let edgeCount = 0
  let pendingIndex = 0

  const enqueue = value => {
    if (edgeCount >= recoveryErrorEdgeBudget) {
      inspectionIncomplete = true
      return false
    }
    edgeCount += 1
    if (value === undefined || value === null) return true
    if (!isObjectLike(value)) {
      inspectionIncomplete = true
      return true
    }
    if (visited.has(value) || queued.has(value)) return true
    if (visited.size + queued.size >= recoveryErrorNodeBudget) {
      inspectionIncomplete = true
      return false
    }
    queued.add(value)
    pending.push(value)
    return true
  }

  const closeIterator = iterator => {
    const returnMethod = readErrorProperty(iterator, 'return')
    if (!returnMethod.ok) inspectionIncomplete = true
    else if (typeof returnMethod.value === 'function') {
      try {
        Reflect.apply(returnMethod.value, iterator, [])
      } catch {
        inspectionIncomplete = true
      }
    }
  }

  const enqueueCollection = value => {
    let isArray
    try {
      isArray = Array.isArray(value)
    } catch {
      inspectionIncomplete = true
      return
    }
    if (!isArray) {
      enqueue(value)
      return
    }
    const iteratorMethod = readErrorProperty(value, Symbol.iterator)
    if (!iteratorMethod.ok || typeof iteratorMethod.value !== 'function') {
      inspectionIncomplete = true
      return
    }
    let iterator
    try {
      iterator = Reflect.apply(iteratorMethod.value, value, [])
    } catch {
      inspectionIncomplete = true
      return
    }
    if (!isObjectLike(iterator)) {
      inspectionIncomplete = true
      return
    }
    const nextMethod = readErrorProperty(iterator, 'next')
    if (!nextMethod.ok || typeof nextMethod.value !== 'function') {
      inspectionIncomplete = true
      closeIterator(iterator)
      return
    }
    while (true) {
      if (edgeCount >= recoveryErrorEdgeBudget ||
        visited.size + queued.size >= recoveryErrorNodeBudget) break
      let step
      try {
        step = Reflect.apply(nextMethod.value, iterator, [])
      } catch {
        inspectionIncomplete = true
        closeIterator(iterator)
        return
      }
      if (!isObjectLike(step)) {
        inspectionIncomplete = true
        closeIterator(iterator)
        return
      }
      const done = readErrorProperty(step, 'done')
      if (!done.ok) {
        inspectionIncomplete = true
        closeIterator(iterator)
        return
      }
      if (done.value) return
      const item = readErrorProperty(step, 'value')
      if (!item.ok || !enqueue(item.value)) {
        inspectionIncomplete = true
        closeIterator(iterator)
        return
      }
    }
    inspectionIncomplete = true
    closeIterator(iterator)
  }

  if (!isObjectLike(error)) inspectionIncomplete = true
  else {
    queued.add(error)
    pending.push(error)
  }

  while (pendingIndex < pending.length) {
    const current = pending[pendingIndex++]
    queued.delete(current)
    if (visited.has(current)) continue
    if (visited.size >= recoveryErrorNodeBudget) {
      inspectionIncomplete = true
      break
    }
    visited.add(current)

    const code = readErrorProperty(current, 'code')
    const name = readErrorProperty(current, 'name')
    const message = readErrorProperty(current, 'message')
    if (!code.ok || !name.ok || !message.ok) inspectionIncomplete = true
    const codeText = coerceErrorText(code.value, true)
    const nameText = coerceErrorText(name.value)
    const messageText = coerceErrorText(message.value)
    if (!codeText.ok || !nameText.ok || !messageText.ok) {
      inspectionIncomplete = true
    }
    codes.push(codeText.value)
    details.push(`${nameText.value} ${messageText.value}`)

    const cause = readErrorProperty(current, 'cause')
    if (!cause.ok) inspectionIncomplete = true
    else enqueue(cause.value)

    for (const key of structuredFailureKeys) {
      const nested = readErrorProperty(current, key)
      if (!nested.ok) {
        inspectionIncomplete = true
        settlementUncertain = true
      } else if (nested.value !== undefined && nested.value !== null) {
        settlementUncertain = true
        enqueue(nested.value)
      }
    }
    for (const key of structuredFailureArrayKeys) {
      const nested = readErrorProperty(current, key)
      if (!nested.ok) {
        inspectionIncomplete = true
        settlementUncertain = true
      } else if (nested.value !== undefined && nested.value !== null) {
        settlementUncertain = true
        enqueueCollection(nested.value)
      }
    }

    const cleanupAttempted = hasOwnErrorProperty(
      current,
      'cleanupAttempted'
    )
    const cleanupSucceeded = hasOwnErrorProperty(
      current,
      'cleanupSucceeded'
    )
    if (!cleanupAttempted.ok || !cleanupSucceeded.ok) {
      inspectionIncomplete = true
      settlementUncertain = true
    } else if (cleanupAttempted.value || cleanupSucceeded.value) {
      const succeeded = readErrorProperty(current, 'cleanupSucceeded')
      if (!succeeded.ok || succeeded.value !== true) {
        settlementUncertain = true
      }
    }
    for (const key of ['uncertain', 'releaseUncertain', 'teardownUncertain']) {
      const uncertain = readErrorProperty(current, key)
      if (!uncertain.ok) inspectionIncomplete = true
      else if (uncertain.value === true) settlementUncertain = true
    }
  }

  const errorDetails = details.join(' ')
  const accessDenied = codes.some(code => (
    accessDeniedCodes.has(code) || code.endsWith('_PERMISSION_DENIED')
  )) || /permission denied|access denied|权限|拒绝/i.test(errorDetails)
  const identityFailure = codes.some(code => (
    code.startsWith('REMOTE_FILE_IDENTITY_')
  )) || /(?:identity|身份|端点).*(?:unavailable|unknown|mismatch|changed|switch|无法确认|不可用|未知|不一致|变化|切换)/i
    .test(errorDetails)
  const transientTransportFailure = codes.some(code => (
    transientTransportCodes.has(code)
  ))

  return Object.freeze({
    accessDenied,
    identityFailure,
    transientTransportFailure,
    settlementUncertain,
    inspectionIncomplete,
    failClosed: accessDenied || identityFailure || settlementUncertain ||
      inspectionIncomplete
  })
}

export function classifyRemoteFileRecoveryError (error) {
  try {
    return inspectRemoteFileRecoveryError(error)
  } catch {
    return incompleteRecoveryClassification
  }
}

export function isAuthoritativeRemoteMissingError (error) {
  return authoritativeMissingCodes.has(error?.code)
}

export function isAuthoritativeRemoteExistsError (error) {
  return authoritativeExistsCodes.has(error?.code)
}
