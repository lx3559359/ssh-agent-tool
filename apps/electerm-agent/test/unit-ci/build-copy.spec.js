const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('build copy script skips optional tray icons when the resource package does not provide them', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../build/bin/copy.js'),
    'utf8'
  )

  assert.match(source, /copyOptionalResource/)
  assert.match(source, /existsSync/)
  assert.match(source, /tray-icons/)
  assert.doesNotMatch(
    source,
    /cp\(\s*from\s*,\s*to\s*\)/
  )
})
