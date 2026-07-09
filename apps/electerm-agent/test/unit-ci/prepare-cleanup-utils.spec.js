const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  removePackagedBatchScripts
} = require(path.resolve(__dirname, '../../build/bin/prepare-cleanup-utils'))

test('package prepare cleanup removes batch scripts from packaged node modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-prepare-cleanup-'))
  try {
    const nodeModuleDir = path.join(
      root,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'node-pty',
      'deps'
    )
    fs.mkdirSync(nodeModuleDir, { recursive: true })
    const batPath = path.join(nodeModuleDir, 'vcbuild.bat')
    const cmdPath = path.join(nodeModuleDir, 'tool.cmd')
    const keepPath = path.join(nodeModuleDir, 'runtime.exe')
    fs.writeFileSync(batPath, 'echo build')
    fs.writeFileSync(cmdPath, 'echo tool')
    fs.writeFileSync(keepPath, 'runtime')

    const removed = removePackagedBatchScripts(root)

    assert.deepEqual(removed.sort(), [
      path.relative(root, batPath),
      path.relative(root, cmdPath)
    ].sort())
    assert.equal(fs.existsSync(batPath), false)
    assert.equal(fs.existsSync(cmdPath), false)
    assert.equal(fs.existsSync(keepPath), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
