const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const clientRoot = path.resolve(__dirname, '../../src/client')

function readClient (relativePath) {
  return fs.readFileSync(path.join(clientRoot, relativePath), 'utf8')
}

test('top-bar actions retain order while adding presentation-only groups', () => {
  const topbar = readClient('components/main/aigshell-topbar.jsx')
  const actions = topbar.match(/const actions = \[([\s\S]*?)\n {2}\]/)?.[1] || ''

  assert.deepEqual(
    [...actions.matchAll(/key: '([^']+)'/g)].map(match => match[1]),
    [
      'serverStatus', 'new', 'quick', 'quickCommands', 'sshTunnel', 'ai',
      'model', 'backup', 'connections', 'safetyCenter', 'update', 'theme',
      'setting', 'help'
    ]
  )
  assert.deepEqual(
    [...actions.matchAll(/group: '([^']+)'/g)].map(match => match[1]),
    [
      'connection', 'connection', 'connection',
      'work', 'work', 'work', 'work',
      'manage', 'manage', 'manage',
      'system', 'system', 'system', 'system'
    ]
  )
  assert.match(topbar, /data-action-group=\{item\.group\}/)
  assert.match(topbar, /aigshell-topbar-action-group-boundary/)
  assert.match(topbar, /className='aigshell-topbar-status-text'/)
  assert.match(topbar, /className='aigshell-topbar-current' title=\{title\}/)
})

test('window controls are named native buttons with unchanged callbacks', () => {
  const source = readClient('components/tabs/window-control.jsx')

  assert.equal((source.match(/<button\b/g) || []).length, 3)
  assert.equal((source.match(/type='button'/g) || []).length, 3)
  assert.match(source, /aria-label=\{e\('minimize'\)\}/)
  assert.match(source, /aria-label=\{e\(isMaximized \? 'unmaximize' : 'maximize'\)\}/)
  assert.match(source, /aria-label=\{e\('close'\)\}/)
  assert.match(source, /onClick=\{minimize\}/)
  assert.match(source, /isMaximized \? unmaximize : maximize/)
  assert.match(source, /onClick=\{closeApp\}/)
  assert.match(source, /runGlobalAsync\('minimize'\)/)
  assert.match(source, /runGlobalAsync\('maximize'\)/)
  assert.match(source, /runGlobalAsync\('unmaximize'\)/)
  assert.match(source, /window\.store\.exit\(\)/)
})

test('shared styles distinguish focus, reduced motion, nested depth, and toast placement', () => {
  const basic = readClient('css/basic.styl')
  const secondary = readClient('css/includes/secondary-ui.styl')
  const message = readClient('components/common/message.styl')
  const notification = readClient('components/common/notification.styl')
  const topbar = readClient('components/main/aigshell-topbar.styl')

  for (const selector of [
    'button:focus-visible',
    'a:focus-visible',
    "[role='tab']:focus-visible",
    "[role='option']:focus-visible",
    '.window-control-box:focus-visible'
  ]) {
    assert.ok(basic.includes(selector), `${selector} must share the focus treatment`)
  }
  assert.match(basic, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition none !important[\s\S]*animation none !important/)
  assert.match(secondary, /\.sp-card \.sp-card[\s\S]*box-shadow none/)
  assert.match(message, /\.message-container[\s\S]{0,120}top 52px/)
  assert.match(notification, /\.notification-container[\s\S]{0,160}top 52px/)
  assert.match(topbar, /\.aigshell-topbar-action-group-boundary[\s\S]*border-left/)
})

test('semantic UI tokens do not leak onto the terminal canvas', () => {
  const files = [
    'css/basic.styl',
    'css/includes/theme.styl',
    'css/includes/secondary-ui.styl',
    'components/main/aigshell-topbar.styl'
  ]
  const source = files.map(readClient).join('\n')
  const protectedTerminalTokens = /\.(?:xterm|xterm-screen|xterm-viewport)[^{\n]*\{?[\s\S]{0,180}--sp-(?:ui-font|radius|shadow|focus)/i

  assert.doesNotMatch(source, protectedTerminalTokens)
})

test('status backgrounds and focus offset come from shared theme tokens', () => {
  const source = readClient('common/ui-theme-tokens.js')

  assert.match(source, /successSoft: mix\(success, surface,/)
  assert.match(source, /infoSoft: mix\(info, surface,/)
  assert.match(source, /warningSoft: mix\(warning, surface,/)
  assert.match(source, /dangerSoft: mix\(danger, surface,/)
  assert.match(source, /focusOffset: '2px'/)
})
