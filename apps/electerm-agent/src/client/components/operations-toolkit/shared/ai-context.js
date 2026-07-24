import { redactAuditText } from '../../../common/safety-transactions/audit-redaction.js'

const defaultMaxCharacters = 12000

export function buildOperationsAIContext ({
  task,
  tool,
  maxCharacters = defaultMaxCharacters
} = {}) {
  const parts = [
    '请分析下面的只读运维诊断结果，并用中文说明：异常点、可能原因、建议的下一步只读检查。不要假设已执行任何修复。',
    `诊断工具：${tool?.title || task?.toolId || '未知'}`,
    `服务器：${task?.endpointKey || '未知'}`,
    `状态：${task?.status || '未知'}`
  ]
  for (const step of task?.steps || []) {
    parts.push(`\n## ${step.title || step.id}\n${step.output || '无输出'}`)
  }
  if (task?.error) parts.push(`\n错误：${task.error}`)
  const safe = redactAuditText(parts.join('\n'))
  if (safe.length <= maxCharacters) return safe
  return `${safe.slice(0, maxCharacters)}\n\n[诊断内容过长，已截断；可在运维工具中查看完整本地记录]`
}
