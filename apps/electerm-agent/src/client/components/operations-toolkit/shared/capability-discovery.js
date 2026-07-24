const beginPrefix = '__SHELLPILOT_OPERATIONS_BEGIN__:'
const endPrefix = '__SHELLPILOT_OPERATIONS_END__:'
const noncePattern = /^[a-zA-Z0-9_-]{16,128}$/
const servicePattern = /^[a-zA-Z0-9@_.:-]{1,256}$/
const interfacePattern = /^[a-zA-Z0-9_.:-]{1,64}$/
const simpleValuePattern = /^[a-zA-Z0-9._+\- /]*$/
const allowedTools = new Set([
  'awk',
  'df',
  'dmesg',
  'docker',
  'du',
  'find',
  'free',
  'ip',
  'iostat',
  'journalctl',
  'lsof',
  'mpstat',
  'netstat',
  'nft',
  'podman',
  'ss',
  'systemctl',
  'tcpdump',
  'timedatectl',
  'vmstat'
])
const allowedPlatforms = new Set([
  '1panel',
  'bt',
  'compose',
  'java',
  'node',
  'php',
  'python'
])

function assertNonce (nonce) {
  if (!noncePattern.test(String(nonce || ''))) {
    throw new Error('服务器能力探测 nonce 无效')
  }
  return nonce
}

function parseBoundedParts (value, count, label) {
  const parts = value.split('|')
  if (parts.length !== count) {
    throw new Error(`服务器能力探测${label}格式无效`)
  }
  return parts
}

function findMarkers (lines, marker) {
  return lines.reduce((indexes, line, index) => {
    if (line === marker) indexes.push(index)
    return indexes
  }, [])
}

export function buildOperationsDiscoveryCommand (providedNonce) {
  const nonce = assertNonce(providedNonce)
  const tools = Array.from(allowedTools).join(' ')
  const osId = '$' + '{ID:-unknown}'
  const osIdLike = '$' + '{ID_LIKE:-}'
  const osVersion = '$' + '{VERSION_ID:-}'
  return [
    `printf '${beginPrefix}${nonce}\\n'`,
    '. /etc/os-release 2>/dev/null || true',
    `printf 'os.id=%s\\n' "${osId}"`,
    `printf 'os.idLike=%s\\n' "${osIdLike}"`,
    `printf 'os.version=%s\\n' "${osVersion}"`,
    "printf 'kernel=%s\\n' \"$(uname -r 2>/dev/null)\"",
    "printf 'arch=%s\\n' \"$(uname -m 2>/dev/null)\"",
    "printf 'init=%s\\n' \"$(command -v systemctl >/dev/null 2>&1 && printf systemd || printf other)\"",
    `for tool in ${tools}; do command -v "$tool" >/dev/null 2>&1 && printf 'tool=%s\\n' "$tool"; done`,
    "ip -o link 2>/dev/null | head -n 64 | awk -F': ' '{name=$2; sub(/@.*/, \"\", name); state=\"DOWN\"; if ($0 ~ /state UP/) state=\"UP\"; mtu=\"\"; if (match($0, /mtu [0-9]+/)) mtu=substr($0, RSTART+4, RLENGTH-4); print \"interface=\" name \"|\" state \"||\" mtu}'",
    "ip -o -4 addr show 2>/dev/null | head -n 64 | awk '{name=$2; cidr=$4; print \"interface-address=\" name \"|\" cidr}'",
    "ip route show default 2>/dev/null | head -n 16 | awk '{for(i=1;i<=NF;i++){if($i==\"dev\")dev=$(i+1);if($i==\"via\")via=$(i+1)} if(dev!=\"\")print \"route=\" dev \"|\" via}'",
    "systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null | head -n 500 | awk '{print \"service=\" $1 \"|loaded|unknown|\" $2}'",
    "command -v docker >/dev/null 2>&1 && printf 'containerRuntime=docker\\n'",
    "command -v podman >/dev/null 2>&1 && printf 'containerRuntime=podman\\n'",
    "[ -d /www/server/panel ] && printf 'platform=bt\\n'",
    "[ -d /opt/1panel ] && printf 'platform=1panel\\n'",
    `printf '${endPrefix}${nonce}\\n'`
  ].join('; ')
}

export function parseOperationsDiscoveryOutput (output = '', providedNonce) {
  const nonce = assertNonce(providedNonce)
  const begin = `${beginPrefix}${nonce}`
  const end = `${endPrefix}${nonce}`
  const lines = String(output).split(/\r?\n/).map(line => line.trim())
  const begins = findMarkers(lines, begin)
  const ends = findMarkers(lines, end)
  if (begins.length !== 1 || ends.length !== 1) {
    throw new Error('服务器能力探测边界标记必须唯一')
  }
  if (begins[0] >= ends[0]) {
    throw new Error('服务器能力探测边界顺序无效')
  }

  const result = {
    os: {
      id: '',
      idLike: '',
      version: ''
    },
    kernel: '',
    arch: '',
    init: '',
    tools: [],
    interfaces: [],
    routes: [],
    services: [],
    containerRuntimes: [],
    platforms: []
  }
  const interfaceAddresses = new Map()
  const seenSingletons = new Set()

  for (const line of lines.slice(begins[0] + 1, ends[0])) {
    if (!line) continue
    const equalsIndex = line.indexOf('=')
    if (equalsIndex < 1) throw new Error('服务器能力探测结果包含未知字段')
    const key = line.slice(0, equalsIndex)
    const value = line.slice(equalsIndex + 1)
    if (key === 'tool') {
      if (!allowedTools.has(value) || result.tools.includes(value)) {
        throw new Error('服务器能力探测工具无效或重复')
      }
      result.tools.push(value)
      continue
    }
    if (key === 'interface') {
      if (result.interfaces.length >= 64) throw new Error('服务器网卡数量超过限制')
      const [name, state, cidr, mtu] = parseBoundedParts(value, 4, '网卡')
      if (!interfacePattern.test(name)) throw new Error('服务器网卡名称无效')
      if (!['UP', 'DOWN', 'UNKNOWN'].includes(state)) {
        throw new Error('服务器网卡状态无效')
      }
      result.interfaces.push({
        name,
        state,
        cidr,
        mtu: /^\d+$/.test(mtu) ? Number(mtu) : null
      })
      continue
    }
    if (key === 'interface-address') {
      const [name, cidr] = parseBoundedParts(value, 2, '网卡地址')
      if (!interfacePattern.test(name)) throw new Error('服务器网卡名称无效')
      interfaceAddresses.set(name, cidr)
      continue
    }
    if (key === 'route') {
      const [interfaceName, gateway] = parseBoundedParts(value, 2, '路由')
      if (!interfacePattern.test(interfaceName)) throw new Error('服务器路由网卡无效')
      result.routes.push({ interface: interfaceName, gateway })
      continue
    }
    if (key === 'service') {
      if (result.services.length >= 500) throw new Error('服务器服务数量超过限制')
      const [name, load, active, enabled] = parseBoundedParts(value, 4, '服务')
      if (!servicePattern.test(name)) throw new Error('服务器服务名称无效')
      result.services.push({ name, load, active, enabled })
      continue
    }
    if (key === 'containerRuntime') {
      if (!['docker', 'podman'].includes(value)) {
        throw new Error('服务器容器运行时无效')
      }
      if (!result.containerRuntimes.includes(value)) {
        result.containerRuntimes.push(value)
      }
      continue
    }
    if (key === 'platform') {
      if (!allowedPlatforms.has(value)) throw new Error('服务器平台标识无效')
      if (!result.platforms.includes(value)) result.platforms.push(value)
      continue
    }
    const singletonMap = {
      'os.id': ['os', 'id'],
      'os.idLike': ['os', 'idLike'],
      'os.version': ['os', 'version'],
      kernel: ['kernel'],
      arch: ['arch'],
      init: ['init']
    }
    const target = singletonMap[key]
    if (!target || seenSingletons.has(key) || !simpleValuePattern.test(value)) {
      throw new Error('服务器能力探测结果包含未知或重复字段')
    }
    seenSingletons.add(key)
    if (target.length === 2) result[target[0]][target[1]] = value
    else result[target[0]] = value
  }

  result.interfaces.forEach(item => {
    if (interfaceAddresses.has(item.name)) {
      item.cidr = interfaceAddresses.get(item.name)
    }
  })
  return result
}
