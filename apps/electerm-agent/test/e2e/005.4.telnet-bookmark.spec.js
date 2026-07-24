const { _electron: electron } = require('@playwright/test')
const { test: it, expect } = require('@playwright/test')
const { describe } = it
const delay = require('./common/wait')
const { nanoid } = require('nanoid')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')
const { getTerminalContent } = require('./common/basic-terminal-test')
const { openNewConnectionForm } = require('./common/common')
const { startLocalTelnetServer } = require('./common/local-telnet-server')

it.setTimeout(120000)

describe('Telnet bookmark', function () {
  it('should create a telnet bookmark and verify connection', async function () {
    const telnetServer = await startLocalTelnetServer()
    let electronApp
    try {
      electronApp = await electron.launch(appOptions)
      const client = await electronApp.firstWindow()
      extendClient(client, electronApp)
      await delay(3500)

      const initialHistoryCount = await client.evaluate(() => {
        return window.store.history.length
      })

      await openNewConnectionForm(client)
      await client.click('.setting-wrap .ant-radio-button-wrapper:has-text("Telnet")')

      const bookmarkTitle = `Telnet-${nanoid()}`
      await client.setValue('#telnet-form_host', telnetServer.host)
      await client.setValue('#telnet-form_title', bookmarkTitle)
      await client.setValue('#telnet-form_port', String(telnetServer.port))
      await client.click('.setting-wrap .ant-btn-primary')

      await expect.poll(
        () => telnetServer.state.connectionCount,
        { timeout: 20000 }
      ).toBeGreaterThan(0)

      const historyItem = await client.evaluate(() => window.store.history[0])
      expect(historyItem.tab.title).toEqual(bookmarkTitle)
      expect(historyItem.tab.host).toEqual(telnetServer.host)
      expect(historyItem.tab.port).toEqual(telnetServer.port)
      expect(historyItem.tab.type).toEqual('telnet')
      expect(await client.evaluate(() => window.store.history.length))
        .toEqual(initialHistoryCount + 1)

      await expect.poll(
        () => getTerminalContent(client),
        { timeout: 20000 }
      ).toContain('ShellPilot local Telnet ready')

      const input = client.locator('.session-current .xterm-helper-textarea:visible').last()
      await input.click({ force: true })
      await client.keyboard.type('help')
      await client.keyboard.press('Enter')
      await expect.poll(
        () => telnetServer.state.receivedText,
        { timeout: 10000 }
      ).toContain('help')
      await expect.poll(
        () => getTerminalContent(client),
        { timeout: 10000 }
      ).toContain('echo:help')
    } finally {
      await electronApp?.close().catch(() => {})
      await telnetServer.close().catch(() => {})
    }
  })
})
