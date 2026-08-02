const { test, expect } = require('@playwright/test')
const {
  launchBookmarkApp,
  closeBookmarkApp,
  cleanupBookmarkProfile
} = require('./common/bookmark-lifecycle')
const { startLocalSshServer } = require('./common/local-ssh-server')

test.setTimeout(120000)

async function acceptHostKey (client) {
  const modal = client.locator('.custom-modal-wrap').last()
  await expect(modal).toBeVisible({ timeout: 20000 })
  const primary = modal.locator('button.ant-btn-primary').last()
  await expect(primary).toBeVisible()
  await primary.click()
}

async function getTerminalText (client) {
  return client.evaluate(() => {
    return window.refs.get('term-' + window.store.activeTabId)?.getTerminalBufferText?.() || ''
  })
}

async function focusActiveTerminal (client) {
  await client.evaluate(() => {
    window.refs.get('term-' + window.store.activeTabId)?.term?.focus()
  })
}

test('SSH UI connects to a local server, runs a command and passes Ctrl+C', async () => {
  const sshServer = await startLocalSshServer()
  let electronApp

  try {
    const launched = await launchBookmarkApp()
    electronApp = launched.electronApp
    const client = launched.client

    await client.locator('.aigshell-topbar-action[data-action-key="new"]').click()
    const wizard = client.locator('.quick-connect-wizard')
    await expect(wizard).toBeVisible()
    await wizard.locator('input:not([readonly])').first().fill(sshServer.host)
    await wizard.locator('.quick-connect-port').fill(String(sshServer.port))
    await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
    await wizard.locator('input:not([readonly])').first().fill(sshServer.username)
    await wizard.locator('input[type="password"]').fill(sshServer.password)
    await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
    await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
    await acceptHostKey(client)
    await expect.poll(() => sshServer.state.shellCount, { timeout: 20000 }).toBeGreaterThan(0)

    const terminal = client.locator('.session-current')
    const input = terminal.locator('.xterm-helper-textarea').last()
    await focusActiveTerminal(client)
    await expect(input).toBeFocused()
    await client.keyboard.type('echo shellpilot-e2e')
    await client.keyboard.press('Enter')
    await expect.poll(() => sshServer.state.commands, { timeout: 10000 }).toContain('echo shellpilot-e2e')
    await expect.poll(() => getTerminalText(client), { timeout: 10000 }).toContain('shellpilot-e2e')

    await expect(client.locator('.common-err-desc')).toHaveCount(0)

    await terminal.locator('.term-sftp-tabs .type-tab:visible').nth(1).click()
    await expect(client.locator('.common-err-desc')).toContainText('SFTP', { timeout: 20000 })
    await expect(client.locator('.common-err-desc')).not.toHaveText(/^Error$/)

    await terminal.locator('.term-sftp-tabs .type-tab:visible').first().click()
    await focusActiveTerminal(client)
    await client.keyboard.press('Control+C')
    await expect.poll(() => sshServer.state.ctrlCCount).toBeGreaterThan(0)
  } finally {
    await closeBookmarkApp(electronApp, __filename).catch(() => {})
    await cleanupBookmarkProfile().catch(() => {})
    await sshServer.close().catch(() => {})
  }
})
