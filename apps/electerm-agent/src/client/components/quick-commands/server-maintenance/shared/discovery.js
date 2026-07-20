const capabilityBegin = '__SHELLPILOT_CAP_BEGIN__'
const capabilityEnd = '__SHELLPILOT_CAP_END__'
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

export function buildMaintenanceDiscoveryCommand () {
  return [
    `printf "${capabilityBegin}\\n"`,
    `printf "os=%s\\n" "$(. /etc/os-release 2>/dev/null; printf %s "${osReleaseIdExpansion}")"`,
    'printf "init=%s\\n" "$(command -v systemctl >/dev/null 2>&1 && printf systemd || printf other)"',
    `for tool in ${maintenanceTools.join(' ')}; do if command -v "$tool" >/dev/null 2>&1; then printf "tool=%s\\n" "$tool"; fi; done`,
    `printf "${capabilityEnd}\\n"`
  ].join('; ')
}

function requiredCapability (lines, prefix, label) {
  const line = lines.find(item => item.startsWith(prefix))
  const value = line?.slice(prefix.length).trim()
  if (!value) {
    throw new Error(`服务器能力探测结果缺少${label}`)
  }
  return value
}

export function parseMaintenanceDiscoveryOutput (output = '') {
  const lines = String(output).split(/\r?\n/).map(line => line.trim())
  const beginIndex = lines.indexOf(capabilityBegin)
  const endIndex = beginIndex < 0 ? -1 : lines.indexOf(capabilityEnd, beginIndex + 1)
  if (beginIndex < 0 || endIndex < 0) {
    throw new Error('未获取到完整的服务器能力探测结果')
  }

  const body = lines.slice(beginIndex + 1, endIndex).filter(Boolean)
  const os = requiredCapability(body, 'os=', '操作系统信息')
  const init = requiredCapability(body, 'init=', ' init 类型')
  if (!/^[a-zA-Z0-9._-]+$/.test(os)) {
    throw new Error('服务器能力探测结果包含无效的操作系统信息')
  }
  if (init !== 'systemd' && init !== 'other') {
    throw new Error('服务器能力探测结果包含无效的 init 类型')
  }

  const tools = []
  for (const line of body) {
    if (!line.startsWith('tool=')) continue
    const tool = line.slice(5).trim()
    if (maintenanceToolSet.has(tool) && !tools.includes(tool)) tools.push(tool)
  }
  return { os, init, tools }
}
