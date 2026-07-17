import { classifyCommand } from '../../common/safety-transactions/command-classifier.js'
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
  /\b(?:docker|podman)\s+(?:build|buildx\s+build)\b/i,
  /\bkubectl\b[^\n]*(?:\s-w\b|--watch(?:=\S+)?\b)/i,
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
    outputLimit: name === 'sftp_read_file' || name === 'read_file_range'
      ? 64 * 1024
      : 32 * 1024,
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

function result (outcome, reasonCode, resourceImpact) {
  return Object.freeze({
    outcome,
    reasonCode,
    resourceImpact: Object.freeze({
      ...(outcome === 'allowlisted-readonly' ? lowImpact : elevatedImpact),
      ...(resourceImpact || {})
    })
  })
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
    return result('allowlisted-readonly', 'COMMAND_READONLY')
  }
  return result('unauditable', 'COMMAND_UNAUDITABLE')
}

function strictest (left, right) {
  return outcomeRank[right.outcome] > outcomeRank[left.outcome] ? right : left
}

export function classifyAgentCall ({
  descriptor,
  args = {},
  expandedContent
} = {}) {
  const policy = descriptor?.name
    ? getAgentToolDescriptor(descriptor.name)
    : descriptor
  if (!policy?.name) {
    return result('blocked', 'TOOL_DESCRIPTOR_MISSING')
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
