import { quoteShellValue, validateValue } from './validation.js'

const shellVariablePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function buildShellAssignment (shellName, value, validationType, options = {}) {
  if (!shellVariablePattern.test(String(shellName || ''))) {
    throw new Error(`Shell 变量名不合法: ${shellName || ''}`)
  }
  if (!validationType) {
    throw new Error(`${options.label || shellName}缺少校验类型，已拒绝生成 Shell 赋值`)
  }
  const message = validateValue(validationType, value, options)
  if (message) throw new Error(message)
  return `${shellName}=${quoteShellValue(value)}`
}

export function buildShellAssignments (fields = [], values = {}) {
  if (!Array.isArray(fields)) {
    throw new Error('Shell 赋值字段必须是数组')
  }
  return fields.map(field => {
    if (!field || typeof field !== 'object') {
      throw new Error('Shell 赋值字段定义不完整')
    }
    return buildShellAssignment(
      field.shellName,
      values?.[field.name],
      field.validationType,
      field
    )
  }).join('\n')
}

export const buildValidatedShellAssignments = buildShellAssignments
