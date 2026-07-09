const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readClientFile (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src/client', relativePath), 'utf8')
}

test('SSH connection form feedback uses Chinese messages', () => {
  const source = readClientFile('components/bookmark-form/form-renderer.jsx')

  assert.match(source, /连接成功/)
  assert.match(source, /连接失败/)
  assert.match(source, /SSH 和 SFTP 不能同时禁用/)
  assert.doesNotMatch(source, /connection ok|connection fails|SSH and SFTP all disabled/)
})

test('terminal session creation fallback error uses Chinese copy', () => {
  const source = readClientFile('components/terminal/terminal.jsx')

  assert.match(source, /创建终端会话失败/)
  assert.doesNotMatch(source, /Failed to create terminal session/)
})
