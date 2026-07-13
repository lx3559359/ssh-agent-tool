import { classifyCommand } from '../../common/safety-transactions/command-classifier.js'
import { redactAuditText } from '../../common/safety-transactions/audit-redaction.js'

export function buildTerminalSafetyEndpoint (tab = {}, terminalPid) {
  const pid = terminalPid === undefined || terminalPid === null
    ? ''
    : terminalPid
  return {
    tabId: tab.id,
    host: tab.host,
    port: Number(tab.port || 22),
    username: tab.username || tab.user || '',
    title: tab.title || tab.name || '',
    pid,
    terminalPid: pid,
    sessionType: tab.type || 'ssh'
  }
}

function hasBalancedShellSyntax (command) {
  const pairs = { ')': '(', ']': '[', '}': '{' }
  const stack = []
  let quote = ''
  let escaped = false

  for (const character of command) {
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = ''
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (['(', '[', '{'].includes(character)) {
      stack.push(character)
      continue
    }
    if (pairs[character]) {
      if (stack.pop() !== pairs[character]) return false
    }
  }

  return !quote && !escaped && stack.length === 0
}

export function isCompleteTerminalCommand (command) {
  const text = String(command || '').trim()
  if (!text || /[\r\n]/.test(text)) return false
  if (/(?:^|\s)\d*<<-?\s*\S+/.test(text)) return false
  if (/(?:&&|\|\||\||\\)\s*$/.test(text)) return false
  if (/\b(?:then|do)\s*$/.test(text)) return false
  return hasBalancedShellSyntax(text)
}

function isTransparentContext (context) {
  return context.enabled !== true ||
    context.isSsh !== true ||
    context.passwordMode === true ||
    context.alternateBuffer === true ||
    context.isPaste === true ||
    context.shellIntegrationActive !== true
}

function confirmationFor (command, classification) {
  const recordable = redactAuditText(command) === command
  if (classification.reversible && !recordable) {
    return {
      kind: 'blocked',
      command,
      classification,
      executeAllowed: false,
      automaticRollback: false,
      recordable: false,
      message: '命令包含疑似凭据，无法安全记录或创建恢复点，请改用安全凭据引用。'
    }
  }
  if (classification.risk === 'blocked') {
    return {
      kind: 'blocked',
      command,
      classification,
      executeAllowed: false,
      automaticRollback: false,
      recordable,
      message: '该命令属于明确禁止操作，已拒绝执行。'
    }
  }
  if (classification.risk === 'change' && classification.reversible) {
    return {
      kind: 'reversible',
      command,
      classification,
      executeAllowed: true,
      automaticRollback: true,
      recordable,
      message: '执行前将创建并验证恢复点。'
    }
  }
  return {
    kind: 'nonreversible',
    command,
    classification,
    executeAllowed: true,
    automaticRollback: false,
    recordable,
    message: '此操作没有自动回滚，确认后仅执行一次。'
  }
}

export function createTerminalSafetyController (options = {}) {
  const classify = options.classifyCommand || classifyCommand
  let pending = null
  let continuationActive = false

  function beforeEnter (command, context = {}) {
    if (pending) return { sendNow: false, pending: true }
    const text = String(command || '').trim()
    if (isTransparentContext(context)) {
      return { sendNow: true }
    }
    if (continuationActive) {
      return { sendNow: true }
    }
    if (!isCompleteTerminalCommand(text)) {
      continuationActive = Boolean(text)
      return { sendNow: true }
    }
    const classification = classify(text)
    if (classification.risk === 'readonly') return { sendNow: true }
    pending = confirmationFor(text, classification)
    return { sendNow: false, confirmation: pending }
  }

  function beforeSend (data, context = {}) {
    if (data !== '\r' && data !== '\n') return { sendNow: true }
    return beforeEnter(context.command, context)
  }

  function resolvePending (action) {
    if (!pending) return { sendNow: false, clear: false }
    const canExecute = action === 'execute' && pending.executeAllowed
    pending = null
    return {
      sendNow: canExecute,
      clear: !canExecute && action !== 'invalidate'
    }
  }

  function getPending () {
    return pending
  }

  function onPromptStarted () {
    continuationActive = false
  }

  function onCommandExecuted () {
    onPromptStarted()
  }

  return {
    beforeSend,
    beforeEnter,
    resolvePending,
    getPending,
    onPromptStarted,
    onCommandExecuted
  }
}
