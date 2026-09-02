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

function isObjectLike (value) {
  return Boolean(value) && (
    typeof value === 'object' || typeof value === 'function'
  )
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
    return Object.prototype.hasOwnProperty.call(error, key)
  } catch {
    return false
  }
}

export function classifyRemoteFileRecoveryError (error) {
  const pending = [error]
  const visited = new Set()
  const codes = []
  const details = []
  let inspectionIncomplete = false
  let settlementUncertain = false

  while (pending.length) {
    const current = pending.shift()
    if (!isObjectLike(current)) {
      inspectionIncomplete = true
      continue
    }
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
    codes.push(String(code.value ?? '').trim().toUpperCase())
    details.push(`${String(name.value || '')} ${String(message.value || '')}`)

    const cause = readErrorProperty(current, 'cause')
    if (!cause.ok) inspectionIncomplete = true
    else if (cause.value !== undefined && cause.value !== null) {
      pending.push(cause.value)
    }

    for (const key of structuredFailureKeys) {
      const nested = readErrorProperty(current, key)
      if (!nested.ok) {
        inspectionIncomplete = true
        settlementUncertain = true
      } else if (nested.value !== undefined && nested.value !== null) {
        settlementUncertain = true
        pending.push(nested.value)
      }
    }
    for (const key of structuredFailureArrayKeys) {
      const nested = readErrorProperty(current, key)
      if (!nested.ok) {
        inspectionIncomplete = true
        settlementUncertain = true
      } else if (nested.value !== undefined && nested.value !== null) {
        settlementUncertain = true
        if (Array.isArray(nested.value)) pending.push(...nested.value)
        else pending.push(nested.value)
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
    if (cleanupAttempted || cleanupSucceeded) {
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

  if (pending.length) inspectionIncomplete = true
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

export function isAuthoritativeRemoteMissingError (error) {
  return authoritativeMissingCodes.has(error?.code)
}

export function isAuthoritativeRemoteExistsError (error) {
  return authoritativeExistsCodes.has(error?.code)
}
