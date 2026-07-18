import {
  classifyCommand,
  tokenizeStaticShell
} from '../../common/safety-transactions/command-classifier.js'
import { AGENT_TOOL_SCOPES } from './agent-tool-scopes.js'

const STRUCTURED_SESSION_READS = new Set([
  'get_terminal_output',
  'sftp_list',
  'sftp_stat',
  'sftp_read_file',
  'sftp_transfer_list',
  'sftp_transfer_history',
  'get_terminal_status',
  'get_background_task_status',
  'get_background_task_log',
  'read_service_status',
  'read_recent_logs',
  'verify_listening_port',
  'read_file_range'
])

const EXTRA_TOOL_SCOPES = Object.freeze({
  read_service_status: 'session-read',
  read_recent_logs: 'session-read',
  verify_listening_port: 'session-read',
  read_file_range: 'session-read'
})

const RAW_SHELL_TOOLS = new Set([
  'run_readonly_command',
  'send_terminal_command',
  'run_background_command'
])

const STRUCTURED_WRITE_TOOLS = new Set([
  'sftp_del',
  'sftp_upload',
  'sftp_download'
])

const resourceSensitivePatterns = [
  /\bjournalctl\b[^\n]*(?:\s-f\b|--follow\b)/i,
  /\b(?:tail)\b[^\n]*(?:\s-f\b|--follow\b)/i,
  /\bdu\b[^\n]*(?:\s-a\b|--all\b)[^\n]*(?:\s\/\s*$|\s\/\*?)/i,
  /\b(?:tar|cpio|zip|7z)\b[^\n]*(?:\s\/\s*$|\s\/\*?)/i,
  /\b(?:sha(?:1|224|256|384|512)sum|md5sum)\b[^\n]*(?:\/var\/lib|\/home|\/srv|\/)/i,
  /\b(?:docker|podman)\s+(?:build|buildx\s+build|stats)\b/i,
  /\bkubectl\b[^\n]*(?:\s-w\b|--watch(?:=\S+)?\b)/i,
  /\bkubectl\s+logs\b[^\n]*(?:\s-f\b|\s--follow(?:=\S+)?\b)/i,
  /\b(?:psql|mysql|mariadb|sqlite3)\b[^\n]*\bselect\b(?![^\n]*\blimit\b)/i
]

const unauditableShellPatterns = [
  /\$\(|`|\$\{|<\(|>\(/,
  /\b(?:curl|wget)\b[^\n|]*\|/i,
  /\b(?:eval|source)\b/i
]

const outcomeRank = Object.freeze({
  'allowlisted-readonly': 0,
  risky: 1,
  unauditable: 2,
  blocked: 3
})

const remoteSkillPermissions = new Set(['ssh.read', 'ssh.write'])
const localSkillPermissions = new Set([
  'local.process',
  'local.filesystem.read',
  'local.filesystem.write',
  'network'
])
const localSkillEnvironmentKeys = Object.freeze([
  'PATH',
  'SystemRoot',
  'TEMP',
  'TMP',
  'WINDIR'
])

const lowImpact = Object.freeze({
  cpu: 'low',
  memory: 'low',
  disk: 'low',
  network: 'low',
  duration: 'short'
})

const elevatedImpact = Object.freeze({
  cpu: 'medium',
  memory: 'medium',
  disk: 'medium',
  network: 'medium',
  duration: 'unknown'
})

function scopeFor (name) {
  return AGENT_TOOL_SCOPES[name] || EXTRA_TOOL_SCOPES[name]
}

function executionFor (name) {
  if (RAW_SHELL_TOOLS.has(name)) return 'raw-shell'
  if (name === 'run_local_cli') return 'local-cli'
  return 'structured'
}

export function getAgentToolDescriptor (toolName) {
  const name = String(toolName || '')
  const scope = scopeFor(name)
  if (!scope) {
    const error = new Error(`Agent tool policy is missing: ${name}`)
    error.code = 'AGENT_TOOL_POLICY_MISSING'
    throw error
  }
  return Object.freeze({
    name,
    scope,
    execution: executionFor(name),
    outputLimit: 32 * 1024,
    cancellable: scope !== 'conversation'
  })
}

export function withAgentToolPolicy (tools = []) {
  return Object.freeze(tools.map(tool => Object.freeze({
    ...tool,
    ...getAgentToolDescriptor(tool?.function?.name)
  })))
}

function commandText (descriptor, args = {}) {
  if (descriptor.name === 'run_local_cli') {
    return [
      String(args.tool || '').trim(),
      ...(Array.isArray(args.args) ? args.args.map(String) : [])
    ].filter(Boolean).join(' ')
  }
  return String(args.command || '').trim()
}

function result (outcome, reasonCode, resourceImpact, extras = {}) {
  return Object.freeze({
    outcome,
    reasonCode,
    ...extras,
    resourceImpact: Object.freeze({
      ...(outcome === 'allowlisted-readonly' ? lowImpact : elevatedImpact),
      ...(resourceImpact || {})
    })
  })
}

function sameStrings (left, right) {
  const normalized = value => [...new Set(
    (Array.isArray(value) ? value : []).map(String)
  )].sort()
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right))
}

function blockedSkillPermission () {
  return result('blocked', 'SKILL_PERMISSION_UNENFORCEABLE', undefined, {
    errorCode: 'SKILL_PERMISSION_UNENFORCEABLE'
  })
}

function classifySkillArtifact ({
  policy,
  expandedContent,
  skillArtifact,
  localExecution
}) {
  const target = String(skillArtifact?.target || '')
  const permissions = Array.isArray(skillArtifact?.requestedPermissions)
    ? skillArtifact.requestedPermissions.map(String)
    : []
  const allowed = target === 'remote'
    ? remoteSkillPermissions
    : target === 'local' ? localSkillPermissions : null
  if (!allowed || permissions.some(permission => !allowed.has(permission))) {
    return blockedSkillPermission()
  }

  if (target === 'remote') {
    if (policy.name !== 'send_terminal_command') return blockedSkillPermission()
    const content = classifyRemoteSkillText(expandedContent)
    if (content.outcome === 'blocked' || content.outcome === 'unauditable') {
      return content
    }
    return strictest(
      result('risky', 'SKILL_REMOTE_SCRIPT'),
      content
    )
  }

  if (policy.name !== 'run_local_cli' ||
    localExecution?.shell !== false ||
    !Number.isFinite(localExecution?.timeoutMs) ||
    localExecution.timeoutMs < 1 || localExecution.timeoutMs > 30000 ||
    !Number.isFinite(localExecution?.outputLimitBytes) ||
    localExecution.outputLimitBytes < 1 ||
    localExecution.outputLimitBytes > 64 * 1024 ||
    !sameStrings(localExecution.environmentKeys, localSkillEnvironmentKeys) ||
    !sameStrings(localExecution.requestedPermissions, permissions)) {
    return blockedSkillPermission()
  }

  // Arbitrary local interpreter processes can access filesystem and network
  // APIs directly. Until an OS sandbox enforces the declared permissions,
  // local Skill artifacts must not reach the existing local CLI runner.
  return blockedSkillPermission()
}

function classifyShellText (text) {
  const command = String(text || '').trim()
  if (!command) return result('unauditable', 'EMPTY_OR_MISSING_COMMAND')
  if (resourceSensitivePatterns.some(pattern => pattern.test(command))) {
    return result('risky', 'RESOURCE_SENSITIVE_READ')
  }
  if (unauditableShellPatterns.some(pattern => pattern.test(command))) {
    return result('unauditable', 'DYNAMIC_OR_PIPED_SHELL')
  }
  const classified = classifyCommand(command)
  if (classified.risk === 'blocked') {
    return result('blocked', 'COMMAND_BLOCKED')
  }
  if (classified.risk === 'change') {
    return result('risky', 'COMMAND_CHANGES_STATE')
  }
  if (classified.risk === 'readonly') {
    try {
      tokenizeStaticShell(command)
    } catch (error) {
      return result('unauditable', 'DYNAMIC_OR_PIPED_SHELL')
    }
    return result('allowlisted-readonly', 'COMMAND_READONLY')
  }
  return result('unauditable', 'COMMAND_UNAUDITABLE')
}

function classifyRemoteSkillText (text) {
  const classified = classifyShellText(text)
  // A reviewed Skill artifact is digest-bound and its full source is displayed
  // in the risk confirmation. An otherwise unknown static script therefore
  // remains a risky operation instead of being rejected as unauditable. The
  // explicit dynamic/piped/eval and blocked classifications still win.
  if (classified.reasonCode === 'COMMAND_UNAUDITABLE') {
    return result('risky', 'SKILL_REMOTE_SCRIPT')
  }
  return classified
}

function strictest (left, right) {
  return outcomeRank[right.outcome] > outcomeRank[left.outcome] ? right : left
}

export function classifyAgentCall ({
  descriptor,
  toolName,
  args = {},
  expandedContent,
  skillArtifact,
  localExecution
} = {}) {
  const policy = descriptor?.name
    ? getAgentToolDescriptor(descriptor.name)
    : descriptor || (toolName ? getAgentToolDescriptor(toolName) : undefined)
  if (!policy?.name) {
    return result('blocked', 'TOOL_DESCRIPTOR_MISSING')
  }

  if (skillArtifact) {
    return classifySkillArtifact({
      policy,
      args,
      expandedContent,
      skillArtifact,
      localExecution
    })
  }

  if (RAW_SHELL_TOOLS.has(policy.name) || policy.name === 'run_local_cli') {
    let classified = classifyShellText(commandText(policy, args))
    if (expandedContent !== undefined && expandedContent !== null) {
      classified = strictest(classified, classifyShellText(expandedContent))
    }
    if (policy.name === 'run_background_command' &&
      classified.outcome === 'allowlisted-readonly') {
      return result('risky', 'BACKGROUND_PROCESS')
    }
    return classified
  }

  if (STRUCTURED_WRITE_TOOLS.has(policy.name) || policy.scope === 'session-control') {
    return result('risky', 'STRUCTURED_STATE_CHANGE')
  }
  if (STRUCTURED_SESSION_READS.has(policy.name) || policy.scope === 'conversation') {
    if (args.follow === true || args.recursive === true || args.unbounded === true) {
      return result('risky', 'RESOURCE_SENSITIVE_READ')
    }
    return result('allowlisted-readonly', 'STRUCTURED_READ')
  }
  return result('unauditable', 'TOOL_POLICY_UNAUDITABLE')
}
