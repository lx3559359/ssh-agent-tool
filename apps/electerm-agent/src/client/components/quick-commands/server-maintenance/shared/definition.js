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
  return {
    inputOnly: false,
    advancedUsage: item.advancedUsage || [],
    ...item,
    params,
    labels: [BUILTIN, MAINTENANCE, ...(item.labels || [])]
  }
}

export function inputParam (name, label, defaultValue, help, placeholder = '') {
  return { name, label, type: 'input', defaultValue, help, placeholder }
}

export function numberParam (name, label, defaultValue, help, min = 1, max = 10000) {
  return { name, label, type: 'number', defaultValue, help, min, max }
}

export function selectParam (name, label, defaultValue, help, options) {
  return { name, label, type: 'select', defaultValue, help, options }
}
