const { _electron: electron } = require('@playwright/test')
const { test: it } = require('@playwright/test')
const { expect } = require('./common/expect')
const delay = require('./common/wait')
const log = require('./common/log')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')

it('should respect default split view setting when creating new tabs', async () => {
  const electronApp = await electron.launch(appOptions)
  const client = await electronApp.firstWindow()
  extendClient(client, electronApp)
  await delay(3500)

  // Check initial state (split view off by default)
  const terminalSection = client.locator('.session-current .term-wrap')
  const sftpSection = client.locator('.session-current .sftp-section')

  await expect(terminalSection).toBeVisible()
  await expect(sftpSection).toBeHidden()

  // Change default split view setting to true
  await client.evaluate(() => {
    window.store._config.sshSftpSplitView = true
  })
  await delay(500)

  // Create new tab
  log('Creating a tab with split view enabled')
  await client.click('.tabs-add-btn')
  await delay(500)
  const newTabItem = client.locator('.add-menu-wrap .context-item').filter({
    hasText: /新建连接|新标签页|New tab/i
  })
  const hasNodePty = await client.evaluate(() => window.store.hasNodePty)
  if (!hasNodePty) {
    await expect(newTabItem).toHaveCount(0)
    await electronApp.close().catch(console.log)
    return
  }
  await newTabItem.click()
  await client.keyboard.press('Escape')
  await client.waitForFunction(() => window.store.currentTab?.sshSftpSplitView === true)
  await delay(1000)

  // New tab should open with split view enabled
  await expect(terminalSection).toBeVisible()
  await expect(sftpSection).toBeVisible()

  // Change setting back to false
  await client.evaluate(() => {
    window.store._config.sshSftpSplitView = false
  })
  await delay(500)

  // Create another new tab
  log('Creating a tab with split view disabled')
  await client.click('.tabs-add-btn')
  await delay(500)
  await client.locator('.add-menu-wrap .context-item').filter({
    hasText: /新建连接|新标签页|New tab/i
  }).click()
  await client.keyboard.press('Escape')
  await client.waitForFunction(() => window.store.currentTab?.sshSftpSplitView === false)
  await delay(1000)

  // New tab should open with split view disabled
  await expect(terminalSection).toBeVisible()
  await expect(sftpSection).toBeHidden()

  await electronApp.close().catch(console.log)
})
