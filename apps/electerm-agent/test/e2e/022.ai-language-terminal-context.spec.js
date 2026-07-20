const { _electron: electron, expect, test } = require('@playwright/test')
const {
  closeQualityRun,
  launchQualityApp
} = require('./common/quality-e2e-app')

test('English AI copy and the xterm helper use the terminal context menu', async () => {
  let run
  let primaryError

  try {
    run = await launchQualityApp(electron)
    const { page } = run

    await page.evaluate(() => {
      window.store.previewLanguage = 'en_us'
      window.store.upgradeInfo.showUpgradeModal = false
      window.store.handleOpenAIPanel()
    })

    const aiPanel = page.locator('.right-side-panel-content-ai')
    await expect(aiPanel.locator('.ai-chat-container')).toBeVisible({ timeout: 20000 })
    await expect(aiPanel.locator('.ai-chat-textarea')).toHaveAttribute(
      'placeholder',
      'Ask a question, or let Agent analyze the current SSH terminal output...'
    )
    await expect(aiPanel.locator('.send-to-ai-icon')).toHaveAttribute(
      'title',
      'Press Enter to send; Shift+Enter for a new line'
    )
    await expect(aiPanel.locator('.clear-ai-icon')).toHaveAttribute(
      'title',
      'Clear AI conversation history'
    )

    const terminalInput = page.locator('.term-wrap:visible .xterm-helper-textarea').last()
    await terminalInput.waitFor({ state: 'attached', timeout: 20000 })
    await terminalInput.evaluate(element => {
      const terminal = element.closest('.term-wrap')
      const rect = terminal.getBoundingClientRect()
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.left + 80,
        clientY: rect.top + 80
      }))
    })

    const terminalMenu = page.locator('.shellpilot-context-menu.ant-dropdown:visible').last()
    await expect(terminalMenu).toBeVisible()
    await expect(terminalMenu).toContainText('Analyze Current Terminal with AI')
    expect(await terminalMenu.locator('[role="menuitem"]').count()).toBeGreaterThan(10)
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    await closeQualityRun(run, primaryError)
  }
})
