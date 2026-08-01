const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { _electron: electron, test, expect } = require('@playwright/test')
const delay = require('./common/wait')
const { setupSshConnection } = require('./common/common')
const { hasRealServerCredentials } = require('./common/env')
const { startLocalSshServer } = require('./common/local-ssh-server')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')

const localProbeOutputs = {
  system: `__OS_RELEASE__
NAME="Ubuntu"
VERSION_ID="24.04"
PRETTY_NAME="Ubuntu 24.04 LTS"
ID=ubuntu
ID_LIKE=debian
__HOSTNAME__
shellpilot-audit
__KERNEL__
6.8.0-audit
__CPU_CORES__
4
__UPTIME_SECONDS__
12345.67
__INIT__
systemd
`,
  resources: `__LOAD__
0.10 0.08 0.05 1/100 1234
__MEMINFO__
MemTotal:       8032000 kB
MemAvailable:   6024000 kB
SwapTotal:      2097148 kB
SwapFree:       2097148 kB
__FILESYSTEMS__
Filesystem 1-blocks Used Available Capacity Mounted on
/dev/vda1 53687091200 10737418240 42949672960 20% /
__INODES__
Filesystem Inodes IUsed IFree IUse% Mounted on
/dev/vda1 3276800 32768 3244032 1% /
__PROCESSES__
100 0.1 0.2 nginx
`,
  services: `Id=nginx.service
Description=A high performance web server
LoadState=loaded
ActiveState=active
SubState=running
FragmentPath=/usr/lib/systemd/system/nginx.service
WorkingDirectory=/var/www
`,
  network: `__LINKS__
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP mode DEFAULT
__ADDRESSES__
2: eth0    inet 192.0.2.8/24 brd 192.0.2.255 scope global eth0
__ROUTES__
default via 192.0.2.1 dev eth0 proto dhcp src 192.0.2.8 metric 100
__DNS__
nameserver 192.0.2.53
__PORTS__
tcp LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=100,fd=6))
`,
  firewall: `__FIREWALLD__
not running
__UFW__
Status: inactive
__NFTABLES__
__IPTABLES__
-P INPUT ACCEPT
-P FORWARD ACCEPT
-P OUTPUT ACCEPT
__SELINUX__
Disabled
`,
  security: `__SELINUX__
Disabled
__APPARMOR__
apparmor module is loaded
__USERS__
audit pts/0 2026-08-01 10:00 (192.0.2.20)
__FAILED_LOGINS__
`,
  containers: `__DOCKER__
web-1\tweb\tUp 2 hours\t0.0.0.0:80->80/tcp\tnginx:stable\taudit
__PODMAN__
`
}

async function startLocalStatusServer () {
  const probesUrl = pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/server-status/server-status-probes.js'
  )).href
  const { serverStatusProbes } = await import(probesUrl)
  const execResults = Object.fromEntries(serverStatusProbes.map(probe => [
    probe.command,
    [localProbeOutputs[probe.id], 0]
  ]))
  return startLocalSshServer({ execResults })
}

async function connectLocalStatusServer (client, sshServer) {
  await client.locator('.aigshell-topbar-action[data-action-key="new"]').click()
  const wizard = client.locator('.quick-connect-wizard')
  await expect(wizard).toBeVisible()
  await wizard.locator('input:not([readonly])').first().fill(sshServer.host)
  await wizard.locator('.quick-connect-port').fill(String(sshServer.port))
  await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
  await wizard.locator('input:not([readonly])').first().fill(sshServer.username)
  await wizard.locator('input[type="password"]').fill(sshServer.password)
  await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
  await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
  const hostKeyModal = client.locator('.custom-modal-wrap').last()
  await expect(hostKeyModal).toBeVisible({ timeout: 20000 })
  await hostKeyModal.locator('button.ant-btn-primary').last().click()
  await expect.poll(() => sshServer.state.shellCount, { timeout: 20000 })
    .toBeGreaterThan(0)
}

test.describe('ShellPilot 服务器状态中心', () => {
  test.setTimeout(90000)

  test('SSH 会话可完成只读扫描并适配紧凑窗口', async () => {
    const sshServer = hasRealServerCredentials
      ? null
      : await startLocalStatusServer()
    let run
    let primaryError

    try {
      run = await launchQualityApp(electron)
      const client = run.page
      await delay(4500)
      const statusButton = client.locator('.aigshell-topbar-action').filter({ hasText: '服务器状态' }).first()
      await expect(statusButton).toBeVisible()
      await expect(statusButton).toBeDisabled()

      if (sshServer) {
        await connectLocalStatusServer(client, sshServer)
      } else {
        await setupSshConnection(client, { waitAfterConnect: 5500 })
      }
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
    } catch (error) {
      primaryError = error
      throw error
    } finally {
      if (run) {
        await cleanupQualityApp(run.electronApp, run.profileRoot).catch(error => {
          if (!primaryError) throw error
        })
      }
      await sshServer?.close().catch(() => {})
    }
  })
})
