const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { _electron: electron, expect, test } = require('@playwright/test')
const { startLocalAiServer } = require('./common/ai-api')
const { startLocalSshServer } = require('./common/local-ssh-server')
const { createLocalSftpFixture } = require('./common/local-sftp-fixture')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')

test.setTimeout(180000)

async function acceptHostKey (page) {
  const modal = page.locator('.custom-modal-wrap').last()
  await expect(modal).toBeVisible({ timeout: 20000 })
  await modal.locator('button.ant-btn-primary').last().click()
}

async function terminalText (page) {
  return page.evaluate(() => (
    window.refs.get('term-' + window.store.activeTabId)?.getTerminalBufferText?.() || ''
  ))
}

async function startSftpRename (page, sourcePath, targetPath) {
  await page.evaluate(({ sourcePath, targetPath }) => {
    const tabId = window.store.activeTabId
    const entry = window.refs.get('sftp-' + tabId)
    window.__qualityRenameResult = null
    window.__qualityRenameError = ''
    entry.renameRemoteFile({ sourcePath, targetPath, type: 'file' })
      .then(result => { window.__qualityRenameResult = Boolean(result) })
      .catch(error => { window.__qualityRenameError = error?.message || String(error) })
  }, { sourcePath, targetPath })
}

async function readRemoteText (page, remotePath) {
  return page.evaluate(async remotePath => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    const value = await entry.sftp.readFile(remotePath)
    if (typeof value === 'string') return value
    const bytes = value?.type === 'Buffer'
      ? new Uint8Array(value.data)
      : new Uint8Array(value?.buffer || value)
    return new TextDecoder().decode(bytes)
  }, remotePath)
}

async function readRemoteTextOrNull (page, remotePath) {
  try {
    return await readRemoteText(page, remotePath)
  } catch {
    return null
  }
}

async function collectProfileLogs (root) {
  const entries = await fs.promises.readdir(root, { recursive: true, withFileTypes: true })
  const files = entries
    .filter(entry => entry.isFile() && /\.log$/i.test(entry.name))
    .map(entry => path.join(entry.parentPath || entry.path, entry.name))
  const chunks = await Promise.all(files.map(file => fs.promises.readFile(file, 'utf8').catch(() => '')))
  return chunks.join('\n')
}

test('isolated client completes SSH, SFTP, AI, update and rollback quality flows', async () => {
  const fixture = await createLocalSftpFixture()
  const sshServer = await startLocalSshServer({ sftpRoot: fixture.root })
  const aiServer = await startLocalAiServer({ chunkDelayMs: 70, firstChunkDelayMs: 40 })
  let run
  let appClosed = false
  let primaryError

  try {
    run = await launchQualityApp(electron)
    const page = run.page
    const localRoot = path.join(run.profileRoot, 'local-transfer')
    const localBody = 'ShellPilot local quality transfer\n'
    await fs.promises.mkdir(localRoot, { recursive: true })
    await fs.promises.writeFile(path.join(localRoot, 'local-seed.txt'), localBody)

    await page.locator('.aigshell-topbar-action .anticon-plus-circle').click()
    const form = page.locator('.setting-wrap #ssh-form')
    await expect(form).toBeVisible()
    await form.locator('#ssh-form_title').fill('ShellPilot Quality Local')
    await form.locator('#ssh-form_host').fill(sshServer.host)
    await form.locator('#ssh-form_port').fill(String(sshServer.port))
    await form.locator('#ssh-form_username').fill(sshServer.username)
    await form.locator('#ssh-form_password').fill(sshServer.password)
    await form.locator('#ssh-form_startDirectoryLocal').fill(localRoot)
    await form.locator('#ssh-form_startDirectory').fill('/')
    await page.getByTestId('bookmark-save-connect').click()
    await acceptHostKey(page)

    await expect.poll(() => sshServer.state.shellCount, { timeout: 20000 }).toBeGreaterThan(0)
    await expect.poll(() => terminalText(page), { timeout: 20000 }).toContain('ShellPilot E2E ready')
    await page.evaluate(() => window.refs.get('term-' + window.store.activeTabId)?.term?.focus())
    await page.keyboard.type('echo shellpilot-e2e')
    await page.keyboard.press('Enter')
    await expect.poll(() => terminalText(page)).toContain('shellpilot-e2e')
    await page.keyboard.press('Control+C')
    await expect.poll(() => sshServer.state.ctrlCCount).toBeGreaterThan(0)

    await page.locator('.session-current .term-sftp-tabs .type-tab:visible').nth(1).click()
    await expect.poll(() => sshServer.state.sftpSessions, { timeout: 20000 }).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      return Boolean(entry?.sftp)
    })).toBe(true)

    await page.evaluate(async ({ remotePath, body }) => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      await entry.sftp.writeFile(remotePath, body)
    }, { remotePath: '/quality-upload.txt', body: localBody })
    await expect.poll(() => readRemoteText(page, '/quality-upload.txt')).toBe(localBody)
    assertHashEqual(await readRemoteText(page, '/remote-seed.txt'), fixture.fixtureHash)

    await page.evaluate(async () => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      await entry.sftp.writeFile('/rollback-before.txt', 'rollback source\n')
    })
    await startSftpRename(page, '/rollback-before.txt', '/rollback-after.txt')
    const confirm = page.locator('.custom-modal-wrap').last()
    await expect(confirm).toContainText('确认执行', { timeout: 20000 })
    await confirm.locator('button.custom-modal-ok-btn').click()
    await expect.poll(() => page.evaluate(() => ({
      result: window.__qualityRenameResult,
      error: window.__qualityRenameError
    })), { timeout: 30000 }).toEqual({ result: true, error: '' })
    await expect.poll(() => readRemoteText(page, '/rollback-after.txt')).toBe('rollback source\n')

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('shellpilot-open-safety-center')))
    const safetyCenter = page.locator('.safety-operation-center-modal')
    await expect(safetyCenter).toBeVisible({ timeout: 20000 })
    await safetyCenter.getByRole('tab', { name: /可回滚/ }).click()
    await expect(safetyCenter).toContainText('SFTP 重命名')
    await safetyCenter.getByRole('button', { name: '立即回滚' }).first().click()
    const rollbackConfirm = page.locator('.ant-modal-confirm').last()
    await expect(rollbackConfirm).toContainText('确认立即回滚')
    await rollbackConfirm.getByRole('button', { name: '立即回滚' }).click()
    await expect.poll(() => readRemoteTextOrNull(page, '/rollback-before.txt'), { timeout: 30000 }).toBe('rollback source\n')
    await safetyCenter.locator('.ant-modal-close').click()

    const apiToken = 'quality-e2e-token'
    await page.evaluate(({ baseURL, apiToken }) => {
      window.store.aiChatHistory = []
      const profile = {
        id: 'quality-ai',
        nameAI: '本地质量模型',
        baseURLAI: baseURL,
        apiPathAI: '/chat/completions',
        modelAI: 'quality-stream-model',
        apiKeyAI: apiToken,
        authHeaderNameAI: 'Authorization: Bearer',
        roleAI: '',
        languageAI: '简体中文'
      }
      window.store.setConfig({ activeAIProfileId: profile.id, aiProfiles: [profile], ...profile })
      window.store.handleOpenAIPanel()
    }, { baseURL: aiServer.baseURL, apiToken })
    await expect(page.locator('.ai-chat-container')).toBeVisible()

    const requestCount = aiServer.state.requests
    await page.locator('.ai-chat-textarea').fill('请流式输出本地质量验证结果')
    await page.locator('.ai-chat-terminals .anticon-send').click()
    await expect.poll(() => aiServer.state.requests).toBeGreaterThan(requestCount)
    await expect(page.locator('.ai-stop-icon-square').last()).toBeVisible({ timeout: 10000 })
    await page.locator('.ai-stop-icon-square').last().click()
    await expect.poll(() => aiServer.state.aborted, { timeout: 10000 }).toBeGreaterThan(0)

    await page.evaluate(() => {
      Object.assign(window.store.upgradeInfo, {
        showUpdateCenter: true,
        checkingRemoteVersion: false,
        lastCheckStatus: 'current',
        remoteVersion: '0.4.4',
        lastCheckedAt: Date.now(),
        updateMessage: '本地质量测试：当前已经是最新版本',
        shouldUpgrade: false,
        canAutoUpgrade: false,
        upgradeReady: false
      })
      window.dispatchEvent(new CustomEvent('shellpilot-open-update-center'))
    })
    const updateCenter = page.locator('.update-center-modal')
    await expect(updateCenter).toBeVisible()
    await expect(updateCenter).toContainText('当前已经是最新版本')
    await expect(updateCenter).toContainText('自动选择（国内源优先）')
    await expect(updateCenter.getByRole('button', { name: /下载更新|重启并安装/ })).toHaveCount(0)
    await updateCenter.locator('.custom-modal-close').click()

    const metrics = await page.evaluate(() => window.pre.runGlobalAsync('getPerformanceSummary'))
    expect(metrics).toBeTruthy()

    await new Promise(resolve => setTimeout(resolve, 400))
    await run.electronApp.close()
    appClosed = true
    const logs = await collectProfileLogs(run.profileRoot)
    const traceIds = logs.match(/sp-\d{13}-[a-f0-9]{8}/g) || []
    expect(traceIds.length).toBeGreaterThan(1)
    expect(new Set(traceIds).size).toBeLessThan(traceIds.length)
    expect(logs).not.toContain(sshServer.password)
    expect(logs).not.toContain(apiToken)
    expect(logs).not.toContain(localBody.trim())
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (run) {
      await cleanupQualityApp(appClosed ? null : run.electronApp, run.profileRoot).catch(error => {
        if (!primaryError) throw error
      })
    }
    await aiServer.close().catch(() => {})
    await sshServer.close().catch(() => {})
    await fixture.cleanup()
  }
})

function assertHashEqual (content, expectedHash) {
  const hash = crypto.createHash('sha256').update(content).digest('hex')
  expect(hash).toBe(expectedHash)
}
