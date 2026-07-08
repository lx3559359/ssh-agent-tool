process.env.NODE_ENV = 'development'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeSshConnectionError } = require('../../src/app/server/session-ssh')

describe('session-ssh connection error diagnostics', () => {
  test('adds a chinese diagnosis for refused ssh ports', () => {
    const error = new Error('connect ECONNREFUSED 10.0.1.23:22')
    error.code = 'ECONNREFUSED'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'root'
    })

    assert.equal(normalized, error)
    assert.match(normalized.message, /SSH 连接被拒绝/)
    assert.match(normalized.message, /10\.0\.1\.23:22/)
    assert.match(normalized.message, /检查服务器地址、端口、sshd 服务/)
    assert.match(normalized.message, /原始错误：connect ECONNREFUSED/)
  })

  test('adds a chinese diagnosis for failed authentication', () => {
    const error = new Error('All configured authentication methods failed')

    const normalized = normalizeSshConnectionError(error, {
      host: 'prod-web-01',
      port: 22,
      username: 'deploy'
    })

    assert.match(normalized.message, /SSH 认证失败/)
    assert.match(normalized.message, /deploy@prod-web-01:22/)
    assert.match(normalized.message, /检查用户名、密码、私钥、密钥口令或 SSH Agent/)
  })

  test('adds a chinese diagnosis for permission denied authentication errors', () => {
    const error = new Error('Permission denied (publickey,password).')

    const normalized = normalizeSshConnectionError(error, {
      host: 'prod-web-02',
      port: 2222,
      username: 'ops'
    })

    assert.match(normalized.message, /SSH 认证失败/)
    assert.match(normalized.message, /ops@prod-web-02:2222/)
    assert.match(normalized.message, /检查用户名、密码、私钥、密钥口令或 SSH Agent/)
    assert.match(normalized.message, /原始错误：Permission denied/)
  })

  test('adds a chinese diagnosis for changed host keys', () => {
    const error = new Error('Host key verification failed: REMOTE HOST IDENTIFICATION HAS CHANGED')

    const normalized = normalizeSshConnectionError(error, {
      host: 'prod-web-01',
      port: 22,
      username: 'root'
    })

    assert.match(normalized.message, /SSH 主机密钥校验失败/)
    assert.match(normalized.message, /root@prod-web-01:22/)
    assert.match(normalized.message, /服务器指纹/)
    assert.match(normalized.message, /known_hosts/)
  })

  test('adds a chinese diagnosis for reset ssh connections', () => {
    const error = new Error('read ECONNRESET')
    error.code = 'ECONNRESET'

    const normalized = normalizeSshConnectionError(error, {
      host: 'jump.example.com',
      port: 2222,
      username: 'ops'
    })

    assert.match(normalized.message, /SSH 连接被远端重置/)
    assert.match(normalized.message, /ops@jump\.example\.com:2222/)
    assert.match(normalized.message, /检查服务器 sshd/)
    assert.match(normalized.message, /防火墙/)
    assert.match(normalized.message, /原始错误：read ECONNRESET/)
  })

  test('adds a chinese diagnosis for unreachable networks', () => {
    const error = new Error('connect EHOSTUNREACH 10.0.9.9:22')
    error.code = 'EHOSTUNREACH'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.9.9',
      port: 22,
      username: 'root'
    })

    assert.match(normalized.message, /SSH 网络不可达/)
    assert.match(normalized.message, /root@10\.0\.9\.9:22/)
    assert.match(normalized.message, /VPN/)
    assert.match(normalized.message, /路由/)
    assert.match(normalized.message, /原始错误：connect EHOSTUNREACH/)
  })

  test('adds a chinese diagnosis when the server closes before ssh is ready', () => {
    const error = new Error('Socket closed before SSH handshake')

    const normalized = normalizeSshConnectionError(error, {
      host: 'bastion.example.com',
      port: 22,
      username: 'ops'
    })

    assert.match(normalized.message, /SSH 连接被提前关闭/)
    assert.match(normalized.message, /ops@bastion\.example\.com:22/)
    assert.match(normalized.message, /堡垒机/)
    assert.match(normalized.message, /协议/)
    assert.match(normalized.message, /原始错误：Socket closed before SSH handshake/)
  })

  test('adds a chinese diagnosis for incompatible ssh algorithms', () => {
    const error = new Error('Handshake failed: no matching key exchange algorithm')

    const normalized = normalizeSshConnectionError(error, {
      host: 'legacy-linux.example.com',
      port: 22,
      username: 'root'
    })

    assert.match(normalized.message, /SSH 算法不兼容/)
    assert.match(normalized.message, /root@legacy-linux\.example\.com:22/)
    assert.match(normalized.message, /旧服务器/)
    assert.match(normalized.message, /兼容算法/)
    assert.match(normalized.message, /原始错误：Handshake failed: no matching key exchange algorithm/)
  })

  test('adds a chinese diagnosis for invalid private keys', () => {
    const error = new Error('Cannot parse privateKey: Unsupported key format')

    const normalized = normalizeSshConnectionError(error, {
      host: 'prod-web-03',
      port: 22,
      username: 'deploy'
    })

    assert.match(normalized.message, /SSH 私钥无法使用/)
    assert.match(normalized.message, /deploy@prod-web-03:22/)
    assert.match(normalized.message, /私钥格式/)
    assert.match(normalized.message, /密钥口令/)
    assert.match(normalized.message, /原始错误：Cannot parse privateKey/)
  })

  test('adds a chinese diagnosis for too many ssh authentication attempts', () => {
    const error = new Error('Received disconnect from 10.0.1.23 port 22:2: Too many authentication failures')

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'deploy'
    })

    assert.match(normalized.message, /SSH 认证尝试次数过多/)
    assert.match(normalized.message, /deploy@10\.0\.1\.23:22/)
    assert.match(normalized.message, /SSH Agent/)
    assert.match(normalized.message, /钥匙/)
    assert.match(normalized.message, /原始错误：Received disconnect/)
  })
})
