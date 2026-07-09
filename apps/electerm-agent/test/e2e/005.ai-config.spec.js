const { _electron: electron } = require('@playwright/test')
const { test: it, expect } = require('@playwright/test')
const { describe } = it
const delay = require('./common/wait')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')
const { spawn } = require('child_process')
const path = require('path')

describe('AI Config and Suggestions', function () {
  let aiServer
  let electronApp
  let client

  // Start AI API server before all tests
  it.beforeAll(async () => {
    const serverPath = path.join(__dirname, 'common', 'ai-api.js')
    aiServer = spawn('node', [serverPath])
    await new Promise(resolve => setTimeout(resolve, 1000)) // Wait for server to start
  })

  // Stop AI API server after all tests
  it.afterAll(() => {
    if (aiServer) {
      aiServer.kill()
    }
  })

  it.beforeEach(async () => {
    electronApp = await electron.launch(appOptions)
    client = await electronApp.firstWindow()
    extendClient(client, electronApp)
    await delay(4500)
  })

  it.afterEach(async () => {
    await client.evaluate(() => {
      return window.store.setConfig({
        showCmdSuggestions: false
      })
    })
    await electronApp.close()
  })

  it('should open AI setting page and fill configuration', async function () {
    await client.evaluate(() => {
      return window.store.setConfig({
        showCmdSuggestions: true
      })
    })
    await client.locator('.aigshell-topbar-action').nth(3).click()
    await delay(1000)

    await expect(client.locator('.ai-config-modal .ai-config-form')).toBeVisible()

    await client.fill('#baseURLAI', 'http://localhost:43434')
    await client.fill('#apiPathAI', '/chat/completions')
    await client.fill('#modelAI', 'gpt-3.5-turbo')
    await client.fill('#apiKeyAI', 'test-api-key')
    await client.fill('#roleAI', 'You are a helpful assistant')
    await client.fill('#languageAI', 'English')

    await client.click('.ai-config-form button[type="submit"]')
    await delay(1000)

    await expect(client.locator('.ai-config-modal .ai-config-form')).not.toBeVisible()
  })

  it('should verify AI functionality after configuration', async function () {
    await client.evaluate(() => {
      return window.store.setConfig({
        showCmdSuggestions: true,
        baseURLAI: 'http://localhost:43434',
        apiPathAI: '/chat/completions',
        modelAI: 'gpt-3.5-turbo',
        apiKeyAI: 'test-api-key',
        authHeaderNameAI: 'Authorization: Bearer'
      })
    })
    await delay(1000)

    await expect(client.locator('.ai-config-modal .ai-config-form')).not.toBeVisible()
    await expect(client.locator('.ai-chat-container')).toBeVisible()
  })

  it('should test AI suggestions functionality', async function () {
    // Open a terminal or ensure we're in a context where we can input commands
    // You might need to add steps here to open a terminal tab if it's not open by default
    await client.evaluate(() => {
      return window.store.setConfig({
        showCmdSuggestions: true,
        baseURLAI: 'http://localhost:43434',
        apiPathAI: '/chat/completions',
        modelAI: 'gpt-3.5-turbo',
        apiKeyAI: 'test-api-key',
        authHeaderNameAI: 'Authorization: Bearer'
      })
    })
    // Input a command
    const testCommand = 'test'
    await client.locator('.xterm-helper-textarea').first().click({ force: true })
    await client.keyboard.type(testCommand)
    await delay(100)
    await client.keyboard.press('ArrowRight')
    await delay(100)
    await client.keyboard.press('ArrowRight')
    await delay(500)

    // Get the initial count of suggestions
    const initialSuggestionsCount = await client.locator('.suggestion-item').count()

    await client.locator('.terminal-suggestions-sticky div').filter({ hasText: /获取\s*AI\s*建议/ }).first().click()
    await delay(2000) // Wait for suggestions to load

    // Get the new count of suggestions
    const newSuggestionsCount = await client.locator('.suggestion-item').count()

    // Verify that the number of suggestions has increased
    expect(newSuggestionsCount).toBeGreaterThan(initialSuggestionsCount)

    // Verify that the new suggestions start with the input command
    const suggestions = await client.locator('.suggestion-item').allTextContents()
    for (const suggestion of suggestions) {
      expect(suggestion.startsWith(testCommand)).toBeTruthy()
    }
  })
})
