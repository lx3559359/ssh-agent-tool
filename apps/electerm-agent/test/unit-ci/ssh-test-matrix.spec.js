const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readTestFile (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8')
}

function assertEvidence (source, pattern, label) {
  assert.match(source, pattern, `Missing SSH test matrix evidence: ${label}`)
}

test('常规 SSH 测试矩阵覆盖关键客户端流程', () => {
  const ssh = readTestFile('session-ssh.spec.js')
  const sshPasswordFirst = readTestFile('session-ssh-password-first.spec.js')
  const sshAgent = readTestFile('session-ssh-agent.spec.js')
  const sshErrors = readTestFile('session-ssh-errors.spec.js')
  const sftp = readTestFile('session-sftp.spec.js')
  const shortcuts = readTestFile('terminal-shortcut-handler.spec.js')
  const all = [
    ssh,
    sshPasswordFirst,
    sshAgent,
    sshErrors,
    sftp,
    shortcuts
  ].join('\n')

  assertEvidence(sshPasswordFirst, /password auth works|password auth is tried before publickey/, 'password login')
  assertEvidence(ssh, /connects with an rsa key protected by a passphrase/, 'rsa private key login')
  assertEvidence(ssh, /connects with an ed25519 key protected by a passphrase/, 'ed25519 private key login')
  assertEvidence(sshAgent, /SSH agent auth|ssh agent/i, 'ssh agent login')
  assertEvidence(ssh, /rejects wrong password with a normalized authentication error/, 'wrong password')
  assertEvidence(ssh, /emits close when an established ssh session is disconnected by the server/, 'server disconnect')
  assertEvidence(ssh, /streams long command output and terminal UI frames/, 'long command output')
  assertEvidence(ssh, /forwards normal shell input and ctrl-c/, 'ctrl-c passthrough')
  assertEvidence(ssh, /forwards interactive control keys and resize events/, 'arrows ctrl-l ctrl-d resize')
  assertEvidence(shortcuts, /terminal Ctrl\+L is reserved for remote shell clear screen/, 'ctrl-l shortcut policy')
  assertEvidence(sftp, /handles unicode paths and large text files/, 'unicode paths')
  assertEvidence(sftp, /uploads and downloads large binary files/, 'sftp large file transfer')
  assertEvidence(sftp, /performs core SFTP file operations/, 'sftp upload download delete rename mkdir')
  assertEvidence(sftp, /resolves remote paths and lists nested directories/, 'sftp navigation')
  assertEvidence(all, /\b(vim|top|htop)\b/i, 'interactive programs vim top htop')
})
