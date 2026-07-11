const nonRetryablePatterns = [
  /SSH\s*(认证失败|璁よ瘉澶辫触)/i,
  /authentication.*(failed|failure)/i,
  /All configured authentication methods failed/i,
  /permission denied|access denied/i,
  /SSH\s*(私钥无法使用|绉侀挜鏃犳硶浣跨敤)/i,
  /private key.*(parse|format|passphrase)/i,
  /cannot parse privatekey|invalid private key|unsupported key format/i,
  /SSH\s*(私钥文件无法读取|绉侀挜鏂囦欢鏃犳硶璇诲彇)/i,
  /SSH\s*(主机密钥校验失败|涓绘満瀵嗛挜鏍￠獙澶辫触)/i,
  /host key|known_hosts|fingerprint/i,
  /SSH\s*(目标端口不是 SSH 服务|鐩爣绔彛涓嶆槸 SSH 鏈嶅姟)/i,
  /protocol mismatch|expected ssh|bad packet length/i,
  /SSH\s*(算法不兼容|绠楁硶涓嶅吋瀹)/i,
  /no matching .*?(algorithm|cipher|key exchange|host key|kex)/i
]

export const SSH_RECONNECT_DELAYS = Object.freeze([
  3000,
  6000,
  12000,
  30000,
  30000
])

export function shouldRetryAutoReconnectError (message = '') {
  const text = String(message || '')
  if (!text) {
    return true
  }
  return !nonRetryablePatterns.some(pattern => pattern.test(text))
}

export function createSshReconnectScheduler ({
  clock = globalThis,
  onReconnect,
  onStateChange = () => {},
  initialAttempt = 0,
  delays = SSH_RECONNECT_DELAYS
}) {
  let attempt = Math.max(0, Math.min(Number(initialAttempt) || 0, delays.length))
  let reconnectTimer = null
  let countdownInterval = null
  let stopped = false

  const clearScheduled = () => {
    if (reconnectTimer !== null) {
      clock.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (countdownInterval !== null) {
      clock.clearInterval(countdownInterval)
      countdownInterval = null
    }
  }

  const publish = (status, countdown = null) => {
    onStateChange({
      status,
      attempt,
      maxAttempts: delays.length,
      countdown
    })
  }

  const runReconnect = () => {
    if (stopped || reconnectTimer === null) {
      return false
    }
    clearScheduled()
    publish('reconnecting')
    onReconnect(attempt)
    return true
  }

  return {
    schedule () {
      if (stopped || reconnectTimer !== null) {
        return false
      }
      if (attempt >= delays.length) {
        publish('failed')
        return false
      }

      const delay = delays[attempt]
      attempt += 1
      let countdown = Math.ceil(delay / 1000)
      publish('waiting', countdown)

      countdownInterval = clock.setInterval(() => {
        countdown -= 1
        if (countdown <= 0) {
          if (countdownInterval !== null) {
            clock.clearInterval(countdownInterval)
            countdownInterval = null
          }
          return
        }
        publish('waiting', countdown)
      }, 1000)

      reconnectTimer = clock.setTimeout(runReconnect, delay)
      return true
    },

    reconnectNow () {
      return runReconnect()
    },

    stop () {
      stopped = true
      clearScheduled()
      publish('stopped')
    },

    reset () {
      clearScheduled()
      stopped = false
      attempt = 0
      onStateChange(null)
    },

    dispose () {
      stopped = true
      clearScheduled()
    },

    getAttempt () {
      return attempt
    }
  }
}
