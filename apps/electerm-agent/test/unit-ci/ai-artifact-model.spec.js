const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/artifacts/artifact-model.js'
)).href

test('exports the supported artifact types and formats', async () => {
  const { ARTIFACT_TYPES, ARTIFACT_FORMATS } = await import(moduleUrl)

  assert.deepEqual([...ARTIFACT_TYPES], [
    'diagnostic-report',
    'inspection-report',
    'asset-inventory',
    'change-record',
    'security-report',
    'incident-review',
    'custom-document',
    'custom-spreadsheet'
  ])
  assert.deepEqual([...ARTIFACT_FORMATS], ['docx', 'xlsx', 'pdf', 'md', 'csv'])
})

test('redacts secrets and PEM private keys in artifact text', async () => {
  const { redactArtifactText } = await import(moduleUrl)
  const redacted = redactArtifactText([
    'api key: abcd-1234',
    'token=secret-token',
    'password : hunter2',
    'passwd=super-secret',
    'cookie: session=abc123',
    '-----BEGIN RSA PRIVATE KEY-----',
    'top secret key material',
    '-----END RSA PRIVATE KEY-----'
  ].join('\n'))

  assert.match(redacted, /api key=\[宸查殣钘廬/i)
  assert.match(redacted, /token=\[宸查殣钘廬/i)
  assert.match(redacted, /password=\[宸查殣钘廬/i)
  assert.match(redacted, /passwd=\[宸查殣钘廬/i)
  assert.match(redacted, /cookie=\[宸查殣钘廬/i)
  assert.doesNotMatch(redacted, /BEGIN RSA PRIVATE KEY/i)
  assert.doesNotMatch(redacted, /END RSA PRIVATE KEY/i)
})

test('normalizes artifact drafts without mutating input or preserving numeric table cells', async () => {
  const { normalizeArtifactDraft } = await import(moduleUrl)
  const input = {
    type: 'diagnostic-report',
    title: '  '.repeat(100),
    server: 42,
    summary: 'token=secret',
    sections: [
      { title: 'summary', content: 'api key: secret' }
    ],
    tables: [
      {
        title: 'ports',
        columns: ['port', 'state'],
        rows: [[443, 'open']]
      }
    ],
    risks: [1],
    recommendations: [true]
  }
  const snapshot = JSON.parse(JSON.stringify(input))

  const draft = normalizeArtifactDraft(input)

  assert.equal(draft.schemaVersion, 1)
  assert.equal(draft.type, 'diagnostic-report')
  assert.equal(draft.title, '未命名成果')
  assert.equal(draft.server, '42')
  assert.equal(draft.summary, 'token=[宸查殣钘廬')
  assert.equal(draft.sections[0].content, 'api key=[宸查殣钘廬')
  assert.deepEqual(draft.tables[0].rows, [['443', 'open']])
  assert.deepEqual(draft.risks, ['1'])
  assert.deepEqual(draft.recommendations, ['true'])
  assert.equal(Object.isFrozen(draft), true)
  assert.deepEqual(input, snapshot)
})

test('rejects unsupported artifact types and oversized normalized payloads', async () => {
  const { normalizeArtifactDraft } = await import(moduleUrl)

  assert.throws(
    () => normalizeArtifactDraft({ type: 'binary', title: 'x' }),
    error => error && error.code === 'ARTIFACT_TYPE_UNSUPPORTED'
  )

  assert.throws(
    () => normalizeArtifactDraft({
      type: 'custom-document',
      title: 'x',
      sections: [{ title: 'payload', content: 'x'.repeat(1_000_001) }]
    }),
    error => error && error.code === 'ARTIFACT_TOO_LARGE'
  )
})

test('bounds sections, tables, risks, and recommendations arrays', async () => {
  const { normalizeArtifactDraft } = await import(moduleUrl)
  const draft = normalizeArtifactDraft({
    type: 'inspection-report',
    title: 'x',
    sections: Array.from({ length: 129 }, (_, index) => ({
      title: `section-${index}`,
      content: `content-${index}`
    })),
    tables: Array.from({ length: 33 }, (_, tableIndex) => ({
      title: `table-${tableIndex}`,
      columns: ['only'],
      rows: [[tableIndex]]
    })),
    risks: Array.from({ length: 201 }, (_, index) => index),
    recommendations: Array.from({ length: 201 }, (_, index) => index)
  })

  assert.equal(draft.sections.length, 128)
  assert.equal(draft.tables.length, 32)
  assert.equal(draft.risks.length, 200)
  assert.equal(draft.recommendations.length, 200)
})

test('bounds table rows, columns, and cell length while stringifying numeric cells', async () => {
  const { normalizeArtifactDraft } = await import(moduleUrl)
  const draft = normalizeArtifactDraft({
    type: 'custom-spreadsheet',
    title: 'x',
    tables: [{
      title: 'ports',
      columns: Array.from({ length: 65 }, (_, columnIndex) => `c${columnIndex}`),
      rows: Array.from({ length: 2001 }, (_, rowIndex) => (
        Array.from({ length: 65 }, (_, columnIndex) => {
          if (rowIndex === 0 && columnIndex === 1) return 'x'.repeat(32001)
          return columnIndex === 0 ? rowIndex : `v${columnIndex}`
        })
      ))
    }]
  })

  assert.equal(draft.tables[0].rows.length, 2000)
  assert.equal(draft.tables[0].columns.length, 64)
  assert.equal(draft.tables[0].rows[0].length, 64)
  assert.equal(draft.tables[0].rows[0][0], '0')
  assert.equal(draft.tables[0].rows[0][1].length, 32000)
})
