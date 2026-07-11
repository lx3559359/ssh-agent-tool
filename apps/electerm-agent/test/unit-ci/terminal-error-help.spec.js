const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/terminal/terminal-error-help.js')
).href

test('terminal error help gives actionable Chinese tips for common SSH failures', async () => {
  const { buildTerminalErrorTips } = await import(moduleUrl)

  const authTips = buildTerminalErrorTips('SSH 认证失败：All configured authentication methods failed')
  assert.equal(authTips.some(tip => tip.includes('账号')), true)
  assert.equal(authTips.some(tip => tip.includes('密码') || tip.includes('私钥')), true)
  assert.equal(authTips.some(tip => tip.includes('编辑连接')), true)

  const networkTips = buildTerminalErrorTips('SSH 连接超时：connect ETIMEDOUT 10.0.1.23:22')
  assert.equal(networkTips.some(tip => tip.includes('IP')), true)
  assert.equal(networkTips.some(tip => tip.includes('端口')), true)
  assert.equal(networkTips.some(tip => tip.includes('防火墙') || tip.includes('安全组')), true)

  const hostKeyTips = buildTerminalErrorTips('SSH 主机密钥校验失败：Host key verification failed')
  assert.equal(hostKeyTips.some(tip => tip.includes('主机指纹')), true)
  assert.equal(hostKeyTips.some(tip => tip.includes('known_hosts')), true)
})

test('terminal error component renders structured troubleshooting tips', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/terminal/terminal-error-handle.jsx'),
    'utf8'
  )

  assert.match(source, /buildTerminalErrorTips/)
  assert.match(source, /terminal-error-tips/)
  assert.match(source, /terminal-error-actions/)

  const style = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/terminal/terminal.styl'),
    'utf8'
  )
  assert.match(style, /terminal-error-tips/)
})
