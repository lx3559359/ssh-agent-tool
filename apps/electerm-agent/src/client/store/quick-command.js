/**
 * quick command related functions
 */

import {
  settingMap,
  qmSortByFrequencyKey,
  isWin
} from '../common/constants'
import delay from '../common/wait'
import generate from '../common/uid'
import * as ls from '../common/safe-local-storage'
import { debounce } from 'lodash-es'
import { refs } from '../components/common/ref'
import templates from '../components/quick-commands/templates'
import { readClipboardAsync } from '../common/clipboard'
import {
  runSafetyCommandBatch,
  runSafetyCommandSequence
} from '../common/safety-transactions/command-orchestration.js'

async function parseTemplates (cmd) {
  if (!cmd.includes('{{')) return cmd

  for (const template of templates) {
    const placeholder = `{{${template}}}`
    if (cmd.includes(placeholder)) {
      let replacement = ''

      if (template === 'clipboard') {
        replacement = await readClipboardAsync()
      } else if (template === 'time') {
        replacement = Date.now()
      } else if (template === 'date') {
        replacement = new Date().toLocaleDateString()
      }

      cmd = cmd.replaceAll(placeholder, replacement)
    }
  }

  return cmd
}

function normalizeCommandForShell (command) {
  return isWin
    ? command.replace(/\n/g, '\n\r')
    : command
}

function getQuickCommandSteps (qm, options) {
  if (options.commandText) {
    return [
      {
        command: options.commandText,
        id: generate(),
        delay: 100
      }
    ]
  }
  if (qm?.commands) {
    return qm.commands
  }
  if (qm?.command) {
    return [
      {
        command: qm.command,
        id: generate(),
        delay: 100
      }
    ]
  }
  return []
}

export default Store => {
  Store.prototype.addQuickCommand = function (
    qm
  ) {
    window.store.addItem(qm, settingMap.quickCommands)
  }

  Store.prototype.editQuickCommand = function (id, update) {
    window.store.editItem(id, update, settingMap.quickCommands)
  }

  Store.prototype.delQuickCommand = function ({ id }) {
    window.store.delItem({ id }, settingMap.quickCommands)
  }

  Store.prototype.runSafetyCommand = async function (command, options = {}) {
    const tabId = options.tabId || window.store.activeTabId
    if (!tabId) {
      throw new Error('当前没有活动终端，命令尚未发送。')
    }
    const term = refs.get('term-' + tabId)
    if (!term?.runSafetyCommand) {
      throw new Error('当前终端不可用，命令尚未发送。')
    }
    return term.runSafetyCommand(command, {
      ...options,
      tabId: undefined
    })
  }

  Store.prototype.runQuickCommand = function (
    cmd,
    inputOnly = false,
    tabId,
    options = {}
  ) {
    return window.store.runSafetyCommand(cmd, {
      ...options,
      tabId,
      inputOnly,
      source: 'quick-command',
      title: options.title || '快捷命令'
    })
  }

  Store.prototype.runBatchSafetyCommand = function (
    command,
    tabIds,
    options = {}
  ) {
    return runSafetyCommandBatch(command, tabIds, {
      ...options,
      getTerminal: tabId => refs.get('term-' + tabId)
    })
  }

  Store.prototype.runQuickCommandItem = debounce(async (id, options = {}) => {
    const {
      store
    } = window

    const qm = store.currentQuickCommands.find(
      a => a.id === id
    )
    if (qm?.confirmRequired && !options.confirmed) {
      const ok = window.confirm
        ? window.confirm(`确认执行「${qm.name}」？该命令可能需要较高权限或产生较多输出。`)
        : true
      if (!ok) {
        return
      }
    }
    const qms = getQuickCommandSteps(qm, options)
    try {
      return await runSafetyCommandSequence(qms, {
        timeoutMs: options.completionTimeoutMs || 30000,
        runStep: async q => {
          let realCmd = normalizeCommandForShell(q.command)
          realCmd = await parseTemplates(realCmd)
          await delay(q.delay || 100)
          return store.runQuickCommand(
            realCmd,
            options.inputOnly ?? qm?.inputOnly,
            options.tabId,
            { title: qm?.name || options.title }
          )
        },
        onStepComplete: () => {
          if (qm) {
            store.editQuickCommand(qm.id, {
              clickCount: ((qm.clickCount || 0) + 1)
            })
          }
        }
      })
    } catch (error) {
      const reported = new Error(
        `快捷命令执行失败，已停止后续步骤：${error?.message || '未知错误'}`
      )
      store.onError?.(reported)
      return { success: false, error: reported.message }
    }
  }, 200)

  Store.prototype.setQmSortByFrequency = function (v) {
    window.store.qmSortByFrequency = v
    ls.setItem(qmSortByFrequencyKey, v ? 'yes' : 'no')
  }

  Store.prototype.handleSortByFrequency = function () {
    window.store.setQmSortByFrequency(!window.store.qmSortByFrequency)
  }
}
