export function compactMenuGroups (groups = []) {
  const result = []
  for (const group of groups) {
    const items = Array.isArray(group) ? group.filter(Boolean) : []
    if (!items.length) {
      continue
    }
    if (result.length) {
      result.push({ type: 'divider' })
    }
    result.push(...items)
  }
  return result
}
