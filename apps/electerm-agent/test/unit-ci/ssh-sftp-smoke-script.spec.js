const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const scriptPath = path.join(root, 'build/bin/smoke-ssh-sftp.js')
const packagePath = path.join(root, 'package.json')
const smokeHelpers = require(scriptPath)

const validFingerprint = `SHA256:${Buffer.alloc(32, 0xab)
  .toString('base64')
  .replace(/=+$/, '')}`

function validEnv (overrides = {}) {
  return {
    SHELLPILOT_SSH_HOST: ' 127.0.0.1 ',
    SHELLPILOT_SSH_USER: ' tester ',
    SHELLPILOT_SSH_PASSWORD: '  password with spaces  ',
    SHELLPILOT_SSH_HOST_FINGERPRINT: ` ${validFingerprint} `,
    SHELLPILOT_SSH_PORT: '22',
    SHELLPILOT_SSH_TEST_DIR: '/tmp',
    SHELLPILOT_SSH_TIMEOUT: '20000',
    ...overrides
  }
}

test('SSH/SFTP smoke script is reusable and keeps credentials out of source', () => {
  const source = fs.readFileSync(scriptPath, 'utf8')

  assert.match(source, /require\('@electerm\/ssh2'\)/)
  assert.match(source, /SHELLPILOT_SSH_HOST/)
  assert.match(source, /SHELLPILOT_SSH_USER/)
  assert.match(source, /SHELLPILOT_SSH_PASSWORD/)
  assert.match(source, /SHELLPILOT_SSH_HOST_FINGERPRINT/)
  assert.match(source, /conn\.shell/)
  assert.match(source, /'\\x03'/)
  assert.match(source, /sftpOp\(sftp,\s*'writeFile'/)
  assert.match(source, /sftpOp\(sftp,\s*'rename'/)
  assert.match(source, /sftpOp\(sftp,\s*'unlink'/)
  assert.doesNotMatch(source, /23\.94\.104\.203/)
  assert.doesNotMatch(source, /example-secret-password/)
  assert.doesNotMatch(source, /hostVerifier\s*:\s*\(\)\s*=>\s*true/)
})

test('package exposes SSH/SFTP smoke test command', () => {
  const pack = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

  assert.equal(pack.scripts['smoke:ssh-sftp'], 'node build/bin/smoke-ssh-sftp.js')
})

test('SSH smoke resolves normalized public fields without changing password whitespace', () => {
  assert.equal(typeof smokeHelpers.resolveConfig, 'function')
  assert.equal(typeof smokeHelpers.validateConfig, 'function')

  const config = smokeHelpers.validateConfig(
    smokeHelpers.resolveConfig(validEnv())
  )

  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.username, 'tester')
  assert.equal(config.hostFingerprint, validFingerprint)
  assert.equal(config.password, '  password with spaces  ')
  assert.equal(config.port, 22)
  assert.equal(config.timeoutMs, 20000)
  assert.equal(config.testDir, '/tmp')
})

test('SSH smoke rejects invalid configuration before calling the client factory', async () => {
  const invalidCases = [
    ['host', { SHELLPILOT_SSH_HOST: '   ' }, /SHELLPILOT_SSH_HOST/],
    ['username', { SHELLPILOT_SSH_USER: '\t ' }, /SHELLPILOT_SSH_USER/],
    ['fingerprint', { SHELLPILOT_SSH_HOST_FINGERPRINT: '  ' }, /SHELLPILOT_SSH_HOST_FINGERPRINT/],
    ['fractional port', { SHELLPILOT_SSH_PORT: '22.5' }, /port/i],
    ['zero port', { SHELLPILOT_SSH_PORT: '0' }, /port/i],
    ['oversized port', { SHELLPILOT_SSH_PORT: '65536' }, /port/i],
    ['non-finite timeout', { SHELLPILOT_SSH_TIMEOUT: 'Infinity' }, /timeout/i],
    ['fractional timeout', { SHELLPILOT_SSH_TIMEOUT: '1000.5' }, /timeout/i],
    ['short timeout', { SHELLPILOT_SSH_TIMEOUT: '999' }, /timeout/i],
    ['long timeout', { SHELLPILOT_SSH_TIMEOUT: '120001' }, /timeout/i],
    ['unsafe test directory', { SHELLPILOT_SSH_TEST_DIR: '/tmp/../etc' }, /test root/i]
  ]

  for (const [name, overrides, errorPattern] of invalidCases) {
    let factoryCalls = 0
    const config = smokeHelpers.resolveConfig(validEnv(overrides))
    await assert.rejects(
      Promise.resolve().then(() => smokeHelpers.connect(config, () => {
        factoryCalls += 1
        throw new Error('client factory must not run')
      })),
      errorPattern,
      name
    )
    assert.equal(factoryCalls, 0, name)
  }
})

test('invalid SSH smoke configuration exits as a preflight failure without exposing secrets', () => {
  const secret = '  preflight secret with spaces  '
  const invalidEnvironments = [
    { SHELLPILOT_SSH_HOST: '   ' },
    { SHELLPILOT_SSH_USER: '   ' },
    { SHELLPILOT_SSH_HOST_FINGERPRINT: '   ' },
    { SHELLPILOT_SSH_PORT: 'not-a-port' },
    { SHELLPILOT_SSH_TIMEOUT: 'NaN' },
    { SHELLPILOT_SSH_TEST_DIR: '/tmp/unsafe;name' }
  ]

  for (const overrides of invalidEnvironments) {
    const result = require('node:child_process').spawnSync(
      process.execPath,
      ['build/bin/smoke-ssh-sftp.js'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...validEnv({ SHELLPILOT_SSH_PASSWORD: secret }),
          ...overrides
        },
        timeout: 5000
      }
    )
    const output = `${result.stdout}\n${result.stderr}`
    assert.equal(result.status, 2, output)
    assert.doesNotMatch(output, new RegExp(secret.trim()))
  }
})
