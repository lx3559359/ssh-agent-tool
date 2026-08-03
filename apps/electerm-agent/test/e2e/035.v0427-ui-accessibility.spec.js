const { promises: fs } = require('node:fs')
const path = require('node:path')
const { _electron: electron, expect, test } = require('@playwright/test')
const { createLocalSftpFixture } = require('./common/local-sftp-fixture')
const { startLocalSshServer } = require('./common/local-ssh-server')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')

const evidenceRoot = path.resolve(
  __dirname,
  '../../../../docs/audits/2026-08-02-v0.4.27-ui-accessibility/evidence'
)

test.setTimeout(180000)

async function dismissStartupModals (page) {
  const visibleModal = page.locator('.custom-modal-wrap:visible')
  for (let attempt = 0; attempt < 4 && await visibleModal.count(); attempt += 1) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
  }
}

async function captureEvidence (page, name) {
  await fs.mkdir(evidenceRoot, { recursive: true })
  await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    path: path.join(evidenceRoot, name),
    scale: 'css'
  })
}

async function expectDialogIsolation (page, dialog) {
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  const container = page.locator('#container')
  await expect(container).toHaveAttribute('aria-hidden', 'true')
  expect(await container.evaluate(node => node.inert)).toBe(true)
  await expect.poll(() => (
    dialog.evaluate(node => node.contains(document.activeElement))
  )).toBe(true)

  await page.keyboard.press('Shift+Tab')
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Tab')
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true)
}

async function closeIsolatedDialog (page, dialog, trigger) {
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  const container = page.locator('#container')
  await expect(container).not.toHaveAttribute('aria-hidden', 'true')
  expect(await container.evaluate(node => node.inert)).toBe(false)
  await expect(trigger).toBeFocused()
}

test('v0.4.27 completes the 14-state keyboard and dialog accessibility journey', async () => {
  const fixture = await createLocalSftpFixture()
  const sshServer = await startLocalSshServer({ sftpRoot: fixture.root })
  let run
  let primaryError

  try {
    run = await launchQualityApp(electron)
    const { page } = run
    await dismissStartupModals(page)

    // State 1: disconnected home.
    await expect(page.locator('.no-sessions')).toBeVisible()
    await expect(page.locator('.aigshell-topbar-status-text')).toBeVisible()
    await captureEvidence(page, 'round-2-01-disconnected-home.png')

    const newConnection = page.locator('[data-action-key="new"]')
    await newConnection.click()
    const wizard = page.locator('.quick-connect-wizard')
    await expect(wizard).toBeVisible()
    await expect(wizard).toHaveAttribute('role', 'dialog')

    // States 2-4: endpoint, authentication, and confirmation steps.
    await expect(wizard.locator('#shellpilot-connect-host')).toBeFocused()
    await wizard.locator('#shellpilot-connect-host').fill(sshServer.host)
    await wizard.locator('#shellpilot-connect-port').fill(String(sshServer.port))
    await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
    await expect(wizard.locator('#shellpilot-connect-username')).toBeVisible()
    await wizard.locator('#shellpilot-connect-username').fill(sshServer.username)
    await wizard.locator('#shellpilot-connect-password').fill(sshServer.password)
    await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
    await expect(wizard.locator('.quick-connect-wizard-summary')).toContainText(sshServer.host)

    // State 5: connection-test feedback.
    const wizardActions = wizard.locator('.quick-connect-wizard-footer button')
    await wizardActions.nth(1).click()
    const hostKeyDialog = page.locator('.custom-modal-content[role="dialog"]').last()
    await expectDialogIsolation(page, hostKeyDialog)
    await expect(hostKeyDialog).toContainText(run.profileRoot)
    await hostKeyDialog.locator('button.ant-btn-primary').click()
    await expect(wizard.locator('.ant-alert-success')).toBeVisible({ timeout: 20000 })
    await expect.poll(async () => {
      return fs.stat(path.join(run.profileRoot, '.ssh', 'known_hosts'))
        .then(stat => stat.isFile())
        .catch(() => false)
    }).toBe(true)
    await captureEvidence(page, 'round-2-02-connection-test-feedback.png')
    await wizardActions.nth(2).click()

    // State 6: connected Terminal and keyboard switching between session panes.
    await expect(page.locator('.term-wrap:visible')).toBeVisible({ timeout: 20000 })
    await expect.poll(() => sshServer.state.shellCount).toBeGreaterThan(0)
    const sessionTabs = page.locator('.session-current .term-sftp-tabs [role="tab"]')
    await expect(sessionTabs).toHaveCount(2)
    await sessionTabs.nth(0).focus()
    await page.keyboard.press('ArrowRight')
    await expect(sessionTabs.nth(1)).toHaveAttribute('aria-selected', 'true')

    // State 7: SFTP grids and row Enter/Space/Arrow navigation.
    await expect.poll(() => sshServer.state.sftpSessions, { timeout: 20000 }).toBeGreaterThan(0)
    const remoteRows = page.locator('.sftp-item.remote:not([aria-hidden="true"])')
    await expect(remoteRows.first()).toBeVisible()
    await remoteRows.first().focus()
    await page.keyboard.press(' ')
    await expect(remoteRows.first()).toHaveAttribute('aria-selected', 'true')
    const firstRowId = await remoteRows.first().getAttribute('id')
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => page.evaluate(() => document.activeElement?.id || '')).not.toBe(firstRowId)
    await expect.poll(() => page.evaluate(() => document.activeElement?.matches(
      '.sftp-item.remote[aria-selected="true"][tabindex="0"]'
    ))).toBe(true)
    const incomingDirectory = page.locator('.sftp-item.remote.directory[title="incoming"]')
    await incomingDirectory.focus()
    await page.keyboard.press('Enter')
    await expect(incomingDirectory).toBeHidden()
    await captureEvidence(page, 'round-2-03-connected-sftp-keyboard.png')

    // State 8: connected server status.
    const serverStatusTrigger = page.locator('[data-action-key="serverStatus"]')
    await expect(serverStatusTrigger).toBeEnabled()
    await serverStatusTrigger.click()
    const serverStatus = page.locator('.server-status-modal')
    await expect(serverStatus).toBeVisible()
    await expect(serverStatus).toHaveAttribute('role', 'dialog')
    await page.keyboard.press('Escape')
    await expect(serverStatus).toBeHidden()
    await expect(serverStatusTrigger).toBeFocused()

    // State 9: safety center.
    const safetyTrigger = page.locator('[data-action-key="safetyCenter"]')
    await safetyTrigger.click()
    const safetyCenter = page.locator('.safety-operation-center-modal')
    await expect(safetyCenter).toBeVisible()
    await expect(safetyCenter.locator('[role="status"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(safetyCenter).toBeHidden()
    await expect(safetyTrigger).toBeFocused()

    // State 10: update center common-dialog isolation and focus restoration.
    const updateTrigger = page.locator('[data-action-key="update"]')
    await updateTrigger.focus()
    await page.evaluate(() => {
      Object.assign(window.store.upgradeInfo, {
        showUpdateCenter: true,
        checkingRemoteVersion: false,
        lastCheckStatus: 'current',
        remoteVersion: '0.4.26',
        lastCheckedAt: Date.now(),
        shouldUpgrade: false,
        canAutoUpgrade: false,
        upgradeReady: false
      })
      window.dispatchEvent(new CustomEvent('shellpilot-open-update-center'))
    })
    const updateDialog = page.locator('.update-center-modal [role="dialog"]')
    await expectDialogIsolation(page, updateDialog)
    await closeIsolatedDialog(page, updateDialog, updateTrigger)

    // State 11: Help hierarchy plus common-dialog keyboard boundary.
    const helpTrigger = page.locator('[data-action-key="help"]')
    await helpTrigger.click()
    const helpDialog = page.locator('.shellpilot-help-center [role="dialog"]')
    await expectDialogIsolation(page, helpDialog)
    await expect(helpDialog.locator('h1')).toHaveCount(1)
    await expect(helpDialog.locator('h2')).toHaveCount(20)
    await closeIsolatedDialog(page, helpDialog, helpTrigger)

    // State 12: Operations listboxes retain roving keyboard selection.
    await page.evaluate(() => window.store.openOperationsToolkit('diagnostic'))
    const operations = page.locator('.operations-toolkit-workspace')
    await expect(operations).toBeVisible()
    const toolOptions = operations.locator('.operations-tool-list [role="option"]')
    await expect(toolOptions.first()).toBeVisible()
    await toolOptions.first().focus()
    await page.keyboard.press('ArrowDown')
    await expect(toolOptions.nth(1)).toHaveAttribute('aria-selected', 'true')
    await operations.locator('.operations-workspace-head button').click()
    await expect(operations).toBeHidden()

    // State 13: Model API common dialog.
    const modelTrigger = page.locator('[data-action-key="model"]')
    await modelTrigger.click()
    const modelDialog = page.locator('.ai-config-modal [role="dialog"]')
    await expectDialogIsolation(page, modelDialog)
    await closeIsolatedDialog(page, modelDialog, modelTrigger)

    // State 14: settings listbox, numeric values, Drawer isolation and focus restoration.
    const settingsTrigger = page.locator('[data-action-key="setting"]')
    await settingsTrigger.click()
    const settingsDialog = page.locator('.setting-wrap [role="dialog"]')
    await expectDialogIsolation(page, settingsDialog)
    const settingsListbox = settingsDialog.locator('.setting-tabs-setting .item-list-wrap[role="listbox"]')
    await expect(settingsListbox).toBeVisible()
    const selectedSetting = settingsListbox.locator('[role="option"][aria-selected="true"]')
    await selectedSetting.focus()
    await page.keyboard.press('Enter')
    await expect(selectedSetting).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press(' ')
    await expect(selectedSetting).toHaveAttribute('aria-selected', 'true')
    const numericControls = settingsDialog.getByRole('spinbutton')
    await expect(numericControls.first()).toBeVisible()
    expect(await numericControls.count()).toBeGreaterThanOrEqual(2)
    await captureEvidence(page, 'round-2-04-settings-dialog.png')
    await closeIsolatedDialog(page, settingsDialog, settingsTrigger)
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (run) {
      await cleanupQualityApp(run.electronApp, run.profileRoot).catch(error => {
        if (!primaryError) throw error
      })
    }
    await sshServer.close().catch(() => {})
    await fixture.cleanup()
  }
})
