const { app } = require('electron')
const path = require('path')

const TIMEOUT_MS = Number(process.env.SHELLPILOT_AI_SMOKE_TIMEOUT_MS || 45000)
const USER_DATA_NAME = process.env.SHELLPILOT_USER_DATA_NAME || 'AIGShell'
const SAFE_STORAGE_NAME = process.env.SHELLPILOT_SAFE_STORAGE_NAME || USER_DATA_NAME

app.setName(SAFE_STORAGE_NAME)
app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_NAME))

function withTimeout (promise, label, timeoutMs = TIMEOUT_MS) {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve({
        ok: false,
        label,
        error: `${label} 超时 ${timeoutMs}ms`
      })
    }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function maskUrl (value = '') {
  try {
    const url = new URL(String(value))
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch (_) {
    return String(value || '')
  }
}

function summarizeConfig (config) {
  return {
    baseURLAI: maskUrl(config.baseURLAI),
    apiPathAI: config.apiPathAI || '',
    modelAI: config.modelAI || '',
    hasApiKeyAI: Boolean(config.apiKeyAI),
    apiKeyLength: String(config.apiKeyAI || '').length,
    authHeaderNameAI: config.authHeaderNameAI || '',
    hasProxyAI: Boolean(config.proxyAI)
  }
}

function applyEnvOverrides (config) {
  return {
    ...config,
    baseURLAI: process.env.SHELLPILOT_AI_BASE_URL || config.baseURLAI,
    apiPathAI: process.env.SHELLPILOT_AI_PATH || config.apiPathAI,
    modelAI: process.env.SHELLPILOT_AI_MODEL || config.modelAI,
    apiKeyAI: process.env.SHELLPILOT_AI_KEY || config.apiKeyAI,
    proxyAI: process.env.SHELLPILOT_AI_PROXY || config.proxyAI,
    authHeaderNameAI: process.env.SHELLPILOT_AI_AUTH_HEADER || config.authHeaderNameAI
  }
}

function errorPreview (result = {}) {
  return result.error ||
    String(result.stack || '').split(/\r?\n/).find(Boolean) ||
    ''
}

function isUsableChatResponse (response = {}) {
  if (response.error) {
    return false
  }
  if (typeof response.response === 'string' && response.response.trim()) {
    return true
  }
  return Boolean(response.sessionId)
}

async function main () {
  await app.whenReady()

  const { getConfig } = require('../../src/app/lib/get-config')
  const { AIModels, AIchat, AIchatWithTools } = require('../../src/app/lib/ai')
  const { getCodexCliStatus, runLocalCli } = require('../../src/app/lib/local-cli')

  const { config: loadedConfig } = await getConfig(false)
  const config = applyEnvOverrides(loadedConfig)
  const summary = summarizeConfig(config)
  const checks = []

  checks.push({
    name: '读取 AI 配置',
    ok: Boolean(config.baseURLAI && config.modelAI),
    detail: summary
  })

  checks.push(await withTimeout(
    getCodexCliStatus().then(result => ({
      name: 'Codex CLI 状态',
      ok: Boolean(result.available),
      detail: {
        version: result.version,
        installPath: result.installPath,
        canUseExistingLogin: result.canUseExistingLogin,
        error: result.error || ''
      }
    })),
    'Codex CLI 状态'
  ))

  checks.push(await withTimeout(
    runLocalCli({
      tool: 'codex',
      args: ['--version'],
      timeoutMs: 30000
    }).then(result => ({
      name: 'Codex CLI 执行',
      ok: Boolean(result.ok),
      detail: {
        resolvedTool: result.resolvedTool,
        stdout: String(result.stdout || '').trim(),
        error: result.error || result.stderr || ''
      }
    })),
    'Codex CLI 执行'
  ))

  if (!config.baseURLAI || !config.modelAI) {
    checks.push({
      name: '模型列表',
      ok: false,
      detail: '缺少 baseURLAI 或 modelAI，跳过真实模型接口验证。'
    })
    checks.push({
      name: '普通 AI 对话',
      ok: false,
      detail: '缺少 baseURLAI 或 modelAI，跳过真实 AI 对话验证。'
    })
  } else {
    checks.push(await withTimeout(
      AIModels(
        config.baseURLAI,
        config.apiKeyAI,
        config.proxyAI,
        config.authHeaderNameAI
      ).then(result => ({
        name: '模型列表',
        ok: Array.isArray(result.models) && result.models.length > 0,
        detail: {
          count: result.models?.length || 0,
          sample: (result.models || []).slice(0, 5),
          source: result.source || '',
          error: errorPreview(result)
        }
      })),
      '模型列表'
    ))

    checks.push(await withTimeout(
      AIchat(
        '请只回复四个字符：AI_OK',
        config.modelAI,
        config.roleAI,
        config.baseURLAI,
        config.apiPathAI,
        config.apiKeyAI,
        config.proxyAI,
        false,
        config.authHeaderNameAI
      ).then(result => ({
        name: '普通 AI 对话',
        ok: isUsableChatResponse(result),
        detail: {
          responsePreview: String(result.response || '').slice(0, 120),
          isStream: Boolean(result.isStream),
          error: errorPreview(result)
        }
      })),
      '普通 AI 对话'
    ))

    checks.push(await withTimeout(
      AIchatWithTools(
        [
          {
            role: 'system',
            content: '你是 ShellPilot 的 Agent 工具调用验收助手。'
          },
          {
            role: 'user',
            content: '请调用 get_codex_cli_status 工具检查 Codex CLI 状态。'
          }
        ],
        config.modelAI,
        config.baseURLAI,
        config.apiPathAI,
        config.apiKeyAI,
        config.proxyAI,
        [
          {
            type: 'function',
            function: {
              name: 'get_codex_cli_status',
              description: '检查本机 Codex CLI 是否安装并可执行。',
              parameters: {
                type: 'object',
                properties: {},
                additionalProperties: false
              }
            }
          }
        ],
        config.authHeaderNameAI
      ).then(result => {
        const toolCalls = result.message?.tool_calls || []
        return {
          name: 'Agent 工具对话',
          ok: Boolean(result.message && !result.error),
          detail: {
            hasToolCalls: toolCalls.length > 0,
            toolNames: toolCalls.map(item => item.function?.name || item.name).filter(Boolean),
            responsePreview: String(result.message?.content || '').slice(0, 120),
            error: errorPreview(result)
          }
        }
      }),
      'Agent 工具对话'
    ))
  }

  const ok = checks.every(item => item.ok)
  console.log(JSON.stringify({
    ok,
    checks
  }, null, 2))
  app.exit(ok ? 0 : 1)
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    stack: error.stack
  }, null, 2))
  app.exit(1)
})
