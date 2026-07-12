const NETWORK_BEGIN = '__SHELLPILOT_NETWORK_BEGIN__'
const NETWORK_END = '__SHELLPILOT_NETWORK_END__'

export function buildNetworkProbeCommand () {
  return [
    'IFACE="$(ip route show default 2>/dev/null | awk \'NR==1 {print $5}\')"',
    'INTERFACES="$(ip -o link show 2>/dev/null | awk -F\': \' \'{sub(/@.*/, "", $2); print $2}\' | paste -sd, -)"',
    'INTERFACE_DATA="$(for NET_IFACE in $(printf \'%s\' "$INTERFACES" | tr \',\' \' \'); do NET_CIDR=$(ip -4 -o addr show dev "$NET_IFACE" scope global 2>/dev/null | awk \'{print $4}\' | paste -sd, -); NET_STATE=$(cat "/sys/class/net/$NET_IFACE/operstate" 2>/dev/null || echo unknown); printf \'%s|%s|%s;\' "$NET_IFACE" "$NET_CIDR" "$NET_STATE"; done)"',
    'CIDR="$(ip -4 -o addr show dev "$IFACE" scope global 2>/dev/null | awk \'NR==1 {print $4}\')"',
    'GATEWAY="$(ip route show default 2>/dev/null | awk \'NR==1 {print $3}\')"',
    'DNS="$(awk \'/^nameserver[[:space:]]+/ {print $2}\' /etc/resolv.conf 2>/dev/null | paste -sd, -)"',
    `printf '${NETWORK_BEGIN}\\ninterface=%s\\ninterfaces=%s\\ninterfaceData=%s\\ncidr=%s\\ngateway=%s\\ndns=%s\\n${NETWORK_END}\\n' "$IFACE" "$INTERFACES" "$INTERFACE_DATA" "$CIDR" "$GATEWAY" "$DNS"`
  ].join('\n')
}

export function parseNetworkProbeOutput (output = '') {
  const begin = output.lastIndexOf(NETWORK_BEGIN)
  const end = output.indexOf(NETWORK_END, begin)
  if (begin < 0 || end < 0) {
    throw new Error('未获取到完整的网络探测结果')
  }

  const values = output
    .slice(begin + NETWORK_BEGIN.length, end)
    .split(/\r?\n/)
    .reduce((result, line) => {
      const separator = line.indexOf('=')
      if (separator > 0) {
        result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
      }
      return result
    }, {})

  if (!values.interface) {
    throw new Error('未识别到活动网卡')
  }

  return {
    interface: values.interface,
    interfaces: (values.interfaces || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
    networkInterfaces: (values.interfaceData || '')
      .split(';')
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => {
        const [name, cidr = '', state = 'unknown'] = value.split('|')
        return { name, cidr, state }
      }),
    cidr: values.cidr || '',
    gateway: values.gateway || '',
    dns: values.dns || ''
  }
}

export function mergeDetectedNetworkParams (paramValues = {}, detected = {}) {
  return {
    ...paramValues,
    网卡: detected.interface || paramValues.网卡 || '',
    网关: detected.gateway || paramValues.网关 || '',
    DNS: detected.dns || paramValues.DNS || ''
  }
}

export function createNetworkRollbackPath (context = {}, now = Date.now()) {
  const host = String(context.host || context.title || 'server')
    .replace(/[^a-zA-Z0-9.-]+/g, '-')
    .replace(/\./g, '-')
  return `/tmp/shellpilot-rollback/network-${host}-${now}.sh`
}
