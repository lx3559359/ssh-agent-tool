const AI_MESSAGE_TEXT_LIMIT = 120000
const AI_MESSAGE_IMAGE_LIMIT = 14 * 1024 * 1024
const AI_MESSAGE_PART_LIMIT = 12
const AI_MESSAGE_ROLES = new Set([
  'system',
  'user',
  'assistant',
  'tool'
])

function normalizeAITextContent (value) {
  return String(value || '').slice(0, AI_MESSAGE_TEXT_LIMIT)
}

function normalizeAIImageUrl (value) {
  const source = typeof value === 'string'
    ? value
    : value?.url
  const url = String(source || '').trim()
  if (
    !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(url) ||
    url.length > AI_MESSAGE_IMAGE_LIMIT
  ) {
    return null
  }
  return {
    type: 'image_url',
    image_url: {
      url,
      detail: ['low', 'high', 'auto'].includes(value?.detail)
        ? value.detail
        : 'auto'
    }
  }
}

function normalizeAIMessageRequestContent (content) {
  if (!Array.isArray(content)) {
    return normalizeAITextContent(content)
  }
  return content
    .slice(0, AI_MESSAGE_PART_LIMIT)
    .map(part => {
      if (!part || typeof part !== 'object') return null
      if (part.type === 'text') {
        const text = normalizeAITextContent(part.text)
        return text.trim() ? { type: 'text', text } : null
      }
      if (part.type === 'image_url') {
        return normalizeAIImageUrl(part.image_url)
      }
      return null
    })
    .filter(Boolean)
}

function hasAIMessageContent (message) {
  if (Array.isArray(message?.content)) {
    return message.content.length > 0
  }
  return String(message?.content || '').trim().length > 0
}

function normalizeAIRequestMessages (
  messages,
  allowedRoles = AI_MESSAGE_ROLES
) {
  return (Array.isArray(messages) ? messages : [])
    .filter(message => (
      message &&
      allowedRoles.has(message.role)
    ))
    .map(message => {
      const normalized = {
        ...message,
        role: message.role,
        content: normalizeAIMessageRequestContent(message.content)
      }
      if (
        !hasAIMessageContent(normalized) &&
        !normalized.tool_calls?.length &&
        !normalized.tool_call_id
      ) {
        return null
      }
      return normalized
    })
    .filter(Boolean)
}

function getAIMessageText (content) {
  if (!Array.isArray(content)) return String(content || '')
  return content
    .filter(part => part?.type === 'text')
    .map(part => String(part.text || ''))
    .join('\n')
}

module.exports = {
  AI_MESSAGE_TEXT_LIMIT,
  AI_MESSAGE_IMAGE_LIMIT,
  AI_MESSAGE_PART_LIMIT,
  AI_MESSAGE_ROLES,
  normalizeAIMessageRequestContent,
  normalizeAIRequestMessages,
  getAIMessageText
}
