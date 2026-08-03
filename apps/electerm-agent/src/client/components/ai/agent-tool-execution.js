import {
  isAgentCommandTool
} from './agent-tool-confirm'
import { runAgentTerminalCommand } from './agent-terminal-command.js'
import { executeAgentReadonlyCommand } from './agent-readonly-exec.js'
import { executeStructuredAgentTool } from './agent-structured-tools.js'
import {
  assertAgentRuntimeActive,
  bindAgentToolArgs,
  registerAgentCancellation,
  registerDeferredAgentCancellation,
  resolveAgentExecutionEndpoint
} from './agent-runtime-context.js'
import { executeAgentTool } from './agent-tool-gateway.js'
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
  shouldDelegateAgentSafetyConfirmation,
  validateDelegatedAgentSafetyPreparation
} from './agent-risk-delegation.js'
import {
  assertAgentRiskVerificationAllowed
} from './agent-risk-verification-gate.js'
import { prepareSelectedSkillArtifactCall } from './agent-skill-execution.js'
import {
  executeArtifactAgentTool,
  isArtifactAgentTool
} from './artifact-agent-tools.js'

function createAgentOperationId (prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function registerAgentTransferCancellation (runtime, transferPromise, tabId) {
  registerDeferredAgentCancellation(runtime, transferPromise, result => {
    if (!result?.transferId) return undefined
    return window.store.mcpSftpCancelTransfer({
      transferId: result.transferId,
      tabId
    })
  })
}

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

async function cancelPreparedRiskArtifacts (args, store = window.store) {
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

function beginPreparedRiskBatchCall (preparation) {
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

async function prepareResolvedAgentTool (toolName, args, runtime, context = {}) {
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

async function runTerminalTool (store, args, runtime, preparation) {
  let clearCancellation = () => {}
  try {
    return await runAgentTerminalCommand({
      store,
      args,
      signal: runtime.signal,
      riskDelegation: preparation?.safetyDelegationCapability,
      onDispatched: safetyResult => {
        const cancelTerminal = async () => {
          try {
            const result = await store.mcpCancelTerminalCommand({
              tabId: args.tabId,
              operationId: safetyResult.operationId
            })
            if (result?.stopConfirmed !== true) {
              const error = new Error(
                'Terminal stop could not be confirmed after Ctrl+C'
              )
              error.remoteState = result?.remoteState || 'unknown'
              error.canAutoRetry = false
              throw error
            }
            return result
          } catch (error) {
            error.remoteState = error.remoteState || 'unknown'
            error.canAutoRetry = false
            throw error
          }
        }
        clearCancellation = registerAgentCancellation(runtime, cancelTerminal)
      }
    })
  } finally {
    clearCancellation()
  }
}

export async function runReadonlyTool (args, endpoint, runtime = {}) {
  const resolveEndpoint = typeof runtime.resolveEndpoint === 'function'
    ? runtime.resolveEndpoint
    : () => endpoint
  return executeAgentReadonlyCommand({
    command: args.command,
    endpoint,
    resolveEndpoint,
    runtime
  })
}

function isTerminalSessionNavigationCommand (command) {
  return /^\s*(?:builtin\s+)?(?:cd|pushd|popd)(?:\s|$)/i.test(
    String(command || '')
  )
}

async function executeResolvedAgentTool (toolName, args, runtime, endpoint, preparation) {
  const store = window.store
  if (isArtifactAgentTool(toolName)) {
    return JSON.stringify(await executeArtifactAgentTool(
      toolName,
      args,
      runtime
    ))
  }
  switch (toolName) {
    case 'run_readonly_command':
      return JSON.stringify(await runReadonlyTool(args, endpoint, runtime))
    case 'read_service_status':
    case 'read_recent_logs':
    case 'verify_listening_port':
    case 'read_file_range':
      return JSON.stringify(await executeStructuredAgentTool({
        toolName,
        args,
        endpoint,
        signal: runtime.signal,
        resolveEndpoint: () => resolveAgentExecutionEndpoint({
          descriptor: getAgentToolDescriptor(toolName),
          runtime
        }),
        executeCommand: command => runReadonlyTool({
          command,
          tabId: args.tabId
        }, endpoint, runtime),
        readFile: fileArgs => store.mcpSftpReadFile(fileArgs, {
          signal: runtime.signal
        })
      }))
    case 'send_terminal_command': {
      if (!preparation && classifyAgentCall({ toolName, args }).outcome ===
        'allowlisted-readonly') {
        if (isTerminalSessionNavigationCommand(args.command)) {
          return JSON.stringify(await runTerminalTool(
            store,
            args,
            runtime,
            preparation
          ))
        }
        return JSON.stringify(await runReadonlyTool(args, endpoint, runtime))
      }
      return JSON.stringify(await runTerminalTool(
        store,
        args,
        runtime,
        preparation
      ))
    }
    case 'get_terminal_output':
      return JSON.stringify(store.mcpGetTerminalOutput(args))
    case 'open_local_terminal':
      return JSON.stringify(store.mcpOpenLocalTerminal())
    case 'list_tabs':
      return JSON.stringify(store.mcpListTabs())
    case 'get_active_tab':
      return JSON.stringify(store.mcpGetActiveTab())
    case 'switch_tab':
      return JSON.stringify(store.mcpSwitchTab(args))
    case 'close_tab':
      return JSON.stringify(store.mcpCloseTab(args))
    case 'list_bookmarks':
      return JSON.stringify(store.mcpListBookmarks())
    case 'open_bookmark':
      return JSON.stringify(store.mcpOpenBookmark(args))
    case 'add_bookmark': {
      const { type } = args
      const typeFields = args[type] || {}
      return JSON.stringify(await store.mcpAddBookmark({ type, ...typeFields }))
    }
    case 'open_tab': {
      const { type } = args
      const typeFields = args[type] || {}
      return JSON.stringify(store.mcpOpenTab({ type, ...typeFields }))
    }
    case 'sftp_list':
      return JSON.stringify(await store.mcpSftpList(args))
    case 'sftp_stat':
      return JSON.stringify(await store.mcpSftpStat(args))
    case 'sftp_read_file':
      return JSON.stringify(await store.mcpSftpReadFile(args))
    case 'sftp_del': {
      const result = await store.mcpSftpDel(args, { signal: runtime.signal })
      assertAgentRuntimeActive(runtime)
      return JSON.stringify(result)
    }
    case 'sftp_write_text': {
      const result = await store.mcpSftpWriteText(args, { signal: runtime.signal })
      assertAgentRuntimeActive(runtime)
      return JSON.stringify(result)
    }
    case 'sftp_write_text_batch': {
      const result = await store.mcpSftpWriteTextBatch(args, {
        signal: runtime.signal
      })
      assertAgentRuntimeActive(runtime)
      return JSON.stringify(result)
    }
    case 'sftp_upload': {
      const transfer = Promise.resolve(store.mcpSftpUpload(args, {
        signal: runtime.signal,
        onTerminal: createPreparedRiskTerminalHandler(preparation, endpoint, runtime)
      }))
      registerAgentTransferCancellation(runtime, transfer, args.tabId)
      let result
      try {
        result = await transfer
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        try {
          await cancelPreparedRiskArtifacts(args, store)
        } catch (cleanupError) {
          failure.cleanupError = cleanupError
          store.onError?.(cleanupError)
        }
        failure.mutationDispatched = false
        failure.remoteState = 'not-dispatched'
        throw failure
      }
      assertAgentRuntimeActive(runtime)
      return JSON.stringify(result)
    }
    case 'sftp_download': {
      const transfer = Promise.resolve(store.mcpSftpDownload(args, {
        signal: runtime.signal,
        onTerminal: createPreparedRiskTerminalHandler(preparation, endpoint, runtime)
      }))
      registerAgentTransferCancellation(runtime, transfer, args.tabId)
      const result = await transfer
      assertAgentRuntimeActive(runtime)
      return JSON.stringify(result)
    }
    case 'sftp_transfer_list':
      return JSON.stringify(store.mcpSftpTransferList(args))
    case 'sftp_transfer_history':
      return JSON.stringify(store.mcpSftpTransferHistory(args))
    case 'get_terminal_status':
      return JSON.stringify(store.mcpGetTerminalStatus(args))
    case 'cancel_terminal_command':
      return JSON.stringify(await store.mcpCancelTerminalCommand(args))
    case 'list_local_cli_tools':
      return JSON.stringify(await window.pre.runGlobalAsync('getAllowedLocalCliTools'))
    case 'get_codex_cli_status':
      return JSON.stringify(await window.pre.runGlobalAsync('getCodexCliStatus'))
    case 'run_local_cli': {
      const requestId = createAgentOperationId('local-cli')
      const clearCancellation = registerAgentCancellation(runtime, () => (
        window.pre.runGlobalAsync('cancelLocalCli', requestId)
      ))
      try {
        const result = await window.pre.runGlobalAsync('runLocalCli', {
          ...args,
          requestId
        })
        assertAgentRuntimeActive(runtime)
        return JSON.stringify(result)
      } finally {
        clearCancellation()
      }
    }
    case 'run_background_command': {
      const backgroundTask = Promise.resolve(store.mcpRunBackgroundCommand(args, {
        signal: runtime.signal,
        riskDelegation: preparation?.safetyDelegationCapability,
        onTerminal: createPreparedRiskTerminalHandler(preparation, endpoint, runtime)
      }))
      registerDeferredAgentCancellation(runtime, backgroundTask, result => {
        if (!result?.taskId) return undefined
        return (
          store.mcpCancelBackgroundTask({
            taskId: result.taskId,
            tabId: args.tabId
          })
        )
      })
      const result = await backgroundTask
      assertAgentRuntimeActive(runtime)
      return JSON.stringify(result)
    }
    case 'get_background_task_status':
      return JSON.stringify(await store.mcpGetBackgroundTaskStatus(args))
    case 'get_background_task_log':
      return JSON.stringify(await store.mcpGetBackgroundTaskLog(args))
    case 'cancel_background_task':
      return JSON.stringify(await store.mcpCancelBackgroundTask(args))
    default:
      throw new Error(`未知 Agent 工具：${toolName}`)
  }
}

const structuredVerificationTools = new Set(agentVerificationToolNames)

async function verifyPreparedAgentRisk (preparation, endpoint, runtime) {
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
      readFile: fileArgs => window.store.mcpSftpReadFile(fileArgs, {
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

function completePreparedAgentRisk (preparation, endpoint, runtime) {
  return completeAgentRiskPreparation({
    preparation,
    verify: () => verifyPreparedAgentRisk(preparation, endpoint, runtime),
    settle: settleRiskTransactionTask
  })
}

function createPreparedRiskTerminalHandler (preparation, endpoint, runtime) {
  if (!preparation?.riskTaskId &&
    preparation?.delegatedSafetyConfirmation !== true) return undefined
  return createAgentRiskTerminalHandler({
    preparation,
    verify: () => verifyPreparedAgentRisk(preparation, endpoint, runtime),
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

function parseToolResult (result) {
  try {
    return JSON.parse(result)
  } catch {
    return null
  }
}

export async function executeToolCall (
  toolName,
  rawArgs,
  runtime = {},
  controlledSkillCall,
  validatedCall
) {
  if (toolName === 'run_skill_artifact' && !controlledSkillCall) {
    const pseudoDescriptor = validatedCall?.descriptor || getAgentToolDescriptor(toolName)
    const args = validatedCall?.args === rawArgs
      ? rawArgs
      : bindAgentToolArgs(toolName, rawArgs, runtime)
    assertAgentRuntimeActive(runtime)
    const initialClassification = classifyAgentCall({
      descriptor: pseudoDescriptor,
      args
    })
    const riskContext = assertAgentRiskContextForCall({
      toolName,
      args,
      descriptor: pseudoDescriptor,
      classification: initialClassification
    })
    const endpoint = resolveAgentExecutionEndpoint({
      descriptor: pseudoDescriptor,
      runtime
    })
    const call = await prepareSelectedSkillArtifactCall({
      skillId: args.skillId,
      artifactId: args.artifactId,
      args: args.args,
      riskContext,
      skillBindings: runtime.selectedSkillBindings || [],
      endpoint
    })
    return executeToolCall(call.toolName, call.args, runtime, call)
  }
  const descriptor = validatedCall?.descriptor || getAgentToolDescriptor(toolName)
  const args = validatedCall?.args === rawArgs
    ? rawArgs
    : bindAgentToolArgs(toolName, rawArgs, runtime)
  const expandedContent = controlledSkillCall?.expandedContent ||
    args.script || args.expandedContent
  assertAgentRuntimeActive(runtime)
  const initialClassification = classifyAgentCall({
    descriptor,
    args,
    expandedContent,
    skillArtifact: controlledSkillCall?.skillArtifact,
    localExecution: controlledSkillCall?.localExecution
  })
  assertAgentRiskContextForCall({
    toolName,
    args,
    descriptor,
    classification: initialClassification,
    skillArtifact: controlledSkillCall?.skillArtifact
  })
  const currentEndpoint = resolveAgentExecutionEndpoint({
    descriptor,
    runtime
  })
  const endpoint = controlledSkillCall?.endpoint || currentEndpoint
  return executeAgentTool({
    toolName,
    args,
    descriptor,
    endpoint,
    resolveEndpoint: () => resolveAgentExecutionEndpoint({
      descriptor,
      runtime
    }),
    registry: runtime.takeoverRegistry,
    signal: runtime.signal,
    expandedContent,
    skillArtifact: controlledSkillCall?.skillArtifact,
    localExecution: controlledSkillCall?.localExecution,
    validateArtifact: controlledSkillCall?.validateArtifact,
    prepareRisky: context => prepareResolvedAgentTool(
      toolName,
      args,
      runtime,
      context
    ),
    validateDelegatedRisk: validateDelegatedAgentSafetyPreparation,
    invalidateRisky: async (error, preparation) => {
      try {
        await cancelPreparedRiskArtifacts(preparation?.confirmedArgs)
      } finally {
        await failAgentRiskPreparation({
          preparation,
          error,
          dispatched: false,
          settle: settleRiskTransactionTask
        })
      }
    },
    execute: async (verifiedEndpoint, preparation, executionContext = {}) => {
      try {
        const executionArgs = executionContext.validated?.args || args
        beginPreparedRiskBatchCall(preparation)
        const result = await executeResolvedAgentTool(
          toolName,
          executionArgs,
          runtime,
          verifiedEndpoint,
          preparation
        )
        if (preparation?.executionState) {
          preparation.executionState.result = result
        } else if (preparation) {
          preparation.executionResult = result
        }
        return result
      } catch (error) {
        try {
          await failAgentRiskPreparation({
            preparation,
            error,
            dispatched: error?.mutationDispatched !== false,
            settle: settleRiskTransactionTask
          })
        } catch (settleError) {
          window.store?.onError?.(settleError)
        }
        throw error
      }
    },
    verifyRisky: async (_result, verifiedEndpoint, preparation) => {
      const parsed = parseToolResult(
        preparation?.executionState?.result ?? preparation?.executionResult
      )
      if (parsed?.cancelled === true || parsed?.success === false) {
        await failAgentRiskPreparation({
          preparation,
          error: parsed.message,
          dispatched: parsed.cancelled !== true,
          status: parsed.cancelled ? 'cancelled' : 'partially-completed',
          remoteState: parsed.cancelled ? 'not-dispatched' : 'known-failed',
          settle: settleRiskTransactionTask
        })
        return { passed: false, cancelled: parsed.cancelled === true }
      }
      if (isAgentAsyncRiskResult(parsed)) {
        return { passed: true, pending: true }
      }
      try {
        return await completePreparedAgentRisk(preparation, verifiedEndpoint, runtime)
      } catch (error) {
        error.verificationFailed = true
        error.canAutoRetry = false
        throw error
      }
    }
  })
}
