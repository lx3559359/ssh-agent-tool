import { assertHost, shellQuote } from '../../shared/validation.js'
import { defineReadOnlyRunbook, readOnlyStep } from './helpers.js'

function targetHost (params = {}) {
  return assertHost(params.host || '1.1.1.1', '目标主机')
}

export const networkSecurityRunbooks = Object.freeze([
  defineReadOnlyRunbook({
    id: 'runbook.network.intermittent',
    title: '网络间歇性故障排查',
    description: '联合采集链路、路由、DNS、丢包、路径和连接状态，适合偶发断连。',
    category: '网络安全',
    parameters: [
      { id: 'host', label: '目标主机', type: 'host', defaultValue: '1.1.1.1' }
    ],
    steps: [
      readOnlyStep(
        'interfaces',
        '检查网卡与错误计数',
        'ip -brief link; ip -brief address; ip -s link'
      ),
      readOnlyStep(
        'route',
        '检查路由与邻居',
        'ip route show table all; ip rule show; ip neigh show'
      ),
      readOnlyStep(
        'dns',
        '检查 DNS 解析',
        'cat /etc/resolv.conf; getent ahosts 1.1.1.1 || true',
        params => {
          const host = shellQuote(targetHost(params))
          return `cat /etc/resolv.conf; getent ahosts ${host} || true; command -v resolvectl >/dev/null 2>&1 && resolvectl query ${host} || true`
        }
      ),
      readOnlyStep(
        'latency',
        '采样延迟与丢包',
        'ping -c 6 -W 2 1.1.1.1 || true',
        params => `ping -c 6 -W 2 ${shellQuote(targetHost(params))} || true`,
        30000
      ),
      readOnlyStep(
        'path',
        '检查路径与连接状态',
        'tracepath -m 16 1.1.1.1 2>/dev/null || true; ss -s 2>/dev/null || true',
        params => {
          const host = shellQuote(targetHost(params))
          return `command -v tracepath >/dev/null 2>&1 && tracepath -m 16 ${host} || command -v traceroute >/dev/null 2>&1 && traceroute -m 16 ${host} || printf "未安装 tracepath/traceroute\\n"; ss -s 2>/dev/null || true`
        },
        60000
      )
    ]
  }),
  defineReadOnlyRunbook({
    id: 'runbook.security.ssh-audit',
    title: 'SSH 登录安全审计',
    description: '检查 SSH 配置摘要、监听、登录失败、在线会话和账号安全线索。',
    category: '网络安全',
    steps: [
      readOnlyStep(
        'configuration',
        '读取 SSH 生效配置',
        'sshd -T 2>/dev/null | grep -Ei "^(port|listenaddress|permitrootlogin|passwordauthentication|pubkeyauthentication|maxauthtries|allowusers|allowgroups|denyusers|denygroups|loglevel)" || true'
      ),
      readOnlyStep(
        'listeners',
        '检查 SSH 监听与进程',
        'ss -lntp 2>/dev/null | grep -E "sshd|:22([[:space:]]|$)" || netstat -lntp 2>/dev/null | grep -E "sshd|:22([[:space:]]|$)" || true; ps -ef | grep "[s]shd"'
      ),
      readOnlyStep(
        'logins',
        '汇总登录与失败尝试',
        'last -a 2>/dev/null | head -n 80; printf "## failed\\n"; lastb -a 2>/dev/null | head -n 80 || journalctl -u ssh -u sshd --since "-24 hours" --no-pager 2>/dev/null | grep -Ei "failed|invalid|authentication" | tail -n 120 || true'
      ),
      readOnlyStep(
        'accounts',
        '检查高权限账号与在线会话',
        'printf "## uid0\\n"; awk -F: \'$3 == 0 {print $1 ":" $6 ":" $7}\' /etc/passwd; printf "## sessions\\n"; who; w'
      )
    ]
  })
])
