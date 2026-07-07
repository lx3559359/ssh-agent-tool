const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  buildSmokeEnvironment,
  resolveSmokePaths,
  validateSmokeResult
} = require(path.resolve(__dirname, '../../build/bin/package-smoke-utils'))

test('package smoke paths target the unpacked AIGShell app and isolated data folder', () => {
  const paths = resolveSmokePaths({
    projectRoot: 'C:\\work\\aigshell',
    tmpRoot: 'C:\\Temp\\aigshell-package-smoke-test'
  })

  assert.equal(
    paths.exePath,
    'C:\\work\\aigshell\\dist\\win-unpacked\\AIGShell.exe'
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
