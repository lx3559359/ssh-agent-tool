const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function readClient (file) {
  return fs.readFileSync(path.join(root, 'src/client', file), 'utf8')
}

test('completed AI messages render persisted artifact cards without replacing legacy files', () => {
  const output = readClient('components/ai/ai-output.jsx')

  assert.match(output, /ArtifactCard/)
  assert.match(output, /item\.artifactIds/)
  assert.match(output, /isStreaming\s*\?\s*\[\]/)
  assert.match(output, /extractAIGeneratedArtifacts/)
  assert.match(output, /download\(artifact\.filename,\s*artifact\.content\)/)
})

test('artifact card opens the persisted artifact workspace', () => {
  const card = readClient('components/artifacts/artifact-card.jsx')

  assert.match(card, /artifactClient\.getArtifact/)
  assert.match(card, /window\.store\.openArtifactWorkspace\(artifactId\)/)
  assert.match(card, /shellpilotArtifactPreview/)
  assert.match(card, /shellpilotArtifactSaveLocal/)
  assert.match(card, /shellpilotArtifactOpenExternal/)
  assert.match(card, /shellpilotArtifactUploadServer/)
  assert.match(card, /shellpilotArtifactRegenerate/)
  assert.match(card, /shellpilotDelete/)
})

test('generate artifact menu exposes stable templates and only seeds the composer', () => {
  const menu = readClient('components/artifacts/create-artifact-menu.jsx')
  const templates = readClient('components/artifacts/artifact-templates.js')
  const chat = readClient('components/ai/ai-chat.jsx')

  for (const type of [
    'diagnostic-report',
    'inspection-report',
    'asset-inventory',
    'change-record',
    'incident-review',
    'custom-document',
    'custom-spreadsheet'
  ]) {
    assert.match(templates, new RegExp(type))
  }

  assert.match(templates, /ARTIFACT_TEMPLATES/)
  assert.match(menu, /shellpilotArtifactCreateButton/)
  assert.match(menu, /onSeedPrompt/)
  assert.doesNotMatch(menu, /handleSubmit|onSubmit/)
  assert.match(chat, /CreateArtifactMenu/)
  assert.match(chat, /setPrompt/)
  assert.match(chat, /focus\(\)/)
})
