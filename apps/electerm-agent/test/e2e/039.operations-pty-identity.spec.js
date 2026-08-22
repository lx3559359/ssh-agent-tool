const { _electron: electron, expect, test } = require('@playwright/test')
const { createLocalSftpFixture } = require('./common/local-sftp-fixture')
const { startLocalSshServer } = require('./common/local-ssh-server')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')

test.setTimeout(180000)

async function dismissStartupModals (page) {
  const modal = page.locator('.custom-modal-container:visible')
  for (let attempt = 0; attempt < 4 && await modal.count(); attempt += 1) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
  }
}

async function acceptHostKey (page) {
  const modal = page.locator('.custom-modal-wrap').last()
  await expect(modal).toBeVisible({ timeout: 20000 })
  await modal.locator('button.ant-btn-primary').last().click()
}

async function connectWithQuickWizard (page, sshServer) {
  await page.locator('[data-action-key="new"]').click()
  const wizard = page.locator('.quick-connect-wizard')
  await expect(wizard).toBeVisible()
  await wizard.locator('#shellpilot-connect-host').fill(sshServer.host)
  await wizard.locator('#shellpilot-connect-port').fill(String(sshServer.port))
  await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
  await wizard.locator('#shellpilot-connect-username').fill(sshServer.username)
  await wizard.locator('#shellpilot-connect-password').fill(sshServer.password)
  await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
  await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
  await acceptHostKey(page)
  await expect.poll(
    () => sshServer.state.shellCount,
    { timeout: 20000 }
  ).toBeGreaterThan(0)
}

async function activeTerminal (page) {
  return page.evaluate(() => {
    const terminal = window.refs.get('term-' + window.store.activeTabId)
    return Boolean(
      terminal?.term &&
      terminal?.attachAddon &&
      terminal?.pid &&
      !terminal?.onClose
    )
  })
}

async function sendTerminalLine (page, command) {
  await expect.poll(() => activeTerminal(page), { timeout: 20000 }).toBe(true)
  await page.evaluate(() => {
    window.refs.get('term-' + window.store.activeTabId)?.term?.focus()
  })
  const input = page.locator('.session-current .xterm-helper-textarea').last()
  await expect(input).toBeFocused()
  await input.pressSequentially(command, { delay: 10 })
  await page.keyboard.press('Enter')
}

async function runPacketCaptureFromOperationsUi (page) {
  await page.evaluate(() => window.store.openOperationsToolkit('diagnostic'))
  const workspace = page.locator('.operations-toolkit-workspace')
  await expect(workspace).toBeVisible()
  await workspace.locator('.operations-tool-list')
    .getByText('网络抓包与报文采样')
    .click()
  await workspace.locator('.operations-run-actions button').click()
  const confirmation = page.locator('.ant-modal-confirm:visible').last()
  await expect(confirmation).toContainText('确认抓包范围')
  await confirmation.getByRole('button', { name: '确认抓包' }).click()
  await expect.poll(() => page.evaluate(() => (
    window.store.operationsTasks.find(
      task => task.toolId === 'network.packet-capture'
    )?.status || ''
  )), { timeout: 30000 }).toBe('completed')
  return workspace
}

test('operations and packet capture inherit su root while SFTP keeps the login identity', async () => {
  const fixture = await createLocalSftpFixture()
  const sshServer = await startLocalSshServer({
    managedPtyTasks: true,
    sftpRoot: fixture.root
  })
  let run
  let primaryError

  try {
    run = await launchQualityApp(electron)
    const { page } = run
    await dismissStartupModals(page)
    await connectWithQuickWizard(page, sshServer)
    await page.waitForTimeout(5000)
    const terminalSnapshot = await page.evaluate(() => {
      const terminal = window.refs.get('term-' + window.store.activeTabId)
      return {
        activeTabId: window.store.activeTabId,
        currentTabId: window.store.currentTab?.id,
        currentTabStatus: window.store.currentTab?.status,
        hasTerminal: Boolean(terminal),
        hasXterm: Boolean(terminal?.term),
        hasAttachAddon: Boolean(terminal?.attachAddon),
        pid: terminal?.pid || '',
        onClose: Boolean(terminal?.onClose),
        loading: terminal?.state?.loading,
        terminalError: terminal?.state?.terminalError || null,
        ready: Boolean(
          terminal?.term &&
          terminal?.attachAddon &&
          terminal?.pid &&
          !terminal?.onClose
        )
      }
    })
    expect(terminalSnapshot.ready, JSON.stringify(terminalSnapshot, null, 2))
      .toBe(true)
    const initialTracker = await page.evaluate(async () => {
      const terminal = window.refs.get('term-' + window.store.activeTabId)
      const result = await Promise.race([
        terminal.ensureCommandSafetyTrackerReady().then(
          () => ({ ready: true }),
          error => ({ ready: false, error: error?.message || String(error) })
        ),
        new Promise(resolve => setTimeout(() => resolve({
          ready: false,
          timedOut: true
        }), 12000))
      ])
      return {
        ...result,
        shellPhase: terminal?.cmdAddon?.shellPhase,
        integrationActive: terminal?.cmdAddon?.hasShellIntegration?.(),
        commandInputActive: terminal?.cmdAddon?.isCommandInputActive?.(),
        currentInput: terminal?.cmdAddon?.getCurrentCommandInput?.(),
        shellInjected: terminal?.shellInjected
      }
    })
    expect(initialTracker.ready, JSON.stringify({
      initialTracker,
      server: {
        commands: sshServer.state.commands,
        shellIntegrationNonce: sshServer.state.shellIntegrationNonce
      }
    }, null, 2)).toBe(true)

    await sendTerminalLine(page, 'su root')
    await expect.poll(
      () => sshServer.state.effectiveIdentity?.username,
      { timeout: 10000 }
    ).toBe('root')
    await expect.poll(() => page.evaluate(() => {
      const terminal = window.refs.get('term-' + window.store.activeTabId)
      const candidate = terminal?.shellTransitionCandidate
      return Boolean(
        candidate?.authenticated &&
        candidate.outputObservedSequence > candidate.observedOutputSequence
      )
    }), { timeout: 10000 }).toBe(true)

    const diagnostic = await page.evaluate(async () => {
      const task = await window.store
        .runOperationsTool('system.overview')
        .completion
      return {
        endpoint: task.endpoint,
        runtimeIdentity: task.runtimeIdentity,
        status: task.status,
        error: task.error,
        output: task.steps.map(step => step.output).join('\n')
      }
    })
    expect(diagnostic.status, JSON.stringify({
      diagnostic,
      server: {
        commands: sshServer.state.commands,
        effectiveIdentity: sshServer.state.effectiveIdentity,
        shellIntegrationRearms: sshServer.state.shellIntegrationRearms,
        managedPtyScripts: sshServer.state.managedPtyScripts
      }
    }, null, 2))
      .toBe('completed')
    expect(diagnostic.endpoint.username).toBe(sshServer.username)
    expect(diagnostic.endpoint.connectionUsername).toBe(sshServer.username)
    expect(diagnostic.runtimeIdentity).toEqual({
      channel: 'pty',
      effectiveUid: '0',
      effectiveUsername: 'root'
    })
    expect(diagnostic.output).toContain('managed_user=root managed_uid=0')
    expect(sshServer.state.shellIntegrationRearms).toBe(1)
    expect(sshServer.state.managedPtyScripts.length).toBeGreaterThan(0)
    expect(sshServer.state.execCommands.some(
      command => command.includes('/.shellpilot/tasks/')
    )).toBe(false)

    const workspace = await runPacketCaptureFromOperationsUi(page)
    expect(sshServer.state.managedPtyScripts.some(
      item => item.script.includes('tcpdump')
    )).toBe(true)
    await expect(workspace.locator('.operations-task-identities'))
      .toContainText('登录用户')
    await expect(workspace.locator('.operations-task-identities'))
      .toContainText('当前 Shell：root')
    await workspace.locator('button[aria-label="关闭运维工具"]').click()

    const terminal = page.locator('.session-current')
    await terminal.locator('.term-sftp-tabs .type-tab:visible').nth(1).click()
    await expect.poll(
      () => sshServer.state.sftpSessions,
      { timeout: 20000 }
    ).toBeGreaterThan(0)
    expect(sshServer.state.authenticatedUsernames.length).toBeGreaterThan(0)
    expect(sshServer.state.authenticatedUsernames.every(
      username => username === sshServer.username
    )).toBe(true)

    await terminal.locator('.term-sftp-tabs .type-tab:visible').first().click()
    await sendTerminalLine(page, 'exit')
    await expect.poll(
      () => sshServer.state.effectiveIdentity?.username,
      { timeout: 10000 }
    ).toBe(sshServer.username)
    const afterExit = await page.evaluate(async () => {
      const task = await window.store
        .runOperationsTool('system.overview')
        .completion
      return {
        endpoint: task.endpoint,
        runtimeIdentity: task.runtimeIdentity,
        status: task.status
      }
    })
    expect(afterExit.status, JSON.stringify(afterExit, null, 2))
      .toBe('completed')
    expect(afterExit.runtimeIdentity.effectiveUsername)
      .toBe(sshServer.username)
    expect(afterExit.endpoint.connectionUsername).toBe(sshServer.username)
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    await sshServer.close().catch(() => {})
    if (run) {
      await cleanupQualityApp(run.electronApp, run.profileRoot).catch(error => {
        if (!primaryError) throw error
      })
    }
    await fixture.cleanup().catch(() => {})
  }
})
