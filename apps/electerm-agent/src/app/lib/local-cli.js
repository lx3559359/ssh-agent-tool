const { execFile } = require('child_process')

const ALLOWED_LOCAL_CLI_TOOLS = [
  'ssh-keygen',
  'ssh',
  'scp',
  'ping',
  'traceroute',
  'tracert',
  'nslookup',
  'curl',
  'ipconfig',
  'where',
  'kubectl',
  'docker',
  'git',
  'codex'
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

function execFileSafe (execFileImpl, file, args, options = {}) {
  return new Promise(resolve => {
    try {
      execFileImpl(file, args, {
        timeout: normalizeTimeout(options.timeoutMs || 5000),
        windowsHide: true,
        shell: false,
        encoding: 'utf8',
        maxBuffer: 256 * 1024
      }, (error, stdout = '', stderr = '') => {
        resolve({
          error,
          stdout: String(stdout || ''),
          stderr: String(stderr || '')
        })
      })
    } catch (error) {
      resolve({
        error,
        stdout: '',
        stderr: ''
      })
    }
  })
}

function firstOutputLine (text = '') {
  return String(text || '').split(/\r?\n/).find(Boolean) || ''
}

function buildErrorMessage (result) {
  return String(
    result?.stderr ||
    result?.error?.message ||
    result?.error ||
    ''
  )
}

function createCodexCliStatusChecker ({
  execFileImpl = execFile,
  platform = process.platform
} = {}) {
  return async function getCodexCliStatus () {
    const locator = platform === 'win32'
      ? { file: 'where.exe', args: ['codex'] }
      : { file: 'which', args: ['codex'] }
    const located = await execFileSafe(execFileImpl, locator.file, locator.args)
    const installPath = firstOutputLine(located.stdout)
    if (located.error || !installPath) {
      return {
        provider: 'codex',
        name: 'Codex CLI',
        installed: false,
        available: false,
        version: '',
        installPath: '',
        authMode: 'official-cli',
        loginStatus: 'unknown',
        canUseExistingLogin: false,
        error: buildErrorMessage(located),
        guidance: '未检测到 Codex CLI。请先安装官方 Codex CLI，并在系统终端中运行 codex login 完成 ChatGPT 账号或 API Key 登录。'
      }
    }

    const version = await execFileSafe(execFileImpl, 'codex', ['--version'])
    if (version.error) {
      return {
        provider: 'codex',
        name: 'Codex CLI',
        installed: true,
        available: false,
        version: '',
        installPath,
        authMode: 'official-cli',
        loginStatus: 'unknown',
        canUseExistingLogin: false,
        error: buildErrorMessage(version),
        guidance: 'Codex CLI 已安装，但当前无法执行。请在系统终端运行 codex --version 和 codex login，确认安装、权限和登录状态正常后重试。'
      }
    }

    return {
      provider: 'codex',
      name: 'Codex CLI',
      installed: true,
      available: true,
      version: firstOutputLine(version.stdout) || firstOutputLine(version.stderr),
      installPath,
      authMode: 'official-cli',
      loginStatus: 'managed-by-official-cli',
      canUseExistingLogin: true,
      error: '',
      guidance: 'Codex CLI 可用。AIGShell 将通过官方 codex 命令复用其登录态，不保存账号密码。'
    }
  }
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
const getCodexCliStatus = createCodexCliStatusChecker()

exports.getAllowedLocalCliTools = getAllowedLocalCliTools
exports.isAllowedLocalCliTool = isAllowedLocalCliTool
exports.createCodexCliStatusChecker = createCodexCliStatusChecker
exports.getCodexCliStatus = getCodexCliStatus
exports.createLocalCliRunner = createLocalCliRunner
exports.runLocalCli = runLocalCli
