function stableValue (value) {
  return JSON.stringify(value ?? null)
}

function clonePlainValue (value) {
  if (Array.isArray(value)) {
    return value.map(item => clonePlainValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clonePlainValue(item)])
    )
  }
  return value
}

function stablePlanValue (plan) {
  return stableValue({
    descriptor: plan?.descriptor ?? null,
    skipped: plan?.skipped ?? null
  })
}

export function resolveLocalTransferSourcePlan (transfer = {}, sourcePlan = null) {
  if (sourcePlan) return sourcePlan
  if (transfer?.sourcePlan) return transfer.sourcePlan
  if (transfer?.sourceDescriptor) {
    return {
      descriptor: transfer.sourceDescriptor,
      skipped: []
    }
  }
  return null
}

export function bindRuntimeLocalTransferPlan (transfer = {}, sourcePlan = null) {
  const descriptorEnumerable = Object.prototype.propertyIsEnumerable.call(
    transfer,
    'sourceDescriptor'
  )
  const boundSourcePlan = sourcePlan || null
  Object.defineProperty(transfer, 'sourcePlan', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: boundSourcePlan
  })
  Object.defineProperty(transfer, 'sourceDescriptor', {
    configurable: true,
    enumerable: descriptorEnumerable,
    writable: true,
    value: boundSourcePlan?.descriptor || null
  })
  return boundSourcePlan
}

export function withRuntimeLocalTransferDescriptor (transfer = {}, descriptor) {
  if (!descriptor || transfer.sourceDescriptor) return transfer
  return {
    ...transfer,
    sourceDescriptor: descriptor
  }
}

export function assertSameLocalTransferPlan (expected, actual) {
  if (stablePlanValue(expected) !== stablePlanValue(actual)) {
    throw new Error('本地上传源在传输期间发生变化，远程目标可执行回滚。')
  }
  return true
}

export function filterPlannedDirectoryEntries (liveEntries = [], descriptor) {
  if (descriptor?.type !== 'directory' || !Array.isArray(descriptor.entries)) {
    throw new Error('本地上传目录缺少已验证的描述树。')
  }
  const allowed = new Map(
    descriptor.entries.map(item => [item.name, item.entry])
  )
  return liveEntries
    .filter(item => allowed.has(item?.name))
    .map(item => ({
      ...item,
      sourceDescriptor: clonePlainValue(allowed.get(item.name))
    }))
}
