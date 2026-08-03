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
import {
  beginPreparedRiskBatchCall,
  cancelPreparedRiskArtifacts,
  completePreparedAgentRisk,
  createPreparedRiskTerminalHandler,
  failPreparedAgentRisk,
  isPendingAgentRiskResult,
  prepareResolvedAgentTool
} from './agent-tool-risk-lifecycle.js'
import {
  assertAgentRiskContextForCall,
  validateDelegatedAgentSafetyPreparation
} from './agent-risk-delegation.js'
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

function riskLifecycleServices (store = window.store) {
  return { store, runReadonlyTool }
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
        onTerminal: createPreparedRiskTerminalHandler(
          preparation,
          endpoint,
          runtime,
          riskLifecycleServices(store)
        )
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
        onTerminal: createPreparedRiskTerminalHandler(
          preparation,
          endpoint,
          runtime,
          riskLifecycleServices(store)
        )
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
        onTerminal: createPreparedRiskTerminalHandler(
          preparation,
          endpoint,
          runtime,
          riskLifecycleServices(store)
        )
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
        await failPreparedAgentRisk(preparation, error, {
          dispatched: false
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
          await failPreparedAgentRisk(preparation, error, {
            dispatched: error?.mutationDispatched !== false
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
        await failPreparedAgentRisk(preparation, parsed.message, {
          dispatched: parsed.cancelled !== true,
          status: parsed.cancelled ? 'cancelled' : 'partially-completed',
          remoteState: parsed.cancelled ? 'not-dispatched' : 'known-failed'
        })
        return { passed: false, cancelled: parsed.cancelled === true }
      }
      if (isPendingAgentRiskResult(parsed)) {
        return { passed: true, pending: true }
      }
      try {
        return await completePreparedAgentRisk(
          preparation,
          verifiedEndpoint,
          runtime,
          riskLifecycleServices()
        )
      } catch (error) {
        error.verificationFailed = true
        error.canAutoRetry = false
        throw error
      }
    }
  })
}
