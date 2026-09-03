const path = require('node:path')
const { spawnSync } = require('node:child_process')

function assertLinuxRoot ({ platform = process.platform, getuid = process.getuid } = {}) {
  if (platform !== 'linux') {
    throw new Error('Privileged file protocol CI must run on Linux.')
  }
  if (typeof getuid !== 'function' || getuid() !== 0) {
    throw new Error('Privileged file protocol CI must run as UID 0.')
  }
}

function runLinuxPrivilegedFileTests ({
  cwd = process.cwd(),
  platform = process.platform,
  getuid = process.getuid,
  nodePath = process.execPath,
  spawn = spawnSync
} = {}) {
  assertLinuxRoot({ platform, getuid })

  const testPath = path.resolve(
    cwd,
    'test/unit-ci/privileged-file-protocol.spec.js'
  )
  const result = spawn(
    nodePath,
    ['--test', testPath],
    { cwd, stdio: 'inherit' }
  )

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `Privileged file protocol tests failed with exit code ${result.status}.`
    )
  }
  return result.status
}

if (require.main === module) {
  runLinuxPrivilegedFileTests()
}

module.exports = {
  assertLinuxRoot,
  runLinuxPrivilegedFileTests
}
