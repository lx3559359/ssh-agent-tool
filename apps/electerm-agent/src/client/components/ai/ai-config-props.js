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
  'proxyAI'
]

export const requiredAIConfigsArr = [
  'baseURLAI',
  'modelAI'
]

export function isAIConfigMissing (config = {}) {
  return requiredAIConfigsArr.some(k => !String(config[k] || '').trim())
}
