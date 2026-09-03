const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const {
  buildAuthenticodeArgs,
  resolveDefaultAuthenticodeTargets,
  verifyWindowsAuthenticode
} = require('../../build/bin/verify-windows-authenticode')

test('passes an explicit file list to the fixed PowerShell verifier', () => {
  const args = buildAuthenticodeArgs({
    scriptPath: 'C:\\repo\\verify.ps1',
    filePaths: [
      'C:\\dist\\ShellPilot.exe',
      'C:\\dist\\installer.exe'
    ]
  })

  assert.deepEqual(args, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'C:\\repo\\verify.ps1',
    'C:\\dist\\ShellPilot.exe',
    'C:\\dist\\installer.exe'
  ])
})

test('passes both explicit paths through the PowerShell script binder', {
  skip: process.platform !== 'win32'
}, () => {
  const tempDir = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'shellpilot-authenticode-'
  ))
  try {
    const filePaths = [
      path.join(tempDir, 'unsigned-app.ps1'),
      path.join(tempDir, 'unsigned-installer.ps1')
    ]
    for (const filePath of filePaths) {
      fs.writeFileSync(filePath, 'unsigned test fixture')
    }

    const scriptPath = path.resolve(
      __dirname,
      '../../build/bin/verify-windows-authenticode.ps1'
    )
    const result = spawnSync(
      'powershell.exe',
      buildAuthenticodeArgs({ scriptPath, filePaths }),
      { encoding: 'utf8', windowsHide: true }
    )
    const output = `${result.stdout || ''}\n${result.stderr || ''}`

    assert.equal(result.error, undefined)
    assert.notEqual(result.status, 0)
    assert.equal(
      (output.match(/\bNotSigned\b/g) || []).length,
      2,
      output
    )
    assert.match(
      output,
      /Authenticode verification failed for 2 file\(s\)\./
    )
    assert.doesNotMatch(output, /CouldNotAutoloadMatchingModule/)
    assert.doesNotMatch(
      output,
      /PositionalParameterNotFound|positional parameter cannot be found/i
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('resolves exactly the unpacked app and versioned installer by default', () => {
  const cwd = path.resolve('fixture-app')

  assert.deepEqual(resolveDefaultAuthenticodeTargets({
    cwd,
    version: '0.4.51'
  }), [
    path.resolve(cwd, 'dist/win-unpacked/ShellPilot.exe'),
    path.resolve(cwd, 'dist/ShellPilot-0.4.51-win-x64-installer.exe')
  ])
})

test('refuses to run Authenticode verification outside Windows', () => {
  assert.throws(() => verifyWindowsAuthenticode({
    platform: 'linux',
    filePaths: ['ShellPilot.exe'],
    spawn: () => assert.fail('PowerShell must not be started')
  }), /Windows only/)
})

test('rejects an empty or invalid file list', () => {
  const invalidLists = [
    [],
    'ShellPilot.exe',
    [''],
    ['   '],
    ['ShellPilot.exe', 42]
  ]

  for (const filePaths of invalidLists) {
    assert.throws(() => verifyWindowsAuthenticode({
      platform: 'win32',
      filePaths,
      spawn: () => assert.fail('PowerShell must not be started')
    }), /requires explicit file paths/)
  }
})

test('propagates a nonzero PowerShell status', () => {
  assert.throws(() => verifyWindowsAuthenticode({
    platform: 'win32',
    filePaths: ['ShellPilot.exe'],
    scriptPath: 'verify.ps1',
    spawn: () => ({ status: 7, stdout: '', stderr: '' })
  }), /exit code 7/)
})

test('rejects a PowerShell process without an exit status', () => {
  assert.throws(() => verifyWindowsAuthenticode({
    platform: 'win32',
    filePaths: ['ShellPilot.exe'],
    scriptPath: 'verify.ps1',
    spawn: () => ({ status: null, stdout: '', stderr: '' })
  }), /exit code null/)
})

test('propagates a PowerShell spawn error', () => {
  const spawnError = new Error('powershell.exe was not found')

  assert.throws(() => verifyWindowsAuthenticode({
    platform: 'win32',
    filePaths: ['ShellPilot.exe'],
    scriptPath: 'verify.ps1',
    spawn: () => ({
      error: spawnError,
      status: null,
      stdout: '',
      stderr: ''
    })
  }), error => error === spawnError)
})

test('returns stdout from a successful fixed PowerShell invocation', () => {
  let invocation
  const result = verifyWindowsAuthenticode({
    platform: 'win32',
    filePaths: ['C:\\dist\\ShellPilot.exe'],
    scriptPath: 'C:\\repo\\verify.ps1',
    spawn: (command, args, options) => {
      invocation = { command, args, options }
      return { status: 0, stdout: 'Valid\n', stderr: '' }
    }
  })

  assert.equal(result, 'Valid\n')
  assert.deepEqual(invocation, {
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\repo\\verify.ps1',
      'C:\\dist\\ShellPilot.exe'
    ],
    options: {
      encoding: 'utf8',
      windowsHide: true
    }
  })
})
