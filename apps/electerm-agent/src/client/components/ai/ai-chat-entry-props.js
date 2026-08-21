import { aiConfigsArr } from './ai-config-props.js'

const SEMANTIC_ARRAY_PROPS = new Set(['selectedTabIds', 'tabs'])
const AI_CONFIG_KEYS = [...new Set([
  ...aiConfigsArr,
  'aiStatus',
  'aiStatusAt',
  'aiStatusFingerprint',
  'aiStatusMessage',
  'credentialRevisionAI',
  'modelOptionsAI'
])]

function haveSameItems (left, right) {
  if (left === right) return true
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  return left.length === right.length &&
    left.every((item, index) => item === right[index])
}

function serializeConfigValue (value) {
  if (!value || typeof value !== 'object') return String(value ?? '')
  try {
    return JSON.stringify(value)
  } catch (error) {
    return null
  }
}

export function haveSameAIConfig (left, right) {
  if (left === right) return true
  if (!left || !right) return false
  return AI_CONFIG_KEYS.every(key => {
    const leftValue = serializeConfigValue(left[key])
    const rightValue = serializeConfigValue(right[key])
    return leftValue !== null && leftValue === rightValue
  })
}

export function areAIChatEntryPropsEqual (previous = {}, next = {}) {
  const keys = new Set([
    ...Object.keys(previous),
    ...Object.keys(next)
  ])
  for (const key of keys) {
    if (SEMANTIC_ARRAY_PROPS.has(key)) {
      if (!haveSameItems(previous[key], next[key])) return false
      continue
    }
    if (key === 'config') {
      if (!haveSameAIConfig(previous[key], next[key])) return false
      continue
    }
    if (previous[key] !== next[key]) return false
  }
  return true
}
