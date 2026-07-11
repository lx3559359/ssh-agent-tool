const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('connection info modal copies all fields with bookmark group context', () => {
  const root = path.resolve(__dirname, '../..')
  const source = fs.readFileSync(
    path.join(root, 'src/client/components/tree-list/connection-info-modal.jsx'),
    'utf8'
  )

  assert.match(
    source,
    /formatConnectionInfoText\(bookmark,\s*\{\s*showSecrets,\s*bookmarkGroups\s*\}\)/
  )
})
