const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function readJson (relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
}

test('project Node engine matches the locked Vite build requirement', () => {
  const pkg = readJson('package.json')
  const lock = readJson('package-lock.json')
  const vite = readJson('node_modules/vite/package.json')

  assert.equal(pkg.engines.node, vite.engines.node)
  assert.equal(lock.packages[''].engines.node, vite.engines.node)
})

test('development readmes state the supported Node branches', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
  const readmeChinese = fs.readFileSync(path.join(root, 'README_cn.md'), 'utf8')

  assert.match(readme, /Node\.js 20\.19\+ or 22\.12\+/)
  assert.match(readmeChinese, /Node\.js 20\.19\+ 或 22\.12\+/)
})
