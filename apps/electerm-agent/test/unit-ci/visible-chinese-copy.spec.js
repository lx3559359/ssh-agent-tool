const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function readClient (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src/client', relativePath), 'utf8')
}

test('common user-facing copy uses translation while legacy fallback messages remain Chinese', () => {
  const aiConfig = readClient('components/ai/ai-config-modal.jsx')
  const webAuth = readClient('components/web/web-auth-modal.jsx')
  const terminalLog = readClient('components/terminal/save-terminal-log.js')
  const xmodem = readClient('components/terminal/xmodem-client.js')
  const trzsz = readClient('components/terminal/trzsz-client.js')

  assert.doesNotMatch(aiConfig, /'Saved'/)
  assert.match(aiConfig, /message\.success\(e\('saved'\)\)/)
  assert.match(aiConfig, /title=\{e\('shellpilotAiConfigTitle'\)\}/)
  assert.doesNotMatch(webAuth, />\s*Cancel\s*</)
  assert.match(webAuth, /\{e\('cancel'\)\}/)
  assert.doesNotMatch(terminalLog, /Failed to (?:start|stop|write)/)
  assert.match(xmodem, /XMODEM 错误/)
  assert.match(trzsz, /TRZSZ 错误/)
  assert.match(trzsz, /已保存/)
})

test('diagnostic export uses the ShellPilot product name', () => {
  const source = readClient('components/sidebar/info-modal.jsx')

  assert.match(source, /ShellPilot-diagnostic-/)
  assert.match(source, /shellpilotDiagnosticPackFilter/)
  assert.doesNotMatch(source, /AIGShell-diagnostic-/)
})
