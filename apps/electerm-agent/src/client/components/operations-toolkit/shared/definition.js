export const operationsToolTypes = Object.freeze({
  quick: 'quick',
  diagnostic: 'diagnostic',
  maintenance: 'maintenance'
})

export const operationsRiskTypes = Object.freeze({
  readonly: 'read-only',
  reversible: 'reversible-change',
  high: 'high-risk-change',
  blocked: 'non-recoverable'
})

const toolIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const stepIdPattern = /^[a-z][a-z0-9-]*$/

function freezeTool (tool) {
  tool.steps.forEach(Object.freeze)
  Object.freeze(tool.steps)
  if (tool.legacyIds) Object.freeze(tool.legacyIds)
  if (tool.parameters) {
    tool.parameters.forEach(Object.freeze)
    Object.freeze(tool.parameters)
  }
  return Object.freeze(tool)
}

export function defineOperationsTool (input) {
  const tool = {
    ...input,
    steps: (input?.steps || []).map(step => ({ ...step })),
    legacyIds: input?.legacyIds ? [...input.legacyIds] : undefined,
    parameters: input?.parameters
      ? input.parameters.map(parameter => ({ ...parameter }))
      : undefined
  }
  if (!toolIdPattern.test(tool.id || '')) {
    throw new Error('运维工具标识无效')
  }
  if (!String(tool.title || '').trim() || !String(tool.category || '').trim()) {
    throw new Error('运维工具缺少名称或分类')
  }
  if (!Object.values(operationsToolTypes).includes(tool.type)) {
    throw new Error('运维工具类型无效')
  }
  if (!Object.values(operationsRiskTypes).includes(tool.risk)) {
    throw new Error('运维工具风险类型无效')
  }
  if (!Array.isArray(tool.steps) || tool.steps.length === 0) {
    throw new Error('运维工具必须包含至少一个步骤')
  }
  const stepIds = new Set()
  tool.steps = tool.steps.map(step => {
    if (!stepIdPattern.test(step.id || '') || stepIds.has(step.id)) {
      throw new Error('运维工具步骤标识无效或重复')
    }
    if (!String(step.command || '').trim()) {
      throw new Error('运维工具步骤命令不能为空')
    }
    stepIds.add(step.id)
    return {
      timeoutMs: 60000,
      ...step
    }
  })
  if (tool.legacyIds !== undefined) {
    if (!Array.isArray(tool.legacyIds) ||
      tool.legacyIds.some(id => !String(id || '').trim())) {
      throw new Error('运维工具旧 ID 无效')
    }
  }
  return freezeTool(tool)
}
