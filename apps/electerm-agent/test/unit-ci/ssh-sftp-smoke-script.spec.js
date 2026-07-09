const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const scriptPath = path.join(root, 'build/bin/smoke-ssh-sftp.js')
const packagePath = path.join(root, 'package.json')

test('SSH/SFTP smoke script is reusable and keeps credentials out of source', () => {
  const source = fs.readFileSync(scriptPath, 'utf8')

  assert.match(source, /require\('@electerm\/ssh2'\)/)
  assert.match(source, /SHELLPILOT_SSH_HOST/)
  assert.match(source, /SHELLPILOT_SSH_USER/)
  assert.match(source, /SHELLPILOT_SSH_PASSWORD/)
  assert.match(source, /conn\.shell/)
  assert.match(source, /'\\x03'/)
  assert.match(source, /sftpOp\(sftp,\s*'writeFile'/)
  assert.match(source, /sftpOp\(sftp,\s*'rename'/)
  assert.match(source, /sftpOp\(sftp,\s*'unlink'/)
  assert.doesNotMatch(source, /23\.94\.104\.203/)
  assert.doesNotMatch(source, /example-secret-password/)
})

test('package exposes SSH/SFTP smoke test command', () => {
  const pack = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

  assert.equal(pack.scripts['smoke:ssh-sftp'], 'node build/bin/smoke-ssh-sftp.js')
})
