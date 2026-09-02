const { promises: fs } = require('node:fs')
const path = require('node:path')
const { _electron: electron, expect, test } = require('@playwright/test')
const { createLocalSftpFixture } = require('./common/local-sftp-fixture')
const {
  parsePrivilegedFileCommand,
  startLocalSshServer
} = require('./common/local-ssh-server')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')
const {
  verifyFileTransfersComplete
} = require('./common/common')

test.setTimeout(240000)

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

async function terminalBufferText (page) {
  return page.evaluate(() => {
    const terminal = window.refs.get('term-' + window.store.activeTabId)
    return terminal?.getTerminalBufferText?.() || ''
  })
}

async function expectManagedPtyEchoHidden (page) {
  const text = await terminalBufferText(page)
  expect(text).not.toMatch(
    /SHELLPILOT_FILE|SHELLPILOT_TOKEN|SHELLPILOT_ARG_|__sp_/
  )
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

async function openRemoteFilePanel (page) {
  const terminal = page.locator('.session-current')
  await terminal.locator('.term-sftp-tabs .type-tab:visible').nth(1).click()
  await expect.poll(() => page.evaluate(() => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    return Boolean(entry?.sftp && entry.state.remoteLoading === false)
  }), { timeout: 30000 }).toBe(true)
}

async function gotoRemotePath (page, remotePath, options = {}) {
  const requestEpoch = await remoteRequestEpoch(page)
  const input = page.locator(
    '.session-current .sftp-remote-section .sftp-title input'
  )
  await input.fill(remotePath)
  await input.press('Enter')
  await waitForRemoteRequestCycle(page, requestEpoch, {
    compensation: false
  })
  if (options.expectFailure) return
  await expect(input).toHaveValue(remotePath, { timeout: 30000 })
  await expect.poll(() => page.evaluate(() => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    return entry?.state.remotePath
  })).toBe(remotePath)
}

function remoteEditor (page) {
  return page.locator('.custom-modal-wrap:visible').filter({
    has: page.locator('.simple-editor textarea')
  }).last()
}

async function openRemoteEditor (page, name) {
  const row = page.locator(
    `.session-current .file-list.remote .sftp-item[title="${name}"]`
  )
  await expect(row).toBeVisible({ timeout: 30000 })
  await row.dblclick()
  await expect(remoteEditor(page)).toBeVisible({ timeout: 30000 })
}

async function replaceRemoteEditorText (page, text) {
  await remoteEditor(page).locator('.simple-editor textarea').fill(text)
}

async function saveRemoteEditor (page) {
  const trackerReady = () => page.evaluate(() => {
    const terminal = window.refs.get('term-' + window.store.activeTabId)
    return {
      ready: terminal?.isCommandSafetyTrackerReady?.(),
      operationsBusy: terminal?.operationsPtyTaskController?.isBusy?.()
    }
  })
  await expect.poll(async () => {
    const tracker = await trackerReady()
    return tracker.operationsBusy === false && tracker.ready === true
  }, { timeout: 5000 }).toBe(true)
  const requestEpoch = await remoteRequestEpoch(page)
  await remoteEditor(page)
    .locator('form > .pd1t.pd2b')
    .first()
    .locator('button.ant-btn-primary')
    .click({ timeout: 5000 })
  const confirmation = page.locator('.custom-modal-wrap:visible').filter({
    has: page.locator('.sftp-safety-confirmation')
  }).last()
  await expect(confirmation).toBeVisible({ timeout: 60000 })
  await confirmation.locator('.custom-modal-ok-btn').click()
  await expect(remoteEditor(page)).toHaveCount(0, { timeout: 30000 })
  await waitForRemoteRequestCycle(page, requestEpoch)
}

function remoteRow (page, name) {
  return page.locator(
    `.session-current .file-list.remote .sftp-item[title="${name}"]`
  )
}

async function waitForRemotePanelReady (page) {
  const readReady = () => page.evaluate(() => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    const terminal = window.refs.get('term-' + window.store.activeTabId)
    return entry?.state.remoteLoading === false &&
      terminal?.operationsPtyTaskController?.isBusy?.() === false &&
      terminal?.isCommandSafetyTrackerReady?.() === true
  })
  await expect.poll(readReady, { timeout: 15000 }).toBe(true)
}

async function exposeFileMenuActions (page) {
  const moreActions = page.locator(
    '.ant-dropdown:visible [data-menu-id$="-moreActionsMenu"]'
  ).first()
  if (await moreActions.isVisible().catch(() => false)) {
    await moreActions.hover()
    await expect(page.locator(
      '.ant-dropdown-menu-submenu-popup:visible'
    ).last()).toBeVisible({ timeout: 5000 })
  }
}

async function clickFileMenuAction (page, actionKey) {
  await exposeFileMenuActions(page)
  const item = page.locator(
    '.ant-dropdown:visible, .ant-dropdown-menu-submenu-popup:visible'
  ).locator(
    `[data-menu-id$="-${actionKey}"]:not(.ant-dropdown-menu-item-disabled)`
  ).first()
  await expect(item).toBeVisible({ timeout: 5000 })
  await item.click()
}

async function recentTransferHistory (page) {
  return page.evaluate(() => window.store.transferHistory.slice(0, 6)
    .map(item => ({
      id: item.id,
      originalId: item.originalId,
      name: item.name || item.fromFile?.name || '',
      status: item.status,
      classification: item.status === 'cancelled'
        ? 'cancelled'
        : item.status === 'success'
          ? 'success'
          : 'failed',
      error: item.error || '',
      outcomeCounts: item.outcomeCounts
    })))
}

function preserveCleanupFailure (primaryError, cleanupErrors, error) {
  cleanupErrors.push(error)
  if (!primaryError) return
  primaryError.cleanupErrors = cleanupErrors
  if (!primaryError.cleanupError) primaryError.cleanupError = error
}

async function setLocalPath (page, localPath) {
  const input = page.locator(
    '.session-current .sftp-local-section .sftp-title input'
  )
  await input.fill(localPath)
  await input.press('Enter')
  await expect.poll(() => page.evaluate(() => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    return entry?.state.localLoading === false ? entry.state.localPath : ''
  }), { timeout: 30000 }).toBe(localPath)
}

async function createRemoteDirectoryFromUi (page, name) {
  await waitForRemotePanelReady(page)
  const requestEpoch = await remoteRequestEpoch(page)
  await page.locator('.session-current .file-list.remote .parent-file-item')
    .click({ button: 'right' })
  await clickFileMenuAction(page, 'newDirectory')
  const input = page.locator(
    '.session-current .file-list.remote .sftp-item input'
  ).last()
  await input.fill(name)
  await page.locator('.session-current .sftp-panel-title').first().click()
  await expect(remoteRow(page, name)).toBeVisible({ timeout: 30000 })
  await waitForRemoteRequestCycle(page, requestEpoch)
}

async function transferFromContextMenu (page, type, name) {
  await waitForRemotePanelReady(page)
  const row = page.locator(
    `.session-current .file-list.${type} .sftp-item[title="${name}"]`
  )
  await expect(row).toBeVisible({ timeout: 30000 })
  await row.click({ button: 'right' })
  await clickFileMenuAction(page, 'doTransfer')
}

async function renameRemoteFromUi (page, oldName, newName) {
  await waitForRemotePanelReady(page)
  const requestEpoch = await remoteRequestEpoch(page)
  await remoteRow(page, oldName).click({ button: 'right' })
  await clickFileMenuAction(page, 'doRename')
  const input = page.locator(
    '.session-current .file-list.remote .sftp-item input'
  ).last()
  await input.fill(newName)
  await page.locator('.session-current .sftp-panel-title').first().click()
  const confirmation = page.locator('.custom-modal-wrap:visible').filter({
    has: page.locator('.sftp-safety-confirmation')
  }).last()
  await expect(confirmation).toBeVisible({ timeout: 30000 })
  await confirmation.locator('.custom-modal-ok-btn').click()
  await expect(remoteRow(page, newName)).toBeVisible({ timeout: 30000 })
  await expect(remoteRow(page, oldName)).toHaveCount(0)
  await waitForRemoteRequestCycle(page, requestEpoch)
}

async function chmodRemoteFromUi (page, name) {
  await waitForRemotePanelReady(page)
  const requestEpoch = await remoteRequestEpoch(page)
  await remoteRow(page, name).click({ button: 'right' })
  await clickFileMenuAction(page, 'editPermission')
  const permissionButton = page
    .locator('.custom-modal-container .file-props > .pd1b > .pd1b')
    .filter({ hasText: /其他|other/i })
    .locator('.ant-btn')
    .filter({ hasText: /写|write/i })
    .first()
  await expect(permissionButton).toBeVisible()
  const initiallyActive = String(await permissionButton.getAttribute('class'))
    .includes('ant-btn-primary')
  await permissionButton.click()
  await page.locator('.custom-modal-footer .ant-btn-primary').click()
  const confirmation = page.locator('.custom-modal-wrap:visible').filter({
    has: page.locator('.sftp-safety-confirmation')
  }).last()
  await expect(confirmation).toBeVisible({ timeout: 30000 })
  await confirmation.locator('.custom-modal-ok-btn').click()
  await waitForRemoteRequestCycle(page, requestEpoch)
  return initiallyActive
}

async function deleteRemoteFromUi (page, name, { fast = false } = {}) {
  await waitForRemotePanelReady(page)
  const requestEpoch = await remoteRequestEpoch(page)
  const row = remoteRow(page, name)
  await row.click({ button: 'right' })
  await clickFileMenuAction(page, fast ? 'quickDelete' : 'del')
  const confirmation = page.locator('.custom-modal-wrap:visible').last()
  await expect(confirmation).toBeVisible({ timeout: 30000 })
  const ok = confirmation.locator('.custom-modal-ok-btn')
  await expect(ok).toBeEnabled({ timeout: 30000 })
  await ok.click()
  await expect(row).toHaveCount(0, { timeout: 30000 })
  await waitForRemoteRequestCycle(page, requestEpoch)
}

async function remoteRequestEpoch (page) {
  return page.evaluate(() => (
    window.refs.get('sftp-' + window.store.activeTabId)
      ?.sftpRemoteRequestEpoch || 0
  ))
}

async function waitForRemoteRequestCycle (
  page,
  requestEpoch,
  { compensation = false } = {}
) {
  const expectedEpoch = requestEpoch + (compensation ? 2 : 1)
  await expect.poll(() => remoteRequestEpoch(page), { timeout: 30000 })
    .toBeGreaterThanOrEqual(expectedEpoch)
  await waitForRemotePanelReady(page)
  await expectRemoteFileWorkSettled(page)
}

async function expectRemoteFileWorkSettled (page) {
  await expect.poll(() => page.evaluate(() => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    const terminal = window.refs.get('term-' + window.store.activeTabId)
    const generation = entry?.remoteFileGeneration
    return {
      transfers: window.store.fileTransfers.length,
      busy: terminal?.operationsPtyTaskController?.isBusy?.(),
      capabilities: generation?.capabilities?.size || 0,
      settlements: generation?.settlements?.size || 0,
      backends: generation?.backends?.size || 0
    }
  }), { timeout: 30000 }).toEqual({
    transfers: 0,
    busy: false,
    capabilities: 0,
    settlements: 0,
    backends: 0
  })
}

test('local SSH fixture rejects altered compact privileged command shapes', async () => {
  const { buildPrivilegedFileCommand } = await import(
    '../../src/client/components/sftp/privileged-file-protocol.js'
  )
  const token = 'a7'.repeat(24)
  const probe = buildPrivilegedFileCommand({
    token,
    request: { operation: 'probe', args: {} }
  })
  expect(parsePrivilegedFileCommand(probe)?.operation).toBe('probe')
  expect(parsePrivilegedFileCommand(probe + ' :')).toBeNull()
  const tamperedProbe = probe.replace('cleanShell=1', 'cleanShell=1; :')
  expect(tamperedProbe).not.toBe(probe)
  expect(parsePrivilegedFileCommand(tamperedProbe)).toBeNull()

  const list = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'list-bound',
      args: {
        path: '/root-only',
        sourceParentRealPath: '/',
        sourceParentDevice: '3001',
        sourceParentInode: '3002',
        sourceDevice: '3003',
        sourceInode: '3004'
      }
    }
  })
  expect(parsePrivilegedFileCommand(list)?.operation).toBe('list-bound')
  expect(parsePrivilegedFileCommand(list + ' :')).toBeNull()
  const tamperedList = list.replace('L() {', 'L() { :;')
  expect(tamperedList).not.toBe(list)
  expect(parsePrivilegedFileCommand(tamperedList)).toBeNull()

  const firstArgument = /\bA0='([A-Za-z0-9+/=]+)'/.exec(list)?.[1]
  expect(firstArgument).toBeTruthy()
  const noncanonicalArguments = [
    firstArgument + '=',
    firstArgument + '==',
    firstArgument.replace(/=+$/, ''),
    firstArgument.replace(/Q==$/, 'R==')
  ]
  for (const noncanonicalArgument of noncanonicalArguments) {
    const noncanonical = list.replace(
      `A0='${firstArgument}'`,
      `A0='${noncanonicalArgument}'`
    )
    expect(parsePrivilegedFileCommand(noncanonical)).toBeNull()
  }

  const reviewerToken = 'acaaacaaacaaacaaacaaacaaacaaacaa'
  const reviewerPath = '/aa' + Buffer.from(
    reviewerToken,
    'base64'
  ).toString('utf8')
  const reviewerList = buildPrivilegedFileCommand({
    token: reviewerToken,
    request: {
      operation: 'list-bound',
      args: {
        path: reviewerPath,
        sourceParentRealPath: '/',
        sourceParentDevice: '3001',
        sourceParentInode: '3002',
        sourceDevice: '3003',
        sourceInode: '3004'
      }
    }
  })
  const reviewerFirstArgument = /\bA0='([A-Za-z0-9+/=]+)'/.exec(
    reviewerList
  )?.[1]
  expect(reviewerFirstArgument).toContain(reviewerToken)
  expect(parsePrivilegedFileCommand(reviewerList)?.operation)
    .toBe('list-bound')

  const tokenField = `SHELLPILOT_TOKEN='${reviewerToken}'`
  expect(parsePrivilegedFileCommand(reviewerList.replace(
    tokenField,
    `${tokenField} ${tokenField}`
  ))).toBeNull()
  expect(parsePrivilegedFileCommand(reviewerList.replace(
    tokenField,
    "SHELLPILOT_TOKEN='ACAAACAAACAAACAAACAAACAAACAAACAA'"
  ))).toBeNull()
  expect(parsePrivilegedFileCommand(reviewerList.replace(
    tokenField,
    tokenField + 'X'
  ))).toBeNull()
})

test('operations and the complete remote file panel inherit su root then return to the login identity', async () => {
  const fixture = await createLocalSftpFixture()
  await fs.mkdir(path.join(
    fixture.root,
    'home',
    'shellpilot',
    'folder-a',
    'folder-b'
  ), { recursive: true })
  const sshServer = await startLocalSshServer({
    managedPtyTasks: true,
    sftpRoot: fixture.root,
    sftpFixture: fixture,
    rootDownloadDelayMs: 30000,
    omitManagedPtyCancellationCommandFinish: true,
    managedPtyCancellationEchoTail:
      'SHELLPILOT_FILE=1 __sp_cancel_tail=hidden'
  })
  let run
  let primaryError
  let cleanupFailure

  try {
    run = await launchQualityApp(electron)
    const { page } = run
    await dismissStartupModals(page)
    await connectWithQuickWizard(page, sshServer)
    await expect.poll(() => activeTerminal(page), { timeout: 20000 })
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

    await openRemoteFilePanel(page)
    await expect.poll(() => sshServer.state.sftpEvents.filter(event => (
      event.event === 'OPENDIR' && event.path === '/home/shellpilot'
    )).length, { timeout: 20000 }).toBeGreaterThan(0)
    await waitForRemotePanelReady(page)
    await expectRemoteFileWorkSettled(page)
    await expectManagedPtyEchoHidden(page)
    const terminalBeforeDirectoryNavigation = await terminalBufferText(page)
    for (const name of ['folder-a', 'folder-b']) {
      const requestEpoch = await remoteRequestEpoch(page)
      await remoteRow(page, name).dblclick()
      await waitForRemoteRequestCycle(page, requestEpoch)
    }
    expect(await terminalBufferText(page))
      .toBe(terminalBeforeDirectoryNavigation)
    await gotoRemotePath(page, '/home/shellpilot')
    await page.locator('.session-current .term-sftp-tabs .type-tab:visible')
      .first().click()
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

    await sendTerminalLine(page, 'su')
    await expect.poll(() => terminalBufferText(page))
      .toContain('Password:')
    await sendTerminalLine(page, sshServer.password)
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

    await openRemoteFilePanel(page)
    await expect.poll(
      () => sshServer.state.sftpSessions,
      { timeout: 20000 }
    ).toBeGreaterThan(0)
    expect(sshServer.state.authenticatedUsernames.length).toBeGreaterThan(0)
    expect(sshServer.state.authenticatedUsernames.every(
      username => username === sshServer.username
    )).toBe(true)

    await gotoRemotePath(page, '/root-only')
    await expect(page.locator('.sftp-file-identity')).toContainText(
      '文件操作：root（当前终端）'
    )
    await expectRemoteFileWorkSettled(page)
    await expectManagedPtyEchoHidden(page)
    const rootTerminalText = await terminalBufferText(page)
    expect(rootTerminalText).not.toContain('__e_cmd: command not found')
    expect(rootTerminalText).not.toContain(sshServer.password)
    expect(rootTerminalText.match(/root@fixture:# /g)?.length || 0).toBe(1)
    expect(sshServer.state.commandEvents.some(
      event => event.command === sshServer.password
    )).toBe(false)
    const ordinarySftp = await page.evaluate(async () => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      try {
        await entry.sftp.lstat('/root-only/app.conf')
        return { denied: false }
      } catch (error) {
        return {
          denied: true,
          code: error?.code || '',
          message: error?.message || String(error)
        }
      }
    })
    expect(ordinarySftp.denied, JSON.stringify(ordinarySftp)).toBe(true)
    expect(sshServer.state.rootOnlySftpDenials.length).toBeGreaterThan(0)

    const stageImportsBeforeEditorSave = sshServer.state.privilegedFileRequests
      .filter(request => request.operation === 'stage-import').length
    await openRemoteEditor(page, 'app.conf')
    await expect(remoteEditor(page).locator('.simple-editor textarea'))
      .toHaveValue('enabled=false\n', { timeout: 15000 })
    await replaceRemoteEditorText(page, 'enabled=true\n')
    await saveRemoteEditor(page)
    await expect.poll(() => fixture.readRootFile('/root-only/app.conf'))
      .toBe('enabled=true\n')
    const editorSaveImports = sshServer.state.privilegedFileRequests
      .filter(request => request.operation === 'stage-import')
      .slice(stageImportsBeforeEditorSave)
    expect(editorSaveImports.length).toBeGreaterThan(0)
    expect(editorSaveImports.some(
      request => request.args.targetPath?.startsWith('/root-only/')
    )).toBe(true)

    await createRemoteDirectoryFromUi(page, 'created-by-root')
    expect(fixture.getRootEntry('/root-only/created-by-root')?.type)
      .toBe('directory')
    expect(sshServer.state.privilegedFileRequests.some(
      request => request.operation === 'mkdir-bound' &&
        request.args.targetPath === '/root-only/created-by-root'
    )).toBe(true)

    await setLocalPath(page, fixture.localRoot)
    const uploadRequestEpoch = await remoteRequestEpoch(page)
    await transferFromContextMenu(page, 'local', 'upload.txt')
    await verifyFileTransfersComplete(page)
    await waitForRemoteRequestCycle(page, uploadRequestEpoch)
    const uploadHistory = await recentTransferHistory(page)
    expect(uploadHistory.some(item =>
      item.name === 'upload.txt' && item.status === 'success'
    ), JSON.stringify(uploadHistory)).toBe(true)
    await expect.poll(() => fixture.readRootFile('/root-only/upload.txt'))
      .toBe('uploaded through root staging\n')
    expect(fixture.stagingReads.some(
      item => item.operation === 'stage-import'
    )).toBe(true)

    await renameRemoteFromUi(page, 'upload.txt', 'renamed.txt')
    expect(fixture.getRootEntry('/root-only/upload.txt')).toBeNull()
    expect(fixture.readRootFile('/root-only/renamed.txt'))
      .toBe('uploaded through root staging\n')
    expect(sshServer.state.privilegedFileRequests.some(
      request => request.operation === 'rename-bound' &&
        request.args.targetPath === '/root-only/renamed.txt'
    )).toBe(true)

    const otherWriteWasActive = await chmodRemoteFromUi(page, 'renamed.txt')
    await expect.poll(() => Boolean(
      fixture.getRootEntry('/root-only/renamed.txt').mode & 0o2
    )).toBe(!otherWriteWasActive)
    expect(sshServer.state.privilegedFileRequests.some(
      request => request.operation === 'metadata-bound' &&
        request.args.targetPath === '/root-only/renamed.txt'
    )).toBe(true)

    const safeDeleteRequestsBefore =
      sshServer.state.privilegedFileRequests.length
    await deleteRemoteFromUi(page, 'renamed.txt')
    expect(fixture.getRootEntry('/root-only/renamed.txt')).toBeNull()
    const safeDeleteRequests = sshServer.state.privilegedFileRequests
      .slice(safeDeleteRequestsBefore)
    const safeDeleteMove = safeDeleteRequests.find(
      request => request.operation === 'rename-bound' &&
        request.args.sourcePath === '/root-only/renamed.txt' &&
        request.args.targetPath.startsWith(
          '/root-only/.shellpilot-transactions/'
        )
    )
    expect(safeDeleteMove).toBeTruthy()
    expect(safeDeleteRequests.some(
      request => request.operation === 'remove-bound' &&
        request.args.targetPath === safeDeleteMove.args.targetPath
    )).toBe(true)

    const fastDeleteRequestsBefore =
      sshServer.state.privilegedFileRequests.length
    await deleteRemoteFromUi(page, 'created-by-root', { fast: true })
    expect(fixture.getRootEntry('/root-only/created-by-root')).toBeNull()
    const fastDeleteRequests = sshServer.state.privilegedFileRequests
      .slice(fastDeleteRequestsBefore)
    expect(fastDeleteRequests.some(
      request => request.operation === 'remove-bound' &&
        request.args.targetPath === '/root-only/created-by-root'
    )).toBe(true)
    expect(fastDeleteRequests.some(
      request => request.operation === 'rename-bound' &&
        request.args.sourcePath === '/root-only/created-by-root'
    )).toBe(false)

    await transferFromContextMenu(page, 'remote', 'app.conf')
    await verifyFileTransfersComplete(page)
    await expect.poll(() => fs.readFile(
      fixture.localPath('app.conf'),
      'utf8'
    )).toBe('enabled=true\n')
    expect(fixture.stagingWrites.some(
      item => item.operation === 'stage-export-range'
    )).toBe(true)

    const ctrlCBefore = sshServer.state.ctrlCCount
    const cancellationNonce = sshServer.state.shellIntegrationNonce
    expect(cancellationNonce).toMatch(/^[a-f0-9]{32}$/)
    const cancellationTerminal = await page.evaluate(() => {
      const activeTabId = window.store.activeTabId
      const terminal = window.refs.get('term-' + activeTabId)
      const controller = terminal?.operationsPtyTaskController
      if (!terminal || !controller) return null
      const marker = `shellpilot-cancellation-${Date.now()}`
      terminal.__shellpilotCancellationMarker = marker
      window.__shellpilotCancellationTerminal = terminal
      window.__shellpilotCancellationController = controller
      return {
        activeTabId,
        marker,
        terminalExists: true,
        controllerExists: true,
        sshTerminalPid: terminal.sshTerminalPid ??
          terminal.getTerminalSafetyEndpoint?.().sshTerminalPid ?? null,
        sameTerminalReference: terminal === window.__shellpilotCancellationTerminal,
        sameControllerReference:
          controller === window.__shellpilotCancellationController
      }
    })
    expect(cancellationTerminal).not.toBeNull()
    expect(cancellationTerminal).toMatchObject({
      terminalExists: true,
      controllerExists: true,
      sameTerminalReference: true,
      sameControllerReference: true
    })
    const shellSessionBeforeCancellation = {
      count: sshServer.state.shellSessionIds.length,
      currentId: sshServer.state.shellSessionIds.at(-1)
    }
    expect(shellSessionBeforeCancellation.currentId).toBeTruthy()
    const transferHistoryBeforeCancel = await page.evaluate(() => (
      window.store.transferHistory.length
    ))
    await transferFromContextMenu(page, 'remote', 'cancel.bin')
    await expect.poll(() => page.evaluate(() => (
      window.store.fileTransfers.find(item => (
        (item.name || item.fromFile?.name) === 'cancel.bin'
      ))?.id || ''
    )), { timeout: 30000 }).not.toBe('')
    const cancelTransferId = await page.evaluate(() => (
      window.store.fileTransfers.find(item => (
        (item.name || item.fromFile?.name) === 'cancel.bin'
      ))?.id || ''
    ))
    expect(cancelTransferId).not.toBe('')
    await expect.poll(() => sshServer.state.privilegedFileRequests.some(
      request => request.operation === 'stage-export' &&
        request.args.sourcePath === '/root-only/cancel.bin' &&
        request.stageReady === true
    ), { timeout: 30000 }).toBe(true)
    await page.locator('.session-current .term-sftp-tabs .type-tab:visible')
      .first()
      .click()
    await page.evaluate(() => {
      window.refs.get('term-' + window.store.activeTabId)?.term?.focus()
    })
    await page.keyboard.press('Control+C')
    await expect.poll(() => sshServer.state.ctrlCCount).toBe(ctrlCBefore + 1)
    await verifyFileTransfersComplete(page)
    await expect.poll(() => page.evaluate(({ id, historyStart }) => {
      const item = window.store.transferHistory.find((entry, index) => (
        index < window.store.transferHistory.length - historyStart &&
        (entry.id === id || entry.originalId === id)
      ))
      if (!item) return null
      return {
        id: item.id,
        originalId: item.originalId,
        status: item.status,
        classification: item.status === 'cancelled'
          ? 'cancelled'
          : item.status === 'success'
            ? 'success'
            : 'failed'
      }
    }, {
      id: cancelTransferId,
      historyStart: transferHistoryBeforeCancel
    }), { timeout: 30000 }).not.toBeNull()
    const cancelHistory = (await recentTransferHistory(page)).find(item => (
      item.id === cancelTransferId || item.originalId === cancelTransferId
    ))
    expect(cancelHistory).toBeTruthy()
    expect(cancelHistory.status).toBe('cancelled')
    expect(cancelHistory.classification).toBe('cancelled')
    await expectRemoteFileWorkSettled(page)
    await expect.poll(() => ({
      handlers: sshServer.state.activePrivilegedHandlers,
      requests: sshServer.state.activePrivilegedRequests,
      timers: sshServer.state.activeFixtureTimers
    })).toEqual({ handlers: 0, requests: 0, timers: 0 })
    await expect.poll(() => sshServer.state.managedPtyCancellationOutputs
      .find(output => output.nonce === cancellationNonce) || null)
      .not.toBeNull()
    const cancellationOutput = sshServer.state.managedPtyCancellationOutputs
      .find(output => output.nonce === cancellationNonce)
    expect(cancellationOutput).toBeTruthy()
    expect(cancellationOutput.nonce).toBe(cancellationNonce)
    const cancellationRawOutput = cancellationOutput.writes
      .map(write => write.output)
      .join('')
    const promptP = `\u001b]633;P;${cancellationNonce};Cwd=/home/shellpilot\u0007`
    const promptA = `\u001b]633;A;${cancellationNonce}\u0007`
    const promptB = `\u001b]633;B;${cancellationNonce}\u0007`
    expect(cancellationOutput.tail)
      .toBe('SHELLPILOT_FILE=1 __sp_cancel_tail=hidden')
    expect(cancellationOutput.end.startsWith('\u001b]698;SHELLPILOT_FILE;'))
      .toBe(true)
    expect(cancellationOutput.end.endsWith(';end;130\u0007')).toBe(true)
    expect(cancellationOutput.prompt).toContain(promptP)
    expect(cancellationOutput.writes.map(write => write.type))
      .toEqual(['tail', 'end', 'prompt'])
    expect(cancellationRawOutput).toContain(cancellationOutput.tail)
    expect(cancellationRawOutput).toContain(cancellationOutput.end)
    expect(cancellationRawOutput).toContain(cancellationOutput.prompt)
    expect(cancellationRawOutput.indexOf(promptP)).toBeGreaterThan(-1)
    expect(cancellationRawOutput.indexOf(promptA))
      .toBeGreaterThan(cancellationRawOutput.indexOf(promptP))
    expect(cancellationRawOutput.indexOf(promptB))
      .toBeGreaterThan(cancellationRawOutput.indexOf(promptA))
    expect(cancellationRawOutput)
      .not.toContain(`\u001b]633;D;${cancellationNonce};`)
    await expect.poll(() => fixture.listStagingFiles()).toEqual([])
    await expect.poll(async () => (await fixture.listLocalFiles())
      .filter(name => /cancel\.bin|partial|\.shellpilot/i.test(name)))
      .toEqual([])
    await expect(fs.stat(fixture.localPath('cancel.bin')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect(sshServer.state.cancelledPrivilegedFileRequests.some(
      request => request.operation === 'stage-export' &&
        request.args.sourcePath === '/root-only/cancel.bin'
    )).toBe(true)
    expect(fixture.stagingCleanups.some(
      item => item.cancelled === true
    )).toBe(true)

    await expectManagedPtyEchoHidden(page)
    const recoveredTerminal = await page.evaluate(({ activeTabId, marker }) => {
      const activeTabMatches = window.store.activeTabId === activeTabId
      const terminal = window.refs.get('term-' + window.store.activeTabId)
      const controller = terminal?.operationsPtyTaskController
      if (!terminal || !controller) {
        return {
          activeTabMatches,
          terminalExists: Boolean(terminal),
          controllerExists: Boolean(controller)
        }
      }
      return {
        activeTabMatches,
        terminalExists: true,
        controllerExists: true,
        sameTerminal: terminal === window.__shellpilotCancellationTerminal,
        sameController: controller === window.__shellpilotCancellationController,
        sameMarker: terminal.__shellpilotCancellationMarker === marker,
        sshTerminalPid: terminal.sshTerminalPid ??
          terminal.getTerminalSafetyEndpoint?.().sshTerminalPid ?? null,
        busy: controller.isBusy(),
        owner: controller.owner()
      }
    }, cancellationTerminal)
    expect(recoveredTerminal).toEqual({
      activeTabMatches: true,
      terminalExists: true,
      controllerExists: true,
      sameTerminal: true,
      sameController: true,
      sameMarker: true,
      sshTerminalPid: cancellationTerminal.sshTerminalPid,
      busy: false,
      owner: ''
    })
    expect({
      count: sshServer.state.shellSessionIds.length,
      currentId: sshServer.state.shellSessionIds.at(-1)
    }).toEqual(shellSessionBeforeCancellation)
    const commandEventsBeforeRecoveryProbe = sshServer.state.commandEvents.length
    await sendTerminalLine(page, 'shellpilot-recovery-probe')
    await expect.poll(() => sshServer.state.commandEvents
      .slice(commandEventsBeforeRecoveryProbe)
      .filter(event => event.command === 'shellpilot-recovery-probe').length)
      .toBe(1)
    await expect.poll(() => terminalBufferText(page))
      .toContain('SHELLPILOT_RECOVERY_EXECUTED')
    await expectManagedPtyEchoHidden(page)
    const recordedShellCommands = [
      ...sshServer.state.commands,
      ...sshServer.state.commandEvents.map(event => event.command)
    ]
    expect(recordedShellCommands.some(command =>
      command.includes('SHELLPILOT_FILE_FRAME'))).toBe(false)
    expect(recordedShellCommands.some(command =>
      command.includes('__sp_pf_b='))).toBe(false)

    const terminal = page.locator('.session-current')
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

    const probesBeforeLoginBrowse = sshServer.state.privilegedFileRequests
      .filter(request => request.operation === 'probe').length
    await terminal.locator('.term-sftp-tabs .type-tab:visible').nth(1).click()
    const rootOnlyDenialsBeforeLoginBrowse =
      sshServer.state.rootOnlySftpDenials.length
    await gotoRemotePath(page, '/root-only', { expectFailure: true })
    await expect.poll(() => sshServer.state.rootOnlySftpDenials.length)
      .toBeGreaterThan(rootOnlyDenialsBeforeLoginBrowse)
    await expect(remoteRow(page, 'app.conf')).toHaveCount(0)
    await expect(remoteRow(page, 'cancel.bin')).toHaveCount(0)
    await gotoRemotePath(page, '/home/shellpilot')
    await expect(page.locator(
      '.session-current .sftp-remote-section .sftp-title input'
    )).toHaveValue('/home/shellpilot')
    await expect(remoteRow(page, 'folder-a')).toBeVisible()
    await gotoRemotePath(page, '/home/shellpilot/folder-a')
    await expect(remoteRow(page, 'folder-b')).toBeVisible()
    await expect(page.locator('.notification:visible').last())
      .toContainText(/EACCES|permission|denied|权限|拒绝|OSC 698/i)
    await expect(page.locator('.sftp-login-identity'))
      .toContainText(`SSH 登录：${sshServer.username}`)
    await expect(page.locator('.sftp-file-identity'))
      .toContainText(`文件操作：${sshServer.username}（SFTP）`)
    const loginIdentityProbes = sshServer.state.privilegedFileRequests
      .filter(request => request.operation === 'probe')
      .slice(probesBeforeLoginBrowse)
    expect(loginIdentityProbes.length).toBeGreaterThan(0)
    expect(loginIdentityProbes.some(
      request => request.identity.username === sshServer.username
    )).toBe(true)
    expect(sshServer.state.rootOnlySftpDenials.length).toBeGreaterThan(1)
    await expectRemoteFileWorkSettled(page)
    expect(fixture.stagingReads.length).toBeGreaterThan(0)
    expect(fixture.stagingWrites.length).toBeGreaterThan(0)
    expect(fixture.stagingCleanups.length).toBeGreaterThan(0)
    expect(fixture.stagingReads.some(
      item => item.operation === 'sftp-read'
    )).toBe(true)
    expect(fixture.stagingWrites.some(
      item => item.operation === 'sftp-write'
    )).toBe(true)
  } catch (error) {
    primaryError = error
    let remoteState = null
    if (run) {
      remoteState = await run.page.evaluate(() => {
        const entry = window.refs.get('sftp-' + window.store.activeTabId)
        const terminal = window.refs.get('term-' + window.store.activeTabId)
        const editor = [...document.querySelectorAll('.custom-modal-wrap')]
          .find(item => item.querySelector('.simple-editor textarea'))
        if (!entry) return null
        return {
          remotePath: entry.state.remotePath,
          remoteLoading: entry.state.remoteLoading,
          remoteFileStatus: entry.state.remoteFileStatus,
          remoteFileIdentity: entry.state.remoteFileIdentity,
          leaseOutcomes: entry.state.remoteFileLeaseOutcomes,
          operationsBusy: terminal?.operationsPtyTaskController?.isBusy?.(),
          operationsOwner: terminal?.operationsPtyTaskController?.owner?.(),
          editorSpinning: Boolean(editor?.querySelector('.ant-spin-spinning')),
          editorRefPresent: [...window.refs.keys()].some(key =>
            String(key).startsWith('editor-')),
          notifications: [...document.querySelectorAll('.notification')]
            .map(item => item.textContent)
        }
      }).catch(() => null)
    }
    console.error('039 failure state:', JSON.stringify({
      message: error?.message || String(error),
      shellCount: sshServer.state.shellCount,
      ctrlCCount: sshServer.state.ctrlCCount,
      sftpSessions: sshServer.state.sftpSessions,
      effectiveIdentity: sshServer.state.effectiveIdentity,
      shellIntegrationRearms: sshServer.state.shellIntegrationRearms,
      managedPtyCount: sshServer.state.managedPtyScripts.length,
      privilegedFileRequests: sshServer.state.privilegedFileRequests.slice(-20).map(
        ({ operation, identity, args, error, cancelled, stageReady }) => ({
          operation,
          identity,
          args: {
            path: args.path,
            sourcePath: args.sourcePath,
            targetPath: args.targetPath,
            peerPath: args.peerPath,
            objectName: args.objectName
          },
          error,
          cancelled,
          stageReady
        })
      ),
      rootOnlySftpDenials: sshServer.state.rootOnlySftpDenials.slice(-20),
      stagingReads: fixture.stagingReads.slice(-12),
      stagingWrites: fixture.stagingWrites.slice(-12),
      stagingCleanups: fixture.stagingCleanups.slice(-12),
      sftpEvents: sshServer.state.sftpEvents.slice(-12),
      remoteState,
      commandKinds: sshServer.state.commands.slice(-12).map(command => ({
        privileged: command.includes('SHELLPILOT_FILE'),
        length: command.length
      }))
    }, null, 2))
    throw error
  } finally {
    const cleanupErrors = []
    try {
      await sshServer.close()
    } catch (error) {
      preserveCleanupFailure(primaryError, cleanupErrors, error)
    }
    if (run) {
      try {
        await cleanupQualityApp(run.electronApp, run.profileRoot)
      } catch (error) {
        preserveCleanupFailure(primaryError, cleanupErrors, error)
      }
    }
    try {
      await fixture.cleanup()
    } catch (error) {
      preserveCleanupFailure(primaryError, cleanupErrors, error)
    }
    if (!primaryError && cleanupErrors.length === 1) {
      cleanupFailure = cleanupErrors[0]
    }
    if (!primaryError && cleanupErrors.length > 1) {
      cleanupFailure = new AggregateError(cleanupErrors, '039 cleanup failed')
    }
  }
  if (cleanupFailure) throw cleanupFailure
})
