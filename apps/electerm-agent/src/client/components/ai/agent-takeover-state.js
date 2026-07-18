export const TAKEOVER_STATES = Object.freeze([
  'off',
  'enabling',
  'active-idle',
  'running-readonly',
  'awaiting-risk-confirmation',
  'running-confirmed-change',
  'verifying',
  'stopping',
  'failed',
  'partially-completed'
])

export const ACTIVE_TAKEOVER_STATES = Object.freeze([
  'enabling',
  'active-idle',
  'running-readonly',
  'awaiting-risk-confirmation',
  'running-confirmed-change',
  'verifying',
  'failed',
  'partially-completed'
])

export const EXECUTING_TAKEOVER_STATES = Object.freeze([
  'running-readonly',
  'running-confirmed-change',
  'verifying'
])

const states = new Set(TAKEOVER_STATES)
const activeStates = new Set(ACTIVE_TAKEOVER_STATES)
const executingStates = new Set(EXECUTING_TAKEOVER_STATES)

const transitions = new Map([
  ['off', new Set(['enabling'])],
  ['enabling', new Set(['active-idle', 'failed', 'partially-completed', 'stopping'])],
  ['active-idle', new Set(['running-readonly', 'awaiting-risk-confirmation', 'stopping'])],
  ['running-readonly', new Set(['active-idle', 'failed', 'partially-completed', 'stopping'])],
  ['awaiting-risk-confirmation', new Set([
    'active-idle',
    'running-confirmed-change',
    'failed',
    'partially-completed',
    'stopping'
  ])],
  ['running-confirmed-change', new Set(['verifying', 'failed', 'partially-completed', 'stopping'])],
  ['verifying', new Set(['active-idle', 'failed', 'partially-completed', 'stopping'])],
  ['stopping', new Set(['off'])],
  ['failed', new Set(['active-idle', 'stopping'])],
  ['partially-completed', new Set(['active-idle', 'stopping'])]
])

export function isTakeoverState (state) {
  return states.has(state)
}

export function isTakeoverActive (state) {
  return activeStates.has(state)
}

export function isTakeoverExecuting (state) {
  return executingStates.has(state)
}

export function canTransition (currentState, nextState) {
  if (!isTakeoverState(currentState) || !isTakeoverState(nextState)) {
    return false
  }
  return transitions.get(currentState)?.has(nextState) === true
}

function stateError (state) {
  const error = new Error(`Unsupported AI takeover state: ${String(state)}`)
  error.code = 'INVALID_TAKEOVER_STATE'
  return error
}

export function assertTakeoverTransition (currentState, nextState) {
  if (!isTakeoverState(currentState)) throw stateError(currentState)
  if (!isTakeoverState(nextState)) throw stateError(nextState)
  if (!canTransition(currentState, nextState)) {
    const error = new Error(
      `Invalid AI takeover transition: ${currentState} -> ${nextState}`
    )
    error.code = 'INVALID_TAKEOVER_TRANSITION'
    throw error
  }
  return true
}
