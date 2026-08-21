const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { importModule } = require('./helpers/import-esm')

const root = path.resolve(__dirname, '../..')

test('parameter dependencies disable port outside TCP and UDP', async () => {
  const {
    isOperationsParameterEnabled,
    normalizeOperationsParameterDependencies
  } = await importModule(
    'src/client/components/operations-toolkit/workspace/parameter-value.js'
  )
  const parameter = {
    enabledWhen: { id: 'protocol', values: ['tcp', 'udp'] }
  }
  assert.equal(isOperationsParameterEnabled(parameter, { protocol: 'tcp' }), true)
  assert.equal(isOperationsParameterEnabled(parameter, { protocol: 'icmp' }), false)
  assert.deepEqual(normalizeOperationsParameterDependencies({
    parameters: [
      { id: 'protocol', defaultValue: 'tcp' },
      { id: 'port', defaultValue: '', ...parameter }
    ]
  }, { protocol: 'icmp', port: 443 }), {
    protocol: 'icmp',
    port: ''
  })
})

test('workspace confirms resource-sensitive runs and passes binding', () => {
  const workspace = fs.readFileSync(
    path.join(root, 'src/client/components/operations-toolkit/workspace/operations-workspace.jsx'),
    'utf8'
  )
  assert.match(workspace, /Modal\.confirm/)
  assert.match(workspace, /createOperationsResourceConfirmation/)
  assert.match(workspace, /risk === 'resource-sensitive'/)
  assert.match(workspace, /runOperationsTool/)
  assert.match(workspace, /\{ confirmation \}/)
  assert.match(workspace, /shellpilotOperationsCaptureConfirmTitle/)
  assert.match(workspace, /shellpilotOperationsRunSensitive/)
})

test('resource-sensitive confirmation copy is bilingual', () => {
  const i18n = fs.readFileSync(
    path.join(root, 'src/client/common/shellpilot-i18n-overrides.js'),
    'utf8'
  )
  assert.equal(
    (i18n.match(/shellpilotOperationsResourceSensitive:/g) || []).length,
    2
  )
  assert.match(i18n, /shellpilotOperationsConfirmCapture: '确认抓包'/)
  assert.match(i18n, /shellpilotOperationsConfirmCapture: 'Start Capture'/)
})
