const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const modulePath = path.join(
  __dirname,
  '..',
  '..',
  'src',
  'app',
  'lib',
  'incidents',
  'incident-export.js'
)

test('incident export produces bounded redacted Markdown HTML and JSON', () => {
  assert.equal(fs.existsSync(modulePath), true)
  const {
    exportIncident
  } = require(modulePath)
  const incident = {
    id: 'incident-1',
    title: 'Nginx timeout',
    endpointRef: 'root@example.com:22',
    state: 'resolved',
    severity: 'high',
    summary: 'Authorization: Bearer secret-token',
    rootCause: 'upstream timeout',
    resolution: 'restarted upstream',
    verificationStatus: 'passed_manual',
    serviceTags: ['nginx'],
    customTags: ['production'],
    notes: [{ body: 'password=hunter2', createdAt: 1000 }],
    timelineEvents: [{
      title: 'diagnostic',
      body: 'api_key=top-secret',
      source: 'ai-diagnostic',
      createdAt: 1001
    }],
    createdAt: 900,
    updatedAt: 1002
  }

  for (const format of ['md', 'html', 'json']) {
    const result = exportIncident(incident, { format, maxBytes: 64 * 1024 })
    assert.equal(result.format, format)
    assert.ok(Buffer.byteLength(result.content, 'utf8') <= 64 * 1024)
    assert.doesNotMatch(result.content, /secret-token|hunter2|top-secret/)
    assert.match(result.content, /Nginx timeout/)
  }
})

test('incident export truncates Chinese text on a valid UTF-8 boundary', () => {
  const {
    exportIncident
  } = require(modulePath)
  const result = exportIncident({
    id: 'incident-utf8',
    title: '中文导出边界',
    summary: '故障排查记录'.repeat(1000),
    notes: [],
    timelineEvents: []
  }, {
    format: 'md',
    maxBytes: 4097
  })

  assert.ok(Buffer.byteLength(result.content, 'utf8') <= 4097)
  assert.doesNotMatch(result.content, /\uFFFD/)
  assert.match(result.content, /内容已按导出大小上限截断/)
})

test('bounded structured incident exports remain valid JSON and HTML', () => {
  const {
    exportIncident
  } = require(modulePath)
  const incident = {
    id: 'incident-structured',
    title: 'Large incident export',
    summary: 'diagnostic detail '.repeat(2000),
    rootCause: 'root cause detail '.repeat(1000),
    resolution: 'resolution detail '.repeat(1000),
    notes: Array.from({ length: 40 }, (_, index) => ({
      body: `note-${index} ${'x'.repeat(200)}`,
      createdAt: 1000 + index
    })),
    timelineEvents: [],
    createdAt: 900,
    updatedAt: 2000
  }

  const json = exportIncident(incident, {
    format: 'json',
    maxBytes: 4096
  })
  const parsed = JSON.parse(json.content)
  assert.equal(parsed.exportTruncated, true)
  assert.ok(Buffer.byteLength(json.content, 'utf8') <= 4096)

  const html = exportIncident(incident, {
    format: 'html',
    maxBytes: 4096
  })
  assert.ok(Buffer.byteLength(html.content, 'utf8') <= 4096)
  assert.match(html.content, /内容已按导出大小上限截断/)
  assert.match(html.content, /<\/body><\/html>$/)
})

test('incident workspace replaces manual storage and restore with export', () => {
  const workspace = fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'src',
    'client',
    'components',
    'incidents',
    'incident-workspace.jsx'
  ), 'utf8')
  const list = fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'src',
    'client',
    'components',
    'incidents',
    'incident-list.jsx'
  ), 'utf8')

  assert.doesNotMatch(workspace, /IncidentStorageModal|openStorage/)
  assert.doesNotMatch(list, /onOpenStorage|DatabaseOutlined/)
  assert.match(workspace, /exportIncidentArchives/)
})

test('incident archive renderer API exposes export but no backup or restore', () => {
  const client = fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'src',
    'client',
    'components',
    'incidents',
    'incident-client.js'
  ), 'utf8')
  const store = fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'src',
    'client',
    'store',
    'incident-archives.js'
  ), 'utf8')
  const ipc = fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'src',
    'app',
    'lib',
    'ipc.js'
  ), 'utf8')
  const locale = fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'src',
    'client',
    'common',
    'shellpilot-i18n-overrides.js'
  ), 'utf8')
  const help = fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'src',
    'client',
    'components',
    'main',
    'help-center-modal.jsx'
  ), 'utf8')

  assert.match(client, /exportIncidentArchive/)
  assert.doesNotMatch(client, /IncidentArchiveBackup|IncidentArchiveStorage/)
  assert.doesNotMatch(store, /IncidentBackup|IncidentStorage/)
  assert.doesNotMatch(ipc, /IncidentArchiveBackup|IncidentArchiveStorage/)
  assert.doesNotMatch(locale, /shellpilotIncidentBackup/)
  assert.doesNotMatch(locale, /shellpilotIncidentRestore/)
  assert.doesNotMatch(help, /存储与恢复|恢复数据库必须输入 RESTORE|提供受控备份与恢复/)
  assert.match(help, /导出 Markdown、HTML 或 JSON/)
  assert.match(help, /不提供手工数据库备份或恢复入口/)
})
