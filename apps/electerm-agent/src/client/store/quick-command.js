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

  Store.prototype.runQuickCommand = function (cmd, inputOnly = false, tabId) {
    const tid = tabId || window.store.activeTabId
    refs.get('term-' + tid)?.runQuickCommand(cmd, inputOnly)
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
    for (const q of qms) {
      let realCmd = normalizeCommandForShell(q.command)
      realCmd = await parseTemplates(realCmd)

      await delay(q.delay || 100)
      store.runQuickCommand(realCmd, options.inputOnly ?? qm?.inputOnly)
      if (qm) {
        store.editQuickCommand(qm.id, {
          clickCount: ((qm.clickCount || 0) + 1)
        })
      }
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
