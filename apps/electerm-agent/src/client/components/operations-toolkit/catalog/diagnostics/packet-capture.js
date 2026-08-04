import { defineOperationsTool } from '../../shared/definition.js'
import {
  assertEnumValue,
  assertIntegerRange,
  assertInterface,
  assertOptionalHost,
  assertOptionalPort,
  assertPcapPath,
  shellQuote
} from '../../shared/validation.js'

const protocols = Object.freeze(['any', 'tcp', 'udp', 'icmp', 'icmp6'])

function valueOrDefault (value, fallback) {
  return value === undefined || value === null || value === ''
    ? fallback
    : value
}

export function normalizePacketCaptureParameters (
  params = {},
  capabilities = {}
) {
  const interfaceName = assertInterface(params.interfaceName || 'any')
  const available = new Set([
    'any',
    ...(capabilities.interfaces || []).map(item => item.name)
  ])
  if (!available.has(interfaceName)) {
    throw new Error('网卡不在当前探测结果中')
  }
  const protocol = assertEnumValue(params.protocol || 'tcp', protocols, '协议')
  const port = assertOptionalPort(params.port)
  if (port && !['tcp', 'udp'].includes(protocol)) {
    throw new Error('只有 TCP 或 UDP 抓包可以填写端口')
  }
  return {
    interfaceName,
    protocol,
    host: assertOptionalHost(params.host),
    port,
    packetCount: assertIntegerRange(
      valueOrDefault(params.packetCount, 100),
      1,
      1000,
      '抓包数量'
    ),
    duration: assertIntegerRange(
      valueOrDefault(params.duration, 30),
      1,
      300,
      '抓包时长'
    ),
    outputPath: assertPcapPath(
      params.outputPath || '/tmp/shellpilot-capture.pcap'
    )
  }
}

export function buildPacketCaptureFilter (value = {}) {
  const protocol = assertEnumValue(value.protocol || 'any', protocols, '协议')
  const host = assertOptionalHost(value.host)
  const port = assertOptionalPort(value.port)
  if (port && !['tcp', 'udp'].includes(protocol)) {
    throw new Error('只有 TCP 或 UDP 抓包可以填写端口')
  }
  const parts = []
  if (protocol !== 'any') parts.push(protocol)
  if (host) parts.push('host ' + host)
  if (port) parts.push('port ' + port)
  return parts.join(' and ')
}

export function buildPacketCaptureCommands (params = {}, capabilities = {}) {
  const value = normalizePacketCaptureParameters(params, capabilities)
  const target = shellQuote(value.outputPath)
  const interfaceName = shellQuote(value.interfaceName)
  const filter = buildPacketCaptureFilter(value)
  const filterSuffix = filter ? ' ' + filter : ''
  const preflight = [
    'set -u',
    'TARGET=' + target,
    'PARENT="$(dirname -- "$TARGET")"',
    'command -v tcpdump >/dev/null 2>&1 || { echo "未安装 tcpdump；Debian/Ubuntu: apt install tcpdump；RHEL/CentOS: yum install tcpdump"; exit 1; }',
    'for TOOL in dirname head id ip ln mktemp rm stat timeout; do command -v "$TOOL" >/dev/null 2>&1 || { echo "缺少必要工具: $TOOL"; exit 1; }; done',
    '[ -d "$PARENT" ] && [ ! -L "$PARENT" ] || { echo "抓包父目录不存在或不安全"; exit 1; }',
    '[ -w "$PARENT" ] || { echo "当前用户不能在抓包父目录创建文件"; exit 1; }',
    '[ ! -e "$TARGET" ] && [ ! -L "$TARGET" ] || { echo "抓包文件已存在，拒绝覆盖"; exit 1; }',
    '[ ' + interfaceName + ' = any ] || ip link show dev ' + interfaceName + ' >/dev/null 2>&1 || { echo "网卡不存在"; exit 1; }',
    'if [ "$(id -u)" != 0 ]; then command -v sudo >/dev/null 2>&1 && sudo -n tcpdump --version >/dev/null 2>&1 || { echo "抓包需要 root 或免密 sudo tcpdump 权限"; exit 1; }; fi'
  ].join('\n')
  const capture = [
    'set -u',
    'umask 077',
    'TARGET=' + target,
    'PARENT="$(dirname -- "$TARGET")"',
    'TEMP="$(mktemp "$PARENT/.shellpilot-capture.XXXXXX.pcap")" || exit 1',
    'TEMP_INODE="$(stat -c %d:%i -- "$TEMP")" || exit 1',
    'cleanup_capture () {',
    '  [ -n "$' + '{TEMP:-}" ] && [ -n "$' +
      '{TEMP_INODE:-}" ] || return 0',
    '  if [ -f "$TEMP" ] && [ ! -L "$TEMP" ] && [ "$(stat -c %d:%i -- "$TEMP" 2>/dev/null)" = "$TEMP_INODE" ]; then',
    '    rm -f -- "$TEMP" 2>/dev/null || printf "临时抓包文件清理失败，已保留: %s\\n" "$TEMP"',
    '  else',
    '    printf "无法确认临时抓包文件归属，已保留: %s\\n" "$TEMP"',
    '  fi',
    '}',
    'abort_capture () {',
    '  trap - HUP INT TERM',
    '  cleanup_capture',
    '  trap - EXIT',
    '  exit 130',
    '}',
    'trap cleanup_capture EXIT',
    'trap abort_capture HUP INT TERM',
    'RUN_AS=""',
    'if [ "$(id -u)" != 0 ]; then RUN_AS="sudo -n"; fi',
    'set +e',
    'timeout --signal=INT --kill-after=5 ' + value.duration + ' $RUN_AS tcpdump -nn -i ' + interfaceName + ' -c ' + value.packetCount + ' -w "$TEMP"' + filterSuffix,
    'STATUS=$?',
    'set -e',
    'case "$STATUS" in 0|124) ;; *) echo "tcpdump 执行失败: $STATUS"; exit "$STATUS" ;; esac',
    '[ -s "$TEMP" ] || { echo "抓包文件为空"; exit 1; }',
    '[ -f "$TEMP" ] && [ ! -L "$TEMP" ] && [ "$(stat -c %d:%i -- "$TEMP")" = "$TEMP_INODE" ] || { echo "抓包临时文件已被替换"; exit 1; }',
    'ln -- "$TEMP" "$TARGET" || { echo "目标文件已存在，拒绝覆盖"; exit 1; }',
    'rm -f -- "$TEMP"; TEMP=""; TEMP_INODE=""',
    'trap - EXIT HUP INT TERM',
    'printf "capture_path=%s\\n" "$TARGET"'
  ].join('\n')
  const summary = [
    'TARGET=' + target,
    'test -r "$TARGET" || { echo "抓包文件不可读"; exit 1; }',
    'stat -c "capture_size=%s capture_mode=%a capture_owner=%U" -- "$TARGET"',
    'tcpdump -nn -r "$TARGET" -c 100 2>/dev/null | head -n 100'
  ].join('\n')
  return [preflight, capture, summary]
}

function commands (params = {}, capabilities = {}) {
  return buildPacketCaptureCommands(params, capabilities)
}

const defaultCommands = commands()

export const packetCaptureTools = Object.freeze([
  defineOperationsTool({
    id: 'network.packet-capture',
    title: '网络抓包与报文采样',
    description: '按网卡、协议、主机和端口有界抓包，并保存为不覆盖的 pcap 文件。',
    category: '网络',
    type: 'diagnostic',
    risk: 'resource-sensitive',
    requiresConfirmation: true,
    parameters: [
      { id: 'interfaceName', label: '网卡', type: 'select', source: 'interfaces', defaultValue: 'any' },
      {
        id: 'protocol',
        label: '协议',
        type: 'select',
        defaultValue: 'tcp',
        options: [
          { label: '不限协议', value: 'any' },
          { label: 'TCP', value: 'tcp' },
          { label: 'UDP', value: 'udp' },
          { label: 'ICMP', value: 'icmp' },
          { label: 'ICMPv6', value: 'icmp6' }
        ]
      },
      { id: 'host', label: '主机过滤（可选）', type: 'host', defaultValue: '' },
      {
        id: 'port',
        label: '端口过滤（可选）',
        type: 'port',
        defaultValue: '',
        enabledWhen: { id: 'protocol', values: ['tcp', 'udp'] }
      },
      { id: 'packetCount', label: '最多抓包数量', type: 'number', defaultValue: 100 },
      { id: 'duration', label: '最长时长（秒）', type: 'number', defaultValue: 30 },
      { id: 'outputPath', label: '保存路径', type: 'path', defaultValue: '/tmp/shellpilot-capture.pcap' }
    ],
    aiContext: {
      parameterIds: [
        'interfaceName', 'protocol', 'host', 'port',
        'packetCount', 'duration', 'outputPath'
      ],
      stepIds: ['preflight', 'capture', 'summary']
    },
    steps: [
      {
        id: 'preflight',
        title: '检查依赖、权限和保存路径',
        command: defaultCommands[0],
        buildCommand: (params, capabilities) => commands(params, capabilities)[0],
        timeoutMs: 15000
      },
      {
        id: 'capture',
        title: '执行有界抓包',
        command: defaultCommands[1],
        buildCommand: (params, capabilities) => commands(params, capabilities)[1],
        timeoutMs: 330000
      },
      {
        id: 'summary',
        title: '输出文件信息和报文头摘要',
        command: defaultCommands[2],
        buildCommand: (params, capabilities) => commands(params, capabilities)[2],
        timeoutMs: 30000
      }
    ]
  })
])
