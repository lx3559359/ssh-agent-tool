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

test('records finite non-negative startup, terminal, memory and AI performance baselines', async () => {
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
    const form = page.locator('.setting-wrap #ssh-form')
    await expect(form).toBeVisible()
    await form.locator('#ssh-form_title').fill('ShellPilot Performance Local')
    await form.locator('#ssh-form_host').fill(sshServer.host)
    await form.locator('#ssh-form_port').fill(String(sshServer.port))
    await form.locator('#ssh-form_username').fill(sshServer.username)
    await form.locator('#ssh-form_password').fill(sshServer.password)
    await page.getByTestId('bookmark-save-connect').click()
    await acceptHostKey(page)

    await expect.poll(() => sshServer.state.shellCount, {
      timeout: 20000
    }).toBeGreaterThan(0)
    await expect.poll(() => terminalText(page), {
      timeout: 20000
    }).toContain('ShellPilot E2E ready')

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
      expectFiniteNonNegative(latestMetric(summary, name))
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
