const http = require('node:http')
const { once } = require('node:events')
const { test, expect } = require('@playwright/test')
const {
  launchBookmarkApp,
  closeBookmarkApp,
  cleanupBookmarkProfile
} = require('./common/bookmark-lifecycle')
const { startLocalSshServer } = require('./common/local-ssh-server')
const aiAgentCopy = require('../../src/client/components/ai/ai-agent-copy.json')

test.setTimeout(240000)

const riskContext = Object.freeze({
  purpose: 'Exercise the exact nginx restart safety transaction in the local E2E fixture',
  impactTargets: ['nginx service in the isolated local SSH fixture'],
  verification: [{
    name: 'read_service_status',
    args: { service: 'nginx' },
    expected: { exitCode: 0, contains: 'ActiveState=active' }
  }]
})

function toolCall (id, name, args) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) }
  }
}

function commandForPrompt (prompt) {
  if (prompt.includes('readonly-stop-e2e')) return 'cat /proc/loadavg'
  if (prompt.includes('readonly-e2e')) return 'ip addr'
  return 'systemctl restart nginx'
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
    let userIndex = -1
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index]?.role === 'user') {
        userIndex = index
        break
      }
    }
    const prompt = String(messages[userIndex]?.content || '')
    const toolResults = messages.slice(userIndex + 1).filter(item => item.role === 'tool')
    const command = commandForPrompt(prompt)
    const message = toolResults.length
      ? {
          role: 'assistant',
          content: prompt.includes('risk-cancel-e2e')
            ? 'risk cancelled complete'
            : prompt.includes('risk-confirm-e2e')
              ? 'risk confirmed complete'
              : 'readonly complete'
        }
      : {
          role: 'assistant',
          content: 'executing exact E2E call',
          tool_calls: [toolCall(
            `command-${requests.length}`,
            prompt.includes('readonly')
              ? 'run_readonly_command'
              : 'send_terminal_command',
            prompt.includes('readonly')
              ? { command }
              : { command, riskContext }
          )]
        }
    if (!toolResults.length && prompt.includes('readonly-e2e')) {
      await new Promise(resolve => setTimeout(resolve, 120))
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

async function submitAgentPrompt (client, prompt) {
  const before = await client.locator('.chat-history-item').count()
  await client.locator('.ai-chat-container .ant-segmented-item').filter({ hasText: 'Agent' }).click()
  await client.locator('.ai-chat-textarea').fill(prompt)
  const send = client.locator('.send-to-ai-icon')
  await expect(send).not.toHaveClass(/disabled/)
  const startedAt = Date.now()
  await send.click()
  await expect(client.locator('.chat-history-item')).toHaveCount(before + 1)
  return { startedAt, item: client.locator('.chat-history-item').last() }
}

async function expectAgentCompleted (client, item, text) {
  await expect(item).toContainText(text, { timeout: 30000 })
  await expect(client.locator('.agent-send-running')).toHaveCount(0)
  await expect(client.locator('.send-to-ai-icon')).toBeVisible()
}

async function focusActiveTerminalInput (client) {
  const input = client.locator('.session-current .xterm-helper-textarea').last()
  await input.evaluate(element => element.focus())
  await expect(input).toBeFocused()
  return input
}

async function typeManualCommand (client, sshServer, command) {
  const before = sshServer.state.commands.filter(value => value === command).length
  await focusActiveTerminalInput(client)
  await client.keyboard.type(command)
  await client.keyboard.press('Enter')
  await expect.poll(
    () => sshServer.state.commands.filter(value => value === command).length,
    { timeout: 10000 }
  ).toBe(before + 1)
  await expect(client.locator('.terminal-command-safety-modal')).toHaveCount(0)
  await expect(client.locator('.agent-risk-confirmation-content')).toHaveCount(0)
}

test('per-session takeover uses readonly exec, direct manual input and one risky confirmation', async () => {
  const sshServer = await startLocalSshServer({
    execDelayMsByCommand: { 'cat /proc/loadavg': 30000 }
  })
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

    const firstTab = await openSshSession(client, sshServer)
    await openAiPanel(client)
    await enableTakeover(client)

    const secondTab = await openSshSession(client, sshServer)
    await expect(client.locator('.agent-takeover-switch')).toHaveAttribute('aria-checked', 'false')
    await enableTakeover(client)
    await client.evaluate(tabId => window.store.mcpSwitchTab({ tabId }), firstTab)
    await expect(client.locator('.agent-takeover-switch')).toHaveAttribute('aria-checked', 'true')

    for (const command of ['ip a', 'ip addr', 'systemctl restart nginx']) {
      await typeManualCommand(client, sshServer, command)
    }
    await expect.poll(() => client.evaluate(async () => {
      const terminal = window.refs.get('term-' + window.store.activeTabId)
      await terminal?.injectShellIntegration?.({ forceForSafety: true })
      return terminal?.isCommandSafetyTrackerReady?.() === true
    }), { timeout: 10000 }).toBe(true)

    await focusActiveTerminalInput(client)
    await client.keyboard.type('pending-terminal-input')
    await expect.poll(() => client.evaluate(() => window.refs
      .get('term-' + window.store.activeTabId)
      ?.getCurrentInput?.())).toBe('pending-terminal-input')

    const readonlyCommandsBefore = sshServer.state.commands.filter(value => value === 'ip addr').length
    const readonlyExecBefore = sshServer.state.execCommands.filter(value => value === 'ip addr').length
    const readonlyRun = await submitAgentPrompt(client, 'readonly-e2e')
    await expect(client.locator('.agent-send-running')).toBeVisible()
    await expect(client.locator('.ant-modal-confirm')).toHaveCount(0)
    await expect(client.locator('.terminal-command-safety-modal')).toHaveCount(0)
    await expectAgentCompleted(client, readonlyRun.item, 'readonly complete')
    expect(Date.now() - readonlyRun.startedAt).toBeLessThan(3000)
    expect(sshServer.state.execCommands.filter(value => value === 'ip addr')).toHaveLength(readonlyExecBefore + 1)
    expect(sshServer.state.commands.filter(value => value === 'ip addr')).toHaveLength(readonlyCommandsBefore)

    const readonlyCard = readonlyRun.item.locator('.agent-tool-readonly-card')
    const evidence = await client.evaluate(() => {
      const item = [...window.store.aiChatHistory].reverse()
        .find(entry => entry.displayPrompt === 'readonly-e2e')
      return item?.toolCalls?.[0]?.presentation
    })
    expect(evidence.target).toBeTruthy()
    expect(evidence.exitCode).toBe(0)
    expect(evidence.truncated).toBe(false)
    expect(evidence.output).toContain('LOOPBACK')
    await expect(readonlyCard.locator('.agent-readonly-command')).toHaveText('ip addr')
    const statusItems = readonlyCard.locator('.agent-readonly-status-line span')
    await expect(statusItems.nth(0)).toHaveText(
      `${aiAgentCopy.toolCall.targetLabel}: ${evidence.target}`
    )
    await expect(statusItems.nth(1)).toHaveText(
      `${aiAgentCopy.toolCall.durationLabel}: ${evidence.durationMs} ms`
    )
    await expect(statusItems.nth(2)).toHaveText(
      `${aiAgentCopy.toolCall.exitCodeLabel}: ${evidence.exitCode}`
    )
    await readonlyCard.locator('.agent-readonly-toggle').first().click()
    await expect(readonlyCard.locator('.agent-readonly-output')).toContainText('LOOPBACK')

    const fillButton = readonlyCard.locator('.agent-readonly-actions button').nth(1)
    await expect(fillButton).toBeDisabled()
    await expect(readonlyCard.locator('.agent-readonly-fill-reason'))
      .toContainText('当前终端已有输入')
    await focusActiveTerminalInput(client)
    await client.keyboard.press('Control+C')
    await expect.poll(() => client.evaluate(() => window.refs
      .get('term-' + window.store.activeTabId)
      ?.getCurrentInput?.())).toBe('')
    await expect.poll(() => client.evaluate(() => window.refs
      .get('term-' + window.store.activeTabId)
      ?.isCommandSafetyTrackerReady?.())).toBe(true)
    await readonlyCard.locator('.agent-readonly-toggle').first().click()
    await expect(fillButton).toBeEnabled()
    await fillButton.click()
    await expect.poll(() => client.evaluate(() => window.refs
      .get('term-' + window.store.activeTabId)
      ?.getCurrentInput?.())).toBe('ip addr')
    expect(sshServer.state.commands.filter(value => value === 'ip addr')).toHaveLength(readonlyCommandsBefore)
    await focusActiveTerminalInput(client)
    await client.keyboard.press('Enter')
    await expect.poll(
      () => sshServer.state.commands.filter(value => value === 'ip addr').length
    ).toBe(readonlyCommandsBefore + 1)
    await expect.poll(() => client.evaluate(() => window.refs
      .get('term-' + window.store.activeTabId)
      ?.getCurrentInput?.())).toBe('')

    await client.evaluate(({ firstTab, secondTab }) => {
      const original = [...window.store.aiChatHistory].reverse()
        .find(entry => entry.displayPrompt === 'readonly-e2e')
      window.store.aiChatHistory = [...window.store.aiChatHistory, {
        ...original,
        id: 'readonly-wrong-tab-e2e',
        conversationScopeId: secondTab,
        sourceTabId: secondTab,
        displayPrompt: 'readonly-wrong-tab-e2e',
        toolCalls: original.toolCalls.map(call => ({
          ...call,
          presentation: { ...call.presentation, tabId: firstTab }
        }))
      }]
      window.store.mcpSwitchTab({ tabId: secondTab })
    }, { firstTab, secondTab })
    const wrongTabCard = client.locator('.chat-history-item').last()
      .locator('.agent-tool-readonly-card')
    await expect(wrongTabCard).toBeVisible()
    const wrongTabFill = wrongTabCard.locator('.agent-readonly-actions button').nth(1)
    await expect(wrongTabFill).toBeDisabled()
    await expect(wrongTabCard.locator('.agent-readonly-fill-reason'))
      .toContainText('执行该命令的 SSH 标签页')
    await client.evaluate(tabId => window.store.mcpSwitchTab({ tabId }), firstTab)

    const riskyBefore = sshServer.state.commands.filter(value => value === 'systemctl restart nginx').length
    const cancelRun = await submitAgentPrompt(client, 'risk-cancel-e2e')
    const cancelModal = client.locator('.terminal-command-safety-modal')
    await expect(cancelModal).toHaveCount(1)
    await expect(cancelModal).toContainText('systemctl restart nginx')
    const boundEndpoint = await client.evaluate(() => window.refs
      .get('term-' + window.store.activeTabId)
      ?.getTerminalSafetyEndpoint?.())
    await expect(cancelModal).toContainText(riskContext.purpose)
    await expect(cancelModal).toContainText(riskContext.impactTargets[0])
    await expect(cancelModal).toContainText(riskContext.verification[0].name)
    await expect(cancelModal).toContainText(riskContext.verification[0].expected.contains)
    await expect(cancelModal).toContainText(boundEndpoint.hostKeyFingerprint)
    await expect(cancelModal).toContainText(
      `${boundEndpoint.username}@${boundEndpoint.host}:${boundEndpoint.port}`
    )
    await expect(client.locator('.agent-risk-confirmation-content')).toHaveCount(0)
    await cancelModal.locator('.custom-modal-cancel-btn').click()
    await expectAgentCompleted(client, cancelRun.item, 'risk cancelled complete')
    expect(sshServer.state.commands.filter(value => value === 'systemctl restart nginx')).toHaveLength(riskyBefore)

    const confirmRun = await submitAgentPrompt(client, 'risk-confirm-e2e')
    const confirmModal = client.locator('.terminal-command-safety-modal')
    await expect(confirmModal).toHaveCount(1)
    await expect(confirmModal).toContainText('systemctl restart nginx')
    await expect(client.locator('.agent-risk-confirmation-content')).toHaveCount(0)
    await confirmModal.locator('.terminal-command-safety-execute').click()
    await expectAgentCompleted(client, confirmRun.item, 'risk confirmed complete')
    expect(sshServer.state.commands.filter(value => value === 'systemctl restart nginx')).toHaveLength(riskyBefore + 1)

    const stopRun = await submitAgentPrompt(client, 'readonly-stop-e2e')
    await expect.poll(
      () => sshServer.state.execCommands.filter(value => value === 'cat /proc/loadavg').length,
      { timeout: 15000 }
    ).toBe(1)
    await expect(client.locator('.agent-send-running')).toBeVisible()
    await client.locator('.agent-takeover-stop').click()
    await expect(stopRun.item).toContainText(/stopped|cancel/i, { timeout: 30000 })
    await expect(client.locator('.agent-takeover-switch')).toHaveAttribute('aria-checked', 'false')
    await expect.poll(() => sshServer.state.cancelledExecCommands)
      .toContain('cat /proc/loadavg')

    await client.evaluate(tabId => window.store.mcpSwitchTab({ tabId }), secondTab)
    await expect(client.locator('.agent-takeover-switch')).toHaveAttribute('aria-checked', 'true')
    const shells = sshServer.state.shellCount
    await client.evaluate(tabId => window.store.mcpReloadTab({ tabId }), secondTab)
    await expect(client.locator('.agent-takeover-switch')).toHaveAttribute('aria-checked', 'false')
    await acceptHostKeyIfShown(client)
    await expect.poll(() => sshServer.state.shellCount, { timeout: 20000 }).toBeGreaterThan(shells)
    const reloadedTab = await client.evaluate(() => window.store.activeTabId)
    expect(reloadedTab).not.toBe(secondTab)

    await enableTakeover(client)
    await client.evaluate(tabId => window.store.mcpCloseTab({ tabId }), reloadedTab)
    await expect.poll(() => client.evaluate(() => window.store.activeTabId)).toBe(firstTab)
    const reopenedTab = await openSshSession(client, sshServer)
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
    expect(reopenedTab).not.toBe(reloadedTab)

    const offeredToolNames = agentApi.requests.flatMap(request => (
      request.tools || []
    )).map(tool => tool?.function?.name)
    expect(offeredToolNames).not.toContain('confirm_agent_plan')
  } finally {
    await closeBookmarkApp(electronApp, __filename).catch(() => {})
    await cleanupBookmarkProfile().catch(() => {})
    await agentApi.close().catch(() => {})
    await sshServer.close().catch(() => {})
  }
})
