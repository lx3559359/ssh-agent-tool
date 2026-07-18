const { _electron: electron } = require('@playwright/test')
const { test: it, expect } = require('@playwright/test')
const { describe } = it
const { promises: fs } = require('fs')
const { tmpdir } = require('os')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')
const { spawn } = require('child_process')
const { join, resolve, sep } = require('path')
const {
  acquireIsolatedApp,
  cleanupPreservingPrimaryError
} = require('./common/isolated-electron-app')

const profilePrefix = 'shellpilot-ai-config-'

function assertSafeProfileRoot (profileRoot) {
  const tempRoot = resolve(tmpdir()) + sep
  if (!profileRoot.startsWith(tempRoot) || !profileRoot.includes(profilePrefix)) {
    throw new Error(`Refusing to use unexpected AI config profile: ${profileRoot}`)
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

function aiProfile () {
  return {
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
          throw new Error(`Electron ignored isolated AI config profile: ${actualPath}`)
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
    let primaryError
    try {
      if (client && !client.isClosed()) {
        await client.evaluate(() => window.store.setConfig({ showCmdSuggestions: false }))
      }
    } catch (error) {
      primaryError = error
    }
    await cleanupPreservingPrimaryError(
      () => closeIsolatedApp(electronApp, acquired.profileRoot),
      primaryError
    )
    if (primaryError) throw primaryError
  })

  it('should open AI setting page and fill configuration', async function () {
    await client.evaluate(() => {
      return window.store.setConfig({
        showCmdSuggestions: true
      })
    })
    await client.getByRole('button', { name: '模型API' }).click()

    await expect(client.locator('.ai-config-modal .ai-config-form')).toBeVisible({ timeout: 10000 })

    await client.fill('#baseURLAI', 'http://localhost:43434')
    await client.fill('#modelAI', 'gpt-3.5-turbo')
    await client.fill('#apiKeyAI', 'test-api-key')

    await client.click('.ai-config-form button[type="submit"]')
    await expect(client.locator('.ai-config-modal .ai-config-form')).not.toBeVisible({ timeout: 10000 })
  })

  it('should verify AI functionality after configuration', async function () {
    await client.evaluate(profile => {
      window.store.setConfig({
        showCmdSuggestions: true,
        activeAIProfileId: profile.id,
        aiProfiles: [profile],
        ...profile
      })
      window.store.handleOpenAIPanel()
    }, aiProfile())

    await expect(client.locator('.ai-config-modal .ai-config-form')).not.toBeVisible()
    await expect(client.locator('.ai-chat-container')).toBeVisible({ timeout: 10000 })
  })

  it('should test AI suggestions functionality', async function () {
    const previousTabId = await client.evaluate(async profile => {
      await window.store.setConfig({
        showCmdSuggestions: true,
        execWindows: 'System32/cmd.exe',
        activeAIProfileId: profile.id,
        aiProfiles: [profile],
        ...profile
      })
      const tabId = window.store.activeTabId
      window.store.reloadTab(tabId)
      return tabId
    }, aiProfile())

    await client.waitForFunction(previousId => {
      const tab = window.store?.currentTab
      const terminal = tab && window.refs?.get(`term-${tab.id}`)
      if (tab?.id === previousId || tab?.status !== 'success' || !terminal?.pid || !terminal.term) {
        return false
      }
      const buffer = terminal.term.buffer.active
      const line = buffer.getLine(buffer.baseY + buffer.cursorY)
      return Boolean(line?.translateToString(true).trim())
    }, previousTabId, { timeout: 20000 })

    const testCommand = 'test'
    await client.locator('.xterm-helper-textarea').first().evaluate(element => element.focus())
    await client.keyboard.type(testCommand)
    await client.keyboard.press('ArrowRight')
    await client.keyboard.press('ArrowRight')
    await expect(client.locator('.terminal-suggestions-wrap')).toBeVisible({ timeout: 10000 })

    // Get the initial count of suggestions
    const initialSuggestionsCount = await client.locator('.suggestion-item').count()

    await client.getByText('获取 AI 建议', { exact: true }).click()
    await expect.poll(
      () => client.locator('.suggestion-item').count(),
      { timeout: 10000 }
    ).toBeGreaterThan(initialSuggestionsCount)

    const aiSuggestions = client.locator('.suggestion-item').filter({
      has: client.locator('.suggestion-type', { hasText: 'AI' })
    })
    await expect(aiSuggestions).toHaveCount(5)

    const suggestions = await aiSuggestions.locator('.suggestion-command').allTextContents()
    for (const suggestion of suggestions) {
      expect(suggestion.startsWith(testCommand)).toBeTruthy()
    }
  })
})
