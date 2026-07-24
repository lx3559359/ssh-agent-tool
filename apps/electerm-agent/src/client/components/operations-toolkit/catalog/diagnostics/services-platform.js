import { defineOperationsTool } from '../../shared/definition.js'
import {
  assertHost,
  assertServiceName,
  shellQuote
} from '../../shared/validation.js'

export function normalizeServiceSelection (values = [], capabilities = {}) {
  const available = new Set(
    (capabilities.services || []).map(item => item.name)
  )
  const selected = [...new Set(values.map(value => assertServiceName(value)))]
  if (selected.some(value => !available.has(value))) {
    throw new Error('只能选择当前服务器已发现的服务')
  }
  return selected
}

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

export const servicesPlatformTools = Object.freeze([
  tool(
    'service.inventory-health',
    '已安装服务清单与状态',
    '服务',
    'if command -v systemctl >/dev/null 2>&1; then systemctl list-units --type=service --all --no-pager --no-legend; systemctl list-unit-files --type=service --no-pager --no-legend; else service --status-all 2>&1; fi',
    {
      parameters: [
        { id: 'services', label: '选择服务', type: 'multi-select', source: 'services' }
      ],
      buildCommand: (params, capabilities) => {
        const selected = normalizeServiceSelection(
          params.services || [],
          capabilities
        )
        if (!selected.length) {
          return 'systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null || service --status-all 2>&1'
        }
        return selected.map(name => {
          const value = shellQuote(name)
          return `printf "## %s\\n" ${value}; systemctl show ${value} --no-pager --property=Id,LoadState,ActiveState,SubState,UnitFileState,MainPID,ExecMainStatus 2>/dev/null || service ${value} status 2>&1`
        }).join('; ')
      }
    }
  ),
  tool(
    'service.failed-related-logs',
    '失败服务与关联日志',
    '服务',
    'if command -v systemctl >/dev/null 2>&1; then systemctl --failed --no-pager; for unit in $(systemctl --failed --no-legend --plain 2>/dev/null | awk \'{print $1}\' | head -n 20); do printf "## %s\\n" "$unit"; journalctl -u "$unit" -n 100 --no-pager 2>/dev/null; done; else printf "unsupported: 非 systemd 系统\\n"; fi'
  ),
  tool(
    'logs.system-anomaly-summary',
    '系统异常日志摘要',
    '日志',
    'if command -v journalctl >/dev/null 2>&1; then journalctl --since "-24 hours" -p warning --no-pager | tail -n 300; else grep -Ehi "error|failed|panic|oom|segfault" /var/log/messages /var/log/syslog 2>/dev/null | tail -n 300; fi'
  ),
  tool(
    'web.nginx-apache-diagnostic',
    'Nginx 与 Apache 配置诊断',
    'Web',
    'command -v nginx >/dev/null 2>&1 && nginx -t 2>&1 || true; command -v apachectl >/dev/null 2>&1 && apachectl configtest 2>&1 || true; (ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null) | grep -E ":(80|443)([[:space:]]|$)" || true'
  ),
  tool(
    'web.http-tls-check',
    'HTTP 与 TLS 连通性',
    'Web',
    'curl -kIsS --max-time 8 https://127.0.0.1/ 2>&1 | head -n 30',
    {
      parameters: [
        { id: 'host', label: '目标主机', type: 'host', defaultValue: '127.0.0.1' }
      ],
      buildCommand: params => {
        const host = assertHost(params.host || '127.0.0.1', '目标主机')
        const url = shellQuote(`https://${host}/`)
        return `curl -kIsS --max-time 8 ${url} 2>&1 | head -n 40; command -v openssl >/dev/null 2>&1 && timeout 10 openssl s_client -connect ${shellQuote(`${host}:443`)} -servername ${shellQuote(host)} </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates 2>/dev/null || true`
      }
    }
  ),
  tool(
    'container.runtime-health',
    '容器运行时与容器状态',
    '容器',
    'if command -v docker >/dev/null 2>&1; then docker version 2>&1; docker ps -a --no-trunc; elif command -v podman >/dev/null 2>&1; then podman version; podman ps -a --no-trunc; else printf "unsupported: 未安装 Docker 或 Podman\\n"; fi'
  ),
  tool(
    'container.storage-resources',
    '容器存储与资源占用',
    '容器',
    'if command -v docker >/dev/null 2>&1; then docker system df -v 2>&1; docker stats --no-stream 2>&1; elif command -v podman >/dev/null 2>&1; then podman system df 2>&1; podman stats --no-stream 2>&1; else printf "unsupported: 未安装 Docker 或 Podman\\n"; fi'
  ),
  tool(
    'service.scheduled-tasks',
    '定时任务与计时器',
    '服务',
    'printf "## systemd timers\\n"; systemctl list-timers --all --no-pager 2>/dev/null || true; printf "## 当前用户 crontab\\n"; crontab -l 2>/dev/null || true; printf "## 系统 cron\\n"; find /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly -maxdepth 1 -type f -printf "%p\\n" 2>/dev/null | sort'
  )
])
