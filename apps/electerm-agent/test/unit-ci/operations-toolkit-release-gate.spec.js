const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { importModule } = require('./helpers/import-esm')

test('operations catalog keeps diagnostics and runbooks complete and safely classified', async () => {
  const { getOperationsCatalog } = await importModule(
    'src/client/components/operations-toolkit/catalog/index.js'
  )
  const catalog = getOperationsCatalog()
  const diagnostics = catalog.filter(tool => tool.type === 'diagnostic')
  const runbooks = catalog.filter(tool => tool.type === 'script')

  assert.equal(diagnostics.length, 30)
  assert.equal(runbooks.length, 10)
  assert.equal(catalog.length, 40)
  assert.equal(new Set(catalog.map(tool => tool.id)).size, catalog.length)
  assert.deepEqual(
    catalog
      .filter(tool => tool.risk === 'resource-sensitive')
      .map(tool => tool.id),
    ['network.packet-capture']
  )
  assert.equal(
    catalog
      .filter(tool => tool.id !== 'network.packet-capture')
      .every(tool => tool.risk === 'read-only'),
    true
  )
  assert.equal(catalog.every(tool => tool.steps.length > 0), true)
  assert.equal(runbooks.every(tool => tool.steps.length >= 3), true)
})

test('public operations completion waits for history synchronization', () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../src/client/store/operations-toolkit.js'
    ),
    'utf8'
  )

  assert.match(source, /const completion = active\.completion\.then/)
  assert.match(source, /store\.operationsHistory = .*taskStore\.list\(\)/)
  assert.match(source, /return \{ \.\.\.active, completion \}/)
  assert.match(source, /confirmation:\s*options\.confirmation/)
  assert.match(source, /createOperationsIncidentCandidate/)
  assert.match(source, /captureIncidentCandidateSafely/)
  assert.match(source, /appendIncidentTimelineEvent/)
  assert.match(source, /createPtyTaskChannel/)
  assert.doesNotMatch(source, /createSshTaskChannel|cancelRunCmd/)
})

test('incident archive listens to safety transaction changes without blocking them', () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../src/client/store/incident-archives.js'
    ),
    'utf8'
  )

  assert.match(source, /safetyTransactionUpdatedEvent/)
  assert.match(source, /getOperation/)
  assert.match(source, /getTask/)
  assert.match(source, /captureIncidentTransactionChange/)
  assert.match(source, /\.catch\(\(\) => \{\}\)/)
})

test('operations workspace remains open until the user closes it', () => {
  const quickCommandsSource = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../src/client/components/quick-commands/quick-commands-box.jsx'
    ),
    'utf8'
  )
  const workspaceSource = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../src/client/components/operations-toolkit/workspace/operations-workspace.jsx'
    ),
    'utf8'
  )

  assert.doesNotMatch(quickCommandsSource, /onMouseLeave:\s*handleMouseLeave/)
  assert.doesNotMatch(quickCommandsSource, /setTimeout\(\(\) => \{\s*toggle\(false\)/)
  assert.match(workspaceSource, /onClick=\{\(\) => store\.closeOperationsToolkit\(\)\}/)
})

test('operations presentation preserves tabs, recommended order, named close actions, and safety copy', () => {
  const workspace = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/operations-toolkit/workspace/operations-workspace.jsx'),
    'utf8'
  )
  const i18n = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/common/shellpilot-i18n-overrides.js'),
    'utf8'
  )

  const expectedTabs = ['quick', 'diagnostic', 'maintenance', 'custom', 'history']
  assert.deepEqual(
    [...workspace.matchAll(/\{ value: '([^']+)', label:/g)].slice(0, 5).map(match => match[1]),
    expectedTabs
  )
  assert.match(workspace, /recommendedDiagnosticIds = \[[\s\S]*'service\.inventory-health'[\s\S]*'network\.tcp-connections'[\s\S]*'logs\.system-anomaly-summary'[\s\S]*'network\.interface-health'/)
  assert.ok((workspace.match(/aria-label=\{e\('shellpilotOperationsClose'\)\}/g) || []).length >= 2)
  assert.match(workspace, /shellpilotOperationsNeedsEdit/)
  assert.match(workspace, /shellpilotOperationsPreviewBeforeRun/)
  assert.match(workspace, /shellpilotOperationsConfirmBeforeChange/)
  assert.match(workspace, /shellpilotOperationsRollbackFromCenter/)
  assert.match(i18n, /shellpilotOperationsNeedsEdit: '需编辑'/)
  assert.match(i18n, /shellpilotOperationsPreviewBeforeRun: '执行前预览'/)
  assert.match(i18n, /shellpilotOperationsConfirmBeforeChange: '修改前确认'/)
})
