const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')

function source (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('top bar exposes a lazy-loaded SSH tunnel manager', () => {
  const topbar = source('src/client/components/main/aigshell-topbar.jsx')

  assert.match(topbar, /lazy\(\(\) => import\('\.\.\/ssh-tunnel\/ssh-tunnel-modal'\)\)/)
  assert.match(topbar, /key: 'sshTunnel'/)
  assert.match(topbar, /label: e\('shellpilotTopbarSshTunnel'\)/)
  assert.match(topbar, /<SshTunnelModal/)
})

test('SSH tunnel manager covers three tunnel types and common templates', () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  const definition = source('src/client/components/ssh-tunnel/ssh-tunnel-definition.js')
  const translations = source('src/client/common/shellpilot-i18n-overrides.js')
  const combined = `${modal}\n${definition}\n${translations}`

  for (const label of [
    '本地转发',
    '远程转发',
    'SOCKS5 动态代理',
    'HTTP',
    'HTTPS',
    'MySQL',
    'PostgreSQL',
    'Redis'
  ]) {
    assert.match(combined, new RegExp(label))
  }
  assert.match(modal, /shellpilotTunnelConnectToStart/)
  assert.match(modal, /shellpilotTunnelCopyDescription/)
  assert.match(modal, /shellpilotTunnelEditAndRestart/)
  assert.match(modal, /shellpilotTunnelStop/)
})

test('SSH tunnel manager calls the native session API without terminal command injection', () => {
  const api = source('src/client/components/ssh-tunnel/ssh-tunnel-api.js')
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  const combined = `${api}\n${modal}`

  for (const apiName of [
    'startSshTunnel',
    'stopSshTunnel',
    'listSshTunnels',
    'testSshTunnel'
  ]) {
    assert.match(api, new RegExp(apiName))
  }
  assert.match(api, /refs\.get\('term-' \+ tab\.id\)/)
  assert.doesNotMatch(combined, /\bssh\s+-(?:L|R|D)\b/)
  assert.doesNotMatch(combined, /\.write\(|sendText|runCmd/)
})

test('SSH tunnel manager remains usable on narrow desktop windows', () => {
  const styles = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.styl')

  assert.match(styles, /@media \(max-width: 1100px\)/)
  assert.match(styles, /grid-template-columns 1fr/)
  assert.match(styles, /overflow-y auto/)
})

test('SSH tunnel manager persists profiles to the active server bookmark', () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  const translations = source('src/client/common/shellpilot-i18n-overrides.js')

  assert.match(modal, /findBookmarkForTab/)
  assert.match(modal, /upsertBookmarkTunnel/)
  assert.match(modal, /removeBookmarkTunnel/)
  assert.match(modal, /store\.editItem\(currentBookmark\.id/)
  assert.match(modal, /shellpilotTunnelSavedProfiles/)
  assert.match(modal, /shellpilotTunnelAutoStartNext/)
  assert.match(translations, /shellpilotTunnelSavedProfiles: '已保存的隧道配置'/)
  assert.match(translations, /shellpilotTunnelAutoStartNext: '下次连接自动启动'/)
})

test('SSH tunnel validation messages and flow previews are readable Chinese', () => {
  const definition = source('src/client/components/ssh-tunnel/ssh-tunnel-definition.js')

  assert.match(definition, /端口必须是 1 到 65535 之间的整数/)
  assert.match(definition, /不支持的 SSH 隧道类型/)
  assert.match(definition, /仅监听回环地址/)
  assert.match(definition, /本机 .*SSH 服务器/)
})

test('help center explains tunnel lifecycle, safety and common failures', () => {
  const help = source('src/client/components/main/help-center-modal.jsx')
  const translations = source('src/client/common/shellpilot-i18n-overrides.js')

  for (const text of [
    '本地转发',
    '远程转发',
    'SOCKS5',
    '自动启动',
    'SSH 断开',
    'EADDRINUSE',
    'administratively prohibited',
    '目标服务拒绝连接'
  ]) {
    assert.match(help, new RegExp(text))
  }
  assert.match(translations, /shellpilotHelpForwarding: 'SSH 隧道'/)
})

test('SSH tunnel manager offers an explicit suggested port without auto-starting it', () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  const translations = source('src/client/common/shellpilot-i18n-overrides.js')

  assert.match(modal, /portConflict/)
  assert.match(modal, /SSH_TUNNEL_PORT_IN_USE/)
  assert.match(modal, /suggestedPort/)
  assert.match(modal, /shellpilotTunnelUseSuggestedPort/)
  assert.doesNotMatch(modal, /startSshTunnelRuntime\([^)]*suggestedPort/)
  assert.match(translations, /shellpilotTunnelPortConflict:/)
  assert.match(translations, /shellpilotTunnelUseSuggestedPort:/)
})

test('SSH tunnel manager shows health states and bounded disconnect history', () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  const styles = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.styl')
  const translations = source('src/client/common/shellpilot-i18n-overrides.js')

  assert.match(modal, /tunnelHealthPresentation/)
  assert.match(modal, /shellpilotTunnelDisconnectHistory/)
  assert.match(modal, /entry\.events/)
  assert.match(modal, /showDisconnectHistory/)
  assert.match(styles, /\.ssh-tunnel-history-list/)
  assert.match(translations, /shellpilotTunnelHealthHealthy: '健康'/)
  assert.match(translations, /shellpilotTunnelHealthReconnecting: '重连中'/)
  assert.match(translations, /shellpilotTunnelDisconnectHistory: '断线记录'/)
})

test('SSH tunnel manager surfaces the latest actionable runtime failure', () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')

  assert.match(modal, /latestTunnelFailure/)
  assert.match(modal, /ssh-tunnel-runtime-failure/)
  assert.match(modal, /latestFailure\.message/)
})
