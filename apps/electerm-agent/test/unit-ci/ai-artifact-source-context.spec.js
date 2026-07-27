const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')

function moduleUrl (relativePath) {
  return pathToFileURL(path.join(root, relativePath)).href
}

test('operations artifact templates cover every supported deliverable', async () => {
  const {
    ARTIFACT_TEMPLATES,
    getArtifactTemplate
  } = await import(moduleUrl(
    'src/client/components/artifacts/artifact-templates.js'
  ))
  const expected = [
    'diagnostic-report',
    'inspection-report',
    'asset-inventory',
    'change-record',
    'security-report',
    'incident-review',
    'custom-document',
    'custom-spreadsheet'
  ]

  assert.deepEqual(ARTIFACT_TEMPLATES.map(item => item.type), expected)
  for (const type of expected) {
    const template = getArtifactTemplate(type)
    assert.match(template.label, /[\u4e00-\u9fff]/)
    assert.ok(template.formats.length > 0)
    assert.ok(template.sections.length + template.tables.length > 0)
    assert.ok(['optional', 'required'].includes(template.sshSession))
    assert.ok(template.provenance.includes('capturedAt'))
  }
})

test('terminal and excerpt context is bounded and redacts credentials', async () => {
  const {
    buildTerminalArtifactContext,
    buildDiagnosticArtifactContext,
    mergeArtifactContexts
  } = await import(moduleUrl(
    'src/client/components/artifacts/artifact-source-context.js'
  ))
  const terminal = buildTerminalArtifactContext({
    server: 'root@prod-web-01:22',
    capturedAt: '2026-07-27T10:00:00.000Z',
    traceId: 'trace-001',
    output: `password=hunter2\n${'x'.repeat(40 * 1024)}`
  })
  const diagnostics = buildDiagnosticArtifactContext({
    server: 'root@prod-web-01:22',
    logs: [{
      name: '/var/log/app.log',
      content: `token=secret-token\n${'y'.repeat(40 * 1024)}`
    }],
    files: [{
      name: '/etc/app.conf',
      content: `api_key=secret-key\n${'z'.repeat(40 * 1024)}`
    }]
  })
  const merged = mergeArtifactContexts(terminal, diagnostics)
  const serialized = JSON.stringify(merged)

  assert.equal(merged.provenance.server, 'root@prod-web-01:22')
  assert.equal(merged.provenance.capturedAt, '2026-07-27T10:00:00.000Z')
  assert.equal(merged.provenance.traceId, 'trace-001')
  assert.ok(merged.terminal.output.length <= 32 * 1024)
  assert.ok(merged.excerpts.every(item => item.content.length <= 32 * 1024))
  assert.ok(serialized.length <= 92 * 1024)
  assert.doesNotMatch(serialized, /hunter2|secret-token|secret-key/)
})

test('safety context preserves non-secret backup and rollback references', async () => {
  const {
    buildSafetyArtifactContext,
    buildFleetArtifactContext,
    mergeArtifactContexts
  } = await import(moduleUrl(
    'src/client/components/artifacts/artifact-source-context.js'
  ))
  const merged = mergeArtifactContexts(
    buildFleetArtifactContext({
      server: 'prod-db-01',
      capturedAt: '2026-07-27T10:05:00.000Z',
      traceId: 'trace-002',
      servers: [{ name: 'prod-db-01', status: 'online' }]
    }),
    buildSafetyArtifactContext({
      server: 'prod-db-01',
      operations: [{
        id: 'operation-1',
        action: '更新 Nginx 配置',
        backupRef: 'backup-20260727-001',
        rollbackRef: 'rollback-20260727-001',
        password: 'must-not-leak'
      }]
    })
  )
  const serialized = JSON.stringify(merged)

  assert.match(serialized, /backup-20260727-001/)
  assert.match(serialized, /rollback-20260727-001/)
  assert.doesNotMatch(serialized, /must-not-leak/)
})
