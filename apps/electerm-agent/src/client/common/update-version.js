function parseVersion (value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i)
  if (!match) {
    return null
  }
  return match.slice(1, 4).map(n => Number(n))
}

export function compareVersions (left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) {
    return 0
  }

  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) {
      return 1
    }
    if (a[i] < b[i]) {
      return -1
    }
  }
  return 0
}

export function getReleaseUpdate (release, currentVersion) {
  const tagName = release?.tag_name
  if (!tagName) {
    return undefined
  }
  return compareVersions(tagName, currentVersion) > 0
    ? { tag_name: tagName }
    : undefined
}
