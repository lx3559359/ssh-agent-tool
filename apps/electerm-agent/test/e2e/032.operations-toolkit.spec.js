const { _electron: electron, expect, test } = require('@playwright/test')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')

test.setTimeout(60000)

async function dismissStartupModals (page) {
  const modal = page.locator('.custom-modal-container:visible')
  for (let attempt = 0; attempt < 4 && await modal.count(); attempt += 1) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    if (!await modal.count()) break
    const close = modal.locator('.custom-modal-close:visible').last()
    if (await close.count()) await close.click()
  }
}

test('operations workspace exposes quick actions and readonly diagnostics without a connection', async () => {
  let run
  let primaryError
  try {
    run = await launchQualityApp(electron)
    const page = run.page
    await dismissStartupModals(page)
    await page.evaluate(() => window.store.openOperationsToolkit('diagnostic'))

    const workspace = page.locator('.operations-toolkit-workspace')
    await expect(workspace).toBeVisible()
    await expect(workspace.locator('.operations-workspace-tabs')).toContainText('快捷操作')
    await expect(workspace.locator('.operations-workspace-tabs')).toContainText('诊断脚本')
    await expect(workspace.locator('.operations-workspace-tabs')).toContainText('安全维护')
    await expect(workspace.locator('.operations-workspace-tabs')).toContainText('我的工具')
    await expect(workspace.locator('.operations-workspace-tabs')).toContainText('执行记录')
    await expect(workspace.locator('.operations-tool-list button')).toHaveCount(24)
    await expect(workspace.locator('.operations-connection-status')).toContainText('尚未连接 SSH')
    await expect(workspace.locator('.operations-run-actions button')).toBeDisabled()

    await workspace.locator('.operations-workspace-tabs').getByText('快捷操作').click()
    await expect(workspace.locator('.qm-wrap-embedded')).toBeVisible()

    await workspace.locator('button[aria-label="关闭运维工具"]').click()
    await expect(workspace).toBeHidden()
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
