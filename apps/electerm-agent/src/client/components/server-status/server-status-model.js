const statusRanks = {
  unknown: 0,
  healthy: 1,
  warning: 2,
  critical: 3
}

const emptySnapshot = {
  version: 1,
  collectedAt: '',
  endpoint: {},
  overallStatus: 'unknown',
  summary: {},
  system: {},
  resources: {},
  services: [],
  networks: [],
  firewall: {},
  security: {},
  containers: [],
  platforms: [],
  alerts: [],
  probes: []
}

function clone (value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value))
}

function finiteNumber (value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function rounded (value) {
  return Math.round(value * 100) / 100
}

function usageStatus (percent) {
  if (percent >= 90) return 'critical'
  if (percent >= 80) return 'warning'
  return 'healthy'
}

function addUsageAlert (alerts, code, label, target, percent) {
  const status = usageStatus(percent)
  if (status === 'healthy') return status
  alerts.push({
    code,
    status,
    target,
    value: percent,
    message: `${target} ${label}达到 ${percent}%`
  })
  return status
}

export function worstServerStatus (statuses = []) {
  return statuses.reduce((worst, status) => {
    return (statusRanks[status] || 0) > (statusRanks[worst] || 0)
      ? status
      : worst
  }, 'unknown')
}

export function deriveServerStatusHealth (snapshot = {}) {
  const alerts = []
  const statuses = []
  const resources = snapshot.resources || {}
  const filesystems = Array.isArray(resources.filesystems) ? resources.filesystems : []
  const services = Array.isArray(snapshot.services) ? snapshot.services : []
  const probes = Array.isArray(snapshot.probes) ? snapshot.probes : []

  for (const filesystem of filesystems) {
    const target = filesystem.mount || filesystem.filesystem || '未知挂载点'
    const usedPercent = finiteNumber(filesystem.usedPercent)
    const inodeUsedPercent = finiteNumber(filesystem.inodeUsedPercent)
    if (usedPercent !== null) {
      statuses.push(addUsageAlert(alerts, 'disk-usage', '磁盘使用率', target, usedPercent))
    }
    if (inodeUsedPercent !== null) {
      statuses.push(addUsageAlert(alerts, 'inode-usage', 'inode 使用率', target, inodeUsedPercent))
    }
  }

  const memory = resources.memory || {}
  const totalBytes = finiteNumber(memory.totalBytes)
  const availableBytes = finiteNumber(memory.availableBytes)
  let memoryAvailablePercent = null
  if (totalBytes > 0 && availableBytes !== null) {
    memoryAvailablePercent = rounded(availableBytes / totalBytes * 100)
    let status = 'healthy'
    if (memoryAvailablePercent <= 10) status = 'critical'
    else if (memoryAvailablePercent <= 20) status = 'warning'
    statuses.push(status)
    if (status !== 'healthy') {
      alerts.push({
        code: 'memory-available',
        status,
        target: 'memory',
        value: memoryAvailablePercent,
        message: `可用内存仅剩 ${memoryAvailablePercent}%`
      })
    }
  }

  const cpuCores = finiteNumber(snapshot.system?.cpuCores)
  const oneMinuteLoad = finiteNumber(resources.load?.one ?? resources.load1)
  let normalizedLoad = null
  if (cpuCores > 0 && oneMinuteLoad !== null) {
    normalizedLoad = rounded(oneMinuteLoad / cpuCores)
    let status = 'healthy'
    if (normalizedLoad >= 2) status = 'critical'
    else if (normalizedLoad >= 1) status = 'warning'
    statuses.push(status)
    if (status !== 'healthy') {
      alerts.push({
        code: 'load-average',
        status,
        target: 'cpu',
        value: normalizedLoad,
        message: `1 分钟负载为 CPU 核数的 ${normalizedLoad} 倍`
      })
    }
  }

  let failedServices = 0
  for (const service of services) {
    const state = String(
      service.activeState || service.state || service.status || ''
    ).toLowerCase()
    if (state === 'failed') {
      failedServices += 1
      statuses.push('critical')
      alerts.push({
        code: 'service-failed',
        status: 'critical',
        target: service.name || service.unit || '未知服务',
        message: `${service.name || service.unit || '未知服务'} 运行失败`
      })
    } else if (state) {
      statuses.push('healthy')
    }
  }

  const restrictedProbes = probes.filter(probe => {
    return probe.status === 'restricted' || probe.status === 'permission'
  }).length
  const unsupportedProbes = probes.filter(probe => probe.status === 'unsupported').length
  const failedProbes = probes.filter(probe => {
    return probe.status === 'failed' || probe.status === 'error' || probe.status === 'timeout'
  }).length
  const successfulProbes = probes.filter(probe => probe.status === 'success').length
  if (successfulProbes) statuses.push('healthy')
  if (successfulProbes && restrictedProbes) {
    statuses.push('warning')
    alerts.push({
      code: 'probe-restricted',
      status: 'warning',
      target: 'server-status-probes',
      value: restrictedProbes,
      message: `${restrictedProbes} 项检测因权限不足未能完成`
    })
  }
  if (failedProbes) {
    statuses.push('critical')
    alerts.push({
      code: 'probe-failed',
      status: 'critical',
      target: 'server-status-probes',
      value: failedProbes,
      message: `${failedProbes} 项检测执行失败或超时，状态信息可能不完整`
    })
  }

  return {
    overallStatus: worstServerStatus(statuses),
    alerts,
    summary: {
      memoryAvailablePercent,
      normalizedLoad,
      failedServices,
      runningServices: services.length - failedServices,
      successfulProbes,
      restrictedProbes,
      unsupportedProbes,
      failedProbes
    }
  }
}

export function createServerStatusSnapshot (collected = {}, options = {}) {
  const source = clone(collected || {})
  const snapshot = {
    ...clone(emptySnapshot),
    ...source,
    version: 1,
    collectedAt: (options.now || new Date()).toISOString(),
    endpoint: source.endpoint || {},
    system: source.system || {},
    resources: source.resources || {},
    services: Array.isArray(source.services) ? source.services : [],
    networks: Array.isArray(source.networks) ? source.networks : [],
    firewall: source.firewall || {},
    security: source.security || {},
    containers: Array.isArray(source.containers) ? source.containers : [],
    platforms: Array.isArray(source.platforms) ? source.platforms : [],
    probes: Array.isArray(source.probes) ? source.probes : []
  }
  const health = deriveServerStatusHealth(snapshot)
  snapshot.overallStatus = health.overallStatus
  snapshot.summary = {
    ...(source.summary || {}),
    ...health.summary
  }
  snapshot.alerts = [
    ...(Array.isArray(source.alerts) ? source.alerts : []),
    ...health.alerts
  ]
  return snapshot
}
