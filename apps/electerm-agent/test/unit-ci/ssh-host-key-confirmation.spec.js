const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '../..')

test('SSH host key confirmation exposes structured details and copy actions', () => {
  const source = fs.readFileSync(path.join(
    projectRoot,
    'src/client/components/terminal/ssh-host-key-confirmation.jsx'
  ), 'utf8')

  assert.match(source, /details/)
  assert.match(source, /copyToClipboard\(details\.fingerprint\)/)
  assert.match(source, /copyToClipboard\(details\.knownHostsPath\)/)
  assert.match(source, /shellpilotCopyHostFingerprint/)
  assert.match(source, /shellpilotCopyKnownHostsPath/)
  assert.match(source, /shellpilotHostKeyChangedWarning/)
  assert.match(source, /<dl>/)
})

test('SSH host key dialog rejects by default and keeps trust explicit', () => {
  const source = fs.readFileSync(path.join(
    projectRoot,
    'src/client/components/terminal/terminal-interactive-ui.jsx'
  ), 'utf8')
  const cancelAt = source.indexOf("className='terminal-interactive-cancel'")
  const confirmAt = source.indexOf("className='terminal-interactive-confirm'")

  assert.match(source, /SshHostKeyConfirmation/)
  assert.ok(cancelAt > -1)
  assert.ok(confirmAt > cancelAt)
  assert.match(source, /keyboardConfirm=\{false\}/)
  assert.match(source, /initialFocusSelector='\.terminal-interactive-cancel'/)
})

test('SSH host key details wrap long paths without horizontal overflow', () => {
  const source = fs.readFileSync(path.join(
    projectRoot,
    'src/client/components/terminal/ssh-host-key-confirmation.styl'
  ), 'utf8')

  assert.match(source, /overflow-wrap anywhere/)
  assert.match(source, /min-width 0/)
  assert.doesNotMatch(source, /overflow-x auto/)
})
