const DEFAULT_ROLE = '你是中文 SSH 运维助手。'
const DEFAULT_LANGUAGE = '简体中文'

export function buildAIChatRole ({
  roleAI,
  languageAI,
  getLangName
} = {}) {
  const role = String(roleAI || '').trim() || DEFAULT_ROLE
  const lang = String(languageAI || '').trim() ||
    (typeof getLangName === 'function' ? getLangName() : '') ||
    DEFAULT_LANGUAGE
  return `${role}; 请使用${lang}回复`
}

export function getAIChatCopyText (item = {}) {
  const response = String(item.response || '').trim()
  return response || String(item.prompt || '')
}

export function createRetryChatEntry (item = {}, {
  id,
  timestamp
} = {}) {
  return {
    ...item,
    id,
    timestamp,
    response: '',
    pending: true,
    isStreaming: false,
    sessionId: null,
    toolCalls: []
  }
}

export function clearAIChatContext (store) {
  if (!store) {
    return
  }
  store.aiChatHistory = []
}
