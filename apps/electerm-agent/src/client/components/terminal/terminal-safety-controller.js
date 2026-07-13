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

function withoutTrailingShellComment (command) {
  let quote = ''
  let backtickOpen = false
  let escaped = false

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
    if (character === "'" && quote !== '"' && !backtickOpen) {
      quote = "'"
      continue
    }
    if (character === '"' && !backtickOpen) {
      quote = quote === '"' ? '' : '"'
      continue
    }
    if (!quote && character === '`') {
      backtickOpen = !backtickOpen
      continue
    }
    if (!quote && !backtickOpen && character === '#' &&
      (index === 0 || /[\s;&|()]/.test(command[index - 1]))) {
      return command.slice(0, index)
    }
  }
  return command
}

function tokenizeShellSyntax (command) {
  const tokens = []
  let word = ''
  let wordStart = -1
  let plain = true
  let quote = ''
  let escaped = false

  function append (character, index) {
    if (wordStart === -1) wordStart = index
    word += character
  }

  function flushWord (end) {
    if (wordStart === -1) return
    tokens.push({ value: word, plain, operator: false, start: wordStart, end })
    word = ''
    wordStart = -1
    plain = true
  }

  function isBoundary (character) {
    return character === undefined || /\s/.test(character) ||
      ';|&()<>'.includes(character)
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (escaped) {
      append(character, index)
      escaped = false
      continue
    }
    if (quote) {
      if (character === '\\' && quote !== "'") {
        append(character, index)
        escaped = true
      } else if (character === quote) {
        quote = ''
      } else {
        append(character, index)
      }
      continue
    }
    if (character === '\\') {
      if (wordStart === -1) wordStart = index
      plain = false
      escaped = true
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      if (wordStart === -1) wordStart = index
      plain = false
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      flushWord(index)
      continue
    }

    const braceOperator = (character === '{' || character === '}') &&
      isBoundary(command[index - 1]) && isBoundary(command[index + 1])
    if (';|&()<>'.includes(character) || braceOperator) {
      flushWord(index)
      const doubled = (';|&()<>'.includes(character)) &&
        command[index + 1] === character
      const value = doubled ? character + character : character
      tokens.push({
        value,
        plain: true,
        operator: true,
        start: index,
        end: index + value.length
      })
      if (doubled) index += 1
      continue
    }
    append(character, index)
  }
  flushWord(command.length)
  return tokens
}

function hasOpenShellCompound (command) {
  const tokens = tokenizeShellSyntax(command)
  const stack = []
  let commandPosition = true

  function top () {
    return stack[stack.length - 1]
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const frame = top()

    if (frame?.type === 'case' && frame.phase === 'pattern') {
      if (!token.operator && token.plain && token.value === 'esac') {
        stack.pop()
        commandPosition = false
      } else if (token.operator && token.value === ')') {
        frame.phase = 'body'
        commandPosition = true
      }
      continue
    }

    if (token.operator) {
      const next = tokens[index + 1]
      if (['<', '>'].includes(token.value) && next?.value === '(' &&
        token.end === next.start) {
        stack.push({ type: 'process-substitution' })
        commandPosition = true
        index += 1
      } else if (token.value === '{' && commandPosition) {
        if (frame?.type === 'function') {
          frame.type = 'group'
        } else {
          stack.push({ type: 'group' })
        }
        commandPosition = true
      } else if (token.value === '}' && commandPosition &&
        frame?.type === 'group') {
        stack.pop()
        commandPosition = false
      } else if (token.value === '((' && commandPosition) {
        stack.push({ type: 'arithmetic' })
        commandPosition = true
      } else if (token.value === '))' && frame?.type === 'arithmetic') {
        stack.pop()
        commandPosition = false
      } else if (token.value === '(' && commandPosition) {
        stack.push({ type: 'subshell' })
        commandPosition = true
      } else if (token.value === ')' && frame?.type === 'subshell') {
        stack.pop()
        commandPosition = false
      } else if (token.value === ')' &&
        ['array', 'process-substitution'].includes(frame?.type)) {
        stack.pop()
        commandPosition = false
      } else if (token.value === ';;' && frame?.type === 'case' &&
        frame.phase === 'body') {
        frame.phase = 'pattern'
        commandPosition = false
      } else if ([';', '&&', '||', '|', '&', ';;'].includes(token.value)) {
        commandPosition = true
      } else if (token.value === ')' && frame?.type === 'case') {
        frame.phase = 'body'
        commandPosition = true
      }
      continue
    }

    if (token.plain && token.value === 'in' && frame?.type === 'case' &&
      frame.phase === 'header') {
      frame.phase = 'pattern'
      commandPosition = false
      continue
    }
    if (!commandPosition || !token.plain) {
      commandPosition = false
      continue
    }

    const next = tokens[index + 1]
    const afterNext = tokens[index + 2]
    const functionBrace = tokens[index + 3]
    if (/^[A-Za-z_][A-Za-z0-9_]*=$/.test(token.value) &&
      next?.value === '(' && token.end === next.start) {
      stack.push({ type: 'array' })
      commandPosition = false
      index += 1
      continue
    }
    if (next?.value === '(' && afterNext?.value === ')') {
      stack.push({
        type: functionBrace?.value === '{' ? 'group' : 'function'
      })
      commandPosition = true
      index += functionBrace?.value === '{' ? 3 : 2
      continue
    }
    if (token.value === 'function' && next && !next.operator && next.plain) {
      stack.push({
        type: afterNext?.value === '{' ? 'group' : 'function'
      })
      commandPosition = true
      index += afterNext?.value === '{' ? 2 : 1
      continue
    }
    if (token.value === '!') {
      commandPosition = true
      continue
    }
    if (token.value === 'time') {
      while (tokens[index + 1]?.plain &&
        tokens[index + 1].value === '-p') index += 1
      commandPosition = true
      continue
    }

    const current = top()
    if (token.value === 'if') {
      stack.push({ type: 'if', phase: 'condition' })
      commandPosition = true
    } else if (token.value === 'then' && current?.type === 'if' &&
      current.phase === 'condition') {
      current.phase = 'body'
      commandPosition = true
    } else if (token.value === 'elif' && current?.type === 'if' &&
      current.phase === 'body') {
      current.phase = 'condition'
      commandPosition = true
    } else if (token.value === 'else' && current?.type === 'if' &&
      current.phase === 'body') {
      commandPosition = true
    } else if (token.value === 'fi' && current?.type === 'if') {
      stack.pop()
      commandPosition = false
    } else if (['for', 'select'].includes(token.value)) {
      stack.push({ type: 'loop', phase: 'header' })
      commandPosition = false
    } else if (['while', 'until'].includes(token.value)) {
      stack.push({ type: 'loop', phase: 'condition' })
      commandPosition = true
    } else if (token.value === 'do' && current?.type === 'loop' &&
      current.phase !== 'body') {
      current.phase = 'body'
      commandPosition = true
    } else if (token.value === 'done' && current?.type === 'loop' &&
      current.phase === 'body') {
      stack.pop()
      commandPosition = false
    } else if (token.value === 'case') {
      stack.push({ type: 'case', phase: 'header' })
      commandPosition = false
    } else if (token.value === 'esac' && current?.type === 'case') {
      stack.pop()
      commandPosition = false
    } else {
      commandPosition = false
    }
  }

  return stack.length > 0
}

export function isCompleteTerminalCommand (command) {
  const canonical = String(command || '')
  if (!canonical.trim() || /[\r\n]/.test(canonical)) return false
  const syntax = withoutTrailingShellComment(canonical)
  if (hasTrailingControlOperator(syntax)) return false
  if (hasOpenShellCompound(syntax)) return false
  return !shellContinuationState(syntax).incomplete
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
    const canonical = String(command || '')
    const normalized = canonical.trim()
    if (isTransparentContext(context)) {
      return { sendNow: true }
    }
    if (continuationActive) {
      return { sendNow: true }
    }
    if (!isCompleteTerminalCommand(canonical)) {
      continuationActive = Boolean(normalized)
      return { sendNow: true }
    }
    const classification = classify(canonical)
    if (classification.risk === 'readonly') return { sendNow: true }
    pending = confirmationFor(canonical, classification)
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
