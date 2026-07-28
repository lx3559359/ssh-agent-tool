import { statusMap } from '../../common/constants'
import { refs } from '../common/ref'
import {
  listSshTunnels,
  startSshTunnel,
  stopSshTunnel,
  testSshTunnel
} from '../terminal/terminal-apis.js'
import {
  sshTunnelOperationTaskTracker
} from './ssh-tunnel-operation-task.js'

function trackTunnel (promise) {
  return Promise.resolve(promise).catch(error => {
    console.warn('SSH tunnel task history update failed:', error)
  })
}

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
  await trackTunnel(sshTunnelOperationTaskTracker.sync(session, tunnels))
  return {
    session,
    tunnels: Array.isArray(tunnels) ? tunnels : []
  }
}

export async function startSshTunnelRuntime (store, tab, tunnel) {
  const session = requireSession(store, tab)
  const started = await startSshTunnel(session.pid, tunnel)
  await trackTunnel(sshTunnelOperationTaskTracker.sync(session, [started]))
  return started
}

export async function stopSshTunnelRuntime (store, tab, tunnelId) {
  const session = requireSession(store, tab)
  const tunnels = await listSshTunnels(session.pid)
  const existing = (Array.isArray(tunnels) ? tunnels : [])
    .find(entry => entry.id === tunnelId)
  const stopped = await stopSshTunnel(session.pid, tunnelId)
  if (existing) {
    await trackTunnel(sshTunnelOperationTaskTracker.stopped(session, {
      ...existing,
      state: 'stopped',
      events: [
        ...(Array.isArray(existing.events) ? existing.events : []),
        {
          at: Date.now(),
          state: 'stopped',
          code: 'SSH_TUNNEL_STOPPED',
          message: 'SSH 隧道已手动停止'
        }
      ]
    }))
  }
  return stopped
}

export async function testSshTunnelRuntime (store, tab, tunnelId) {
  const session = requireSession(store, tab)
  const result = await testSshTunnel(session.pid, tunnelId)
  const tunnels = await listSshTunnels(session.pid)
  await trackTunnel(sshTunnelOperationTaskTracker.sync(session, tunnels))
  return result
}
