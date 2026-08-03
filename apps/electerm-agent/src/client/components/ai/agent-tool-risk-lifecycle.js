import {
  isAgentCommandTool
} from './agent-tool-confirm'
import { executeStructuredAgentTool } from './agent-structured-tools.js'
import {
  assertAgentRuntimeActive,
  bindAgentToolArgs,
  resolveAgentExecutionEndpoint
} from './agent-runtime-context.js'
import { getAgentToolDescriptor } from './agent-tool-catalog.js'
import { classifyAgentCall } from './agent-tool-policy.js'
import { classifyCommand } from '../../common/safety-transactions/command-classifier.js'
import {
  buildRiskTransaction,
  canCombineRiskTransactions,
  combineRiskTransactions,
  confirmRiskTransaction,
  settleRiskTransactionTask
} from './agent-risk-transaction.js'
import { requestAgentRiskConfirmation } from './agent-risk-confirmation-modal.jsx'
import {
  assertAgentVerificationDeclared
} from './agent-risk-result.js'
import {
  completeAgentRiskPreparation,
  createAgentRiskTerminalHandler,
  failAgentRiskPreparation,
  isAgentAsyncRiskResult
} from './agent-risk-async.js'
import {
  agentRiskCallsRequireVerification,
  agentVerificationToolNames,
  assertAgentRiskContextForCall,
  assertAgentVerificationExpectation,
  createDelegatedAgentSafetyPreparation,
  shouldDelegateAgentSafetyConfirmation
} from './agent-risk-delegation.js'
import {
  assertAgentRiskVerificationAllowed
} from './agent-risk-verification-gate.js'

function recoveryFor (toolName, args) {
  if (toolName === 'sftp_upload' && args.preparedTransfer?.safetyOperationId) {
    return {
      type: 'sftp',
      verified: true,
      strategyVerified: true,
      operationId: args.preparedTransfer.safetyOperationId,
      limits: 'Exact target recovery was prepared and verified before this confirmation.'
    }
  }
  if (!isAgentCommandTool(toolName)) {
    return {
      type: toolName.startsWith('sftp_') ? 'sftp' : 'none',
      verified: false,
      strategyVerified: toolName === 'sftp_del',
      limits: 'The underlying safety provider determines exact rollback availability.'
    }
  }
  const classification = classifyCommand(
    toolName === 'run_local_cli'
      ? [args.tool, ...(args.args || [])].filter(Boolean).join(' ')
      : args.command
  )
  return {
    type: classification.provider || 'none',
    verified: false,
    strategyVerified: classification.reversible === true,
    limits: classification.reversible
      ? 'The underlying safety provider creates and verifies the exact recovery point before terminal release.'
      : 'No automatic rollback is promised; the operation is dispatched at most once.'
  }
}

function buildResolvedRiskTransaction (toolName, args, runtime, context = {}) {
  const recovery = recoveryFor(toolName, args)
  const riskContext = assertAgentRiskContextForCall({
    toolName,
    args,
    descriptor: context.descriptor,
    classification: context.classification,
    skillArtifact: context.skillArtifact
  })
  const artifactDigests = [
    ...(runtime.selectedSkillArtifactDigests || []),
    ...(toolName === 'sftp_upload' && args.sourceDescriptor?.digest
      ? [{
          type: 'local-transfer-source',
          path: args.localPath,
          digest: args.sourceDescriptor.digest,
          algorithm: args.sourceDescriptor.digestAlgorithm || 'unknown'
        }]
      : []),
    ...(context.skillArtifact?.fileDigest
      ? [{
          type: 'skill-artifact',
          id: `${context.skillArtifact.skillId}:${context.skillArtifact.id}`,
          path: context.skillArtifact.path,
          digest: context.skillArtifact.fileDigest,
          packageDigest: context.skillArtifact.packageDigest,
          algorithm: 'sha256'
        }]
      : [])
  ]
  return buildRiskTransaction([{
    name: toolName,
    args,
    descriptor: context.descriptor,
    expandedContent: context.expandedContent,
    skillArtifact: context.skillArtifact,
    localExecution: context.localExecution,
    scriptEntry: args.scriptEntry || null
  }], {
    endpoint: context.endpoint,
    goal: runtime.goal || `Agent ${toolName}`,
    purpose: riskContext.purpose,
    affectedObjects: riskContext.impactTargets,
    worstCase: context.classification?.reasonCode || 'unknown',
    resourceImpact: context.classification?.resourceImpact,
    disconnectPossible: /(?:network|firewall|restart|reboot|shutdown)/i.test(
      String(args.command || toolName)
    ),
    recovery,
    rollbackLimits: recovery.limits,
    verification: riskContext.verification,
    skillBindings: runtime.selectedSkillBindings || [],
    artifactDigests
  })
}

export async function prepareAgentRiskArgs (
  toolName,
  args,
  runtime,
  store = window.store,
  options = {}
) {
  if (toolName !== 'sftp_upload') return args
  assertAgentRuntimeActive(runtime)
  let prepared
  try {
    prepared = await store.mcpDescribeSftpUploadSource(args, {
      signal: runtime.signal,
      prepareRecovery: options.prepareRecovery !== false
    })
    assertAgentRuntimeActive(runtime)
    return {
      ...args,
      sourceDescriptor: prepared.sourceDescriptor,
      ...(prepared.preparedTransfer
        ? { preparedTransfer: prepared.preparedTransfer }
        : {})
    }
  } catch (error) {
    await cancelPreparedRiskArtifacts({
      preparedTransfer: prepared?.preparedTransfer
    }, store)
    throw error
  }
}

export async function cancelPreparedRiskArtifacts (args, store = window.store) {
  if (!args?.preparedTransfer?.safetyOperationId) return
  await store.mcpCancelPreparedSftpUpload(args.preparedTransfer)
}

function batchPreparationFor (runtime) {
  const batch = runtime.riskBatch
  if (!batch) return null
  if (batch.cancelledResult) {
    return { handled: true, result: JSON.stringify(batch.cancelledResult) }
  }
  if (batch.terminal === true) {
    const error = new Error('Agent risk batch is already terminal')
    error.code = 'AGENT_RISK_BATCH_TERMINAL'
    throw error
  }
  const riskCallIndex = batch.cursor
  if (riskCallIndex >= batch.transaction.calls.length) return null
  return {
    riskTransaction: batch.transaction,
    riskTaskId: batch.riskTaskId,
    riskPlanGrant: batch.riskPlanGrant,
    riskCallIndex,
    confirmedArgs: batch.transaction.calls[riskCallIndex].args,
    riskBatch: batch
  }
}

export function beginPreparedRiskBatchCall (preparation) {
  const batch = preparation?.riskBatch
  if (!batch) return false
  if (batch.terminal || batch.cursor !== preparation.riskCallIndex) {
    const error = new Error('Agent risk batch order changed before dispatch')
    error.code = 'PLAN_BINDING_CHANGED'
    throw error
  }
  batch.cursor += 1
  return true
}

export async function prepareAgentRiskBatch (toolCalls, runtime = {}) {
  if (runtime.riskBatch?.terminal === true) runtime.riskBatch = null
  if (!Array.isArray(toolCalls) || toolCalls.length < 2 ||
    toolCalls.some(call => call?.name === 'run_skill_artifact')) {
    return null
  }
  const transactions = []
  for (const toolCall of toolCalls) {
    const toolName = String(toolCall?.name || '')
    const boundArgs = toolCall?.args
    const descriptor = toolCall?.descriptor
    if (!toolName || !boundArgs || !descriptor) continue
    const endpoint = resolveAgentExecutionEndpoint({ descriptor, runtime })
    const expandedContent = boundArgs.script || boundArgs.expandedContent
    const classification = classifyAgentCall({
      descriptor,
      args: boundArgs,
      expandedContent
    })
    assertAgentRiskContextForCall({
      toolName,
      args: boundArgs,
      descriptor,
      classification
    })
    if (classification.outcome !== 'risky') continue
    const args = await prepareAgentRiskArgs(
      toolName,
      boundArgs,
      runtime,
      window.store,
      { prepareRecovery: false }
    )
    if (shouldDelegateAgentSafetyConfirmation(toolName, args, { endpoint })) {
      return null
    }
    transactions.push(buildResolvedRiskTransaction(
      toolName,
      args,
      runtime,
      { descriptor, endpoint, expandedContent, classification }
    ))
  }
  if (transactions.length < 2 ||
    transactions.some(item => item.calls.some(call => call.name === 'sftp_upload')) ||
    !transactions.slice(1).every(item => (
      canCombineRiskTransactions(transactions[0], item)
    ))) {
    return null
  }
  const transaction = combineRiskTransactions(transactions)
  let confirmation
  try {
    confirmation = await confirmRiskTransaction(transaction, {
      confirm: frozen => requestAgentRiskConfirmation(frozen, {
        signal: runtime.signal
      })
    })
    assertAgentRuntimeActive(runtime)
  } catch (error) {
    if (confirmation?.accepted && confirmation.taskId) {
      await failAgentRiskPreparation({
        preparation: {
          riskTaskId: confirmation.taskId,
          riskTransaction: transaction
        },
        error,
        dispatched: false,
        status: error?.name === 'AbortError' ? 'cancelled' : 'failed',
        remoteState: 'not-dispatched',
        settle: settleRiskTransactionTask
      })
    }
    throw error
  }
  runtime.riskBatch = confirmation.accepted
    ? {
        transaction,
        riskTaskId: confirmation.taskId,
        riskPlanGrant: confirmation.planGrant,
        cursor: 0,
        completedCalls: new Set(),
        settling: null,
        terminal: false
      }
    : { cancelledResult: confirmation, terminal: true }
  return confirmation
}

export async function prepareResolvedAgentTool (toolName, args, runtime, context = {}) {
  assertAgentRiskContextForCall({
    toolName,
    args,
    descriptor: context.descriptor,
    classification: context.classification,
    skillArtifact: context.skillArtifact
  })
  const batchPreparation = batchPreparationFor(runtime)
  if (batchPreparation) return batchPreparation
  if (shouldDelegateAgentSafetyConfirmation(toolName, args, {
    endpoint: context.endpoint
  })) {
    return createDelegatedAgentSafetyPreparation(toolName, args, {
      endpoint: context.endpoint,
      verification: args.riskContext.verification,
      classification: context.classification
    })
  }
  const confirmedArgs = await prepareAgentRiskArgs(toolName, args, runtime)
  const transaction = buildResolvedRiskTransaction(
    toolName,
    confirmedArgs,
    runtime,
    context
  )
  let confirmation
  try {
    confirmation = await confirmRiskTransaction(transaction, {
      confirm: frozen => requestAgentRiskConfirmation(frozen, {
        signal: runtime.signal
      })
    })
    assertAgentRuntimeActive(runtime)
  } catch (error) {
    if (confirmation?.accepted && confirmation.taskId) {
      await failAgentRiskPreparation({
        preparation: {
          riskTaskId: confirmation.taskId,
          riskTransaction: transaction
        },
        error,
        dispatched: false,
        status: error?.name === 'AbortError' ? 'cancelled' : 'failed',
        remoteState: 'not-dispatched',
        settle: settleRiskTransactionTask
      })
    }
    await cancelPreparedRiskArtifacts(confirmedArgs)
    throw error
  }
  if (!confirmation.accepted) await cancelPreparedRiskArtifacts(confirmedArgs)
  return confirmation.accepted
    ? {
        riskTransaction: transaction,
        riskTaskId: confirmation.taskId,
        riskPlanGrant: confirmation.planGrant,
        confirmedArgs
      }
    : { handled: true, result: JSON.stringify(confirmation) }
}

const structuredVerificationTools = new Set(agentVerificationToolNames)

async function verifyPreparedAgentRisk (preparation, endpoint, runtime, services = {}) {
  const runReadonlyTool = services.runReadonlyTool
  const store = services.store || window.store
  if (typeof runReadonlyTool !== 'function') {
    throw new TypeError('Agent risk verification requires a readonly executor')
  }
  const verification = preparation?.riskTransaction?.verification ||
    preparation?.verification || []
  if (agentRiskCallsRequireVerification(preparation?.riskTransaction?.calls)) {
    assertAgentVerificationDeclared(verification)
  }
  for (const step of verification) {
    if (!structuredVerificationTools.has(step?.name)) {
      const error = new Error(`Unsupported Agent verification tool: ${String(step?.name)}`)
      error.code = 'AGENT_TARGET_VERIFICATION_FAILED'
      error.verificationFailed = true
      throw error
    }
    const descriptor = getAgentToolDescriptor(step.name)
    const verificationEndpoint = assertAgentRiskVerificationAllowed({
      expectedEndpoint: endpoint,
      runtime,
      descriptor
    })
    const args = bindAgentToolArgs(step.name, step.args || {}, runtime)
    const result = await executeStructuredAgentTool({
      toolName: step.name,
      args,
      endpoint: verificationEndpoint,
      signal: runtime.signal,
      resolveEndpoint: () => assertAgentRiskVerificationAllowed({
        expectedEndpoint: endpoint,
        runtime,
        descriptor
      }),
      executeCommand: command => runReadonlyTool({
        command,
        tabId: args.tabId
      }, verificationEndpoint, runtime),
      readFile: fileArgs => store.mcpSftpReadFile(fileArgs, {
        signal: runtime.signal
      })
    })
    assertAgentRiskVerificationAllowed({
      expectedEndpoint: endpoint,
      runtime,
      descriptor
    })
    try {
      assertAgentVerificationExpectation(step, result)
    } catch (error) {
      error.code = 'AGENT_TARGET_VERIFICATION_FAILED'
      error.verificationFailed = true
      throw error
    }
    assertAgentRuntimeActive(runtime)
  }
  return verification.length > 0
    ? { passed: true, count: verification.length, status: 'verified' }
    : { passed: true, count: 0, status: 'not-applicable' }
}

export function completePreparedAgentRisk (preparation, endpoint, runtime, services = {}) {
  return completeAgentRiskPreparation({
    preparation,
    verify: () => verifyPreparedAgentRisk(preparation, endpoint, runtime, services),
    settle: settleRiskTransactionTask
  })
}

export function createPreparedRiskTerminalHandler (preparation, endpoint, runtime, services = {}) {
  if (!preparation?.riskTaskId &&
    preparation?.delegatedSafetyConfirmation !== true) return undefined
  return createAgentRiskTerminalHandler({
    preparation,
    verify: () => verifyPreparedAgentRisk(preparation, endpoint, runtime, services),
    settle: settleRiskTransactionTask
  })
}

export async function failAgentRiskBatch (runtime, error, call = {}) {
  const batch = runtime?.riskBatch
  if (!batch || batch.terminal === true || batch.cancelledResult) return null
  const nextCall = batch.transaction?.calls?.[batch.cursor]
  if (call.toolName && nextCall?.name !== call.toolName) return null
  const dispatched = batch.cursor > 0
  return failAgentRiskPreparation({
    preparation: {
      riskTaskId: batch.riskTaskId,
      riskTransaction: batch.transaction,
      riskBatch: batch,
      riskCallIndex: batch.cursor
    },
    error,
    dispatched,
    status: error?.name === 'AbortError' && !dispatched
      ? 'cancelled'
      : undefined,
    settle: settleRiskTransactionTask
  })
}

export function failPreparedAgentRisk (preparation, error, options = {}) {
  return failAgentRiskPreparation({
    preparation,
    error,
    ...options,
    settle: settleRiskTransactionTask
  })
}

export function isPendingAgentRiskResult (result) {
  return isAgentAsyncRiskResult(result)
}
