const { _electron: electron, expect, test } = require('@playwright/test')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')
const {
  measureInputLatency,
  measureStoreInteraction,
  percentile
} = require('./common/client-interaction-performance')

const BUDGETS = {
  aiInputP95Ms: Number(process.env.SHELLPILOT_BUDGET_AI_INPUT_P95_MS || 50),
  aiPanelOpenMs: Number(process.env.SHELLPILOT_BUDGET_AI_PANEL_OPEN_MS || 250),
  rightPanelSwitchMs: Number(process.env.SHELLPILOT_BUDGET_RIGHT_PANEL_SWITCH_MS || 250),
  settingsOpenMs: Number(process.env.SHELLPILOT_BUDGET_SETTINGS_OPEN_MS || 500)
}

test.setTimeout(120000)

test('enforces long-history typing and loaded client interaction budgets', async () => {
  let run
  let primaryError
  try {
    run = await launchQualityApp(electron)
    const page = run.page
    await page.bringToFront()
    await page.evaluate(() => {
      const response = '# Historical response\n' + 'status: ok\n'.repeat(1400)
      const profile = {
        id: 'interaction-performance-ai',
        nameAI: 'Interaction Performance Model',
        baseURLAI: 'http://127.0.0.1:43434',
        apiPathAI: '/chat/completions',
        modelAI: 'interaction-performance-model',
        apiKeyAI: 'interaction-performance-token',
        authHeaderNameAI: 'Authorization: Bearer',
        roleAI: '',
        languageAI: 'Chinese'
      }
      window.store.aiChatHistory = Array.from({ length: 100 }, (_, index) => ({
        id: `interaction-history-${index}`,
        conversationScopeId: 'global',
        sourceTabId: 'global',
        prompt: `historical prompt ${index}`,
        displayPrompt: `historical prompt ${index}`,
        response,
        completionStatus: 'completed',
        pending: false,
        isStreaming: false,
        toolCalls: [],
        artifactIds: []
      }))
      window.store.setConfig({
        activeAIProfileId: profile.id,
        aiProfiles: [profile],
        ...profile
      })
      window.store.handleOpenAIPanel()
    })

    const input = page.locator('.ai-chat-textarea')
    await expect(input).toBeVisible({ timeout: 20000 })
    await expect(page.locator('.chat-history-item')).toHaveCount(24, {
      timeout: 20000
    })
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
    await input.fill('shift-enter-line')
    await input.press('Shift+Enter')
    await expect(input).toHaveValue('shift-enter-line\n')
    await expect(page.locator('.chat-history-item')).toHaveCount(historyCount)
    await input.fill('')

    const typed = 'shellpilot-input-latency-0123456789-abcdef'
    const inputResult = await measureInputLatency(page, {
      selector: '.ai-chat-textarea',
      text: typed
    })
    const inputP95Ms = percentile(inputResult.samples, 0.95)
    const inputMetrics = {
      aiInputP50Ms: percentile(inputResult.samples, 0.5),
      aiInputP95Ms: inputP95Ms,
      aiInputMaxMs: Math.max(...inputResult.samples),
      driverTimeout: inputResult.driverTimeout,
      documentHasFocus: inputResult.documentHasFocus,
      visibilityState: inputResult.visibilityState
    }
    console.log(`[client-interaction] ${JSON.stringify(inputMetrics)}`)
    await test.info().attach('ai-input-baseline.json', {
      body: Buffer.from(JSON.stringify(inputMetrics, null, 2)),
      contentType: 'application/json'
    })
    expect(inputP95Ms).toBeLessThanOrEqual(BUDGETS.aiInputP95Ms)
    expect(inputResult.value).toBe(typed)

    await page.evaluate(() => {
      window.store.rightPanelVisible = false
      window.store.rightPanelAutoExpanded = false
    })
    const rightSidePanel = page.locator('.right-side-panel')
    await expect(rightSidePanel).not.toBeVisible()
    await expect(rightSidePanel).toHaveAttribute('inert', '')
    const aiPanelOpen = await measureStoreInteraction(page, {
      action: 'open-ai',
      selector: '.right-side-panel.right-side-panel-ai .ai-chat-container'
    })
    console.log(`[client-interaction] ${JSON.stringify({ aiPanelOpen })}`)
    expect(aiPanelOpen.totalMs).toBeLessThanOrEqual(BUDGETS.aiPanelOpenMs)
    await expect(rightSidePanel).not.toHaveAttribute('inert', '')

    await page.evaluate(() => window.store.openInfoPanel())
    await expect(page.locator('.right-side-panel.right-side-panel-ai')).toHaveCount(0)
    await expect(page.locator('.ai-chat-container')).toHaveAttribute('inert', '')
    const rightPanelSwitch = await measureStoreInteraction(page, {
      action: 'switch-ai',
      selector: '.right-side-panel.right-side-panel-ai .ai-chat-container'
    })
    console.log(`[client-interaction] ${JSON.stringify({ rightPanelSwitch })}`)
    expect(rightPanelSwitch.totalMs).toBeLessThanOrEqual(BUDGETS.rightPanelSwitchMs)

    await page.evaluate(() => window.store.hideSettingModal())
    await expect(page.locator('.setting-wrap')).toHaveCount(0)
    const settingsOpen = await measureStoreInteraction(page, {
      action: 'open-settings',
      selector: '.setting-wrap .setting-tabs'
    })
    console.log(`[client-interaction] ${JSON.stringify({ settingsOpen })}`)
    expect(settingsOpen.totalMs).toBeLessThanOrEqual(BUDGETS.settingsOpenMs)

    const metrics = {
      budgets: BUDGETS,
      measured: {
        aiInputP50Ms: percentile(inputResult.samples, 0.5),
        aiInputP95Ms: inputP95Ms,
        aiInputMaxMs: Math.max(...inputResult.samples),
        aiPanelOpen,
        rightPanelSwitch,
        settingsOpen
      },
      historyItems: 100,
      historyCharacters: 100 * ('# Historical response\n'.length + 'status: ok\n'.length * 1400)
    }
    await test.info().attach('client-interaction-performance.json', {
      body: Buffer.from(JSON.stringify(metrics, null, 2)),
      contentType: 'application/json'
    })
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (run) {
      await cleanupQualityApp(run.electronApp, run.profileRoot).catch(error => {
        if (!primaryError) throw error
      })
    }
  }
})
