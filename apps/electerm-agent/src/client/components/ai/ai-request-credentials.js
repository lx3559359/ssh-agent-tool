const credentialStore = new Map()
const MAX_CREDENTIALS = 500
const REQUEST_CONFIG_KEYS = [
  'id',
  'activeAIProfileId',
  'credentialRevisionAI',
  'apiKeyAI',
  'baseURLAI',
  'apiPathAI',
  'authHeaderNameAI',
  'proxyAI',
  'mcpServers'
]
const TRANSPORT_KEYS = [
  'apiKeyAI',
  'baseURLAI',
  'apiPathAI',
  'authHeaderNameAI',
  'proxyAI'
]
const sensitiveQueryNamePattern = /key|token|secret|auth|password|passwd|pass|pwd|signature|sig|credential/i
const sensitiveCliArgumentNameSource = String.raw`(?:[a-z0-9]+[-_.])*(?:api[-_.]?key|access[-_.]?key|secret[-_.]?key|token|access[-_.]?token|auth[-_.]?token|id[-_.]?token|secret|client[-_.]?secret|auth|authorization|password|passwd|pass|pwd|credential|credentials|signature|sig)`
const sensitiveCliArgumentNamePattern = new RegExp(
  `^${sensitiveCliArgumentNameSource}$`,
  'i'
)
const sensitiveCliTextArgumentPattern = new RegExp(
  String.raw`(^|\s)(--${sensitiveCliArgumentNameSource})\s+(?:"[^"]*"|'[^']*'|(?!--)[^\s,;]+)`,
  'gi'
)
const sensitiveJsonAssignmentPattern = /(["'])((?:[a-z0-9]+[-_.])*(?:api[-_.]?key|access[-_.]?key|secret[-_.]?key|token|access[-_.]?token|auth[-_.]?token|id[-_.]?token|secret|client[-_.]?secret|auth|authorization|password|passwd|pass|pwd|credential|credentials|signature|sig))\1\s*:\s*(["'])(?:\\.|(?!\3)[\s\S])*?\3/gi
const sensitiveAssignmentPattern = /(^|[^a-z0-9])([a-z0-9_.-]{0,96}(?:api[_-]?key|token|secret|password|passwd|pwd|credential)[a-z0-9_.-]{0,96})\s*[:：=＝]\s*([^\s,，;；]+)/gi
const sensitiveLabeledAssignmentPattern = /(^|[^a-z0-9])((?:api\s+key|access\s+token|auth\s+token|client\s+secret))\s*[:：=＝]\s*([^\s,，;；]+)/gi
const sensitiveChineseAssignmentPattern = /(^|[^a-z0-9])((?:api\s*(?:密钥|密碼|密码)|访问令牌|訪問令牌|认证令牌|認證令牌|客户端密钥|客戶端密鑰|密码|密碼|口令))\s*[:：=＝]\s*([^\s,，;；]+)/gi
const authorizationHeaderPattern = /\b(Authorization\s*[:：=＝]\s*)(Bearer|Basic|Token|ApiKey|Digest|Custom)?\s*([^\s,，;；]+)/gi

function createToken () {
  if (globalThis.crypto?.randomUUID) {
    return `ai-request-${globalThis.crypto.randomUUID()}`
  }
  return `ai-request-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function pickRequestConfig (config = {}) {
  const result = {}
  for (const key of REQUEST_CONFIG_KEYS) {
    if (key in config) result[key] = config[key]
  }
  return result
}

function rememberCredential (config, profileId, revision) {
  if (!config.apiKeyAI) return ''
  const token = createToken()
  credentialStore.set(token, {
    profileId,
    revision,
    config: pickRequestConfig(config)
  })
  while (credentialStore.size > MAX_CREDENTIALS) {
    const oldest = credentialStore.keys().next().value
    credentialStore.delete(oldest)
  }
  return token
}

function sanitizeStoredUrl (value, allowRelative = false) {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    const url = new URL(
      text,
      absolute ? undefined : 'https://history.invalid'
    )
    url.username = ''
    url.password = ''
    url.hash = ''
    url.search = ''
    if (allowRelative && !absolute) return `${url.pathname}${url.search}`
    return url.toString()
  } catch (error) {
    const withoutFragment = text.split('#', 1)[0]
    const withoutUserInfo = withoutFragment.replace(/\/\/[^/@\s]+@/g, '//')
    return withoutUserInfo.split('?', 1)[0]
  }
}

function sanitizeStoredAuthHeader (value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const separator = text.indexOf(':')
  const rawName = separator >= 0 ? text.slice(0, separator) : text
  const name = /^[a-z][a-z0-9-]{0,63}$/i.test(rawName.trim())
    ? rawName.trim()
    : 'Custom-Header'
  const rawValue = separator >= 0 ? text.slice(separator + 1).trim() : ''
  const scheme = /^(bearer|basic|token)\b/i.exec(rawValue)?.[1] || ''
  return scheme ? `${name}: ${scheme}` : name
}

export function sanitizeAIStoredText (value) {
  const text = String(value ?? '')
  return text
    .replace(/-----BEGIN [^-]+-----[\s\S]*?(?:-----END [^-]+-----|$)/g, '[REDACTED]')
    .replace(sensitiveJsonAssignmentPattern, (match, keyQuote, key, valueQuote) => (
      `${keyQuote}${key}${keyQuote}:${valueQuote}[REDACTED]${valueQuote}`
    ))
    .replace(/\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s<>'"]+/gi, match => sanitizeStoredUrl(match))
    .replace(authorizationHeaderPattern, (match, prefix, scheme) => (
      `${prefix}${scheme ? `${scheme} ` : ''}[REDACTED]`
    ))
    .replace(/\b(Bearer|Basic)\s+[a-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/(^|[^a-z0-9])(?:AKIA|sk-|rk-|pk-)[a-z0-9._-]{8,}(?=$|[^a-z0-9])/gi, '$1[REDACTED]')
    .replace(/(^|[^a-z0-9])(?:gh[opusr]_|xox[baprs]-|AIza|ya29\.)[a-z0-9._-]{8,}(?=$|[^a-z0-9])/gi, '$1[REDACTED]')
    .replace(sensitiveLabeledAssignmentPattern, '$1$2=[REDACTED]')
    .replace(sensitiveChineseAssignmentPattern, '$1$2=[REDACTED]')
    .replace(sensitiveAssignmentPattern, '$1$2=[REDACTED]')
    .replace(sensitiveCliTextArgumentPattern, '$1$2 [REDACTED]')
    .split(/\r?\n/)
    .filter(line => !/^\s*at\s+\S/.test(line))
    .join('\n')
}

function findSafeStreamCommitIndex (text) {
  let commitIndex = text.lastIndexOf('\n') + 1
  if (!commitIndex) return 0
  const privateKeyStart = text.lastIndexOf('-----BEGIN ')
  const privateKeyEnd = text.lastIndexOf('-----END ')
  if (
    privateKeyStart >= 0 &&
    privateKeyStart > privateKeyEnd &&
    privateKeyStart < commitIndex
  ) {
    commitIndex = privateKeyStart
  }
  return commitIndex
}

export function createAIStoredTextAccumulator () {
  let previousRaw = ''
  let pendingRaw = ''
  let committedSafe = ''
  return {
    reset () {
      previousRaw = ''
      pendingRaw = ''
      committedSafe = ''
    },
    sanitize (value, { final = false } = {}) {
      const nextRaw = String(value ?? '')
      if (!nextRaw.startsWith(previousRaw)) {
        pendingRaw = nextRaw
        committedSafe = ''
      } else {
        pendingRaw += nextRaw.slice(previousRaw.length)
      }
      previousRaw = nextRaw
      const commitIndex = final
        ? pendingRaw.length
        : findSafeStreamCommitIndex(pendingRaw)
      if (commitIndex > 0) {
        committedSafe += sanitizeAIStoredText(pendingRaw.slice(0, commitIndex))
        pendingRaw = pendingRaw.slice(commitIndex)
      }
      return committedSafe + sanitizeAIStoredText(pendingRaw)
    }
  }
}
function sanitizePersistedValue (key, value) {
  if (key === 'apiKeyAI') return { remove: true, value: undefined }
  if (key === 'baseURLAI' || key === 'proxyAI') {
    return { remove: false, value: sanitizeStoredUrl(value) }
  }
  if (key === 'apiPathAI') {
    return { remove: false, value: sanitizeStoredUrl(value, true) }
  }
  if (key === 'authHeaderNameAI') {
    return { remove: false, value: sanitizeStoredAuthHeader(value) }
  }
  if (key === 'mcpServers') {
    return { remove: false, value: [] }
  }
  if (key === 'stack' || key === 'stackTrace') {
    return { remove: true, value: undefined }
  }
  if (
    key !== 'credentialRevisionAI' &&
    key !== 'credentialTokenAI' &&
    sensitiveQueryNamePattern.test(key)
  ) {
    return { remove: true, value: undefined }
  }
  return {
    remove: false,
    value: typeof value === 'string' ? sanitizeAIStoredText(value) : value
  }
}

function isCliArgument (value) {
  return typeof value === 'string' &&
    /^--[a-z0-9][a-z0-9_.-]*(?:=.*)?$/i.test(value.trim())
}

function isSensitiveCliArgument (value) {
  if (!isCliArgument(value)) return false
  const name = value.trim().slice(2)
  return !name.includes('=') && sensitiveCliArgumentNamePattern.test(name)
}

function stripCredentials (value) {
  if (Array.isArray(value)) {
    let changed = false
    let redactNext = false
    const next = value.map(item => {
      const shouldRedact = redactNext &&
        typeof item === 'string' &&
        !isCliArgument(item)
      const result = shouldRedact
        ? { value: '[REDACTED]', changed: item !== '[REDACTED]' }
        : stripCredentials(item)
      changed = changed || result.changed
      redactNext = isSensitiveCliArgument(item)
      return result.value
    })
    return { value: changed ? next : value, changed }
  }
  if (typeof value === 'string') {
    const sanitized = sanitizeAIStoredText(value)
    return { value: sanitized, changed: sanitized !== value }
  }
  if (!value || typeof value !== 'object') {
    return { value, changed: false }
  }
  if (value.kind === 'untrusted-observation') {
    return {
      changed: true,
      value: {
        kind: 'untrusted-observation',
        source: String(value.source || ''),
        endpointKey: String(value.endpointKey || ''),
        toolName: String(value.toolName || ''),
        capturedAt: Number(value.capturedAt) || 0,
        truncated: value.truncated === true,
        nextCursor: value.nextCursor ?? null,
        data: stripCredentials(value.data).value
      }
    }
  }
  let changed = false
  const next = {}
  for (const [key, item] of Object.entries(value)) {
    const sanitized = sanitizePersistedValue(key, item)
    if (sanitized.remove) {
      changed = true
      continue
    }
    const result = stripCredentials(sanitized.value)
    changed = changed || result.changed || result.value !== item
    next[key] = result.value
  }
  return { value: changed ? next : value, changed }
}

function getBoundProfile (profileId, revision, config = {}) {
  const id = String(profileId || '')
  const expectedRevision = String(revision || '')
  if (!id || !expectedRevision) return null
  const profiles = Array.isArray(config.aiProfiles) ? config.aiProfiles : []
  const profile = profiles.find(item => (
    String(item?.id || '') === id &&
    String(item?.credentialRevisionAI || '') === expectedRevision
  ))
  if (profile) return profile
  const currentId = String(config.id || config.activeAIProfileId || '')
  if (
    currentId === id &&
    String(config.credentialRevisionAI || '') === expectedRevision
  ) {
    return config
  }
  return null
}

function restoreTransportFields (safeProfile, currentProfile) {
  if (!currentProfile) return { ...safeProfile, apiKeyAI: '' }
  const restored = { ...safeProfile }
  for (const key of TRANSPORT_KEYS) {
    restored[key] = currentProfile[key] || ''
  }
  return restored
}

export function clearAIRequestCredentials () {
  credentialStore.clear()
}

export function createAIRequestCredentialReference (config = {}) {
  const profileId = String(config.id || config.activeAIProfileId || '')
  const revision = String(config.credentialRevisionAI || '')
  const safe = sanitizeAIConfigHistory(pickRequestConfig(config))
  return {
    credentialTokenAI: rememberCredential(config, profileId, revision),
    aiProfileId: profileId,
    credentialRevisionAI: revision,
    baseURLAI: safe.baseURLAI || '',
    apiPathAI: safe.apiPathAI || '',
    authHeaderNameAI: safe.authHeaderNameAI || '',
    proxyAI: safe.proxyAI || ''
  }
}

export function resolveAIRequestConfigForProfile (
  credentialTokenAI,
  aiProfileId,
  credentialRevisionAI,
  config = {}
) {
  const token = String(credentialTokenAI || '')
  const profileId = String(aiProfileId || '')
  const revision = String(credentialRevisionAI || '')
  const remembered = credentialStore.get(token)
  if (
    remembered &&
    remembered.profileId === profileId &&
    remembered.revision === revision
  ) {
    return { ...remembered.config }
  }
  const currentProfile = getBoundProfile(profileId, revision, config)
  return currentProfile ? pickRequestConfig(currentProfile) : {}
}

export function sanitizeAIChatHistory (history = []) {
  return stripCredentials(Array.isArray(history) ? history : []).value
}

export function sanitizeAIStoredValue (value) {
  return stripCredentials(value).value
}

export function sanitizeAIConfigHistory (config = {}) {
  return stripCredentials(config).value
}

export function restoreAIConfigHistoryCredentials (
  historyConfig = {},
  currentConfig = {}
) {
  const safeHistory = sanitizeAIConfigHistory(historyConfig)
  const currentProfiles = Array.isArray(currentConfig.aiProfiles)
    ? currentConfig.aiProfiles
    : []
  const restoredProfiles = (
    Array.isArray(safeHistory.aiProfiles) ? safeHistory.aiProfiles : []
  ).map(profile => restoreTransportFields(
    profile,
    getBoundProfile(
      profile.id,
      profile.credentialRevisionAI,
      { ...currentConfig, aiProfiles: currentProfiles }
    )
  ))
  const activeProfileId = String(safeHistory.activeAIProfileId || '')
  const activeProfile = restoredProfiles.find(
    profile => String(profile?.id || '') === activeProfileId
  )
  const currentRoot = getBoundProfile(
    activeProfileId,
    safeHistory.credentialRevisionAI,
    { ...currentConfig, aiProfiles: currentProfiles }
  )
  const restoredRoot = activeProfile || restoreTransportFields(
    safeHistory,
    currentRoot
  )
  return {
    ...safeHistory,
    ...restoredRoot,
    ...(restoredProfiles.length ? { aiProfiles: restoredProfiles } : {}),
    apiKeyAI: restoredRoot.apiKeyAI || ''
  }
}
