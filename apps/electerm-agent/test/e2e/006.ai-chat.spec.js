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
    await electronApp.close()
  })

  it('should verify AI functionality after configuration', async function () {
    await client.evaluate(() => {
      window.store.aiChatHistory = []
      return window.store.setConfig({
        baseURLAI: 'http://localhost:43434',
        apiPathAI: '/chat/completions',
        modelAI: 'gpt-3.5-turbo',
        apiKeyAI: 'test-api-key',
        authHeaderNameAI: 'Authorization: Bearer',
        roleAI: 'You are a helpful assistant',
        languageAI: '简体中文'
      })
    })
    await delay(1000)

    await expect(client.locator('.ai-chat-container')).toBeVisible()

    const initialHistoryCount = await client.locator('.chat-history-item').count()

    const testPrompt = 'Please reply with a short AIGShell AI smoke response.'
    await client.fill('.ai-chat-textarea', testPrompt)

    await client.click('.ai-chat-terminals .anticon-send')

    await expect(client.locator('.chat-history-item')).toHaveCount(initialHistoryCount + 1, { timeout: 10000 })
    await expect(client.locator('.chat-history-item').last()).toContainText('Response to your query', { timeout: 10000 })

    const newHistoryCount = await client.locator('.chat-history-item').count()
    expect(newHistoryCount).toBe(initialHistoryCount + 1)

    const lastChatItem = await client.locator('.chat-history-item').last()
    const promptContent = await lastChatItem.locator('.ai-history-item-prompt').textContent()
    expect(promptContent).toContain(testPrompt)

    await client.click('.ai-chat-terminals .clear-ai-icon')
    await delay(500)
    await client.click('.ant-popover .ant-btn-primary')
    await delay(1000)

    const finalHistoryCount = await client.locator('.chat-history-item').count()
    expect(finalHistoryCount).toBe(0)
  })
})
