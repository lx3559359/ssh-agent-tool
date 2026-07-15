import { redactAuditText } from './audit-redaction.js'
import {
  classifyCommand,
  isTrustedExecutablePath,
  tokenizeStaticShell
} from './command-classifier.js'
import { buildVerifiedRemoteAction } from './remote-recovery.js'

const safeIdPattern = /^[A-Za-z0-9_-]+$/
const supportedProviders = new Set([
  'file',
  'permissions',
  'systemd',
  'firewall',
  'network',
  'docker'
])
const blockedPathRoots = ['/dev', '/proc', '/sys', '/run', '/var/run']

export class RecoveryProviderError extends Error {
  constructor (message, options = {}) {
    super(message)
    this.name = 'RecoveryProviderError'
    if (typeof options.allowUnsafeExecute === 'boolean') {
      this.allowUnsafeExecute = options.allowUnsafeExecute
    }
  }
}

function refuse (message, provider) {
  throw new RecoveryProviderError(`拒绝自动回滚：${message}`, {
    allowUnsafeExecute: provider === 'network' ? false : undefined
  })
}

function shellQuote (value) {
  const escaped = String(value).replace(/'/g, '\'"\'"\'')
  return '\'' + escaped + '\''
}

function writeShellScript (script, target) {
  const text = String(script || '')
  if (!text.endsWith('\n') || /[\0\r]/.test(text)) {
    throw new Error('恢复脚本必须是无控制字符且以换行结尾的静态文本。')
  }
  const lines = text.slice(0, -1).split('\n').map(shellQuote).join(' ')
  return `printf '%s\\n' ${lines} > ${target}`
}

function executableName (value) {
  return String(value || '').replace(/^.*\//, '').toLowerCase()
}

function isEnvironmentAssignment (value) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value)
}

function parseInvocation (command) {
  const tokens = tokenizeStaticShell(command)
  let index = 0
  if (isEnvironmentAssignment(tokens[index] || '')) {
    throw new Error('恢复命令不接受改变 executable 语义的前置环境变量。')
  }
  let privileged = false
  let sudoExecutable = ''
  if (executableName(tokens[index]) === 'sudo') {
    if (!isTrustedExecutablePath(tokens[index])) {
      throw new Error('sudo 必须使用可信绝对系统路径。')
    }
    sudoExecutable = tokens[index]
    privileged = true
    index += 1
    let nonInteractive = false
    while (tokens[index]?.startsWith('-')) {
      if (tokens[index] === '--') {
        index += 1
        break
      }
      if (!['-n', '--non-interactive'].includes(tokens[index])) {
        throw new Error('sudo 仅支持非交互参数。')
      }
      nonInteractive = true
      index += 1
    }
    if (!nonInteractive) {
      throw new Error('sudo 恢复命令必须显式使用 -n 或 --non-interactive。')
    }
    if (isEnvironmentAssignment(tokens[index] || '')) {
      throw new Error('sudo 后不接受改变 executable 语义的环境变量。')
    }
  }
  if (!tokens[index]) throw new Error('命令缺少可执行程序。')
  if (!isTrustedExecutablePath(tokens[index])) {
    throw new Error('恢复 provider 仅接受可信绝对系统 executable。')
  }
  return {
    words: tokens.slice(index),
    privilege: privileged ? `${shellQuote(sudoExecutable)} -n ` : ''
  }
}

function invocationTool (invocation) {
  return `${invocation.privilege}${shellQuote(invocation.words[0])}`
}

function assertSafeName (value, label, pattern = /^[A-Za-z0-9_.:@-]+$/) {
  const text = String(value || '')
  if (!text || !pattern.test(text) || /[$`*?[\]{}]/.test(text) || /[@?!+*]\(/.test(text)) {
    throw new Error(`${label}不是静态安全目标。`)
  }
  return text
}

function assertOrdinaryAbsolutePath (value, label = '路径') {
  const target = String(value || '')
  const hasControlCharacter = [...target].some(character => character.charCodeAt(0) <= 31)
  if (!target.startsWith('/') || target === '/' || hasControlCharacter ||
    /[$`*?[\]{}]/.test(target) || /[@?!+*]\(/.test(target)) {
    throw new Error(`${label}必须是无动态展开的绝对普通路径。`)
  }
  if (target.includes('//') || target.split('/').includes('..')) {
    throw new Error(`${label}包含不安全路径片段。`)
  }
  if (blockedPathRoots.some(root => target === root || target.startsWith(`${root}/`))) {
    throw new Error(`${label}指向虚拟或运行时文件系统。`)
  }
  return target
}

function findRedirection (command) {
  let quote = ''
  let escaped = false
  let found = null
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
    if (/[;|&<]/.test(character)) {
      throw new Error('文件命令包含无法静态恢复的 shell 控制符。')
    }
    if (character !== '>') continue
    if (found || /\d/.test(command[index - 1] || '')) {
      throw new Error('仅支持单一标准输出重定向目标。')
    }
    const append = command[index + 1] === '>'
    found = { index, length: append ? 2 : 1 }
    if (append) index += 1
  }
  if (quote || escaped) throw new Error('文件命令引号或转义不完整。')
  return found
}

function parseFileRedirection (command) {
  const redirect = findRedirection(command)
  if (!redirect) return null
  const left = command.slice(0, redirect.index).trim()
  const right = command.slice(redirect.index + redirect.length).trimStart()
  const invocation = parseInvocation(left)
  const targets = tokenizeStaticShell(right)
  if (targets.length !== 1) throw new Error('重定向必须只有一个静态目标。')
  if (!['echo', 'printf', 'cat'].includes(executableName(invocation.words[0]))) {
    throw new Error('首版仅支持 echo、printf 或 cat 的文件重定向。')
  }
  return {
    kind: 'write',
    target: assertOrdinaryAbsolutePath(targets[0], '重定向目标'),
    privilege: invocation.privilege
  }
}

function parseSimplePositionals (words, allowedOptions) {
  const positional = []
  let optionsEnded = false
  for (const word of words) {
    if (!optionsEnded && word === '--') {
      optionsEnded = true
      continue
    }
    if (!optionsEnded && word.startsWith('-')) {
      if (!allowedOptions.has(word)) throw new Error(`不支持选项 ${word}。`)
      continue
    }
    positional.push(word)
  }
  return positional
}

function parseSedTarget (words) {
  let inPlace = false
  let usesExpression = false
  const positional = []
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]
    if (word === '--') {
      positional.push(...words.slice(index + 1))
      break
    }
    if (word === '--in-place' || word.startsWith('--in-place=')) {
      inPlace = true
      continue
    }
    if (word === '-e' || word === '--expression') {
      if (!words[index + 1]) throw new Error('sed 缺少表达式。')
      usesExpression = true
      index += 1
      continue
    }
    if (word.startsWith('--expression=')) {
      usesExpression = true
      continue
    }
    if (/^-[^-]/.test(word)) {
      if (word.includes('f')) throw new Error('sed 外部脚本不支持自动回滚。')
      if (word.includes('i')) inPlace = true
      if (![...word.slice(1)].every(option => 'inErsuz'.includes(option) || /[.A-Za-z0-9_-]/.test(option))) {
        throw new Error('sed 包含不支持的选项。')
      }
      continue
    }
    positional.push(word)
  }
  if (!inPlace) throw new Error('sed 必须是原地修改。')
  const files = usesExpression ? positional : positional.slice(1)
  if ((!usesExpression && positional.length < 2) || files.length !== 1) {
    throw new Error('sed 首版只支持一个静态文件目标。')
  }
  return assertOrdinaryAbsolutePath(files[0], 'sed 目标')
}

function parseFileCommand (command) {
  const redirected = parseFileRedirection(command)
  if (redirected) return redirected
  const invocation = parseInvocation(command)
  const executable = executableName(invocation.words[0])
  const args = invocation.words.slice(1)

  if (executable === 'rm') {
    const targets = parseSimplePositionals(args, new Set(['-f', '--force']))
    if (targets.length !== 1) throw new Error('rm 首版只支持一个普通文件目标。')
    return {
      kind: 'write',
      target: assertOrdinaryAbsolutePath(targets[0], 'rm 目标'),
      privilege: invocation.privilege
    }
  }
  if (executable === 'cp' || executable === 'mv') {
    const targets = parseSimplePositionals(args, new Set(['-f', '--force']))
    if (targets.length !== 2) throw new Error(`${executable} 首版只支持一个源文件和一个目标文件。`)
    return {
      kind: executable,
      source: assertOrdinaryAbsolutePath(targets[0], `${executable} 源文件`),
      target: assertOrdinaryAbsolutePath(targets[1], `${executable} 目标文件`),
      privilege: invocation.privilege
    }
  }
  if (executable === 'sed') {
    return {
      kind: 'write',
      target: parseSedTarget(invocation.words),
      privilege: invocation.privilege
    }
  }
  if (executable === 'truncate') {
    const targets = []
    for (let index = 0; index < args.length; index += 1) {
      const word = args[index]
      if (word === '-c' || word === '--no-create') continue
      if (word === '-s' || word === '--size') {
        if (!args[index + 1] || !/^[+-]?\d+[KMGTPEZY]?$/.test(args[index + 1])) {
          throw new Error('truncate 大小参数无法静态解析。')
        }
        index += 1
        continue
      }
      if (/^-s[+-]?\d+[KMGTPEZY]?$/.test(word)) continue
      if (/^--size=[+-]?\d+[KMGTPEZY]?$/.test(word)) continue
      if (word.startsWith('-')) throw new Error(`truncate 不支持选项 ${word}。`)
      targets.push(word)
    }
    if (targets.length !== 1) throw new Error('truncate 首版只支持一个文件目标。')
    return {
      kind: 'write',
      target: assertOrdinaryAbsolutePath(targets[0], 'truncate 目标'),
      privilege: invocation.privilege
    }
  }
  throw new Error('文件提供器首版只支持 rm、mv、cp、sed -i、truncate 和静态重定向。')
}

function captureFileCommands (target, prefix, name, required = false) {
  const quotedTarget = shellQuote(target)
  const artifactPrefix = name === 'target' ? '' : `${name}-`
  const existed = `"$operation_dir/backup/${artifactPrefix}existed"`
  const metadata = `"$operation_dir/backup/${artifactPrefix}metadata"`
  const backup = `"$operation_dir/backup/${artifactPrefix}original"`
  const missing = required
    ? `echo ${shellQuote('恢复目标不存在，无法创建文件恢复点。')} >&2; exit 42`
    : `printf '0\\n' > ${existed}; printf '%s\\n' '- - -' > ${metadata}`
  return `if ${prefix}test -L ${quotedTarget}; then echo ${shellQuote('拒绝为符号链接生成文件恢复点。')} >&2; exit 42; fi; if ${prefix}test -e ${quotedTarget}; then ${prefix}test -f ${quotedTarget}; ${prefix}test ! -L ${quotedTarget}; printf '1\\n' > ${existed}; ${prefix}stat -c '%a %u %g' -- ${quotedTarget} > ${metadata}; ${prefix}cp -a -- ${quotedTarget} ${backup}; ${prefix}chmod 600 ${backup}; else ${missing}; fi`
}

function restoreFileLines (target, prefix, name) {
  const variable = name.replace(/-/g, '_')
  const artifactPrefix = name === 'target' ? '' : `${name}-`
  return [
    `${variable}_target=${shellQuote(target)}`,
    `${variable}_existed=$(cat "$operation_dir/backup/${artifactPrefix}existed")`,
    `if [ "$${variable}_existed" = '1' ]; then`,
    `${prefix}test -f "$operation_dir/backup/${artifactPrefix}original"`,
    `${prefix}rm -f -- "$${variable}_target"`,
    `${prefix}cp -a -- "$operation_dir/backup/${artifactPrefix}original" "$${variable}_target"`,
    `IFS=' ' read -r mode uid gid < "$operation_dir/backup/${artifactPrefix}metadata"`,
    'case "$mode:$uid:$gid" in *[!0-9:]*) exit 43;; esac',
    `${prefix}chown "$uid:$gid" -- "$${variable}_target"`,
    `${prefix}chmod "$mode" -- "$${variable}_target"`,
    'else',
    `${prefix}test ! -d "$${variable}_target"`,
    `${prefix}rm -f -- "$${variable}_target"`,
    'fi'
  ]
}

function verifyFileLines (target, prefix, name) {
  const variable = name.replace(/-/g, '_')
  const artifactPrefix = name === 'target' ? '' : `${name}-`
  return [
    `${variable}_target=${shellQuote(target)}`,
    `${variable}_existed=$(cat "$operation_dir/backup/${artifactPrefix}existed")`,
    `if [ "$${variable}_existed" = '1' ]; then`,
    `${prefix}cmp -s -- "$operation_dir/backup/${artifactPrefix}original" "$${variable}_target"`,
    `expected=$(cat "$operation_dir/backup/${artifactPrefix}metadata")`,
    `current=$(${prefix}stat -c '%a %u %g' -- "$${variable}_target")`,
    '[ "$current" = "$expected" ]',
    `else ${prefix}test ! -e "$${variable}_target"; fi`
  ]
}

function scriptHeader (id) {
  return [
    '#!/bin/sh',
    'set -eu',
    `operation_dir=$HOME/.shellpilot/operations/${id}`
  ]
}

function buildFileProvider (command, id) {
  const parsed = parseFileCommand(command)
  const captureCommands = []
  if (parsed.kind === 'cp') {
    captureCommands.push(`${parsed.privilege}test -f ${shellQuote(parsed.source)}; ${parsed.privilege}test ! -L ${shellQuote(parsed.source)}`)
  }
  if (parsed.kind === 'mv') {
    captureCommands.push(captureFileCommands(parsed.source, parsed.privilege, 'source', true))
  }
  captureCommands.push(captureFileCommands(parsed.target, parsed.privilege, 'target'))

  const rollback = [...scriptHeader(id)]
  const verify = [...scriptHeader(id)]
  if (parsed.kind === 'mv') {
    rollback.push(...restoreFileLines(parsed.target, parsed.privilege, 'target'))
    rollback.push(...restoreFileLines(parsed.source, parsed.privilege, 'source'))
    verify.push(...verifyFileLines(parsed.target, parsed.privilege, 'target'))
    verify.push(...verifyFileLines(parsed.source, parsed.privilege, 'source'))
  } else {
    rollback.push(...restoreFileLines(parsed.target, parsed.privilege, 'target'))
    verify.push(...verifyFileLines(parsed.target, parsed.privilege, 'target'))
  }
  return {
    captureCommands,
    rollbackScript: rollback.join('\n') + '\n',
    verifyScript: verify.join('\n') + '\n',
    summary: `为文件 ${parsed.target} 保存存在性、内容和数字元数据。`,
    target: parsed.target,
    stateArtifacts: parsed.kind === 'mv'
      ? ['backup/source-existed', 'backup/source-metadata', 'backup/source-original', 'backup/existed', 'backup/metadata', 'backup/original']
      : ['backup/existed', 'backup/metadata', 'backup/original']
  }
}

function buildPermissionsProvider (command, id) {
  const invocation = parseInvocation(command)
  const executable = executableName(invocation.words[0])
  if (!['chmod', 'chown'].includes(executable) || invocation.words.length !== 3) {
    throw new Error('权限提供器首版只支持静态单一路径 chmod/chown。')
  }
  if (invocation.words[1].startsWith('-')) throw new Error('权限递归或选项形式不支持自动回滚。')
  const target = assertOrdinaryAbsolutePath(invocation.words[2], '权限目标')
  const quotedTarget = shellQuote(target)
  const prefix = invocation.privilege
  const tool = invocationTool(invocation)
  const chmod = executable === 'chmod' ? tool : `${prefix}chmod`
  const chown = executable === 'chown' ? tool : `${prefix}chown`
  const rollback = [
    ...scriptHeader(id),
    `target=${quotedTarget}`,
    'IFS=\' \' read -r mode uid gid < "$operation_dir/backup/permissions-state"',
    'case "$mode:$uid:$gid" in *[!0-9:]*) exit 43;; esac',
    `${chown} "$uid:$gid" -- "$target"`,
    `${chmod} "$mode" -- "$target"`
  ]
  const verify = [
    ...scriptHeader(id),
    `target=${quotedTarget}`,
    'expected=$(cat "$operation_dir/backup/permissions-state")',
    `current=$(${prefix}stat -c '%a %u %g' -- "$target")`,
    '[ "$current" = "$expected" ]'
  ]
  return {
    captureCommands: [
      `${prefix}test ! -L ${quotedTarget}`,
      `${prefix}test -e ${quotedTarget}`,
      `${prefix}stat -c '%a %u %g' -- ${quotedTarget} > "$operation_dir/backup/permissions-state"`
    ],
    rollbackScript: rollback.join('\n') + '\n',
    verifyScript: verify.join('\n') + '\n',
    summary: `记录权限目标 ${target} 的 numeric mode、uid 和 gid。`,
    target,
    stateArtifacts: ['backup/permissions-state']
  }
}

function buildSystemdProvider (command, id) {
  const invocation = parseInvocation(command)
  const words = invocation.words
  if (executableName(words[0]) === 'systemctl' && words[1] === 'reload') {
    throw new Error('systemd reload 无法撤销，首版拒绝自动回滚。')
  }
  if (executableName(words[0]) === 'systemctl' && words[1] === 'restart') {
    throw new Error('systemd restart 无法自动恢复原进程和连接状态。')
  }
  if (executableName(words[0]) !== 'systemctl' || words.length !== 3 ||
    !['start', 'stop', 'enable', 'disable'].includes(words[1])) {
    throw new Error('systemd 首版只支持静态单服务 start/stop/enable/disable。')
  }
  const service = assertSafeName(words[2], 'systemd 服务')
  const quotedService = shellQuote(service)
  const tool = invocationTool(invocation)
  const activeQuery = `${tool} is-active -- ${quotedService} 2>/dev/null || true`
  const enabledQuery = `${tool} is-enabled -- ${quotedService} 2>/dev/null || true`
  const rollback = [
    ...scriptHeader(id),
    `service=${quotedService}`,
    'old_active=$(cat "$operation_dir/backup/old-active")',
    'old_enabled=$(cat "$operation_dir/backup/old-enabled")',
    `case "$old_enabled" in enabled) ${tool} enable -- "$service";; disabled) ${tool} disable -- "$service";; *) exit 43;; esac`,
    `case "$old_active" in active) ${tool} start -- "$service";; inactive) ${tool} stop -- "$service";; *) exit 43;; esac`
  ]
  const verify = [
    ...scriptHeader(id),
    `service=${quotedService}`,
    'old_active=$(cat "$operation_dir/backup/old-active")',
    'old_enabled=$(cat "$operation_dir/backup/old-enabled")',
    `current_active=$(${tool} is-active -- "$service" 2>/dev/null || true)`,
    `current_enabled=$(${tool} is-enabled -- "$service" 2>/dev/null || true)`,
    'printf \'active=%s\\nenabled=%s\\n\' "$current_active" "$current_enabled"',
    '[ "$current_active" = "$old_active" ]',
    '[ "$current_enabled" = "$old_enabled" ]'
  ]
  return {
    captureCommands: [
      `old_active=$(${activeQuery}); case "$old_active" in active|inactive) :;; *) echo ${shellQuote('systemd 当前 active 状态无法精确自动恢复。')} >&2; exit 42;; esac; printf '%s\\n' "$old_active" > "$operation_dir/backup/old-active"`,
      `old_enabled=$(${enabledQuery}); case "$old_enabled" in enabled|disabled) :;; *) echo ${shellQuote('systemd 当前 enabled 状态无法精确自动恢复。')} >&2; exit 42;; esac; printf '%s\\n' "$old_enabled" > "$operation_dir/backup/old-enabled"`
    ],
    rollbackScript: rollback.join('\n') + '\n',
    verifyScript: verify.join('\n') + '\n',
    summary: `记录 systemd 服务 ${service} 的 active 与 enabled 状态。`,
    target: service,
    stateArtifacts: ['backup/old-active', 'backup/old-enabled']
  }
}

function buildDockerProvider (command, id) {
  const invocation = parseInvocation(command)
  const words = invocation.words
  if (executableName(words[0]) === 'docker' && words[1] === 'restart') {
    throw new Error('Docker restart 无法自动恢复原进程和连接状态。')
  }
  if (executableName(words[0]) !== 'docker' || words.length !== 3 ||
    !['start', 'stop'].includes(words[1])) {
    throw new Error('Docker 首版只支持静态单容器 start/stop，restart/rm 不提供自动回滚。')
  }
  const container = assertSafeName(words[2], 'Docker 容器', /^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
  const quotedContainer = shellQuote(container)
  const tool = invocationTool(invocation)
  const inspect = `${tool} inspect -f '{{.State.Running}}' -- ${quotedContainer}`
  const rollback = [
    ...scriptHeader(id),
    `container=${quotedContainer}`,
    'running=$(cat "$operation_dir/backup/running")',
    `case "$running" in true) ${tool} start -- "$container" >/dev/null;; false) ${tool} stop -- "$container" >/dev/null;; *) exit 43;; esac`
  ]
  const verify = [
    ...scriptHeader(id),
    `container=${quotedContainer}`,
    `current=$(${tool} inspect -f '{{.State.Running}}' -- "$container")`,
    'expected=$(cat "$operation_dir/backup/running")',
    'printf \'running=%s\\n\' "$current"',
    '[ "$current" = "$expected" ]'
  ]
  return {
    captureCommands: [`${inspect} > "$operation_dir/backup/running"`],
    rollbackScript: rollback.join('\n') + '\n',
    verifyScript: verify.join('\n') + '\n',
    summary: `记录 Docker 容器 ${container} 的 Running 状态。`,
    target: container,
    stateArtifacts: ['backup/running']
  }
}

function assertPort (value) {
  const match = String(value || '').match(/^(\d{1,5})\/(tcp|udp)$/i)
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) {
    throw new Error('防火墙端口必须是静态的 1-65535/tcp 或 udp。')
  }
  return `${Number(match[1])}/${match[2].toLowerCase()}`
}

function parseFirewalld (invocation) {
  let permanent = false
  let zone = ''
  let action = ''
  let port = ''
  for (let index = 1; index < invocation.words.length; index += 1) {
    const word = invocation.words[index]
    if (word === '--permanent') {
      permanent = true
    } else if (word.startsWith('--zone=')) {
      if (zone) throw new Error('firewalld 首版只允许一个显式 zone。')
      zone = assertSafeName(word.slice(7), 'firewalld zone', /^[A-Za-z0-9_-]+$/)
    } else if (word === '--zone') {
      if (zone) throw new Error('firewalld 首版只允许一个显式 zone。')
      zone = assertSafeName(invocation.words[++index], 'firewalld zone', /^[A-Za-z0-9_-]+$/)
    } else if (word.startsWith('--add-port=') || word.startsWith('--remove-port=')) {
      if (action) throw new Error('firewalld 首版只允许单一端口修改动作。')
      action = word.startsWith('--add-port=') ? 'add' : 'remove'
      port = assertPort(word.slice(word.indexOf('=') + 1))
    } else if (word === '--add-port' || word === '--remove-port') {
      if (action) throw new Error('firewalld 首版只允许单一端口修改动作。')
      action = word === '--add-port' ? 'add' : 'remove'
      port = assertPort(invocation.words[++index])
    } else {
      throw new Error(`firewalld 首版不支持参数 ${word}。`)
    }
  }
  if (!action || !port) throw new Error('firewalld 仅支持单一端口 add/remove。')
  if (!zone) throw new Error('firewalld 自动回滚要求显式指定静态 --zone，默认 zone 命令已拒绝。')
  return { action, port, permanent, zone }
}

function buildFirewalldProvider (invocation, id) {
  const parsed = parseFirewalld(invocation)
  const tool = invocationTool(invocation)
  const options = `${parsed.permanent ? ' --permanent' : ''} --zone=${parsed.zone}`
  const query = `${tool}${options} --query-port=${parsed.port}`
  const add = `${tool}${options} --add-port=${parsed.port}`
  const remove = `${tool}${options} --remove-port=${parsed.port}`
  const rollback = [
    ...scriptHeader(id),
    'present=$(cat "$operation_dir/backup/rule-present")',
    `case "$present" in 1) ${add} >/dev/null;; 0) ${remove} >/dev/null 2>&1 || true;; *) exit 43;; esac`
  ]
  const verify = [
    ...scriptHeader(id),
    `if ${query} >/dev/null 2>&1; then query_rc=0; else query_rc=$?; fi`,
    `case "$query_rc" in 0) current=1;; 1) current=0;; *) echo ${shellQuote('firewalld 规则查询失败，退出码')} "$query_rc" >&2; exit 43;; esac`,
    'expected=$(cat "$operation_dir/backup/rule-present")',
    'printf \'present=%s\\n\' "$current"',
    '[ "$current" = "$expected" ]'
  ]
  return {
    captureCommands: [
      `if ${query} >/dev/null 2>&1; then query_rc=0; else query_rc=$?; fi; case "$query_rc" in 0) printf '1\\n' > "$operation_dir/backup/rule-present";; 1) printf '0\\n' > "$operation_dir/backup/rule-present";; *) echo ${shellQuote('firewalld 规则查询失败，退出码')} "$query_rc" >&2; exit 42;; esac`
    ],
    rollbackScript: rollback.join('\n') + '\n',
    verifyScript: verify.join('\n') + '\n',
    summary: `记录 firewalld 端口规则 ${parsed.port} 修改前是否存在。`,
    target: `${parsed.zone}:${parsed.port}`,
    stateArtifacts: ['backup/rule-present']
  }
}

function captureQueryOutput (command, outputVariable, errorLabel, exitCode) {
  return `if ${outputVariable}=$(${command}); then :; else query_rc=$?; echo ${shellQuote(errorLabel)} "$query_rc" >&2; exit ${exitCode}; fi`
}

function exactLineState (outputVariable, expected, stateVariable, errorLabel, exitCode) {
  return `if printf '%s\\n' "$${outputVariable}" | grep -Fqx -- ${expected}; then ${stateVariable}=1; else match_rc=$?; case "$match_rc" in 1) ${stateVariable}=0;; *) echo ${shellQuote(errorLabel)} "$match_rc" >&2; exit ${exitCode};; esac; fi`
}

function buildUfwProvider (invocation, id) {
  const words = invocation.words.slice(1)
  if (words[0] === '--force') words.shift()
  let port
  if (words.length === 2 && words[0] === 'allow') port = assertPort(words[1])
  if (words.length === 3 && words[0] === 'delete' && words[1] === 'allow') port = assertPort(words[2])
  if (!port) throw new Error('ufw 首版只支持单一端口 allow 或 delete allow。')
  const tool = invocationTool(invocation)
  const canonical = shellQuote(`ufw allow ${port}`)
  const query = `${tool} show added`
  const add = `${tool} allow ${port}`
  const remove = `${tool} --force delete allow ${port}`
  const queryState = (stateVariable, exitCode) => [
    captureQueryOutput(query, 'ufw_output', 'ufw 查询失败，退出码', exitCode),
    exactLineState('ufw_output', canonical, stateVariable, 'ufw 输出匹配失败，退出码', exitCode)
  ]
  const rollback = [
    ...scriptHeader(id),
    'present=$(cat "$operation_dir/backup/rule-present")',
    `case "$present" in 1) ${add} >/dev/null;; 0) ${remove} >/dev/null 2>&1 || true;; *) exit 43;; esac`
  ]
  const verify = [
    ...scriptHeader(id),
    ...queryState('current', 43),
    'expected=$(cat "$operation_dir/backup/rule-present")',
    'printf \'present=%s\\n\' "$current"',
    '[ "$current" = "$expected" ]'
  ]
  return {
    captureCommands: [
      ...queryState('current', 42),
      'printf \'%s\\n\' "$current" > "$operation_dir/backup/rule-present"'
    ],
    rollbackScript: rollback.join('\n') + '\n',
    verifyScript: verify.join('\n') + '\n',
    summary: `记录 ufw 端口规则 ${port} 修改前是否存在。`,
    target: port,
    stateArtifacts: ['backup/rule-present']
  }
}

function buildFirewallProvider (command, id) {
  const invocation = parseInvocation(command)
  const executable = executableName(invocation.words[0])
  if (executable === 'firewall-cmd') return buildFirewalldProvider(invocation, id)
  if (executable === 'ufw') return buildUfwProvider(invocation, id)
  throw new Error('防火墙首版拒绝复杂 iptables/nft，只支持可精确求逆的 firewalld/ufw 端口规则。')
}

function assertCidr (value) {
  const text = String(value || '')
  const slash = text.lastIndexOf('/')
  const address = text.slice(0, slash)
  const prefix = Number(text.slice(slash + 1))
  if (address.includes(':')) {
    throw new Error('网络首版仅支持 IPv4 CIDR，IPv6 地址拒绝自动回滚。')
  }
  const ipv4 = address.split('.')
  const validIpv4 = ipv4.length === 4 && ipv4.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  if (!validIpv4 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('网络地址必须是静态有效 CIDR。')
  }
  return text
}

function buildNetworkProvider (command, id) {
  const invocation = parseInvocation(command)
  const words = invocation.words
  if (executableName(words[0]) !== 'ip' || words.length !== 6 ||
    !['addr', 'address'].includes(words[1]) || !['add', 'del', 'delete'].includes(words[2]) ||
    words[4] !== 'dev') {
    throw new Error('网络首版只支持 ip addr add/del <静态CIDR> dev <静态接口>；nmcli、路由、链路和 flush 均拒绝自动恢复。')
  }
  const action = words[2] === 'add' ? 'add' : 'del'
  const cidr = assertCidr(words[3])
  const iface = assertSafeName(words[5], '网络接口', /^[A-Za-z0-9_.:-]+$/)
  const tool = invocationTool(invocation)
  const quotedCidr = shellQuote(cidr)
  const quotedIface = shellQuote(iface)
  const addressQuery = `${tool} -o addr show dev ${quotedIface}`
  const primaryQuery = `${addressQuery} scope global primary`
  const add = `${tool} addr add ${quotedCidr} dev ${quotedIface}`
  const remove = `${tool} addr del ${quotedCidr} dev ${quotedIface}`
  const queryState = (stateVariable, exitCode) => [
    captureQueryOutput(addressQuery, 'address_output', '网络地址查询失败，退出码', exitCode),
    `if address_values=$(printf '%s\\n' "$address_output" | awk '{print $4}'); then :; else parse_rc=$?; echo ${shellQuote('网络地址解析失败，退出码')} "$parse_rc" >&2; exit ${exitCode}; fi`,
    exactLineState('address_values', quotedCidr, stateVariable, '网络地址匹配失败，退出码', exitCode)
  ]
  const captureCommands = []
  captureCommands.push(
    captureQueryOutput(primaryQuery, 'primary_output', '网络主 IP 查询失败，退出码', 42),
    `if primary_addresses=$(printf '%s\\n' "$primary_output" | awk '$3 == "inet" {print $4}'); then :; else parse_rc=$?; echo ${shellQuote('网络主 IP 解析失败，退出码')} "$parse_rc" >&2; exit 42; fi`
  )
  if (action === 'del') {
    captureCommands.push(
      exactLineState('primary_addresses', quotedCidr, 'target_is_primary', '网络主 IP 匹配失败，退出码', 42),
      `if [ "$target_is_primary" = '1' ]; then echo ${shellQuote('拒绝删除主 IP，无法安全自动恢复。')} >&2; exit 45; fi`
    )
  }
  captureCommands.push(
    ...queryState('current', 42),
    'printf \'%s\\n\' "$current" > "$operation_dir/backup/address-present"'
  )
  const rollback = [
    ...scriptHeader(id),
    'present=$(cat "$operation_dir/backup/address-present")',
    ...queryState('current', 43),
    `case "$present:$current" in 1:0) ${add};; 0:1) ${remove};; 1:1|0:0) :;; *) exit 43;; esac`
  ]
  const verify = [
    ...scriptHeader(id),
    ...queryState('current', 43),
    'expected=$(cat "$operation_dir/backup/address-present")',
    'printf \'present=%s\\n\' "$current"',
    '[ "$current" = "$expected" ]'
  ]
  return {
    captureCommands,
    rollbackScript: rollback.join('\n') + '\n',
    verifyScript: verify.join('\n') + '\n',
    summary: `记录接口 ${iface} 上地址 ${cidr} 修改前是否存在；网络修改禁止绕过恢复保护。`,
    target: `${cidr} dev ${iface}`,
    stateArtifacts: ['backup/address-present']
  }
}

const providerBuilders = {
  file: buildFileProvider,
  permissions: buildPermissionsProvider,
  systemd: buildSystemdProvider,
  firewall: buildFirewallProvider,
  network: buildNetworkProvider,
  docker: buildDockerProvider
}

function validateChange (change) {
  const id = String(change?.id || '')
  if (!safeIdPattern.test(id)) {
    refuse('操作标识无效，只允许字母、数字、下划线和连字符。')
  }
  const recoveryProvider = change?.recoveryProvider
  const legacyProvider = change?.provider
  if (recoveryProvider && legacyProvider && recoveryProvider !== legacyProvider) {
    refuse('恢复提供器字段不一致。')
  }
  const provider = recoveryProvider || legacyProvider
  if (!supportedProviders.has(provider)) {
    refuse('恢复提供器不受支持。')
  }
  if (change?.risk !== 'change' || change?.reversible !== true) {
    refuse('输入不是 buildSafetyRequest 产生的可逆 change。', provider)
  }
  const command = String(change?.command || '')
  const classification = classifyCommand(command)
  if (classification.risk !== 'change' || classification.reversible !== true ||
    classification.provider !== provider) {
    refuse('命令未被安全分类器认定为同一提供器的单一原子可逆修改，不能生成猜测回滚。', provider)
  }
  return { id, provider, command }
}

function operationArtifacts (id) {
  const root = `~/.shellpilot/operations/${id}/`
  return {
    manifest: `${root}manifest.json`,
    result: `${root}result.json`,
    rollbackScript: `${root}rollback.sh`,
    verifyScript: `${root}verify.sh`,
    backupDir: `${root}backup/`
  }
}

function buildScriptAction (id, action) {
  const script = `$HOME/.shellpilot/operations/${id}/${action}.sh`
  const command = `if [ -x "${script}" ]; then "${script}"; else echo ${shellQuote(`远程${action === 'rollback' ? '回滚' : '校验'}脚本不存在或权限错误。`)} >&2; exit 44; fi`
  return buildVerifiedRemoteAction(command, action, id)
}

export function buildRecoveryPlan (change) {
  const { id, provider, command } = validateChange(change)
  let recovery
  try {
    recovery = providerBuilders[provider](command, id)
  } catch (error) {
    if (error instanceof RecoveryProviderError) throw error
    refuse(error.message || '命令目标无法静态解析。', provider)
  }

  const operationDir = `~/.shellpilot/operations/${id}/`
  const manifest = JSON.stringify({
    schemaVersion: 1,
    id,
    provider,
    command: redactAuditText(command),
    summary: redactAuditText(recovery.summary),
    target: redactAuditText(recovery.target),
    createdAt: change.createdAt || null,
    originalState: {
      captured: true,
      artifacts: recovery.stateArtifacts
    }
  })
  const result = JSON.stringify({ id, provider, status: 'prepared' })
  const prepareParts = [
    'umask 077',
    'set -eu',
    'operations_root="$HOME/.shellpilot/operations"',
    `operation_dir="$HOME/.shellpilot/operations/${id}"`,
    'mkdir -p "$operations_root"',
    'chmod 700 "$operations_root"',
    `if [ -e "$operation_dir" ]; then echo ${shellQuote('恢复包目录已存在，拒绝覆盖历史记录。')} >&2; exit 41; fi`,
    `if ! mkdir "$operation_dir"; then echo ${shellQuote('恢复包目录创建失败，可能存在并发操作。')} >&2; exit 41; fi`,
    'cleanup_operation_dir () { cleanup_rc=$?; trap - EXIT HUP INT TERM; rm -rf -- "$operation_dir" || true; exit "$cleanup_rc"; }',
    'trap cleanup_operation_dir EXIT',
    "trap 'exit 129' HUP",
    "trap 'exit 130' INT",
    "trap 'exit 143' TERM",
    'mkdir "$operation_dir/backup"',
    'chmod 700 "$operation_dir" "$operation_dir/backup"',
    ...recovery.captureCommands,
    `printf '%s\\n' ${shellQuote(manifest)} > "$operation_dir/manifest.json"`,
    `printf '%s\\n' ${shellQuote(result)} > "$operation_dir/result.json"`,
    writeShellScript(recovery.rollbackScript, '"$operation_dir/rollback.sh"'),
    writeShellScript(recovery.verifyScript, '"$operation_dir/verify.sh"'),
    'chmod 600 "$operation_dir/manifest.json" "$operation_dir/result.json"',
    'chmod 700 "$operation_dir/rollback.sh" "$operation_dir/verify.sh"',
    'test -s "$operation_dir/manifest.json"',
    'test -s "$operation_dir/result.json"',
    'test -x "$operation_dir/rollback.sh"',
    'test -x "$operation_dir/verify.sh"',
    'trap - EXIT HUP INT TERM'
  ]

  return {
    provider,
    operationDir,
    prepareCommand: prepareParts.join('; '),
    executeCommand: command,
    rollbackCommand: buildScriptAction(id, 'rollback'),
    verifyCommand: buildScriptAction(id, 'verify'),
    allowUnsafeExecute: provider !== 'network',
    summary: recovery.summary,
    artifacts: operationArtifacts(id)
  }
}
