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

async function getFormState (form) {
  return {
    visible: await form.isVisible().catch(() => false),
    errors: await form.locator('.ant-form-item-explain-error').allTextContents()
  }
}

test('SSH UI connects to a local server, runs a command and passes Ctrl+C', async () => {
  const sshServer = await startLocalSshServer()
  let electronApp

  try {
    const launched = await launchBookmarkApp()
    electronApp = launched.electronApp
    const client = launched.client

    await client.locator('.aigshell-topbar-action .anticon-plus-circle').click()
    const form = client.locator('.setting-wrap #ssh-form')
    await expect(form).toBeVisible()
    await form.locator('#ssh-form_title').fill('ShellPilot Local SSH E2E')
    await form.locator('#ssh-form_host').fill(sshServer.host)
    await form.locator('#ssh-form_port').fill(String(sshServer.port))
    await form.locator('#ssh-form_username').fill(sshServer.username)
    await form.locator('#ssh-form_password').fill(sshServer.password)
    await client.getByTestId('bookmark-save-connect').click()
    await expect.poll(() => getFormState(form), { timeout: 10000 }).toMatchObject({
      visible: false,
      errors: []
    })
    await acceptHostKey(client)
    await expect.poll(() => sshServer.state.shellCount, { timeout: 20000 }).toBeGreaterThan(0)

    const terminal = client.locator('.session-current')
    await expect.poll(() => getTerminalText(client), { timeout: 20000 }).toContain('ShellPilot E2E ready')
    const input = terminal.locator('.xterm-helper-textarea').last()
    await focusActiveTerminal(client)
    await expect(input).toBeFocused()
    await client.keyboard.type('echo shellpilot-e2e')
    await client.keyboard.press('Enter')
    await expect.poll(() => getTerminalText(client), { timeout: 10000 }).toContain('shellpilot-e2e')

    await client.keyboard.press('Control+C')
    await expect.poll(() => sshServer.state.ctrlCCount).toBeGreaterThan(0)
  } finally {
    await closeBookmarkApp(electronApp, __filename).catch(() => {})
    await cleanupBookmarkProfile().catch(() => {})
    await sshServer.close().catch(() => {})
  }
})
