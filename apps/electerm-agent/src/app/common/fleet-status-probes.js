const {
  mergeServiceInventoryResults,
  parseContainerInventory,
  parseProcessManagerInventory,
  parseSystemServiceInventory
} = require('./fleet-service-inventory')

const KiB = 1024
const FLEET_STATUS_PROBE_TIMEOUT_MS = 8000
const FLEET_SERVICE_INVENTORY_MAX_OUTPUT_BYTES = 128 * KiB

function probe (definition) {
  return Object.freeze(definition)
}

const fleetStatusProbes = Object.freeze([
  probe({
    id: 'system',
    label: 'System',
    command: "printf '__OS_RELEASE__\\n'; cat /etc/os-release 2>&1; printf '__HOSTNAME__\\n'; hostname 2>&1; printf '__KERNEL__\\n'; uname -r 2>&1; printf '__CPU_CORES__\\n'; getconf _NPROCESSORS_ONLN 2>&1; printf '__UPTIME_SECONDS__\\n'; cut -d ' ' -f 1 /proc/uptime 2>&1; printf '__INIT__\\n'; ps -p 1 -o comm= 2>&1",
    timeoutMs: FLEET_STATUS_PROBE_TIMEOUT_MS,
    maxOutputBytes: 32 * KiB,
    parse: parseSystemProbe
  }),
  probe({
    id: 'resources',
    label: 'Resources',
    command: "printf '__LOAD__\\n'; cat /proc/loadavg 2>&1; printf '__MEMINFO__\\n'; cat /proc/meminfo 2>&1; printf '__FILESYSTEMS__\\n'; df -P -B1 2>&1; printf '__INODES__\\n'; df -Pi 2>&1; printf '__PROCESSES__\\n'; ps -eo pid=,pcpu=,pmem=,comm= --sort=-pcpu 2>&1 | head -n 20",
    timeoutMs: FLEET_STATUS_PROBE_TIMEOUT_MS,
    maxOutputBytes: 64 * KiB,
    parse: parseResourcesProbe
  }),
  probe({
    id: 'services',
    label: 'Services',
    command: "if command -v systemctl >/dev/null 2>&1; then systemctl list-units --type=service --all --no-legend --no-pager 2>/dev/null | while read -r unit _; do systemctl show \"$unit\" --property=Id,Description,LoadState,ActiveState,SubState,FragmentPath,WorkingDirectory 2>&1; printf '\\n'; done; else printf '__UNSUPPORTED__ systemctl command not found\\n'; fi",
    timeoutMs: FLEET_STATUS_PROBE_TIMEOUT_MS,
    maxOutputBytes: 128 * KiB,
    parse: parseServicesProbe
  }),
  probe({
    id: 'network',
    label: 'Network',
    command: "if command -v ip >/dev/null 2>&1; then printf '__LINKS__\\n'; ip -o link show 2>&1; printf '__ADDRESSES__\\n'; ip -o address show 2>&1; printf '__ROUTES__\\n'; ip route show 2>&1; else printf '__UNSUPPORTED__ ip command not found\\n'; fi; printf '__DNS__\\n'; cat /etc/resolv.conf 2>&1; printf '__PORTS__\\n'; if command -v ss >/dev/null 2>&1; then ss -H -lntup 2>&1; elif command -v netstat >/dev/null 2>&1; then netstat -lntup 2>&1; else printf '__UNSUPPORTED__ ss and netstat command not found\\n'; fi",
    timeoutMs: FLEET_STATUS_PROBE_TIMEOUT_MS,
    maxOutputBytes: 96 * KiB,
    parse: parseNetworkProbe
  }),
  probe({
    id: 'firewall',
    label: 'Firewall',
    command: "printf '__FIREWALLD__\\n'; if command -v firewall-cmd >/dev/null 2>&1; then firewall-cmd --state 2>&1; fi; printf '__UFW__\\n'; if command -v ufw >/dev/null 2>&1; then ufw status 2>&1; fi; printf '__NFTABLES__\\n'; if command -v nft >/dev/null 2>&1; then nft list ruleset 2>&1; fi; printf '__IPTABLES__\\n'; if command -v iptables >/dev/null 2>&1; then iptables -S 2>&1; fi; printf '__SELINUX__\\n'; if command -v getenforce >/dev/null 2>&1; then getenforce 2>&1; fi",
    timeoutMs: FLEET_STATUS_PROBE_TIMEOUT_MS,
    maxOutputBytes: 96 * KiB,
    parse: parseFirewallProbe
  }),
  probe({
    id: 'security',
    label: 'Security',
    command: "printf '__SELINUX__\\n'; if command -v getenforce >/dev/null 2>&1; then getenforce 2>&1; fi; printf '__APPARMOR__\\n'; if command -v aa-status >/dev/null 2>&1; then aa-status 2>&1; fi; printf '__USERS__\\n'; who 2>&1; printf '__FAILED_LOGINS__\\n'; if command -v lastb >/dev/null 2>&1; then lastb -n 20 2>&1; fi",
    timeoutMs: FLEET_STATUS_PROBE_TIMEOUT_MS,
    maxOutputBytes: 64 * KiB,
    parse: parseSecurityProbe
  }),
  probe({
    id: 'containers',
    label: 'Containers',
    command: "printf '__DOCKER__\\n'; if command -v docker >/dev/null 2>&1; then docker ps -a --format '{{.Names}}\\t{{.Label \"com.docker.compose.service\"}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Image}}\\t{{.Label \"com.docker.compose.project\"}}' 2>&1; fi; printf '__PODMAN__\\n'; if command -v podman >/dev/null 2>&1; then podman ps -a --format '{{.Names}}\\t{{.Labels.service}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Image}}\\t{{.Labels.io.podman.compose.project}}' 2>&1; fi; if ! command -v docker >/dev/null 2>&1 && ! command -v podman >/dev/null 2>&1; then printf '__UNSUPPORTED__ docker and podman command not found\\n'; fi",
    timeoutMs: FLEET_STATUS_PROBE_TIMEOUT_MS,
    maxOutputBytes: 96 * KiB,
    parse: parseContainersProbe
  })
])

const fleetServiceInventoryProbes = Object.freeze([
  probe({
    id: 'service-inventory-system',
    label: 'System services',
    command: [
      'system_source=0;',
      "if command -v systemctl >/dev/null 2>&1; then printf '__SYSTEMD_UNITS__\\n'; if systemctl list-units --type=service --all --no-legend --no-pager --plain 2>/dev/null; then system_source=1; printf '__SYSTEMD_UNIT_FILES__\\n'; systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null || printf '__SYSTEMD_AUTOSTART_FAILED__\\nfailed\\n'; else printf '__SYSTEMD_FAILED__\\nfailed\\n'; fi; fi;",
      "if [ \"$system_source\" -eq 0 ] && command -v rc-status >/dev/null 2>&1; then printf '__OPENRC__\\n'; if rc-status --all 2>/dev/null; then system_source=1; printf '__OPENRC_AUTOSTART__\\n'; if command -v rc-update >/dev/null 2>&1; then rc-update show 2>/dev/null || printf '__OPENRC_AUTOSTART_FAILED__\\nfailed\\n'; fi; else printf '__OPENRC_FAILED__\\nfailed\\n'; fi; fi;",
      "if [ \"$system_source\" -eq 0 ]; then if command -v service >/dev/null 2>&1; then printf '__SYSV__\\n'; if service --status-all 2>&1; then system_source=1; else printf '__SYSV_FAILED__\\nfailed\\n'; fi; elif [ -d /etc/init.d ]; then printf '__SYSV__\\n'; if ls -1 /etc/init.d 2>/dev/null; then system_source=1; else printf '__SYSV_FAILED__\\nfailed\\n'; fi; fi; if [ \"$system_source\" -eq 1 ]; then if command -v chkconfig >/dev/null 2>&1; then printf '__SYSV_AUTOSTART__\\n'; chkconfig --list 2>/dev/null || printf '__SYSV_AUTOSTART_FAILED__\\nfailed\\n'; elif command -v sysv-rc-conf >/dev/null 2>&1; then printf '__SYSV_AUTOSTART__\\n'; sysv-rc-conf --list 2>/dev/null || printf '__SYSV_AUTOSTART_FAILED__\\nfailed\\n'; fi; fi; fi;",
      "if [ \"$system_source\" -eq 0 ]; then printf '__SYSTEM_MISSING__\\nmissing\\n'; fi"
    ].join(' '),
    timeoutMs: FLEET_STATUS_PROBE_TIMEOUT_MS,
    maxOutputBytes: FLEET_SERVICE_INVENTORY_MAX_OUTPUT_BYTES,
    parse: parseSystemServiceInventory
  }),
  probe({
    id: 'service-inventory-containers',
    label: 'Containers',
    command: [
      "if command -v docker >/dev/null 2>&1; then printf '__DOCKER__\\n'; if docker ps -a --format '{{.ID}}\\t{{.Names}}\\t{{.State}}\\t{{.Status}}\\t{{.Label \"com.docker.compose.project\"}}\\t{{.Label \"com.docker.compose.service\"}}' 2>/dev/null; then printf '__DOCKER_RESTART__\\n'; docker_ids=$(docker ps -aq 2>/dev/null); if [ -n \"$docker_ids\" ]; then docker inspect --format '{{.Id}}\\t{{.Name}}\\t{{.State.Status}}\\t{{.State.ExitCode}}\\t{{.HostConfig.RestartPolicy.Name}}' $docker_ids 2>/dev/null || printf '__DOCKER_RESTART_FAILED__\\nfailed\\n'; fi; else printf '__DOCKER_FAILED__\\nfailed\\n'; fi; else printf '__DOCKER_MISSING__\\nmissing\\n'; fi;",
      "printf '__COMPOSE__\\n'; if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then docker compose ls --all --format json 2>/dev/null || printf '__COMPOSE_FAILED__\\nfailed\\n'; elif command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then docker-compose ls --all --format json 2>/dev/null || printf '__COMPOSE_FAILED__\\nfailed\\n'; else printf '__COMPOSE_MISSING__\\nmissing\\n'; fi"
    ].join(' '),
    timeoutMs: FLEET_STATUS_PROBE_TIMEOUT_MS,
    maxOutputBytes: FLEET_SERVICE_INVENTORY_MAX_OUTPUT_BYTES,
    parse: parseContainerInventory
  }),
  probe({
    id: 'service-inventory-process-managers',
    label: 'Process managers',
    command: [
      "if command -v supervisorctl >/dev/null 2>&1; then printf '__SUPERVISOR__\\n'; supervisorctl status 2>/dev/null || printf '__SUPERVISOR_FAILED__\\nfailed\\n'; else printf '__SUPERVISOR_MISSING__\\nmissing\\n'; fi;",
      "if command -v pm2 >/dev/null 2>&1; then printf '__PM2__\\n'; pm2 ls --no-color 2>/dev/null || printf '__PM2_FAILED__\\nfailed\\n'; else printf '__PM2_MISSING__\\nmissing\\n'; fi"
    ].join(' '),
    timeoutMs: FLEET_STATUS_PROBE_TIMEOUT_MS,
    maxOutputBytes: FLEET_SERVICE_INVENTORY_MAX_OUTPUT_BYTES,
    parse: parseProcessManagerInventory
  })
])

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
  if (value === null || value === undefined || String(value).trim() === '') {
    return null
  }
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
  for (const line of lines || []) {
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

function parseSystemProbe (output = '') {
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

function parseResourcesProbe (output = '') {
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
      mount: parts.slice(5).join(' '),
      inodes: null,
      inodesUsed: null,
      inodesFree: null,
      inodeUsedPercent: null
    }
    filesystems.push(item)
    filesystemMap.set(`${item.filesystem}\0${item.mount}`, item)
  }

  for (const line of (data.INODES || []).slice(1)) {
    const parts = parseTableLine(line)
    if (parts.length < 6) continue
    const item = filesystemMap.get(`${parts[0]}\0${parts.slice(5).join(' ')}`)
    if (!item) continue
    item.inodes = numberOrNull(parts[1])
    item.inodesUsed = numberOrNull(parts[2])
    item.inodesFree = numberOrNull(parts[3])
    item.inodeUsedPercent = percent(parts[4])
  }

  const processes = (data.PROCESSES || []).filter(line => line.trim()).map(line => {
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

function parseServicesProbe (output = '') {
  const text = String(output).replace(/\r/g, '').trim()
  if (!text) return []
  const services = text.split(/\n\s*\n/)
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

function parseNetworkProbe (output = '') {
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
    if (!match) continue
    defaultRoute = {
      gateway: match[1] || '',
      interface: match[2],
      source: match[3] || ''
    }
    break
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

function parseFirewallProbe (output = '') {
  const data = sections(output)
  const firewalld = (data.FIREWALLD || []).join('\n').trim()
  const ufw = (data.UFW || []).join('\n').trim()
  const nftables = (data.NFTABLES || []).join('\n').trim()
  const iptables = (data.IPTABLES || []).join('\n').trim()
  let provider = 'none'
  let enabled = false
  let rules = ''

  if (/^running$/im.test(firewalld)) {
    provider = 'firewalld'
    enabled = true
    rules = firewalld
  } else if (/^status:\s*active$/im.test(ufw)) {
    provider = 'ufw'
    enabled = true
    rules = ufw
  } else if (/\b(?:table|chain|hook|policy)\b/i.test(nftables)) {
    provider = 'nftables'
    enabled = true
    rules = nftables
  } else if (/^(?:-A\s+|-P\s+\S+\s+(?:DROP|REJECT)\b)/im.test(iptables)) {
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
    selinux: firstLine(data.SELINUX).toLowerCase()
  }
}

function parseSecurityProbe (output = '') {
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

function parseContainersProbe (output = '') {
  const data = sections(output)
  return [
    ...parseContainerLines(data.DOCKER, 'docker'),
    ...parseContainerLines(data.PODMAN, 'podman')
  ]
}

function truncateUtf8 (value, maxBytes) {
  const buffer = Buffer.from(String(value || ''), 'utf8')
  if (buffer.length <= maxBytes) return buffer.toString('utf8')
  return buffer.subarray(0, maxBytes).toString('utf8')
}

function normalizeCommandResult (result) {
  if (typeof result === 'string') return { stdout: result, stderr: '', code: 0 }
  if (!result || typeof result !== 'object') return { stdout: '', stderr: '', code: 0 }
  return {
    stdout: String(result.stdout ?? result.output ?? result.data ?? ''),
    stderr: String(result.stderr ?? ''),
    code: Number(result.code ?? result.exitCode ?? 0)
  }
}

const unsupportedPattern = /__UNSUPPORTED__|command not found|not found:|no such file or directory|unsupported/i
const permissionPattern = /permission denied|operation not permitted|access denied|authentication required|interactive authentication required/i
const timeoutPattern = /timed?\s*out|timeout/i

function hasProbeData (stdout) {
  return String(stdout || '')
    .replace(/^__[A-Z0-9_]+__\s*$/gm, '')
    .trim().length > 0
}

function classify (stdout, stderr, code, error) {
  const errorMessage = [stderr, error?.message, error?.stderr].filter(Boolean).join('\n')
  const message = [stdout, errorMessage].filter(Boolean).join('\n')
  if (error?.name === 'FleetStatusProbeTimeoutError' || timeoutPattern.test(errorMessage)) return 'timeout'
  if (permissionPattern.test(message)) return 'permission'
  if (code === 127 || unsupportedPattern.test(message)) return 'unsupported'
  if (error || code !== 0) return 'error'
  if (!hasProbeData(stdout)) return 'pending'
  return 'success'
}

function statusMessage (status) {
  if (status === 'success') return 'Probe completed'
  if (status === 'timeout') return 'Probe timed out'
  if (status === 'permission') return 'Permission denied'
  if (status === 'unsupported') return 'Probe is not supported by this server'
  if (status === 'pending') return 'No status data returned'
  return 'Probe failed'
}

function runWithTimeout (runCmd, definition, outerSignal) {
  const controller = new AbortController()
  let timer
  let removeAbortListener = () => {}
  const aborted = new Promise((resolve, reject) => {
    if (!outerSignal) return
    const onAbort = () => {
      controller.abort()
      const error = new Error('Probe cancelled')
      error.name = 'AbortError'
      reject(error)
    }
    if (outerSignal.aborted) {
      onAbort()
      return
    }
    outerSignal.addEventListener('abort', onAbort, { once: true })
    removeAbortListener = () => outerSignal.removeEventListener('abort', onAbort)
  })
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      const error = new Error('Probe timed out')
      error.name = 'FleetStatusProbeTimeoutError'
      reject(error)
    }, definition.timeoutMs)
  })
  const execution = Promise.resolve().then(() => runCmd(definition.command, {
    signal: controller.signal,
    timeoutMs: definition.timeoutMs,
    maxOutputBytes: definition.maxOutputBytes,
    probeId: definition.id
  }))
  return Promise.race([execution, timeout, aborted]).finally(() => {
    clearTimeout(timer)
    removeAbortListener()
  })
}

async function runProbe (runCmd, definition, signal) {
  const startedAt = Date.now()
  let commandResult = { stdout: '', stderr: '', code: 0 }
  let error
  try {
    commandResult = normalizeCommandResult(await runWithTimeout(runCmd, definition, signal))
  } catch (caught) {
    error = caught
    commandResult = normalizeCommandResult(caught)
  }
  const stdout = truncateUtf8(commandResult.stdout, definition.maxOutputBytes)
  const stderr = truncateUtf8(commandResult.stderr || error?.stderr || '', definition.maxOutputBytes)
  let status = classify(stdout, stderr, commandResult.code, error)
  let data = null
  if (status === 'success') {
    try {
      data = definition.parse(stdout)
    } catch (caught) {
      status = 'error'
    }
  }
  return {
    id: definition.id,
    label: definition.label,
    status,
    data,
    exitCode: commandResult.code,
    durationMs: Date.now() - startedAt,
    message: statusMessage(status)
  }
}

async function runFleetStatusProbes (runCmd, options = {}) {
  if (typeof runCmd !== 'function') throw new TypeError('runCmd must be a function')
  const requestedIds = Array.isArray(options.probeIds)
    ? new Set(options.probeIds)
    : new Set(fleetStatusProbes.map(item => item.id))
  const probes = fleetStatusProbes.filter(item => requestedIds.has(item.id))
  if (probes.length !== requestedIds.size) throw new TypeError('Unsupported fleet status probe id')
  const requestedConcurrency = Number(options.concurrency) || 3
  const concurrency = Math.max(1, Math.min(3, requestedConcurrency, probes.length || 1))
  const results = new Array(probes.length)
  let nextIndex = 0

  async function worker () {
    while (!options.signal?.aborted && nextIndex < probes.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await runProbe(runCmd, probes[index], options.signal)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return results
}

function safeInventoryProbeError (probeId, status) {
  const categories = {
    timeout: 'timeout',
    permission: 'permission',
    unsupported: 'unsupported'
  }
  const messages = {
    timeout: 'Service inventory probe timed out',
    permission: 'Service inventory probe permission denied',
    unsupported: 'Service inventory probe is unavailable',
    unknown: 'Service inventory probe failed'
  }
  const category = categories[status] || 'unknown'
  return {
    probeId,
    category,
    message: messages[category]
  }
}

async function runFleetServiceInventoryProbes (runCmd, options = {}) {
  if (typeof runCmd !== 'function') throw new TypeError('runCmd must be a function')
  const results = await Promise.all(fleetServiceInventoryProbes.map(definition => {
    return runProbe(runCmd, definition, options.signal)
  }))
  const parsed = []
  for (const result of results) {
    if (result.status !== 'success' || !result.data) {
      parsed.push({
        items: [],
        errors: [safeInventoryProbeError(result.id, result.status)]
      })
      continue
    }
    parsed.push({
      items: result.data.items,
      errors: (result.data.errors || []).map(error => ({
        probeId: result.id,
        ...error
      }))
    })
  }
  const inventory = mergeServiceInventoryResults(parsed)
  return {
    items: inventory.items,
    errors: inventory.errors
  }
}

module.exports = {
  FLEET_SERVICE_INVENTORY_MAX_OUTPUT_BYTES,
  FLEET_STATUS_PROBE_TIMEOUT_MS,
  fleetServiceInventoryProbes,
  fleetStatusProbes,
  runFleetServiceInventoryProbes,
  runFleetStatusProbes
}
