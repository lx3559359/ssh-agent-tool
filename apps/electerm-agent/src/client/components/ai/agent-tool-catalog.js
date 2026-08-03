import { z } from '../../common/zod'
import { bookmarkSchemas } from '../../common/bookmark-schemas'
import { structuredAgentTools } from './agent-structured-tools.js'
import { withAgentToolScopes } from './agent-tool-scopes.js'
import { withAgentToolPolicy } from './agent-tool-policy.js'
import { allowedLocalCliTools } from './agent-local-cli-tools'
import {
  agentArtifactRiskContextSchema,
  agentRemoteRiskContextSchema,
  agentSessionControlRiskContextSchema
} from './agent-risk-delegation.js'
import { artifactAgentTools } from './artifact-agent-tools.js'

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

function withRequiredRiskContextParameters (parameters, riskContextSchema) {
  return {
    ...parameters,
    properties: {
      ...parameters.properties,
      riskContext: riskContextSchema
    },
    required: [...new Set([...(parameters.required || []), 'riskContext'])]
  }
}

export const agentTools = withAgentToolPolicy(withAgentToolScopes([
  ...structuredAgentTools,
  ...artifactAgentTools,
  {
    type: 'function',
    function: {
      name: 'run_readonly_command',
      description: '在当前 SSH 会话的独立 exec 通道运行一条静态、已允许的只读命令；无需用户确认，不写入交互终端。未知、动态、管道、后台或修改命令会被拒绝。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '单条静态只读命令'
          },
          tabId: {
            type: 'string',
            description: '由系统绑定当前接管会话'
          }
        },
        required: ['command'],
        additionalProperties: false
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
          },
          riskContext: agentRemoteRiskContextSchema
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
        properties: {
          riskContext: agentSessionControlRiskContextSchema
        },
        required: ['riskContext']
      }
    }
  },
  {
    type: 'function',
    scheduling: {
      parallelSafe: true,
      coalesce: true
    },
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
          },
          riskContext: agentSessionControlRiskContextSchema
        },
        required: ['tabId', 'riskContext']
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
          },
          riskContext: agentSessionControlRiskContextSchema
        },
        required: ['tabId', 'riskContext']
      }
    }
  },
  {
    type: 'function',
    scheduling: {
      parallelSafe: true,
      coalesce: true
    },
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
          },
          riskContext: agentSessionControlRiskContextSchema
        },
        required: ['id', 'riskContext']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_bookmark',
      description: '创建新书签。需要指定类型并提供该类型对应字段。支持类型：' + Object.keys(bookmarkSchemas).join(', ') + '。',
      parameters: withRequiredRiskContextParameters(
        buildAddBookmarkParameters(),
        agentSessionControlRiskContextSchema
      )
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_tab',
      description: '使用连接参数直接打开终端标签页，不创建书签。支持类型：' + Object.keys(bookmarkSchemas).join(', ') + '。',
      parameters: withRequiredRiskContextParameters(
        buildAddBookmarkParameters(),
        agentSessionControlRiskContextSchema
      )
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
            maximum: 32 * 1024,
            description: '本次最多读取的字节数，最大 32768。'
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
          },
          riskContext: agentRemoteRiskContextSchema
        },
        required: ['remotePath', 'riskContext']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sftp_write_text',
      description: '通过 SFTP 安全创建或修改远程文本文件。仅用于 UTF-8 文本和配置文件；执行时会显示一次确认，自动快照、写入校验并在安全操作中心提供回滚。不要使用 Shell 重定向或 HereDoc 写文件。',
      parameters: {
        type: 'object',
        properties: {
          remotePath: {
            type: 'string',
            description: '要创建或修改的远程文本文件绝对路径。'
          },
          content: {
            type: 'string',
            maxLength: 262144,
            description: '完整 UTF-8 文本内容，最大 256 KiB。'
          },
          mode: {
            type: 'integer',
            minimum: 0,
            maximum: 4095,
            description: '可选文件权限数字，例如 420 表示 0644。'
          },
          tabId: {
            type: 'string',
            description: 'SSH/FTP 标签页 ID。省略时由系统绑定当前接管会话。'
          },
          riskContext: agentRemoteRiskContextSchema
        },
        required: ['remotePath', 'content', 'riskContext']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sftp_write_text_batch',
      description: '通过 SFTP 统一审查并安全修改多个 UTF-8 文本文件。系统会在一个窗口中展示全部差异，执行前统一复核文件指纹，并为每个成功修改的文件保留独立回滚入口。修改两个或更多文件时必须优先使用此工具。',
      parameters: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            minItems: 2,
            maxItems: 50,
            items: {
              type: 'object',
              properties: {
                remotePath: {
                  type: 'string',
                  description: '远程文本文件的绝对路径。'
                },
                content: {
                  type: 'string',
                  maxLength: 262144,
                  description: '该文件修改后的完整 UTF-8 文本，最大 256 KiB。'
                },
                mode: {
                  type: 'integer',
                  minimum: 0,
                  maximum: 4095,
                  description: '可选文件权限，例如 420 表示 0644。'
                }
              },
              required: ['remotePath', 'content'],
              additionalProperties: false
            }
          },
          tabId: {
            type: 'string',
            description: '由系统绑定当前接管的 SSH/SFTP 会话。'
          },
          riskContext: agentRemoteRiskContextSchema
        },
        required: ['files', 'riskContext'],
        additionalProperties: false
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
          },
          riskContext: agentRemoteRiskContextSchema
        },
        required: ['localPath', 'remotePath', 'riskContext']
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
          },
          riskContext: agentRemoteRiskContextSchema
        },
        required: ['remotePath', 'localPath', 'riskContext']
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
          },
          riskContext: agentSessionControlRiskContextSchema
        },
        required: ['riskContext']
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
          },
          riskContext: agentSessionControlRiskContextSchema
        },
        required: ['tool', 'riskContext']
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
      name: 'run_skill_artifact',
      description: 'Run one declared script artifact from a Skill selected for this task. The system loads and digest-checks the file, applies its declared permissions, and routes the expanded content through the normal takeover and risk gateway.',
      parameters: {
        type: 'object',
        properties: {
          skillId: {
            type: 'string',
            description: 'Selected Skill ID shown in the selected Skill context.'
          },
          artifactId: {
            type: 'string',
            description: 'Declared script artifact ID shown in the selected Skill context.'
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Separate artifact arguments; never a shell command string.'
          },
          riskContext: agentArtifactRiskContextSchema
        },
        required: ['skillId', 'artifactId', 'riskContext']
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
          },
          riskContext: agentRemoteRiskContextSchema
        },
        required: ['command', 'riskContext']
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
          },
          riskContext: agentSessionControlRiskContextSchema
        },
        required: ['taskId', 'riskContext']
      }
    }
  }
]))

const sftpListTool = agentTools.find(tool => tool.function.name === 'sftp_list')
Object.assign(sftpListTool.function.parameters.properties, {
  cursor: {
    type: 'string',
    description: 'Continuation cursor returned by the previous page.'
  },
  limit: {
    type: 'number',
    description: 'Page item limit from 1 to 200; defaults to 100.'
  },
  maxBytes: {
    type: 'number',
    description: 'Page JSON byte limit; defaults to 24 KiB.'
  }
})

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
