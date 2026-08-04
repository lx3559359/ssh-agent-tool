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

    const freshState = await client.evaluate(() => ({
      theme: window.store.config.theme,
      terminalTheme: window.store.config.terminalTheme
    }))
    expect(freshState.theme).equal('shellpilot-glacier')
    expect(freshState.terminalTheme).equal('default')

    const themeToggle = '.aigshell-topbar-action[data-action-key="theme"]'
    await client.click(themeToggle)
    await delay(300)
    expect(await client.evaluate(() => window.store.config.theme)).equal('shellpilot-graphite-silver')
    expect(await client.evaluate(() => window.store.config.terminalTheme)).equal('default')
    await client.click(themeToggle)
    await delay(300)
    expect(await client.evaluate(() => window.store.config.theme)).equal('shellpilot-glacier')
    expect(await client.evaluate(() => window.store.config.terminalTheme)).equal('default')

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
    const builtInIds = await client.evaluate(() => (
      window.store.getSidebarList('terminalThemes').map(theme => theme.id)
    ))
    expect(builtInIds.includes('shellpilot-glacier')).equal(true)
    expect(builtInIds.includes('shellpilot-graphite-silver')).equal(true)
    expect(await client.countElem('.setting-wrap .sp-theme-card') >= 7).equal(true)

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
