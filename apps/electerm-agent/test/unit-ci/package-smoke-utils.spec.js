const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { EventEmitter } = require('node:events')

const {
  appExecutableName,
  buildSmokeEnvironment,
  resolveSmokePaths,
  validatePortableZipExtractedFiles,
  validateSmokeResult
} = require(path.resolve(__dirname, '../../build/bin/package-smoke-utils'))
const {
  parseArgs,
  stopChild
} = require(path.resolve(__dirname, '../../build/bin/package-smoke-test'))

test('package smoke paths target the unpacked ShellPilot app and isolated data folder', () => {
  const paths = resolveSmokePaths({
    projectRoot: 'C:\\work\\aigshell',
    tmpRoot: 'C:\\Temp\\aigshell-package-smoke-test'
  })

  assert.equal(
    paths.exePath,
    'C:\\work\\aigshell\\dist\\win-unpacked\\ShellPilot.exe'
  )
  assert.equal(
    paths.dataPath,
    'C:\\Temp\\aigshell-package-smoke-test\\data'
  )
  assert.equal(
    paths.mainDbPath,
    'C:\\Temp\\aigshell-package-smoke-test\\data\\users\\default_user\\electerm.db'
  )
  assert.equal(
    paths.dataDbPath,
    'C:\\Temp\\aigshell-package-smoke-test\\data\\users\\default_user\\electerm_data.db'
  )
})

test('package smoke paths can target an installed or portable AIGShell executable', () => {
  const paths = resolveSmokePaths({
    projectRoot: 'C:\\work\\aigshell',
    tmpRoot: 'C:\\Temp\\aigshell-package-smoke-test',
    exePath: 'D:\\AIGShell\\AIGShell.exe'
  })

  assert.equal(paths.exePath, 'D:\\AIGShell\\AIGShell.exe')
  assert.equal(
    paths.dataPath,
    'C:\\Temp\\aigshell-package-smoke-test\\data'
  )
})

test('package smoke cli parser accepts an explicit app path', () => {
  assert.deepEqual(
    parseArgs(['--app', 'D:\\AIGShell\\AIGShell.exe']),
    {
      app: 'D:\\AIGShell\\AIGShell.exe'
    }
  )
})

test('package smoke waits for the Electron process to fully exit before cleanup', async () => {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.killCalls = []
  child.kill = (signal = 'SIGTERM') => {
    child.killCalls.push(signal)
    setTimeout(() => {
      child.exitCode = 0
      child.emit('exit', 0, null)
      child.emit('close', 0, null)
    }, 20)
    return true
  }

  let stopped = false
  const stopping = stopChild(child, {
    graceMs: 100,
    forceMs: 100
  }).then(() => {
    stopped = true
  })

  await Promise.resolve()
  assert.equal(stopped, false)
  await stopping
  assert.equal(stopped, true)
  assert.deepEqual(child.killCalls, ['SIGTERM'])
})

test('package smoke environment isolates app data and disables gpu for CI stability', () => {
  assert.deepEqual(
    buildSmokeEnvironment({ PATH: 'C:\\Windows' }, 'C:\\Temp\\aigshell-data'),
    {
      PATH: 'C:\\Windows',
      DATA_PATH: 'C:\\Temp\\aigshell-data',
      DISABLE_GPU: '1'
    }
  )
})

test('package smoke validation requires a running app and both sqlite files', () => {
  assert.doesNotThrow(() => validateSmokeResult({
    runningAfterWait: true,
    mainDbExists: true,
    dataDbExists: true
  }))

  assert.throws(
    () => validateSmokeResult({
      runningAfterWait: false,
      mainDbExists: true,
      dataDbExists: true,
      exitCode: 1
    }),
    /exited before startup completed/
  )

  assert.throws(
    () => validateSmokeResult({
      runningAfterWait: true,
      mainDbExists: true,
      dataDbExists: false
    }),
    /did not create sqlite databases/
  )
})

test('portable zip validation requires a normal Windows client layout without bat launchers', () => {
  assert.doesNotThrow(() => validatePortableZipExtractedFiles([
    appExecutableName,
    'resources/app.asar',
    'resources/electron.asar'
  ]))

  assert.throws(
    () => validatePortableZipExtractedFiles([
      'start-aigshell.bat',
      'resources/app.asar'
    ]),
    /BAT|CMD/
  )

  assert.throws(
    () => validatePortableZipExtractedFiles([
      'resources/app.asar'
    ]),
    /ShellPilot\.exe/
  )
})
