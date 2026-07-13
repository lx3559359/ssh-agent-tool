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

export function hasReliableTerminalCommandTracking (
  shellType,
  shellIntegrationActive
) {
  return shellIntegrationActive === true && shellType !== 'sh'
}

function shellContinuationState (command) {
  const substitutions = []
  let quote = ''
  let backtickOpen = false
  let escaped = false
  let heredoc = false

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote === "'") {
      if (character === "'") quote = ''
      continue
    }
    if (character === "'" && quote !== '"') {
      quote = "'"
      continue
    }
    if (character === '"') {
      quote = quote === '"' ? '' : '"'
      continue
    }
    if (character === '`') {
      backtickOpen = !backtickOpen
      continue
    }
    if (!quote && !backtickOpen && character === '<' &&
      command[index + 1] === '<' && command[index + 2] !== '<') {
      heredoc = true
    }
    if (character === '$' && command[index + 1] === '(') {
      substitutions.push(')')
      index += 1
      if (command[index + 1] === '(') {
        substitutions.push(')')
        index += 1
      }
      continue
    }
    if (character === '$' && command[index + 1] === '{') {
      substitutions.push('}')
      index += 1
      continue
    }
    const expected = substitutions[substitutions.length - 1]
    if (expected && character === expected) {
      substitutions.pop()
    } else if (expected === ')' && character === '(') {
      substitutions.push(')')
    } else if (expected === '}' && character === '{') {
      substitutions.push('}')
    }
  }

  return {
    incomplete: Boolean(
      quote || backtickOpen || escaped || heredoc || substitutions.length
    )
  }
}

function hasTrailingControlOperator (command) {
  const text = command.trimEnd()
  for (const operator of ['&&', '||', '|']) {
    if (!text.endsWith(operator)) continue
    const operatorIndex = text.length - operator.length
    let backslashes = 0
    for (let index = operatorIndex - 1; text[index] === '\\'; index -= 1) {
      backslashes += 1
    }
    if (backslashes % 2 === 0) return true
  }
  return false
}

function hasKnownMultilineStart (command) {
  return /^(?:(?:for|select|while|until)\b[\s\S]*;\s*do|if\b[\s\S]*;\s*then|case\b[\s\S]*\bin)\s*$/.test(command)
}

export function isCompleteTerminalCommand (command) {
  const text = String(command || '').trim()
  if (!text || /[\r\n]/.test(text)) return false
  if (hasTrailingControlOperator(text)) return false
  if (hasKnownMultilineStart(text)) return false
  return !shellContinuationState(text).incomplete
}

function isTransparentContext (context) {
  return context.enabled !== true ||
    context.isSsh !== true ||
    context.passwordMode === true ||
    context.alternateBuffer === true ||
    context.isPaste === true ||
    context.shellIntegrationActive !== true ||
    context.commandInputActive !== true ||
    context.canonicalInputReliable !== true
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
