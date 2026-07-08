/**
 * terminal/sftp/serial class
 */

const proxySock = require('./socks')
const _ = require('../lib/lodash.js')
const generate = require('../common/uid')
const { resolve: pathResolve } = require('path')
const net = require('net')
const { exec } = require('child_process')
const log = require('../common/log')
const { algDefault, algAlt } = require('./ssh2-alg')
const { createHostVerifier } = require('./ssh-known-hosts')
const sshTunnelFuncs = require('./ssh-tunnel')
const deepCopy = require('json-deep-copy')
const { TerminalBase } = require('./session-base')
const { commonExtends } = require('./session-common')
const globalState = require('./global-state')
const iconv = require('iconv-lite')
const { resolveSshAgent } = require('./ssh-agent-resolver')

// Encodings that are equivalent to UTF-8 (no conversion needed)
const utf8Aliases = new Set(['utf-8', 'utf8', 'utf-8-strict'])

const failMsg = 'All configured authentication methods failed'
const csFailMsg = 'no matching C->S cipher'

function getSshTargetLabel (options = {}) {
  const host = options.host || '未知主机'
  const port = options.port || 22
  return options.username
    ? `${options.username}@${host}:${port}`
    : `${host}:${port}`
}

function getProxyNeedles (proxy) {
  const needles = [proxy]
  try {
    const url = new URL(proxy)
    if (url.hostname) {
      needles.push(url.hostname)
      if (url.port) {
        needles.push(`${url.hostname}:${url.port}`)
      }
    }
  } catch (_) {
  }
  return needles
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean)
}

function isProxyConnectionError (message, code, proxy) {
  if (!proxy) {
    return false
  }
  if (/proxy|socks/i.test(message)) {
    return true
  }
  if (!(
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    /ECONNREFUSED|connection refused|ENOTFOUND|EAI_AGAIN|ECONNRESET|connection reset|timed? ?out/i.test(message)
  )) {
    return false
  }
  const lowerMessage = message.toLowerCase()
  return getProxyNeedles(proxy).some(needle => lowerMessage.includes(needle))
}

function getSshDiagnosis (err = {}, options = {}) {
  const message = err.message || String(err)
  const code = err.code || ''
  const proxy = typeof options.proxy === 'string' ? options.proxy.trim() : ''
  if (isProxyConnectionError(message, code, proxy)) {
    return {
      title: 'SSH 代理连接失败',
      suggestion: `请检查代理地址 ${proxy}、代理类型、代理认证、代理服务是否运行，以及代理到目标服务器的网络连通性。`
    }
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED|connection refused/i.test(message)) {
    return {
      title: 'SSH 连接被拒绝',
      suggestion: '请检查服务器地址、端口、sshd 服务、防火墙或安全组是否允许访问。'
    }
  }
  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    /ENOTFOUND|EAI_AGAIN|getaddrinfo|queryA|querySrv|queryTxt|DNS|could not resolve hostname|name or service not known/i.test(message)
  ) {
    return {
      title: 'SSH 主机无法解析',
      suggestion: '请检查服务器地址、DNS、代理配置或当前网络连接。'
    }
  }
  if (code === 'ECONNRESET' || /ECONNRESET|connection reset/i.test(message)) {
    return {
      title: 'SSH 连接被远端重置',
      suggestion: '请检查服务器 sshd、堡垒机/代理、防火墙、安全组或连接数限制是否主动断开连接。'
    }
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'EHOSTDOWN' || /EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|no route to host|network is unreachable|host is down/i.test(message)) {
    return {
      title: 'SSH 网络不可达',
      suggestion: '请检查本机网络、VPN、路由、代理/堡垒机、防火墙和安全组是否允许访问目标服务器。'
    }
  }
  if (/\bconnect\b.*\bEACCES\b|\bEACCES\b.*\bconnect\b/i.test(message)) {
    return {
      title: 'SSH 本机网络权限受限',
      suggestion: '本机系统或安全软件拒绝建立网络连接，请检查 Windows 防火墙、杀毒软件、公司终端安全策略、代理/VPN，或是否需要管理员权限。'
    }
  }
  if (/maxstartups|drop connection|too many connections|connection rate exceeded|connection limit|banner exchange.*connection closed/i.test(message)) {
    return {
      title: 'SSH 服务端连接数或安全策略限制',
      suggestion: '服务端可能因 MaxStartups、并发连接数、堡垒机限流、防火墙或安全设备策略主动拒绝握手；请稍后重试，或检查 sshd 与安全策略配置。'
    }
  }
  if (/administratively prohibited|open failed|channel open failure|forwarding.*(disabled|denied|prohibited)|port forwarding.*(disabled|denied|prohibited)/i.test(message)) {
    return {
      title: 'SSH 端口转发或跳板策略禁止',
      suggestion: '请检查 sshd 的 AllowTcpForwarding、PermitOpen、网关转发配置，以及堡垒机、代理或安全策略是否允许当前端口转发/跳板连接。'
    }
  }
  if (/kex_exchange_identification|banner line contains invalid characters|protocol mismatch|bad packet length|expected ssh/i.test(message)) {
    return {
      title: 'SSH 目标端口不是 SSH 服务',
      suggestion: '请确认连接端口确实运行 sshd；如果该端口返回 HTTP、HTTPS、数据库或代理协议，请改用服务器真实 SSH 端口。'
    }
  }
  if (/socket closed|connection closed|closed before|handshake.*closed|server.*closed/i.test(message)) {
    return {
      title: 'SSH 连接被提前关闭',
      suggestion: '请检查服务器 sshd、堡垒机/代理、连接数限制、协议是否为 SSH，以及安全设备是否在握手前断开连接。'
    }
  }
  if (message.includes(csFailMsg) || /no matching .*?(algorithm|cipher|key exchange|host key|kex)|unsupported .*?(algorithm|cipher|key exchange|host key|kex)/i.test(message)) {
    return {
      title: 'SSH 算法不兼容',
      suggestion: '通常是旧服务器或安全策略只支持特定 KEX、HostKey、Cipher 算法；请在连接配置中启用兼容算法，或升级服务器 SSH 配置。'
    }
  }
  if (/cannot parse privatekey|invalid privatekey|invalid private key|unsupported key format|malformed .*private key|private key.*(parse|format)|encrypted private key|passphrase/i.test(message)) {
    return {
      title: 'SSH 私钥无法使用',
      suggestion: '通常是私钥格式不支持、内容损坏、复制不完整，或密钥口令填写错误；请确认私钥为 OpenSSH/PEM 格式并重新选择正确私钥。'
    }
  }
  if (code === 'ETIMEDOUT' || /timed? ?out|handshake timeout/i.test(message)) {
    return {
      title: 'SSH 连接超时',
      suggestion: '请检查网络连通性、防火墙、安全组、堡垒机链路和服务器端口。'
    }
  }
  if (/too many authentication failures/i.test(message)) {
    return {
      title: 'SSH 认证尝试次数过多',
      suggestion: '通常是 SSH Agent 中加载了过多钥匙，服务端在尝试到正确钥匙前已断开；请指定正确私钥、减少 Agent 钥匙，或关闭本连接的 SSH Agent。'
    }
  }
  if (
    message.includes(failMsg) ||
    /authentication.*(failed|failure)/i.test(message) ||
    /unable to authenticate/i.test(message) ||
    /permission denied/i.test(message) ||
    /access denied/i.test(message) ||
    /no supported authentication/i.test(message)
  ) {
    return {
      title: 'SSH 认证失败',
      suggestion: '请检查用户名、密码、私钥、密钥口令或 SSH Agent 凭据是否正确。'
    }
  }
  if (/host key|known_hosts|fingerprint/i.test(message)) {
    return {
      title: 'SSH 主机密钥校验失败',
      suggestion: '请确认服务器指纹是否可信；如果服务器重装或 IP 被复用，请检查 known_hosts 记录。'
    }
  }
  return {
    title: 'SSH 连接失败',
    suggestion: '请检查服务器地址、端口、认证方式、代理/堡垒机配置和网络连通性。'
  }
}

function normalizeSshConnectionError (err, options = {}) {
  if (!err) {
    return err
  }
  if (err.sshConnectionErrorNormalized) {
    return err
  }
  const originalMessage = err.message || String(err)
  const diagnosis = getSshDiagnosis(err, options)
  err.originalMessage = originalMessage
  err.sshConnectionErrorNormalized = true
  err.message = [
    `${diagnosis.title}：${getSshTargetLabel(options)}`,
    `建议：${diagnosis.suggestion}`,
    `原始错误：${originalMessage}`
  ].join('\n')
  return err
}

class TerminalSshBase extends TerminalBase {
  async remoteInitProcess () {
    this.adjustConnectionOrder()
    const {
      initOptions
    } = this
    const hasX11 = initOptions.x11 === true
    this.display = hasX11 ? await this.getDisplay() : undefined
    this.x11Cookie = hasX11 ? await this.getX11Cookie() : undefined
    return this.sshConnect()
  }

  reTryAltAlg () {
    log.log('retry with default ciphers/server hosts')
    this.doKill()
    this.connectOptions.algorithms = algAlt()
    this.altAlg = true
    return this.sshConnect()
  }

  getShellWindow (initOptions = this.initOptions) {
    return _.pick(initOptions, [
      'rows', 'cols', 'term'
    ])
  }

  getAgent () {
    return resolveSshAgent(this.initOptions)
  }

  getAuthOrder (connectOptions) {
    const authOrder = ['none']
    if (connectOptions.password !== undefined) {
      authOrder.push('password')
    }
    if (connectOptions.privateKey !== undefined) {
      authOrder.push('publickey')
    }
    if (connectOptions.agent !== undefined) {
      authOrder.push('agent')
    }
    if (connectOptions.tryKeyboard) {
      authOrder.push('keyboard-interactive')
    }
    if (
      connectOptions.privateKey !== undefined &&
      connectOptions.localHostname !== undefined &&
      connectOptions.localUsername !== undefined
    ) {
      authOrder.push('hostbased')
    }
    return authOrder
  }

  createAuthHandler (connectOptions) {
    const authOrder = this.getAuthOrder(connectOptions)
    let attemptedMethods = new Set()

    const isMethodAllowed = (type, allowedSet) => {
      if (type === 'agent') {
        return allowedSet.has('agent') || allowedSet.has('publickey')
      }
      return allowedSet.has(type)
    }

    return (authsLeft, partialSuccess) => {
      if (partialSuccess) {
        this.authPartiallySucceeded = true
        attemptedMethods = new Set()
      }

      const allowedMethods = Array.isArray(authsLeft) && authsLeft.length
        ? authsLeft
        : authOrder
      const allowedSet = new Set(allowedMethods)
      const nextAuth = authOrder.find(type => {
        return isMethodAllowed(type, allowedSet) && (partialSuccess || !attemptedMethods.has(type))
      })

      if (!nextAuth) {
        return false
      }

      attemptedMethods.add(nextAuth)
      return nextAuth
    }
  }

  adjustConnectionOrder () {
    const { initOptions } = this
    if (!initOptions.hasHopping || !initOptions.connectionHoppings || initOptions.connectionHoppings.length === 0) {
      return
    }

    const currentHostHopping = {
      host: initOptions.host,
      port: initOptions.port,
      username: initOptions.username,
      password: initOptions.password,
      privateKey: initOptions.privateKey,
      passphrase: initOptions.passphrase
    }

    const [firstHopping, ...restHoppings] = initOptions.connectionHoppings
    const pickProps = _.pick(firstHopping, [
      'host', 'port', 'username', 'password', 'privateKey', 'passphrase', 'certificate'
    ])
    Object.assign(initOptions, pickProps)
    initOptions.connectionHoppings = [...restHoppings, currentHostHopping]
  }

  isLikely2FAPrompts (prompts) {
    if (!prompts || !prompts.length) return false
    const defaultKeywords = [
      'verification code',
      'otp',
      'one-time',
      'two-factor',
      '2fa',
      'totp',
      'authenticator',
      'duo',
      'yubikey',
      'security code',
      'mfa',
      'passcode'
    ]
    const rawKeywords = this.initOptions?.keyword2FA
    const twofaKeywords = Array.isArray(rawKeywords)
      ? rawKeywords
      : typeof rawKeywords === 'string'
        ? rawKeywords.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
        : []
    const finalKeywords = twofaKeywords.length
      ? twofaKeywords.map(s => s.toLowerCase())
      : defaultKeywords
    return prompts.some(p => {
      const text = (p.prompt || '').toLowerCase()
      return finalKeywords.some(kw => text.includes(kw))
    })
  }

  onKeyboardEvent (options) {
    if (options?.mode !== 'confirm' && this.initOptions.interactiveValues) {
      return Promise.resolve(this.initOptions.interactiveValues.split('\n'))
    }
    // Auto-fill password prompt if we have a saved password
    const { prompts } = options
    if (prompts && prompts.length === 1 && this.initOptions.password) {
      const prompt = prompts[0]
      const promptText = (prompt.prompt || '').toLowerCase()
      // Check if this is a password prompt (hidden input, contains "password" or is empty)
      if (!prompt.echo && (promptText.includes('password') || promptText === '')) {
        return Promise.resolve([this.initOptions.password])
      }
    }

    const id = generate()
    this.ws?.s({
      id,
      action: 'session-interactive',
      ..._.pick(this.initOptions, [
        'interactiveValues',
        'tabId'
      ]),
      options
    })
    return new Promise((resolve, reject) => {
      this.ws?.once((arg) => {
        const { results } = arg
        if (_.isEmpty(results)) {
          return reject(new Error('User cancel'))
        }
        resolve(results)
      }, id)
    })
  }

  async getPrivateKeysInJumpServer (conn) {
    const r = await this.runCmd('ls ~/.ssh', conn)
      .catch(err => {
        log.error(err)
      })
    return r
      ? r.split('\n')
        .filter(d => d.endsWith('.pub'))
        .map(d => `~/.ssh/${d}`.replace('.pub', ''))
      : []
  }

  catPrivateKeyInJumpServer (conn, filePath) {
    return this.runCmd(`cat ${filePath}`, conn)
  }

  async readPrivateKeyInJumpServer (conn) {
    const { hoppingOptions } = this
    if (this.jumpSshKeys) {
      if (this.jumpSshKeys.length > 0) {
        const p = this.jumpSshKeys.shift()
        this.jumpPrivateKeyPathFrom = p
        hoppingOptions.privateKey = await this.catPrivateKeyInJumpServer(conn, p)
      } else if (this.jumpSshKeys.length === 0) {
        delete hoppingOptions.privateKey
        delete this.jumpSshKeys
        hoppingOptions.sshKeysDrain = true
      }
      return
    }
    if (hoppingOptions.sshKeysDrain || hoppingOptions.password || hoppingOptions.privateKey) {
      return null
    }
    const list = await this.getPrivateKeysInJumpServer(conn)
    if (list.length) {
      const p = list.shift()
      this.jumpPrivateKeyPathFrom = p
      hoppingOptions.privateKey = await this.catPrivateKeyInJumpServer(conn, p)
      this.jumpSshKeys = list
    } else {
      // No private keys found in jump server, mark as drained so we can prompt for password
      hoppingOptions.sshKeysDrain = true
    }
  }

  handleKeyboardEventForRetryJump (options) {
    return this.onKeyboardEvent(options)
      .then(data => {
        if (data && data[0]) {
          this.hoppingOptions.passphrase = data[0]
          this.jumpSshKeys && this.jumpSshKeys.unshift(this.jumpPrivateKeyPathFrom)
        }
        return this.jumpConnect(true, true)
      })
      .catch(e => {
        log.error('errored get passphrase for', this.jumpHostFrom, this.jumpPrivateKeyPathFrom, e)
        return this.jumpConnect(true, false)
      })
  }

  async retryJump () {
    const next = await this.doSshConnect(
      undefined,
      this.nextConn,
      this.hoppingOptions,
      !this.isLast
    )
      .then(() => {
        this.jumpHostFrom = this.initHoppingOptions.host
        this.jumpPortFrom = this.initHoppingOptions.port
        return this.nextConn
      })
      .catch(err => err)

    const isError = next instanceof Error
    if (!isError) {
      return next
    }
    const err = next
    log.error('error when do jump connect', this.nextHost, this.nextPort)
    if (err.message.includes('passphrase')) {
      const options = {
        name: `passphase for ${this.jumpHostFrom}/${this.jumpPrivateKeyPathFrom}`,
        instructions: [''],
        prompts: [{
          echo: false,
          prompt: 'passphase'
        }]
      }
      return this.handleKeyboardEventForRetryJump(options)
    } else if (
      !this.jumpSshKeys &&
      !this.hoppingOptions.sshKeysDrain &&
      !this.hoppingOptions.password &&
      !this.hoppingOptions.privateKey &&
      err.message.includes(failMsg)
    ) {
      // SSH agent failed or no agent, try reading private keys from jump server
      // This will read ~/.ssh keys and retry
      return this.jumpConnect(true, false)
    } else if (
      this.hoppingOptions.sshKeysDrain &&
      !this.hoppingOptions.password &&
      err.message.includes(failMsg)
    ) {
      // All private keys exhausted, ask for password
      const options = {
        name: `password for ${this.hoppingOptions.username}@${this.initHoppingOptions.host}`,
        instructions: [''],
        prompts: [{
          echo: false,
          prompt: 'password'
        }]
      }
      return this.onKeyboardEvent(options)
        .then(data => {
          if (data && data[0]) {
            this.hoppingOptions.password = data[0]
            return this.jumpConnect(true, true)
          } else if (data && data[0] === '') {
            throw err
          }
        })
        .catch(err => {
          log.error('errored get password for', err)
          throw err
        })
    } else if (
      this.jumpSshKeys
    ) {
      return this.jumpConnect(true, false)
    } else {
      throw err
    }
  }

  async jumpConnect (reBuildSock = false, skipReadKeys = false) {
    if (reBuildSock) {
      this.hoppingOptions.sock.end()
      this.hoppingOptions.sock = await this.forwardOut(this.conn, this.initHoppingOptions)
    }
    // Only read private keys if skipReadKeys is false
    // On first connect, we skip reading keys to let SSH agent try first
    // If SSH agent fails, we then read and try private keys
    if (!skipReadKeys) {
      await this.readPrivateKeyInJumpServer(this.conn)
    }
    return this.retryJump()
  }

  forwardOut (conn, hopping) {
    return new Promise((resolve, reject) => {
      conn.forwardOut('127.0.0.1', 0, hopping.host, hopping.port, async (err, stream) => {
        if (err) {
          log.error(`forwardOut to ${hopping.host}:${hopping.port} error: ` + err)
          this.endConns()
          return reject(err)
        }
        resolve(stream)
      })
    })
  }

  async jump () {
    const sock = await this.forwardOut(this.conn, this.initHoppingOptions)
    const hopping = deepCopy(this.initHoppingOptions)
    delete hopping.host
    delete hopping.port
    this.nextHost = hopping.host
    this.nextPort = hopping.port
    this.hoppingOptions = {
      sock,
      ...hopping
    }
    const { Client } = require('@electerm/ssh2')
    this.nextConn = new Client()
    // If we have an agent and no explicit privateKey/password, try agent first
    // by skipping reading private keys from jump server
    const hasAgent = !!this.hoppingOptions.agent
    const hasExplicitAuth = this.hoppingOptions.password || this.hoppingOptions.privateKey
    const skipReadKeys = hasAgent && !hasExplicitAuth
    await this.jumpConnect(false, skipReadKeys)
    return this.nextConn
  }

  async hopping (connectionHoppings) {
    this.conns = []
    this.jumpHostFrom = this.initOptions.host
    this.jumpPortFrom = this.initOptions.port
    const len = connectionHoppings.length
    for (let i = 0; i < len; i++) {
      const hopping = connectionHoppings[i]
      this.conns.push(this.conn)
      this.initHoppingOptions = {
        ...hopping,
        agent: this.getAgent(),
        ...this.getShareOptions()
      }
      this.isLast = i === len - 1
      const conn = await this.jump()
      if (conn) {
        this.conn = conn
      }
    }
  }

  endConns () {
    this.conn && this.conn.end && this.conn.end()
    while (this.conns && this.conns.length) {
      const conn = this.conns.shift()
      conn && conn.end()
    }
  }

  async runTunnel (sshTunnel) {
    return sshTunnelFuncs[sshTunnel.sshTunnel]({
      ...sshTunnel,
      conn: this.conn
    })
      .then(r => {
        return {
          sshTunnel
        }
      })
      .catch(err => {
        log.error('error when do sshTunnel', err)
        return {
          error: err.message,
          sshTunnel
        }
      })
  }

  async onInitSshReady () {
    const {
      initOptions,
      isTest,
      shellOpts,
      shellWindow
    } = this
    if (
      initOptions.connectionHoppings?.length
    ) {
      await this.hopping(initOptions.connectionHoppings)
    }
    if (isTest) {
      this.endConns()
      return
    } else if (initOptions.enableSsh === false) {
      globalState.setSession(this.pid, this)
      return this
    }
    const { sshTunnels = [] } = initOptions
    const sshTunnelResults = []
    for (const sshTunnel of sshTunnels) {
      if (
        sshTunnel &&
        sshTunnel.sshTunnel &&
        sshTunnel.sshTunnelLocalPort
      ) {
        const result = await this.runTunnel(sshTunnel)
        sshTunnelResults.push(result)
      }
    }
    if (!this.ws) {
      this.sshTunnelResults = sshTunnelResults
    } else {
      this.ws?.s({
        update: {
          sshTunnelResults
        },
        action: 'ssh-tunnel-result',
        tabId: this.initOptions.srcTabId
      })
    }
    return new Promise((resolve, reject) => {
      this.conn.shell(
        shellWindow,
        shellOpts,
        (err, channel) => {
          if (err) {
            return reject(err)
          }
          this.channel = channel
          this.setNoDelay(true)
          globalState.setSession(this.pid, this)
          resolve(this)
        }
      )
    })
  }

  shell (conn, shellWindow, shellOpts) {
    return new Promise((resolve, reject) => {
      conn.shell(
        shellWindow,
        shellOpts,
        (err, channel) => {
          if (err) {
            return reject(err)
          }
          resolve(channel)
        }
      )
    })
  }

  getSSHKeys () {
    const { sshKeysPath } = process.env
    try {
      return require('fs')
        .readdirSync(sshKeysPath)
        .filter(file => file.endsWith('.pub'))
        .map(file => pathResolve(sshKeysPath, file.replace('.pub', '')))
    } catch (e) {
      log.error(e)
      return []
    }
  }

  getPrivateKey (connectOptions) {
    if (this.sshKeys) {
      if (this.sshKeys.length > 0) {
        const p = this.sshKeys.shift()
        this.privateKeyPath = p
        connectOptions.privateKey = require('fs').readFileSync(p, 'utf8')
      } else if (this.sshKeys.length === 0) {
        this.connectOptions.passphrase = this.initOptions.passphrase
        delete this.connectOptions.privateKey
        delete this.sshKeys
      }
      return
    }
    const list = this.getSSHKeys()
    if (list.length) {
      const p = list.shift()
      this.privateKeyPath = p
      connectOptions.privateKey = require('fs').readFileSync(p, 'utf8')
      this.sshKeys = list
    }
  }

  doSshConnect = (
    info,
    conn = this.conn,
    connectOptions = this.connectOptions,
    skipX11 = false
  ) => {
    const {
      initOptions
    } = this
    if (info && info.socket) {
      delete connectOptions.host
      delete connectOptions.port
      connectOptions.sock = info.socket
    }
    this.hostVerificationError = null
    const verifyTarget = this.getHostVerificationTarget(connectOptions)
    connectOptions.hostVerifier = createHostVerifier({
      ...verifyTarget,
      confirm: async (options) => {
        const results = await this.onKeyboardEvent(options)
        return results && results[0] === (options.confirmResult || 'trust')
      },
      onError: (err) => {
        this.hostVerificationError = err
      }
    })
    this.authPartiallySucceeded = false
    connectOptions.authHandler = this.createAuthHandler(connectOptions)
    return new Promise((resolve, reject) => {
      conn.on('keyboard-interactive', async (
        name,
        instructions,
        instructionsLang,
        prompts,
        finish
      ) => {
        if (initOptions.ignoreKeyboardInteractive) {
          return finish(
            (prompts || []).map((n, i) => {
              return i ? '' : (connectOptions.password || '')
            })
          )
        }
        // Detect 2FA: if we connected with password and prompts look like 2FA,
        // disconnect and retry without password so keyboard-interactive handles both
        if (
          !this.retry2FA &&
          !this.authPartiallySucceeded &&
          connectOptions.password &&
          this.isLikely2FAPrompts(prompts)
        ) {
          this.retry2FA = true
          conn.end()
          return reject(new Error('2FA_RETRY'))
        }
        const options = {
          name,
          instructions,
          instructionsLang,
          prompts
        }
        this.onKeyboardEvent(options)
          .then(finish)
          .catch(reject)
      })
      if (!skipX11) {
        conn.on('x11', (inf, accept) => {
          let start = 0
          const maxRetry = 100
          const portStart = 6000
          const maxPort = portStart + maxRetry
          const retry = () => {
            if (start >= maxPort) {
              return
            }
            const xserversock = new net.Socket()
            let xclientsock
            xserversock
              .on('connect', function () {
                xclientsock = accept()
                xclientsock.pipe(xserversock).pipe(xclientsock)
              })
              .on('error', (e) => {
                log.error(e)
                xserversock.destroy()
                start = start === maxRetry ? portStart : start + 1
                retry()
              })
              .on('close', () => {
                xserversock.destroy()
                xclientsock && xclientsock.destroy()
              })
            if (start < portStart) {
              const addr = (this.display || '').includes('/tmp')
                ? this.display
                : `/tmp/.X11-unix/X${start}`
              xserversock.connect(addr)
            } else {
              xserversock.connect(start, '127.0.0.1')
            }
          }
          retry()
        })
      }
      conn
        .on('ready', () => resolve(true))
        .on('error', err => {
          reject(this.hostVerificationError || err)
        })
        .connect(connectOptions)
    })
  }

  getShareOptions () {
    const { initOptions } = this
    const all = {
      tryKeyboard: true,
      readyTimeout: initOptions.readyTimeout,
      keepaliveCountMax: initOptions.keepaliveCountMax,
      keepaliveInterval: initOptions.keepaliveInterval,
      algorithms: algDefault()
    }
    if (initOptions.serverHostKey && initOptions.serverHostKey.length) {
      all.algorithms.serverHostKey = deepCopy(initOptions.serverHostKey)
    }
    if (initOptions.cipher && initOptions.cipher.length) {
      all.algorithms.cipher = deepCopy(initOptions.cipher)
    }
    if (initOptions.compress && initOptions.compress.length) {
      all.algorithms.compress = deepCopy(initOptions.compress)
    }
    return all
  }

  getHostVerificationTarget (connectOptions = this.connectOptions) {
    if (connectOptions === this.hoppingOptions && this.initHoppingOptions) {
      return {
        host: this.initHoppingOptions.host,
        port: this.initHoppingOptions.port
      }
    }
    return {
      host: connectOptions.host || this.initOptions.host,
      port: connectOptions.port || this.initOptions.port
    }
  }

  buildConnectOptions () {
    const { initOptions } = this
    const connectOptions = Object.assign(
      this.getShareOptions(),
      {
        agent: this.getAgent()
      },
      _.pick(initOptions, [
        'host',
        'port',
        'username',
        'password',
        'privateKey',
        'passphrase',
        'certificate',
        'encode'
      ])
    )
    if (initOptions.isMFA) {
      this.retry2FA = true
      delete connectOptions.password
    }
    if (initOptions.debug) {
      connectOptions.debug = log.log
    }
    if (!connectOptions.passphrase) {
      delete connectOptions.passphrase
    }
    return connectOptions
  }

  buildShellOpts () {
    const { initOptions } = this
    let x11
    if (initOptions.x11 === true) {
      x11 = {
        cookie: this.x11Cookie
      }
    }
    const shellOpts = {
      x11
    }
    shellOpts.env = this.getEnv(initOptions)
    return shellOpts
  }

  getUserName (connectOptions) {
    const options = {
      name: 'username',
      instructions: [''],
      prompts: [{
        echo: false,
        prompt: ''
      }]
    }
    return this.onKeyboardEvent(options)
      .then(data => {
        const username = data ? data[0] : ''
        if (username) {
          this.connectOptions.username = data[0]
        }
        return this.sshConnect()
      })
      .catch(e => {
        log.error('errored get username for', e)
        return this.nextTry(e)
      })
  }

  async sshConnect () {
    const { initOptions } = this
    const { Client } = require('@electerm/ssh2')
    this.conn = new Client()
    this.connectOptions = this.connectOptions || this.buildConnectOptions()
    const {
      connectOptions
    } = this
    if (!connectOptions.username) {
      return this.getUserName(connectOptions)
    }
    if (
      this.sshKeys ||
      (!connectOptions.privateKey && !connectOptions.password && !initOptions.password)
    ) {
      this.getPrivateKey(this.connectOptions)
    }
    this.shellWindow = this.shellWindow || this.getShellWindow()
    this.shellOpts = this.shellOpts || this.buildShellOpts()
    const info = initOptions.proxy
      ? await proxySock({
        readyTimeout: initOptions.readyTimeout,
        host: initOptions.host,
        port: initOptions.port,
        proxy: initOptions.proxy
      })
      : undefined
    const skipX11 = !!initOptions.connectionHoppings?.length
    const result = await this.doSshConnect(
      info,
      undefined,
      undefined,
      skipX11
    ).catch(err => err)
    if (!(result instanceof Error)) {
      return this.onInitSshReady()
    }
    const err = result
    log.error('error when do sshConnect', err, this.privateKeyPath)
    if (
      err.message.includes(csFailMsg) &&
      !this.altAlg
    ) {
      return this.reTryAltAlg()
    } else if (err.message === '2FA_RETRY') {
      log.log('2FA detected, retrying without password in auth')
      delete this.connectOptions.password
      return this.sshConnect()
    } else if (err.message.includes('passphrase')) {
      const options = {
        name: `passphase for ${this.privateKeyPath || 'privateKey'}`,
        instructions: [''],
        prompts: [{
          echo: false,
          prompt: 'passphase'
        }]
      }
      return this.onKeyboardEvent(options)
        .then(data => {
          const pass = data ? data[0] : ''
          if (pass) {
            this.connectOptions.passphrase = data[0]
            this.sshKeys && this.sshKeys.unshift(this.privateKeyPath)
          }
          return this.nextTry(err, !!pass)
        })
        .catch(e => {
          log.error('errored get passphrase for', this.privateKeyPath, e)
          return this.nextTry(err)
        })
    } else if (
      this.sshKeys &&
      err.message.includes(failMsg)
    ) {
      return this.nextTry(err)
    } else if (
      !this.retry2FA &&
      !this.connectOptions.password &&
      this.initOptions.password
    ) {
      this.connectOptions.password = this.initOptions.password
      return this.sshConnect()
    } else if (
      err.message.includes(failMsg) &&
      !this.connectOptions.password
    ) {
      const options = {
        name: `password for ${this.initOptions.username}@${this.initOptions.host}`,
        instructions: [''],
        prompts: [{
          echo: false,
          prompt: 'password'
        }]
      }
      return this.onKeyboardEvent(options)
        .then(data => {
          if (data && data[0]) {
            this.connectOptions.password = data[0]
            return this.sshConnect()
          } else if (data && data[0] === '') {
            throw err
          }
        })
        .catch(err => {
          log.error('errored get password for', err)
          throw err
        })
    }
    return this.nextTry(err)
  }

  nextTry (err, forceRetry = false) {
    if (
      this.sshKeys || forceRetry
    ) {
      log.log('retry with next ssh key')
      if (this.conn) {
        this.conn.end()
      }
      return this.sshConnect()
    } else {
      throw normalizeSshConnectionError(err, this.connectOptions || this.initOptions)
    }
  }

  resize (cols, rows) {
    this.channel?.setWindow(rows, cols)
  }

  on (event, cb) {
    this.channel.on(event, cb)
    this.channel.stderr.on(event, cb)
  }

  write (data) {
    const encode = this.connectOptions?.encode || this.initOptions?.encode
    if (encode && !utf8Aliases.has(encode.toLowerCase()) && typeof data === 'string') {
      try {
        const buf = iconv.encode(data, encode)
        this.channel?.write(buf)
        return
      } catch (e) {
        log.warn('iconv encode failed, falling back to raw write:', e.message)
      }
    }
    this.channel?.write(data)
  }

  setNoDelay (noDelay = true) {
    try {
      if (this.conn && typeof this.conn.setNoDelay === 'function') {
        this.conn.setNoDelay(noDelay)
      }
    } catch (e) {
      log.warn('failed to set ssh noDelay', e)
    }
  }

  kill () {
    this.initOptions = null
    this.connectOptions = null
    this.alg = null
    this.shellWindow = null
    this.shellOpts = null
    this.conn = null
    this.sshKeys = null
    this.privateKeyPath = null
    this.display = null
    this.x11Cookie = null
    this.conns = null
    this.jumpSshKeys = null
    this.jumpPrivateKeyPathFrom = null
    this.hoppingOptions = null
    this.initHoppingOptions = null
    this.nextConn = null
    this.doKill()
  }

  doKill () {
    if (this.sessionLogger) {
      this.sessionLogger.destroy()
    }
    this.channel && this.channel.end()
    delete this.channel
    this.onEndConn()
    // Clean up any remaining connection
    if (this.conn) {
      this.conn.end()
      this.conn = null
    }
  }

  getLocalEnv () {
    return {
      env: process.env
    }
  }

  getDisplay () {
    return new Promise((resolve) => {
      exec('echo $DISPLAY', this.getLocalEnv(), (err, out, e) => {
        if (err || e) {
          resolve('')
        } else {
          resolve((out || '').trim())
        }
      })
    })
  }

  getX11Cookie () {
    return new Promise((resolve) => {
      exec('xauth list :0', this.getLocalEnv(), (err, out, e) => {
        if (err || e) {
          resolve('')
        } else {
          const s = out || ''
          const reg = /MIT-MAGIC-COOKIE-1 +([\d\w]{1,38})/
          const arr = s.match(reg)
          resolve(
            arr ? arr[1] || '' : ''
          )
        }
      })
    })
  }

  init () {
    return this.remoteInitProcess()
  }
}

const TerminalSsh = commonExtends(TerminalSshBase)

exports.session = function (initOptions, ws) {
  return (new TerminalSsh(initOptions, ws)).init()
}

exports.normalizeSshConnectionError = normalizeSshConnectionError

/**
 * test ssh connection
 * @param {object} options
 */
exports.test = (options, ws) => {
  return (new TerminalSsh(options, ws, true))
    .init()
    .then(() => true)
    .catch((err) => {
      const normalized = normalizeSshConnectionError(err, options)
      log.error('test ssh error', normalized)
      throw normalized
    })
}
