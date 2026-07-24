const { _electron: electron, expect } = require('@playwright/test')
const {
  test: it
} = require('@playwright/test')
const { describe } = it
it.setTimeout(100000)
const os = require('os')
const delay = require('./common/wait')
const { basicTerminalTest } = require('./common/basic-terminal-test')
const platform = os.platform()
const isWin = platform.startsWith('win')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')
// if (!process.env.LOCAL_TEST && isOs('darwin')) {
//   return
// }

describe('terminal', function () {
  it('should open on the disconnected home and create a working local terminal on demand', async function () {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)
    const cmd = isWin
      ? 'dir'
      : 'ls'
    await delay(13500)
    await client.locator('.no-sessions').waitFor({ state: 'visible' })
    const titleBarBrand = client.locator('.aigshell-topbar-brand')
    const initialMaximized = await client.evaluate(() => window.store.isMaximized)
    await titleBarBrand.dblclick()
    await expect.poll(() => client.evaluate(() => window.store.isMaximized)).toBe(!initialMaximized)
    await titleBarBrand.dblclick()
    await expect.poll(() => client.evaluate(() => window.store.isMaximized)).toBe(initialMaximized)
    await client.locator('.add-new-tab-btn').click()
    await client.locator('.session-current .term-wrap').waitFor({ state: 'visible' })
    await basicTerminalTest(client, cmd)
    await electronApp.close().catch(console.log)
  })
})
