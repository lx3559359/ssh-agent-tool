import {
  parseContainersProbe,
  parseFirewallProbe,
  parseNetworkProbe,
  parseResourcesProbe as parseResourcesProbeBase,
  parseSecurityProbe,
  parseServicesProbe,
  parseSystemProbe as parseSystemProbeBase
} from './server-status-parsers.js'

const KiB = 1024
const probeTimeoutMs = 8000
function firstSectionLine (output, section) {
  const lines = String(output).replace(/\r/g, '').split('\n')
  const start = lines.indexOf('__' + section + '__')
  if (start < 0) return ''
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^__[A-Z0-9_]+__$/.test(lines[index])) break
    if (lines[index].trim()) return lines[index].trim()
  }
  return ''
}

function parseSystemProbe (output = '') {
  const data = parseSystemProbeBase(output)
  if (!firstSectionLine(output, 'CPU_CORES')) data.cpuCores = null
  if (!firstSectionLine(output, 'UPTIME_SECONDS')) data.uptimeSeconds = null
  return data
}

function parseResourcesProbe (output = '') {
  const data = parseResourcesProbeBase(output)
  if (!firstSectionLine(output, 'LOAD')) {
    data.load = { one: null, five: null, fifteen: null }
  }
  return data
}

function probe (definition) {
  return Object.freeze(definition)
}

function fixedCommand (parts) {
  return parts[0]
}

export const serverStatusProbes = Object.freeze([
  probe({
    id: 'system',
    label: '系统环境',
    command: fixedCommand`printf '__OS_RELEASE__\\n'; cat /etc/os-release 2>&1; printf '__HOSTNAME__\\n'; hostname 2>&1; printf '__KERNEL__\\n'; uname -r 2>&1; printf '__CPU_CORES__\\n'; getconf _NPROCESSORS_ONLN 2>&1; printf '__UPTIME_SECONDS__\\n'; cut -d ' ' -f 1 /proc/uptime 2>&1; printf '__INIT__\\n'; ps -p 1 -o comm= 2>&1`,
    timeoutMs: probeTimeoutMs,
    maxOutputBytes: 32 * KiB,
    parse: parseSystemProbe
  }),
  probe({
    id: 'resources',
    label: '资源状态',
    command: fixedCommand`printf '__LOAD__\\n'; cat /proc/loadavg 2>&1; printf '__MEMINFO__\\n'; cat /proc/meminfo 2>&1; printf '__FILESYSTEMS__\\n'; df -P -B1 2>&1; printf '__INODES__\\n'; df -Pi 2>&1; printf '__PROCESSES__\\n'; ps -eo pid=,pcpu=,pmem=,comm= --sort=-pcpu 2>&1 | head -n 20`,
    timeoutMs: probeTimeoutMs,
    maxOutputBytes: 64 * KiB,
    parse: parseResourcesProbe
  }),
  probe({
    id: 'services',
    label: '系统服务',
    command: fixedCommand`if command -v systemctl >/dev/null 2>&1; then systemctl list-units --type=service --all --no-legend --no-pager 2>/dev/null | while read -r unit _; do systemctl show "$unit" --property=Id,Description,LoadState,ActiveState,SubState,FragmentPath,WorkingDirectory 2>&1; printf '\\n'; done; else printf '__UNSUPPORTED__ systemctl command not found\\n'; fi`,
    timeoutMs: probeTimeoutMs,
    maxOutputBytes: 128 * KiB,
    parse: parseServicesProbe
  }),
  probe({
    id: 'network',
    label: '网络状态',
    command: fixedCommand`if command -v ip >/dev/null 2>&1; then printf '__LINKS__\\n'; ip -o link show 2>&1; printf '__ADDRESSES__\\n'; ip -o address show 2>&1; printf '__ROUTES__\\n'; ip route show 2>&1; else printf '__UNSUPPORTED__ ip command not found\\n'; fi; printf '__DNS__\\n'; cat /etc/resolv.conf 2>&1; printf '__PORTS__\\n'; if command -v ss >/dev/null 2>&1; then ss -H -lntup 2>&1; elif command -v netstat >/dev/null 2>&1; then netstat -lntup 2>&1; else printf '__UNSUPPORTED__ ss and netstat command not found\\n'; fi`,
    timeoutMs: probeTimeoutMs,
    maxOutputBytes: 96 * KiB,
    parse: parseNetworkProbe
  }),
  probe({
    id: 'firewall',
    label: '防火墙状态',
    command: fixedCommand`printf '__FIREWALLD__\\n'; if command -v firewall-cmd >/dev/null 2>&1; then firewall-cmd --state 2>&1; fi; printf '__UFW__\\n'; if command -v ufw >/dev/null 2>&1; then ufw status 2>&1; fi; printf '__NFTABLES__\\n'; if command -v nft >/dev/null 2>&1; then nft list ruleset 2>&1; fi; printf '__IPTABLES__\\n'; if command -v iptables >/dev/null 2>&1; then iptables -S 2>&1; fi; printf '__SELINUX__\\n'; if command -v getenforce >/dev/null 2>&1; then getenforce 2>&1; fi`,
    timeoutMs: probeTimeoutMs,
    maxOutputBytes: 96 * KiB,
    parse: parseFirewallProbe
  }),
  probe({
    id: 'security',
    label: '安全状态',
    command: fixedCommand`printf '__SELINUX__\\n'; if command -v getenforce >/dev/null 2>&1; then getenforce 2>&1; fi; printf '__APPARMOR__\\n'; if command -v aa-status >/dev/null 2>&1; then aa-status 2>&1; fi; printf '__USERS__\\n'; who 2>&1; printf '__FAILED_LOGINS__\\n'; if command -v lastb >/dev/null 2>&1; then lastb -n 20 2>&1; fi`,
    timeoutMs: probeTimeoutMs,
    maxOutputBytes: 64 * KiB,
    parse: parseSecurityProbe
  }),
  probe({
    id: 'containers',
    label: '容器状态',
    command: fixedCommand`printf '__DOCKER__\\n'; if command -v docker >/dev/null 2>&1; then docker ps -a --format '{{.Names}}\\t{{.Label "com.docker.compose.service"}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Image}}\\t{{.Label "com.docker.compose.project"}}' 2>&1; fi; printf '__PODMAN__\\n'; if command -v podman >/dev/null 2>&1; then podman ps -a --format '{{.Names}}\\t{{.Labels.service}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Image}}\\t{{.Labels.io.podman.compose.project}}' 2>&1; fi; if ! command -v docker >/dev/null 2>&1 && ! command -v podman >/dev/null 2>&1; then printf '__UNSUPPORTED__ docker and podman command not found\\n'; fi`,
    timeoutMs: probeTimeoutMs,
    maxOutputBytes: 96 * KiB,
    parse: parseContainersProbe
  })
])

function truncateUtf8 (value, maxBytes) {
  const text = String(value || '')
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text)
  if (bytes.length <= maxBytes) return text
  return new TextDecoder().decode(bytes.slice(0, maxBytes))
}

function normalizeCommandResult (result) {
  if (typeof result === 'string') {
    return { stdout: result, stderr: '', code: 0 }
  }
  if (!result || typeof result !== 'object') {
    return { stdout: '', stderr: '', code: 0 }
  }
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
  if (error?.name === 'ServerStatusProbeTimeoutError' || timeoutPattern.test(errorMessage)) return 'timeout'
  if (permissionPattern.test(message)) return 'permission'
  if (code === 127 || unsupportedPattern.test(message)) return 'unsupported'
  if (error || code !== 0) return 'error'
  if (!hasProbeData(stdout)) return 'pending'
  return 'success'
}

function statusMessage (status, probeDefinition, error) {
  if (status === 'success') return '检测成功'
  if (status === 'timeout') return `${probeDefinition.label || probeDefinition.id}检测超时`
  if (status === 'permission') return '权限不足，无法读取此项信息'
  if (status === 'unsupported') return '服务器不支持此探针所需命令'
  if (status === 'pending') return '未返回状态数据'
  return error?.message || '检测失败'
}

function runWithTimeout (runCmd, probeDefinition, outerSignal) {
  const controller = typeof AbortController === 'function'
    ? new AbortController()
    : null
  let timer
  let removeAbortListener = () => {}
  const aborted = new Promise((resolve, reject) => {
    if (!outerSignal) return
    const onAbort = () => {
      controller?.abort()
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
      controller?.abort()
      const error = new Error(`Probe timeout after ${probeDefinition.timeoutMs}ms`)
      error.name = 'ServerStatusProbeTimeoutError'
      reject(error)
    }, probeDefinition.timeoutMs)
  })
  const execution = Promise.resolve().then(() => {
    return runCmd(probeDefinition.command, {
      signal: controller?.signal,
      timeoutMs: probeDefinition.timeoutMs,
      maxOutputBytes: probeDefinition.maxOutputBytes,
      probe: probeDefinition
    })
  })
  return Promise.race([execution, timeout, aborted]).finally(() => {
    clearTimeout(timer)
    removeAbortListener()
  })
}

async function runProbe (runCmd, probeDefinition, signal) {
  const startedAt = Date.now()
  let commandResult = { stdout: '', stderr: '', code: 0 }
  let error
  try {
    commandResult = normalizeCommandResult(
      await runWithTimeout(runCmd, probeDefinition, signal)
    )
  } catch (caught) {
    error = caught
    commandResult = normalizeCommandResult(caught)
  }

  const maxOutputBytes = probeDefinition.maxOutputBytes
  const rawOutput = truncateUtf8(commandResult.stdout, maxOutputBytes)
  const stderr = truncateUtf8(commandResult.stderr || error?.stderr || '', maxOutputBytes)
  let status = classify(rawOutput, stderr, commandResult.code, error)
  let data = null

  if (status === 'success') {
    try {
      data = probeDefinition.parse(rawOutput)
    } catch (caught) {
      error = caught
      status = 'error'
    }
  }

  return {
    id: probeDefinition.id,
    label: probeDefinition.label || probeDefinition.id,
    status,
    data,
    rawOutput,
    stderr,
    exitCode: commandResult.code,
    durationMs: Date.now() - startedAt,
    message: statusMessage(status, probeDefinition, error)
  }
}

export async function runServerStatusProbes (runCmd, options = {}) {
  if (typeof runCmd !== 'function') {
    throw new TypeError('runCmd must be a function')
  }
  const probes = Array.isArray(options.probes)
    ? options.probes
    : serverStatusProbes
  const signal = options.signal
  const requestedConcurrency = Number(options.concurrency) || 3
  const concurrency = Math.max(1, Math.min(3, requestedConcurrency, probes.length || 1))
  const results = new Array(probes.length)
  let nextIndex = 0

  async function worker () {
    while (!signal?.aborted && nextIndex < probes.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await runProbe(runCmd, probes[index], signal)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return results
}
