const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  buildExpandArchiveArgs
} = require(path.resolve(__dirname, '../../build/bin/verify-win-portable-zip'))

test('portable zip verifier passes archive paths through a PowerShell script file', () => {
  const args = buildExpandArchiveArgs({
    scriptPath: 'C:\\Temp\\expand-aigshell.ps1',
    zipPath: 'C:\\Build Output\\AIGShell portable.zip',
    extractPath: 'C:\\Temp\\AIGShell Verify'
  })

  assert.deepEqual(args, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'C:\\Temp\\expand-aigshell.ps1',
    'C:\\Build Output\\AIGShell portable.zip',
    'C:\\Temp\\AIGShell Verify'
  ])
})
