const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const fingerprintHelpers = require(path.join(root, 'build/bin/ssh-host-fingerprint.js'))
const sshSmoke = require(path.join(root, 'build/bin/smoke-ssh-sftp.js'))
const safetySmoke = require(path.join(root, 'build/bin/smoke-safety-transactions.js'))

const digest = Buffer.alloc(32, 0xab)
const fingerprintHex = digest.toString('hex')
const fingerprintBase64 = digest.toString('base64')
const fingerprint = `SHA256:${fingerprintBase64.replace(/=+$/, '')}`

test('host fingerprint helpers normalize SHA256 and ssh2 digest formats', () => {
  assert.equal(
    fingerprintHelpers.normalizeHostFingerprint(fingerprint),
    fingerprintHex
  )
  assert.equal(
    fingerprintHelpers.normalizeHostFingerprint(fingerprintHex.toUpperCase()),
    fingerprintHex
  )
  assert.equal(
    fingerprintHelpers.normalizeHostFingerprint(fingerprintBase64),
    fingerprintHex
  )
})

test('host fingerprint verifier accepts SHA256 base64 and exact 64-character hex expectations', () => {
  const base64Verification = fingerprintHelpers.createSshHostVerification(fingerprint)
  const hexVerification = fingerprintHelpers.createSshHostVerification(
    fingerprintHex.toUpperCase()
  )

  assert.equal(base64Verification.hostHash, 'sha256')
  assert.equal(base64Verification.hostVerifier(fingerprintHex), true)
  assert.equal(base64Verification.hostVerifier(fingerprintBase64), true)
  assert.equal(base64Verification.hostVerifier('00'.repeat(32)), false)
  assert.equal(base64Verification.hostVerifier('not-a-digest'), false)
  assert.equal(hexVerification.hostHash, 'sha256')
  assert.equal(hexVerification.hostVerifier(fingerprintBase64), true)
  assert.equal(hexVerification.hostVerifier('00'.repeat(32)), false)
})

test('host fingerprint verifier rejects missing and malformed expectations', () => {
  assert.throws(
    () => fingerprintHelpers.createSshHostVerification(''),
    /SHELLPILOT_SSH_HOST_FINGERPRINT/
  )
  assert.throws(
    () => fingerprintHelpers.createSshHostVerification('SHA256:not-a-digest'),
    /SHELLPILOT_SSH_HOST_FINGERPRINT/
  )
  for (const malformed of [
    fingerprintHex.slice(1),
    `${fingerprintHex}0`,
    `${fingerprintHex.slice(0, -1)}g`,
    `SHA256:${fingerprintHex}`,
    fingerprintBase64,
    `sha256:${fingerprintBase64.replace(/=+$/, '')}`
  ]) {
    assert.throws(
      () => fingerprintHelpers.createSshHostVerification(malformed),
      /SHA256:base64|64-character hex/
    )
  }
})

test('generic SSH/SFTP smoke builds strict host verification options', () => {
  const options = sshSmoke.buildSshConnectOptions({
    host: 'example.invalid',
    port: 22,
    username: 'tester',
    password: 'not-sent-by-test',
    timeoutMs: 1000,
    hostFingerprint: fingerprint
  })

  assert.equal(options.hostHash, 'sha256')
  assert.equal(options.hostVerifier(fingerprintHex), true)
  assert.equal(options.hostVerifier('00'.repeat(32)), false)
  const hexOptions = sshSmoke.buildSshConnectOptions({
    host: 'example.invalid',
    port: 22,
    username: 'tester',
    password: 'not-sent-by-test',
    timeoutMs: 1000,
    hostFingerprint: fingerprintHex
  })
  assert.equal(hexOptions.hostVerifier(fingerprintBase64), true)
  assert.throws(
    () => sshSmoke.buildSshConnectOptions({
      host: 'example.invalid',
      port: 22,
      username: 'tester',
      password: 'not-sent-by-test',
      timeoutMs: 1000,
      hostFingerprint: ''
    }),
    /SHELLPILOT_SSH_HOST_FINGERPRINT/
  )
})

test('generic SSH/SFTP smoke fails closed on a missing fingerprint without leaking credentials', () => {
  const secret = 'missing-fingerprint-secret'
  const result = spawnSync(process.execPath, ['build/bin/smoke-ssh-sftp.js'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      SHELLPILOT_SSH_HOST: 'example.invalid',
      SHELLPILOT_SSH_USER: 'tester',
      SHELLPILOT_SSH_PASSWORD: secret,
      SHELLPILOT_SSH_HOST_FINGERPRINT: ''
    }
  })

  assert.equal(result.status, 2, result.stderr || result.stdout)
  assert.equal(
    result.stderr.trim(),
    'Missing required environment variables: SHELLPILOT_SSH_HOST_FINGERPRINT'
  )
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(secret))
})

test('safety smoke re-exports the shared fingerprint behavior', () => {
  assert.equal(
    safetySmoke.normalizeHostFingerprint,
    fingerprintHelpers.normalizeHostFingerprint
  )
  assert.equal(
    safetySmoke.hostFingerprintMatches,
    fingerprintHelpers.hostFingerprintMatches
  )

  const options = safetySmoke.buildSshConnectOptions({
    host: 'example.invalid',
    port: 22,
    username: 'tester',
    password: 'not-sent-by-test',
    timeoutMs: 1000,
    hostFingerprint: fingerprint
  })
  assert.equal(options.hostHash, 'sha256')
  assert.equal(options.hostVerifier(fingerprintHex), true)
  assert.equal(options.hostVerifier('00'.repeat(32)), false)
  const hexOptions = safetySmoke.buildSshConnectOptions({
    host: 'example.invalid',
    port: 22,
    username: 'tester',
    password: 'not-sent-by-test',
    timeoutMs: 1000,
    hostFingerprint: fingerprintHex
  })
  assert.equal(hexOptions.hostVerifier(fingerprintBase64), true)
})
