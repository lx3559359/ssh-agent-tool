const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  cleanWorkDirectory
} = require(path.resolve(__dirname, '../../build/bin/clean.js'))

test('build cleanup tolerates an incomplete work tree and removes it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-clean-work-'))
  const workPath = path.join(root, 'work')
  fs.mkdirSync(path.join(workPath, 'app/node_modules/node-pty/build'), { recursive: true })
  fs.writeFileSync(path.join(workPath, 'app/node_modules/node-pty/build/build.log'), 'partial build')

  cleanWorkDirectory(workPath)

  assert.equal(fs.existsSync(workPath), false)
  assert.doesNotThrow(() => cleanWorkDirectory(workPath))
  fs.rmSync(root, { recursive: true, force: true })
})
