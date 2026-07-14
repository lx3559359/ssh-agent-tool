const { _electron: electron } = require('@playwright/test')
const {
  test: it
} = require('@playwright/test')
const { describe } = it
it.setTimeout(100000)
const delay = require('./common/wait')
const log = require('./common/log')
const { expect } = require('./common/expect')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')

describe('terminal themes', function () {
  it('all buttons open proper terminal themes tab', async function () {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)
    await delay(3500)

    log('open settings and select UI themes')
    await client.click('.aigshell-topbar-action .anticon-setting')
    await delay(500)
    await client.click('.setting-tabs [role="tab"][id$="-tab-terminalThemes"]')
    await delay(500)
    const sel = '.setting-wrap .ant-tabs-nav-list .ant-tabs-tab-active'
    await client.hasElem(sel)
    await delay(500)
    const active = await client.element(sel)
    await active.waitFor({ state: 'visible' })
    expect(await active.getAttribute('data-node-key')).equal('terminalThemes')

    const v = await client.getValue('.setting-wrap #terminal-theme-form_themeName')
    const editorState = await client.evaluate(() => ({
      id: window.store.settingItem.id,
      name: window.store.settingItem.name
    }))
    expect(editorState.id).equal('')
    expect(v).equal(editorState.name)
    expect(await client.countElem('.setting-wrap .sp-theme-card.active')).equal(1)
    expect(await client.countElem('.setting-wrap .sp-theme-card.selected')).equal(0)

    // create theme
    log('create theme')
    const themePrev = await client.evaluate(() => {
      return window.store.terminalThemes.length
    })
    const themeIterm = await client.evaluate(() => {
      return window.store.itermThemes.length
    })
    await client.click('#terminal-theme-form button[type="submit"]')

    const themeNow = await client.evaluate(() => {
      return window.store.terminalThemes.length
    })
    await delay(1000)
    expect(themeNow).equal(themePrev + 1)
    expect(themeIterm > 10).equal(true)
    await electronApp.close().catch(console.log)
  })
})
