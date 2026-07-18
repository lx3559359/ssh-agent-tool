const http = require('node:http')
const { once } = require('node:events')
const { test, expect } = require('@playwright/test')
const {
  launchBookmarkApp,
  closeBookmarkApp,
  cleanupBookmarkProfile
} = require('./common/bookmark-lifecycle')

const requiredEnvironmentVariables = Object.freeze([
  'SHELLPILOT_E2E_HOST',
  'SHELLPILOT_E2E_PORT',
  'SHELLPILOT_E2E_USERNAME',
  'SHELLPILOT_E2E_PASSWORD'
])

const readonlyCommands = Object.freeze([
  'ip -brief address',
  'ip addr',
  'ip route show',
  'uname -s',
  'cat /proc/loadavg'
])

test.setTimeout(300000)

function readRealServerConfig () {
  const values = Object.fromEntries(requiredEnvironmentVariables.map(name => {
    const value = process.env[name] || ''
    return [name, name === 'SHELLPILOT_E2E_PASSWORD' ? value : value.trim()]
  }))
  const missingEnvironmentVariables = requiredEnvironmentVariables.filter(name => !values[name])
  if (missingEnvironmentVariables.length > 0) {
    return { config: null, missingEnvironmentVariables }
  }
  const port = Number(values.SHELLPILOT_E2E_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SHELLPILOT_E2E_PORT must be an integer between 1 and 65535')
  }
  return {
    config: {
      host: values.SHELLPILOT_E2E_HOST,
      port,
      username: values.SHELLPILOT_E2E_USERNAME,
      password: values.SHELLPILOT_E2E_PASSWORD
    },
    missingEnvironmentVariables
  }
}

function toolCall (id, command) {
  return {
    id,
    type: 'function',
    function: {
      name: 'run_readonly_command',
      arguments: JSON.stringify({ command })
    }
  }
}

async function startAgentApi () {
  const state = { commands: [] }
  const server = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks).toString('utf8')
    if (!rawBody) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'shellpilot-real-e2e' }] }))
      return
    }
    const body = JSON.parse(rawBody)
    const messages = body.messages || []
    let userIndex = -1
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index]?.role === 'user') {
        userIndex = index
        break
      }
    }
    const prompt = String(messages[userIndex]?.content || '')
    const promptMatch = prompt.match(/^agent-readonly-real-(warmup|sample)-(\d+)-(\d+)$/)
    if (!promptMatch) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Unexpected fixed real-server E2E prompt' } }))
      return
    }
    const commandIndex = Number(promptMatch[2])
    const command = readonlyCommands[commandIndex]
    if (!command) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Readonly command index is outside the fixed allowlist' } }))
      return
    }
    const hasToolResult = messages.slice(userIndex + 1).some(item => item.role === 'tool')
    const message = hasToolResult
      ? { role: 'assistant', content: 'readonly real-server sample complete' }
      : {
          role: 'assistant',
          content: 'running fixed readonly sample',
          tool_calls: [toolCall(`readonly-real-${state.commands.length}`, command)]
        }
    if (!hasToolResult) state.commands.push(command)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message }] }))
  })
  server.listen(0, 'localhost')
  await once(server, 'listening')
  return {
    port: server.address().port,
    state,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
}

async function acceptHostKeyIfShown (client) {
  const modal = client.locator('.custom-modal-wrap').last()
  if (await modal.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false)) {
    await expect(modal).toContainText('SHA256:')
    await modal.locator('button.custom-modal-ok-btn, button.ant-btn-primary').last().click()
  }
}

async function connectRealServer (client, config) {
  await client.evaluate(server => window.store.mcpOpenTab({
    type: 'ssh',
    title: 'Agent Readonly Real E2E',
    host: server.host,
    port: server.port,
    username: server.username,
    password: server.password,
    authType: 'password',
    useSshAgent: false,
    enableSsh: true,
    enableSftp: false
  }), config)
  await acceptHostKeyIfShown(client)
  await expect.poll(() => client.evaluate(() => {
    const terminal = window.refs.get('term-' + window.store.activeTabId)
    const endpoint = terminal?.getTerminalSafetyEndpoint?.()
    return Boolean(
      terminal?.pid &&
      endpoint?.sessionType === 'ssh' &&
      endpoint?.hostKeyFingerprint
    )
  }), { timeout: 30000 }).toBe(true)
}

async function enableTakeover (client) {
  await client.evaluate(() => window.store.handleOpenAIPanel())
  const toggle = client.locator('.agent-takeover-switch')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  const modal = client.locator('.agent-takeover-confirm-modal')
  await expect(modal).toContainText('SHA256:')
  await modal.locator('.custom-modal-ok-btn').click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
}

async function runReadonlySample (client, prompt) {
  await client.locator('.ai-chat-container .ant-segmented-item').filter({ hasText: 'Agent' }).click()
  await client.locator('.ai-chat-textarea').fill(prompt)
  await client.locator('.send-to-ai-icon').click()
  await expect.poll(() => client.evaluate(expectedPrompt => {
    const item = [...window.store.aiChatHistory]
      .reverse()
      .find(entry => entry.displayPrompt === expectedPrompt)
    return item?.completionStatus
  }, prompt), { timeout: 30000 }).toBe('completed')
  const evidence = await client.evaluate(expectedPrompt => {
    const item = [...window.store.aiChatHistory]
      .reverse()
      .find(entry => entry.displayPrompt === expectedPrompt)
    const tool = item?.toolCalls?.[0]
    return {
      toolName: tool?.name,
      status: tool?.status,
      presentation: tool?.presentation,
      currentInput: window.refs
        .get('term-' + window.store.activeTabId)
        ?.getCurrentInput?.()
    }
  }, prompt)
  const card = client.locator('.chat-history-item').last().locator('.agent-tool-readonly-card')
  await expect(card).toBeVisible()
  return evidence
}

function percentile95 (values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
}

function classifySafeFailure (message) {
  const text = String(message || '').toLowerCase()
  if (text.includes('endpoint') || text.includes('session')) return 'session-boundary'
  if (text.includes('policy') || text.includes('reject')) return 'policy-rejection'
  if (text.includes('cancel') || text.includes('abort')) return 'cancellation'
  if (text.includes('timeout') || text.includes('timed out')) return 'timeout'
  if (text.includes('connect') || text.includes('available')) return 'connection-unavailable'
  return 'unclassified'
}

test('Agent readonly SSH exec remains isolated, evidenced and fast on a real server', async ({ browserName }, testInfo) => {
  expect(browserName).toBeTruthy()
  const { config, missingEnvironmentVariables } = readRealServerConfig()
  test.skip(
    missingEnvironmentVariables.length > 0,
    `缺少真实服务器测试环境变量：${missingEnvironmentVariables.join(', ')}`
  )

  const agentApi = await startAgentApi()
  const samples = []
  let electronApp
  try {
    const launched = await launchBookmarkApp()
    electronApp = launched.electronApp
    const client = launched.client
    const fakeApiToken = ['e2e', 'only', 'token'].join('-')
    await client.evaluate(({ port, fakeApiToken }) => window.store.setConfig({
      baseURLAI: `http://localhost:${port}`,
      apiPathAI: '/chat/completions',
      modelAI: 'shellpilot-real-e2e',
      apiKeyAI: fakeApiToken,
      authHeaderNameAI: 'Authorization: Bearer',
      languageAI: 'English'
    }), { port: agentApi.port, fakeApiToken })
    await connectRealServer(client, config)
    await enableTakeover(client)

    const warmup = await runReadonlySample(client, 'agent-readonly-real-warmup-3-0')
    expect(warmup.toolName).toBe('run_readonly_command')
    expect(warmup.status).toBe('completed')
    expect(warmup.presentation.exitCode).toBe(0)
    expect(warmup.presentation.truncated).toBe(false)
    expect(Buffer.byteLength(warmup.presentation.output || '', 'utf8')).toBeGreaterThan(0)
    expect(warmup.currentInput || '').toBe('')

    for (let repeat = 0; repeat < 5; repeat++) {
      for (let commandIndex = 0; commandIndex < readonlyCommands.length; commandIndex++) {
        const evidence = await runReadonlySample(
          client,
          `agent-readonly-real-sample-${commandIndex}-${repeat}`
        )
        const presentation = evidence.presentation || {}
        const outputBytes = Buffer.byteLength(presentation.output || '', 'utf8')
        expect(evidence.toolName).toBe('run_readonly_command')
        expect(
          evidence.status,
          `fixed sample ${commandIndex}/${repeat} failed: ${classifySafeFailure(presentation.error)}`
        ).toBe('completed')
        expect(presentation.command).toBe(readonlyCommands[commandIndex])
        expect(presentation.target).toBeTruthy()
        expect(presentation.capturedAt).toBeGreaterThan(0)
        expect(presentation.durationMs).toBeGreaterThanOrEqual(0)
        expect(presentation.exitCode).toBe(0)
        expect(presentation.truncated).toBe(false)
        expect(outputBytes).toBeGreaterThan(0)
        expect(evidence.currentInput || '').toBe('')
        samples.push({ durationMs: presentation.durationMs, outputBytes })
      }
    }

    const durations = samples.map(sample => sample.durationMs)
    const p95Ms = percentile95(durations)
    expect(samples).toHaveLength(readonlyCommands.length * 5)
    expect(agentApi.state.commands).toHaveLength(1 + readonlyCommands.length * 5)
    expect(p95Ms).toBeLessThanOrEqual(3000)
    testInfo.annotations.push({ type: 'p95Ms', description: String(p95Ms) })
    await testInfo.attach('agent-readonly-real-statistics.json', {
      body: Buffer.from(JSON.stringify({
        samples: samples.length,
        p95Ms,
        minMs: Math.min(...durations),
        maxMs: Math.max(...durations),
        minOutputBytes: Math.min(...samples.map(sample => sample.outputBytes))
      })),
      contentType: 'application/json'
    })
  } finally {
    await closeBookmarkApp(electronApp, __filename).catch(() => {})
    await cleanupBookmarkProfile().catch(() => {})
    await agentApi.close().catch(() => {})
  }
})
