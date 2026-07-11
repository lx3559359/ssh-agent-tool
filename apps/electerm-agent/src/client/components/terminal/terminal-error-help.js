function includesAny (text, patterns) {
  return patterns.some(pattern => pattern.test(text))
}

export function buildTerminalErrorTips (message = '') {
  const text = String(message || '')
  if (!text.trim()) {
    return []
  }

  if (includesAny(text, [/认证失败/i, /authentication/i, /permission denied/i])) {
    return [
      '检查账号、密码、私钥和私钥口令是否正确。',
      '确认服务器允许当前认证方式，例如 PasswordAuthentication 或 PubkeyAuthentication。',
      '可以先编辑连接补全认证信息，再重新连接。'
    ]
  }

  if (includesAny(text, [/主机密钥/i, /主机指纹/i, /host key/i, /known_hosts/i])) {
    return [
      '请先确认服务器主机指纹是否可信，避免连接到错误服务器。',
      '如果服务器重装或 IP 复用，清理旧 known_hosts 记录后再重新连接。'
    ]
  }

  if (includesAny(text, [/超时/i, /timeout/i, /timed out/i, /ECONNREFUSED/i, /ECONNRESET/i, /ENOTFOUND/i, /EHOSTUNREACH/i, /ENETUNREACH/i])) {
    return [
      '检查 IP、端口和协议是否填写正确，默认 SSH 端口通常是 22。',
      '确认服务器 SSH 服务正在运行，并且防火墙或安全组已放行该端口。',
      '如果使用代理或跳板机，请先确认代理、跳板机和本机网络可用。'
    ]
  }

  return [
    '检查连接配置、网络状态和服务器 SSH 服务状态。',
    '可以打开会话日志或导出诊断包，保留错误现场继续排查。'
  ]
}
