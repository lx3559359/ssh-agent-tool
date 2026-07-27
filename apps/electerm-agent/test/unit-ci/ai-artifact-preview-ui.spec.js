const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function readClient (file) {
  return fs.readFileSync(path.join(root, 'src/client', file), 'utf8')
}

test('preview router maps office formats to document and spreadsheet views', () => {
  const preview = readClient('components/artifacts/artifact-preview.jsx')

  assert.match(preview, /DocumentPreview/)
  assert.match(preview, /SpreadsheetPreview/)
  assert.match(preview, /\['md',\s*'docx',\s*'pdf',\s*'html'\]/)
  assert.match(preview, /\['csv',\s*'xlsx'\]/)
})

test('document preview supports bounded edit history and debounced version saving', () => {
  const document = readClient('components/artifacts/document-preview.jsx')

  assert.match(document, /MAX_HISTORY\s*=\s*50/)
  assert.match(document, /AUTOSAVE_DELAY\s*=\s*800/)
  assert.match(document, /shellpilotArtifactUndo/)
  assert.match(document, /shellpilotArtifactRedo/)
  assert.match(document, /shellpilotArtifactAddSection/)
  assert.match(document, /shellpilotArtifactDeleteSection/)
  assert.match(document, /shellpilotArtifactMoveSectionUp/)
  assert.match(document, /shellpilotArtifactMoveSectionDown/)
  assert.match(document, /artifact-document-page/)
})

test('spreadsheet preview virtualizes rows and allows cell editing', () => {
  const spreadsheet = readClient('components/artifacts/spreadsheet-preview.jsx')

  assert.match(spreadsheet, /ROW_HEIGHT\s*=\s*36/)
  assert.match(spreadsheet, /OVERSCAN\s*=\s*10/)
  assert.match(spreadsheet, /visibleStart/)
  assert.match(spreadsheet, /visibleEnd/)
  assert.match(spreadsheet, /onScroll/)
  assert.match(spreadsheet, /contentEditable/)
  assert.match(spreadsheet, /shellpilotArtifactSort/)
  assert.match(spreadsheet, /shellpilotArtifactFilterTable/)
})

test('local save is delegated to a main-process native dialog', () => {
  const client = readClient('components/artifacts/artifact-client.js')
  const preview = readClient('components/artifacts/artifact-preview.jsx')
  const actions = readClient('components/artifacts/artifact-export-actions.js')

  assert.match(client, /saveArtifactFile/)
  assert.match(client, /saveAIArtifactFile/)
  assert.match(preview, /saveArtifactExport/)
  assert.match(actions, /saveArtifactFile/)
  assert.doesNotMatch(preview, /window\.api\.saveDialog/)
  assert.doesNotMatch(preview, /result\.filePath/)
})
