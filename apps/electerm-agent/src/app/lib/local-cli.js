const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

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

function getCodexDesktopCandidatePaths ({
  platform = process.platform,
  env = process.env
} = {}) {
  if (platform !== 'win32' || !env.LOCALAPPDATA) {
    return []
  }

  const binRoot = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
  try {
    return fs.readdirSync(binRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(binRoot, entry.name, 'codex.exe'))
      .filter(file => fs.existsSync(file))
      .map(file => {
        let mtimeMs = 0
        try {
          mtimeMs = fs.statSync(file).mtimeMs
        } catch (error) {
          mtimeMs = 0
        }
        return { file, mtimeMs }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map(item => item.file)
  } catch (error) {
    return []
  }
}

function createCodexCliResolver ({
  execFileImpl = execFile,
  platform = process.platform,
  env = process.env,
  codexDesktopCandidatePaths
} = {}) {
  return async function resolveCodexCli () {
    const locator = platform === 'win32'
      ? { file: 'where.exe', args: ['codex'] }
      : { file: 'which', args: ['codex'] }
    const located = await execFileSafe(execFileImpl, locator.file, locator.args)
    const systemInstallPath = firstOutputLine(located.stdout)
    const desktopCandidatePaths = codexDesktopCandidatePaths || getCodexDesktopCandidatePaths({ platform, env })
    const candidates = [
      {
        file: 'codex',
        argsPrefix: [],
        installPath: systemInstallPath || 'codex',
        source: 'system'
      },
      ...desktopCandidatePaths
        .map(file => ({
          file,
          argsPrefix: [],
          installPath: file,
          source: 'codex-desktop'
        }))
    ]
    const errors = []

    for (const candidate of candidates) {
      const version = await execFileSafe(
        execFileImpl,
        candidate.file,
        [...candidate.argsPrefix, '--version'],
        { timeoutMs: candidate.source === 'system' ? 5000 : 15000 }
      )
      if (!version.error) {
        return {
          ...candidate,
          installed: true,
          available: true,
          version: firstOutputLine(version.stdout) || firstOutputLine(version.stderr),
          locatedError: buildErrorMessage(located),
          error: ''
        }
      }
      errors.push({
        source: candidate.source,
        installPath: candidate.installPath,
        error: buildErrorMessage(version)
      })
    }

    return {
      file: '',
      argsPrefix: [],
      installPath: systemInstallPath || firstOutputLine(codexDesktopCandidatePaths?.join('\n') || ''),
      source: '',
      installed: Boolean(systemInstallPath || desktopCandidatePaths.length),
      available: false,
      version: '',
      locatedError: buildErrorMessage(located),
      error: errors.map(item => `${item.installPath}: ${item.error}`).filter(Boolean).join('\n') || buildErrorMessage(located)
    }
  }
}

function createCodexCliStatusChecker ({
  execFileImpl = execFile,
  platform = process.platform,
  env = process.env,
  codexDesktopCandidatePaths
} = {}) {
  return async function getCodexCliStatus () {
    const resolved = await createCodexCliResolver({
      execFileImpl,
      platform,
      env,
      codexDesktopCandidatePaths
    })()

    if (!resolved.installed) {
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
        error: resolved.error,
        guidance: '未检测到 Codex CLI。请先安装官方 Codex CLI，并在系统终端中运行 codex login 完成 ChatGPT 账号或 API Key 登录。'
      }
    }

    if (!resolved.available) {
      return {
        provider: 'codex',
        name: 'Codex CLI',
        installed: true,
        available: false,
        version: '',
        installPath: resolved.installPath,
        authMode: 'official-cli',
        loginStatus: 'unknown',
        canUseExistingLogin: false,
        error: resolved.error,
        guidance: 'Codex CLI 已安装，但当前无法执行。请在系统终端运行 codex --version 和 codex login，确认安装、权限和登录状态正常后重试。'
      }
    }

    return {
      provider: 'codex',
      name: 'Codex CLI',
      installed: true,
      available: true,
      version: resolved.version,
      installPath: resolved.installPath,
      authMode: 'official-cli',
      loginStatus: 'managed-by-official-cli',
      canUseExistingLogin: true,
      error: '',
      guidance: resolved.source === 'codex-desktop'
        ? 'Codex CLI 可用。AIGShell 将通过 Codex Desktop 自带命令复用官方登录态，不保存账号密码。'
        : 'Codex CLI 可用。AIGShell 将通过官方 codex 命令复用其登录态，不保存账号密码。'
    }
  }
}

function createLocalCliRunner ({
  execFileImpl = execFile,
  platform = process.platform,
  env = process.env,
  codexDesktopCandidatePaths
} = {}) {
  return async function runLocalCli ({
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

    let executable = command
    let executableArgs = normalizeArgs(args)
    let resolvedTool = command
    if (command === 'codex') {
      const resolved = await createCodexCliResolver({
        execFileImpl,
        platform,
        env,
        codexDesktopCandidatePaths
      })()
      if (!resolved.available) {
        return {
          ok: false,
          tool: command,
          args: executableArgs,
          cwd: cwd || '',
          exitCode: 1,
          signal: '',
          stdout: '',
          stderr: '',
          error: resolved.error || 'Codex CLI 当前不可用，请先安装或登录官方 Codex CLI。'
        }
      }
      executable = resolved.file
      executableArgs = [...resolved.argsPrefix, ...executableArgs]
      resolvedTool = resolved.installPath || resolved.file
    }

    return new Promise(resolve => {
      execFileImpl(executable, executableArgs, {
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
          resolvedTool,
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
exports.createCodexCliResolver = createCodexCliResolver
exports.createCodexCliStatusChecker = createCodexCliStatusChecker
exports.getCodexCliStatus = getCodexCliStatus
exports.createLocalCliRunner = createLocalCliRunner
exports.runLocalCli = runLocalCli
