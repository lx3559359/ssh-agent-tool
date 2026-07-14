const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readClientFile (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src/client', relativePath), 'utf8')
}

test('SSH connection form feedback uses runtime translations', () => {
  const source = readClientFile('components/bookmark-form/form-renderer.jsx')

  assert.match(source, /e\('connectionSucceeded'\)/)
  assert.match(source, /e\('connectionFailed'\)/)
  assert.match(source, /e\('sshAndSftpCannotBothBeDisabled'\)/)
  assert.doesNotMatch(source, /connection ok|connection fails|SSH and SFTP all disabled/)
})

test('terminal session creation fallback error uses Chinese copy', () => {
  const source = readClientFile('components/terminal/terminal.jsx')

  assert.match(source, /创建终端会话失败/)
  assert.doesNotMatch(source, /Failed to create terminal session/)
})
