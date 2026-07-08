const nonRetryablePatterns = [
  /SSH\s+认证失败/i,
  /authentication.*(failed|failure)/i,
  /All configured authentication methods failed/i,
  /permission denied/i,
  /access denied/i,
  /SSH\s+私钥无法使用/i,
  /private key.*(parse|format|passphrase)/i,
  /cannot parse privatekey|invalid private key|unsupported key format/i,
  /SSH\s+私钥文件无法读取/i,
  /SSH\s+主机密钥校验失败/i,
  /host key|known_hosts|fingerprint/i,
  /SSH\s+目标端口不是 SSH 服务/i,
  /protocol mismatch|expected ssh|bad packet length/i,
  /SSH\s+算法不兼容/i,
  /no matching .*?(algorithm|cipher|key exchange|host key|kex)/i
]

export function shouldRetryAutoReconnectError (message = '') {
  const text = String(message || '')
  if (!text) {
    return true
  }
  return !nonRetryablePatterns.some(pattern => pattern.test(text))
}
