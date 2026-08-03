export function handoffAgentPromptToAi ({
  prompt,
  getAiChat,
  schedule = setTimeout,
  maxAttempts = 20,
  retryDelay = 150,
  onReady = () => {},
  onUnavailable = () => {}
} = {}) {
  let attempts = 0
  let cancelled = false

  const tryHandoff = () => {
    if (cancelled) return
    attempts += 1
    const aiChat = getAiChat?.()
    if (typeof aiChat?.setPrompt === 'function') {
      aiChat.setPrompt(String(prompt || ''))
      onReady()
      return
    }
    if (attempts >= Math.max(1, maxAttempts)) {
      onUnavailable()
      return
    }
    schedule(tryHandoff, Math.max(0, retryDelay))
  }

  tryHandoff()
  return () => { cancelled = true }
}
