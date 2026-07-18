const { promises: fs } = require('fs')
const { tmpdir } = require('os')
const { resolve, sep } = require('path')
const { _electron: electron, test, expect } = require('@playwright/test')
const appOptions = require('./common/app-options')
const {
  acquireIsolatedApp,
  cleanupPreservingPrimaryError
} = require('./common/isolated-electron-app')

const profilePrefix = 'shellpilot-primary-regression-'
const viewportCases = [
  { width: 1366, height: 768, zoom: 1, theme: 'default', label: '1366-dark-100' },
  { width: 1366, height: 768, zoom: 1.25, theme: 'defaultLight', label: '1366-light-125' },
  { width: 1366, height: 768, zoom: 1.5, theme: 'default', label: '1366-dark-150' },
  { width: 1920, height: 1080, zoom: 1, theme: 'defaultLight', label: '1920-light-100' },
  { width: 1920, height: 1080, zoom: 1.25, theme: 'default', label: '1920-dark-125' },
  { width: 1920, height: 1080, zoom: 1.5, theme: 'defaultLight', label: '1920-light-150' }
]

test.setTimeout(5 * 60 * 1000)

function assertSafeProfileRoot (profileRoot) {
  const tempRoot = resolve(tmpdir()) + sep
  if (!profileRoot.startsWith(tempRoot) || !profileRoot.includes(profilePrefix)) {
    throw new Error(`Refusing to use unexpected regression profile: ${profileRoot}`)
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

async function runWithIsolatedApp (callback) {
  const acquired = await acquireIsolatedApp({
    createProfileRoot: () => fs.mkdtemp(resolve(tmpdir(), profilePrefix)),
    validateProfileRoot: assertSafeProfileRoot,
    launch: root => electron.launch(launchOptions(root)),
    readUserDataPath: app => app.evaluate(({ app }) => app.getPath('userData')),
    validateUserDataPath: (root, actualPath) => {
      if (!resolve(actualPath).startsWith(resolve(root) + sep)) {
        throw new Error(`Electron ignored isolated regression profile: ${actualPath}`)
      }
    },
    cleanup: closeIsolatedApp
  })
  let primaryError
  try {
    await callback(acquired.electronApp)
  } catch (error) {
    primaryError = error
  }
  await cleanupPreservingPrimaryError(
    () => closeIsolatedApp(acquired.electronApp, acquired.profileRoot),
    primaryError
  )
  if (primaryError) throw primaryError
}

async function dismissStartupModals (page) {
  const modal = page.locator('.custom-modal-container:visible')
  for (let attempt = 0; attempt < 4 && await modal.count(); attempt += 1) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    if (!await modal.count()) break
    const close = modal.locator('.custom-modal-close:visible').last()
    if (await close.count()) await close.click()
  }
  await expect(modal).toHaveCount(0)
}

async function setWindowCase (electronApp, page, viewport) {
  await electronApp.evaluate(({ BrowserWindow }, value) => {
    const window = BrowserWindow.getAllWindows()[0]
    // BrowserWindow dimensions are device-independent pixels on Windows.
    // Convert the physical display size to the logical workspace available
    // at 125%/150% scaling instead of using Chromium page zoom.
    window.webContents.setZoomFactor(1)
    window.setContentSize(
      Math.round(value.width / value.zoom),
      Math.round(value.height / value.zoom)
    )
  }, viewport)
  await page.waitForTimeout(180)
}

async function installLongConversationFixture (page) {
  await page.evaluate(() => {
    const store = window.store
    const scope = String(store.activeTabId || 'global')
    const longLine = '这是一段用于检查中文长文本、自动换行和窄侧栏布局的运维说明。'.repeat(4)
    store.setConfig({
      activeAIProfileId: 'visual-profile',
      aiProfiles: [{
        id: 'visual-profile',
        nameAI: '国内模型中转站',
        baseURLAI: 'https://api.example.invalid/v1',
        apiKeyAI: '',
        modelAI: '长模型名称-Qwen3-运维分析测试版',
        modelOptionsAI: ['长模型名称-Qwen3-运维分析测试版'],
        roleAI: ''
      }]
    })
    store.aiChatHistory = Array.from({ length: 80 }, (_, index) => ({
      id: `visual-chat-${index + 1}`,
      timestamp: 1700000000000 + index,
      prompt: `第 ${index + 1} 条：请检查服务器网络与日志状态`,
      response: `### 检查结果\n\n${longLine}\n\n- 状态：正常\n- 建议：继续观察`,
      mode: 'ask',
      completionStatus: 'completed',
      conversationScopeId: scope,
      sourceTabId: scope,
      nameAI: '国内模型中转站',
      modelAI: '长模型名称-Qwen3-运维分析测试版'
    }))
    store.rightPanelVisible = true
    store.rightPanelPinned = true
    store.rightPanelTab = 'ai'
    store.setRightSidePanelWidth(360)
  })
  await expect(page.locator('.right-side-panel')).toBeVisible()
  await expect(page.locator('.chat-history-item')).toHaveCount(24)
  await expect(page.locator('.ai-history-load-earlier')).toContainText('56')
}

async function verifyChineseComposition (page) {
  const input = page.locator('.ai-chat-textarea')
  const historyCount = await page.locator('.chat-history-item').count()
  await input.evaluate(element => {
    element.focus()
    element.dispatchEvent(new window.CompositionEvent('compositionstart', {
      bubbles: true,
      data: ''
    }))
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set
    setter.call(element, '检查中文输入法组合输入')
    element.dispatchEvent(new window.InputEvent('input', {
      bubbles: true,
      data: '检查中文输入法组合输入',
      inputType: 'insertCompositionText',
      isComposing: true
    }))
    element.dispatchEvent(new window.CompositionEvent('compositionend', {
      bubbles: true,
      data: '检查中文输入法组合输入'
    }))
  })
  await expect(input).toHaveValue('检查中文输入法组合输入')
  await expect(page.locator('.chat-history-item')).toHaveCount(historyCount)
}

test('primary workspace keeps long Chinese AI history usable across Windows sizes and scaling', async () => {
  await runWithIsolatedApp(async electronApp => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })
    await dismissStartupModals(page)
    await installLongConversationFixture(page)
    await verifyChineseComposition(page)
    await expect(page.locator('.right-panel-model-status')).toContainText('未配置')
    await expect(page.locator('.right-panel-model-status')).not.toContainText('ms')

    for (const viewport of viewportCases) {
      await page.evaluate(theme => window.store.setTheme(theme), viewport.theme)
      await expect.poll(() => page.evaluate(() => window.store.config.theme)).toBe(viewport.theme)
      await setWindowCase(electronApp, page, viewport)

      const metrics = await page.evaluate(() => {
        const body = document.body
        const panel = document.querySelector('.right-side-panel')
        const history = document.querySelector('.ai-history-wrap')
        const input = document.querySelector('.ai-chat-textarea')
        const panelRect = panel.getBoundingClientRect()
        const inputRect = input.getBoundingClientRect()
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          bodyScrollWidth: body.scrollWidth,
          panelRect: panelRect.toJSON(),
          historyClientHeight: history.clientHeight,
          historyScrollHeight: history.scrollHeight,
          inputRect: inputRect.toJSON(),
          panelOverflowX: window.getComputedStyle(panel).overflowX
        }
      })
      const context = JSON.stringify({ viewport, metrics })
      expect(metrics.bodyScrollWidth, context).toBeLessThanOrEqual(metrics.viewportWidth + 1)
      expect(metrics.panelRect.width, context).toBeGreaterThanOrEqual(300)
      expect(metrics.panelRect.right, context).toBeLessThanOrEqual(metrics.viewportWidth + 1)
      expect(metrics.panelRect.bottom, context).toBeLessThanOrEqual(metrics.viewportHeight + 1)
      expect(metrics.historyClientHeight, context).toBeGreaterThan(120)
      expect(metrics.historyScrollHeight, context).toBeGreaterThan(metrics.historyClientHeight)
      expect(metrics.inputRect.width, context).toBeGreaterThan(240)
      expect(metrics.inputRect.bottom, context).toBeLessThanOrEqual(metrics.viewportHeight + 1)

      await page.locator('.term-wrap').evaluateAll(elements => {
        for (const element of elements) element.style.opacity = '0'
      })
      const screenshot = await page.screenshot({
        animations: 'disabled',
        caret: 'hide'
      })
      expect(screenshot).toMatchSnapshot(`primary-workspace-${viewport.label}.png`, {
        maxDiffPixelRatio: 0.01
      })
    }
  })
})
