const limits = {
  services: 50,
  processes: 20,
  networks: 20,
  ports: 30,
  containers: 50,
  platforms: 30,
  alerts: 50,
  probes: 20,
  rawOutput: 2000,
  string: 1000,
  markdown: 28000
}

const sensitiveKey = /password|passphrase|privatekey|secret|token|apikey|api_key|credential/i
const redacted = '[已脱敏]'

function redactSensitiveText (value) {
  return String(value)
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, `$1${redacted}`)
    .replace(/((?:--?)(?:password|passphrase|secret|token|api[-_]?key|private[-_]?key|credential)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, `$1${redacted}`)
    .replace(/(\b(?:password|passphrase|secret|token|api[-_]?key|private[-_]?key|credential)\b\s*(?:=|:)\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, `$1${redacted}`)
    .replace(/\bsk-[a-z0-9_-]{6,}\b/gi, redacted)
}

function cleanValue (value, key = '') {
  if (sensitiveKey.test(key)) return undefined
  if (typeof value === 'string') {
    const limit = key === 'rawOutput' ? limits.rawOutput : limits.string
    return redactSensitiveText(value).slice(0, limit)
  }
  if (Array.isArray(value)) return value.map(item => cleanValue(item)).filter(item => item !== undefined)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .map(([childKey, childValue]) => [childKey, cleanValue(childValue, childKey)])
      .filter(([, childValue]) => childValue !== undefined)
  )
}

function capArray (value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : []
}

function boundedSnapshot (snapshot = {}) {
  const clean = cleanValue(snapshot)
  const resources = clean.resources || {}
  return {
    ...clean,
    services: capArray(clean.services, limits.services),
    resources: {
      ...resources,
      processes: capArray(resources.processes, limits.processes)
    },
    networks: capArray(clean.networks, limits.networks).map(network => ({
      ...network,
      listeningPorts: capArray(network.listeningPorts, limits.ports)
    })),
    containers: capArray(clean.containers, limits.containers),
    platforms: capArray(clean.platforms, limits.platforms),
    alerts: capArray(clean.alerts, limits.alerts),
    probes: capArray(clean.probes, limits.probes).map(probe => ({
      ...probe,
      rawOutput: typeof probe.rawOutput === 'string'
        ? probe.rawOutput.slice(0, limits.rawOutput)
        : probe.rawOutput
    }))
  }
}

function statusLabel (status) {
  return {
    healthy: '正常',
    warning: '警告',
    critical: '异常',
    unknown: '未知'
  }[status] || '未知'
}

function listLines (items, formatter, emptyText = '暂无') {
  return items.length ? items.map(formatter) : [`- ${emptyText}`]
}

export function buildServerStatusJson (snapshot = {}) {
  return JSON.stringify(boundedSnapshot(snapshot), null, 2)
}

export function buildServerStatusMarkdown (snapshot = {}) {
  const data = boundedSnapshot(snapshot)
  const endpoint = data.endpoint || {}
  const system = data.system || {}
  const summary = data.summary || {}
  const services = data.services || []
  const networks = data.networks || []
  const alerts = data.alerts || []
  const lines = [
    '# ShellPilot 服务器状态报告',
    '',
    `- 检测时间：${data.collectedAt || '未知'}`,
    `- 服务器：${endpoint.username ? `${endpoint.username}@` : ''}${endpoint.host || '未知'}${endpoint.port ? `:${endpoint.port}` : ''}`,
    `- 主机名：${system.hostname || '未知'}`,
    `- 操作系统：${system.osName || system.prettyName || '未知'}`,
    `- 整体状态：${statusLabel(data.overallStatus)}`,
    '',
    '## 健康摘要',
    '',
    `- 可用内存：${summary.memoryAvailablePercent ?? '未知'}%`,
    `- 标准化负载：${summary.normalizedLoad ?? '未知'}`,
    `- 失败服务：${summary.failedServices || 0}`,
    `- 受限探针：${summary.restrictedProbes || 0}`,
    '',
    '## 告警',
    '',
    ...listLines(alerts, alert => `- [${statusLabel(alert.status)}] ${alert.message || alert.target || alert.code}`),
    '',
    `## 服务（最多 ${limits.services} 项）`,
    '',
    ...listLines(services, service => `- ${service.name || service.unit || '未知服务'}：${service.activeState || service.state || service.status || '未知'}`),
    '',
    '## 网络',
    '',
    ...listLines(networks, network => {
      const addresses = Array.isArray(network.addresses) ? network.addresses.join(', ') : ''
      const portCount = Array.isArray(network.listeningPorts) ? network.listeningPorts.length : 0
      return `- ${network.name || '未知网卡'}：${addresses || '无地址'}，监听端口 ${portCount} 个`
    })
  ]
  return lines.join('\n').slice(0, limits.markdown)
}
