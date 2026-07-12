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
  next.nameAI = next.nameAI || next.modelAI || next.baseURLAI || 'AI 配置'
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

export function getAIProfileOptions (config = {}) {
  return migrateAIProfiles(config).aiProfiles.map(profile => ({
    value: profile.id,
    label: profile.nameAI || 'AI 配置'
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

export function getAIModelStatus (config = {}) {
  const active = getActiveAIConfig(config)
  const hasRequiredConfig = Boolean(active.baseURLAI && active.apiKeyAI)
  if (!hasRequiredConfig) {
    return {
      status: 'unconfigured',
      label: '未配置',
      className: 'not-configured',
      title: '请先填写 API 地址和 API Key'
    }
  }
  const statusExpired = active.aiStatusFingerprint &&
    active.aiStatusFingerprint !== getAIStatusFingerprint(active)
  if (!active.aiStatus || statusExpired) {
    return {
      status: 'pending',
      label: '待测试',
      className: 'pending',
      title: statusExpired
        ? '模型配置已变化，请重新测试连接'
        : '配置已填写，但还没有完成测试连接'
    }
  }
  if (active.aiStatus === 'available') {
    return {
      status: 'available',
      label: '可用',
      className: 'available',
      title: active.aiStatusMessage || '最近一次模型测试连接成功'
    }
  }
  if (active.aiStatus === 'error') {
    return {
      status: 'error',
      label: '异常',
      className: 'error',
      title: active.aiStatusMessage || '最近一次模型测试连接失败'
    }
  }
  return {
    status: 'pending',
    label: '待测试',
    className: 'pending',
    title: '配置已填写，但还没有完成测试连接'
  }
}
