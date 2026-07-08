const { execFile } = require('child_process')

const ALLOWED_LOCAL_CLI_TOOLS = [
  'ssh-keygen',
  'scp',
  'ping',
  'traceroute',
  'tracert',
  'kubectl',
  'docker',
  'git'
]

const MAX_OUTPUT_LENGTH = 12000
const DEFAULT_TIMEOUT_MS = 15000
const MAX_TIMEOUT_MS = 120000

function getAllowedLocalCliTools () {
  return [...ALLOWED_LOCAL_CLI_TOOLS]
}

function isAllowedLocalCliTool (tool) {
  return ALLOWED_LOCAL_CLI_TOOLS.includes(String(tool || '').trim())
}

function normalizeArgs (args = []) {
  if (!Array.isArray(args)) {
    return []
  }
  return args.slice(0, 64).map(arg => String(arg))
}

function normalizeTimeout (timeoutMs) {
  const timeout = Number(timeoutMs) || DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(timeout, 1000), MAX_TIMEOUT_MS)
}

function trimOutput (text = '') {
  const str = String(text || '')
  if (str.length <= MAX_OUTPUT_LENGTH) {
    return str
  }
  return str.slice(0, MAX_OUTPUT_LENGTH) + '\n...输出已截断...'
}

function createLocalCliRunner ({
  execFileImpl = execFile
} = {}) {
  return function runLocalCli ({
    tool,
    args = [],
    cwd,
    timeoutMs
  } = {}) {
    const command = String(tool || '').trim()
    if (!isAllowedLocalCliTool(command)) {
      return Promise.resolve({
        ok: false,
        error: `不允许执行本机 CLI 工具：${command || '(空)'}`,
        allowedTools: getAllowedLocalCliTools()
      })
    }

    return new Promise(resolve => {
      execFileImpl(command, normalizeArgs(args), {
        cwd: cwd || undefined,
        timeout: normalizeTimeout(timeoutMs),
        windowsHide: true,
        shell: false,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024
      }, (error, stdout = '', stderr = '') => {
        resolve({
          ok: !error,
          tool: command,
          args: normalizeArgs(args),
          cwd: cwd || '',
          exitCode: error?.code ?? 0,
          signal: error?.signal || '',
          stdout: trimOutput(stdout),
          stderr: trimOutput(stderr),
          error: error ? String(error.message || error) : ''
        })
      })
    })
  }
}

const runLocalCli = createLocalCliRunner()

exports.getAllowedLocalCliTools = getAllowedLocalCliTools
exports.isAllowedLocalCliTool = isAllowedLocalCliTool
exports.createLocalCliRunner = createLocalCliRunner
exports.runLocalCli = runLocalCli
