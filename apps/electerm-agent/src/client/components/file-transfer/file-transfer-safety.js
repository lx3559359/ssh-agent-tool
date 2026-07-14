const bypassPolicies = new Set(['skip', 'cancel'])

function stableHash (value) {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(String(value))) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
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
    ? `source:${stableHash(String(transfer.fromPath || ''))}`
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
