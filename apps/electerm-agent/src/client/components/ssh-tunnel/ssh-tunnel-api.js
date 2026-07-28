import { statusMap } from '../../common/constants'
import { refs } from '../common/ref'
import {
  listSshTunnels,
  startSshTunnel,
  stopSshTunnel,
  testSshTunnel
} from '../terminal/terminal-apis.js'

function endpointUser (tab = {}) {
  return tab.username || tab.user || ''
}

function endpointsMatch (left = {}, right = {}) {
  return Boolean(
    left.host &&
    endpointUser(left) &&
    left.host === right.host &&
    Number(left.port || 22) === Number(right.port || 22) &&
    endpointUser(left) === endpointUser(right)
  )
}

export function resolveSshTunnelSession (
  store = window.store,
  explicitTab
) {
  const tab = explicitTab ||
    store?.tabs?.find(item => item.id === store.activeTabId) ||
    store?.currentTab ||
    {}
  const terminal = tab.id ? refs.get('term-' + tab.id) : null
  const connected = Boolean(
    terminal?.pid &&
    terminal.isSsh?.() === true &&
    tab.status === statusMap.success &&
    endpointsMatch(tab, terminal.props?.tab || {})
  )
  return {
    connected,
    tabId: tab.id || '',
    pid: connected ? terminal.pid : '',
    host: tab.host || '',
    port: Number(tab.port || 22),
    username: endpointUser(tab),
    title: tab.title || tab.name || tab.host || '未连接'
  }
}

function requireSession (store, tab) {
  const session = resolveSshTunnelSession(store, tab)
  if (!session.connected) {
    throw new Error('请先连接 SSH 服务器')
  }
  return session
}

export async function loadSshTunnelRuntime (store, tab) {
  const session = resolveSshTunnelSession(store, tab)
  if (!session.connected) {
    return { session, tunnels: [] }
  }
  const tunnels = await listSshTunnels(session.pid)
  return {
    session,
    tunnels: Array.isArray(tunnels) ? tunnels : []
  }
}

export async function startSshTunnelRuntime (store, tab, tunnel) {
  const session = requireSession(store, tab)
  return startSshTunnel(session.pid, tunnel)
}

export async function stopSshTunnelRuntime (store, tab, tunnelId) {
  const session = requireSession(store, tab)
  return stopSshTunnel(session.pid, tunnelId)
}

export async function testSshTunnelRuntime (store, tab, tunnelId) {
  const session = requireSession(store, tab)
  return testSshTunnel(session.pid, tunnelId)
}
