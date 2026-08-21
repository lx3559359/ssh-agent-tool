const { _electron: electron, expect, test } = require('@playwright/test')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')
const { startLocalAiServer } = require('./common/ai-api')
const {
  measureInputLatency,
  measureStoreInteraction,
  percentile,
  summarizeInteractionSamples,
  waitForStableFrames
} = require('./common/client-interaction-performance')

const BUDGETS = {
  aiInputP95Ms: Number(process.env.SHELLPILOT_BUDGET_AI_INPUT_P95_MS || 50),
  aiPanelOpenMs: Number(process.env.SHELLPILOT_BUDGET_AI_PANEL_OPEN_MS || 250),
  rightPanelSwitchMs: Number(process.env.SHELLPILOT_BUDGET_RIGHT_PANEL_SWITCH_MS || 250),
  settingsColdOpenMs: Number(process.env.SHELLPILOT_BUDGET_SETTINGS_COLD_OPEN_MS || 250),
  settingsWarmOpenP95Ms: Number(process.env.SHELLPILOT_BUDGET_SETTINGS_WARM_OPEN_P95_MS || 150),
  settingsStableFrameMs: Number(process.env.SHELLPILOT_BUDGET_SETTINGS_STABLE_FRAME_MS || 100),
  settingsLongTaskMs: Number(process.env.SHELLPILOT_BUDGET_SETTINGS_LONG_TASK_MS || 100)
}

test.setTimeout(120000)

test('enforces long-history typing and loaded client interaction budgets', async () => {
  let run
  let aiServer
  let primaryError
  try {
    aiServer = await startLocalAiServer()
    run = await launchQualityApp(electron)
    const page = run.page
    const rendererErrors = []
    page.on('pageerror', error => {
      rendererErrors.push(String(error?.stack || error))
    })
    page.on('console', message => {
      if (message.type() === 'error') rendererErrors.push(message.text())
    })
    await page.bringToFront()
    await page.evaluate((baseURLAI) => {
      const response = '# Historical response\n' + 'status: ok\n'.repeat(1400)
      const profile = {
        id: 'interaction-performance-ai',
        nameAI: 'Interaction Performance Model',
        baseURLAI,
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
    }, aiServer.baseURL)

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
    await waitForStableFrames(page)
    const settingsColdOpen = await measureStoreInteraction(page, {
      action: 'open-settings',
      selector: '.setting-wrap .setting-tabs',
      readySelector: '.sp-setting-section-startup .edit-shortcut-button',
      readyCount: 1
    })
    console.log(`[client-interaction] ${JSON.stringify({ settingsColdOpen })}`)
    expect(settingsColdOpen.totalMs).toBeLessThanOrEqual(BUDGETS.settingsColdOpenMs)
    expect(settingsColdOpen.stableFrameMs).toBeLessThanOrEqual(BUDGETS.settingsStableFrameMs)
    if (settingsColdOpen.longTaskSupported) {
      expect(settingsColdOpen.maxLongTaskMs).toBeLessThanOrEqual(BUDGETS.settingsLongTaskMs)
    }

    const settingsWarmSamples = []
    for (let index = 0; index < 10; index += 1) {
      await page.evaluate(() => window.store.hideSettingModal(true))
      await expect.poll(() => page.locator('.setting-wrap').evaluate(element => ({
        ariaHidden: element.getAttribute('aria-hidden'),
        inert: element.inert,
        opacity: window.getComputedStyle(element).opacity
      }))).toEqual({ ariaHidden: 'true', inert: true, opacity: '0' })
      await waitForStableFrames(page)
      settingsWarmSamples.push(await measureStoreInteraction(page, {
        action: 'open-settings',
        selector: '.setting-wrap .setting-tabs',
        readySelector: '.sp-setting-section-startup .edit-shortcut-button',
        readyCount: 1
      }))
    }
    const settingsWarm = summarizeInteractionSamples(settingsWarmSamples)
    console.log(`[client-interaction] ${JSON.stringify({
      settingsWarm,
      settingsWarmSamples
    })}`)
    expect(settingsWarm.totalP95Ms)
      .toBeLessThanOrEqual(BUDGETS.settingsWarmOpenP95Ms)
    expect(settingsWarm.stableFrameMaxMs)
      .toBeLessThanOrEqual(BUDGETS.settingsStableFrameMs)
    if (settingsWarmSamples.some(sample => sample.longTaskSupported)) {
      expect(settingsWarm.maxLongTaskMs)
        .toBeLessThanOrEqual(BUDGETS.settingsLongTaskMs)
    }

    await expect(page.locator(
      '.sp-setting-section.sp-setting-section-startup'
    )).toBeVisible()
    await expect(page.locator('.sp-setting-startup-session')).toBeAttached()
    await expect(page.locator('.sp-setting-startup-numbers')).toBeAttached()
    const timeoutInput = page.locator('#setting-number-sshReadyTimeout')
    const originalTimeout = await page.evaluate(() => (
      window.store.config.sshReadyTimeout
    ))
    const committedTimeout = Math.max(100, Number(originalTimeout) + 200)
    await timeoutInput.fill(String(committedTimeout))
    await timeoutInput.press('Enter')
    await expect.poll(() => page.evaluate(() => (
      window.store.config.sshReadyTimeout
    ))).toBe(committedTimeout)
    await timeoutInput.fill(String(committedTimeout + 200))
    await timeoutInput.press('Escape')
    await expect(timeoutInput).toHaveValue(String(committedTimeout))
    await timeoutInput.fill('')
    await timeoutInput.press('Enter')
    await expect(timeoutInput).toHaveValue(String(committedTimeout))
    await timeoutInput.fill(String(originalTimeout))
    await timeoutInput.press('Enter')
    await expect.poll(() => page.evaluate(() => (
      window.store.config.sshReadyTimeout
    ))).toBe(originalTimeout)
    for (const name of ['network', 'interface', 'advanced']) {
      const section = page.locator(
        `.sp-setting-section.sp-setting-section-${name}`
      )
      if (await section.count() === 0) {
        const placeholder = page.locator(
          `.sp-setting-section-placeholder.sp-setting-section-${name}`
        )
        await expect(placeholder).toBeAttached()
        await placeholder.evaluate(element => {
          element.scrollIntoView({ block: 'center' })
        })
      }
      await expect(section).toBeAttached()
      await section.scrollIntoViewIfNeeded()
      await expect(section).toBeVisible()
    }
    const sections = page.locator('.sp-settings-form .sp-setting-section')
    await expect(sections).toHaveCount(4)
    const advancedSection = page.locator(
      '.sp-setting-section.sp-setting-section-advanced'
    )
    await advancedSection.scrollIntoViewIfNeeded()
    await expect(advancedSection).toBeVisible()
    const advancedTopBeforeStable = await advancedSection.evaluate(element => (
      element.getBoundingClientRect().top
    ))
    await waitForStableFrames(page)
    const advancedTopAfterStable = await advancedSection.evaluate(element => (
      element.getBoundingClientRect().top
    ))
    expect(Math.abs(advancedTopAfterStable - advancedTopBeforeStable))
      .toBeLessThanOrEqual(8)
    const advancedControl = advancedSection.locator('input, button, [tabindex]').first()
    await advancedControl.focus()
    await expect(advancedControl).toBeFocused()

    const closeButton = page.locator('.setting-wrap .close-setting-wrap-icon')
    await closeButton.focus()
    await expect(closeButton).toBeFocused()
    await page.keyboard.press('Control+K')
    const settingsSearch = page.locator('.setting-header-search input')
    await expect(settingsSearch).toBeFocused()
    await settingsSearch.fill('proxy')
    const generalResult = page.locator('.setting-search-results [role="option"]')
    await expect(generalResult).toHaveCount(1)
    await generalResult.click()
    await expect(page.locator('.sp-setting-section-network')).toBeAttached()

    await closeButton.click()
    await expect.poll(() => page.locator('.setting-wrap').evaluate(element => ({
      ariaHidden: element.getAttribute('aria-hidden'),
      inert: element.inert,
      opacity: window.getComputedStyle(element).opacity
    }))).toEqual({ ariaHidden: 'true', inert: true, opacity: '0' })
    await page.evaluate(() => window.store.openSetting())
    await expect(page.locator(
      '.sp-setting-section-startup .edit-shortcut-button'
    )).toBeVisible()
    const generalTab = page.locator('#setting-tab-setting')
    const themesTab = page.locator('#setting-tab-terminalThemes')
    await generalTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(themesTab).toHaveAttribute('aria-selected', 'true')
    await expect(themesTab).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(generalTab).toHaveAttribute('aria-selected', 'true')
    await expect(generalTab).toBeFocused()
    expect(rendererErrors, rendererErrors.join('\n')).toEqual([])

    const metrics = {
      budgets: BUDGETS,
      measured: {
        aiInputP50Ms: percentile(inputResult.samples, 0.5),
        aiInputP95Ms: inputP95Ms,
        aiInputMaxMs: Math.max(...inputResult.samples),
        aiPanelOpen,
        rightPanelSwitch,
        settingsColdOpen,
        settingsWarm,
        settingsWarmSamples
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
    let cleanupError
    if (run) {
      await cleanupQualityApp(run.electronApp, run.profileRoot).catch(error => {
        cleanupError = error
      })
    }
    if (aiServer) {
      await aiServer.close().catch(error => {
        cleanupError ||= error
      })
    }
    if (!primaryError && cleanupError) await Promise.reject(cleanupError)
  }
})
