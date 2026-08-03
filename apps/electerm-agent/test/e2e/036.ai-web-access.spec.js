const { _electron: electron, test, expect } = require('@playwright/test')
const { promises: fs } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, sep } = require('node:path')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')
const { startLocalAiServer } = require('./common/ai-api')
const { startAIWebFixture } = require('./common/ai-web-fixture')
const {
  acquireIsolatedApp,
  cleanupPreservingPrimaryError
} = require('./common/isolated-electron-app')

const profilePrefix = 'shellpilot-ai-web-'

function assertSafeProfileRoot (profileRoot) {
  const resolved = resolve(profileRoot)
  const tempRoot = resolve(tmpdir()) + sep
  if (!resolved.startsWith(tempRoot) || !resolved.includes(profilePrefix)) {
    throw new Error(`Refusing to use unexpected AI web profile: ${resolved}`)
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
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await fs.rm(profileRoot, { recursive: true, force: true })
      return
    } catch (error) {
      if (
        !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code) ||
        attempt === 7
      ) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
}

async function configureAI (page, baseURL) {
  await page.evaluate(url => {
    window.store.aiChatHistory = []
    const profile = {
      id: 'e2e-ai-web',
      nameAI: 'E2E Web AI',
      baseURLAI: url,
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
  }, baseURL)
  await expect(page.locator('.ai-chat-container')).toBeVisible({
    timeout: 10000
  })
}

async function submitWebRead (page, url, prompt = 'Read the attached page.') {
  await page.getByTestId('ai-web-add-url').click()
  await page.getByTestId('ai-web-url-input').fill(url)
  await page.getByTestId('ai-web-url-confirm').click()
  await page.locator('.ai-chat-textarea').fill(prompt)
  await page.getByTestId('ai-chat-submit').click()
}

async function findRemoteId (electronApp, origin) {
  await expect.poll(() => electronApp.evaluate(
    ({ webContents }, expectedOrigin) => {
      return webContents.getAllWebContents()
        .find(item => item.getURL().startsWith(expectedOrigin))?.id || 0
    },
    origin
  ), { timeout: 15000 }).toBeGreaterThan(0)
  return electronApp.evaluate(
    ({ webContents }, expectedOrigin) => webContents.getAllWebContents()
      .find(item => item.getURL().startsWith(expectedOrigin)).id,
    origin
  )
}

function executeRemote (electronApp, id, script) {
  return electronApp.evaluate(
    ({ webContents }, input) => webContents.fromId(input.id)
      ?.executeJavaScript(input.script),
    { id, script }
  )
}

async function findReaderWindow (electronApp) {
  await expect.poll(async () => {
    const windows = electronApp.windows().filter(page => !page.isClosed())
    const counts = await Promise.all(windows.map(page => (
      page.getByTestId('ai-web-reader-read-current').count().catch(() => 0)
    )))
    return counts.some(Boolean)
  }, { timeout: 15000 }).toBe(true)
  for (const page of electronApp.windows()) {
    if (
      !page.isClosed() &&
      await page.getByTestId('ai-web-reader-read-current').count().catch(() => 0)
    ) {
      return page
    }
  }
  throw new Error('AI web reader window was not found.')
}

async function openWebAccessSettings (page) {
  await page.evaluate(() => {
    window.store.storeAssign({ settingTab: 'setting' })
    window.store.setSettingItem({
      id: 'setting-ai-web-access',
      title: 'AI Web Access'
    })
    window.store.openSettingModal()
  })
  await expect(page.locator('.sp-ai-web-access-settings')).toBeVisible()
}

test.describe('authorized localhost web reading', () => {
  test.describe.configure({ timeout: 120000 })

  let acquired
  let electronApp
  let page
  let aiServer
  let firstFixture
  let secondFixture

  test.beforeEach(async () => {
    aiServer = await startLocalAiServer()
    firstFixture = await startAIWebFixture()
    secondFixture = await startAIWebFixture({
      sentence: 'Second private origin content must stay unread after cancellation.'
    })
    firstFixture.setRedirectTarget(`${secondFixture.origin}/app#/sharingPath`)
    acquired = await acquireIsolatedApp({
      createProfileRoot: () => fs.mkdtemp(resolve(tmpdir(), profilePrefix)),
      validateProfileRoot: assertSafeProfileRoot,
      launch: root => electron.launch(launchOptions(root)),
      readUserDataPath: app => app.evaluate(({ app }) => app.getPath('userData')),
      validateUserDataPath: (root, actualPath) => {
        if (!resolve(actualPath).startsWith(resolve(root) + sep)) {
          throw new Error(`Electron ignored isolated AI web profile: ${actualPath}`)
        }
      },
      cleanup: closeIsolatedApp
    })
    electronApp = acquired.electronApp
    page = await electronApp.firstWindow()
    extendClient(page, electronApp)
    await page.waitForFunction(() => window.store?.configLoaded === true, {
      timeout: 20000
    })
    await configureAI(page, aiServer.baseURL)
  })

  test.afterEach(async () => {
    let primaryError
    try {
      if (acquired?.profileRoot) {
        await closeIsolatedApp(electronApp, acquired.profileRoot)
      }
    } catch (error) {
      primaryError = error
    }
    for (const fixture of [firstFixture, secondFixture, aiServer]) {
      if (!fixture) continue
      await cleanupPreservingPrimaryError(
        () => fixture.close(),
        primaryError
      )
    }
    if (primaryError) throw primaryError
  })

  test('reads an authenticated SPA, reuses isolation, and honors clearing', async () => {
    await submitWebRead(page, firstFixture.urls.app)
    const modal = page.locator('.shellpilot-ai-web-access-content')
    await expect(modal).toContainText(firstFixture.origin)
    await expect(modal).toContainText(/localhost|本机/i)
    await page.getByTestId('ai-web-allow-once').click()

    const remoteId = await findRemoteId(electronApp, firstFixture.origin)
    await expect.poll(() => executeRemote(
      electronApp,
      remoteId,
      'document.body.innerText'
    )).toContain('Sign in')
    await executeRemote(electronApp, remoteId, [
      "document.querySelector('[name=account]').value = 'operator'",
      "document.querySelector('[name=password]').value = 'e2e-secret-password'",
      'document.querySelector(\'form\').requestSubmit()'
    ].join(';'))
    await expect.poll(() => executeRemote(
      electronApp,
      remoteId,
      'document.body.innerText'
    ), { timeout: 15000 }).toContain(firstFixture.sentence)

    const reader = await findReaderWindow(electronApp)
    await reader.getByTestId('ai-web-reader-read-current').click().catch(error => {
      if (!/Target page, context or browser has been closed/i.test(error.message)) {
        throw error
      }
    })
    await expect.poll(() => page.evaluate(() => (
      window.store.aiChatHistory.at(-1)?.prompt || ''
    )), { timeout: 15000 }).toContain(firstFixture.sentence)
    const firstPrompt = await page.evaluate(() => (
      window.store.aiChatHistory.at(-1)?.prompt || ''
    ))
    expect(firstPrompt).not.toContain('e2e-secret-password')
    expect(firstPrompt).not.toContain('sp_ai_auth')
    expect(firstPrompt).not.toContain('account=operator')

    const historyAfterLogin = await page.evaluate(() => (
      window.store.aiChatHistory.length
    ))
    await submitWebRead(page, firstFixture.urls.app, 'Reuse the isolated login.')
    await page.getByTestId('ai-web-allow-always').click()
    await expect.poll(() => page.evaluate(() => (
      window.store.aiChatHistory.length
    )), { timeout: 15000 }).toBe(historyAfterLogin + 1)

    await openWebAccessSettings(page)
    const grantRow = page.locator('.ant-table-row').filter({
      hasText: firstFixture.origin
    })
    await grantRow.getByTestId('ai-web-revoke').click()
    await page.locator('.ant-popconfirm .ant-btn-primary').click()
    await expect(grantRow).toHaveCount(0)
    await page.evaluate(() => window.store.hideSettingModal())

    await submitWebRead(page, firstFixture.urls.app, 'Prompt after revocation.')
    await expect(modal).toContainText(firstFixture.origin)
    await page.getByTestId('ai-web-allow-once').click()
    await expect.poll(() => page.evaluate(() => (
      window.store.aiChatHistory.length
    )), { timeout: 15000 }).toBe(historyAfterLogin + 2)

    await openWebAccessSettings(page)
    await page.getByTestId('ai-web-clear-session').click()
    await page.locator('.ant-popconfirm .ant-btn-primary').click()
    await page.evaluate(() => window.store.hideSettingModal())

    await submitWebRead(page, firstFixture.urls.app, 'Prompt after login clearing.')
    await page.getByTestId('ai-web-allow-once').click()
    const newRemoteId = await findRemoteId(electronApp, firstFixture.origin)
    await expect.poll(() => executeRemote(
      electronApp,
      newRemoteId,
      'document.body.innerText'
    ), { timeout: 15000 }).toContain('Sign in')
  })

  test('challenges a redirected origin and cancels before reading it', async () => {
    await submitWebRead(page, firstFixture.urls.redirect)
    const modal = page.locator('.shellpilot-ai-web-access-content')
    await expect(modal).toContainText(firstFixture.origin)
    await page.getByTestId('ai-web-allow-once').click()
    await expect(modal).toContainText(secondFixture.origin, { timeout: 15000 })
    await page.getByTestId('ai-web-cancel').click()

    await expect.poll(() => firstFixture.snapshot().redirect).toBe(1)
    await expect.poll(() => secondFixture.snapshot().app).toBe(0)
    expect(secondFixture.snapshot().blockedSubresource).toBe(0)
    expect(await page.evaluate(() => window.store.aiChatHistory.length)).toBe(0)
  })
})
