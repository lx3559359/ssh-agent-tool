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
