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

test('runtime guidance card derives truthful availability and safe access actions', () => {
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')

  assert.match(card, /import \{ getTunnelUsage \} from '\.\/ssh-tunnel-usage\.js'/)
  assert.match(card, /import \{ getTunnelDiagnostic \} from '\.\/ssh-tunnel-diagnostics\.js'/)
  assert.match(card, /import \{ copy \} from '\.\.\/\.\.\/common\/clipboard'/)
  assert.match(card, /export default function SshTunnelRuntimeCard \(\{\s*entry,\s*busy,\s*onTest,\s*onEdit,\s*onEditAndRestart,\s*onStop,\s*onOpenGuide,\s*onShowHistory\s*\}\)/)
  assert.match(card, /const usage = getTunnelUsage\(entry\?\.definition \|\| \{\}\)/)
  assert.match(card, /const diagnostic = latestFailure\s*\? getTunnelDiagnostic\(latestFailure, entry\?\.definition\)\s*: null/)
  assert.match(card, /failureStates\.has\(entry\?\.state\)[\s\S]*?entry\?\.testState === 'checking'[\s\S]*?entry\?\.lastTest\?\.verdict \|\| 'unverified'/)
  assert.match(card, /usage\.canOpen === true && usage\.url &&\s*typeof window\?\.openLink === 'function'/)
  assert.match(card, /window\.openLink\(usage\.url\)/)
  assert.match(card, /disabled=\{!usage\.endpoint\}/)
  assert.match(card, /data-stage=\{stage\.id\}/)
  for (const status of ['passed', 'limited', 'failed', 'unverified']) {
    assert.match(card, new RegExp(`${status}: \\{ icon:`))
  }
  assert.doesNotMatch(card, /lastTest\.stages\.map/)
})

test('runtime guidance keeps diagnostics separate and callbacks defensive', () => {
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')

  assert.match(card, /className='ssh-tunnel-diagnostic-checks'/)
  assert.match(card, /className='ssh-tunnel-diagnostic-config'/)
  assert.match(card, /copy\(diagnostic\.checksText\)/)
  assert.match(card, /copy\(diagnostic\.configExample\)/)
  assert.doesNotMatch(card, /checksText\s*\+|configExample\s*\+/)
  assert.match(card, /onOpenGuide\?\.\(diagnostic\.helpSection\)/)
  for (const callback of [
    'onTest',
    'onEdit',
    'onEditAndRestart',
    'onStop',
    'onShowHistory'
  ]) {
    assert.match(card, new RegExp(`${callback}\\?\\.\\(`))
  }
  assert.doesNotMatch(card, /\.write\(|sendText|runCmd/)
})

test('beginner guide has seven synchronized sections and safe error mapping', () => {
  const guide = source('src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx')

  assert.match(guide, /import \{ Modal \} from 'antd'/)
  assert.match(guide, /export default function SshTunnelGuideModal \(\{\s*open,\s*activeSection = 'choose-type',\s*context = \{\},\s*onClose\s*\}\)/)
  const sectionIds = [
    'choose-type',
    'local-forward',
    'how-to-access',
    'socks-browser',
    'remote-safety',
    'errors',
    'glossary'
  ]
  for (const id of sectionIds) {
    assert.match(guide, new RegExp(`id: '${id}'`))
  }
  assert.equal((guide.match(/id: '(?:choose-type|local-forward|how-to-access|socks-browser|remote-safety|errors|glossary)'/g) || []).length, 7)
  assert.match(guide, /const errorHelpSections = new Set\(\[/)
  assert.match(guide, /errorHelpSections\.has\(section\) \? 'errors' : 'choose-type'/)
  assert.match(guide, /useEffect\(\(\) => \{\s*if \(open\) setSection\(normalizeSection\(activeSection\)\)\s*\}, \[activeSection, open\]\)/)
  assert.match(guide, /aria-current=\{section === item\.id \? 'page' : undefined\}/)
  assert.match(guide, /127\.0\.0\.1:16060[\s\S]*SSH[\s\S]*server 127\.0\.0\.1:6060/)
  assert.doesNotMatch(guide, /\.write\(|sendText|runCmd|window\.openLink/)
})

test('beginner guide uses the planned localized content contract', () => {
  const guide = source('src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx')
  const requiredKeys = [
    'shellpilotTunnelGuideChooseType',
    'shellpilotTunnelGuideLocalScenario',
    'shellpilotTunnelGuideHowToAccess',
    'shellpilotTunnelGuideSocksBrowser',
    'shellpilotTunnelGuideRemoteSafety',
    'shellpilotTunnelGuideErrors',
    'shellpilotTunnelGuideGlossary'
  ]

  for (const key of requiredKeys) {
    assert.match(guide, new RegExp(`e\\('${key}'\\)`))
  }
  assert.match(guide, /shellpilotTunnelGuideNoBrowserProxy/)
  assert.match(guide, /shellpilotTunnelGuideSocksNoSystemProxy/)
  assert.match(guide, /shellpilotTunnelGuideGatewayPorts/)
})

test('runtime guidance styles match the approved hierarchy responsively', () => {
  const styles = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.styl')

  assert.match(styles, /\.ssh-tunnel-access-panel[\s\S]*background rgba\(22, 119, 255, \.07\)[\s\S]*border 1px solid rgba\(22, 119, 255, \.24\)/)
  assert.match(styles, /\.ssh-tunnel-stage-grid[\s\S]*grid-template-columns repeat\(3, minmax\(0, 1fr\)\)/)
  for (const modifier of ['passed', 'limited', 'failed', 'unverified']) {
    assert.match(styles, new RegExp(`\\.ssh-tunnel-stage--${modifier}`))
  }
  assert.match(styles, /\.ssh-tunnel-diagnostic-split[\s\S]*grid-template-columns repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(styles, /\.ssh-tunnel-guide-layout[\s\S]*grid-template-columns 220px minmax\(0, 1fr\)/)
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.ssh-tunnel-guide-layout[\s\S]*grid-template-columns 1fr/)
  assert.match(styles, /overflow-wrap anywhere/)
  assert.doesNotMatch(styles, /gradient\(/)
  assert.doesNotMatch(styles, /max-height min\(/)
})
