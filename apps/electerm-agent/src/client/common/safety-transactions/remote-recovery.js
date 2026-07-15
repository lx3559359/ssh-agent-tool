const safeIdPattern = /^[A-Za-z0-9_-]+$/
const validActions = new Set(['prepare', 'execute', 'rollback', 'verify'])
const actionLabels = {
  prepare: '准备',
  execute: '执行',
  rollback: '回滚',
  verify: '校验'
}

function resolveActionArguments (actionOrOptions, id) {
  if (actionOrOptions && typeof actionOrOptions === 'object') {
    return {
      action: actionOrOptions.action,
      id: actionOrOptions.id
    }
  }
  return { action: actionOrOptions, id }
}

function validateAction (action, id) {
  if (!validActions.has(action)) {
    throw new Error('远程动作只支持 prepare、execute、rollback 或 verify。')
  }
  if (!safeIdPattern.test(String(id || ''))) {
    throw new Error('远程恢复动作标识无效，只允许字母、数字、下划线和连字符。')
  }
}

function markerPrefix (action, id) {
  return `__SHELLPILOT_${action.toUpperCase()}_RC_${id}`
}

export function buildVerifiedRemoteAction (command, actionOrOptions, id) {
  const resolved = resolveActionArguments(actionOrOptions, id)
  validateAction(resolved.action, resolved.id)
  const remoteCommand = String(command || '').trim()
  if (!remoteCommand || /[\0\r\n]/.test(remoteCommand)) {
    throw new Error('远程恢复命令为空或包含不安全换行，已拒绝执行。')
  }
  const marker = markerPrefix(resolved.action, resolved.id)
  return `( ${remoteCommand} ); __shellpilot_rc=$?; printf '\\n${marker}=%s\\n' "$__shellpilot_rc"; exit "$__shellpilot_rc"`
}

export function parseRemoteActionMarker (output, actionOrOptions, id) {
  const resolved = resolveActionArguments(actionOrOptions, id)
  validateAction(resolved.action, resolved.id)
  const marker = markerPrefix(resolved.action, resolved.id)
  const matches = [...String(output || '').matchAll(new RegExp(`^[ \\t]*${marker}=(\\d+)[ \\t]*\\r?$`, 'gm'))]
  const match = matches.at(-1)
  if (!match) {
    throw new Error(`远程${actionLabels[resolved.action]}未返回执行状态标记，无法确认结果。`)
  }
  const code = Number(match[1])
  if (code !== 0) {
    const error = new Error(`远程${actionLabels[resolved.action]}执行失败，退出码 ${code}。`)
    error.code = code
    throw error
  }
  return code
}
