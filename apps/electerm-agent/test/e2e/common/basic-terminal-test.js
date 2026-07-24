const delay = require('./wait')
const { expect } = require('./expect')

exports.basicTerminalTest = async (client, cmd) => {
  async function focus () {
    const termInput = client.locator('.session-current .xterm-helper-textarea:visible').last()
    if (await termInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await termInput.click({ force: true })
    } else {
      await client.click('.session-current .term-wrap')
    }
  }
  await focus()
  await delay(1010)
  await client.keyboard.type(cmd)
  await client.keyboard.press('Enter')
  await delay(2000)
  const text = await client.evaluate(() => {
    return window.refs
      .get('term-' + window.store.activeTabId)
      ?.getTerminalBufferText?.() || ''
  })
  expect(text).includes(cmd)
}

exports.getTerminalContent = async function (client) {
  return client.evaluate(() => {
    return window.refs
      .get('term-' + window.store.activeTabId)
      ?.getTerminalBufferText?.() || ''
  })
}
