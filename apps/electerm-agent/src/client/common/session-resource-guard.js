function resourceTabId (resource = {}) {
  return String(
    resource.tabId ||
    resource.fromFile?.tabId ||
    resource.toFile?.tabId ||
    ''
  )
}

export function assertSessionResourceTabId (resource, expectedTabId) {
  const expected = String(expectedTabId || '')
  const actual = resourceTabId(resource)
  if (!expected || !actual || actual !== expected) {
    const error = new Error('Agent resource does not belong to the active SSH session')
    error.code = 'AI_SESSION_RESOURCE_MISMATCH'
    throw error
  }
  return true
}

export function filterSessionResourcesByTabId (resources, expectedTabId) {
  const expected = String(expectedTabId || '')
  if (!expected || !Array.isArray(resources)) return []
  return resources.filter(resource => resourceTabId(resource) === expected)
}
