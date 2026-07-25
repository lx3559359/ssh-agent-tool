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

async function assertRunbookLayout (electronApp, page, viewport) {
  await electronApp.evaluate(({ BrowserWindow }, value) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.webContents.setZoomFactor(1)
    window.setContentSize(
      Math.round(value.width / value.zoom),
      Math.round(value.height / value.zoom)
    )
  }, viewport)
  await page.waitForTimeout(150)
  const layout = await page.locator('.operations-toolkit-workspace').evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const body = element.querySelector('.operations-workspace-body')
    return {
      top: bounds.top,
      left: bounds.left,
      right: bounds.right,
      bottom: bounds.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      bodyOverflow: body ? body.scrollWidth - body.clientWidth : 0
    }
  })
  expect(layout.left).toBeGreaterThanOrEqual(0)
  expect(layout.top).toBeGreaterThanOrEqual(0)
  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth + 1)
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight + 1)
  expect(layout.bodyOverflow).toBeLessThanOrEqual(1)
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
    await expect(workspace.locator('.operations-workspace-tabs')).toContainText('常用操作')
    await expect(workspace.locator('.operations-workspace-tabs')).toContainText('诊断脚本')
    await expect(workspace.locator('.operations-workspace-tabs')).toContainText('安全维护')
    await expect(workspace.locator('.operations-workspace-tabs')).toContainText('脚本中心')
    await expect(workspace.locator('.operations-workspace-tabs')).toContainText('执行记录')
    await expect(workspace.locator('.operations-tool-list button')).toHaveCount(24)
    await expect(workspace.locator('.operations-connection-status')).toContainText('尚未连接 SSH')
    await expect(workspace.getByRole('button', { name: '连接服务器' })).toBeVisible()
    await expect(workspace.getByRole('button', { name: '连接后运行' })).toBeVisible()
    await expect(workspace.locator('.operations-run-actions button')).toBeEnabled()
    await workspace.locator('.operations-run-actions button').click()
    await expect(page.locator('.quick-connect-wizard')).toBeVisible()
    await page.keyboard.press('Escape')

    await workspace.locator('.operations-workspace-tabs').getByText('脚本中心').click()
    await expect(workspace.locator('.operations-script-center')).toBeVisible()
    await expect(workspace.locator('.operations-script-center .operations-tool-list button')).toHaveCount(10)
    await expect(workspace.locator('.operations-script-center .operations-tool-title')).toContainText('服务器综合健康巡检')
    await expect(workspace.locator('.operations-script-steps li')).toHaveCount(5)
    await expect(workspace.locator('.operations-run-actions button')).toContainText('连接后运行')
    await expect(workspace.locator('.operations-run-actions button')).toBeEnabled()
    await expect(workspace.locator('.operations-run-actions')).toContainText('尚未连接 SSH')
    await assertRunbookLayout(run.electronApp, page, {
      width: 1366,
      height: 768,
      zoom: 1.25
    })
    await assertRunbookLayout(run.electronApp, page, {
      width: 1366,
      height: 768,
      zoom: 1.5
    })
    await assertRunbookLayout(run.electronApp, page, {
      width: 1920,
      height: 1080,
      zoom: 1
    })

    await workspace.locator('.operations-workspace-tabs').getByText('常用操作').click()
    await expect(workspace.locator('.qm-wrap-embedded')).toBeVisible()

    await workspace.locator('.operations-workspace-tabs').getByText('安全维护').click()
    await expect(workspace.locator('.operations-maintenance-safety')).toContainText('修改前自动保护')
    await expect(workspace.locator('.operations-maintenance-safety')).toContainText('执行后自动校验')
    await expect(workspace.locator('.operations-maintenance-safety')).toContainText('安全中心一键回滚')
    await expect(workspace.locator('.qm-item')).toHaveCount(11)
    await expect(workspace.locator('.qm-panel-subtitle')).toContainText('共 11 项')
    await expect(workspace.locator('.qm-risk-select')).toHaveCount(0)
    await workspace.getByRole('button', { name: '打开安全中心' }).click()
    await expect(page.locator('.safety-operation-center-modal')).toBeVisible()
    await page.keyboard.press('Escape')

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
