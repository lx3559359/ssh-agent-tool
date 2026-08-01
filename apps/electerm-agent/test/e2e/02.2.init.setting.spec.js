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

describe('init setting buttons', function () {
  it('fresh launch and navigation buttons open current destinations', async function () {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)
    await delay(3500)

    log('fresh launch does not open a terminal tab')
    const tabCount = await client.countElem('.tabs .tab')
    expect(tabCount).toEqual(0)

    log('topbar new connection opens the guided connection flow')
    await client.locator('.aigshell-topbar-action[data-action-key="new"]').click()
    const wizard = client.locator('.quick-connect-wizard')
    await expect(wizard).toBeVisible()
    await expect(wizard.locator('.ant-steps-item')).toHaveCount(3)
    await wizard.locator('.ant-modal-close').click()
    await expect(wizard).toBeHidden()

    log('server sidebar add button opens bookmark settings')
    await client.locator('.sidebar-bar .anticon-book').click()
    const addBookmark = client.locator('.sidebar-panel-bookmarks button[aria-label][title]').filter({
      has: client.locator('.anticon-book.with-plus')
    })
    await expect(addBookmark).toBeVisible()
    await addBookmark.click()
    const sel = '.setting-wrap .ant-tabs-nav-list .ant-tabs-tab-active'
    const active = await client.element(sel)
    expect(active).toBeVisible()
    await expect(active).toHaveAttribute('data-node-key', 'bookmarks')

    log('close')
    await client.click('.setting-wrap .close-setting-wrap')
    await delay(900)

    log('open setting')
    await client.click('.aigshell-topbar-action .anticon-setting')
    await delay(2500)
    const active1 = await client.element(sel)
    expect(active1).toBeVisible()
    await expect(active1).toHaveAttribute('data-node-key', 'setting')
    log('close')
    await client.click('.setting-wrap .close-setting-wrap')
    await delay(900)

    log('topbar new connection remains independent from settings')
    await client.locator('.aigshell-topbar-action[data-action-key="new"]').click()
    await expect(wizard).toBeVisible()

    await electronApp.close().catch(console.log)
  })
})
