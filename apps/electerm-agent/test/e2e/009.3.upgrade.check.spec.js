const { _electron: electron } = require('@playwright/test')
const { test, expect } = require('@playwright/test')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')

test('manual update check reports a deterministic current-version state', async () => {
  const electronApp = await electron.launch(appOptions)
  const client = await electronApp.firstWindow()
  extendClient(client, electronApp)
  await client.waitForFunction(() => window.store?.configLoaded === true)

  await client.evaluate(() => {
    window.__e2eUpdateChecks = 0
    window.store.onCheckUpdate = async () => {
      window.__e2eUpdateChecks += 1
      Object.assign(window.store.upgradeInfo, {
        checkingRemoteVersion: false,
        error: '',
        lastCheckStatus: 'current',
        lastCheckedAt: Date.now(),
        remoteVersion: window.et.version
      })
    }
  })

  await client.getByRole('button', {
    name: /检查更新|更新中心|Update Center/i
  }).click()
  const modal = client.locator('.update-center-modal')
  await expect(modal).toBeVisible()

  const checksBeforeRecheck = await client.evaluate(() => window.__e2eUpdateChecks)
  await modal.getByRole('button', { name: /重新检查|Recheck/i }).click()
  await expect.poll(
    () => client.evaluate(() => window.__e2eUpdateChecks)
  ).toBe(checksBeforeRecheck + 1)
  await expect(modal).toContainText(/已经是最新|已是最新|up to date|current/i)

  await electronApp.close().catch(console.log)
})
