export const VALID_AGENT_TOOL_SCOPES = Object.freeze([
  'conversation',
  'session-read',
  'session-write',
  'session-control'
])

export const AGENT_TOOL_SCOPES = Object.freeze({
  read_service_status: 'session-read',
  read_recent_logs: 'session-read',
  verify_listening_port: 'session-read',
  read_file_range: 'session-read',
  run_readonly_command: 'session-read',
  send_terminal_command: 'session-write',
  get_terminal_output: 'session-read',
  open_local_terminal: 'session-control',
  list_tabs: 'conversation',
  get_active_tab: 'conversation',
  switch_tab: 'session-control',
  close_tab: 'session-control',
  list_bookmarks: 'conversation',
  open_bookmark: 'session-control',
  add_bookmark: 'session-control',
  open_tab: 'session-control',
  sftp_list: 'session-read',
  sftp_stat: 'session-read',
  sftp_read_file: 'session-read',
  sftp_del: 'session-write',
  sftp_upload: 'session-write',
  sftp_download: 'session-write',
  sftp_transfer_list: 'session-read',
  sftp_transfer_history: 'session-read',
  get_terminal_status: 'session-read',
  cancel_terminal_command: 'session-control',
  run_local_cli: 'session-control',
  run_skill_artifact: 'session-control',
  list_local_cli_tools: 'conversation',
  get_codex_cli_status: 'conversation',
  run_background_command: 'session-write',
  get_background_task_status: 'session-read',
  get_background_task_log: 'session-read',
  cancel_background_task: 'session-control'
})

const validScopes = new Set(VALID_AGENT_TOOL_SCOPES)

export function withAgentToolScopes (tools = []) {
  const descriptors = tools.map(tool => {
    const name = String(tool?.function?.name || '')
    const scope = AGENT_TOOL_SCOPES[name]
    if (!name || !validScopes.has(scope)) {
      const error = new Error(`Agent tool scope is missing or invalid: ${name}`)
      error.code = 'INVALID_AGENT_TOOL_SCOPE'
      throw error
    }
    return Object.freeze({ ...tool, scope })
  })
  return Object.freeze(descriptors)
}
