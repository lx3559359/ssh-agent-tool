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
    const promptMatch = prompt.match(/^agent-readonly-real-(warmup|sample)-(\d+)$/)
    if (!promptMatch) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Unexpected fixed real-server E2E prompt' } }))
      return
    }
    const batchIndex = Number(promptMatch[2])
    if ((promptMatch[1] === 'warmup' && batchIndex !== 0) ||
      (promptMatch[1] === 'sample' && (batchIndex < 0 || batchIndex > 4))) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Readonly batch index is outside the fixed sample set' } }))
      return
    }
    const toolResults = messages.slice(userIndex + 1).filter(item => item.role === 'tool')
    let message
    if (toolResults.length === 0) {
      const firstId = state.commands.length
      message = {
        role: 'assistant',
        content: 'running fixed readonly batch',
        tool_calls: readonlyCommands.map((command, index) => (
          toolCall(`readonly-real-${firstId + index}`, command)
        ))
      }
      state.commands.push(...readonlyCommands)
    } else if (toolResults.length === readonlyCommands.length) {
      message = { role: 'assistant', content: 'readonly real-server batch complete' }
    } else {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Final response requires all five tool observations' } }))
      return
    }
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
  const modal = client.locator('.custom-modal-wrap')
    .filter({ hasText: 'SHA256:' })
    .last()
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

async function runReadonlyBatch (client, prompt) {
  await client.locator('.ai-chat-container .ant-segmented-item').filter({ hasText: 'Agent' }).click()
  await client.evaluate(() => {
    window.__shellpilotAgentReadonlyPtyMonitor.count = 0
  })
  await client.locator('.ai-chat-textarea').fill(prompt)
  await client.locator('.send-to-ai-icon').click()
  await expect.poll(() => client.evaluate(expectedPrompt => {
    const item = [...window.store.aiChatHistory]
      .reverse()
      .find(entry => entry.displayPrompt === expectedPrompt)
    return item?.completionStatus
  }, prompt), { timeout: 30000 }).toBe('completed')
  const batch = await client.evaluate(expectedPrompt => {
    const item = [...window.store.aiChatHistory]
      .reverse()
      .find(entry => entry.displayPrompt === expectedPrompt)
    const toolCalls = item?.toolCalls || []
    return {
      evidence: toolCalls.map(tool => ({
        toolName: tool?.name,
        status: tool?.status,
        presentation: tool?.presentation
      })),
      currentInput: window.refs
        .get('term-' + window.store.activeTabId)
        ?.getCurrentInput?.(),
      ptySendCount: window.__shellpilotAgentReadonlyPtyMonitor.count
    }
  }, prompt)
  const cards = client.locator('.chat-history-item').last().locator('.agent-tool-readonly-card')
  await expect(cards).toHaveCount(readonlyCommands.length)
  for (let index = 0; index < readonlyCommands.length; index++) {
    await expect(cards.nth(index)).toBeVisible()
    await expect(cards.nth(index)).toContainText(readonlyCommands[index])
  }
  return batch
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

test('Agent readonly SSH exec remains isolated, evidenced and fast on a real server', async ({ browserName }) => {
  expect(browserName).toBeTruthy()
  const { config, missingEnvironmentVariables } = readRealServerConfig()
  test.skip(
    missingEnvironmentVariables.length > 0,
    `缺少真实服务器测试环境变量：${missingEnvironmentVariables.join(', ')}`
  )

  const agentApi = await startAgentApi()
  const samples = []
  let electronApp
  let client
  try {
    const launched = await launchBookmarkApp()
    electronApp = launched.electronApp
    client = launched.client
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
    await client.evaluate(() => {
      const terminal = window.refs.get('term-' + window.store.activeTabId)
      const attachAddon = terminal?.attachAddon
      if (!attachAddon?._sendData) throw new Error('Existing PTY send boundary is unavailable')
      const original = attachAddon._sendData
      const monitor = {
        attachAddon,
        original,
        count: 0
      }
      attachAddon._sendData = function (...args) {
        monitor.count += 1
        return original.apply(this, args)
      }
      window.__shellpilotAgentReadonlyPtyMonitor = monitor
    })

    const warmup = await runReadonlyBatch(client, 'agent-readonly-real-warmup-0')
    expect(warmup.evidence).toHaveLength(readonlyCommands.length)
    for (const evidence of warmup.evidence) {
      expect(evidence.toolName).toBe('run_readonly_command')
      expect(evidence.status).toBe('completed')
      expect(evidence.presentation.exitCode).toBe(0)
      expect(evidence.presentation.truncated).toBe(false)
      expect(Buffer.byteLength(evidence.presentation.output || '', 'utf8')).toBeGreaterThan(0)
    }
    expect(warmup.currentInput || '').toBe('')
    expect(warmup.ptySendCount).toBe(0)

    for (let repeat = 0; repeat < 5; repeat++) {
      const batch = await runReadonlyBatch(client, `agent-readonly-real-sample-${repeat}`)
      expect(batch.evidence).toHaveLength(readonlyCommands.length)
      expect(batch.currentInput || '').toBe('')
      expect(batch.ptySendCount).toBe(0)
      for (let commandIndex = 0; commandIndex < batch.evidence.length; commandIndex++) {
        const evidence = batch.evidence[commandIndex]
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
        samples.push({ durationMs: presentation.durationMs, outputBytes })
      }
    }

    const durations = samples.map(sample => sample.durationMs)
    const p95Ms = percentile95(durations)
    expect(samples).toHaveLength(readonlyCommands.length * 5)
    expect(agentApi.state.commands).toEqual(Array.from(
      { length: 6 },
      () => readonlyCommands
    ).flat())
    expect(p95Ms).toBeLessThanOrEqual(3000)
  } finally {
    await client?.evaluate(() => {
      const monitor = window.__shellpilotAgentReadonlyPtyMonitor
      if (monitor?.attachAddon) monitor.attachAddon._sendData = monitor.original
      delete window.__shellpilotAgentReadonlyPtyMonitor
    }).catch(() => {})
    await closeBookmarkApp(electronApp, __filename).catch(() => {})
    await cleanupBookmarkProfile().catch(() => {})
    await agentApi.close().catch(() => {})
  }
})
