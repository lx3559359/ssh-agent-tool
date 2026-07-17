import { z } from '../../common/zod'
import { bookmarkSchemas } from '../../common/bookmark-schemas'
import {
  isAgentCommandTool
} from './agent-tool-confirm'
import { runAgentTerminalCommand } from './agent-terminal-command.js'
import {
  executeStructuredAgentTool,
  structuredAgentTools
} from './agent-structured-tools.js'
import {
  assertAgentRuntimeActive,
  bindAgentToolArgs,
  registerAgentCancellation,
  registerDeferredAgentCancellation,
  resolveAgentExecutionEndpoint
} from './agent-runtime-context.js'
import { executeAgentTool } from './agent-tool-gateway.js'
import { withAgentToolScopes } from './agent-tool-scopes.js'
import { withAgentToolPolicy } from './agent-tool-policy.js'
import {
  confirmAgentPlan,
  ensureAgentPlanConfirmed,
  markAgentPlanConfirmed
} from './agent-task-mode.js'
import {
  allowedLocalCliTools
} from './agent-local-cli-tools'
import { classifyCommand } from '../../common/safety-transactions/command-classifier.js'
import {
  buildRiskTransaction,
  confirmRiskTransaction,
  settleRiskTransactionTask
} from './agent-risk-transaction.js'
import { requestAgentRiskConfirmation } from './agent-risk-confirmation-modal.jsx'

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

function buildAddBookmarkParameters () {
  const typeProperties = {}
  for (const [type, schema] of Object.entries(bookmarkSchemas)) {
    typeProperties[type] = z.toJSONSchema(z.object(schema))
  }

  return {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: Object.keys(bookmarkSchemas),
        description: '书签类型'
      },
      ...Object.fromEntries(
        Object.entries(typeProperties).map(([type, schema]) => [
          type,
          { type: 'object', description: `${type} 书签字段`, ...schema }
        ])
      )
    },
    required: ['type']
  }
}

export const agentTools = withAgentToolPolicy(withAgentToolScopes([
  ...structuredAgentTools,
  {
    type: 'function',
    function: {
      name: 'confirm_agent_plan',
      description: '向用户提交 Agent 分析计划。计划确认前不得执行终端命令、本机 CLI 或后台命令。',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: '本次排查或操作目标'
          },
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: '计划步骤'
          },
          readonlyCommands: {
            type: 'array',
            items: { type: 'string' },
            description: '计划执行的只读命令列表'
          }
        },
        required: ['goal']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_terminal_command',
      description: '向终端标签页发送命令并等待执行结束，返回命令输出。构建、部署、安装等长时间运行命令请改用 run_background_command，避免超时。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的 Shell 命令'
          },
          tabId: {
            type: 'string',
            description: '终端标签页 ID。省略时使用当前活动终端。'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_terminal_output',
      description: '读取终端当前可见输出。',
      parameters: {
        type: 'object',
        properties: {
          tabId: {
            type: 'string',
            description: '终端标签页 ID。省略时使用当前活动终端。'
          },
          lines: {
            type: 'number',
            description: '读取最近多少行，默认 50 行。'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_local_terminal',
      description: '打开新的本地终端标签页，返回新标签页 ID。',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_tabs',
      description: '列出所有已打开终端标签页，包括 ID、标题、主机和类型。',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_active_tab',
      description: '获取当前活动终端标签页。',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'switch_tab',
      description: '切换到指定终端标签页。',
      parameters: {
        type: 'object',
        properties: {
          tabId: {
            type: 'string',
            description: '要切换到的标签页 ID。'
          }
        },
        required: ['tabId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'close_tab',
      description: '按 ID 关闭终端标签页。任务结束后可用它清理不需要的标签页。',
      parameters: {
        type: 'object',
        properties: {
          tabId: {
            type: 'string',
            description: '要关闭的标签页 ID。'
          }
        },
        required: ['tabId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_bookmarks',
      description: '列出所有已保存书签，包括 SSH、Telnet、VNC 等。',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_bookmark',
      description: '以新的终端标签页打开已保存书签。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '要打开的书签 ID。'
          }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_bookmark',
      description: '创建新书签。需要指定类型并提供该类型对应字段。支持类型：' + Object.keys(bookmarkSchemas).join(', ') + '。',
      parameters: buildAddBookmarkParameters()
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_tab',
      description: '使用连接参数直接打开终端标签页，不创建书签。支持类型：' + Object.keys(bookmarkSchemas).join(', ') + '。',
      parameters: buildAddBookmarkParameters()
    }
  },
  {
    type: 'function',
    function: {
      name: 'sftp_list',
      description: '通过 SFTP 列出远程路径下的文件和目录，需要 SSH/FTP 标签页。',
      parameters: {
        type: 'object',
        properties: {
          remotePath: {
            type: 'string',
            description: '要列出的远程目录路径。'
          },
          tabId: {
            type: 'string',
            description: 'SSH/FTP 标签页 ID。省略时使用当前活动标签页。'
          }
        },
        required: ['remotePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sftp_stat',
      description: '通过 SFTP 获取远程文件或目录信息，包括大小、权限等。',
      parameters: {
        type: 'object',
        properties: {
          remotePath: {
            type: 'string',
            description: '要读取信息的远程路径。'
          },
          tabId: {
            type: 'string',
            description: 'SSH/FTP 标签页 ID。省略时使用当前活动标签页。'
          }
        },
        required: ['remotePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sftp_read_file',
      description: '通过 SFTP 读取远程文件内容。',
      parameters: {
        type: 'object',
        properties: {
          remotePath: {
            type: 'string',
            description: '要读取的远程文件路径。'
          },
          tabId: {
            type: 'string',
            description: 'SSH/FTP 标签页 ID。省略时使用当前活动标签页。'
          },
          offset: {
            type: 'integer',
            minimum: 0,
            description: '续读起始字节。首次读取填 0，后续使用上次返回的 nextOffset。'
          },
          maxBytes: {
            type: 'integer',
            minimum: 4,
            maximum: 64 * 1024,
            description: '本次最多读取的字节数，最大 65536。'
          }
        },
        required: ['remotePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sftp_del',
      description: '通过 SFTP 安全删除远程文件或目录。执行前必须由用户确认，内容会移入安全回收区并可在安全操作中心恢复。',
      parameters: {
        type: 'object',
        properties: {
          remotePath: {
            type: 'string',
            description: '要删除的远程文件或目录路径。'
          },
          tabId: {
            type: 'string',
            description: 'SSH/FTP 标签页 ID。省略时使用当前活动标签页。'
          }
        },
        required: ['remotePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sftp_upload',
      description: '通过 SFTP 上传本地文件到远程服务器。',
      parameters: {
        type: 'object',
        properties: {
          localPath: {
            type: 'string',
            description: '要上传的本地文件路径。'
          },
          remotePath: {
            type: 'string',
            description: '远程目标路径。'
          },
          tabId: {
            type: 'string',
            description: 'SSH/FTP 标签页 ID。省略时使用当前活动标签页。'
          }
        },
        required: ['localPath', 'remotePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sftp_download',
      description: '通过 SFTP 下载远程文件到本地路径。',
      parameters: {
        type: 'object',
        properties: {
          remotePath: {
            type: 'string',
            description: '要下载的远程文件路径。'
          },
          localPath: {
            type: 'string',
            description: '本地目标路径。'
          },
          tabId: {
            type: 'string',
            description: 'SSH/FTP 标签页 ID。省略时使用当前活动标签页。'
          }
        },
        required: ['remotePath', 'localPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sftp_transfer_list',
      description: '列出当前正在进行的 SFTP 文件传输任务。',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sftp_transfer_history',
      description: '列出历史 SFTP 文件传输记录。',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_terminal_status',
      description: '检查终端状态：运行中、空闲或密码提示。返回最近 20 行输出，轻量且非阻塞。',
      parameters: {
        type: 'object',
        properties: {
          tabId: {
            type: 'string',
            description: '标签页 ID。省略时使用当前活动终端。'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cancel_terminal_command',
      description: '向终端发送 Ctrl+C，取消正在运行的命令。',
      parameters: {
        type: 'object',
        properties: {
          tabId: {
            type: 'string',
            description: '标签页 ID。省略时使用当前活动终端。'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_local_cli',
      description: '在本机受控执行白名单 CLI 工具。执行前必须由用户确认；不要请求 powershell/cmd 这类通用 shell。',
      parameters: {
        type: 'object',
        properties: {
          tool: {
            type: 'string',
            enum: allowedLocalCliTools,
            description: '要执行的本机 CLI 工具'
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'CLI 参数数组；不要拼接成一整条 shell 字符串'
          },
          cwd: {
            type: 'string',
            description: '可选工作目录'
          },
          timeoutMs: {
            type: 'number',
            description: '可选超时时间，单位毫秒'
          }
        },
        required: ['tool']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_local_cli_tools',
      description: '列出 Agent 当前允许调用的本机 CLI 白名单。该工具只读取能力清单，不执行命令，不需要用户确认。',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_codex_cli_status',
      description: '只读检测本机 Codex CLI 是否安装、是否可执行，以及是否可以复用官方 CLI 登录态。不会读取或保存账号凭据，不执行任务命令。',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_background_command',
      description: '使用 nohup 在后台运行命令，终端会立即释放。返回 taskId 以便监控，可用 get_background_task_status 和 get_background_task_log 查看进度。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要在后台运行的 Shell 命令。'
          },
          tabId: {
            type: 'string',
            description: '标签页 ID。省略时使用当前活动终端。'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_background_task_status',
      description: '检查后台任务状态：运行中、已完成（含退出码）或未知。',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'run_background_command 返回的任务 ID。'
          }
        },
        required: ['taskId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_background_task_log',
      description: '读取后台任务输出日志，返回最近 N 行。',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'run_background_command 返回的任务 ID。'
          },
          lines: {
            type: 'number',
            description: '读取最近多少行，默认 100 行。'
          }
        },
        required: ['taskId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cancel_background_task',
      description: '通过结束进程取消正在运行的后台任务。',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'run_background_command 返回的任务 ID。'
          }
        },
        required: ['taskId']
      }
    }
  }
]))

const agentToolDescriptors = new Map(
  agentTools.map(descriptor => [descriptor.function.name, descriptor])
)

export function getAgentToolDescriptor (toolName) {
  const descriptor = agentToolDescriptors.get(String(toolName || ''))
  if (!descriptor) {
    const error = new Error(`Unknown Agent tool: ${String(toolName)}`)
    error.code = 'UNKNOWN_AGENT_TOOL'
    throw error
  }
  return descriptor
}

function affectedObjectsFor (toolName, args, runtime) {
  const planned = runtime.planGrant?.payload?.impactTargets
  if (Array.isArray(planned) && planned.length) return planned
  return [
    args.remotePath && `remote-path:${args.remotePath}`,
    args.localPath && `local-path:${args.localPath}`,
    args.taskId && `background-task:${args.taskId}`,
    args.tabId && `session:${args.tabId}`,
    toolName
  ].filter(Boolean)
}

function recoveryFor (toolName, args) {
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

async function prepareResolvedAgentTool (toolName, args, runtime, context = {}) {
  if (isAgentCommandTool(toolName)) {
    const planGuard = await ensureAgentPlanConfirmed({ toolName, args, runtime })
    if (planGuard) {
      return { handled: true, result: JSON.stringify(planGuard) }
    }
  }
  const recovery = recoveryFor(toolName, args)
  const transaction = buildRiskTransaction([{
    name: toolName,
    args,
    descriptor: context.descriptor,
    expandedContent: context.expandedContent,
    scriptEntry: args.scriptEntry || null
  }], {
    endpoint: context.endpoint,
    goal: runtime.planGrant?.payload?.goal || `Agent ${toolName}`,
    purpose: runtime.planGrant?.payload?.goal || `Execute ${toolName}`,
    affectedObjects: affectedObjectsFor(toolName, args, runtime),
    worstCase: context.classification?.reasonCode || 'unknown',
    resourceImpact: context.classification?.resourceImpact,
    disconnectPossible: /(?:network|firewall|restart|reboot|shutdown)/i.test(
      String(args.command || toolName)
    ),
    recovery,
    rollbackLimits: recovery.limits,
    verification: runtime.planGrant?.payload?.verification || [],
    skillBindings: runtime.planGrant?.payload?.skillBindings || [],
    artifactDigests: runtime.planGrant?.payload?.artifactDigests || []
  })
  const confirmation = await confirmRiskTransaction(transaction, {
    confirm: frozen => requestAgentRiskConfirmation(frozen, {
      signal: runtime.signal
    })
  })
  assertAgentRuntimeActive(runtime)
  return confirmation.accepted
    ? {
        riskTransaction: transaction,
        riskTaskId: confirmation.taskId,
        riskPlanGrant: confirmation.planGrant
      }
    : { handled: true, result: JSON.stringify(confirmation) }
}

async function runTerminalTool (store, args, runtime) {
  const cancelTerminal = () => {
    try {
      return store.mcpCancelTerminalCommand({ tabId: args.tabId })
    } catch (error) {
      // The terminal may already be idle or closed.
      return undefined
    }
  }
  runtime.cancelActiveTool = cancelTerminal
  try {
    return await runAgentTerminalCommand({
      store,
      args,
      signal: runtime.signal
    })
  } finally {
    if (runtime.cancelActiveTool === cancelTerminal) {
      runtime.cancelActiveTool = null
    }
  }
}

async function executeResolvedAgentTool (toolName, args, runtime, endpoint) {
  const store = window.store
  switch (toolName) {
    case 'confirm_agent_plan': {
      const confirmation = await confirmAgentPlan({
        args,
        signal: runtime.signal,
        endpoint: (typeof runtime.resolveEndpoint === 'function'
          ? runtime.resolveEndpoint()
          : runtime.endpoint) || {}
      })
      assertAgentRuntimeActive(runtime)
      markAgentPlanConfirmed(runtime, confirmation)
      return JSON.stringify(confirmation)
    }
    case 'read_service_status':
    case 'read_recent_logs':
    case 'verify_listening_port':
    case 'read_file_range':
      return JSON.stringify(await executeStructuredAgentTool({
        toolName,
        args,
        endpoint,
        executeCommand: command => runTerminalTool(store, {
          command,
          tabId: args.tabId
        }, runtime),
        readFile: fileArgs => store.mcpSftpReadFile(fileArgs)
      }))
    case 'send_terminal_command':
      return JSON.stringify(await runTerminalTool(store, args, runtime))
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
    case 'sftp_upload': {
      const transfer = Promise.resolve(store.mcpSftpUpload(args))
      registerAgentTransferCancellation(runtime, transfer, args.tabId)
      const result = await transfer
      assertAgentRuntimeActive(runtime)
      return JSON.stringify(result)
    }
    case 'sftp_download': {
      const transfer = Promise.resolve(store.mcpSftpDownload(args))
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
      return JSON.stringify(store.mcpCancelTerminalCommand(args))
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
      const backgroundTask = Promise.resolve(store.mcpRunBackgroundCommand(args))
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

const structuredVerificationTools = new Set([
  'read_service_status',
  'read_recent_logs',
  'verify_listening_port',
  'read_file_range'
])

function assertVerificationExpectation (step, result) {
  const expected = step.expected || step.expect
  if (result.exitCode !== null && result.exitCode !== 0) {
    throw new Error(`Verification ${step.name} returned exit code ${result.exitCode}`)
  }
  if (!expected) return
  if (expected.exitCode !== undefined && result.exitCode !== expected.exitCode) {
    throw new Error(`Verification ${step.name} exit code did not match`)
  }
  if (expected.contains !== undefined &&
    !result.output.includes(String(expected.contains))) {
    throw new Error(`Verification ${step.name} output did not contain expected text`)
  }
  if (expected.notContains !== undefined &&
    result.output.includes(String(expected.notContains))) {
    throw new Error(`Verification ${step.name} output contained forbidden text`)
  }
}

async function verifyPreparedAgentRisk (preparation, endpoint, runtime) {
  const verification = preparation?.riskTransaction?.verification || []
  for (const step of verification) {
    if (!structuredVerificationTools.has(step?.name)) {
      const error = new Error(`Unsupported Agent verification tool: ${String(step?.name)}`)
      error.code = 'AGENT_TARGET_VERIFICATION_FAILED'
      error.verificationFailed = true
      throw error
    }
    const args = bindAgentToolArgs(step.name, step.args || {}, runtime)
    const result = await executeStructuredAgentTool({
      toolName: step.name,
      args,
      endpoint,
      executeCommand: command => runTerminalTool(window.store, {
        command,
        tabId: args.tabId
      }, runtime),
      readFile: fileArgs => window.store.mcpSftpReadFile(fileArgs)
    })
    try {
      assertVerificationExpectation(step, result)
    } catch (error) {
      error.code = 'AGENT_TARGET_VERIFICATION_FAILED'
      error.verificationFailed = true
      throw error
    }
    assertAgentRuntimeActive(runtime)
  }
  return { passed: true, count: verification.length }
}

function parseToolResult (result) {
  try {
    return JSON.parse(result)
  } catch {
    return null
  }
}

export async function executeToolCall (toolName, rawArgs, runtime = {}) {
  const descriptor = getAgentToolDescriptor(toolName)
  const args = bindAgentToolArgs(toolName, rawArgs, runtime)
  assertAgentRuntimeActive(runtime)
  const endpoint = resolveAgentExecutionEndpoint({
    descriptor,
    runtime
  })
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
    expandedContent: args.script || args.expandedContent,
    prepareRisky: context => prepareResolvedAgentTool(
      toolName,
      args,
      runtime,
      context
    ),
    execute: async (verifiedEndpoint, preparation) => {
      try {
        const result = await executeResolvedAgentTool(
          toolName,
          args,
          runtime,
          verifiedEndpoint
        )
        if (preparation) preparation.executionResult = result
        return result
      } catch (error) {
        if (preparation?.riskTaskId) {
          try {
            await settleRiskTransactionTask({
              taskId: preparation.riskTaskId,
              status: 'partially-completed',
              error,
              remoteState: 'unknown',
              canAutoRetry: false
            })
          } catch (settleError) {
            window.store?.onError?.(settleError)
          }
        }
        throw error
      }
    },
    verifyRisky: async (_result, verifiedEndpoint, preparation) => {
      const parsed = parseToolResult(preparation?.executionResult)
      if (parsed?.cancelled === true || parsed?.success === false) {
        if (preparation?.riskTaskId) {
          await settleRiskTransactionTask({
            taskId: preparation.riskTaskId,
            status: parsed.cancelled ? 'cancelled' : 'failed',
            error: parsed.message,
            remoteState: parsed.cancelled ? 'not-dispatched' : 'known-failed',
            canAutoRetry: false
          })
        }
        return { passed: false, cancelled: parsed.cancelled === true }
      }
      try {
        const verification = await verifyPreparedAgentRisk(
          preparation,
          verifiedEndpoint,
          runtime
        )
        if (preparation?.riskTaskId) {
          await settleRiskTransactionTask({
            taskId: preparation.riskTaskId,
            status: 'completed',
            remoteState: 'verified',
            canAutoRetry: false
          })
        }
        return verification
      } catch (error) {
        if (preparation?.riskTaskId) {
          try {
            await settleRiskTransactionTask({
              taskId: preparation.riskTaskId,
              status: 'partially-completed',
              error,
              remoteState: 'changed-unverified',
              canAutoRetry: false
            })
          } catch (settleError) {
            window.store?.onError?.(settleError)
          }
        }
        error.verificationFailed = true
        error.canAutoRetry = false
        throw error
      }
    }
  })
}
