const { _electron: electron, expect, test } = require('@playwright/test')
const { startLocalAiServer } = require('./common/ai-api')
const { startLocalSshServer } = require('./common/local-ssh-server')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')

const REQUIRED_METRICS = [
  'app_start_ms',
  'first_window_interactive_ms',
  'first_terminal_ready_ms',
  'memory_main_mb',
  'memory_renderer_mb',
  'ai_first_token_ms',
  'ai_total_ms'
]

const PERFORMANCE_BUDGETS = {
  app_start_ms: Number(process.env.SHELLPILOT_BUDGET_APP_START_MS || 15000),
  first_window_interactive_ms: Number(process.env.SHELLPILOT_BUDGET_WINDOW_INTERACTIVE_MS || 20000),
  first_terminal_ready_ms: Number(process.env.SHELLPILOT_BUDGET_TERMINAL_READY_MS || 30000),
  memory_main_mb: Number(process.env.SHELLPILOT_BUDGET_MAIN_MEMORY_MB || 500),
  memory_renderer_mb: Number(process.env.SHELLPILOT_BUDGET_RENDERER_MEMORY_MB || 750),
  ai_first_token_ms: Number(process.env.SHELLPILOT_BUDGET_AI_FIRST_TOKEN_MS || 5000),
  ai_total_ms: Number(process.env.SHELLPILOT_BUDGET_AI_TOTAL_MS || 10000)
}

test.setTimeout(120000)

async function acceptHostKey (page) {
  const modal = page.locator('.custom-modal-wrap').last()
  await expect(modal).toBeVisible({ timeout: 20000 })
  const primary = modal.locator(
    'button.custom-modal-ok-btn, button.ant-btn-primary'
  ).last()
  await expect(primary).toBeVisible()
  await primary.click()
}

async function terminalText (page) {
  return page.evaluate(() => (
    window.refs.get('term-' + window.store.activeTabId)?.getTerminalBufferText?.() || ''
  ))
}

async function performanceSummary (page) {
  return page.evaluate(() => window.pre.runGlobalAsync('getPerformanceSummary'))
}

function latestMetric (summary, name) {
  return summary?.metrics?.[name]?.latest
}

function hasRequiredMetrics (summary) {
  return REQUIRED_METRICS.every(name => Number.isFinite(latestMetric(summary, name)))
}

function expectFiniteNonNegative (value) {
  expect(Number.isFinite(value)).toBe(true)
  expect(value).toBeGreaterThanOrEqual(0)
}

function expectWithinPerformanceBudget (name, value) {
  const budget = PERFORMANCE_BUDGETS[name]
  expect(Number.isFinite(budget), `${name} budget must be finite`).toBe(true)
  expect(budget, `${name} budget must be positive`).toBeGreaterThan(0)
  expect(value, `${name} exceeded its ${budget} budget`).toBeLessThanOrEqual(budget)
}

test('enforces startup, terminal, memory and AI performance budgets', async () => {
  const sshServer = await startLocalSshServer()
  const aiServer = await startLocalAiServer({
    firstChunkDelayMs: 40,
    chunkDelayMs: 20
  })
  let run
  let primaryError

  try {
    run = await launchQualityApp(electron)
    const page = run.page

    await page.locator('.aigshell-topbar-action .anticon-plus-circle').click()
    const wizard = page.locator('.quick-connect-wizard')
    await expect(wizard).toBeVisible()
    await wizard.locator('input:not([readonly])').first().fill(sshServer.host)
    await wizard.locator('.quick-connect-port').fill(String(sshServer.port))
    await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
    await wizard.locator('input:not([readonly])').first().fill(sshServer.username)
    await wizard.locator('input[type="password"]').fill(sshServer.password)
    await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
    await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
    await acceptHostKey(page)

    await expect.poll(() => sshServer.state.shellCount, {
      timeout: 20000
    }).toBeGreaterThan(0)
    const terminalInput = page.locator(
      '.session-current .xterm-helper-textarea'
    ).last()
    await expect(terminalInput).toBeAttached()
    await page.evaluate(() => (
      window.refs.get('term-' + window.store.activeTabId)?.term?.focus()
    ))
    await expect(terminalInput).toBeFocused()
    await page.keyboard.type('echo shellpilot-performance-ready', { delay: 5 })
    await page.keyboard.press('Enter')
    await expect.poll(() => terminalText(page), {
      timeout: 20000
    }).toContain('shellpilot-performance-ready')

    const apiToken = 'performance-e2e-token'
    await page.evaluate(({ baseURL, apiToken }) => {
      window.store.aiChatHistory = []
      const profile = {
        id: 'performance-ai',
        nameAI: 'Local Performance Model',
        baseURLAI: baseURL,
        apiPathAI: '/chat/completions',
        modelAI: 'performance-stream-model',
        apiKeyAI: apiToken,
        authHeaderNameAI: 'Authorization: Bearer',
        roleAI: '',
        languageAI: 'Chinese'
      }
      window.store.setConfig({
        activeAIProfileId: profile.id,
        aiProfiles: [profile],
        ...profile
      })
      window.store.handleOpenAIPanel()
    }, { baseURL: aiServer.baseURL, apiToken })

    await expect(page.locator('.ai-chat-container')).toBeVisible()
    await page.locator('.ai-chat-textarea').fill('Return a short local performance response.')
    await page.locator('.ai-chat-textarea').press('Enter')

    await expect.poll(() => aiServer.state.completed, {
      timeout: 30000
    }).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => (
      window.store.aiChatHistory?.at(-1)?.completionStatus || ''
    )), { timeout: 30000 }).toBe('completed')

    await expect.poll(async () => hasRequiredMetrics(
      await performanceSummary(page)
    ), { timeout: 30000 }).toBe(true)

    const summary = await performanceSummary(page)
    for (const name of REQUIRED_METRICS) {
      const value = latestMetric(summary, name)
      expectFiniteNonNegative(value)
      expectWithinPerformanceBudget(name, value)
    }
    expect(latestMetric(summary, 'ai_first_token_ms'))
      .toBeLessThanOrEqual(latestMetric(summary, 'ai_total_ms'))
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (run) {
      await cleanupQualityApp(run.electronApp, run.profileRoot).catch(error => {
        if (!primaryError) throw error
      })
    }
    await aiServer.close().catch(() => {})
    await sshServer.close().catch(() => {})
  }
})
