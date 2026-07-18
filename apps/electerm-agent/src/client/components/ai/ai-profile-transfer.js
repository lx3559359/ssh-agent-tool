import {
  getActiveAIConfig,
  migrateAIProfiles,
  normalizeAIProfile
} from './ai-profiles.js'

const FORMAT = 'shellpilot-ai-profiles'
const VERSION = 1

function withoutCredential (profile = {}) {
  const next = { ...profile }
  delete next.apiKeyAI
  delete next.apiKeyAICiphertext
  return next
}

function normalizeImportPayload (payload) {
  const source = typeof payload === 'string' ? JSON.parse(payload) : payload
  if (!source || source.format !== FORMAT || Number(source.version) !== VERSION) {
    throw new Error('不是受支持的 ShellPilot 模型 API 配置文件')
  }
  if (!Array.isArray(source.profiles) || !source.profiles.length) {
    throw new Error('配置文件中没有可导入的模型 API 配置')
  }
  return {
    activeAIProfileId: String(source.activeAIProfileId || ''),
    profiles: source.profiles.map(profile => withoutCredential(normalizeAIProfile(profile)))
  }
}

export function createAIProfileExport (config = {}) {
  const normalized = migrateAIProfiles(config)
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    activeAIProfileId: normalized.activeAIProfileId,
    profiles: normalized.aiProfiles.map(withoutCredential)
  }
}

export function mergeAIProfileImport (config = {}, payload) {
  const current = migrateAIProfiles(config)
  const imported = normalizeImportPayload(payload)
  const existingById = new Map(current.aiProfiles.map(profile => [profile.id, profile]))
  const importedIds = new Set()
  const mergedImported = imported.profiles.map(profile => {
    importedIds.add(profile.id)
    const existing = existingById.get(profile.id)
    return normalizeAIProfile({
      ...existing,
      ...profile,
      apiKeyAI: existing?.apiKeyAI || ''
    })
  })
  const aiProfiles = [
    ...current.aiProfiles.filter(profile => !importedIds.has(profile.id)),
    ...mergedImported
  ]
  const activeAIProfileId = aiProfiles.some(profile => profile.id === imported.activeAIProfileId)
    ? imported.activeAIProfileId
    : current.activeAIProfileId || aiProfiles[0]?.id || ''
  return migrateAIProfiles({
    ...current,
    aiProfiles,
    activeAIProfileId
  })
}

export function getImportedActiveAIProfile (config = {}) {
  return getActiveAIConfig(config)
}
