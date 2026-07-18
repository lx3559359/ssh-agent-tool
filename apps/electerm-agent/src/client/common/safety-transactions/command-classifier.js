const riskRank = {
  readonly: 0,
  change: 1,
  unknown: 2,
  blocked: 3
}

function result (risk, reason, provider = null, reversibleOverride) {
  const reversible = reversibleOverride ?? (risk === 'change' && Boolean(provider))
  return {
    risk,
    reversible,
    provider: reversible ? provider : null,
    requiresConfirmation: risk !== 'readonly',
    reason
  }
}

function splitCommands (command) {
  const parts = []
  let current = ''
  let quote = ''
  let escaped = false
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      current += character
      escaped = true
      continue
    }
    if (quote) {
      current += character
      if (character === quote) quote = ''
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      current += character
      continue
    }
    const doubleOperator = command.slice(index, index + 2)
    if (doubleOperator === '&&' || doubleOperator === '||') {
      if (current.trim()) parts.push(current)
      current = ''
      index += 1
      continue
    }
    const isBackgroundOperator = character === '&' &&
      command[index - 1] !== '>' && command[index + 1] !== '>'
    if (character === ';' || character === '|' || character === '\n' || isBackgroundOperator) {
      if (current.trim()) parts.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (current.trim()) parts.push(current)
  return parts
}

function shellTokens (command) {
  const tokens = []
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s]+)/g
  let match
  while ((match = pattern.exec(command))) {
    tokens.push({
      value: match[1] ?? match[2] ?? match[3],
      quote: match[1] !== undefined ? '"' : match[2] !== undefined ? "'" : '',
      start: match.index,
      end: pattern.lastIndex
    })
  }
  return tokens
}

function shellWords (command) {
  return shellTokens(command).map(token => token.value)
}

export function tokenizeStaticShell (command) {
  const text = String(command || '')
  if (!text.trim() || /[\0\r\n]/.test(text)) {
    throw new Error('命令为空或包含换行/NUL。')
  }
  const words = []
  let current = ''
  let quote = ''
  let inWord = false
  let escaped = false

  function pushWord () {
    if (!inWord) return
    words.push(current)
    current = ''
    inWord = false
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (escaped) {
      current += character
      inWord = true
      escaped = false
      continue
    }
    if (quote) {
      if (character === quote) {
        quote = ''
        inWord = true
      } else if (character === '\\' && quote === '"') {
        if (/[$`"\\\n]/.test(text[index + 1] || '')) {
          escaped = true
        } else {
          current += character
        }
        inWord = true
      } else {
        current += character
        inWord = true
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      inWord = true
      continue
    }
    if (character === '\\') {
      escaped = true
      inWord = true
      continue
    }
    if (/\s/.test(character)) {
      pushWord()
      continue
    }
    if (/[;|&<>]/.test(character)) {
      throw new Error('命令包含 shell 控制符，无法静态解析。')
    }
    current += character
    inWord = true
  }
  if (quote || escaped) throw new Error('命令引号或转义不完整。')
  pushWord()
  return words
}

function executableName (value) {
  return String(value || '').replace(/^.*\//, '')
}

export function isTrustedExecutablePath (value) {
  return /^\/(?:usr\/)?(?:s?bin)\/[A-Za-z0-9._+-]+$/.test(String(value || ''))
}

function isEnvironmentAssignment (value) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value)
}

function stripCommandPrefix (command) {
  const text = command.trim()
  const tokens = shellTokens(text)
  let index = 0
  while (isEnvironmentAssignment(tokens[index]?.value)) index += 1

  if (executableName(tokens[index]?.value) === 'sudo') {
    index += 1
    const optionsWithValues = new Set([
      '-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt',
      '-C', '--close-from', '-T', '--command-timeout', '-R', '--chroot',
      '-D', '--chdir', '-r', '--role', '-t', '--type'
    ])
    while (tokens[index]?.value?.startsWith('-')) {
      const option = tokens[index].value
      if (option === '--') {
        index += 1
        break
      }
      index += 1
      if (optionsWithValues.has(option) && tokens[index]) index += 1
    }
    while (isEnvironmentAssignment(tokens[index]?.value)) index += 1
  }

  if (executableName(tokens[index]?.value) === 'env') {
    index += 1
    const envOptionsWithValues = new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string'])
    while (tokens[index]?.value?.startsWith('-')) {
      const option = tokens[index].value
      if (option === '--') {
        index += 1
        break
      }
      index += 1
      if (envOptionsWithValues.has(option) && tokens[index]) index += 1
    }
    while (isEnvironmentAssignment(tokens[index]?.value)) index += 1
  }

  const executable = tokens[index]
  if (!executable) return ''
  return `${executableName(executable.value)}${text.slice(executable.end)}`.trim()
}

function hasTrustedExecutableIdentity (command) {
  const tokens = shellTokens(String(command || '').trim())
  let index = 0
  if (isEnvironmentAssignment(tokens[index]?.value)) return false

  const wrapper = tokens[index]?.value
  if (executableName(wrapper) === 'env') return false
  if (executableName(wrapper) === 'sudo') {
    if (!isTrustedExecutablePath(wrapper)) return false
    index += 1
    let nonInteractive = false
    while (tokens[index]?.value?.startsWith('-')) {
      const option = tokens[index].value
      if (option === '--') {
        index += 1
        break
      }
      if (option !== '-n' && option !== '--non-interactive') return false
      nonInteractive = true
      index += 1
    }
    if (!nonInteractive || isEnvironmentAssignment(tokens[index]?.value)) {
      return false
    }
  }

  const executable = tokens[index]?.value
  if (['sudo', 'env', 'command'].includes(executableName(executable))) {
    return false
  }
  return isTrustedExecutablePath(executable)
}

function hasDirectBareExecutableIdentity (command) {
  const tokens = shellTokens(String(command || '').trim())
  const executable = tokens[0]?.value || ''
  return Boolean(executable) && !executable.includes('/') &&
    !isEnvironmentAssignment(executable) &&
    !['sudo', 'env', 'command'].includes(executableName(executable))
}

function isSafeAbsolutePath (value) {
  if (!value || !value.startsWith('/') || value === '/') return false
  if (/[\0\n\r*$?`[\]{}]/.test(value)) return false
  return !value.split('/').includes('..')
}

const harmlessOutputSinks = new Set(['/dev/null', '/dev/stdout', '/dev/stderr'])
const blockedVirtualRoots = ['/dev', '/proc', '/sys']
const unrecoverableVirtualRoots = ['/run', '/var/run']

function isWithinPath (value, root) {
  return value === root || value.startsWith(`${root}/`)
}

function filePathPolicy (value) {
  if (!isSafeAbsolutePath(value)) return 'unsafe'
  const normalized = value.replace(/\/{2,}/g, '/')
  if (harmlessOutputSinks.has(normalized)) return 'sink'
  if (blockedVirtualRoots.some(root => isWithinPath(normalized, root))) return 'blocked'
  if (unrecoverableVirtualRoots.some(root => isWithinPath(normalized, root))) return 'virtual'
  return 'recoverable'
}

function isRecoverableFilePath (value) {
  return filePathPolicy(value) === 'recoverable'
}

function hasUnsafeExpansion (command) {
  return /\$\(|(?:<|>)\s*\(|`|\$\{|[@?!+*]\(|(^|\s)(?:eval|source|\.)\s|(^|\s)(?:ba|z|k)?sh\s+-?c\b/i.test(command)
}

function isDatabaseClient (command) {
  return /^(?:mysql|mariadb|psql|sqlite3|redis-cli|mongo|mongosh|mysqladmin)(?:\s|$)/i.test(stripCommandPrefix(command))
}

function hasDestructiveDatabaseOperation (command) {
  return /\b(?:drop\s+(?:database|schema|table)|truncate\s+(?:table\s+)?[A-Za-z_]|delete\s+from|flushall|flushdb|dropdatabase\s*\(|db(?:\.[A-Za-z_$][\w$-]*)+\.drop\s*\()/i.test(command) ||
    /^mysqladmin\b.*\bdrop\b/i.test(stripCommandPrefix(command))
}

function isBlocked (command) {
  const text = stripCommandPrefix(command)
  if (/^(?:mkfs(?:\.[A-Za-z0-9_-]+)?|fdisk|parted)(?:\s|$)/i.test(text)) return true
  if (/^(?:reboot|shutdown|poweroff)(?:\s|$)/i.test(text)) return true
  if (explicitFileWriteTargets(text).some(target => filePathPolicy(target) === 'blocked')) {
    return true
  }
  if (/^rm(?:\s|$)/i.test(text)) {
    const words = shellWords(text).slice(1)
    const recursive = words.some(word => word === '--recursive' || /^-[^-]*r/i.test(word))
    const targets = words.filter(word => !word.startsWith('-'))
    if (recursive && targets.includes('/')) return true
  }
  if (/^dd(?:\s|$)/i.test(text)) {
    const outputMatch = text.match(/\bof\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/i)
    const output = outputMatch?.[1] ?? outputMatch?.[2] ?? outputMatch?.[3] ?? ''
    const allowedCharacterDevices = new Set([
      '/dev/null', '/dev/zero', '/dev/random', '/dev/urandom',
      '/dev/stdout', '/dev/stderr'
    ])
    if (!allowedCharacterDevices.has(output) && filePathPolicy(output) === 'blocked') return true
  }
  return isDatabaseClient(text) && hasDestructiveDatabaseOperation(text)
}

function findRedirection (command) {
  let quote = ''
  let escaped = false
  const redirects = []
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
    if (quote) {
      if (character === quote) quote = ''
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character !== '>') continue
    const operatorEnd = command[index + 1] === '>' ? index + 2 : index + 1
    let tail = command.slice(operatorEnd).trimStart()
    if (tail.startsWith('&')) tail = tail.slice(1).trimStart()
    let target
    try {
      const targets = tokenizeStaticShell(tail)
      target = targets.length === 1 ? targets[0] : undefined
    } catch (error) {
      target = undefined
    }
    redirects.push({ index, target })
    if (command[index + 1] === '>') index += 1
  }
  return redirects
}

function classifyRedirection (command, redirects) {
  const targetPolicies = redirects.map(redirect => filePathPolicy(redirect.target))
  if (targetPolicies.includes('blocked')) {
    return result('blocked', '输出重定向指向虚拟或设备路径，无法安全恢复')
  }
  if (targetPolicies.some(policy => policy === 'sink' || policy === 'virtual')) {
    return result('unknown', '输出重定向指向不可恢复路径，不创建文件恢复点')
  }
  if (redirects.length !== 1 || targetPolicies[0] !== 'recoverable') {
    return result('unknown', '输出重定向目标无法安全确定')
  }
  const producer = stripCommandPrefix(command.slice(0, redirects[0].index))
  if (!/^(?:echo|printf|cat)(?:\s|$)/i.test(producer)) {
    return result('unknown', '输出命令不在可恢复文件写入白名单中')
  }
  return result('change', '明确的绝对路径文件写入可创建恢复点', 'file')
}

const findOutputActions = new Set(['-fprint', '-fprintf', '-fls', '-fprint0'])
const unsafeFindActions = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir'])
const sedShortOptions = new Set(['n', 'E', 'r', 's', 'u', 'z'])
const sedLongOptions = new Set([
  '--quiet', '--silent', '--regexp-extended', '--separate', '--unbuffered',
  '--null-data', '--sandbox', '--posix', '--debug', '--follow-symlinks'
])

function invalidSedInvocation () {
  return {
    valid: false,
    inPlace: false,
    externalScript: false,
    hasDynamicScript: false,
    scripts: [],
    files: []
  }
}

function hasShellVariable (value) {
  let escaped = false
  for (let index = 0; index < value.length - 1; index += 1) {
    const character = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '$' && /[A-Za-z0-9_({?!*#$@-]/.test(value[index + 1])) return true
  }
  return false
}

function parseSedInvocation (words, quotes = []) {
  const scripts = []
  const files = []
  let inPlace = false
  let externalScript = false
  let hasDynamicScript = false
  let usesScriptOptions = false
  let hasPositionalScript = false
  let parseOptions = true

  function addScript (value, quote) {
    scripts.push(value)
    if (quote !== "'" && hasShellVariable(value)) hasDynamicScript = true
  }

  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]
    if (parseOptions && word === '--') {
      parseOptions = false
      continue
    }
    if (parseOptions && word.startsWith('--')) {
      if (sedLongOptions.has(word)) continue
      if (word === '--in-place' || word.startsWith('--in-place=')) {
        inPlace = true
        continue
      }
      if (word === '--expression' || word === '--file') {
        const scriptValue = words[index + 1]
        if (scriptValue === undefined) return invalidSedInvocation()
        usesScriptOptions = true
        if (word === '--expression') addScript(scriptValue, quotes[index + 1])
        else externalScript = true
        index += 1
        continue
      }
      if (word.startsWith('--expression=')) {
        const scriptValue = word.slice('--expression='.length)
        if (!scriptValue) return invalidSedInvocation()
        usesScriptOptions = true
        addScript(scriptValue, quotes[index])
        continue
      }
      if (word.startsWith('--file=')) {
        if (word.length === '--file='.length) return invalidSedInvocation()
        usesScriptOptions = true
        externalScript = true
        continue
      }
      return invalidSedInvocation()
    }
    if (parseOptions && /^-[^-]/.test(word)) {
      for (let offset = 1; offset < word.length; offset += 1) {
        const option = word[offset]
        if (sedShortOptions.has(option)) continue
        if (option === 'i') {
          inPlace = true
          break
        }
        if (option === 'e' || option === 'f') {
          const attachedValue = word.slice(offset + 1)
          const scriptValue = attachedValue || words[index + 1]
          if (scriptValue === undefined) return invalidSedInvocation()
          usesScriptOptions = true
          if (option === 'e') {
            addScript(scriptValue, attachedValue ? quotes[index] : quotes[index + 1])
          } else externalScript = true
          if (!attachedValue) index += 1
          break
        }
        return invalidSedInvocation()
      }
      continue
    }
    if (!usesScriptOptions && !hasPositionalScript) {
      addScript(word, quotes[index])
      hasPositionalScript = true
    } else {
      files.push(word)
    }
  }

  return { valid: true, inPlace, externalScript, hasDynamicScript, scripts, files }
}

function skipSedSpacing (script, index) {
  while (index < script.length && /[\t\r ]/.test(script[index])) index += 1
  return index
}

function consumeSedDelimited (script, index, delimiter) {
  let escaped = false
  for (; index < script.length; index += 1) {
    const character = script[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === delimiter) return index + 1
  }
  return -1
}

function consumeSedAddress (script, index) {
  index = skipSedSpacing(script, index)
  if (/\d/.test(script[index] || '')) {
    while (/\d/.test(script[index] || '')) index += 1
    return index
  }
  if (script[index] === '$') return index + 1
  if (script[index] === '/') return consumeSedDelimited(script, index + 1, '/')
  return -1
}

function isSafeSedScript (script) {
  let index = 0
  let commandCount = 0
  while (index < script.length) {
    index = skipSedSpacing(script, index)
    while (script[index] === ';' || script[index] === '\n') {
      index = skipSedSpacing(script, index + 1)
    }
    if (index >= script.length) break

    const addressEnd = consumeSedAddress(script, index)
    if (addressEnd !== -1) {
      index = skipSedSpacing(script, addressEnd)
      if (script[index] === ',') {
        const rangeEnd = consumeSedAddress(script, index + 1)
        if (rangeEnd === -1) return false
        index = skipSedSpacing(script, rangeEnd)
      }
    }
    if (script[index] === '!') index = skipSedSpacing(script, index + 1)

    const command = script[index]
    index += 1
    if (command === 's') {
      const delimiter = script[index]
      if (!delimiter || /[\\\n\r\s]/.test(delimiter)) return false
      index = consumeSedDelimited(script, index + 1, delimiter)
      if (index === -1) return false
      index = consumeSedDelimited(script, index, delimiter)
      if (index === -1) return false
      const flagsStart = index
      while (index < script.length && script[index] !== ';' && script[index] !== '\n') index += 1
      const flags = script.slice(flagsStart, index).trim()
      if (!/^[gIpimM0-9]*$/.test(flags)) return false
    } else if (['p', 'P', '='].includes(command)) {
      index = skipSedSpacing(script, index)
      if (index < script.length && script[index] !== ';' && script[index] !== '\n') return false
    } else if (command === 'l') {
      index = skipSedSpacing(script, index)
      while (/\d/.test(script[index] || '')) index += 1
      index = skipSedSpacing(script, index)
      if (index < script.length && script[index] !== ';' && script[index] !== '\n') return false
    } else {
      return false
    }
    commandCount += 1
  }
  return commandCount > 0
}

function findOutputTargets (words) {
  const targets = []
  let hasOutputAction = false
  for (let index = 0; index < words.length; index += 1) {
    if (!findOutputActions.has(words[index])) continue
    hasOutputAction = true
    targets.push(words[index + 1] || '')
  }
  return { hasOutputAction, targets }
}

function hasUnsafeFindAction (words) {
  return words.some(word => unsafeFindActions.has(word))
}

function positionalArguments (words) {
  return words.filter(word => word !== '--' && !word.startsWith('-'))
}

function truncateTargets (words) {
  const targets = []
  let optionsEnded = false
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]
    if (!optionsEnded && word === '--') {
      optionsEnded = true
      continue
    }
    if (!optionsEnded && (word === '-c' || word === '--no-create')) continue
    if (!optionsEnded && (word === '-s' || word === '--size')) {
      if (!/^[+-]?\d+[KMGTPEZY]?$/.test(words[index + 1] || '')) return []
      index += 1
      continue
    }
    if (!optionsEnded && /^-s[+-]?\d+[KMGTPEZY]?$/.test(word)) continue
    if (!optionsEnded && /^--size=[+-]?\d+[KMGTPEZY]?$/.test(word)) continue
    if (!optionsEnded && word.startsWith('-')) return []
    targets.push(word)
  }
  return targets
}

function explicitFileWriteTargets (command) {
  const words = shellWords(stripCommandPrefix(command))
  const executable = (words[0] || '').toLowerCase()
  const positional = positionalArguments(words.slice(1))
  if (executable === 'truncate') return truncateTargets(words)
  if (executable === 'tee' || executable === 'rm') {
    return positional
  }
  if (executable === 'find') return findOutputTargets(words.slice(1)).targets
  if (executable === 'sed') {
    const invocation = parseSedInvocation(words)
    return invocation.inPlace ? invocation.files : []
  }
  if (executable === 'cp') return positional.slice(-1)
  if (executable === 'mv') return positional
  return []
}

function fileProvider (command) {
  const text = stripCommandPrefix(command)
  const words = shellWords(text)
  const executable = (words.shift() || '').toLowerCase()
  const positional = positionalArguments(words)

  if (executable === 'tee') {
    return positional.length === 1 && isRecoverableFilePath(positional[0])
  }
  if (executable === 'find') {
    const output = findOutputTargets(words)
    return !hasUnsafeFindAction(words) &&
      output.hasOutputAction && output.targets.every(isRecoverableFilePath)
  }
  if (executable === 'sed') {
    const invocation = parseSedInvocation([executable, ...words])
    return invocation.valid && invocation.inPlace && !invocation.externalScript &&
      invocation.scripts.every(isSafeSedScript) && invocation.files.length > 0 &&
      invocation.files.every(isRecoverableFilePath)
  }
  if (executable === 'truncate') {
    const targets = truncateTargets([executable, ...words])
    return targets.length > 0 && targets.every(isRecoverableFilePath)
  }
  if (executable === 'rm') {
    const recursive = words.some(word => /^-[^-]*r/i.test(word) || word === '--recursive')
    const safeTargets = positional.length > 0 && positional.every(isRecoverableFilePath)
    const rootLevelTarget = positional.some(word => word.split('/').filter(Boolean).length < 2)
    return safeTargets && !(recursive && rootLevelTarget)
  }
  if (executable === 'cp' || executable === 'mv') {
    return positional.length >= 2 && positional.every(isRecoverableFilePath)
  }
  return false
}

function permissionsProvider (command) {
  const words = shellWords(stripCommandPrefix(command))
  const executable = (words.shift() || '').toLowerCase()
  if (!['chmod', 'chown', 'chgrp'].includes(executable)) return false
  const targets = words.filter(word => !word.startsWith('-')).slice(1)
  return targets.length > 0 && targets.every(isSafeAbsolutePath)
}

function changeProvider (command) {
  const text = stripCommandPrefix(command)
  if (/[$`*?[\]{}]/.test(text)) return null
  if (/^systemctl\s+(?:start|stop|enable|disable)\s+\S+/i.test(text)) return 'systemd'
  if (permissionsProvider(text)) return 'permissions'
  if (/^firewall-cmd\b.*\s--(?:add|remove)-[A-Za-z-]+\b/i.test(text) || /^ufw\s+(?:allow|deny|reject|delete|enable|disable)\b/i.test(text) || /^(?:iptables|ip6tables)\s+-(?:A|D|I|R|N|X|P)\b/i.test(text) || /^nft\s+(?:add|delete|insert|replace)\b/i.test(text)) return 'firewall'
  if (/^nmcli\s+(?:connection|con)\s+(?:modify|up|down)\s+\S+/i.test(text) || /^ip\s+(?:addr(?:ess)?|route)\s+(?:add|del|delete|replace)\s+\S+/i.test(text) || /^ip\s+addr(?:ess)?\s+flush\s+dev\s+\S+/i.test(text) || /^ip\s+link\s+set\s+(?:dev\s+)?\S+\s+\S+/i.test(text) || /^ifconfig\s+\S+\s+(?:up|down|netmask|mtu|broadcast|[0-9a-f:.]+)\b/i.test(text)) return 'network'
  if (/^docker\s+(?:start|stop)\s+\S+/i.test(text)) return 'docker'
  if (fileProvider(text)) return 'file'
  return null
}

const inherentlyReadonlyCommands = new Set([
  'uptime', 'whoami', 'id', 'pwd', 'df', 'du', 'free', 'ps', 'ls',
  'stat', 'wc', 'which', 'uname', 'lsof', 'cat', 'less', 'head', 'tail', 'grep'
])
const journalctlShortOptions = /^-[abDefFgklmMnopqrStuUWxN]+$/

function isReadonlyDate (words) {
  const noValueOptions = new Set([
    '-u', '--utc', '--universal', '-R', '--rfc-email', '--debug', '--resolution'
  ])
  const valueOptions = new Set(['-d', '--date', '-r', '--reference', '-f', '--file'])
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]
    if (word.startsWith('+') || noValueOptions.has(word) ||
      /^-I(?:\S*)?$/.test(word) || /^--iso-8601(?:=\S+)?$/.test(word) ||
      /^(?:--date|--reference|--file)=\S+$/.test(word)) continue
    if (valueOptions.has(word) && words[index + 1]) {
      index += 1
      continue
    }
    return false
  }
  return true
}

function isReadonlyJournalctl (words) {
  const longNoValue = new Set([
    '--no-pager', '--follow', '--reverse', '--all', '--full', '--quiet',
    '--merge', '--boot', '--dmesg', '--catalog', '--pager-end', '--utc',
    '--list-boots', '--list-fields', '--disk-usage', '--header', '--verify',
    '--version', '--help'
  ])
  const longValueOptions = [
    '--unit', '--user-unit', '--identifier', '--priority', '--facility',
    '--grep', '--since', '--until', '--lines', '--output', '--output-fields',
    '--field', '--directory', '--file', '--root', '--machine', '--namespace',
    '--cursor', '--after-cursor', '--cursor-file', '--case-sensitive', '--verify-key'
  ]
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]
    if (!word.startsWith('-') || /^-\d+$/.test(word) ||
      journalctlShortOptions.test(word) || longNoValue.has(word)) continue
    const valueOption = longValueOptions.find(option => word === option || word.startsWith(`${option}=`))
    if (!valueOption) return false
    if (word === valueOption) {
      if (!words[index + 1]) return false
      index += 1
    }
  }
  return true
}

function isReadonlySystemctl (words) {
  if (!/^(?:status|show|is-active|is-enabled|list-[A-Za-z-]+)$/i.test(words[1] || '')) {
    return false
  }
  const noValueOptions = new Set([
    '--no-pager', '--full', '--all', '--quiet', '--plain', '--legend',
    '--no-legend', '--failed', '--user', '--system', '--global', '--runtime',
    '--recursive', '--reverse', '--with-dependencies', '--show-types', '--value'
  ])
  const valueOptions = [
    '--lines', '-n', '--output', '-o', '--type', '-t', '--state',
    '--property', '-p', '--host', '-H', '--machine', '-M', '--root', '--image'
  ]
  for (let index = 2; index < words.length; index += 1) {
    const word = words[index]
    if (!word.startsWith('-') || noValueOptions.has(word)) continue
    const valueOption = valueOptions.find(option => word === option || word.startsWith(`${option}=`))
    if (!valueOption) return false
    if (word === valueOption) {
      if (!words[index + 1]) return false
      index += 1
    }
  }
  return true
}

function isReadonlySs (words) {
  const longOptions = /^(?:--numeric|--all|--listening|--options|--extended|--memory|--processes|--info|--summary|--events|--help|--version|--family=\S+|--query=\S+)$/
  return words.slice(1).every(word => {
    if (!word.startsWith('-')) return true
    return /^-[HOnraletuxwpmios460]+$/.test(word) || longOptions.test(word)
  })
}

function isReadonlyIptables (words) {
  const listActions = new Set(['-L', '-S', '--list', '--list-rules'])
  const noValueModifiers = new Set([
    '-n', '--numeric', '-v', '--verbose', '-x', '--exact',
    '--line-numbers', '-4', '-6'
  ])
  const valueModifiers = new Set(['-t', '--table', '-W', '--wait-interval'])
  const shortModifierNames = new Set(['n', 'v', 'x', '4', '6'])
  let hasListAction = false
  let hasChain = false

  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]
    if (listActions.has(word)) {
      if (hasListAction) return false
      hasListAction = true
      continue
    }
    if (word.startsWith('--list=') || word.startsWith('--list-rules=')) {
      if (hasListAction || !word.slice(word.indexOf('=') + 1)) return false
      hasListAction = true
      hasChain = true
      continue
    }
    if (noValueModifiers.has(word) ||
      (/^-[^-]/.test(word) && [...word.slice(1)].every(option => shortModifierNames.has(option)))) continue
    if (/^--(?:table|wait|wait-interval)=\S+$/.test(word)) continue
    if (word === '-w' || word === '--wait') {
      if (/^\d+$/.test(words[index + 1] || '')) index += 1
      continue
    }
    if (valueModifiers.has(word)) {
      if (!words[index + 1]) return false
      index += 1
      continue
    }
    if (word.startsWith('-')) return false
    if (!hasListAction || hasChain) return false
    hasChain = true
  }
  return hasListAction
}

function isReadonlySed (words, quotes) {
  const invocation = parseSedInvocation(words, quotes)
  return invocation.valid && !invocation.inPlace && !invocation.externalScript &&
    !invocation.hasDynamicScript && invocation.scripts.length > 0 &&
    invocation.scripts.every(isSafeSedScript)
}

function isReadonlyKubectl (words) {
  const action = words[1]?.toLowerCase()
  return ['get', 'describe', 'logs', 'top', 'version'].includes(action)
}

function isReadonlyGit (words) {
  const action = words[1]?.toLowerCase()
  if (['status', 'log', 'show', 'diff'].includes(action)) return true
  if (action === 'branch') {
    return words.slice(2).every(word => (
      /^-(?:a|r|v|vv)$/.test(word) ||
      ['--all', '--remotes', '--verbose', '--list', '--show-current'].includes(word)
    ))
  }
  if (action === 'remote') {
    return words.slice(2).every(word => (
      word === '-v' || word === '--verbose' || word === 'show' ||
      word === 'get-url' || !word.startsWith('-')
    ))
  }
  return false
}

function isReadonly (command) {
  const text = stripCommandPrefix(command)
  const tokens = shellTokens(text)
  const words = tokens.map(token => token.value)
  const executable = (words[0] || '').toLowerCase()
  if (inherentlyReadonlyCommands.has(executable)) return true
  if (executable === 'hostname') return words.length === 1
  if (executable === 'date') return isReadonlyDate(words)
  if (executable === 'journalctl') return isReadonlyJournalctl(words)
  if (executable === 'ss') return isReadonlySs(words)
  if (executable === 'sed') return isReadonlySed(words, tokens.map(token => token.quote))
  if (executable === 'find') {
    const output = findOutputTargets(words)
    return !output.hasOutputAction && !hasUnsafeFindAction(words)
  }
  if (executable === 'ip') {
    const section = words[1]?.toLowerCase()
    const action = words[2]?.toLowerCase()
    const readonlyActions = section === 'route' ? ['show', 'list', 'get'] : ['show', 'list']
    return ['addr', 'address', 'route', 'link'].includes(section) &&
      (!action || readonlyActions.includes(action))
  }
  if (executable === 'systemctl') return isReadonlySystemctl(words)
  if (executable === 'firewall-cmd') return /^(?:--state|--list-[A-Za-z-]+|--query-[A-Za-z-]+)$/i.test(words[1] || '')
  if (executable === 'ufw') return words[1]?.toLowerCase() === 'status'
  if (executable === 'iptables' || executable === 'ip6tables') return isReadonlyIptables(words)
  if (executable === 'nft') return words[1]?.toLowerCase() === 'list'
  if (executable === 'ifconfig') return words.length <= 2 && (!words[1] || words[1] === '-a' || !words[1].startsWith('-'))
  if (executable === 'docker' || executable === 'podman') return ['ps', 'logs', 'inspect', 'stats'].includes(words[1]?.toLowerCase())
  if (executable === 'kubectl') return isReadonlyKubectl(words)
  if (executable === 'git') return isReadonlyGit(words)
  return false
}

function isRecognizedMutation (command) {
  return /^(?:kubectl)\s+(?:delete|apply|replace|patch|scale|rollout|cordon|drain)\b/i.test(command) ||
    /^(?:docker|podman)\s+(?:rm|rmi|stop|kill|prune)\b/i.test(command) ||
    /^git\s+(?:reset\s+--hard\b|clean\s+-|push\b[^\n]*--force(?:-with-lease)?\b)/i.test(command)
}

function classifySingle (command) {
  if (isBlocked(command)) {
    return result('blocked', '命令包含明确禁止的不可逆操作')
  }
  if (hasUnsafeExpansion(command)) {
    return result('unknown', '命令包含动态执行或脚本解释器，无法安全解析')
  }
  const redirects = findRedirection(command)
  const redirectClassification = redirects.length
    ? classifyRedirection(command, redirects)
    : null
  if (redirectClassification?.risk === 'blocked') return redirectClassification
  const trustedExecutable = hasTrustedExecutableIdentity(command)
  const bareExecutable = hasDirectBareExecutableIdentity(command)
  if (!trustedExecutable && !bareExecutable) {
    return result('unknown', '无法证明可执行程序身份，普通命令、alias、function 或非系统路径不进入严格安全分类')
  }
  const stripped = stripCommandPrefix(command)
  if (/^(?:systemctl|docker|podman)\s+restart\b/i.test(stripped) ||
    /^service\s+\S+\s+restart\b/i.test(stripped)) {
    if (/[$`*?[\]{}]/.test(stripped)) {
      return result('unknown', 'restart 目标包含动态 shell 展开，无法安全确定影响范围')
    }
    if (bareExecutable) {
      return result('change', '已识别裸修改命令，但无法证明 alias、function 或 PATH 身份，无法自动回滚', null, false)
    }
    return result('unknown', 'restart 无法自动恢复原进程、连接和运行时状态，不提供自动回滚')
  }
  if (redirectClassification) {
    if (trustedExecutable || redirectClassification.risk !== 'change') {
      return redirectClassification
    }
    return result('change', '已识别裸修改命令，但无法证明 alias、function 或 PATH 身份，无法自动回滚', null, false)
  }

  const provider = changeProvider(command)
  if (provider) {
    if (trustedExecutable) {
      return result('change', `${provider} 修改可创建已验证的恢复点`, provider)
    }
    return result('change', '已识别裸修改命令，但无法证明 alias、function 或 PATH 身份，无法自动回滚', null, false)
  }
  if (isRecognizedMutation(stripped)) {
    return result('change', '已识别修改命令，但没有可验证的自动恢复提供器', null, false)
  }
  if (isReadonly(command)) return result('readonly', '命令属于已识别的只读诊断操作')
  return result('unknown', '命令不在已验证的安全分类白名单中')
}

export function classifyCommand (command) {
  const text = String(command || '')
  if (!text) return result('unknown', '命令为空，无法分类')
  const parts = splitCommands(text)
  if (!parts.length) return result('unknown', '命令为空，无法分类')
  if (parts.some(isDatabaseClient) && hasDestructiveDatabaseOperation(text)) {
    return result('blocked', '命令包含明确禁止的不可逆操作')
  }

  const classifications = parts.map(classifySingle)
  const highestRank = Math.max(...classifications.map(item => riskRank[item.risk]))
  const highest = classifications.filter(item => riskRank[item.risk] === highestRank)
  if (parts.length > 1 && highestRank === riskRank.change) {
    const changeCount = classifications.filter(item => item.risk === 'change').length
    const reason = changeCount > 1
      ? '复合命令包含多个修改，无法生成统一自动回滚'
      : '复合命令包含多个 shell 段，无法生成统一自动回滚'
    return result('change', reason, null, false)
  }
  return highest[0]
}
