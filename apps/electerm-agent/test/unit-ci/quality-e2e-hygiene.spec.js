const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../..')

function readSource (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('quality E2E fixtures are isolated to localhost and temporary roots', () => {
  const appSource = readSource('test/e2e/common/quality-e2e-app.js')
  const sshSource = readSource('test/e2e/common/local-ssh-server.js')
  const sftpSource = readSource('test/e2e/common/local-sftp-fixture.js')
  const specSource = readSource('test/e2e/027.quality-core-flows.spec.js')

  assert.match(appSource, /tmpdir\(\)/)
  assert.match(appSource, /assertSafeQualityRoot/)
  assert.match(appSource, /APPDATA/)
  assert.match(sshSource, /127\.0\.0\.1/)
  assert.match(sftpSource, /assertPathInsideRoot/)
  assert.match(specSource, /cleanupQualityApp/)
  assert.doesNotMatch(specSource, /23\.94\.104\.203|47\.108\.165\.45/)
})

test('quality E2E sources never print fixture credentials or payload bodies', () => {
  const sources = [
    readSource('test/e2e/common/quality-e2e-app.js'),
    readSource('test/e2e/common/local-ssh-server.js'),
    readSource('test/e2e/common/local-sftp-fixture.js'),
    readSource('test/e2e/027.quality-core-flows.spec.js')
  ].join('\n')

  assert.doesNotMatch(sources, /console\.(?:log|info|debug)\([^\n]*(?:password|apiKey|fixtureContent)/i)
  assert.doesNotMatch(sources, /process\.env\.(?:SSH_PASSWORD|API_KEY)/)
})

test('quality E2E cleanup validates the absolute target before recursive removal', () => {
  const source = readSource('test/e2e/common/quality-e2e-app.js')

  assert.match(source, /assertSafeQualityRoot\(profileRoot\)/)
  assert.match(source, /fs\.rm\(profileRoot, \{ recursive: true, force: true \}\)/)
})
