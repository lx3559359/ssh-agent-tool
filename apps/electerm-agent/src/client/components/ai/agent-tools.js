import { z } from '../../common/zod'
import { bookmarkSchemas } from '../../common/bookmark-schemas'

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

export const agentTools = [
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
      description: '通过 SFTP 删除远程文件或目录。',
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
]

export async function executeToolCall (toolName, args) {
  const store = window.store
  switch (toolName) {
    case 'send_terminal_command': {
      store.mcpSendTerminalCommand(args)
      const idleResult = await store.mcpWaitForTerminalIdle({
        tabId: args.tabId || store.activeTabId,
        timeout: 30000,
        lines: 100
      })
      return JSON.stringify(idleResult)
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
    case 'sftp_del':
      return JSON.stringify(await store.mcpSftpDel(args))
    case 'sftp_upload':
      return JSON.stringify(await store.mcpSftpUpload(args))
    case 'sftp_download':
      return JSON.stringify(await store.mcpSftpDownload(args))
    case 'sftp_transfer_list':
      return JSON.stringify(store.mcpSftpTransferList())
    case 'sftp_transfer_history':
      return JSON.stringify(store.mcpSftpTransferHistory())
    case 'get_terminal_status':
      return JSON.stringify(store.mcpGetTerminalStatus(args))
    case 'cancel_terminal_command':
      return JSON.stringify(store.mcpCancelTerminalCommand(args))
    case 'run_background_command':
      return JSON.stringify(store.mcpRunBackgroundCommand(args))
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
