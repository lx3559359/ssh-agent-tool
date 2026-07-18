const CIPHERTEXT_FIELD = 'apiKeyAICiphertext'

function getSafeStorage () {
  return require('./safe-storage')
}

function protectRecord (record = {}, encrypt) {
  const next = { ...record }
  if (!Object.prototype.hasOwnProperty.call(next, 'apiKeyAI')) return next
  const apiKey = String(next.apiKeyAI || '')
  delete next.apiKeyAI
  if (apiKey) next[CIPHERTEXT_FIELD] = encrypt(apiKey)
  else delete next[CIPHERTEXT_FIELD]
  return next
}

function restoreRecord (record = {}, decrypt) {
  const next = { ...record }
  if (Object.prototype.hasOwnProperty.call(next, 'apiKeyAI')) {
    delete next[CIPHERTEXT_FIELD]
    return next
  }
  const ciphertext = String(next[CIPHERTEXT_FIELD] || '')
  delete next[CIPHERTEXT_FIELD]
  next.apiKeyAI = ciphertext ? decrypt(ciphertext) : ''
  return next
}

exports.protectAIConfigCredentials = function (config = {}, encrypt) {
  const encryptValue = encrypt || getSafeStorage().safeEncrypt
  const next = protectRecord(config, encryptValue)
  if (Array.isArray(config.aiProfiles)) {
    next.aiProfiles = config.aiProfiles.map(profile => protectRecord(profile, encryptValue))
  }
  return next
}

exports.restoreAIConfigCredentials = function (config = {}, decrypt) {
  const decryptValue = decrypt || getSafeStorage().safeDecrypt
  const hasAIConfig = Object.prototype.hasOwnProperty.call(config, 'apiKeyAI') ||
    Object.prototype.hasOwnProperty.call(config, CIPHERTEXT_FIELD) ||
    Array.isArray(config.aiProfiles)
  const next = hasAIConfig ? restoreRecord(config, decryptValue) : { ...config }
  if (Array.isArray(config.aiProfiles)) {
    next.aiProfiles = config.aiProfiles.map(profile => restoreRecord(profile, decryptValue))
  }
  return next
}

exports.AI_CREDENTIAL_CIPHERTEXT_FIELD = CIPHERTEXT_FIELD
