import { defineOperationsTool } from '../../shared/definition.js'
import {
  assertHost,
  assertIntegerRange,
  shellQuote
} from '../../shared/validation.js'

function tool (id, title, category, command, extra = {}) {
  return defineOperationsTool({
    id,
    title,
    description: extra.description || title,
    category,
    type: 'diagnostic',
    risk: 'read-only',
    parameters: extra.parameters,
    steps: [{
      id: 'collect',
      title: '采集只读信息',
      command,
      buildCommand: extra.buildCommand,
      timeoutMs: extra.timeoutMs || 60000
    }]
  })
}

export const networkSecurityTools = Object.freeze([
  tool(
    'network.interface-health',
    '网卡、地址与链路状态',
    '网络',
    'ip -brief link; ip -brief address; ip -s link; ip route show table main'
  ),
  tool(
    'network.tcp-connections',
    'TCP 监听与连接统计',
    '网络',
    'if command -v ss >/dev/null 2>&1; then ss -s; ss -lntp; ss -ant state established | head -n 200; else netstat -s; netstat -lntp; fi'
  ),
  tool(
    'network.dns-chain',
    'DNS 解析链路检查',
    '网络',
    'cat /etc/resolv.conf; getent ahosts localhost',
    {
      parameters: [
        { id: 'host', label: '域名或地址', type: 'host', defaultValue: 'localhost' }
      ],
      buildCommand: params => {
        const host = shellQuote(assertHost(params.host || 'localhost', '目标'))
        return `cat /etc/resolv.conf; getent ahosts ${host}; command -v resolvectl >/dev/null 2>&1 && resolvectl query ${host} || true; command -v dig >/dev/null 2>&1 && dig +time=3 +tries=1 ${host} || true`
      }
    }
  ),
  tool(
    'network.route-mtu',
    '路由、策略与 MTU',
    '网络',
    'ip route show table all; ip rule show; ip -d link show; ip neigh show'
  ),
  tool(
    'network.loss-latency',
    '丢包与延迟检查',
    '网络',
    'ping -c 4 -W 2 127.0.0.1',
    {
      timeoutMs: 45000,
      parameters: [
        { id: 'host', label: '目标', type: 'host', defaultValue: '127.0.0.1' },
        { id: 'count', label: '次数', type: 'number', defaultValue: 4 }
      ],
      buildCommand: params => {
        const host = shellQuote(assertHost(params.host || '127.0.0.1', '目标'))
        const count = assertIntegerRange(params.count || 4, 1, 20, '次数')
        return `ping -c ${count} -W 2 ${host}; command -v tracepath >/dev/null 2>&1 && tracepath -m 12 ${host} || true`
      }
    }
  ),
  tool(
    'security.firewall-exposure',
    '防火墙与暴露端口',
    '安全',
    'printf "## 监听端口\\n"; (ss -lntup 2>/dev/null || netstat -lntup 2>/dev/null); printf "## 防火墙\\n"; if command -v firewall-cmd >/dev/null 2>&1; then firewall-cmd --state; firewall-cmd --list-all; elif command -v ufw >/dev/null 2>&1; then ufw status verbose; elif command -v nft >/dev/null 2>&1; then nft list ruleset 2>/dev/null | head -n 300; elif command -v iptables >/dev/null 2>&1; then iptables -S 2>/dev/null | head -n 300; else printf "unsupported: 未发现防火墙管理工具\\n"; fi'
  ),
  tool(
    'security.ssh-login',
    'SSH 登录与失败尝试',
    '安全',
    'if command -v journalctl >/dev/null 2>&1; then journalctl -u ssh -u sshd --since "-24 hours" --no-pager 2>/dev/null | tail -n 200; elif test -r /var/log/auth.log; then tail -n 200 /var/log/auth.log; elif test -r /var/log/secure; then tail -n 200 /var/log/secure; else printf "unsupported: 未发现 SSH 登录日志\\n"; fi'
  )
])
