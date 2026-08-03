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

  it('should upload paste drop remove and safely submit local attachments', async function () {
    await client.evaluate(() => {
      window.store.aiChatHistory = []
      const profile = {
        id: 'e2e-ai-attachments',
        nameAI: 'E2E AI Attachments',
        baseURLAI: 'http://localhost:43434',
        apiPathAI: '/chat/completions',
        modelAI: 'gpt-3.5-turbo',
        apiKeyAI: 'test-api-key',
        authHeaderNameAI: 'Authorization: Bearer',
        roleAI: '',
        languageAI: 'English'
      }
      window.store.setConfig({
        activeAIProfileId: profile.id,
        aiProfiles: [profile],
        ...profile
      })
      window.store.handleOpenAIPanel()
    })

    const composer = client.locator('.ai-chat-input')
    const uploadButton = composer.locator('.ai-attachment-upload-button')
    await expect(uploadButton).toBeVisible({ timeout: 10000 })

    const chooserPromise = client.waitForEvent('filechooser')
    await uploadButton.click()
    const chooser = await chooserPromise
    await chooser.setFiles({
      name: 'upload.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('uploaded attachment payload')
    })
    await expect(composer.locator('.ai-attachment-chip')).toContainText('upload.txt')
    await composer.locator('.ai-attachment-remove').click()
    await expect(composer.locator('.ai-attachment-queue')).toHaveCount(0)

    const textarea = composer.locator('.ai-chat-textarea')
    await textarea.evaluate(element => {
      const clipboard = new window.DataTransfer()
      clipboard.items.add(new window.File(
        ['pasted attachment payload'],
        'pasted.txt',
        { type: 'text/plain' }
      ))
      element.dispatchEvent(new window.ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: clipboard
      }))

      const dropped = new window.DataTransfer()
      dropped.items.add(new window.File(
        ['dropped attachment payload'],
        'dropped.txt',
        { type: 'text/plain' }
      ))
      element.dispatchEvent(new window.DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dropped
      }))
    })
    await expect(composer.locator('.ai-attachment-chip')).toHaveCount(2)
    await expect(composer.locator('.ai-attachment-queue')).toContainText('pasted.txt')
    await expect(composer.locator('.ai-attachment-queue')).toContainText('dropped.txt')

    await textarea.fill('Review both local attachments.')
    await composer.locator('.send-to-ai-icon').click()
    await expect(composer.locator('.ai-attachment-queue')).toHaveCount(0)
    await expect(client.locator('.chat-history-item')).toHaveCount(1, { timeout: 10000 })
    await expect(client.locator('.chat-history-item').last()).toContainText(
      'Response to your query',
      { timeout: 10000 }
    )
    await expect.poll(() => client.evaluate(() => (
      window.store.aiChatHistory.at(-1)?.prompt || ''
    ))).toContain('pasted attachment payload')
    await expect.poll(() => client.evaluate(() => (
      window.store.aiChatHistory.at(-1)?.prompt || ''
    ))).toContain('dropped attachment payload')

    await client.evaluate(() => {
      const runGlobalAsync = window.pre.runGlobalAsync.bind(window.pre)
      window.__attachmentIngestionPayloads = []
      window.pre.runGlobalAsync = (name, ...args) => {
        const operation = runGlobalAsync(name, ...args)
        if (name !== 'ingestAIContent') {
          return operation
        }
        const record = { payload: args[0], result: null }
        window.__attachmentIngestionPayloads.push(record)
        return operation.then(result => {
          record.result = result
          return result
        })
      }
    })
    await textarea.evaluate(element => {
      const dropped = new window.DataTransfer()
      const file = new window.File(
        ['<svg xmlns="http://www.w3.org/2000/svg"/>'],
        'spoofed.png',
        { type: 'image/svg+xml' }
      )
      window.__spoofedAttachmentMime = file.type
      dropped.items.add(file)
      element.dispatchEvent(new window.DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dropped
      }))
    })
    await expect(composer.locator('.ai-attachment-chip')).toContainText(
      'spoofed.png'
    )
    expect(await client.evaluate(() => window.__spoofedAttachmentMime)).toBe(
      'image/svg+xml'
    )
    await composer.locator('.send-to-ai-icon').click()
    await expect.poll(() => client.evaluate(() => (
      window.__attachmentIngestionPayloads.at(-1)?.payload?.mimeType || ''
    ))).toBe('image/svg+xml')
    await expect.poll(() => client.evaluate(() => (
      window.__attachmentIngestionPayloads.at(-1)?.result?.ok
    ))).toBe(false)
    await expect(client.locator('.message-item.warning').last()).toContainText(
      'spoofed.png',
      { timeout: 10000 }
    )
    await expect(client.locator('.chat-history-item')).toHaveCount(1)
  })

  it('should render normalized legacy object fields without failing the AI panel', async function () {
    await client.evaluate(() => {
      window.__aiRendererErrors = []
      const runGlobalAsync = window.pre.runGlobalAsync.bind(window.pre)
      window.pre.runGlobalAsync = (name, ...args) => {
        if (name === 'reportRendererError') {
          window.__aiRendererErrors.push(args[0])
        }
        return runGlobalAsync(name, ...args)
      }
      const profile = {
        id: 'e2e-ai-legacy',
        nameAI: 'E2E Legacy AI',
        baseURLAI: 'http://localhost:43434',
        apiPathAI: '/chat/completions',
        modelAI: 'gpt-3.5-turbo',
        apiKeyAI: 'test-api-key',
        authHeaderNameAI: 'Authorization: Bearer',
        roleAI: '',
        languageAI: '简体中文'
      }
      window.store.aiChatHistory = [
        null,
        'legacy-corrupt-entry',
        {},
        {
          id: 'legacy-chat',
          prompt: { text: 'check disk' },
          displayPrompt: { content: 'visible prompt' },
          response: { content: 'disk is healthy' },
          toolCalls: { id: 'not-an-array' },
          artifactIds: 'artifact-1'
        }
      ]
      window.store.setConfig({
        activeAIProfileId: profile.id,
        aiProfiles: [profile],
        ...profile
      })
      window.store.handleOpenAIPanel()
    })

    await client.waitForTimeout(1000)
    const rendererErrors = await client.evaluate(() => window.__aiRendererErrors)
    expect(rendererErrors).toEqual([])
    await expect(client.locator('.ai-chat-container')).toBeVisible({ timeout: 10000 })
    await expect(client.locator('.lazy-module-error')).toHaveCount(0)
    await expect(client.locator('.chat-history-item')).toHaveCount(1)
    await expect(client.locator('.chat-history-item')).toContainText('visible prompt')
    await expect(client.locator('.chat-history-item')).toContainText('disk is healthy')
  })
})
