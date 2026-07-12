const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const pack = JSON.parse(read('package.json'))

test('current release notes clearly separate added fixed and changed items', () => {
  const notes = read(`docs/releases/v${pack.version}.md`)

  assert.match(notes, /^## \[新增\]/m)
  assert.match(notes, /^## \[修复\]/m)
  assert.match(notes, /^## \[改动\]/m)
})

test('GitHub release script loads versioned Markdown release notes', () => {
  const source = read('build/bin/release-github.js')

  assert.match(source, /docs[\\/]releases/)
  assert.match(source, /v\$\{pack\.version\}\.md/)
  assert.match(source, /fs\.readFileSync/)
})
