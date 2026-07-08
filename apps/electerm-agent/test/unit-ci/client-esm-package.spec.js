const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const clientRoot = path.resolve(__dirname, '../../src/client')

function listJsFiles (dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return listJsFiles(fullPath)
    }
    return entry.isFile() && entry.name.endsWith('.js')
      ? [fullPath]
      : []
  })
}

test('client source declares an ESM package boundary for Node test imports', () => {
  const packPath = path.join(clientRoot, 'package.json')
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'))

  assert.equal(pack.type, 'module')
})

test('client source stays ESM-only inside that package boundary', () => {
  const cjsPattern = /\b(?:require\(['"]|module\.exports|exports\.)/
  const offenders = listJsFiles(clientRoot)
    .filter(file => cjsPattern.test(fs.readFileSync(file, 'utf8')))
    .map(file => path.relative(clientRoot, file))

  assert.deepEqual(offenders, [])
})
