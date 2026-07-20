const capabilityBeginPrefix = '__SHELLPILOT_CAP_BEGIN__:'
const capabilityEndPrefix = '__SHELLPILOT_CAP_END__:'
const maintenanceTools = [
  'iostat',
  'mpstat',
  'lsof',
  'ethtool',
  'ss',
  'netstat',
  'journalctl',
  'docker',
  'timedatectl'
]
const maintenanceToolSet = new Set(maintenanceTools)
const osReleaseIdExpansion = '$' + '{ID:-}'

function assertDiscoveryNonce (nonce) {
  if (typeof nonce !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(nonce)) {
    throw new Error('服务器能力探测 nonce 无效')
  }
  return nonce
}

export function createMaintenanceDiscoveryNonce () {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('当前环境无法生成安全的服务器能力探测 nonce')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

export function buildMaintenanceDiscoveryCommand (providedNonce) {
  const nonce = assertDiscoveryNonce(
    providedNonce === undefined ? createMaintenanceDiscoveryNonce() : providedNonce
  )
  const capabilityBegin = `${capabilityBeginPrefix}${nonce}`
  const capabilityEnd = `${capabilityEndPrefix}${nonce}`
  return [
    `printf "${capabilityBegin}\\n"`,
    `printf "os=%s\\n" "$(. /etc/os-release 2>/dev/null; printf %s "${osReleaseIdExpansion}")"`,
    'printf "init=%s\\n" "$(command -v systemctl >/dev/null 2>&1 && printf systemd || printf other)"',
    `for tool in ${maintenanceTools.join(' ')}; do if command -v "$tool" >/dev/null 2>&1; then printf "tool=%s\\n" "$tool"; fi; done`,
    `printf "${capabilityEnd}\\n"`
  ].join('; ')
}

function findMarkerIndexes (lines, marker) {
  return lines.reduce((indexes, line, index) => {
    if (line === marker) indexes.push(index)
    return indexes
  }, [])
}

export function parseMaintenanceDiscoveryOutput (output = '', providedNonce) {
  const nonce = assertDiscoveryNonce(providedNonce)
  const capabilityBegin = `${capabilityBeginPrefix}${nonce}`
  const capabilityEnd = `${capabilityEndPrefix}${nonce}`
  const lines = String(output).split(/\r?\n/).map(line => line.trim())
  const beginIndexes = findMarkerIndexes(lines, capabilityBegin)
  const endIndexes = findMarkerIndexes(lines, capabilityEnd)
  if (beginIndexes.length !== 1 || endIndexes.length !== 1) {
    throw new Error('未获取到完整的服务器能力探测结果：边界标记必须唯一')
  }
  const beginIndex = beginIndexes[0]
  const endIndex = endIndexes[0]
  if (beginIndex >= endIndex) {
    throw new Error('未获取到完整的服务器能力探测结果')
  }

  const body = lines.slice(beginIndex + 1, endIndex)
  let os = ''
  let init = ''
  const tools = []
  for (const line of body) {
    if (!line) {
      throw new Error('服务器能力探测结果包含未知空行')
    }
    if (line.startsWith('os=')) {
      if (os) throw new Error('服务器能力探测结果包含重复的操作系统信息')
      os = line.slice(3).trim()
      if (!os) throw new Error('服务器能力探测结果缺少操作系统信息')
      continue
    }
    if (line.startsWith('init=')) {
      if (init) throw new Error('服务器能力探测结果包含重复的 init 类型')
      init = line.slice(5).trim()
      if (!init) throw new Error('服务器能力探测结果缺少 init 类型')
      continue
    }
    if (line.startsWith('tool=')) {
      const tool = line.slice(5).trim()
      if (!maintenanceToolSet.has(tool)) {
        throw new Error('服务器能力探测结果包含未知工具')
      }
      if (tools.includes(tool)) {
        throw new Error('服务器能力探测结果包含重复工具')
      }
      tools.push(tool)
      continue
    }
    throw new Error('服务器能力探测结果包含未知字段或标记')
  }

  if (!os) throw new Error('服务器能力探测结果缺少操作系统信息')
  if (!init) throw new Error('服务器能力探测结果缺少 init 类型')
  if (!/^[a-zA-Z0-9._-]+$/.test(os)) {
    throw new Error('服务器能力探测结果包含无效的操作系统信息')
  }
  if (init !== 'systemd' && init !== 'other') {
    throw new Error('服务器能力探测结果包含无效的 init 类型')
  }

  return { os, init, tools }
}
