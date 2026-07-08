const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readFile (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8')
}

function assertEvidence (source, pattern, label) {
  assert.match(source, pattern, `Missing terminal experience evidence: ${label}`)
}

test('终端基础体验矩阵覆盖常规客户端操作', () => {
  const ssh = readFile('session-ssh.spec.js')
  const shortcuts = readFile('terminal-shortcut-handler.spec.js')
  const contextMenu = readFile('terminal-context-menu.spec.js')
  const resize = readFile('terminal-resize-size.spec.js')
  const control = readFile('terminal-control-message.spec.js')
  const search = readFile('terminal-search-behavior.spec.js')
  const terminalSource = readFile('../../src/client/components/terminal/terminal.jsx')
  const all = [
    ssh,
    shortcuts,
    contextMenu,
    resize,
    control,
    search,
    terminalSource
  ].join('\n')

  assertEvidence(ssh, /forwards normal shell input and ctrl-c/, 'enter and ctrl-c are forwarded')
  assertEvidence(ssh, /forwards interactive control keys and resize events/, 'arrow keys ctrl-l ctrl-d and resize')
  assertEvidence(ssh, /encodes terminal input with the configured ssh session encoding/, 'terminal encoding')
  assertEvidence(shortcuts, /terminal Ctrl\+C without selection is passed through/, 'ctrl-c shortcut policy')
  assertEvidence(shortcuts, /terminal Ctrl\+L is reserved for remote shell clear screen/, 'ctrl-l shortcut policy')
  assertEvidence(contextMenu, /onCopy[\s\S]*onPaste[\s\S]*onPasteSelected[\s\S]*onSelectAll/, 'copy paste selected text and select all menu')
  assertEvidence(contextMenu, /onClear[\s\S]*onZoomInTerminal[\s\S]*onZoomOutTerminal[\s\S]*onResetTerminalFontSize/, 'clear and font size menu')
  assertEvidence(contextMenu, /toggleSearch[\s\S]*onSaveTerminalLog/, 'search and save log menu')
  assertEvidence(contextMenu, /onReconnect[\s\S]*onDisconnect/, 'reconnect and disconnect menu')
  assertEvidence(search, /toggleSearch clears active decorations before closing/, 'search close clears highlights')
  assertEvidence(search, /search previous and next route to active terminal/, 'search previous next routing')
  assertEvidence(search, /Enter triggers next search/, 'search enter key')
  assertEvidence(resize, /normalizes terminal resize dimensions/, 'safe resize dimensions')
  assertEvidence(control, /treats user pasted json as regular terminal input/, 'pasted json is not swallowed as control')
  assertEvidence(all, /copySelectionToClipboard[\s\S]*term\.getSelection/, 'selected text copy')
  assertEvidence(all, /onPaste\s*=\s*async[\s\S]*term\.paste/, 'clipboard paste')
})
