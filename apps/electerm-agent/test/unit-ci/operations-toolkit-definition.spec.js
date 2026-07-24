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
