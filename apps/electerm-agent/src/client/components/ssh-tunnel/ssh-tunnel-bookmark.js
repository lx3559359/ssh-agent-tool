const tunnelTypes = new Set([
  'forwardLocalToRemote',
  'forwardRemoteToLocal',
  'dynamicForward'
])

const legacyTunnelFields = [
  'sshTunnel',
  'sshTunnelLocalHost',
  'sshTunnelLocalPort',
  'sshTunnelRemoteHost',
  'sshTunnelRemotePort',
  'autoStart',
  'name'
]

function legacyTunnelFromBookmark (bookmark = {}) {
  if (!tunnelTypes.has(bookmark.sshTunnel)) {
    return null
  }
  const tunnel = {
    id: `legacy-${bookmark.id || 'ssh-tunnel'}`
  }
  for (const field of legacyTunnelFields) {
    if (bookmark[field] !== undefined) {
      tunnel[field] = bookmark[field]
    }
  }
  return tunnel
}

export function getBookmarkTunnels (bookmark = {}) {
  if (Array.isArray(bookmark.sshTunnels)) {
    return bookmark.sshTunnels
      .filter(item => item && tunnelTypes.has(item.sshTunnel))
      .map(item => ({ ...item }))
  }
  const legacyTunnel = legacyTunnelFromBookmark(bookmark)
  return legacyTunnel ? [legacyTunnel] : []
}

export function upsertBookmarkTunnel (bookmark = {}, tunnel = {}) {
  const current = getBookmarkTunnels(bookmark)
  const index = current.findIndex(item => item.id === tunnel.id)
  const sshTunnels = index < 0
    ? [...current, { ...tunnel }]
    : current.map((item, itemIndex) => (
      itemIndex === index ? { ...tunnel } : item
    ))
  return {
    ...bookmark,
    sshTunnels
  }
}

export function removeBookmarkTunnel (bookmark = {}, tunnelId) {
  return {
    ...bookmark,
    sshTunnels: getBookmarkTunnels(bookmark)
      .filter(item => item.id !== tunnelId)
  }
}

export function getAutoStartTunnels (bookmark = {}) {
  return getBookmarkTunnels(bookmark).filter(tunnel => (
    tunnel.autoStart !== false &&
    tunnelTypes.has(tunnel.sshTunnel) &&
    Number(tunnel.sshTunnelLocalPort) > 0
  ))
}

export function findBookmarkForTab (bookmarks = [], tab = {}) {
  if (tab.from !== 'bookmarks' || !tab.srcId) {
    return null
  }
  return bookmarks.find(item => item.id === tab.srcId) || null
}
