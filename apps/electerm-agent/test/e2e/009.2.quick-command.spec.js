/**
 * quick commands execution test
 */
const { _electron: electron } = require('@playwright/test')
const {
  test: it,
  expect
} = require('@playwright/test')
const { describe } = it
it.setTimeout(100000)
const delay = require('./common/wait')
const log = require('./common/log')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')

describe('quick commands execution', function () {
  it('should route the selected quick command to the execution entrypoint', async function () {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)

    await delay(3500)

    const commandName = `E2E 快捷命令 ${Date.now()}`
    await client.evaluate(() => {
      window.store.quickCommands = window.store.quickCommands.filter(
        item => !String(item.name || '').startsWith('E2E 快捷命令')
      )
    })
    const commandId = await client.evaluate(({ commandName }) => {
      window.store.addQuickCommand({
        name: commandName,
        commands: [
          {
            command: 'pwd',
            id: Date.now() + '',
            delay: 100
          }
        ]
      })
      const item = window.store.currentQuickCommands.find(
        current => current.name === commandName
      )
      window.__e2eQuickCommandIds = []
      window.store.runQuickCommandItem = async id => {
        window.__e2eQuickCommandIds.push(id)
        return { sent: true }
      }
      return item.id
    }, { commandName })

    // Open quick command box by hovering the trigger
    log('open quick command box')
    await client.hover('.quick-command-trigger-wrap .ant-btn')
    await delay(1000)

    // Verify quick command box is visible
    // const quickCommandBox = await client.element('.quick-command-box')
    // await expect(quickCommandBox).toBeVisible()

    // Click the quick command created in previous test
    log('execute quick command')
    await client.locator('.qm-item').filter({ hasText: commandName }).click()
    await expect.poll(
      () => client.evaluate(() => window.__e2eQuickCommandIds),
      { timeout: 10000 }
    ).toContain(commandId)
    await electronApp.close().catch(console.log)
  })
})
