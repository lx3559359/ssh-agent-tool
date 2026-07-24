const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')

async function loadModule (file) {
  return import(pathToFileURL(path.join(root, file)).href)
}

test('operations AI context is bounded and redacts secrets', async () => {
  const { buildOperationsAIContext } = await loadModule(
    'src/client/components/operations-toolkit/shared/ai-context.js'
  )
  const value = buildOperationsAIContext({
    tool: { title: '测试诊断' },
    task: {
      toolId: 'test.readonly',
      endpointKey: 'root@example.com:22',
      status: 'completed',
      steps: [{
        id: 'collect',
        title: '采集',
        output: `Authorization: Bearer secret-token\n${'输出'.repeat(100)}`
      }]
    },
    maxCharacters: 180
  })
  assert.ok(value.length < 300)
  assert.doesNotMatch(value, /secret-token/)
  assert.match(value, /已截断/)
  assert.match(value, /不要假设已执行任何修复/)
})

test('operations workspace keeps quick actions and readonly diagnostics separate', () => {
  const fs = require('node:fs')
  const workspace = fs.readFileSync(
    path.join(root, 'src/client/components/operations-toolkit/workspace/operations-workspace.jsx'),
    'utf8'
  )
  assert.match(workspace, /shellpilotOperationsQuickActions/)
  assert.match(workspace, /shellpilotOperationsDiagnostics/)
  assert.match(workspace, /shellpilotOperationsSafeMaintenance/)
  assert.match(workspace, /hiddenCommandIds=\{hiddenQuickActionIds\}/)
  assert.match(workspace, /shellpilotOperationsRunReadonly/)
  assert.match(workspace, /cancelOperationsTask/)
  assert.match(workspace, /buildOperationsAIContext/)
})
