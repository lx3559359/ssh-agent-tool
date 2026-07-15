const crypto = require('node:crypto')

const fingerprintEnvName = 'SHELLPILOT_SSH_HOST_FINGERPRINT'

function invalidFingerprintError () {
  return new Error(
    `Invalid ${fingerprintEnvName}; expected SHA256:base64 or 64-character hex.`
  )
}

function decodeBase64Fingerprint (value) {
  if (!/^[A-Za-z0-9+/]{43}=?$/.test(value)) {
    throw invalidFingerprintError()
  }
  const unpadded = value.replace(/=+$/, '')
  const digest = Buffer.from(`${unpadded}=`, 'base64')
  const canonical = digest.toString('base64').replace(/=+$/, '')
  if (digest.length !== 32 || canonical !== unpadded) {
    throw invalidFingerprintError()
  }
  return digest
}

function normalizeHostFingerprint (value) {
  const raw = String(value || '').trim()
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return raw.toLowerCase()
  }

  const prefixed = /^SHA256:(.+)$/.exec(raw)
  const digest = decodeBase64Fingerprint(prefixed ? prefixed[1] : raw)
  return digest.toString('hex')
}

function normalizeExpectedHostFingerprint (value) {
  const raw = String(value || '').trim()
  if (!raw) {
    throw new Error(`Missing required environment variable: ${fingerprintEnvName}`)
  }
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return normalizeHostFingerprint(raw)
  }
  if (!raw.startsWith('SHA256:')) {
    throw invalidFingerprintError()
  }
  return normalizeHostFingerprint(raw)
}

function hostFingerprintMatches (expected, actual) {
  try {
    const expectedDigest = Buffer.from(normalizeHostFingerprint(expected), 'hex')
    const actualDigest = Buffer.from(normalizeHostFingerprint(actual), 'hex')
    return crypto.timingSafeEqual(expectedDigest, actualDigest)
  } catch {
    return false
  }
}

function createSshHostVerification (expected) {
  const expectedHex = normalizeExpectedHostFingerprint(expected)
  return {
    hostHash: 'sha256',
    hostVerifier: actual => hostFingerprintMatches(expectedHex, actual)
  }
}

module.exports = {
  createSshHostVerification,
  hostFingerprintMatches,
  normalizeExpectedHostFingerprint,
  normalizeHostFingerprint
}
