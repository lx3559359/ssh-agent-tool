const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const fsp = require('node:fs/promises')

const {
  exportDiagnosticPack
} = require(path.resolve(__dirname, '../../src/app/lib/diagnostic-pack'))

test('export diagnostic pack defaults to the ShellPilot product file name', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'shellpilot-diagnostic-name-'))
  const originalTmpdir = os.tmpdir
  os.tmpdir = () => tempRoot

  try {
    const result = await exportDiagnosticPack({ logText: 'main log' })

    assert.match(path.basename(result.outputPath), /^ShellPilot-diagnostic-\d+\.tar$/)
    assert.equal(fs.existsSync(result.outputPath), true)
  } finally {
    os.tmpdir = originalTmpdir
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})
