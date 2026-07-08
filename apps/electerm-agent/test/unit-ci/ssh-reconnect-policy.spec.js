const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/terminal/ssh-reconnect-policy.js')
).href

test('ssh reconnect policy keeps retrying transient network errors', async () => {
  const { shouldRetryAutoReconnectError } = await import(moduleUrl)

  assert.equal(shouldRetryAutoReconnectError('SSH 连接超时：root@10.0.1.23:22'), true)
  assert.equal(shouldRetryAutoReconnectError('connect ECONNREFUSED 10.0.1.23:22'), true)
  assert.equal(shouldRetryAutoReconnectError('read ECONNRESET'), true)
  assert.equal(shouldRetryAutoReconnectError('socket closed'), true)
})

test('ssh reconnect policy stops on credential and configuration errors', async () => {
  const { shouldRetryAutoReconnectError } = await import(moduleUrl)

  assert.equal(shouldRetryAutoReconnectError('SSH 认证失败：root@10.0.1.23:22'), false)
  assert.equal(shouldRetryAutoReconnectError('All configured authentication methods failed'), false)
  assert.equal(shouldRetryAutoReconnectError('SSH 私钥无法使用：root@10.0.1.23:22'), false)
  assert.equal(shouldRetryAutoReconnectError('SSH 主机密钥校验失败：root@10.0.1.23:22'), false)
  assert.equal(shouldRetryAutoReconnectError('SSH 目标端口不是 SSH 服务：10.0.1.23:443'), false)
})

test('ssh reconnect policy retries unknown errors to preserve existing reconnect behavior', async () => {
  const { shouldRetryAutoReconnectError } = await import(moduleUrl)

  assert.equal(shouldRetryAutoReconnectError('unexpected terminal session error'), true)
  assert.equal(shouldRetryAutoReconnectError(''), true)
})
