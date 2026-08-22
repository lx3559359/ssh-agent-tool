function stableValue (value) {
  return JSON.stringify(value ?? null)
}

function stablePlanValue (plan) {
  return stableValue({
    descriptor: plan?.descriptor ?? null,
    skipped: plan?.skipped ?? null
  })
}

export function assertSameLocalTransferPlan (expected, actual) {
  if (stablePlanValue(expected) !== stablePlanValue(actual)) {
    throw new Error('本地上传源计划在传输期间发生变化，远程目标可执行回滚。')
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
      sourceDescriptor: allowed.get(item.name)
    }))
}
