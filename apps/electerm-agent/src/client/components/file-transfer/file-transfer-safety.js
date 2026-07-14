import { normalizeEndpoint } from '../../common/safety-transactions/endpoint-guard.js'

const bypassPolicies = new Set(['skip', 'cancel'])

export function shouldUseLegacyZipOptimization ({ zip, isFtp } = {}) {
  return zip === true && isFtp === true
}

export function getTransferSafetyCompletionFailure (operation) {
  if (!operation || operation.state === 'rollback-available') return null
  const stateMessages = {
    failed: 'SFTP 传输安全校验失败，远程目标可回滚。',
    cancelled: 'SFTP 传输安全事务已取消。'
  }
  return {
    status: 'exception',
    error: operation.error || stateMessages[operation.state] ||
      `SFTP 传输安全事务未成功完成（${operation.state || '未知状态'}）。`
  }
}

function stableHash (value) {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(String(value))) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

function requiredSourceIdentityPart (value, label) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`跨主机传输缺少${label}。`)
  return normalized
}

export function buildTransferSourceEndpointKey (endpoint = {}) {
  const normalized = normalizeEndpoint(endpoint)
  const tabId = requiredSourceIdentityPart(endpoint.tabId, '来源标签页标识')
  const sessionKey = requiredSourceIdentityPart(
    endpoint.pid || endpoint.terminalPid,
    '来源会话安全标识'
  )
  const host = normalized.host.includes(':')
    ? `[${normalized.host}]`
    : normalized.host
  return [
    `sftp-source:v1:${encodeURIComponent(normalized.username)}@${host}:${normalized.port}`,
    `tab:${encodeURIComponent(tabId)}`,
    `session:${encodeURIComponent(sessionKey)}`
  ].join('|')
}

export function buildCrossHostSourceIdentity ({
  sourceEndpointKey,
  path,
  file = {}
} = {}) {
  const endpointKey = requiredSourceIdentityPart(
    sourceEndpointKey,
    '来源端点身份'
  )
  const sourcePath = requiredSourceIdentityPart(path, '来源路径')
  const type = file.isDirectory ? 'directory' : 'file'
  const size = Number.isSafeInteger(file.size) ? file.size : ''
  return `source:${stableHash(`${endpointKey}\u0000${sourcePath}\u0000${type}\u0000${size}`)}`
}

export function assertCrossHostSourceHistory (history, expected = {}) {
  if (!history ||
    history.sourceEndpointKey !== expected.sourceEndpointKey ||
    history.sourceIdentity !== expected.sourceIdentity) {
    throw new Error('跨主机传输来源安全身份已变化，已阻止目标写入。')
  }
  return true
}

function resourceType (file = {}) {
  return file.isDirectory ? 'directory' : 'file'
}

function finalTargetPath (transfer = {}) {
  return String(transfer.finalToPath || transfer.toPath || '')
}

function transferIdentity (transfer, targetPath) {
  const itemId = String(transfer.id || '')
  const batchId = String(transfer.transferBatch || '')
  const source = String(transfer.fromPath || '')
  return `transfer:${stableHash(`${batchId}\u0000${itemId}\u0000${source}\u0000${targetPath}`)}`
}

export function buildTransferSafetyPlan (transfer = {}) {
  if (transfer.isFtp === true) return { required: false, reason: 'ftp' }
  if (bypassPolicies.has(transfer.conflictPolicy)) {
    return { required: false, reason: transfer.conflictPolicy }
  }
  if (transfer.typeTo === 'local') {
    return {
      required: false,
      reason: transfer.typeFrom === 'remote' ? 'download' : 'local-only'
    }
  }
  if (transfer.typeTo !== 'remote') {
    return { required: false, reason: 'local-only' }
  }

  const target = finalTargetPath(transfer)
  if (!target.startsWith('/')) {
    throw new Error('远程传输目标必须是绝对路径。')
  }
  const sameRemote = transfer.typeFrom === 'remote' &&
    transfer.remote2remoteStep !== 2
  const action = sameRemote
    ? (transfer.operation === 'mv' ? 'move' : 'copy')
    : 'upload'
  const type = resourceType(transfer.fromFile)
  const paths = sameRemote
    ? { source: String(transfer.fromPath || ''), target }
    : { target }
  const identity = transferIdentity(transfer, target)
  const batchId = String(transfer.transferBatch || '') || undefined
  const direction = transfer.remote2remoteStep === 2
    ? 'cross-host-target'
    : sameRemote
      ? 'same-endpoint'
      : 'local-to-remote'
  const expected = {
    type,
    ...(type === 'file' && Number.isSafeInteger(transfer.fromFile?.size)
      ? { size: transfer.fromFile.size }
      : {})
  }
  const sourceIdentity = action === 'upload'
    ? String(transfer.sourceIdentity ||
      `source:${stableHash(String(transfer.fromPath || ''))}`)
    : undefined

  return {
    required: true,
    operationId: `sftp-transfer-${stableHash(identity)}`,
    action,
    paths,
    type,
    expected,
    transfer: {
      identity,
      direction,
      ...(sourceIdentity ? { sourceIdentity } : {}),
      ...(transfer.sourceEndpointKey
        ? { sourceEndpointKey: String(transfer.sourceEndpointKey) }
        : {}),
      ...(batchId ? { batchId } : {})
    }
  }
}

export function createTransferSafetyController ({
  getTransfer,
  getCapability,
  cancelTransport
}) {
  let plan
  let operation
  let execution
  let beginPromise
  let completionPromise

  async function begin () {
    if (execution) return execution
    if (beginPromise) return beginPromise

    plan = buildTransferSafetyPlan(getTransfer())
    if (!plan.required) return null

    const capability = getCapability()
    if (!capability) {
      throw new Error('当前 SFTP 会话不支持安全传输，已阻止远程写入')
    }

    beginPromise = (async () => {
      operation = operation || await capability.prepareTransferSafetyOperation(plan)
      execution = await capability.beginTransferSafetyOperation(operation.id, {
        transferIdentity: plan.transfer.identity,
        cancelExternal: cancelTransport
      })
      return execution
    })()

    try {
      return await beginPromise
    } catch (error) {
      beginPromise = null
      throw error
    }
  }

  async function complete ({ exitCode = 0, cancelled = false } = {}) {
    if (completionPromise) return completionPromise
    if (!execution || !operation || !plan?.required) return null

    const capability = getCapability()
    if (!capability) {
      throw new Error('SFTP 安全会话已断开，无法确认传输结果')
    }

    completionPromise = capability.completeTransferSafetyOperation(operation.id, {
      executionId: execution.executionId,
      effectKey: execution.effectKey || operation.effectKey,
      transferIdentity: plan.transfer.identity,
      exitCode,
      cancelled
    })
    try {
      return await completionPromise
    } catch (error) {
      completionPromise = null
      throw error
    }
  }

  async function cancel () {
    if (!operation || !plan?.required) return null
    const capability = getCapability()
    if (!capability) {
      throw new Error('SFTP 安全会话已断开，无法取消受保护传输')
    }
    return capability.cancelTransferSafetyOperation(operation.id)
  }

  return {
    begin,
    complete,
    cancel,
    get operationId () {
      return operation?.id || plan?.operationId
    },
    get started () {
      return Boolean(execution)
    }
  }
}
