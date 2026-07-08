import copy from 'json-deep-copy'
import { removeCyclicBookmarkGroupIds } from './bookmark-group-tree.js'

export const bookmarkBackupFormat = 'AIGShell.bookmarks.backup'
export const bookmarkBackupFormatVersion = 1
export const encryptedBookmarkBackupFormat = 'AIGShell.bookmarks.encrypted-backup'
export const encryptedBookmarkBackupFormatVersion = 1

const encryptedBackupIterations = 210000
const encryptedBackupNeedsPassphraseError = '备份文件已加密，请使用加密导入入口并输入密码'
const missingBackupPassphraseError = '请输入备份加密密码'
const invalidEncryptedBackupError = '加密备份文件格式不正确'
const decryptFailedError = '备份解密失败，请检查密码是否正确'
const cryptoUnavailableError = '当前环境不支持安全加密备份'

const credentialKeys = new Set([
  'password',
  'privateKey',
  'passphrase',
  'certificate',
  'proxyPassword'
])

const invalidJsonError = '备份文件内容不是有效的 JSON'
const noImportableBookmarksError = '备份文件中没有可导入的服务器连接'
const invalidBookmarkBackupShapeError = '备份文件中的服务器或分组格式不正确'
const unsupportedBookmarkBackupVersionError = '备份文件版本过新，请升级 AIGShell 后再导入'

export function createBookmarkBackup ({
  bookmarks = [],
  bookmarkGroups = [],
  now = new Date().toISOString(),
  version = '',
  includeCredentials = true
} = {}) {
  const backupBookmarks = includeCredentials
    ? copy(bookmarks || [])
    : stripCredentials(bookmarks || [])
  return {
    format: bookmarkBackupFormat,
    formatVersion: bookmarkBackupFormatVersion,
    app: {
      name: 'AIGShell',
      version
    },
    exportedAt: now,
    data: {
      bookmarks: backupBookmarks,
      bookmarkGroups: copy(bookmarkGroups || [])
    }
  }
}

function sanitizeProxyUrl (value) {
  if (typeof value !== 'string' || !value.includes('@')) {
    return value
  }
  try {
    const url = new URL(value)
    url.password = ''
    return url.toString()
  } catch (_) {
    return value.replace(/:\/\/([^:@/]+):[^@/]*@/, '://$1@')
  }
}

function stripCredentials (value) {
  if (Array.isArray(value)) {
    return value.map(stripCredentials)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.keys(value).reduce((result, key) => {
    if (credentialKeys.has(key)) {
      return result
    }
    const nextValue = key === 'proxy'
      ? sanitizeProxyUrl(value[key])
      : stripCredentials(value[key])
    result[key] = nextValue
    return result
  }, {})
}

function normalizeBookmarkBackupData (data) {
  if (!Array.isArray(data?.bookmarks) && !Array.isArray(data?.bookmarkGroups)) {
    throw new Error(noImportableBookmarksError)
  }
  if (
    (data.bookmarks !== undefined && !Array.isArray(data.bookmarks)) ||
    (data.bookmarkGroups !== undefined && !Array.isArray(data.bookmarkGroups))
  ) {
    throw new Error(invalidBookmarkBackupShapeError)
  }
  if (
    !isBackupBookmarkList(data.bookmarks) ||
    !isBackupGroupList(data.bookmarkGroups) ||
    hasDuplicatedBackupId(data.bookmarks) ||
    hasDuplicatedBackupId(data.bookmarkGroups) ||
    hasDanglingBackupGroupRefs(data.bookmarks, data.bookmarkGroups) ||
    hasDangerousBackupKey(data.bookmarks) ||
    hasDangerousBackupKey(data.bookmarkGroups)
  ) {
    throw new Error(invalidBookmarkBackupShapeError)
  }
  if (!(data.bookmarks || []).length) {
    throw new Error(noImportableBookmarksError)
  }
  return {
    bookmarks: data.bookmarks || [],
    bookmarkGroups: removeCyclicBookmarkGroupIds(copy(data.bookmarkGroups || []))
  }
}

function hasNonEmptyString (item, key) {
  return typeof item[key] === 'string' && Boolean(item[key].trim())
}

function hasOptionalStringArray (item, key) {
  if (item[key] === undefined) {
    return true
  }
  return Array.isArray(item[key]) &&
    item[key].every(value => typeof value === 'string' && Boolean(value.trim()))
}

function isPlainBackupObject (item) {
  return item &&
    typeof item === 'object' &&
    !Array.isArray(item)
}

function hasDuplicatedBackupId (items) {
  if (!Array.isArray(items)) {
    return false
  }
  const seen = new Set()
  return items.some(item => {
    if (!isPlainBackupObject(item) || !hasNonEmptyString(item, 'id')) {
      return false
    }
    const id = item.id.trim()
    if (seen.has(id)) {
      return true
    }
    seen.add(id)
    return false
  })
}

function buildBackupIdSet (items) {
  return new Set((items || [])
    .filter(item => isPlainBackupObject(item) && hasNonEmptyString(item, 'id'))
    .map(item => item.id.trim()))
}

function hasDanglingBackupGroupRefs (bookmarks, bookmarkGroups) {
  if (!Array.isArray(bookmarkGroups)) {
    return false
  }
  const bookmarkIds = buildBackupIdSet(bookmarks)
  const groupIds = buildBackupIdSet(bookmarkGroups)
  return bookmarkGroups.some(group => {
    return (group.bookmarkIds || []).some(id => !bookmarkIds.has(id.trim())) ||
      (group.bookmarkGroupIds || []).some(id => !groupIds.has(id.trim()))
  })
}

const dangerousBackupKeys = new Set([
  '__proto__',
  'constructor',
  'prototype'
])

function hasDangerousBackupKey (item) {
  if (!item || typeof item !== 'object') {
    return false
  }
  if (Array.isArray(item)) {
    return item.some(hasDangerousBackupKey)
  }
  return Object.keys(item).some(key => {
    return dangerousBackupKeys.has(key) ||
      hasDangerousBackupKey(item[key])
  })
}

function isBackupBookmarkList (items) {
  if (items === undefined) {
    return true
  }
  return items.every(item => {
    return (
      isPlainBackupObject(item) &&
      (
        hasNonEmptyString(item, 'id') ||
        hasNonEmptyString(item, 'host')
      )
    )
  })
}

function isBackupGroupList (items) {
  if (items === undefined) {
    return true
  }
  return items.every(item => {
    return (
      isPlainBackupObject(item) &&
      hasNonEmptyString(item, 'id') &&
      hasOptionalStringArray(item, 'bookmarkIds') &&
      hasOptionalStringArray(item, 'bookmarkGroupIds')
    )
  })
}

function parseBackupJson (text) {
  try {
    return typeof text === 'string' ? JSON.parse(text.replace(/^\uFEFF/, '')) : text
  } catch (_) {
    throw new Error(invalidJsonError)
  }
}

function getWebCrypto () {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.subtle || !cryptoApi?.getRandomValues) {
    throw new Error(cryptoUnavailableError)
  }
  return cryptoApi
}

function textToBytes (value) {
  return new TextEncoder().encode(value)
}

function bytesToText (value) {
  return new TextDecoder().decode(value)
}

function bytesToBase64 (bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes (value) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'))
  }
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function deriveBackupKey ({
  passphrase,
  salt,
  iterations
}) {
  const cryptoApi = getWebCrypto()
  const keyMaterial = await cryptoApi.subtle.importKey(
    'raw',
    textToBytes(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  )
}

function assertBackupPassphrase (passphrase) {
  if (typeof passphrase !== 'string' || !passphrase.trim()) {
    throw new Error(missingBackupPassphraseError)
  }
}

export async function createEncryptedBookmarkBackup ({
  passphrase,
  ...backupOptions
} = {}) {
  assertBackupPassphrase(passphrase)
  const cryptoApi = getWebCrypto()
  const backup = createBookmarkBackup(backupOptions)
  const salt = cryptoApi.getRandomValues(new Uint8Array(16))
  const iv = cryptoApi.getRandomValues(new Uint8Array(12))
  const key = await deriveBackupKey({
    passphrase,
    salt,
    iterations: encryptedBackupIterations
  })
  const ciphertext = await cryptoApi.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    key,
    textToBytes(JSON.stringify(backup))
  )
  return {
    format: encryptedBookmarkBackupFormat,
    formatVersion: encryptedBookmarkBackupFormatVersion,
    app: backup.app,
    exportedAt: backup.exportedAt,
    encryption: {
      algorithm: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: encryptedBackupIterations,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv)
    },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  }
}

function isEncryptedBackupContent (content) {
  return content?.format === encryptedBookmarkBackupFormat
}

export function isEncryptedBookmarkBackup (text) {
  try {
    return isEncryptedBackupContent(parseBackupJson(text))
  } catch (_) {
    return false
  }
}

export async function parseEncryptedBookmarkBackup (text, {
  passphrase
} = {}) {
  assertBackupPassphrase(passphrase)
  const content = parseBackupJson(text)
  if (!isEncryptedBackupContent(content)) {
    return parseBookmarkBackup(content)
  }
  if ((content.formatVersion || 1) > encryptedBookmarkBackupFormatVersion) {
    throw new Error(unsupportedBookmarkBackupVersionError)
  }
  const { encryption, ciphertext } = content
  if (
    encryption?.algorithm !== 'AES-GCM' ||
    encryption?.kdf !== 'PBKDF2-SHA256' ||
    typeof encryption?.salt !== 'string' ||
    typeof encryption?.iv !== 'string' ||
    typeof encryption?.iterations !== 'number' ||
    typeof ciphertext !== 'string'
  ) {
    throw new Error(invalidEncryptedBackupError)
  }
  try {
    const key = await deriveBackupKey({
      passphrase,
      salt: base64ToBytes(encryption.salt),
      iterations: encryption.iterations
    })
    const plaintext = await getWebCrypto().subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(encryption.iv)
      },
      key,
      base64ToBytes(ciphertext)
    )
    return parseBookmarkBackup(bytesToText(plaintext))
  } catch (_) {
    throw new Error(decryptFailedError)
  }
}

export async function parseBookmarkBackupForImport (text, {
  requestPassphrase
} = {}) {
  const content = parseBackupJson(text)
  if (!isEncryptedBackupContent(content)) {
    return parseBookmarkBackup(content)
  }
  const passphrase = await requestPassphrase?.()
  return parseEncryptedBookmarkBackup(content, { passphrase })
}

export function parseBookmarkBackup (text) {
  const content = parseBackupJson(text)

  if (isEncryptedBackupContent(content)) {
    throw new Error(encryptedBackupNeedsPassphraseError)
  }

  if (Array.isArray(content)) {
    return normalizeBookmarkBackupData({
      bookmarks: content,
      bookmarkGroups: []
    })
  }

  if (content?.format === bookmarkBackupFormat && content?.data) {
    if ((content.formatVersion || 1) > bookmarkBackupFormatVersion) {
      throw new Error(unsupportedBookmarkBackupVersionError)
    }
    return normalizeBookmarkBackupData(content.data)
  }

  return normalizeBookmarkBackupData(content)
}
