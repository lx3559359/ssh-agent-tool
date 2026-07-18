const { _electron: electron } = require('@playwright/test')
const { test: it, expect } = require('@playwright/test')
const { describe } = it
const { promises: fs } = require('fs')
const { tmpdir } = require('os')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')
const { spawn } = require('child_process')
const { join, resolve, sep } = require('path')
const { acquireIsolatedApp } = require('./common/isolated-electron-app')

const profilePrefix = 'shellpilot-ai-chat-'

function assertSafeProfileRoot (profileRoot) {
  const tempRoot = resolve(tmpdir()) + sep
  if (!profileRoot.startsWith(tempRoot) || !profileRoot.includes(profilePrefix)) {
    throw new Error(`Refusing to use unexpected AI chat profile: ${profileRoot}`)
  }
}

function launchOptions (profileRoot) {
  return {
    ...appOptions,
    env: {
      ...appOptions.env,
      APPDATA: profileRoot,
      LOCALAPPDATA: profileRoot,
      DATA_PATH: resolve(profileRoot, 'data')
    }
  }
}

async function closeIsolatedApp (electronApp, profileRoot) {
  if (electronApp) {
    await electronApp.close().catch(() => electronApp.process().kill())
  }
  assertSafeProfileRoot(profileRoot)
  await fs.rm(profileRoot, { recursive: true, force: true })
}

describe('AI Config and Suggestions', function () {
  let aiServer
  let electronApp
  let client
  let acquired

  // Start AI API server before all tests
  it.beforeAll(async () => {
    const serverPath = join(__dirname, 'common', 'ai-api.js')
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
    acquired = await acquireIsolatedApp({
      createProfileRoot: () => fs.mkdtemp(resolve(tmpdir(), profilePrefix)),
      validateProfileRoot: assertSafeProfileRoot,
      launch: root => electron.launch(launchOptions(root)),
      readUserDataPath: app => app.evaluate(({ app }) => app.getPath('userData')),
      validateUserDataPath: (root, actualPath) => {
        if (!resolve(actualPath).startsWith(resolve(root) + sep)) {
          throw new Error(`Electron ignored isolated AI chat profile: ${actualPath}`)
        }
      },
      cleanup: closeIsolatedApp
    })
    electronApp = acquired.electronApp
    client = await electronApp.firstWindow()
    extendClient(client, electronApp)
    await client.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
  })

  it.afterEach(async () => {
    await closeIsolatedApp(electronApp, acquired.profileRoot)
  })

  it('should verify AI functionality after configuration', async function () {
    await client.evaluate(() => {
      window.store.aiChatHistory = []
      const profile = {
        id: 'e2e-ai',
        nameAI: 'E2E AI',
        baseURLAI: 'http://localhost:43434',
        apiPathAI: '/chat/completions',
        modelAI: 'gpt-3.5-turbo',
        apiKeyAI: 'test-api-key',
        authHeaderNameAI: 'Authorization: Bearer',
        roleAI: '',
        languageAI: '简体中文'
      }
      window.store.setConfig({
        activeAIProfileId: profile.id,
        aiProfiles: [profile],
        ...profile
      })
      window.store.handleOpenAIPanel()
    })

    await expect(client.locator('.ai-chat-container')).toBeVisible({ timeout: 10000 })

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
    await client.click('.ant-popover .ant-btn-primary')

    await expect(client.locator('.chat-history-item')).toHaveCount(0, { timeout: 10000 })
  })
})
