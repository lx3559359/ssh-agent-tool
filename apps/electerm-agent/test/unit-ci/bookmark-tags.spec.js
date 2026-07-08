const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readSource (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8')
}

test('bookmark form exposes editable labels as tag input fields', () => {
  const commonFields = readSource('../../src/client/components/bookmark-form/config/common-fields.js')
  const ftpConfig = readSource('../../src/client/components/bookmark-form/config/ftp.js')

  assert.match(commonFields, /labels:\s*\{[\s\S]*?type:\s*'select'[\s\S]*?name:\s*'labels'[\s\S]*?mode:\s*'tags'/)
  assert.match(commonFields, /export const basicAuthFields = \[[\s\S]*?commonFields\.labels[\s\S]*?\]/)
  assert.match(commonFields, /export const sshAuthFields = \[[\s\S]*?commonFields\.labels[\s\S]*?\]/)
  assert.match(commonFields, /export const telnetAuthFields = \[[\s\S]*?commonFields\.labels[\s\S]*?\]/)
  assert.match(ftpConfig, /commonFields\.labels/)
})

test('bookmark search and AI schema preserve labels as server metadata', () => {
  const searchSource = readSource('../../src/client/components/tree-list/bookmark-search.js')
  const schemaSource = readSource('../../src/client/components/bookmark-form/bookmark-schema.js')

  assert.match(searchSource, /bookmark\.labels/)
  assert.match(searchSource, /bookmark\.tags/)
  assert.match(schemaSource, /labels:\s*'array - server labels/)
})
