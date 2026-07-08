import {
  parseQuickConnect
} from '../../common/parse-quick-connect.js'

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

function titleFor (opts) {
  if (opts.username) {
    return `${opts.username}@${opts.host}`
  }
  return opts.host
}

export function buildQuickConnectOptions (values) {
  const protocol = clean(values.protocol) || 'ssh'
  const host = clean(values.host)
  const port = clean(values.port)
  const username = clean(values.username)
  const password = values.password || ''
  const auth = username
    ? `${encodeURIComponent(username)}${password ? ':' + encodeURIComponent(password) : ''}@`
    : ''
  const url = `${protocol}://${auth}${host}${port ? ':' + port : ''}`
  const opts = parseQuickConnect(url)
  if (!opts) {
    return null
  }
  if (protocol === 'ssh') {
    opts.authType = 'password'
  }
  opts.title = titleFor(opts)
  return opts
}
