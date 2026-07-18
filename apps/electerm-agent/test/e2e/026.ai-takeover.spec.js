const http = require('node:http')
const { once } = require('node:events')
const { test, expect } = require('@playwright/test')
const {
  launchBookmarkApp,
  closeBookmarkApp,
  cleanupBookmarkProfile
} = require('./common/bookmark-lifecycle')
const { startLocalSshServer } = require('./common/local-ssh-server')

test.setTimeout(180000)

function toolCall (id, name, args) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) }
  }
}

async function startAgentApi () {
  const requests = []
  const server = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks).toString('utf8')
    if (!rawBody) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'shellpilot-e2e' }] }))
      return
    }
    const body = JSON.parse(rawBody)
    requests.push(body)
    const messages = body.messages || []
    const prompt = [...messages].reverse().find(item => item.role === 'user')?.content || ''
    const toolResults = messages.filter(item => item.role === 'tool')
    let message
    if (!toolResults.length) {
      const command = prompt.includes('readonly-e2e')
        ? 'pwd'
        : 'systemctl restart nginx'
      message = {
        role: 'assistant',
        content: 'plan ready',
        tool_calls: [toolCall(`plan-${requests.length}`, 'confirm_agent_plan', {
          goal: `E2E ${prompt}`,
          steps: ['execute the frozen command'],
          readonlyCommands: [command],
          verification: []
        })]
      }
    } else if (toolResults.length === 1) {
      const command = prompt.includes('readonly-e2e')
        ? 'pwd'
        : 'systemctl restart nginx'
      message = {
        role: 'assistant',
        content: 'execute frozen call',
        tool_calls: [toolCall(`command-${requests.length}`, 'send_terminal_command', {
          command
        })]
      }
    } else {
      message = {
        role: 'assistant',
        content: prompt.includes('risk-cancel-e2e')
          ? 'risk cancelled complete'
          : prompt.includes('risk-confirm-e2e')
            ? 'risk confirmed complete'
            : 'readonly complete'
      }
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    port: server.address().port,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
}

async function acceptHostKeyIfShown (client, timeout = 1000) {
  const modal = client.locator('.custom-modal-wrap').last()
  if (await modal.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false)) {
    await modal.locator('button.ant-btn-primary').last().click()
    return true
  }
  return false
}

async function connectFirstSession (client, sshServer) {
  return openSshSession(client, sshServer)
}

async function openSshSession (client, sshServer) {
  const before = await client.evaluate(() => window.store.activeTabId)
  const shells = sshServer.state.shellCount
  await client.evaluate(server => window.store.mcpOpenTab({
    type: 'ssh',
    title: 'AI Takeover E2E',
    host: server.host,
    port: server.port,
    username: server.username,
    password: server.password,
    authType: 'password',
    useSshAgent: false,
    enableSsh: true,
    enableSftp: false
  }), {
    host: sshServer.host,
    port: sshServer.port,
    username: sshServer.username,
    password: sshServer.password
  })
  await acceptHostKeyIfShown(client, shells === 0 ? 20000 : 1000)
  await expect.poll(() => sshServer.state.shellCount, { timeout: 20000 }).toBeGreaterThan(shells)
  const tabId = await client.evaluate(() => window.store.activeTabId)
  expect(tabId).not.toBe(before)
  return tabId
}

async function openAiPanel (client) {
  await client.evaluate(() => window.store.handleOpenAIPanel())
  await expect(client.locator('.agent-takeover-switch')).toBeVisible()
}

async function enableTakeover (client) {
  const toggle = client.locator('.agent-takeover-switch')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  const confirmation = client.locator('.agent-takeover-confirm-modal')
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText('SHA256:')
  await confirmation.locator('.custom-modal-ok-btn').click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
}

async function runAgentPrompt (client, prompt, riskDecision) {
  const before = await client.locator('.chat-history-item').count()
  await client.locator('.ai-chat-container .ant-segmented-item').filter({ hasText: 'Agent' }).click()
  await client.locator('.ai-chat-textarea').fill(prompt)
  await client.locator('.send-to-ai-icon').click()

  const plan = client.locator('.ant-modal-confirm').last()
  await expect(plan).toBeVisible({ timeout: 15000 })
  await plan.locator('.ant-btn-primary').click()

  if (riskDecision) {
    const risk = client.locator('.ant-modal-confirm').filter({
      has: client.locator('.agent-risk-confirmation-content')
    })
    await expect(risk).toBeVisible({ timeout: 15000 })
    await expect(risk).toContainText('systemctl restart nginx')
    await expect(risk).toContainText('fingerprint=SHA256:')
    await (riskDecision === 'confirm'
      ? risk.locator('.ant-btn-primary').click()
      : risk.locator('.ant-btn-default').click())
    if (riskDecision === 'confirm') {
      const terminalSafety = client.locator('.terminal-command-safety-modal')
      await expect(terminalSafety).toBeVisible({ timeout: 15000 })
      await expect(terminalSafety).toContainText('systemctl restart nginx')
      await terminalSafety.locator('.terminal-command-safety-execute').click()
    }
  }

  await expect(client.locator('.chat-history-item')).toHaveCount(before + 1)
  const item = client.locator('.chat-history-item').last()
  await expect(item).toContainText(
    riskDecision === 'cancel'
      ? 'risk cancelled complete'
      : riskDecision === 'confirm'
        ? 'risk confirmed complete'
        : 'readonly complete',
    { timeout: 30000 }
  )
}

test('per-session takeover stays isolated and gates readonly and risky Agent work', async () => {
  const sshServer = await startLocalSshServer()
  const agentApi = await startAgentApi()
  let electronApp
  try {
    let launched = await launchBookmarkApp()
    electronApp = launched.electronApp
    let client = launched.client
    await client.evaluate(({ port }) => window.store.setConfig({
      baseURLAI: `http://127.0.0.1:${port}`,
      apiPathAI: '/chat/completions',
      modelAI: 'shellpilot-e2e',
      apiKeyAI: 'e2e-only-token',
      authHeaderNameAI: 'Authorization: Bearer',
      languageAI: 'English'
    }), { port: agentApi.port })

    const firstTab = await connectFirstSession(client, sshServer)
    await openAiPanel(client)
    await enableTakeover(client)

    const secondTab = await openSshSession(client, sshServer)
    await expect(client.locator('.agent-takeover-switch')).toHaveAttribute('aria-checked', 'false')
    await enableTakeover(client)
    await client.evaluate(tabId => window.store.mcpSwitchTab({ tabId }), firstTab)
    await expect(client.locator('.agent-takeover-switch')).toHaveAttribute('aria-checked', 'true')

    await runAgentPrompt(client, 'readonly-e2e', null)
    expect(sshServer.state.commands).toContain('pwd')
    const riskyBefore = sshServer.state.commands.filter(command => command === 'systemctl restart nginx').length
    await runAgentPrompt(client, 'risk-cancel-e2e', 'cancel')
    expect(sshServer.state.commands.filter(command => command === 'systemctl restart nginx')).toHaveLength(riskyBefore)
    await runAgentPrompt(client, 'risk-confirm-e2e', 'confirm')
    expect(sshServer.state.commands.filter(command => command === 'systemctl restart nginx')).toHaveLength(riskyBefore + 1)

    await client.locator('.agent-takeover-stop').click()
    await expect(client.locator('.agent-takeover-switch')).toHaveAttribute('aria-checked', 'false')
    await client.evaluate(tabId => window.store.mcpSwitchTab({ tabId }), secondTab)
    await expect(client.locator('.agent-takeover-switch')).toHaveAttribute('aria-checked', 'true')

    const shells = sshServer.state.shellCount
    await client.evaluate(tabId => window.store.mcpReloadTab({ tabId }), secondTab)
    await expect(client.locator('.agent-takeover-switch')).toHaveAttribute('aria-checked', 'false')
    await acceptHostKeyIfShown(client)
    await expect.poll(() => sshServer.state.shellCount, { timeout: 20000 }).toBeGreaterThan(shells)
    const reloadedTab = await client.evaluate(() => window.store.activeTabId)
    expect(reloadedTab).not.toBe(secondTab)
    await expect(client.locator('.agent-takeover-switch')).toHaveAttribute('aria-checked', 'false')

    await enableTakeover(client)
    await client.evaluate(tabId => window.store.mcpCloseTab({ tabId }), reloadedTab)
    await expect.poll(() => client.evaluate(() => window.store.activeTabId)).toBe(firstTab)
    const reopenedTab = await openSshSession(client, sshServer)
    expect(reopenedTab).not.toBe(secondTab)
    expect(reopenedTab).not.toBe(reloadedTab)
    await expect(client.locator('.agent-takeover-switch')).toHaveAttribute('aria-checked', 'false')

    await enableTakeover(client)
    await closeBookmarkApp(electronApp, __filename)
    electronApp = null
    launched = await launchBookmarkApp()
    electronApp = launched.electronApp
    client = launched.client
    await openSshSession(client, sshServer)
    await openAiPanel(client)
    await expect(client.locator('.agent-takeover-switch')).toHaveAttribute('aria-checked', 'false')
  } finally {
    await closeBookmarkApp(electronApp, __filename).catch(() => {})
    await cleanupBookmarkProfile().catch(() => {})
    await agentApi.close().catch(() => {})
    await sshServer.close().catch(() => {})
  }
})
