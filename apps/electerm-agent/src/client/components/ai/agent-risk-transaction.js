import {
  classifyAgentCall,
  getAgentToolDescriptor
} from './agent-tool-policy.js'
import { createPlanGrant } from './agent-plan-grant.js'
import {
  getTask,
  patchTask,
  saveTask,
  taskStatuses
} from '../../common/safety-transactions/transaction-store.js'

const impactLevels = Object.freeze(['low', 'medium', 'high', 'unknown'])
const impactFields = Object.freeze(['cpu', 'memory', 'disk', 'network', 'duration'])

function rejectTransaction (message) {
  const error = new Error(message)
  error.code = 'AGENT_RISK_TRANSACTION_REJECTED'
  throw error
}

function cloneJson (value) {
  if (value === undefined) return null
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map(cloneJson)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      cloneJson(child)
    ]))
  }
  return String(value)
}

function deepFreeze (value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function stableSerialize (value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

function maxImpact (calls) {
  return Object.fromEntries(impactFields.map(field => {
    const values = calls.map(call => call.classification.resourceImpact?.[field] || 'unknown')
    const value = values.reduce((highest, current) => {
      return impactLevels.indexOf(current) > impactLevels.indexOf(highest)
        ? current
        : highest
    }, 'low')
    return [field, value]
  }))
}

function callCommand (name, args) {
  if (name === 'send_terminal_command' || name === 'run_background_command') {
    return String(args.command || '')
  }
  if (name === 'run_local_cli') {
    return [String(args.tool || ''), ...(args.args || []).map(String)].filter(Boolean).join(' ')
  }
  return JSON.stringify(args)
}

function normalizedCall (call) {
  const name = String(call?.name || call?.descriptor?.name || '')
  if (!name) rejectTransaction('Risk transaction call name is required')
  const descriptor = call?.descriptor?.name
    ? getAgentToolDescriptor(call.descriptor.name)
    : getAgentToolDescriptor(name)
  const args = cloneJson(call?.args || {})
  const expandedContent = call?.expandedContent ?? null
  const classification = classifyAgentCall({ descriptor, args, expandedContent })
  if (classification.outcome === 'blocked' || classification.outcome === 'unauditable') {
    rejectTransaction(`Risk transaction contains ${classification.outcome} call: ${name}`)
  }
  return {
    name,
    args,
    command: callCommand(name, args),
    scriptEntry: cloneJson(call?.scriptEntry ?? null),
    classification: cloneJson(classification)
  }
}

export function buildRiskTransaction (calls, context = {}) {
  if (!Array.isArray(calls) || calls.length === 0) {
    throw new TypeError('Risk transaction requires at least one call')
  }
  const normalizedCalls = calls.map(normalizedCall)
  if (!normalizedCalls.some(call => call.classification.outcome === 'risky')) {
    rejectTransaction('Risk transaction must contain at least one risky call')
  }
  const endpoint = cloneJson(context.endpoint || {})
  const recovery = cloneJson(context.recovery || {
    type: 'none',
    verified: false,
    limits: 'unknown'
  })
  const transaction = {
    schemaVersion: 1,
    endpoint,
    session: {
      tabId: endpoint.tabId || '',
      pid: endpoint.pid || '',
      terminalPid: endpoint.terminalPid || ''
    },
    goal: String(context.goal || context.purpose || 'Agent risk operation'),
    purpose: String(context.purpose || context.goal || 'Agent risk operation'),
    calls: normalizedCalls,
    affectedObjects: cloneJson(context.affectedObjects || []),
    worstCase: String(context.worstCase || 'unknown'),
    resourceImpact: cloneJson(context.resourceImpact || maxImpact(normalizedCalls)),
    disconnectPossible: context.disconnectPossible === true,
    recovery,
    rollbackLimits: String(context.rollbackLimits || recovery.limits || 'unknown'),
    verification: cloneJson(context.verification || []),
    cancellationBehavior: String(
      context.cancellationBehavior ||
      'Cancellation prevents future steps; a dispatched remote effect may remain unknown.'
    ),
    skillBindings: cloneJson(context.skillBindings || []),
    artifactDigests: cloneJson(context.artifactDigests || [])
  }
  return deepFreeze(transaction)
}

function combinationBoundary (transaction) {
  return {
    endpoint: transaction.endpoint,
    goal: transaction.goal,
    calls: transaction.calls.map(call => ({
      name: call.name,
      args: call.args,
      scriptEntry: call.scriptEntry
    })),
    affectedObjects: transaction.affectedObjects,
    recovery: transaction.recovery,
    verification: transaction.verification
  }
}

export function canCombineRiskTransactions (left, right) {
  if (!left || !right) return false
  return stableSerialize(combinationBoundary(left)) ===
    stableSerialize(combinationBoundary(right))
}

export function buildRiskPlanPayload (transaction) {
  return {
    schemaVersion: 1,
    endpoint: cloneJson(transaction.endpoint),
    goal: transaction.goal,
    orderedCalls: transaction.calls.map(call => ({
      name: call.name,
      args: cloneJson(call.args)
    })),
    skillBindings: cloneJson(transaction.skillBindings),
    artifactDigests: cloneJson(transaction.artifactDigests),
    impactTargets: cloneJson(transaction.affectedObjects),
    resourceImpact: cloneJson(transaction.resourceImpact),
    recovery: cloneJson(transaction.recovery),
    verification: cloneJson(transaction.verification)
  }
}

function resolveStore (store = {}) {
  return {
    getTask: store.getTask || getTask,
    saveTask: store.saveTask || saveTask,
    patchTask: store.patchTask || patchTask
  }
}

function timestamp (now) {
  const value = typeof now === 'function' ? now() : (now ?? new Date())
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString()
}

function taskSteps (transaction) {
  return transaction.calls.map((call, index) => ({
    id: `risk-${index + 1}`,
    title: call.name,
    purpose: transaction.purpose,
    command: call.command || call.name,
    status: 'pending',
    audit: []
  }))
}

export async function confirmRiskTransaction (transaction, options = {}) {
  const store = resolveStore(options.store)
  const now = timestamp(options.now)
  let task = await store.saveTask({
    source: 'agent',
    title: transaction.goal,
    purpose: transaction.purpose,
    endpoint: transaction.endpoint,
    status: taskStatuses.awaitingChangeConfirmation,
    steps: taskSteps(transaction),
    riskTransaction: transaction,
    audit: [],
    createdAt: now,
    updatedAt: now
  })
  const accepted = await options.confirm(transaction)
  if (!accepted) {
    const audit = [{
      phase: 'cancel',
      timestamp: timestamp(options.now),
      code: null,
      preview: 'User cancelled before transaction dispatch; zero steps executed.'
    }]
    task = await store.patchTask(task.id, {
      status: taskStatuses.cancelled,
      audit,
      completedAt: timestamp(options.now)
    })
    return { accepted: false, cancelled: true, taskId: task.id, task }
  }

  const planGrant = await createPlanGrant(buildRiskPlanPayload(transaction), {
    confirmedBy: 'user',
    now: options.now
  })
  task = await store.patchTask(task.id, {
    status: taskStatuses.runningChange,
    planGrant,
    confirmedAt: planGrant.confirmedAt,
    audit: [{
      phase: 'confirm',
      timestamp: planGrant.confirmedAt,
      code: null,
      preview: `User confirmed frozen transaction ${planGrant.digest}.`
    }]
  })
  if (typeof options.dispatch === 'function') await options.dispatch(transaction)
  return {
    accepted: true,
    cancelled: false,
    taskId: task.id,
    task,
    planGrant,
    transaction
  }
}

export async function settleRiskTransactionTask ({
  taskId,
  status,
  error,
  store: customStore,
  now
} = {}) {
  if (!taskId) return null
  const store = resolveStore(customStore)
  const current = await store.getTask(taskId)
  const failed = status === 'failed' || status === 'partially-completed'
  const cancelled = status === 'cancelled'
  const phase = cancelled ? 'cancel' : failed ? 'execute' : 'verify'
  return store.patchTask(taskId, {
    status: cancelled ? taskStatuses.cancelled : failed ? status : taskStatuses.completed,
    error: error ? String(error.message || error) : '',
    completedAt: timestamp(now),
    audit: [...(current?.audit || []), {
      phase,
      timestamp: timestamp(now),
      code: failed || cancelled ? null : 0,
      preview: cancelled
        ? 'Execution was cancelled before completion.'
        : failed
          ? String(error?.message || error || 'Execution failed')
          : 'Transaction completed.'
    }]
  })
}
