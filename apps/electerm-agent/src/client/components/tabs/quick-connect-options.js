import {
  parseQuickConnect
} from '../../common/parse-quick-connect.js'
import uid from '../../common/uid.js'

export const QUICK_CONNECT_PROTOCOLS = [
  { value: 'ssh', label: 'SSH', port: 22 },
  { value: 'rdp', label: 'RDP', port: 3389 },
  { value: 'vnc', label: 'VNC', port: 5900 },
  { value: 'telnet', label: 'Telnet', port: 23 }
]

export const QUICK_CONNECT_DEFAULT_PORTS = QUICK_CONNECT_PROTOCOLS.reduce((prev, item) => {
  prev[item.value] = item.port
  return prev
}, {})

function clean (value) {
  return (value || '').trim()
}

function isValidPort (port) {
  if (!port) {
    return true
  }
  if (!/^\d+$/.test(port)) {
    return false
  }
  const value = Number(port)
  return value >= 1 && value <= 65535
}

function titleFor (opts) {
  if (opts.username) {
    return `${opts.username}@${opts.host}`
  }
  return opts.host
}

function applySshAuth (opts, values) {
  const authType = clean(values.authType) || 'password'
  opts.authType = authType
  if (authType === 'privateKey') {
    delete opts.password
    opts.privateKey = values.privateKey || ''
    opts.passphrase = values.passphrase || ''
    return
  }
  if (authType === 'profiles') {
    delete opts.password
    opts.profile = clean(values.profile)
    return
  }
  opts.authType = 'password'
}

export function buildQuickConnectOptions (values) {
  const protocol = clean(values.protocol) || 'ssh'
  const host = clean(values.host)
  const port = clean(values.port)
  const username = clean(values.username)
  const password = values.password || ''
  if (!isValidPort(port)) {
    return null
  }
  const auth = username
    ? `${encodeURIComponent(username)}${password ? ':' + encodeURIComponent(password) : ''}@`
    : ''
  const url = `${protocol}://${auth}${host}${port ? ':' + port : ''}`
  const opts = parseQuickConnect(url)
  if (!opts) {
    return null
  }
  if (protocol === 'ssh') {
    applySshAuth(opts, values)
  }
  opts.title = clean(values.title) || titleFor(opts)
  return opts
}

export function buildQuickConnectBookmark (opts, options = {}) {
  const {
    from,
    batch,
    status,
    tabCount,
    saveAsBookmark,
    ...bookmark
  } = opts
  return {
    ...bookmark,
    id: options.id || `bookmark:${Date.now()}:${uid()}`,
    title: clean(bookmark.title) || titleFor(bookmark)
  }
}
