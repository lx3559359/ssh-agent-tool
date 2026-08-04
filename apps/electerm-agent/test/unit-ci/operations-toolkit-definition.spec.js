const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const validTool = {
  id: 'system.overview',
  title: '系统运行概览',
  type: 'diagnostic',
  category: 'system',
  risk: 'read-only',
  steps: [
    {
      id: 'collect',
      command: 'uptime'
    }
  ]
}

test('readonly operations tool requires stable id and at least one step', async () => {
  const { defineOperationsTool } = await importModule(
    'src/client/components/operations-toolkit/shared/definition.js'
  )
  assert.throws(() => defineOperationsTool({
    ...validTool,
    id: 'bad id'
  }), /工具标识无效/)
  assert.throws(() => defineOperationsTool({
    ...validTool,
    steps: []
  }), /至少一个步骤/)
})

test('operations tool definition is normalized and deeply frozen', async () => {
  const { defineOperationsTool } = await importModule(
    'src/client/components/operations-toolkit/shared/definition.js'
  )
  const tool = defineOperationsTool(validTool)
  assert.equal(tool.steps[0].timeoutMs, 60000)
  assert.equal(Object.isFrozen(tool), true)
  assert.equal(Object.isFrozen(tool.steps), true)
  assert.equal(Object.isFrozen(tool.steps[0]), true)
})

test('resource-sensitive tools require explicit confirmation metadata', async () => {
  const {
    defineOperationsTool,
    operationsRiskTypes
  } = await importModule(
    'src/client/components/operations-toolkit/shared/definition.js'
  )
  assert.equal(
    operationsRiskTypes.resourceSensitive,
    'resource-sensitive'
  )
  const tool = defineOperationsTool({
    ...validTool,
    risk: 'resource-sensitive',
    requiresConfirmation: true,
    parameters: [{
      id: 'protocol',
      options: [{ label: 'TCP', value: 'tcp' }],
      enabledWhen: { parameterId: 'mode', values: ['capture'] }
    }],
    aiContext: {
      parameterIds: ['protocol'],
      stepIds: ['collect']
    }
  })
  assert.equal(tool.requiresConfirmation, true)
  assert.equal(Object.isFrozen(tool.aiContext), true)
  assert.equal(Object.isFrozen(tool.aiContext.parameterIds), true)
  assert.equal(Object.isFrozen(tool.aiContext.stepIds), true)
  assert.equal(Object.isFrozen(tool.parameters[0]), true)
  assert.equal(Object.isFrozen(tool.parameters[0].options), true)
  assert.equal(Object.isFrozen(tool.parameters[0].options[0]), true)
  assert.equal(Object.isFrozen(tool.parameters[0].enabledWhen), true)
  assert.equal(Object.isFrozen(tool.parameters[0].enabledWhen.values), true)
  assert.throws(() => defineOperationsTool({
    ...validTool,
    risk: 'resource-sensitive'
  }), /必须确认/)
})

test('catalog rejects duplicate tool and legacy ids', async () => {
  const { buildOperationsCatalog } = await importModule(
    'src/client/components/operations-toolkit/catalog/index.js'
  )
  assert.throws(
    () => buildOperationsCatalog([[validTool], [{ ...validTool }]]),
    /运维工具 ID 重复/
  )
  assert.throws(
    () => buildOperationsCatalog([[
      { ...validTool, legacyIds: ['legacy-overview'] },
      {
        ...validTool,
        id: 'system.other',
        legacyIds: ['legacy-overview']
      }
    ]]),
    /旧 ID 重复/
  )
  assert.throws(
    () => buildOperationsCatalog([[
      { ...validTool, legacyIds: ['system.other'] },
      {
        ...validTool,
        id: 'system.other'
      }
    ]]),
    /ID 与旧 ID 冲突/
  )
})
