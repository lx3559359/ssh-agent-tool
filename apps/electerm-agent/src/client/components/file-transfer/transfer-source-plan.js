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
