const PROFILE_KEYS = [
  'id',
  'nameAI',
  'baseURLAI',
  'modelAI',
  'modelOptionsAI',
  'roleAI',
  'apiKeyAI',
  'authHeaderNameAI',
  'apiPathAI',
  'aiStatus',
  'aiStatusMessage',
  'aiStatusAt',
  'aiStatusFingerprint',
  'credentialRevisionAI',
  'agentSkills',
  'mcpServers',
  'languageAI',
  'proxyAI'
]

const COMPAT_KEYS = PROFILE_KEYS.filter(key => key !== 'id')

export function createAICredentialRevision () {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  return `ai-credential-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function withAICredentialRevision (
  profile = {},
  previousProfile,
  createRevision = createAICredentialRevision
) {
  const next = { ...profile }
  const credentialFields = [
    'apiKeyAI',
    'baseURLAI',
    'apiPathAI',
    'authHeaderNameAI',
    'proxyAI',
    'mcpServers'
  ]
  const credentialChanged = !previousProfile || credentialFields.some(key => {
    if (key === 'mcpServers') {
      try {
        return JSON.stringify(previousProfile[key] || []) !== JSON.stringify(next[key] || [])
      } catch (error) {
        return true
      }
    }
    return String(previousProfile[key] || '') !== String(next[key] || '')
  })
  if (next.apiKeyAI && (!next.credentialRevisionAI || credentialChanged)) {
    next.credentialRevisionAI = createRevision()
  }
  return next
}

function createProfileId () {
  return `ai-profile-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function trimString (value) {
  return typeof value === 'string' ? value.trim() : value
}

function translated (translate, key, fallback) {
  const value = typeof translate === 'function' ? translate(key) : ''
  return typeof value === 'string' && value.trim() && value !== key
    ? value
    : fallback
}

function normalizeModelOptions (items = []) {
  const source = Array.isArray(items) ? items : [items]
  return [...new Set(
    source
      .map(item => String(item || '').trim())
      .filter(Boolean)
  )]
}

export function normalizeAIProfile (profile = {}) {
  const next = {}
  for (const key of PROFILE_KEYS) {
    if (key in profile) {
      next[key] = key === 'id'
        ? String(profile[key] || '').trim()
        : trimString(profile[key])
    }
  }
  next.id = next.id || createProfileId()
  // Keep persisted names language-neutral while retaining legacy technical
  // fallbacks. Only a profile with no name, model, or URL uses localized copy
  // in getAIProfileOptions.
  next.nameAI = next.nameAI || next.modelAI || next.baseURLAI || ''
  next.apiPathAI = next.apiPathAI || ''
  next.modelOptionsAI = normalizeModelOptions(next.modelOptionsAI)
  next.agentSkills = Array.isArray(next.agentSkills) ? next.agentSkills : []
  next.mcpServers = Array.isArray(next.mcpServers) ? next.mcpServers : []
  return next
}

function hasUsableProfileFields (profile = {}) {
  return Boolean(profile.baseURLAI || profile.apiKeyAI || profile.modelAI || profile.nameAI)
}

function getLegacyProfile (config = {}) {
  const legacy = {}
  for (const key of COMPAT_KEYS) {
    if (key in config) {
      legacy[key] = config[key]
    }
  }
  return hasUsableProfileFields(legacy)
    ? normalizeAIProfile(legacy)
    : null
}

function dedupeProfiles (profiles = []) {
  const seen = new Set()
  const result = []
  for (const item of profiles) {
    if (!item) continue
    const profile = normalizeAIProfile(item)
    if (seen.has(profile.id)) continue
    seen.add(profile.id)
    result.push(profile)
  }
  return result
}

export function migrateAIProfiles (config = {}) {
  const existingProfiles = dedupeProfiles(config.aiProfiles || [])
  const legacyProfile = getLegacyProfile(config)
  const aiProfiles = existingProfiles.length
    ? existingProfiles
    : (legacyProfile ? [legacyProfile] : [])
  const activeAIProfileId = aiProfiles.find(profile => profile.id === config.activeAIProfileId)?.id ||
    aiProfiles[0]?.id ||
    ''
  const active = aiProfiles.find(profile => profile.id === activeAIProfileId) || {}
  return {
    ...config,
    ...active,
    aiProfiles,
    activeAIProfileId
  }
}

export function getActiveAIConfig (config = {}) {
  const normalized = migrateAIProfiles(config)
  const active = normalized.aiProfiles.find(profile => profile.id === normalized.activeAIProfileId)
  return {
    ...normalized,
    ...(active || {})
  }
}

export function upsertAIProfile (config = {}, profile = {}) {
  const normalized = migrateAIProfiles(config)
  const nextProfile = normalizeAIProfile({
    ...profile,
    id: profile.id || normalized.activeAIProfileId
  })
  const index = normalized.aiProfiles.findIndex(item => item.id === nextProfile.id)
  const aiProfiles = index === -1
    ? [...normalized.aiProfiles, nextProfile]
    : normalized.aiProfiles.map(item => item.id === nextProfile.id ? nextProfile : item)
  return {
    ...normalized,
    ...nextProfile,
    aiProfiles,
    activeAIProfileId: nextProfile.id
  }
}

export function upsertAIProfileWithCredentialRevision (
  config = {},
  profile = {},
  createRevision = createAICredentialRevision
) {
  const normalized = migrateAIProfiles(config)
  const nextProfile = normalizeAIProfile({
    ...profile,
    id: profile.id || normalized.activeAIProfileId
  })
  const previousProfile = normalized.aiProfiles.find(
    item => item.id === nextProfile.id
  )
  return upsertAIProfile(
    normalized,
    withAICredentialRevision(nextProfile, previousProfile, createRevision)
  )
}
export function removeAIProfile (config = {}, profileId) {
  const normalized = migrateAIProfiles(config)
  const aiProfiles = normalized.aiProfiles.filter(profile => profile.id !== profileId)
  const activeAIProfileId = normalized.activeAIProfileId === profileId
    ? aiProfiles[0]?.id || ''
    : normalized.activeAIProfileId
  const active = aiProfiles.find(profile => profile.id === activeAIProfileId) || {}
  return {
    ...normalized,
    ...active,
    aiProfiles,
    activeAIProfileId
  }
}

export function buildAIProfileFromValues (values = {}) {
  const profile = {}
  for (const key of PROFILE_KEYS) {
    if (key in values) {
      profile[key] = values[key]
    }
  }
  profile.id = profile.id || values.activeAIProfileId
  return normalizeAIProfile(profile)
}

const AI_PROFILE_REQUEST_KEYS = [
  'nameAI',
  'baseURLAI',
  'apiPathAI',
  'apiKeyAI',
  'authHeaderNameAI',
  'proxyAI',
  'modelAI',
  'modelOptionsAI',
  'roleAI',
  'agentSkills',
  'mcpServers',
  'languageAI',
  'credentialRevisionAI'
]

function serializeAIProfileRequestValue (value) {
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch (error) {
      return ''
    }
  }
  return String(value || '')
}

export function isAIProfileRequestCurrent (requestProfile = {}, values = {}) {
  const requested = normalizeAIProfile(requestProfile)
  const current = buildAIProfileFromValues(values)
  const requestId = String(requestProfile.id || requestProfile.activeAIProfileId || '')
  const currentId = String(values.activeAIProfileId || current.id || '')
  if (!requestId || requestId !== currentId) return false
  return AI_PROFILE_REQUEST_KEYS.every(key => (
    serializeAIProfileRequestValue(requested[key]) ===
    serializeAIProfileRequestValue(current[key])
  ))
}
export function getAIProfileOptions (config = {}, translate) {
  return migrateAIProfiles(config).aiProfiles.map(profile => ({
    value: profile.id,
    label: profile.nameAI || translated(translate, 'shellpilotAiDefaultConfiguration', 'AI Configuration')
  }))
}

export function getAIModelOptions (config = {}) {
  const active = getActiveAIConfig(config)
  return normalizeModelOptions([
    ...(active.modelOptionsAI || []),
    active.modelAI
  ]).map(value => ({
    value,
    label: value
  }))
}

const sensitiveQueryNamePattern = /key|token|secret|auth|password|passwd|pass|pwd|signature|sig|credential/i

function cleanFingerprintUrl (url) {
  url.username = ''
  url.password = ''
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (sensitiveQueryNamePattern.test(key)) url.searchParams.delete(key)
  }
  return url
}

function sanitizeFingerprintUrl (value, allowRelative = false) {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    const url = cleanFingerprintUrl(new URL(
      text,
      absolute ? undefined : 'https://fingerprint.invalid'
    ))
    if (allowRelative && !absolute) return `${url.pathname}${url.search}`
    return url.toString()
  } catch (error) {
    const withoutFragment = text.split('#', 1)[0]
    const withoutUserInfo = withoutFragment.replace(/\/\/[^/@\s]+@/g, '//')
    const [path, query = ''] = withoutUserInfo.split('?', 2)
    const safeQuery = query
      .split('&')
      .filter(Boolean)
      .filter(part => !sensitiveQueryNamePattern.test(part.split('=', 1)[0]))
      .join('&')
    return safeQuery ? `${path}?${safeQuery}` : path
  }
}

function sanitizeAuthHeaderSemantics (value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const separator = text.indexOf(':')
  const rawName = separator >= 0 ? text.slice(0, separator) : text
  const name = /^[a-z][a-z0-9-]{0,63}$/i.test(rawName.trim())
    ? rawName.trim().toLowerCase()
    : 'custom'
  const rawValue = separator >= 0 ? text.slice(separator + 1).trim() : ''
  const scheme = /^(bearer|basic|token)\b/i.exec(rawValue)?.[1]?.toLowerCase() || ''
  return `${name}:${scheme}`
}

function createFingerprintDigest (value) {
  let hash = 2166136261
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function getAIStatusFingerprint (config = {}) {
  const transport = [
    sanitizeFingerprintUrl(config.baseURLAI),
    sanitizeFingerprintUrl(config.apiPathAI, true),
    sanitizeAuthHeaderSemantics(config.authHeaderNameAI),
    sanitizeFingerprintUrl(config.proxyAI)
  ].join('|')
  return [
    `transport:${createFingerprintDigest(transport)}`,
    config.modelAI || '',
    config.credentialRevisionAI || ''
  ].join('|')
}

const HEALTH_STATUS_META = {
  checking: ['shellpilotAiChecking', 'Checking', 'shellpilotAiCheckingHint', 'Checking the selected API and model'],
  reachable: ['shellpilotAiReachable', 'API Reachable', 'shellpilotAiReachableHint', 'The API is reachable, but the selected model is not confirmed available'],
  available: ['shellpilotAiAvailable', 'Available', 'shellpilotAiRecentSuccess', 'The selected model is available'],
  'auth-error': ['shellpilotAiAuthError', 'Authentication Failed', 'shellpilotAiAuthErrorHint', 'The API rejected the configured credentials'],
  'model-error': ['shellpilotAiModelError', 'Model Unavailable', 'shellpilotAiModelErrorHint', 'The selected model could not be used'],
  'quota-error': ['shellpilotAiQuotaError', 'Quota Error', 'shellpilotAiQuotaErrorHint', 'The account quota or rate limit blocked the request'],
  'network-error': ['shellpilotAiNetworkError', 'Network Error', 'shellpilotAiNetworkErrorHint', 'The API could not be reached'],
  stale: ['shellpilotAiStale', 'Check Required', 'shellpilotAiStaleHint', 'The selected API or model needs to be checked again']
}

function normalizeHealthStatus (status) {
  if (status === 'pending') return 'stale'
  if (status === 'error') return 'network-error'
  return HEALTH_STATUS_META[status] ? status : 'stale'
}

export function getAIModelStatus (config = {}, translate, healthState) {
  const active = getActiveAIConfig(config)
  const hasRequiredConfig = Boolean(active.baseURLAI && active.apiKeyAI)
  if (!hasRequiredConfig) {
    return {
      status: 'unconfigured',
      label: translated(translate, 'shellpilotAiUnconfigured', 'Not Configured'),
      className: 'not-configured',
      title: translated(translate, 'shellpilotAiConfigureHint', 'Enter an API address and API key first')
    }
  }
  const hasLiveState = Boolean(healthState?.status)
  const statusExpired = !hasLiveState && active.aiStatusFingerprint &&
    active.aiStatusFingerprint !== getAIStatusFingerprint(active)
  const status = statusExpired
    ? 'stale'
    : normalizeHealthStatus(healthState?.status || active.aiStatus)
  const [labelKey, labelFallback, titleKey, titleFallback] = HEALTH_STATUS_META[status]
  return {
    status,
    label: translated(translate, labelKey, labelFallback),
    className: status,
    title: healthState?.message || active.aiStatusMessage || translated(
      translate,
      statusExpired ? 'shellpilotAiConfigChanged' : titleKey,
      statusExpired
        ? 'The model configuration changed; check it again'
        : titleFallback
    )
  }
}
