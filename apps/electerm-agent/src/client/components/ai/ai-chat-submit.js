import { isAIConfigMissing } from './ai-config-props.js'

export function getAIChatSubmitAction ({
  prompt = '',
  config = {}
} = {}) {
  if (!String(prompt).trim()) {
    return 'noop'
  }
  return isAIConfigMissing(config)
    ? 'open-config'
    : 'submit'
}

export function getAgentComposerActionState ({
  activeRunStatus = '',
  isAgent = false,
  agentRunning = false,
  disabled = false
} = {}) {
  if (activeRunStatus === 'stopping') {
    return Object.freeze({ kind: 'stopping', disabled: true })
  }
  if (['pending', 'running'].includes(activeRunStatus)) {
    return Object.freeze({ kind: 'stop', disabled: false })
  }
  if (isAgent && agentRunning) {
    return Object.freeze({ kind: 'loading', disabled: true })
  }
  return Object.freeze({ kind: 'send', disabled: Boolean(disabled) })
}
