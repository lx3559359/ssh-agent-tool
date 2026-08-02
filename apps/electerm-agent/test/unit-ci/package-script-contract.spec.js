const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const pkg = require(path.join(root, 'package.json'))

test('direct Node package-script entry points exist', () => {
  const missing = []

  for (const [name, command] of Object.entries(pkg.scripts)) {
    const match = command.match(/^node(?:\.exe)?\s+([^\s]+)/i)
    if (!match || match[1].startsWith('-')) continue

    const target = path.join(root, match[1])
    if (!fs.existsSync(target) && !fs.existsSync(`${target}.js`)) {
      missing.push(`${name}: ${match[1]}`)
    }
  }

  assert.deepEqual(missing, [])
})

test('development readmes only reference declared npm run scripts', () => {
  const missing = []

  for (const filename of ['README.md', 'README_cn.md']) {
    const content = fs.readFileSync(path.join(root, filename), 'utf8')
    for (const match of content.matchAll(/npm run ([\w:-]+)/g)) {
      if (!pkg.scripts[match[1]]) missing.push(`${filename}: ${match[1]}`)
    }
  }

  assert.deepEqual(missing, [])
})
