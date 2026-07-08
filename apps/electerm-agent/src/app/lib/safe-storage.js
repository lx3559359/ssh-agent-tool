/**
 * Safe storage wrapper using Electron's safeStorage API.
 * Provides OS-level encryption:
 *   - macOS:   Keychain
 *   - Windows: DPAPI (Data Protection API, bound to current user account)
 *   - Linux:   libsecret / gnome-keyring (falls back to an internal key)
 *
 * Encrypted values are stored as base64 strings prefixed with SAFE_PREFIX so
 * they can be distinguished from plain-text or legacy-encrypted values.
 */

const SAFE_PREFIX = 'v2:safe:'
const FALLBACK_PREFIX = 'v2:fallback:'
const FALLBACK_KEY_LENGTH = 32
const FALLBACK_IV_LENGTH = 12
const FALLBACK_SALT_LENGTH = 16

let _ss = null

function getSS () {
  if (_ss === null) {
    try {
      const { safeStorage } = require('electron')
      _ss = safeStorage
    } catch (_) {
      _ss = undefined
    }
  }
  return _ss
}

function getFallbackSecret () {
  const os = require('os')
  const user = os.userInfo?.().username || 'unknown-user'
  return [
    'AIGShell safe-storage fallback',
    process.platform,
    os.hostname(),
    user,
    os.homedir()
  ].join('\n')
}

function fallbackEncrypt (str) {
  const crypto = require('crypto')
  const salt = crypto.randomBytes(FALLBACK_SALT_LENGTH)
  const iv = crypto.randomBytes(FALLBACK_IV_LENGTH)
  const key = crypto.scryptSync(getFallbackSecret(), salt, FALLBACK_KEY_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(str, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  const authTag = cipher.getAuthTag()
  return FALLBACK_PREFIX + [
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted
  ].join(':')
}

function fallbackDecrypt (str) {
  const crypto = require('crypto')
  const parts = str.slice(FALLBACK_PREFIX.length).split(':')
  const salt = Buffer.from(parts[0], 'base64')
  const iv = Buffer.from(parts[1], 'base64')
  const authTag = Buffer.from(parts[2], 'base64')
  const encrypted = parts.slice(3).join(':')
  const key = crypto.scryptSync(getFallbackSecret(), salt, FALLBACK_KEY_LENGTH)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encrypted, 'base64', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/**
 * Encrypt a string using the OS-level secure storage.
 * Returns the original string unchanged when safeStorage is unavailable.
 * @param {string} str
 * @returns {string}
 */
exports.safeEncrypt = function (str) {
  if (typeof str !== 'string' || !str) return str
  const ss = getSS()
  if (!ss) return fallbackEncrypt(str)
  try {
    const buf = ss.encryptString(str)
    return SAFE_PREFIX + buf.toString('base64')
  } catch (e) {
    console.error('[safe-storage] encrypt error:', e.message)
  }
  return fallbackEncrypt(str)
}

/**
 * Decrypt a string that was encrypted with safeEncrypt.
 * Returns the original string unchanged when it was not produced by safeEncrypt.
 * @param {string} str
 * @returns {string}
 */
exports.safeDecrypt = function (str) {
  if (typeof str !== 'string' || !str) return str
  if (str.startsWith(FALLBACK_PREFIX)) {
    try {
      return fallbackDecrypt(str)
    } catch (e) {
      console.error('[safe-storage] fallback decrypt error:', e.message)
      return str
    }
  }
  if (!str.startsWith(SAFE_PREFIX)) return str
  const ss = getSS()
  if (!ss) return str
  try {
    const base64 = str.slice(SAFE_PREFIX.length)
    const buf = Buffer.from(base64, 'base64')
    return ss.decryptString(buf)
  } catch (e) {
    console.error('[safe-storage] decrypt error:', e.message)
    return str
  }
}
