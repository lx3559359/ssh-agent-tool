import { redactAuditText } from '../../../common/safety-transactions/audit-redaction.js'

const defaultMaxCharacters = 12000

export function buildOperationsAIContext ({
  task,
  tool,
  maxCharacters = defaultMaxCharacters
} = {}) {
  const parts = [
    '请分析下面的运维诊断结果，并用中文说明：异常点、可能原因、建议的下一步只读检查。不要假设已执行任何修复。',
    `诊断工具：${tool?.title || task?.toolId || '未知'}`,
    `服务器：${task?.endpointKey || '未知'}`,
    `状态：${task?.status || '未知'}`
  ]
  const sensitive = tool?.risk === 'resource-sensitive'
  const allowedParameterIds = new Set(tool?.aiContext?.parameterIds || [])
  if (sensitive) {
    for (const parameter of tool?.parameters || []) {
      if (!allowedParameterIds.has(parameter.id)) continue
      const value = task?.params?.[parameter.id]
      if (value === undefined || value === null || value === '') continue
      parts.push(`${parameter.label}：${String(value)}`)
    }
  }
  const allowedStepIds = new Set(tool?.aiContext?.stepIds || [])
  for (const step of task?.steps || []) {
    if (sensitive && !allowedStepIds.has(step.id)) continue
    parts.push(`\n## ${step.title || step.id}\n${step.output || '无输出'}`)
  }
  if (task?.error) parts.push(`\n错误：${task.error}`)
  const safe = redactAuditText(parts.join('\n'))
  if (safe.length <= maxCharacters) return safe
  return `${safe.slice(0, maxCharacters)}\n\n[诊断内容过长，已截断；可在运维工具中查看完整本地记录]`
}
