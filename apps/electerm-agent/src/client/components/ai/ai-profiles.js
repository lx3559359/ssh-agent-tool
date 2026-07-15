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
  'agentSkills',
  'mcpServers',
  'languageAI',
  'proxyAI'
]

const COMPAT_KEYS = PROFILE_KEYS.filter(key => key !== 'id')

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

export function getAIStatusFingerprint (config = {}) {
  const apiKey = String(config.apiKeyAI || '')
  const apiKeyMarker = apiKey
    ? `${apiKey.length}:${apiKey.slice(0, 4)}:${apiKey.slice(-4)}`
    : ''
  return [
    config.baseURLAI || '',
    config.apiPathAI || '',
    config.modelAI || '',
    config.authHeaderNameAI || '',
    config.proxyAI || '',
    apiKeyMarker
  ].join('|')
}

export function getAIModelStatus (config = {}, translate) {
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
  const statusExpired = active.aiStatusFingerprint &&
    active.aiStatusFingerprint !== getAIStatusFingerprint(active)
  if (!active.aiStatus || statusExpired) {
    return {
      status: 'pending',
      label: translated(translate, 'shellpilotAiPending', 'Pending Test'),
      className: 'pending',
      title: statusExpired
        ? translated(translate, 'shellpilotAiConfigChanged', 'The model configuration changed; test the connection again')
        : translated(translate, 'shellpilotAiNotTested', 'The configuration is complete but has not been tested')
    }
  }
  if (active.aiStatus === 'available') {
    return {
      status: 'available',
      label: translated(translate, 'shellpilotAiAvailable', 'Available'),
      className: 'available',
      title: active.aiStatusMessage || translated(translate, 'shellpilotAiRecentSuccess', 'The most recent model connection test succeeded')
    }
  }
  if (active.aiStatus === 'error') {
    return {
      status: 'error',
      label: translated(translate, 'shellpilotAiError', 'Error'),
      className: 'error',
      title: active.aiStatusMessage || translated(translate, 'shellpilotAiRecentFailure', 'The most recent model connection test failed')
    }
  }
  return {
    status: 'pending',
    label: translated(translate, 'shellpilotAiPending', 'Pending Test'),
    className: 'pending',
    title: translated(translate, 'shellpilotAiNotTested', 'The configuration is complete but has not been tested')
  }
}
