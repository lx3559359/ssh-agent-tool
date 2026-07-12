const PROFILE_KEYS = [
  'id',
  'nameAI',
  'baseURLAI',
  'modelAI',
  'roleAI',
  'apiKeyAI',
  'authHeaderNameAI',
  'apiPathAI',
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
  next.nameAI = next.nameAI || next.modelAI || next.baseURLAI || 'AI 配置'
  next.apiPathAI = next.apiPathAI || ''
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

export function getAIProfileOptions (config = {}) {
  return migrateAIProfiles(config).aiProfiles.map(profile => ({
    value: profile.id,
    label: `${profile.nameAI || 'AI 配置'}${profile.modelAI ? ` / ${profile.modelAI}` : ''}`
  }))
}
