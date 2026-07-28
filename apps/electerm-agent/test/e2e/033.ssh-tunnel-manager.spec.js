const { _electron: electron, expect, test } = require('@playwright/test')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')

test.setTimeout(90000)

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

async function openTunnelManager (page) {
  await page.getByRole('button', { name: 'SSH 隧道' }).click()
  const modal = page.locator('.ssh-tunnel-modal')
  await expect(modal).toBeVisible()
  return modal
}

async function closeTunnelManager (modal) {
  await modal.locator('.ant-modal-close').click()
  await expect(modal).toBeHidden()
}

async function installFakeSshSession (page) {
  await page.evaluate(() => {
    const tab = {
      id: 'ssh-tunnel-e2e-tab',
      host: 'server.example.test',
      port: 22,
      username: 'root',
      status: 'success',
      title: '隧道测试服务器',
      type: 'ssh',
      batch: 0
    }
    const state = {
      tunnels: [],
      failNext: false
    }
    const pending = new Map()
    window.__sshTunnelE2E = state
    window.et.wsOpened = true
    window.et.commonWs = {
      once: (callback, id) => pending.set(id, callback),
      s: request => {
        const deliver = pending.get(request.id)
        pending.delete(request.id)
        queueMicrotask(() => {
          if (state.failNext) {
            state.failNext = false
            deliver({
              error: {
                name: 'Error',
                code: 'SSH_TUNNEL_E2E_FAILURE',
                message: '模拟隧道 API 失败'
              }
            })
            return
          }
          if (request.action === 'ssh-tunnel-start') {
            const entry = {
              id: request.tunnel.id,
              definition: request.tunnel,
              state: 'running'
            }
            state.tunnels = state.tunnels
              .filter(item => item.id !== entry.id)
              .concat(entry)
            deliver({ data: entry })
            return
          }
          if (request.action === 'ssh-tunnel-stop') {
            state.tunnels = state.tunnels
              .filter(item => item.id !== request.tunnelId)
            deliver({ data: { id: request.tunnelId, state: 'stopped' } })
            return
          }
          if (request.action === 'ssh-tunnel-test') {
            deliver({
              data: {
                id: request.tunnelId,
                ok: true,
                latencyMs: 7
              }
            })
            return
          }
          deliver({ data: state.tunnels })
        })
      }
    }
    window.store.tabs.splice(0, window.store.tabs.length, tab)
    window.store.activeTabId = tab.id
    window.store.activeTabId0 = tab.id
  })
  await page.waitForTimeout(150)
  await page.evaluate(() => {
    const tab = window.store.tabs.find(item => item.id === 'ssh-tunnel-e2e-tab')
    tab.status = 'success'
    window.refs.set('term-' + tab.id, {
      pid: 'ssh-tunnel-e2e-pid',
      isSsh: () => true,
      props: { tab }
    })
  })
}

test('SSH tunnel manager supports disconnected planning and connected lifecycle', async () => {
  let run
  let primaryError
  try {
    run = await launchQualityApp(electron)
    const page = run.page
    await dismissStartupModals(page)

    let modal = await openTunnelManager(page)
    await expect(modal).toContainText('当前未连接 SSH')
    await expect(modal.getByRole('button', { name: '连接 SSH 后启动' })).toBeDisabled()
    await closeTunnelManager(modal)

    await installFakeSshSession(page)
    await expect.poll(() => page.evaluate(() => ({
      activeTabId: window.store.activeTabId,
      tabId: window.store.tabs[0]?.id,
      host: window.store.tabs[0]?.host,
      terminalPid: window.refs.get('term-ssh-tunnel-e2e-tab')?.pid || ''
    }))).toEqual({
      activeTabId: 'ssh-tunnel-e2e-tab',
      tabId: 'ssh-tunnel-e2e-tab',
      host: 'server.example.test',
      terminalPid: 'ssh-tunnel-e2e-pid'
    })
    modal = await openTunnelManager(page)
    await expect(modal).toContainText('root@server.example.test:22')

    await modal.locator('.ssh-tunnel-template-row .ant-select').click()
    await page.getByText('MySQL', { exact: true }).last().click()
    await expect(modal.getByLabel('本机监听端口')).toHaveValue('3307')
    await expect(modal.getByLabel('远程目标端口')).toHaveValue('3306')

    await modal.getByRole('button', { name: '启动隧道' }).click()
    await expect(modal.locator('.ssh-tunnel-running-card')).toHaveCount(1)
    await expect(modal.locator('.ssh-tunnel-running-card')).toContainText('运行中')

    await closeTunnelManager(modal)
    expect(await page.evaluate(() => ({
      hasTab: window.refsTabs.has('tab-ssh-tunnel-e2e-tab'),
      hasTerminal: window.refs.has('term-ssh-tunnel-e2e-tab')
    }))).toEqual({ hasTab: true, hasTerminal: true })

    modal = await openTunnelManager(page)
    await expect(modal.locator('.ssh-tunnel-running-card')).toHaveCount(1)
    await modal.getByRole('button', { name: '停止' }).click()
    await expect(modal.locator('.ssh-tunnel-running-card')).toHaveCount(0)

    await modal.getByLabel('本机监听地址').fill('0.0.0.0')
    await modal.getByRole('button', { name: '启动隧道' }).click()
    const exposureDialog = page.getByRole('dialog', { name: '确认开放监听地址' })
    await expect(exposureDialog).toBeVisible()
    await exposureDialog.locator('.ant-modal-confirm-btns .ant-btn-default').click()

    await page.evaluate(() => {
      window.__sshTunnelE2E.failNext = true
    })
    const failureNotice = page.getByText('模拟隧道 API 失败')
      .waitFor({ state: 'visible', timeout: 10000 })
    await modal.getByRole('button', { name: '刷新状态' }).click()
    await failureNotice
    await expect(modal.getByRole('button', { name: '刷新状态' })).toBeEnabled()
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
