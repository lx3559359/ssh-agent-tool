const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '../..')

function parseVersion (value) {
  assert.match(value, /^\d+\.\d+\.\d+$/, `${value} must be an exact version`)
  return value.split('.').map(Number)
}

function compareVersions (left, right) {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index]
    }
  }
  return 0
}

test('pins Electron to the reviewed 41.x security baseline', () => {
  const packageJson = JSON.parse(fs.readFileSync(
    path.join(appRoot, 'package.json'),
    'utf8'
  ))
  const electronVersion = packageJson.devDependencies.electron

  assert.equal(compareVersions(electronVersion, '41.10.7') >= 0, true)
  assert.equal(compareVersions(electronVersion, '42.0.0') < 0, true)
})

test('locks every qs instance to the compatible 6.x security baseline', () => {
  const packageLock = JSON.parse(fs.readFileSync(
    path.join(appRoot, 'package-lock.json'),
    'utf8'
  ))
  const qsVersions = Object.entries(packageLock.packages)
    .filter(([packagePath]) => (
      packagePath.replaceAll('\\', '/').endsWith('node_modules/qs')
    ))
    .map(([, metadata]) => metadata.version)

  assert.ok(qsVersions.length > 0, 'package-lock.json must contain qs')
  for (const version of qsVersions) {
    assert.equal(compareVersions(version, '6.16.0') >= 0, true)
    assert.equal(compareVersions(version, '7.0.0') < 0, true)
  }
})
