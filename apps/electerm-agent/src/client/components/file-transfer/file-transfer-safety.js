import { normalizeEndpoint } from '../../common/safety-transactions/endpoint-guard.js'
import { describeSftpTransferEntry } from '../sftp/sftp-transaction-adapter.js'
import { createTraceContext } from '../../common/quality/trace-context.js'
import { recordQualityEvent } from '../../common/quality/quality-events.js'
import { attachTraceToOperation } from '../../common/safety-transactions/transaction-store.js'

const bypassPolicies = new Set(['skip', 'cancel'])
const completedTerminalStates = new Set([
  'rollback-available',
  'completed',
  'kept',
  'restored'
])
const failedTerminalStates = new Set(['failed'])
const terminalCapabilityUnavailableCode = 'SFTP_TERMINAL_CAPABILITY_UNAVAILABLE'

function terminalCapabilityUnavailable (message) {
  const error = new Error(message)
  error.code = terminalCapabilityUnavailableCode
  return error
}

function sameTransferDescriptor (left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function crossHostContentDescriptor (descriptor) {
  if (!descriptor || descriptor.absent === true) return descriptor
  const { uid, gid, mode, entries, ...content } = descriptor
  if (Array.isArray(entries)) {
    content.entries = entries.map(item => ({
      name: item.name,
      entry: crossHostContentDescriptor(item.entry)
    }))
  }
  return content
}

function needsLocalSourceDescriptor (transfer = {}) {
  return transfer.typeFrom === 'local' &&
    transfer.typeTo === 'remote' &&
    transfer.isFtp !== true &&
    !bypassPolicies.has(transfer.conflictPolicy)
}

export async function captureLocalTransferSource ({
  transfer = {},
  describeLocal
} = {}) {
  if (!needsLocalSourceDescriptor(transfer)) return null
  if (typeof describeLocal !== 'function') {
    throw new Error('受保护上传缺少本地源文件描述能力，已停止远程写入。')
  }
  return describeLocal(transfer.fromPath)
}

export async function verifyLocalTransferSource ({
  transfer = {},
  sourceDescriptor,
  describeLocal
} = {}) {
  if (!sourceDescriptor || !needsLocalSourceDescriptor(transfer)) return true
  const current = await captureLocalTransferSource({ transfer, describeLocal })
  if (!sameTransferDescriptor(current, sourceDescriptor)) {
    throw new Error('本地上传源在传输期间发生变化，远程目标可执行回滚。')
  }
  return true
}

export function createTransferAttemptGuard () {
  let sequence = 0
  let current = null
  let completing = false
  return {
    start () {
      if (completing) return null
      current = ++sequence
      return current
    },
    isCurrent (token) {
      return token !== null && token === current
    },
    invalidate (token) {
      if (token === undefined || token === current) current = null
    },
    beginCompletion (token) {
      if (completing || token !== current) return false
      completing = true
      return true
    },
    finishCompletion (token) {
      if (token === current) current = null
      completing = false
    },
    get completing () {
      return completing
    }
  }
}

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

export async function verifyCrossHostSourcePreflight ({
  transfer = {},
  getCapability,
  describeRemote = describeSftpTransferEntry
} = {}) {
  if (transfer.remote2remoteStep !== 1) return null

  const sourceTabId = requiredSourceIdentityPart(
    transfer.tabId,
    '来源标签页标识'
  )
  const capability = getCapability?.(sourceTabId)
  if (!capability?.getSftpSafetyEndpoint) {
    throw new Error('跨主机传输无法重新确认当前来源 SFTP 安全端点，已停止下载。')
  }
  const pinnedSftp = capability.sftp
  if (!pinnedSftp) {
    throw new Error('跨主机传输当前来源 SFTP 实例不可用，已停止下载。')
  }

  const endpoint = capability.getSftpSafetyEndpoint()
  await Promise.resolve()
  if (getCapability?.(sourceTabId) !== capability || capability.sftp !== pinnedSftp) {
    throw new Error('跨主机传输来源连接在验证期间已被替换，已停止下载。')
  }

  const verifiedSourceEndpointKey = buildTransferSourceEndpointKey(endpoint)
  if (verifiedSourceEndpointKey !== transfer.sourceEndpointKey) {
    throw new Error('跨主机传输来源端点已变化，已停止下载。')
  }

  const verifiedSourceIdentity = buildCrossHostSourceIdentity({
    sourceEndpointKey: verifiedSourceEndpointKey,
    path: transfer.fromPath,
    file: transfer.fromFile
  })
  if (verifiedSourceIdentity !== transfer.sourceIdentity) {
    throw new Error('跨主机传输来源文件身份不一致，已停止下载。')
  }
  const sourceDescriptor = await describeRemote(
    pinnedSftp,
    transfer.fromPath
  )
  await Promise.resolve()
  if (getCapability?.(sourceTabId) !== capability || capability.sftp !== pinnedSftp) {
    throw new Error('跨主机传输来源连接在内容验证期间已被替换，已停止下载。')
  }
  const expectedType = transfer.fromFile?.isDirectory ? 'directory' : 'file'
  if (sourceDescriptor?.type !== expectedType ||
    (expectedType === 'file' && Number.isSafeInteger(transfer.fromFile?.size) &&
      sourceDescriptor.size !== transfer.fromFile.size)) {
    throw new Error('跨主机传输来源内容与排队时记录不一致，已停止下载。')
  }

  return {
    verified: {
      verifiedSourceEndpointKey,
      verifiedSourceIdentity,
      sourceDescriptor
    },
    runtime: {
      capability,
      sftp: pinnedSftp
    }
  }
}

export async function verifyCrossHostSourceContent ({
  transfer = {},
  sourcePin,
  preflight,
  describeRemote = describeSftpTransferEntry,
  describeLocal
} = {}) {
  if (transfer.remote2remoteStep !== 1) return null
  if (!sourcePin?.sftp || !preflight?.sourceDescriptor) {
    throw new Error('跨主机传输缺少已固定的来源内容身份，已阻止目标写入。')
  }
  if (typeof describeLocal !== 'function') {
    throw new Error('跨主机传输缺少本地临时文件描述能力，已阻止目标写入。')
  }
  const remoteAfter = await describeRemote(sourcePin.sftp, transfer.fromPath)
  if (!sameTransferDescriptor(remoteAfter, preflight.sourceDescriptor)) {
    throw new Error('跨主机传输来源内容在下载期间发生变化，已阻止目标写入。')
  }
  const local = await describeLocal(transfer.toPath)
  if (!sameTransferDescriptor(
    crossHostContentDescriptor(local),
    crossHostContentDescriptor(preflight.sourceDescriptor)
  )) {
    throw new Error('跨主机传输本地临时文件与来源内容身份不一致，已阻止目标写入。')
  }
  const verifiedSourceContentIdentity = `content:${stableHash(
    JSON.stringify(crossHostContentDescriptor(preflight.sourceDescriptor))
  )}`
  return {
    verifiedSourceEndpointKey: preflight.verifiedSourceEndpointKey,
    verifiedSourceIdentity: preflight.verifiedSourceIdentity,
    verifiedSourceContentIdentity,
    verifiedSourceDescriptor: local
  }
}

export function resolveTransferRuntimeTransport ({
  transfer = {},
  sourcePin,
  getCapability
} = {}) {
  if (transfer.remote2remoteStep === 1) {
    if (!sourcePin?.capability || !sourcePin?.sftp) {
      throw new Error('跨主机传输缺少已验证的来源连接，已停止下载。')
    }
    return sourcePin
  }
  const capability = getCapability?.(transfer.tabId)
  return {
    capability,
    sftp: capability?.sftp
  }
}

export function resetCrossHostSourceAttemptForRetry ({
  transfer = {},
  sourcePin,
  verifiedSource,
  sourcePreflight
} = {}) {
  if (transfer.remote2remoteStep !== 1) {
    return { sourcePin, verifiedSource, sourcePreflight }
  }
  return {
    sourcePin: null,
    verifiedSource: null,
    sourcePreflight: null
  }
}

export function assertCrossHostSourceHistory (history, expected = {}) {
  const boundContentIdentity = history?.verifiedSourceDescriptor
    ? `content:${stableHash(JSON.stringify(
        crossHostContentDescriptor(history.verifiedSourceDescriptor)
      ))}`
    : ''
  if (!history ||
    history.verifiedSourceEndpointKey !== expected.sourceEndpointKey ||
    history.verifiedSourceIdentity !== expected.sourceIdentity ||
    !history.verifiedSourceContentIdentity ||
    !history.verifiedSourceDescriptor ||
    history.verifiedSourceContentIdentity !== boundContentIdentity ||
    (expected.sourceContentIdentity &&
      history.verifiedSourceContentIdentity !== expected.sourceContentIdentity)) {
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
    ...(transfer.sourceDescriptor
      ? { sourceDescriptor: transfer.sourceDescriptor }
      : {
          type,
          ...(type === 'file' && Number.isSafeInteger(transfer.fromFile?.size)
            ? { size: transfer.fromFile.size }
            : {})
        })
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
      ...(transfer.sourceContentIdentity
        ? { sourceContentIdentity: String(transfer.sourceContentIdentity) }
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
  let terminalTransition
  let terminalPromise
  let settled = false
  let operationCapability
  let traceContext
  let parentTraceContext
  let beginAttempt = 0
  let qualityFinished = false
  const noTerminalResult = Symbol('no-terminal-result')

  function recordTransferEvent (phase, result) {
    if (!traceContext || (phase !== 'started' && qualityFinished)) return
    if (phase !== 'started') qualityFinished = true
    recordQualityEvent(traceContext, {
      module: 'sftp',
      action: 'transfer',
      phase,
      ...(result ? { result } : {})
    })
  }

  function recordPersistedTerminal (transition, result, fallback = {}) {
    let phase
    if (result?.state) {
      phase = completedTerminalStates.has(result.state)
        ? 'completed'
        : result.state === 'cancelled'
          ? 'cancelled'
          : 'failed'
    } else if (transition === 'cancel' || fallback.cancelled) {
      phase = 'cancelled'
    } else {
      phase = fallback.exitCode === 0 ? 'completed' : 'failed'
    }
    recordTransferEvent(phase, phase)
  }

  function isPersistedTerminal (result) {
    return completedTerminalStates.has(result?.state) ||
      failedTerminalStates.has(result?.state) ||
      result?.state === 'cancelled'
  }

  async function readPersistedOperation () {
    const capability = getCapability() || operationCapability
    if (!operation?.id ||
      typeof capability?.getTransferSafetyOperation !== 'function') {
      return null
    }
    try {
      return await capability.getTransferSafetyOperation(operation.id)
    } catch (error) {
      return null
    }
  }

  function claimTerminal (transition, work, fallback) {
    if (settled) return Promise.resolve(null)
    if (terminalPromise) return terminalPromise

    terminalTransition = transition
    const claimedPromise = (async () => {
      try {
        const result = await work()
        if (result === noTerminalResult) {
          terminalTransition = undefined
          terminalPromise = undefined
          return null
        }
        settled = true
        recordPersistedTerminal(terminalTransition, result, fallback)
        return result
      } catch (error) {
        if (error?.code === terminalCapabilityUnavailableCode) {
          settled = true
          recordTransferEvent('failed', 'failed')
          throw error
        }
        const persisted = await readPersistedOperation()
        if (isPersistedTerminal(persisted)) {
          settled = true
          recordPersistedTerminal(terminalTransition, persisted, fallback)
          return persisted
        }
        if (terminalPromise === claimedPromise) {
          terminalTransition = undefined
          terminalPromise = undefined
        }
        throw error
      }
    })()
    terminalPromise = claimedPromise
    return terminalPromise
  }

  async function begin () {
    if (execution) return execution
    if (beginPromise) return beginPromise

    plan = buildTransferSafetyPlan(getTransfer())
    if (!plan.required) return null

    parentTraceContext = parentTraceContext || createTraceContext({
      module: 'sftp',
      action: 'transfer'
    })
    beginAttempt += 1
    if (beginAttempt > 1) {
      plan = {
        ...plan,
        operationId: `${plan.operationId}-retry-${beginAttempt}`
      }
    }
    traceContext = createTraceContext({
      traceId: parentTraceContext.traceId,
      operationId: plan.operationId,
      module: 'sftp',
      action: 'transfer'
    })
    qualityFinished = false
    plan = {
      ...plan,
      metadata: { traceId: traceContext.traceId }
    }
    recordTransferEvent('started')

    beginPromise = (async () => {
      const capability = getCapability()
      if (!capability ||
        typeof capability.prepareTransferSafetyOperation !== 'function' ||
        typeof capability.beginTransferSafetyOperation !== 'function') {
        throw new Error('当前 SFTP 会话不支持安全传输，已阻止远程写入')
      }
      operationCapability = capability
      operation = await capability.prepareTransferSafetyOperation(plan)
      if (capability.sftpSafetyRunner &&
        operation.metadata?.traceId !== traceContext.traceId) {
        operation = await attachTraceToOperation(operation.id, traceContext)
      }
      const startedExecution = await capability.beginTransferSafetyOperation(operation.id, {
        transferIdentity: plan.transfer.identity,
        cancelExternal: cancelTransport
      })
      const successful = Boolean(
        startedExecution?.executionId &&
        (!startedExecution.state || startedExecution.state === 'executing')
      )
      if (!successful) {
        throw new Error(
          startedExecution?.error ||
          'SFTP 安全事务未能进入执行状态，已阻止远程传输。'
        )
      }
      execution = startedExecution
      return execution
    })()

    try {
      return await beginPromise
    } catch (error) {
      beginPromise = null
      recordTransferEvent('failed', 'failed')
      operation = null
      execution = null
      operationCapability = null
      throw error
    }
  }

  function complete ({ exitCode = 0, cancelled = false } = {}) {
    if (terminalPromise) return terminalPromise
    if (!execution || !operation || !plan?.required) return Promise.resolve(null)

    return claimTerminal('complete', async () => {
      const capability = getCapability() || operationCapability
      if (!capability ||
        typeof capability.completeTransferSafetyOperation !== 'function') {
        throw terminalCapabilityUnavailable(
          'SFTP 安全会话已断开，无法确认传输结果'
        )
      }
      return capability.completeTransferSafetyOperation(operation.id, {
        executionId: execution.executionId,
        effectKey: execution.effectKey || operation.effectKey,
        transferIdentity: plan.transfer.identity,
        exitCode,
        cancelled
      })
    }, { exitCode, cancelled })
  }

  function runCancelTransition () {
    return claimTerminal('cancel', async () => {
      const capability = getCapability() || operationCapability
      if (!capability ||
        typeof capability.cancelTransferSafetyOperation !== 'function') {
        throw terminalCapabilityUnavailable(
          'SFTP 安全会话已断开，无法取消受保护传输'
        )
      }
      return capability.cancelTransferSafetyOperation(operation.id)
    })
  }

  function cancel () {
    if (terminalPromise) return terminalPromise
    if (!execution || !operation || !plan?.required) return Promise.resolve(null)
    return runCancelTransition()
  }

  function dispose () {
    if (terminalPromise) return terminalPromise
    if (settled) return Promise.resolve(null)
    if (!execution && !beginPromise) return Promise.resolve(null)
    return claimTerminal('cancel', async () => {
      if (beginPromise && !execution) {
        try {
          await beginPromise
        } catch (error) {
          return noTerminalResult
        }
      }
      if (!execution || !operation || !plan?.required) return noTerminalResult
      const capability = getCapability() || operationCapability
      if (!capability ||
        typeof capability.cancelTransferSafetyOperation !== 'function') {
        throw terminalCapabilityUnavailable(
          'SFTP 安全会话已断开，无法取消受保护传输'
        )
      }
      return capability.cancelTransferSafetyOperation(operation.id)
    })
  }

  return {
    begin,
    complete,
    cancel,
    dispose,
    get operationId () {
      return operation?.id || plan?.operationId
    },
    get started () {
      return Boolean(execution)
    }
  }
}
