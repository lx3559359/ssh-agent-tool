const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readTestFile (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8')
}

function readClientFile (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src/client', relativePath), 'utf8')
}

function assertEvidence (source, pattern, label) {
  assert.match(source, pattern, `Missing SSH connection flow evidence: ${label}`)
}

test('SSH connection lifecycle matrix covers create save auth timeout and reconnect', () => {
  const bookmarkFlow = readTestFile('bookmark-management-flow.spec.js')
  const serverManagement = readTestFile('server-management-matrix.spec.js')
  const feedback = readTestFile('ssh-connection-feedback-localization.spec.js')
  const sshPasswordFirst = readTestFile('session-ssh-password-first.spec.js')
  const ssh = readTestFile('session-ssh.spec.js')
  const sshAgent = readTestFile('session-ssh-agent.spec.js')
  const sshErrors = readTestFile('session-ssh-errors.spec.js')
  const reconnectPolicy = readTestFile('ssh-reconnect-policy.spec.js')
  const formRenderer = readClientFile('components/bookmark-form/form-renderer.jsx')
  const terminal = readClientFile('components/terminal/terminal.jsx')

  assertEvidence(bookmarkFlow, /handleNewBookmark/, 'new connection entry')
  assertEvidence(formRenderer, /action\.current = 'save'/, 'save connection action')
  assertEvidence(formRenderer, /addItem\(obj,\s*settingMap\.bookmarks\)/, 'new connection persistence')
  assertEvidence(formRenderer, /editItem\(obj\.id,\s*tar,\s*settingMap\.bookmarks\)/, 'edited connection persistence')
  assertEvidence(serverManagement, /addSshConfigs/, 'batch SSH config import')
  assertEvidence(sshPasswordFirst, /password auth works|password auth is tried before publickey/, 'password authentication')
  assertEvidence(ssh, /connects with an rsa key protected by a passphrase/, 'RSA private key authentication')
  assertEvidence(ssh, /connects with an ed25519 key protected by a passphrase/, 'ED25519 private key authentication')
  assertEvidence(sshAgent, /SSH agent auth|ssh agent/i, 'SSH Agent authentication')
  assertEvidence(ssh, /rejects wrong password with a normalized authentication error/, 'wrong-password feedback')
  assertEvidence(ssh, /rejects a silent tcp endpoint with a normalized handshake timeout/, 'timeout feedback')
  assertEvidence(sshErrors, /adds the configured ssh timeout seconds to timeout diagnostics/, 'timeout diagnostics')
  assertEvidence(sshErrors, /redacts inline secrets from ssh connection diagnostics/, 'diagnostic redaction')
  assertEvidence(ssh, /emits close when an established ssh session is disconnected by the server/, 'remote disconnect')
  assertEvidence(reconnectPolicy, /keeps retrying transient network errors/, 'transient network retry')
  assertEvidence(reconnectPolicy, /stops on credential and configuration errors/, 'non-retryable configuration errors')
  assertEvidence(terminal, /scheduleAutoReconnect\s*=\s*\(\)\s*=>\s*{[\s\S]*reconnectScheduler\.schedule\(\)/, 'terminal reconnect scheduler')
  assertEvidence(terminal, /handleCancelAutoReconnect/, 'cancel reconnect action')
  assertEvidence(feedback, /SSH connection form feedback uses runtime translations/, 'localized connection feedback')
})
