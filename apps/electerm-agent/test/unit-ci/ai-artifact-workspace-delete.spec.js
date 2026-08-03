const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')

function readSource (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('artifact workspace exposes confirmed deletion from list and preview', () => {
  const list = readSource(
    'src/client/components/artifacts/artifact-list.jsx'
  )
  const preview = readSource(
    'src/client/components/artifacts/artifact-preview.jsx'
  )

  assert.match(list, /DeleteOutlined/)
  assert.match(list, /onDelete/)
  assert.match(preview, /shellpilotArtifactDeleteConfirm/)
  assert.match(preview, /store\.deleteArtifact/)
  assert.match(preview, /shellpilotArtifactDeleteLocalOnly/)
})
