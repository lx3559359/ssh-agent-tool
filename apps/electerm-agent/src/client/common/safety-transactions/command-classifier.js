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
      if (current.trim()) parts.push(current.trim())
      current = ''
      index += 1
      continue
    }
    const isBackgroundOperator = character === '&' &&
      command[index - 1] !== '>' && command[index + 1] !== '>'
    if (character === ';' || character === '|' || character === '\n' || isBackgroundOperator) {
      if (current.trim()) parts.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function shellTokens (command) {
  const tokens = []
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s]+)/g
  let match
  while ((match = pattern.exec(command))) {
    tokens.push({
      value: match[1] ?? match[2] ?? match[3],
      start: match.index,
      end: pattern.lastIndex
    })
  }
  return tokens
}

function shellWords (command) {
  return shellTokens(command).map(token => token.value)
}

function executableName (value) {
  return String(value || '').replace(/^.*\//, '')
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

function isSafeAbsolutePath (value) {
  if (!value || !value.startsWith('/') || value === '/') return false
  if (/[\0\n\r*$?`[\]{}]/.test(value)) return false
  return !value.split('/').includes('..')
}

function hasUnsafeExpansion (command) {
  return /\$\(|(?:<|>)\s*\(|`|\$\{|(^|\s)(?:eval|source|\.)\s|(^|\s)(?:ba|z|k)?sh\s+-?c\b/i.test(command)
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
  if (/^rm(?:\s|$)/i.test(text)) {
    const words = shellWords(text).slice(1)
    const recursive = words.some(word => word === '--recursive' || /^-[^-]*r/i.test(word))
    const targets = words.filter(word => !word.startsWith('-'))
    if (recursive && targets.includes('/')) return true
  }
  if (/^dd(?:\s|$)/i.test(text)) {
    const outputMatch = text.match(/\bof\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/i)
    const output = outputMatch?.[1] ?? outputMatch?.[2] ?? outputMatch?.[3] ?? ''
    if (output.startsWith('/dev/')) {
      const allowedCharacterDevices = new Set([
        '/dev/null', '/dev/zero', '/dev/random', '/dev/urandom',
        '/dev/stdout', '/dev/stderr'
      ])
      return !allowedCharacterDevices.has(output)
    }
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
    const target = shellWords(tail)[0]
    redirects.push({ index, target })
    if (command[index + 1] === '>') index += 1
  }
  return redirects
}

function classifyRedirection (command, redirects) {
  const deviceTargets = redirects
    .map(redirect => redirect.target)
    .filter(target => target?.startsWith('/dev/'))
  const harmlessDevices = new Set(['/dev/null', '/dev/stdout', '/dev/stderr'])
  if (deviceTargets.some(target => !harmlessDevices.has(target))) {
    return result('blocked', '输出重定向指向设备节点，无法安全恢复')
  }
  if (deviceTargets.length) {
    return result('unknown', '输出重定向指向设备节点，不创建文件恢复点')
  }
  if (redirects.length !== 1 || !isSafeAbsolutePath(redirects[0].target)) {
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

function hasSedInPlaceOption (words) {
  return words.some(word => {
    if (word === '--in-place' || word.startsWith('--in-place=')) return true
    return word.startsWith('-') && !word.startsWith('--') &&
      word.slice(1).includes('i')
  })
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

function fileProvider (command) {
  const text = stripCommandPrefix(command)
  const words = shellWords(text)
  const executable = (words.shift() || '').toLowerCase()
  const positional = words.filter(word => !word.startsWith('-'))

  if (executable === 'tee') {
    return positional.length === 1 && isSafeAbsolutePath(positional[0])
  }
  if (executable === 'find') {
    const output = findOutputTargets(words)
    return !hasUnsafeFindAction(words) &&
      output.hasOutputAction && output.targets.every(isSafeAbsolutePath)
  }
  if (executable === 'sed' && hasSedInPlaceOption(words)) {
    const scriptIndex = words.findIndex(word => !word.startsWith('-'))
    const targets = scriptIndex === -1 ? [] : words.slice(scriptIndex + 1)
    return targets.length > 0 && targets.every(isSafeAbsolutePath)
  }
  if (executable === 'truncate') {
    return positional.length > 0 && positional.every(isSafeAbsolutePath)
  }
  if (executable === 'rm') {
    const recursive = words.some(word => /^-[^-]*r/i.test(word) || word === '--recursive')
    const safeTargets = positional.length > 0 && positional.every(isSafeAbsolutePath)
    const rootLevelTarget = positional.some(word => word.split('/').filter(Boolean).length < 2)
    return safeTargets && !(recursive && rootLevelTarget)
  }
  if (executable === 'cp' || executable === 'mv') {
    return positional.length >= 2 && positional.every(isSafeAbsolutePath)
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
  if (/^systemctl\s+(?:start|stop|restart|reload|enable|disable)\s+\S+/i.test(text) || /^service\s+\S+\s+(?:start|stop|restart|reload)\b/i.test(text)) return 'systemd'
  if (permissionsProvider(text)) return 'permissions'
  if (/^firewall-cmd\b.*\s--(?:add|remove)-[A-Za-z-]+\b/i.test(text) || /^ufw\s+(?:allow|deny|reject|delete|enable|disable)\b/i.test(text) || /^(?:iptables|ip6tables)\s+-(?:A|D|I|R|N|X|P)\b/i.test(text) || /^nft\s+(?:add|delete|insert|replace)\b/i.test(text)) return 'firewall'
  if (/^nmcli\s+(?:connection|con)\s+(?:modify|up|down)\s+\S+/i.test(text) || /^ip\s+(?:addr(?:ess)?|route)\s+(?:add|del|delete|replace)\s+\S+/i.test(text) || /^ip\s+addr(?:ess)?\s+flush\s+dev\s+\S+/i.test(text) || /^ip\s+link\s+set\s+(?:dev\s+)?\S+\s+\S+/i.test(text) || /^ifconfig\s+\S+\s+(?:up|down|netmask|mtu|broadcast|[0-9a-f:.]+)\b/i.test(text)) return 'network'
  if (/^(?:docker|podman)\s+(?:start|stop|restart)\s+\S+/i.test(text)) return 'docker'
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

function isReadonlySed (words) {
  if (hasSedInPlaceOption(words.slice(1))) return false
  const allowedLongOptions = /^(?:--quiet|--silent|--regexp-extended|--separate|--unbuffered|--null-data|--expression|--file|--sandbox|--posix|--debug|--help|--version|--follow-symlinks)(?:=\S+)?$/
  return words.slice(1).every(word => {
    if (!word.startsWith('-')) return true
    return /^-[nErsuzef]+$/.test(word) || allowedLongOptions.test(word)
  })
}

function isReadonly (command) {
  const text = stripCommandPrefix(command)
  const words = shellWords(text)
  const executable = (words[0] || '').toLowerCase()
  if (inherentlyReadonlyCommands.has(executable)) return true
  if (executable === 'hostname') return words.length === 1
  if (executable === 'date') return isReadonlyDate(words)
  if (executable === 'journalctl') return isReadonlyJournalctl(words)
  if (executable === 'ss') return isReadonlySs(words)
  if (executable === 'sed') return isReadonlySed(words)
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
  if (executable === 'iptables' || executable === 'ip6tables') return /^-(?:L|S)$/.test(words[1] || '')
  if (executable === 'nft') return words[1]?.toLowerCase() === 'list'
  if (executable === 'ifconfig') return words.length <= 2 && (!words[1] || words[1] === '-a' || !words[1].startsWith('-'))
  if (executable === 'docker' || executable === 'podman') return ['ps', 'logs', 'inspect', 'stats'].includes(words[1]?.toLowerCase())
  return false
}

function classifySingle (command) {
  if (isBlocked(command)) {
    return result('blocked', '命令包含明确禁止的不可逆操作')
  }
  if (hasUnsafeExpansion(command)) {
    return result('unknown', '命令包含动态执行或脚本解释器，无法安全解析')
  }
  const redirects = findRedirection(command)
  if (redirects.length) return classifyRedirection(command, redirects)

  const provider = changeProvider(command)
  if (provider) return result('change', `${provider} 修改可创建已验证的恢复点`, provider)
  if (isReadonly(command)) return result('readonly', '命令属于已识别的只读诊断操作')
  return result('unknown', '命令不在已验证的安全分类白名单中')
}

export function classifyCommand (command) {
  const text = String(command || '').trim()
  if (!text) return result('unknown', '命令为空，无法分类')
  const parts = splitCommands(text)
  if (!parts.length) return result('unknown', '命令为空，无法分类')
  if (parts.some(isDatabaseClient) && hasDestructiveDatabaseOperation(text)) {
    return result('blocked', '命令包含明确禁止的不可逆操作')
  }

  const classifications = parts.map(classifySingle)
  const highestRank = Math.max(...classifications.map(item => riskRank[item.risk]))
  const highest = classifications.filter(item => riskRank[item.risk] === highestRank)
  if (highestRank === riskRank.change) {
    const providers = [...new Set(highest.map(item => item.provider))]
    if (providers.length !== 1) {
      return result('change', '复合命令包含多个修改，无法生成统一自动回滚', null, false)
    }
  }
  return highest[0]
}
