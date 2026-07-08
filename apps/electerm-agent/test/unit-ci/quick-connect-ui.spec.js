const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('quick connect form uses beginner friendly Chinese SSH labels', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tabs/quick-connect.jsx'),
    'utf8'
  )

  assert.match(source, /快速连接服务器/)
  assert.match(source, /服务器 IP 或域名/)
  assert.match(source, /用户名，选填/)
  assert.match(source, /密码，选填/)
  assert.match(source, /请填写服务器地址或 IP/)
  assert.doesNotMatch(source, /Format error, please check the input/)
  assert.doesNotMatch(source, /ssh\|rdp\|vnc\|spice/)
})
