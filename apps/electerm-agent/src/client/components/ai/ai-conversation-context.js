import { sanitizeAIStoredText } from './ai-request-credentials.js'

const DEFAULT_MAX_CONVERSATION_TURNS = 20
const DEFAULT_MAX_HISTORY_CHARS = 24000
const TRUNCATION_MARKER = '\n...[内容过长，已截断]...\n'

function truncateConversationText (value, maxChars) {
  const text = String(value || '')
  const limit = Math.max(0, Number(maxChars) || 0)
  if (text.length <= limit) return text
  if (limit <= TRUNCATION_MARKER.length) return text.slice(0, limit)
  const retainedChars = limit - TRUNCATION_MARKER.length
  const headChars = Math.ceil(retainedChars / 2)
  const tailChars = retainedChars - headChars
  return `${text.slice(0, headChars)}${TRUNCATION_MARKER}${text.slice(-tailChars)}`
}

function fitConversationTurn (prompt, response, maxChars) {
  const budget = Math.max(0, Number(maxChars) || 0)
  if (budget < 2) return null
  let promptBudget = Math.min(prompt.length, Math.floor(budget / 2))
  let responseBudget = Math.min(response.length, budget - promptBudget)
  let remaining = budget - promptBudget - responseBudget

  const extraPrompt = Math.min(prompt.length - promptBudget, remaining)
  promptBudget += extraPrompt
  remaining -= extraPrompt
  responseBudget += Math.min(response.length - responseBudget, remaining)

  return [
    truncateConversationText(prompt, promptBudget),
    truncateConversationText(response, responseBudget)
  ]
}

export function buildAIConversationMessages (history = [], currentItem = {}, {
  maxTurns = DEFAULT_MAX_CONVERSATION_TURNS,
  maxHistoryChars = DEFAULT_MAX_HISTORY_CHARS
} = {}) {
  const rawHistory = Array.isArray(history) ? history : []
  const rawCurrentItem = currentItem && typeof currentItem === 'object'
    ? currentItem
    : {}
  const currentId = String(rawCurrentItem?.id || '')
  const currentIndex = currentId
    ? rawHistory.findIndex(item => String(item?.id || '') === currentId)
    : -1
  const historyEndIndex = currentIndex >= 0
    ? currentIndex
    : rawHistory.length
  const currentScopeId = String(rawCurrentItem?.conversationScopeId || '')
  const scopedEntries = rawHistory
    .slice(0, historyEndIndex)
    .filter(item => String(item?.conversationScopeId || '') === currentScopeId)
  const previousEntries = buildActiveConversationBranch(
    scopedEntries,
    rawCurrentItem
  )
  const turnLimit = Math.max(0, Number(maxTurns) || 0)
  const charLimit = Math.max(0, Number(maxHistoryChars) || 0)
  const selectedTurns = []
  let usedChars = 0

  for (let index = previousEntries.length - 1; index >= 0; index--) {
    if (selectedTurns.length >= turnLimit) {
      break
    }
    const entry = previousEntries[index] || {}
    const prompt = String(entry.prompt || '').trim()
    const response = String(entry.response || '').trim()
    const isCompleted = entry.completionStatus === 'completed'
    if (!isCompleted || !prompt || !response) {
      continue
    }
    const pairChars = prompt.length + response.length
    if (usedChars + pairChars > charLimit) {
      if (!selectedTurns.length) {
        const boundedTurn = fitConversationTurn(
          prompt,
          response,
          charLimit - usedChars
        )
        if (boundedTurn) selectedTurns.unshift(boundedTurn)
      }
      break
    }
    selectedTurns.unshift([prompt, response])
    usedChars += pairChars
  }

  const messages = selectedTurns.flatMap(([prompt, response]) => [
    { role: 'user', content: sanitizeAIStoredText(prompt) },
    { role: 'assistant', content: sanitizeAIStoredText(response) }
  ])
  const currentPrompt = String(rawCurrentItem?.prompt || '').trim()
  if (currentPrompt) {
    messages.push({ role: 'user', content: sanitizeAIStoredText(currentPrompt) })
  }
  return messages
}

function buildActiveConversationBranch (entries = [], currentItem = {}) {
  const activeBranch = []
  const branchEntries = [...entries, currentItem]

  for (let index = 0; index < branchEntries.length; index++) {
    const entry = branchEntries[index] || {}
    const isCurrent = index === branchEntries.length - 1
    const retryOfId = String(entry.retryOfId || '')
    if (retryOfId && (isCurrent || entry.completionStatus === 'completed')) {
      const hasRetryTimestamp = entry.retryOfTimestamp !== undefined &&
        entry.retryOfTimestamp !== null &&
        entry.retryOfTimestamp !== ''
      const retryTimestamp = Number(entry.retryOfTimestamp)
      const branchIndex = activeBranch.findIndex(candidate => (
        String(candidate?.id || '') === retryOfId ||
        String(candidate?.retryOfId || '') === retryOfId
      ))
      const timestampIndex = hasRetryTimestamp && Number.isFinite(retryTimestamp)
        ? activeBranch.findIndex(candidate => {
          const timestamp = Number(candidate?.timestamp)
          return Number.isFinite(timestamp) && timestamp >= retryTimestamp
        })
        : -1
      const cutoffIndex = branchIndex >= 0 ? branchIndex : timestampIndex
      if (cutoffIndex >= 0) {
        activeBranch.splice(cutoffIndex)
      }
    }
    if (!isCurrent) {
      activeBranch.push(entry)
    }
  }
  return activeBranch
}
