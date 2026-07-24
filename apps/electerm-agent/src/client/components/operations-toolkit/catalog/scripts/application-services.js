import {
  assertHost,
  assertPort,
  assertServiceName,
  shellQuote
} from '../../shared/validation.js'
import { defineReadOnlyRunbook, readOnlyStep } from './helpers.js'

function normalizeServices (values = [], capabilities = {}) {
  const available = new Set(
    (capabilities.services || []).map(item => item.name)
  )
  const selected = [...new Set(values.map(value => assertServiceName(value)))]
  if (selected.some(value => !available.has(value))) {
    throw new Error('只能选择当前服务器已发现的服务')
  }
  return selected
}

function selectedServices (params, capabilities) {
  const selected = normalizeServices(params.services || [], capabilities)
  return selected.length ? selected : ['sshd.service']
}

function serviceCommand (params, capabilities, create) {
  return selectedServices(params, capabilities)
    .map(name => create(shellQuote(name)))
    .join('; ')
}

function webTarget (params = {}) {
  return {
    host: assertHost(params.host || '127.0.0.1', '目标主机'),
    port: assertPort(params.port || 80)
  }
}

export const applicationServiceRunbooks = Object.freeze([
  defineReadOnlyRunbook({
    id: 'runbook.web.gateway',
    title: 'Web 502/504 故障包',
    description: '联合检查 Web 服务、监听、配置、错误日志和本机 HTTP 响应。',
    category: '应用服务',
    parameters: [
      { id: 'host', label: '目标主机', type: 'host', defaultValue: '127.0.0.1' },
      { id: 'port', label: 'HTTP 端口', type: 'port', defaultValue: 80 }
    ],
    steps: [
      readOnlyStep(
        'services',
        '检查 Web 与上游服务',
        'systemctl status nginx apache2 httpd php-fpm --no-pager 2>/dev/null || true; systemctl --failed --no-pager 2>/dev/null || true'
      ),
      readOnlyStep(
        'listeners',
        '检查监听与连接',
        'ss -lntp 2>/dev/null | grep -E ":(80|443)([[:space:]]|$)" || netstat -lntp 2>/dev/null | grep -E ":(80|443)([[:space:]]|$)" || true'
      ),
      readOnlyStep(
        'configuration',
        '验证 Web 配置',
        'command -v nginx >/dev/null 2>&1 && nginx -t 2>&1 || true; command -v apachectl >/dev/null 2>&1 && apachectl configtest 2>&1 || true'
      ),
      readOnlyStep(
        'logs',
        '读取近期错误日志',
        'journalctl -u nginx -u apache2 -u httpd -u php-fpm -n 160 --no-pager 2>/dev/null || true; find /var/log/nginx /var/log/apache2 /var/log/httpd -maxdepth 1 -type f -name "*error*" -exec tail -n 80 {} \\; 2>/dev/null | tail -n 240 || true'
      ),
      readOnlyStep(
        'probe',
        '检查 HTTP 响应',
        'curl -sS -o /dev/null -D - --max-time 8 http://127.0.0.1:80/ 2>&1 || true',
        params => {
          const target = webTarget(params)
          return `curl -sS -o /dev/null -D - --max-time 8 ${shellQuote(`http://${target.host}:${target.port}/`)} 2>&1 || true`
        },
        20000
      )
    ]
  }),
  defineReadOnlyRunbook({
    id: 'runbook.container.runtime',
    title: 'Docker/Podman 容器故障包',
    description: '采集运行时、容器状态、资源占用、事件和近期异常日志。',
    category: '应用服务',
    steps: [
      readOnlyStep(
        'runtime',
        '识别容器运行时',
        'if command -v docker >/dev/null 2>&1; then docker version 2>&1; elif command -v podman >/dev/null 2>&1; then podman version 2>&1; else printf "未发现 Docker 或 Podman\\n"; fi'
      ),
      readOnlyStep(
        'inventory',
        '列出容器与健康状态',
        'if command -v docker >/dev/null 2>&1; then docker ps -a --no-trunc; elif command -v podman >/dev/null 2>&1; then podman ps -a --no-trunc; else printf "无可用容器运行时\\n"; fi'
      ),
      readOnlyStep(
        'resources',
        '读取资源与存储占用',
        'if command -v docker >/dev/null 2>&1; then docker stats --no-stream 2>&1; docker system df 2>&1; elif command -v podman >/dev/null 2>&1; then podman stats --no-stream 2>&1; podman system df 2>&1; else printf "无可用容器运行时\\n"; fi'
      ),
      readOnlyStep(
        'events',
        '读取近期事件与异常日志',
        'if command -v docker >/dev/null 2>&1; then docker events --since 2h --until 0s 2>&1 | tail -n 120; for id in $(docker ps -aq --filter status=exited | head -n 5); do printf "## %s\\n" "$id"; docker logs --tail 80 "$id" 2>&1; done; elif command -v podman >/dev/null 2>&1; then podman events --since 2h --until 0s 2>&1 | tail -n 120; else printf "无可用容器运行时\\n"; fi',
        undefined,
        90000
      )
    ]
  }),
  defineReadOnlyRunbook({
    id: 'runbook.service.incident',
    title: '指定服务故障排查',
    description: '从自动发现的服务中多选，统一采集状态、进程、日志和监听端口。',
    category: '应用服务',
    parameters: [
      {
        id: 'services',
        label: '选择服务',
        type: 'multi-select',
        source: 'services',
        defaultValue: []
      }
    ],
    steps: [
      readOnlyStep(
        'status',
        '读取服务状态',
        'systemctl --failed --no-pager 2>/dev/null || true',
        (params, capabilities) => serviceCommand(
          params,
          capabilities,
          value => `printf "## %s\\n" ${value}; systemctl show ${value} --no-pager --property=Id,LoadState,ActiveState,SubState,UnitFileState,MainPID,ExecMainStatus 2>/dev/null || true`
        )
      ),
      readOnlyStep(
        'process',
        '读取关联进程',
        'ps -ef | head -n 80',
        (params, capabilities) => serviceCommand(
          params,
          capabilities,
          value => `systemctl status ${value} --no-pager 2>/dev/null | head -n 80 || true`
        )
      ),
      readOnlyStep(
        'logs',
        '读取近期服务日志',
        'journalctl -n 120 --no-pager 2>/dev/null || true',
        (params, capabilities) => serviceCommand(
          params,
          capabilities,
          value => `printf "## %s\\n" ${value}; journalctl -u ${value} -n 120 --no-pager 2>/dev/null || true`
        )
      ),
      readOnlyStep(
        'ports',
        '关联进程与监听端口',
        'ss -lntup 2>/dev/null || netstat -lntup 2>/dev/null || true'
      )
    ]
  })
])
