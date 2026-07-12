const fs = require('fs')
const path = require('path')
const { _electron: electron, test, expect } = require('@playwright/test')
const appOptions = require('./common/app-options')
const delay = require('./common/wait')
const extendClient = require('./common/client-extend')
const { setupSshConnection } = require('./common/common')

test.describe('ShellPilot 服务器状态中心', () => {
  test.setTimeout(90000)

  test('真实 SSH 会话可完成只读扫描并适配紧凑窗口', async () => {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)

    try {
      await delay(4500)
      const statusButton = client.locator('.aigshell-topbar-action').filter({ hasText: '服务器状态' }).first()
      await expect(statusButton).toBeVisible()
      await expect(statusButton).toBeDisabled()

      await setupSshConnection(client, { waitAfterConnect: 5500 })
      await expect(statusButton).toBeEnabled({ timeout: 15000 })
      await statusButton.click()

      const modal = client.locator('.server-status-modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await expect(modal.locator('.server-status-summary')).toBeVisible({ timeout: 30000 })
      await expect(modal).toContainText('未执行任何修改命令')
      await expect(modal).toContainText('刷新检测')
      await expect(modal.locator('.server-status-endpoint span')).not.toHaveText('')
      await expect(modal.locator('.server-status-summary')).not.toContainText('未知')

      const platformTab = modal.getByRole('tab', { name: '平台与服务' })
      await platformTab.click()
      await expect(modal.locator('.server-status-platform:visible').first()).toBeVisible()

      await modal.getByRole('button', { name: /识别规则/ }).click()
      await expect(client.getByText('平台识别规则', { exact: true }).last()).toBeVisible()
      await client.keyboard.press('Escape')

      await client.setViewportSize({ width: 1366, height: 768 })
      const box = await modal.boundingBox()
      expect(box).toBeTruthy()
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(1366)
      expect(box.y + box.height).toBeLessThanOrEqual(768)

      const outputDir = path.resolve(process.cwd(), 'test-results')
      fs.mkdirSync(outputDir, { recursive: true })
      await client.screenshot({ path: path.join(outputDir, 'server-status-center.png') })
    } finally {
      await electronApp.close()
    }
  })
})
