function sections (output = '') {
  const result = {}
  let current = ''
  for (const line of String(output).replace(/\r/g, '').split('\n')) {
    const marker = line.match(/^__([A-Z0-9_]+)__$/)
    if (marker) {
      current = marker[1]
      result[current] = []
    } else if (current) {
      result[current].push(line)
    }
  }
  return result
}

function firstLine (value = []) {
  return value.find(line => line.trim())?.trim() || ''
}

function numberOrNull (value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function unquote (value = '') {
  const text = String(value).trim()
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1)
  }
  return text
}

function keyValues (lines = []) {
  const values = {}
  for (const line of lines) {
    const index = line.indexOf('=')
    if (index < 1) continue
    values[line.slice(0, index).trim()] = unquote(line.slice(index + 1))
  }
  return values
}

function percent (value = '') {
  const parsed = Number.parseFloat(String(value).replace('%', ''))
  return Number.isFinite(parsed) ? parsed : null
}

function parseTableLine (line = '') {
  return line.trim().split(/\s+/)
}

function parseEndpoint (value = '') {
  const match = String(value).match(/(?:\[([^\]]+)\]|([^:]+)):(\d+|\*)$/)
  if (!match) return { address: value, port: null }
  return {
    address: match[1] || match[2],
    port: numberOrNull(match[3])
  }
}

export function parseSystemProbe (output = '') {
  const data = sections(output)
  const os = keyValues(data.OS_RELEASE)
  return {
    hostname: firstLine(data.HOSTNAME),
    osName: os.NAME || '',
    osVersion: os.VERSION_ID || '',
    prettyName: os.PRETTY_NAME || '',
    osId: os.ID || '',
    osFamily: (os.ID_LIKE || '').split(/\s+/).filter(Boolean),
    kernel: firstLine(data.KERNEL),
    cpuCores: numberOrNull(firstLine(data.CPU_CORES)),
    uptimeSeconds: numberOrNull(firstLine(data.UPTIME_SECONDS)),
    initSystem: firstLine(data.INIT)
  }
}

export function parseResourcesProbe (output = '') {
  const data = sections(output)
  const loadParts = parseTableLine(firstLine(data.LOAD))
  const memoryValues = keyValues((data.MEMINFO || []).map(line => {
    return line.replace(/^([^:]+):\s*/, '$1=').replace(/\s+kB\s*$/i, '')
  }))
  const filesystems = []
  const filesystemMap = new Map()

  for (const line of (data.FILESYSTEMS || []).slice(1)) {
    const parts = parseTableLine(line)
    if (parts.length < 6) continue
    const item = {
      filesystem: parts[0],
      totalBytes: numberOrNull(parts[1]),
      usedBytes: numberOrNull(parts[2]),
      availableBytes: numberOrNull(parts[3]),
      usedPercent: percent(parts[4]),
      mount: parts.slice(5).join(' ')
    }
    filesystems.push(item)
    filesystemMap.set(`${item.filesystem}\0${item.mount}`, item)
  }

  for (const line of (data.INODES || []).slice(1)) {
    const parts = parseTableLine(line)
    if (parts.length < 6) continue
    const key = `${parts[0]}\0${parts.slice(5).join(' ')}`
    const item = filesystemMap.get(key)
    if (item) {
      item.inodes = numberOrNull(parts[1])
      item.inodesUsed = numberOrNull(parts[2])
      item.inodesFree = numberOrNull(parts[3])
      item.inodeUsedPercent = percent(parts[4])
    }
  }

  const processes = (data.PROCESSES || [])
    .filter(line => line.trim())
    .map(line => {
      const [pid, cpu, memory, ...command] = parseTableLine(line)
      return {
        pid: numberOrNull(pid),
        cpuPercent: numberOrNull(cpu),
        memoryPercent: numberOrNull(memory),
        command: command.join(' ')
      }
    })

  const toBytes = key => {
    const value = numberOrNull(memoryValues[key])
    return value === null ? null : value * 1024
  }

  return {
    load: {
      one: numberOrNull(loadParts[0]),
      five: numberOrNull(loadParts[1]),
      fifteen: numberOrNull(loadParts[2])
    },
    memory: {
      totalBytes: toBytes('MemTotal'),
      availableBytes: toBytes('MemAvailable'),
      freeBytes: toBytes('MemFree')
    },
    swap: {
      totalBytes: toBytes('SwapTotal'),
      freeBytes: toBytes('SwapFree')
    },
    filesystems,
    processes
  }
}

function normalizeService (values) {
  return {
    name: values.Id || values.UNIT || '',
    description: values.Description || values.DESCRIPTION || '',
    loadState: values.LoadState || values.LOAD || '',
    activeState: values.ActiveState || values.ACTIVE || '',
    subState: values.SubState || values.SUB || '',
    fragmentPath: values.FragmentPath || '',
    execStart: values.ExecStart || '',
    workingDirectory: values.WorkingDirectory || ''
  }
}

export function parseServicesProbe (output = '') {
  const text = String(output).replace(/\r/g, '').trim()
  if (!text) return []
  const services = text
    .split(/\n\s*\n/)
    .map(block => normalizeService(keyValues(block.split('\n'))))
    .filter(service => service.name)

  if (services.length) return services

  const lines = text.split('\n').filter(line => line.trim())
  const headerIndex = lines.findIndex(line => /^\s*UNIT\s+LOAD\s+ACTIVE\s+SUB\s+/i.test(line))
  if (headerIndex < 0) return []
  return lines.slice(headerIndex + 1).map(line => {
    const match = line.trim().match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/)
    if (!match || !/\.service$/i.test(match[1])) return null
    return normalizeService({
      UNIT: match[1],
      LOAD: match[2],
      ACTIVE: match[3],
      SUB: match[4],
      DESCRIPTION: match[5]
    })
  }).filter(Boolean)
}

export function parseNetworkProbe (output = '') {
  const data = sections(output)
  const interfaceMap = new Map()

  for (const line of data.LINKS || []) {
    const match = line.match(/^\d+:\s+([^:]+):\s+<([^>]*)>.*?(?:state\s+(\S+))?/i)
    if (!match) continue
    const name = match[1].split('@')[0]
    interfaceMap.set(name, {
      name,
      state: (match[3] || (match[2].includes('UP') ? 'UP' : 'UNKNOWN')).toLowerCase(),
      flags: match[2].split(',').filter(Boolean),
      addresses: []
    })
  }

  for (const line of data.ADDRESSES || []) {
    const match = line.match(/^\d+:\s+(\S+)\s+(inet6?)\s+(\S+)/i)
    if (!match) continue
    const name = match[1].split('@')[0]
    const item = interfaceMap.get(name) || {
      name,
      state: 'unknown',
      flags: [],
      addresses: []
    }
    item.addresses.push(match[3])
    interfaceMap.set(name, item)
  }

  let defaultRoute = null
  for (const line of data.ROUTES || []) {
    const match = line.match(/^default(?:\s+via\s+(\S+))?\s+dev\s+(\S+)(?:.*?\ssrc\s+(\S+))?/i)
    if (match) {
      defaultRoute = {
        gateway: match[1] || '',
        interface: match[2],
        source: match[3] || ''
      }
      break
    }
  }

  const dnsServers = (data.DNS || [])
    .map(line => line.match(/^\s*nameserver\s+(\S+)/i)?.[1])
    .filter(Boolean)

  const listeningPorts = (data.PORTS || []).map(line => {
    const parts = parseTableLine(line)
    if (parts.length < 5) return null
    const local = parseEndpoint(parts[4])
    const processMatch = line.match(/\(\("([^"]+)".*?pid=(\d+)/)
    return {
      protocol: parts[0].toLowerCase(),
      state: parts[1].toLowerCase(),
      address: local.address,
      port: local.port,
      process: processMatch?.[1] || '',
      pid: numberOrNull(processMatch?.[2])
    }
  }).filter(item => item && item.port !== null)

  return {
    interfaces: [...interfaceMap.values()],
    defaultRoute,
    dnsServers,
    listeningPorts
  }
}

export function parseFirewallProbe (output = '') {
  const data = sections(output)
  const firewalld = (data.FIREWALLD || []).join('\n').trim()
  const ufw = (data.UFW || []).join('\n').trim()
  const nftables = (data.NFTABLES || []).join('\n').trim()
  const iptables = (data.IPTABLES || []).join('\n').trim()
  let provider = 'none'
  let enabled = false
  let rules = ''

  const firewalldRunning = /^running$/im.test(firewalld)
  const ufwActive = /^status:\s*active$/im.test(ufw)
  const nftablesActive = /\b(?:table|chain|hook|policy)\b/i.test(nftables) &&
    !/not found|unavailable|permission denied|operation not permitted/i.test(nftables)
  const iptablesActive = /^(?:-A\s+|-P\s+\S+\s+(?:DROP|REJECT)\b)/im.test(iptables) &&
    !/not found|unavailable|permission denied|operation not permitted/i.test(iptables)

  if (firewalldRunning) {
    provider = 'firewalld'
    enabled = true
    rules = firewalld
  } else if (ufwActive) {
    provider = 'ufw'
    enabled = true
    rules = ufw
  } else if (nftablesActive) {
    provider = 'nftables'
    enabled = true
    rules = nftables
  } else if (iptablesActive) {
    provider = 'iptables'
    enabled = true
    rules = iptables
  } else if (firewalld) {
    provider = 'firewalld'
    rules = firewalld
  } else if (ufw) {
    provider = 'ufw'
    rules = ufw
  }

  return {
    provider,
    enabled,
    ruleCount: rules.split('\n').filter(line => line.trim()).length,
    selinux: firstLine(data.SELINUX).toLowerCase(),
    raw: { firewalld, ufw, nftables, iptables }
  }
}

export function parseSecurityProbe (output = '') {
  const data = sections(output)
  return {
    selinux: firstLine(data.SELINUX).toLowerCase(),
    appArmor: (data.APPARMOR || []).join('\n').trim(),
    loggedInUsers: (data.USERS || []).filter(line => line.trim()),
    failedLogins: (data.FAILED_LOGINS || []).filter(line => line.trim())
  }
}

function parseContainerLines (lines = [], engine) {
  return lines.filter(line => line.trim()).map(line => {
    const [name = '', service = '', status = '', ports = '', image = '', composeProject = ''] = line.split('\t')
    return { engine, name, service, status, ports, image, composeProject }
  })
}

export function parseContainersProbe (output = '') {
  const data = sections(output)
  return [
    ...parseContainerLines(data.DOCKER, 'docker'),
    ...parseContainerLines(data.PODMAN, 'podman')
  ]
}
