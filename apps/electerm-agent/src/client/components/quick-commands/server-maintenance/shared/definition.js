import { createMutationSafetyMetadata } from './safety-metadata.js'

const mutationSafetyByCommandId = {
  'builtin-server-network-change-ip': {
    backupTargets: [
      '/etc/resolv.conf',
      '/etc/NetworkManager/system-connections'
    ],
    verifyCommands: [
      'ip -4 address show dev "{{网卡}}" | grep -F -- "inet {{新IP/CIDR}}" >/dev/null'
    ]
  },
  'builtin-server-firewall-open-port': {
    backupTargets: [
      '/etc/firewalld/firewalld.conf',
      '/etc/default/ufw',
      '/etc/ufw/ufw.conf'
    ],
    verifyCommands: [
      'VERIFY_AS=""; [ "$(id -u)" = "0" ] || VERIFY_AS="sudo"; if command -v firewall-cmd >/dev/null 2>&1; then $VERIFY_AS firewall-cmd --query-port="{{端口}}/{{协议}}" >/dev/null; elif command -v ufw >/dev/null 2>&1; then $VERIFY_AS ufw status | grep -F -- "{{端口}}/{{协议}}" >/dev/null; else exit 1; fi'
    ]
  },
  'builtin-server-service-action': {
    backupTargets: [
      '/etc/systemd/system/{{服务名称}}',
      '/lib/systemd/system/{{服务名称}}',
      '/usr/lib/systemd/system/{{服务名称}}'
    ],
    verifyCommands: [
      'LOAD_STATE="$(systemctl show -p LoadState --value "{{服务名称}}" 2>/dev/null)"; [ -n "$LOAD_STATE" ] && [ "$LOAD_STATE" != "not-found" ] && case "{{操作}}" in start|restart|reload) systemctl is-active --quiet "{{服务名称}}" ;; stop) ! systemctl is-active --quiet "{{服务名称}}" ;; enable) systemctl is-enabled --quiet "{{服务名称}}" ;; disable) ! systemctl is-enabled --quiet "{{服务名称}}" ;; *) exit 1 ;; esac'
    ]
  },
  'builtin-server-docker-action': {
    backupTargets: ['/etc/docker/daemon.json'],
    verifyCommands: [
      'case "{{操作}}" in stop) EXPECTED_RUNNING=false ;; start|restart) EXPECTED_RUNNING=true ;; *) exit 1 ;; esac; [ "$(docker inspect -f \'{{.State.Running}}\' "{{容器名称}}" 2>/dev/null)" = "$EXPECTED_RUNNING" ]'
    ]
  },
  'builtin-server-file-permission': {
    backupTargets: ['{{目标路径}}'],
    verifyCommands: [
      'EXPECTED_MODE="$(printf \'%s\' "{{权限模式}}" | sed \'s/^0*//\')"; [ -n "$EXPECTED_MODE" ] || EXPECTED_MODE=0; [ "$(stat -c %a -- "{{目标路径}}")" = "$EXPECTED_MODE" ] && { [ -z "{{所有者}}" ] || [ "$(stat -c %U -- "{{目标路径}}")" = "{{所有者}}" ]; } && { [ -z "{{所属组}}" ] || [ "$(stat -c %G -- "{{目标路径}}")" = "{{所属组}}" ]; }'
    ]
  }
}

export const COMMON_DELAY = 100

export const BUILTIN = '内置'

export const MAINTENANCE = '服务器维护'

export const READ_ONLY = '只读'

export const NEED_EDIT = '需编辑'

export function step (command, delay = COMMON_DELAY) {
  return {
    command,
    delay
  }
}

function createCommandSafetyMetadata (item) {
  const configured = item.mutationSafety || mutationSafetyByCommandId[item.id] || {}
  return createMutationSafetyMetadata({
    title: configured.title || item.rollback?.title || item.name || item.id,
    backupTargets: configured.backupTargets || [],
    verifyCommands: configured.verifyCommands || [
      'test -s "{{回滚脚本}}"'
    ]
  })
}

export function defineCommand (item) {
  const params = [...(item.params || [])]
  if (item.mutatesServer) {
    if (!params.some(param => param.name === '回滚脚本')) {
      params.push({
        name: '回滚脚本',
        label: '回滚脚本',
        type: 'hidden',
        defaultValue: '{{回滚脚本}}',
        help: '由 ShellPilot 自动生成并保存在服务器 /tmp/shellpilot-rollback 目录。'
      })
    }
    if (!params.some(param => param.name === '确认执行')) {
      params.push({
        name: '确认执行',
        label: '确认执行',
        type: 'select',
        defaultValue: 'no',
        help: '默认不修改服务器；只有选择“是”才会执行变更并创建回滚点。',
        options: [
          { label: '否，只预览', value: 'no' },
          { label: '是，执行修改', value: 'yes' }
        ]
      })
    }
  }
  const command = {
    inputOnly: false,
    advancedUsage: item.advancedUsage || [],
    ...item,
    params,
    labels: [BUILTIN, MAINTENANCE, ...(item.labels || [])]
  }
  if (item.mutatesServer) {
    Object.defineProperty(command, 'safetyMetadata', {
      configurable: false,
      enumerable: false,
      value: createCommandSafetyMetadata(item),
      writable: false
    })
  }
  return command
}

export function inputParam (name, label, defaultValue, help, placeholder = '', options = {}) {
  return { name, label, type: 'input', defaultValue, help, placeholder, ...options }
}

export function numberParam (name, label, defaultValue, help, min = 1, max = 10000, options = {}) {
  return { name, label, type: 'number', defaultValue, help, min, max, ...options }
}

export function selectParam (name, label, defaultValue, help, choices, options = {}) {
  return { name, label, type: 'select', defaultValue, help, options: choices, ...options }
}
