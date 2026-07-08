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
