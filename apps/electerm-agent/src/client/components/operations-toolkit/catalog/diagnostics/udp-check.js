import { defineOperationsTool } from '../../shared/definition.js'
import {
  assertHost,
  assertIntegerRange,
  assertInterface,
  assertPort,
  shellQuote
} from '../../shared/validation.js'

export function normalizeUdpParameters (params = {}) {
  return {
    host: assertHost(params.host || '127.0.0.1', '目标'),
    port: assertPort(params.port || 53),
    attempts: assertIntegerRange(params.attempts || 3, 1, 10, '尝试次数'),
    timeout: assertIntegerRange(params.timeout || 3, 1, 30, '超时'),
    packetCount: assertIntegerRange(
      params.packetCount || 20,
      1,
      1000,
      '抓包数量'
    ),
    interfaceName: assertInterface(params.interfaceName || 'any')
  }
}

export function parseUdpCheckResult (parts = {}) {
  if (parts.firewall === 'blocked') {
    return { status: 'blocked', summary: '防火墙规则可能阻止该 UDP 流量。' }
  }
  if (parts.probe === 'response') {
    return { status: 'reachable', summary: '目标返回了 UDP 响应。' }
  }
  if (parts.capture === 'packet' && parts.probe !== 'response') {
    return {
      status: 'received-no-app-response',
      summary: '已观察到报文，但应用未返回响应。'
    }
  }
  if (parts.probe === 'unsupported') {
    return { status: 'unsupported', summary: '服务器缺少可用的 UDP 探测工具。' }
  }
  return {
    status: 'inconclusive',
    summary: 'UDP 无响应无法判定可达性，当前结果不确定。'
  }
}

function commands (params = {}) {
  const value = normalizeUdpParameters(params)
  const host = shellQuote(value.host)
  const filter = `udp and host ${value.host} and port ${value.port}`
  return [
    `if command -v ss >/dev/null 2>&1; then ss -ulnp | grep -E '[:.]${value.port}([[:space:]]|$)' || true; else netstat -ulnp 2>/dev/null | grep -E '[:.]${value.port}([[:space:]]|$)' || true; fi`,
    `if command -v nft >/dev/null 2>&1; then nft list ruleset 2>/dev/null | grep -Ei 'udp|${value.port}' | head -n 120; elif command -v iptables >/dev/null 2>&1; then iptables -S 2>/dev/null | grep -Ei 'udp|${value.port}' | head -n 120; else printf "firewall=unknown\\n"; fi`,
    `if command -v ncat >/dev/null 2>&1; then for i in $(seq 1 ${value.attempts}); do printf x | ncat -u -w ${value.timeout} ${host} ${value.port}; done; elif command -v nc >/dev/null 2>&1; then for i in $(seq 1 ${value.attempts}); do printf x | nc -u -w ${value.timeout} ${host} ${value.port}; done; else printf "probe=unsupported\\n"; fi`,
    `if command -v tcpdump >/dev/null 2>&1; then timeout ${value.timeout} tcpdump -nn -i ${shellQuote(value.interfaceName)} -c ${value.packetCount} ${shellQuote(filter)} 2>&1; else printf "capture=unsupported\\n"; fi`
  ]
}

export const udpCheckTools = Object.freeze([
  defineOperationsTool({
    id: 'network.udp-comprehensive-check',
    title: 'UDP 端口综合检测',
    description: '综合监听、防火墙、主动探测和可选报文观察判断 UDP 状态。',
    category: '网络',
    type: 'diagnostic',
    risk: 'read-only',
    parameters: [
      { id: 'host', label: '目标主机', type: 'host', defaultValue: '127.0.0.1' },
      { id: 'port', label: 'UDP 端口', type: 'port', defaultValue: 53 },
      { id: 'interfaceName', label: '网卡', type: 'select', source: 'interfaces', defaultValue: 'any' },
      { id: 'attempts', label: '尝试次数', type: 'number', defaultValue: 3 },
      { id: 'timeout', label: '超时（秒）', type: 'number', defaultValue: 3 },
      { id: 'packetCount', label: '最多观察报文', type: 'number', defaultValue: 20 }
    ],
    steps: [
      { id: 'listener', title: '检查 UDP 监听', command: commands()[0], buildCommand: params => commands(params)[0], timeoutMs: 15000 },
      { id: 'firewall', title: '读取防火墙摘要', command: commands()[1], buildCommand: params => commands(params)[1], timeoutMs: 15000 },
      { id: 'probe', title: '执行 UDP 探测', command: commands()[2], buildCommand: params => commands(params)[2], timeoutMs: 60000 },
      { id: 'capture', title: '观察 UDP 报文', command: commands()[3], buildCommand: params => commands(params)[3], timeoutMs: 45000 }
    ]
  })
])
