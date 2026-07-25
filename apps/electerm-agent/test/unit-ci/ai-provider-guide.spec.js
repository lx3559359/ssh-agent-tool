const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const root = path.resolve(__dirname, '../..')

test('recommended API providers support search, region filters, compatibility labels, and a clear test action', () => {
  const source = fs.readFileSync(path.join(root, 'src/client/components/ai/ai-config.jsx'), 'utf8')
  const catalog = fs.readFileSync(path.join(root, 'src/client/components/ai/ai-provider-catalog.js'), 'utf8')

  assert.match(source, /providerQuery/)
  assert.match(source, /providerRegion/)
  assert.match(source, /visibleRecommendedProviders/)
  assert.match(source, /shellpilotAiOpenAiCompatible/)
  assert.match(source, /shellpilotAiSaveTestHint/)
  assert.match(source, /loading=\{testing\} onClick=\{handleTest\}/)
  assert.match(catalog, /region: 'domestic'/)
  assert.match(catalog, /region: 'international'/)
  assert.match(catalog, /region: 'local'/)
  assert.match(catalog, /openAICompatible: true/)
})

test('operations workspace keeps a visible novice diagnostic flow and connects before attempting a run', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/client/components/operations-toolkit/workspace/operations-workspace.jsx'),
    'utf8'
  )

  assert.match(source, /recommendedDiagnosticIds/)
  assert.match(source, /operations-recommended-flow/)
  assert.match(source, /shellpilotOperationsConnectServer/)
  assert.match(source, /window\.store\.onNewSsh\(\)/)
  const runActionsStart = source.indexOf("<div className='operations-run-actions'>")
  const runActionsEnd = source.indexOf('{visibleTask', runActionsStart)
  const runActions = source.slice(runActionsStart, runActionsEnd)
  assert.doesNotMatch(runActions, /disabled=\{!endpoint\}/)
})
