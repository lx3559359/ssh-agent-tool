export const aiConfigsArr = [
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
  'proxyAI',
  'aiProfiles',
  'activeAIProfileId'
]

export const requiredAIConfigsArr = [
  'baseURLAI',
  'apiKeyAI'
]

export function isAIConfigMissing (config = {}) {
  return requiredAIConfigsArr.some(k => !String(config[k] || '').trim())
}
