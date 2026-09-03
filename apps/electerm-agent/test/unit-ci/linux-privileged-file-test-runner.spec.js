const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '../..')
const {
  assertLinuxRoot,
  runLinuxPrivilegedFileTests
} = require(path.join(appRoot, 'build/bin/run-linux-privileged-file-tests'))

test('rejects non-Linux platforms before spawning tests', () => {
  let spawnCalls = 0

  assert.throws(
    () => runLinuxPrivilegedFileTests({
      cwd: appRoot,
      platform: 'win32',
      getuid: () => 0,
      spawn: () => {
        spawnCalls += 1
        return { status: 0 }
      }
    }),
    /Privileged file protocol CI must run on Linux\./
  )
  assert.equal(spawnCalls, 0)
})

test('rejects a non-root Linux identity before spawning tests', () => {
  let spawnCalls = 0

  assert.throws(
    () => runLinuxPrivilegedFileTests({
      cwd: appRoot,
      platform: 'linux',
      getuid: () => 1000,
      spawn: () => {
        spawnCalls += 1
        return { status: 0 }
      }
    }),
    /Privileged file protocol CI must run as UID 0\./
  )
  assert.equal(spawnCalls, 0)
})

test('rejects Linux when getuid is unavailable', () => {
  assert.throws(
    () => assertLinuxRoot({ platform: 'linux', getuid: null }),
    /Privileged file protocol CI must run as UID 0\./
  )
})

test('runs only the privileged protocol spec with the current Node executable', () => {
  const calls = []

  const status = runLinuxPrivilegedFileTests({
    cwd: appRoot,
    platform: 'linux',
    getuid: () => 0,
    spawn: (...args) => {
      calls.push(args)
      return { status: 0 }
    }
  })

  assert.equal(status, 0)
  assert.deepEqual(calls, [[
    process.execPath,
    ['--test', path.join(appRoot, 'test/unit-ci/privileged-file-protocol.spec.js')],
    { cwd: appRoot, stdio: 'inherit' }
  ]])
})

test('propagates an error returned by spawn', () => {
  const spawnError = new Error('spawn failed')

  assert.throws(
    () => runLinuxPrivilegedFileTests({
      cwd: appRoot,
      platform: 'linux',
      getuid: () => 0,
      spawn: () => ({ error: spawnError, status: null })
    }),
    error => error === spawnError
  )
})

for (const status of [23, null]) {
  test(`reports the exact failing exit status ${status}`, () => {
    assert.throws(
      () => runLinuxPrivilegedFileTests({
        cwd: appRoot,
        platform: 'linux',
        getuid: () => 0,
        spawn: () => ({ status })
      }),
      new RegExp(`Privileged file protocol tests failed with exit code ${status}\\.`)
    )
  })
}

test('returns zero when the privileged protocol spec passes', () => {
  const status = runLinuxPrivilegedFileTests({
    cwd: appRoot,
    platform: 'linux',
    getuid: () => 0,
    spawn: () => ({ status: 0 })
  })

  assert.equal(status, 0)
})

test('package script exposes the Linux privileged file CI runner', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')
  )

  assert.equal(
    packageJson.scripts['test-linux-privileged-file-ci'],
    'node build/bin/run-linux-privileged-file-tests.js'
  )
})
