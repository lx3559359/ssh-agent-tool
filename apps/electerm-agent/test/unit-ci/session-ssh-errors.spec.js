process.env.NODE_ENV = 'development'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')
const sessionSshPath = require.resolve('../../src/app/server/session-ssh')
const {
  normalizeSshConnectionError,
  shouldLogSshConnectErrorAsError,
  reorderConnectionHoppings
} = require(sessionSshPath)

async function withSessionSshMocks ({ proxySock, clientScenarios = [] }, run) {
  const originalLoad = Module._load
  delete require.cache[sessionSshPath]
  class MockSshClient {
    constructor () {
      this.scenario = clientScenarios.shift() || {}
      this.listeners = {}
    }

    on (event, listener) {
      this.listeners[event] = listener
      return this
    }

    connect () {
      queueMicrotask(() => {
        const event = this.scenario.connectError ? 'error' : 'ready'
        this.listeners[event]?.(this.scenario.connectError)
      })
      return this
    }

    forwardOut (sourceHost, sourcePort, host, port, callback) {
      queueMicrotask(() => callback(this.scenario.forwardError, { end () {} }))
    }

    shell (window, options, callback) {
      queueMicrotask(() => callback(this.scenario.shellError))
    }

    end () {}
  }
  Module._load = function (request, parent, isMain) {
    if (request === './socks' && parent?.filename === sessionSshPath && proxySock) return proxySock
    if (request === '@electerm/ssh2') return { Client: MockSshClient }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return await run(require(sessionSshPath))
  } finally {
    Module._load = originalLoad
    delete require.cache[sessionSshPath]
  }
}

function getSessionOptions (overrides = {}) {
  return {
    uid: 'session-ssh-error-test',
    host: 'target.example.com',
    port: 22,
    username: 'deploy',
    password: 'target-password-secret',
    ...overrides
  }
}

describe('session-ssh production session error boundary', () => {
  test('normalizes proxy establishment rejections without leaking credentials', async () => {
    const error = new Error('proxy socks5://proxy-user:proxy-password-secret@127.0.0.1:1080 refused')
    error.code = 'ECONNREFUSED'
    const options = getSessionOptions({ proxy: 'socks5://proxy-user:proxy-password-secret@127.0.0.1:1080' })
    await withSessionSshMocks({
      proxySock: async () => { throw error },
      clientScenarios: [{}]
    }, async ({ session }) => {
      await assert.rejects(session(options), err => {
        assert.equal(err, error)
        assert.equal(err.sshConnectionErrorNormalized, true)
        assert.match(err.message, /SSH 代理连接失败/)
        assert.doesNotMatch(err.message, /proxy-password-secret|target-password-secret/)
        return true
      })
    })
  })

  test('normalizes jump forwarding rejections from session()', async () => {
    const error = new Error('Channel open failure: administratively prohibited')
    const options = getSessionOptions({
      connectionHoppings: [{ host: 'final.example.com', port: 22, username: 'final-user', password: 'final-password-secret' }]
    })
    await withSessionSshMocks({ clientScenarios: [{ forwardError: error }] }, async ({ session }) => {
      await assert.rejects(session(options), err => {
        assert.equal(err, error)
        assert.equal(err.sshConnectionErrorNormalized, true)
        assert.match(err.message, /SSH 端口转发或跳板策略禁止/)
        assert.doesNotMatch(err.message, /target-password-secret|final-password-secret/)
        return true
      })
    })
  })

  test('normalizes jump authentication rejections from session()', async () => {
    const error = new Error('Authentication failed password=jump-password-secret')
    const options = getSessionOptions({
      connectionHoppings: [{ host: 'final.example.com', port: 22, username: 'final-user', password: 'jump-password-secret' }]
    })
    await withSessionSshMocks({ clientScenarios: [{}, { connectError: error }] }, async ({ session }) => {
      await assert.rejects(session(options), err => {
        assert.equal(err, error)
        assert.equal(err.sshConnectionErrorNormalized, true)
        assert.match(err.message, /SSH 认证失败/)
        assert.doesNotMatch(err.message, /jump-password-secret|target-password-secret/)
        return true
      })
    })
  })

  test('normalizes final shell creation rejections from session()', async () => {
    const error = new Error([
      'Unable to open shell password=shell-password-secret',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'shell-private-key-secret',
      '-----END OPENSSH PRIVATE KEY-----'
    ].join('\n'))
    await withSessionSshMocks({ clientScenarios: [{ shellError: error }] }, async ({ session }) => {
      await assert.rejects(session(getSessionOptions()), err => {
        assert.equal(err, error)
        assert.equal(err.sshConnectionErrorNormalized, true)
        assert.match(err.message, /SSH 连接失败/)
        assert.doesNotMatch(err.message, /shell-password-secret|shell-private-key-secret|target-password-secret/)
        return true
      })
    })
  })

  test('does not wrap an already normalized session rejection again', async () => {
    const options = getSessionOptions()
    const error = normalizeSshConnectionError(new Error('connect ECONNREFUSED target.example.com:22'), options)
    const message = error.message
    await withSessionSshMocks({ clientScenarios: [{ shellError: error }] }, async ({ session }) => {
      await assert.rejects(session(options), err => {
        assert.equal(err, error)
        assert.equal(err.message, message)
        assert.equal((err.message.match(/原始错误：/g) || []).length, 1)
        return true
      })
    })
  })
})

describe('session-ssh connection error diagnostics', () => {
  test('preserves the final target certificate after jump-host reordering', () => {
    const options = {
      host: 'target.example.com',
      port: 22,
      username: 'target-user',
      privateKey: 'target-private-key',
      certificate: 'target-openssh-certificate',
      hasHopping: true,
      connectionHoppings: [{
        host: 'jump.example.com',
        port: 22,
        username: 'jump-user',
        certificate: 'jump-openssh-certificate'
      }]
    }

    reorderConnectionHoppings(options)

    assert.equal(options.host, 'jump.example.com')
    assert.equal(options.certificate, 'jump-openssh-certificate')
    assert.equal(options.connectionHoppings[0].host, 'target.example.com')
    assert.equal(options.connectionHoppings[0].certificate, 'target-openssh-certificate')
  })

  test('does not log expected two factor auth retry as an ssh error', () => {
    assert.equal(shouldLogSshConnectErrorAsError(new Error('2FA_RETRY')), false)
    assert.equal(shouldLogSshConnectErrorAsError(new Error('connect ECONNREFUSED 10.0.1.23:22')), true)
  })

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

  test('adds next-step log guidance to ssh connection failures', () => {
    const error = new Error('connect ECONNREFUSED 10.0.1.23:22')
    error.code = 'ECONNREFUSED'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'root'
    })

    assert.match(normalized.message, /下一步：/)
    assert.match(normalized.message, /打开会话日志目录/)
    assert.match(normalized.message, /导出诊断包/)
  })

  test('adds a chinese diagnosis for connection refused messages without errno code', () => {
    const error = new Error('connect: Connection refused')

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.24',
      port: 22,
      username: 'root'
    })

    assert.match(normalized.message, /SSH 连接被拒绝/)
    assert.match(normalized.message, /root@10\.0\.1\.24:22/)
    assert.match(normalized.message, /检查服务器地址、端口、sshd 服务/)
    assert.match(normalized.message, /原始错误：connect: Connection refused/)
  })

  test('adds a chinese diagnosis for ssh proxy connection failures', () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:1080')
    error.code = 'ECONNREFUSED'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'root',
      proxy: 'socks5://127.0.0.1:1080'
    })

    assert.match(normalized.message, /SSH 代理连接失败/)
    assert.match(normalized.message, /root@10\.0\.1\.23:22/)
    assert.match(normalized.message, /socks5:\/\/127\.0\.0\.1:1080/)
    assert.match(normalized.message, /代理地址/)
    assert.match(normalized.message, /代理认证/)
    assert.match(normalized.message, /原始错误：connect ECONNREFUSED/)
  })

  test('redacts proxy credentials from ssh connection diagnostics', () => {
    const error = new Error('proxy socks5://proxy-user:proxy-password@127.0.0.1:1080 refused')
    error.code = 'ECONNREFUSED'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'root',
      proxy: 'socks5://proxy-user:proxy-password@127.0.0.1:1080'
    })

    assert.match(normalized.message, /socks5:\/\/proxy-user:\[redacted\]@127\.0\.0\.1:1080/)
    assert.doesNotMatch(normalized.message, /proxy-password/)
  })

  test('redacts inline secrets from ssh connection diagnostics', () => {
    const error = new Error([
      'connect failed password=root-secret apiKeyAI=relay-secret',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'private-key-body',
      '-----END OPENSSH PRIVATE KEY-----'
    ].join('\n'))
    error.code = 'ETIMEDOUT'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'root'
    })

    assert.match(normalized.message, /SSH 连接超时/)
    assert.doesNotMatch(normalized.message, /root-secret/)
    assert.doesNotMatch(normalized.message, /relay-secret/)
    assert.doesNotMatch(normalized.message, /private-key-body/)
    assert.doesNotMatch(normalized.message, /BEGIN OPENSSH PRIVATE KEY/)
    assert.match(normalized.message, /\[已脱敏\]/)
  })

  test('adds the configured ssh timeout seconds to timeout diagnostics', () => {
    const error = new Error('Timed out while waiting for handshake')
    error.code = 'ETIMEDOUT'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'root',
      readyTimeout: 5000
    })

    assert.match(normalized.message, /SSH 连接超时/)
    assert.match(normalized.message, /root@10\.0\.1\.23:22/)
    assert.match(normalized.message, /当前超时设置为 5 秒/)
    assert.match(normalized.message, /原始错误：Timed out while waiting for handshake/)
  })

  test('adds a chinese diagnosis for proxy connection refused messages without errno code', () => {
    const error = new Error('connect: Connection refused 127.0.0.1:1080')

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'root',
      proxy: 'socks5://127.0.0.1:1080'
    })

    assert.match(normalized.message, /SSH 代理连接失败/)
    assert.match(normalized.message, /root@10\.0\.1\.23:22/)
    assert.match(normalized.message, /socks5:\/\/127\.0\.0\.1:1080/)
    assert.match(normalized.message, /代理地址/)
    assert.doesNotMatch(normalized.message, /SSH 连接被拒绝/)
    assert.match(normalized.message, /原始错误：connect: Connection refused/)
  })

  test('adds a chinese diagnosis for proxy connection resets', () => {
    const error = new Error('read ECONNRESET 127.0.0.1:1080')
    error.code = 'ECONNRESET'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'root',
      proxy: 'socks5://127.0.0.1:1080'
    })

    assert.match(normalized.message, /SSH 代理连接失败/)
    assert.match(normalized.message, /root@10\.0\.1\.23:22/)
    assert.match(normalized.message, /socks5:\/\/127\.0\.0\.1:1080/)
    assert.match(normalized.message, /代理地址/)
    assert.doesNotMatch(normalized.message, /SSH 连接被远端重置/)
    assert.match(normalized.message, /原始错误：read ECONNRESET/)
  })

  test('adds a chinese diagnosis for broken proxy pipes', () => {
    const error = new Error('write EPIPE 127.0.0.1:1080')
    error.code = 'EPIPE'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'root',
      proxy: 'socks5://127.0.0.1:1080'
    })

    assert.match(normalized.message, /SSH 代理连接失败/)
    assert.match(normalized.message, /root@10\.0\.1\.23:22/)
    assert.match(normalized.message, /socks5:\/\/127\.0\.0\.1:1080/)
    assert.match(normalized.message, /代理地址/)
    assert.doesNotMatch(normalized.message, /SSH 连接被远端重置/)
    assert.match(normalized.message, /原始错误：write EPIPE/)
  })

  test('adds a chinese diagnosis for unreachable proxy hosts', () => {
    const error = new Error('connect EHOSTUNREACH 10.0.0.10:1080')
    error.code = 'EHOSTUNREACH'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'root',
      proxy: 'socks5://10.0.0.10:1080'
    })

    assert.match(normalized.message, /SSH 代理连接失败/)
    assert.match(normalized.message, /root@10\.0\.1\.23:22/)
    assert.match(normalized.message, /socks5:\/\/10\.0\.0\.10:1080/)
    assert.match(normalized.message, /代理地址/)
    assert.doesNotMatch(normalized.message, /SSH 网络不可达/)
    assert.match(normalized.message, /原始错误：connect EHOSTUNREACH/)
  })

  test('adds a chinese diagnosis for proxy local permission errors', () => {
    const error = new Error('connect EACCES 127.0.0.1:1080')
    error.code = 'EACCES'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'root',
      proxy: 'socks5://127.0.0.1:1080'
    })

    assert.match(normalized.message, /SSH 代理连接失败/)
    assert.match(normalized.message, /root@10\.0\.1\.23:22/)
    assert.match(normalized.message, /socks5:\/\/127\.0\.0\.1:1080/)
    assert.match(normalized.message, /代理地址/)
    assert.doesNotMatch(normalized.message, /SSH 本机网络权限受限/)
    assert.match(normalized.message, /原始错误：connect EACCES/)
  })

  test('keeps target ssh port refusals distinct from proxy failures', () => {
    const error = new Error('connect ECONNREFUSED 10.0.1.23:22')
    error.code = 'ECONNREFUSED'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'root',
      proxy: 'socks5://127.0.0.1:1080'
    })

    assert.match(normalized.message, /SSH 连接被拒绝/)
    assert.doesNotMatch(normalized.message, /SSH 代理连接失败/)
    assert.match(normalized.message, /root@10\.0\.1\.23:22/)
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

  test('adds a chinese diagnosis for access denied authentication errors', () => {
    const error = new Error('Access denied')

    const normalized = normalizeSshConnectionError(error, {
      host: 'prod-web-05',
      port: 22,
      username: 'deploy'
    })

    assert.match(normalized.message, /SSH 认证失败/)
    assert.match(normalized.message, /deploy@prod-web-05:22/)
    assert.match(normalized.message, /检查用户名、密码、私钥/)
    assert.match(normalized.message, /原始错误：Access denied/)
  })

  test('adds a chinese diagnosis for authentication failure errors', () => {
    const error = new Error('Authentication failure')

    const normalized = normalizeSshConnectionError(error, {
      host: 'prod-web-06',
      port: 22,
      username: 'deploy'
    })

    assert.match(normalized.message, /SSH 认证失败/)
    assert.match(normalized.message, /deploy@prod-web-06:22/)
    assert.match(normalized.message, /检查用户名、密码、私钥/)
    assert.match(normalized.message, /原始错误：Authentication failure/)
  })

  test('adds a chinese diagnosis for unable to authenticate errors', () => {
    const error = new Error('Unable to authenticate using any of the configured authentication methods')

    const normalized = normalizeSshConnectionError(error, {
      host: 'prod-web-07',
      port: 22,
      username: 'deploy'
    })

    assert.match(normalized.message, /SSH 认证失败/)
    assert.match(normalized.message, /deploy@prod-web-07:22/)
    assert.match(normalized.message, /检查用户名、密码、私钥/)
    assert.match(normalized.message, /原始错误：Unable to authenticate/)
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

  test('adds a chinese diagnosis for broken ssh pipes', () => {
    const error = new Error('write EPIPE')
    error.code = 'EPIPE'

    const normalized = normalizeSshConnectionError(error, {
      host: 'jump.example.com',
      port: 2222,
      username: 'ops'
    })

    assert.match(normalized.message, /SSH 连接被远端重置/)
    assert.match(normalized.message, /ops@jump\.example\.com:2222/)
    assert.match(normalized.message, /服务器 sshd/)
    assert.match(normalized.message, /连接数限制/)
    assert.match(normalized.message, /原始错误：write EPIPE/)
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

  test('adds a chinese diagnosis when the target host is down', () => {
    const error = new Error('connect EHOSTDOWN 10.0.9.10:22')
    error.code = 'EHOSTDOWN'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.9.10',
      port: 22,
      username: 'root'
    })

    assert.match(normalized.message, /SSH 网络不可达/)
    assert.match(normalized.message, /root@10\.0\.9\.10:22/)
    assert.match(normalized.message, /VPN/)
    assert.match(normalized.message, /安全组/)
    assert.match(normalized.message, /原始错误：connect EHOSTDOWN/)
  })

  test('adds a chinese diagnosis for local network permission errors', () => {
    const error = new Error('connect EACCES 10.0.1.23:22')
    error.code = 'EACCES'

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.23',
      port: 22,
      username: 'root'
    })

    assert.match(normalized.message, /SSH 本机网络权限受限/)
    assert.match(normalized.message, /root@10\.0\.1\.23:22/)
    assert.match(normalized.message, /Windows 防火墙/)
    assert.match(normalized.message, /安全软件/)
    assert.match(normalized.message, /原始错误：connect EACCES/)
  })

  test('adds a chinese diagnosis for DNS lookup timeouts', () => {
    const error = new Error('queryA ETIMEOUT prod-web.internal')
    error.code = 'ETIMEOUT'

    const normalized = normalizeSshConnectionError(error, {
      host: 'prod-web.internal',
      port: 22,
      username: 'root'
    })

    assert.match(normalized.message, /SSH 主机无法解析/)
    assert.match(normalized.message, /root@prod-web\.internal:22/)
    assert.match(normalized.message, /DNS/)
    assert.match(normalized.message, /网络/)
    assert.match(normalized.message, /原始错误：queryA ETIMEOUT/)
  })

  test('adds a chinese diagnosis when ssh cannot resolve hostname', () => {
    const error = new Error('Could not resolve hostname prod-web.internal: Name or service not known')

    const normalized = normalizeSshConnectionError(error, {
      host: 'prod-web.internal',
      port: 22,
      username: 'root'
    })

    assert.match(normalized.message, /SSH 主机无法解析/)
    assert.match(normalized.message, /root@prod-web\.internal:22/)
    assert.match(normalized.message, /DNS/)
    assert.match(normalized.message, /原始错误：Could not resolve hostname/)
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

  test('adds a chinese diagnosis when target port is not an ssh service', () => {
    const error = new Error('kex_exchange_identification: banner line contains invalid characters')

    const normalized = normalizeSshConnectionError(error, {
      host: '10.0.1.80',
      port: 80,
      username: 'root'
    })

    assert.match(normalized.message, /SSH 目标端口不是 SSH 服务/)
    assert.match(normalized.message, /root@10\.0\.1\.80:80/)
    assert.match(normalized.message, /端口/)
    assert.match(normalized.message, /HTTP/)
    assert.match(normalized.message, /sshd/)
    assert.match(normalized.message, /原始错误：kex_exchange_identification/)
  })

  test('adds a chinese diagnosis for ssh server connection limits', () => {
    const error = new Error('kex_exchange_identification: Connection closed by remote host banner exchange: Connection from 10.0.1.8 port 52101: drop connection #12 from [10.0.1.8]: MaxStartups')

    const normalized = normalizeSshConnectionError(error, {
      host: 'prod-bastion-01',
      port: 22,
      username: 'ops'
    })

    assert.match(normalized.message, /SSH 服务端连接数或安全策略限制/)
    assert.match(normalized.message, /ops@prod-bastion-01:22/)
    assert.match(normalized.message, /MaxStartups/)
    assert.match(normalized.message, /并发连接/)
    assert.match(normalized.message, /安全设备/)
    assert.match(normalized.message, /原始错误：kex_exchange_identification/)
  })

  test('adds a chinese diagnosis for prohibited ssh forwarding', () => {
    const error = new Error('Channel open failure: open failed: administratively prohibited: open failed')

    const normalized = normalizeSshConnectionError(error, {
      host: 'bastion.example.com',
      port: 22,
      username: 'ops'
    })

    assert.match(normalized.message, /SSH 端口转发或跳板策略禁止/)
    assert.match(normalized.message, /ops@bastion\.example\.com:22/)
    assert.match(normalized.message, /AllowTcpForwarding/)
    assert.match(normalized.message, /堡垒机/)
    assert.match(normalized.message, /原始错误：Channel open failure/)
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

  test('adds a chinese diagnosis for encrypted private keys without passphrase', () => {
    const error = new Error('Encrypted private key detected, but no passphrase given')

    const normalized = normalizeSshConnectionError(error, {
      host: 'prod-web-04',
      port: 22,
      username: 'deploy'
    })

    assert.match(normalized.message, /SSH 私钥无法使用/)
    assert.match(normalized.message, /deploy@prod-web-04:22/)
    assert.match(normalized.message, /密钥口令/)
    assert.match(normalized.message, /原始错误：Encrypted private key/)
  })

  test('adds a chinese diagnosis for unreadable private key files', () => {
    const error = new Error("ENOENT: no such file or directory, open 'C:\\Users\\ops\\.ssh\\prod.pem'")
    error.code = 'ENOENT'

    const normalized = normalizeSshConnectionError(error, {
      host: 'prod-web-08',
      port: 22,
      username: 'deploy'
    })

    assert.match(normalized.message, /SSH 私钥文件无法读取/)
    assert.match(normalized.message, /deploy@prod-web-08:22/)
    assert.match(normalized.message, /私钥路径/)
    assert.match(normalized.message, /文件权限/)
    assert.match(normalized.message, /原始错误：ENOENT/)
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
