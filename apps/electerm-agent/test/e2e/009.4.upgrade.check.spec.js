const { _electron: electron } = require('@playwright/test')
const { test, expect } = require('@playwright/test')
const { version } = require('../../package.json')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')

test('update center shows the packaged version and selectable update sources', async () => {
  const electronApp = await electron.launch(appOptions)
  const client = await electronApp.firstWindow()
  extendClient(client, electronApp)
  await client.waitForFunction(() => window.store?.configLoaded === true)

  await client.getByRole('button', {
    name: /检查更新|更新中心|Update Center/i
  }).click()
  const modal = client.locator('.update-center-modal')
  await expect(modal).toBeVisible()
  await expect(modal.locator('.update-center-summary')).toContainText(`v${version}`)

  const sourceSelect = modal.locator('.update-center-source').getByRole('combobox')
  await sourceSelect.click()
  await expect(sourceSelect).toHaveAttribute('aria-expanded', 'true')
  const dropdown = client
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .last()
  await expect(dropdown).toBeVisible()
  const options = dropdown.locator('.ant-select-item-option')
  await expect(options).toHaveCount(3, { timeout: 10000 })
  await expect(options.nth(0)).toContainText(/自动选择|Automatic/i)
  await expect(options.nth(1)).toContainText(/ModelScope/i)
  await expect(options.nth(2)).toContainText(/GitHub/i)

  await electronApp.close().catch(console.log)
})
