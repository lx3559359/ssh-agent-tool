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
      failNext: false,
      portConflictNext: false,
      testScenario: 'passed'
    }
    const layeredTestResult = (scenario, tunnelId) => {
      const checkedAt = Date.now()
      if (scenario === 'prohibited') {
        return {
          id: tunnelId,
          ok: false,
          verdict: 'limited',
          summary: 'SSH 服务器禁止端口转发',
          checkedAt,
          stages: [
            { id: 'local-listener', status: 'passed', code: 'SSH_TUNNEL_LOCAL_LISTENER_READY', message: '本机监听正常' },
            { id: 'ssh-forwarding', status: 'limited', code: 'SSH_TUNNEL_FORWARDING_PROHIBITED', message: 'SSH 服务器禁止端口转发' },
            { id: 'target-service', status: 'unverified', code: 'SSH_TUNNEL_STAGE_NOT_REACHED', message: '尚未检测目标服务' }
          ]
        }
      }
      if (scenario === 'refused') {
        return {
          id: tunnelId,
          ok: false,
          verdict: 'failed',
          summary: '目标服务拒绝连接',
          checkedAt,
          stages: [
            { id: 'local-listener', status: 'passed', code: 'SSH_TUNNEL_LOCAL_LISTENER_READY', message: '本机监听正常' },
            { id: 'ssh-forwarding', status: 'passed', code: 'SSH_TUNNEL_FORWARDING_READY', message: 'SSH 转发正常' },
            { id: 'target-service', status: 'failed', code: 'SSH_TUNNEL_DESTINATION_REFUSED', message: '目标服务拒绝连接' }
          ]
        }
      }
      if (scenario === 'unverified') {
        return {
          id: tunnelId,
          ok: false,
          verdict: 'unverified',
          summary: '尚未通过真实流量验证',
          checkedAt,
          stages: [
            { id: 'local-listener', status: 'passed', code: 'SSH_TUNNEL_LOCAL_LISTENER_READY', message: '本机监听正常' },
            { id: 'ssh-forwarding', status: 'passed', code: 'SSH_TUNNEL_FORWARDING_READY', message: 'SSH 转发正常' },
            { id: 'proxy-traffic', status: 'unverified', code: 'SSH_TUNNEL_PROXY_TRAFFIC_UNVERIFIED', message: '尚未通过真实流量验证' }
          ]
        }
      }
      return {
        id: tunnelId,
        ok: true,
        verdict: 'passed',
        summary: '三层检测全部通过',
        checkedAt,
        stages: [
          { id: 'local-listener', status: 'passed', code: 'SSH_TUNNEL_LOCAL_LISTENER_READY', message: '本机监听正常' },
          { id: 'ssh-forwarding', status: 'passed', code: 'SSH_TUNNEL_FORWARDING_READY', message: 'SSH 转发正常' },
          { id: 'target-service', status: 'passed', code: 'SSH_TUNNEL_TARGET_SERVICE_READY', message: '目标服务正常' }
        ]
      }
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
          if (state.portConflictNext && request.action === 'ssh-tunnel-start') {
            state.portConflictNext = false
            deliver({
              error: {
                name: 'Error',
                code: 'SSH_TUNNEL_PORT_IN_USE',
                message: '本地端口 3307 已被占用',
                details: {
                  requestedPort: 3307,
                  suggestedPort: 3308,
                  host: '127.0.0.1'
                }
              }
            })
            return
          }
          if (request.action === 'ssh-tunnel-start') {
            const entry = {
              id: request.tunnel.id,
              definition: request.tunnel,
              state: 'running',
              testState: 'unverified',
              lastTest: null
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
            const result = layeredTestResult(state.testScenario, request.tunnelId)
            state.tunnels = state.tunnels.map(entry => {
              if (entry.id !== request.tunnelId) return entry
              return {
                ...entry,
                testState: result.verdict,
                lastTestAt: result.checkedAt,
                lastTest: result
              }
            })
            deliver({ data: result })
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

    await page.evaluate(() => {
      window.__sshTunnelE2E.portConflictNext = true
    })
    await modal.getByRole('button', { name: '启动隧道' }).click()
    await expect(modal.locator('.ssh-tunnel-port-conflict')).toContainText('127.0.0.1:3307 当前无法监听')
    await modal.getByRole('button', { name: '改用 3308' }).click()
    await expect(modal.getByLabel('本机监听端口')).toHaveValue('3308')
    await expect(modal.locator('.ssh-tunnel-running-card')).toHaveCount(0)
    await modal.getByRole('button', { name: '启动隧道' }).click()
    await expect(modal.locator('.ssh-tunnel-running-card')).toHaveCount(1)
    await modal.getByRole('button', { name: '停止' }).click()

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

test('SSH tunnel manager explains HTTPS, SOCKS5, remote access, and policy failures', async () => {
  let run
  let primaryError
  try {
    run = await launchQualityApp(electron)
    const page = run.page
    await dismissStartupModals(page)
    await installFakeSshSession(page)

    const modal = await openTunnelManager(page)
    await modal.locator('.ssh-tunnel-template-row .ant-select').click()
    await page.getByText('HTTPS', { exact: true }).last().click()
    await modal.getByLabel('本机监听端口').fill('16060')
    await expect(modal.getByLabel('本机监听端口')).toHaveValue('16060')

    await modal.getByRole('button', { name: '启动隧道' }).click()
    let card = modal.locator('.ssh-tunnel-running-card')
    await expect(card).toHaveCount(1)

    await page.evaluate(() => {
      window.__sshTunnelE2E.testScenario = 'passed'
    })
    await card.getByRole('button', { name: '测试' }).click()
    await expect(card).toContainText('https://127.0.0.1:16060')
    await expect(card).toContainText('无需配置浏览器代理')
    await expect(card.locator('.ssh-tunnel-availability')).toHaveText('可用')

    await page.evaluate(() => {
      window.__sshTunnelE2E.testScenario = 'prohibited'
    })
    await card.getByRole('button', { name: '测试' }).click()
    card = modal.locator('.ssh-tunnel-running-card')
    await expect(card).toContainText('SSH_TUNNEL_FORWARDING_PROHIBITED')
    await expect(card).toContainText('SSH 服务器禁止端口转发')
    await expect(card).toContainText('尚未检测目标服务')
    await expect(card).not.toContainText('最近测试正常')
    await expect(card.locator('.ssh-tunnel-availability')).toHaveText('受限')
    await expect(card.locator('.ssh-tunnel-runtime-lifecycle')).toHaveText('运行中')
    await expect(card.getByRole('button', { name: '停止' })).toBeVisible()

    await card.getByRole('button', { name: '查看完整修复说明' }).click()
    let guide = page.locator('.ssh-tunnel-guide-modal')
    await expect(guide).toBeVisible()
    await expect(guide).toContainText('AllowTcpForwarding')
    await expect(guide).toContainText('PermitOpen')
    await expect(guide).toContainText(/ShellPilot.*不会.*服务器配置/)
    await guide.locator('.ant-modal-close').click()
    await expect(guide).toBeHidden()

    await card.getByRole('button', { name: '停止' }).click()
    await expect(modal.locator('.ssh-tunnel-running-card')).toHaveCount(0)

    await modal.getByRole('button', { name: 'SOCKS5 动态代理' }).click()
    await modal.getByLabel('本机监听端口').fill('1080')
    await expect(modal.getByLabel('本机监听端口')).toHaveValue('1080')
    await modal.getByRole('button', { name: '启动隧道' }).click()
    card = modal.locator('.ssh-tunnel-running-card')
    await expect(card).toContainText(/SOCKS5[\s\S]*127\.0\.0\.1:1080/)
    await expect(card).toContainText('需要在浏览器或应用中设置 SOCKS5 代理')

    await card.getByRole('button', { name: '浏览器 SOCKS5 设置' }).click()
    guide = page.locator('.ssh-tunnel-guide-modal')
    await expect(guide).toBeVisible()
    await expect(guide).toContainText('浏览器 SOCKS5 设置')
    await expect(guide).toContainText('Firefox')
    await expect(guide).toContainText('Chrome')
    await expect(guide).toContainText('Edge')
    await expect(guide).toContainText('--proxy-server="socks5://127.0.0.1:1080"')
    await guide.locator('.ant-modal-close').click()
    await expect(guide).toBeHidden()

    await card.getByRole('button', { name: '停止' }).click()
    await expect(modal.locator('.ssh-tunnel-running-card')).toHaveCount(0)

    await modal.getByRole('button', { name: '远程转发' }).click()
    await modal.getByLabel('本机目标端口').fill('3000')
    await modal.getByLabel('远程监听端口').fill('19090')
    await modal.getByRole('button', { name: '启动隧道' }).click()
    card = modal.locator('.ssh-tunnel-running-card')
    await expect(card).toContainText('请求的服务器监听地址')
    await expect(card).toContainText('127.0.0.1:19090')
    await expect(card).toContainText('GatewayPorts')
    await expect(card).toContainText(/必须.*服务器.*验证/)
    await expect(card).not.toContainText('当前监听所有网络接口')

    await card.getByRole('button', { name: '远程转发安全' }).click()
    guide = page.locator('.ssh-tunnel-guide-modal')
    await expect(guide).toBeVisible()
    await expect(guide).toContainText('请求的服务器监听地址')
    await expect(guide).toContainText(/GatewayPorts.*有效配置.*防火墙/s)
    await guide.locator('.ant-modal-close').click()
    await expect(guide).toBeHidden()

    await card.getByRole('button', { name: '停止' }).click()
    await expect(modal.locator('.ssh-tunnel-running-card')).toHaveCount(0)
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
