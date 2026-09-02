const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { _electron: electron, expect, test } = require('@playwright/test')
const { startLocalAiServer } = require('./common/ai-api')
const { startLocalSshServer } = require('./common/local-ssh-server')
const { createLocalSftpFixture } = require('./common/local-sftp-fixture')
const { setLocalSftpPath } = require('./common/common')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')

test.setTimeout(240000)

async function acceptHostKey (page) {
  const modal = page.locator('.custom-modal-wrap').last()
  await expect(modal).toBeVisible({ timeout: 20000 })
  await expect(modal).toContainText(/主机指纹|Host fingerprint/i)
  await expect(modal.locator('.ssh-host-key-copy-row')).toHaveCount(2)
  await expect(modal.locator('code').filter({ hasText: 'SHA256:' })).toHaveCount(1)
  await expect(modal.locator('.terminal-interactive-cancel')).toBeFocused()
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

async function pathExists (targetPath) {
  try {
    await fs.promises.stat(targetPath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function lockWindowsFile (targetPath) {
  if (process.platform !== 'win32') return async () => {}
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const lockScript = [
    '$stream = [System.IO.File]::Open($env:SHELLPILOT_E2E_LOCK_FILE, "Open", "ReadWrite", "None")',
    '[Console]::Out.WriteLine("READY")',
    '[Console]::Out.Flush()',
    '[Console]::In.ReadLine() | Out-Null',
    '$stream.Dispose()'
  ].join('; ')
  const child = spawn(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    lockScript
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      SHELLPILOT_E2E_LOCK_FILE: targetPath
    }
  })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Timed out locking ${targetPath}: ${stderr}`))
    }, 10000)
    const onData = chunk => {
      if (!chunk.toString().includes('READY')) return
      clearTimeout(timeout)
      child.stdout.off('data', onData)
      resolve()
    }
    child.stdout.on('data', onData)
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', code => {
      if (code === 0) return
      clearTimeout(timeout)
      reject(new Error(`File lock helper exited with ${code}: ${stderr}`))
    })
  })
  let released = false
  return async () => {
    if (released) return
    released = true
    if (child.exitCode !== null) return
    const exited = new Promise(resolve => child.once('exit', resolve))
    if (!child.stdin.destroyed) child.stdin.end('\n')
    await Promise.race([
      exited,
      new Promise(resolve => setTimeout(resolve, 5000))
    ])
    if (child.exitCode === null) child.kill()
  }
}

async function waitForTransferComplete (page, transferId) {
  await expect.poll(() => page.evaluate(id => (
    window.store.fileTransfers.some(item => item.id === id)
  ), transferId), { timeout: 30000 }).toBe(false)
}

async function expectVisibleTransferProgress (
  page,
  expectedPath,
  expectedDirection,
  { allowIndeterminate = false } = {}
) {
  const dock = page.locator('.sftp-transfer-progress-dock')
  await expect(dock).toBeVisible({ timeout: 20000 })
  await expect(dock).toContainText(expectedPath)
  const toggle = dock.locator('.sftp-transfer-dock-toggle')
  if (await toggle.getAttribute('aria-expanded') !== 'true') {
    await toggle.click()
  }
  const details = dock.locator('.sftp-transfer-dock-details')
  await expect(details.locator([
    '.sftp-transport',
    '.sftp-transfer-dock-terminal-item'
  ].join(', '))).toBeVisible()
  await expect(dock).toContainText(expectedDirection)
  const progress = dock.locator('.sftp-transfer-dock-progress')
  let transferSnapshot
  try {
    await expect.poll(async () => {
      transferSnapshot = await page.evaluate(pathPart => {
        const transfer = window.store.fileTransfers.find(item => (
          String(item.fromPath || '').includes(pathPart) ||
          String(item.toPath || '').includes(pathPart)
        ))
        return {
          transfer: transfer
            ? {
                id: transfer.id,
                inited: transfer.inited,
                status: transfer.status,
                transferred: transfer.transferred,
                total: transfer.total,
                percent: transfer.percent,
                error: transfer.error
              }
            : null,
          history: window.store.transferHistory.slice(-2).map(item => ({
            id: item.id,
            status: item.status,
            error: item.error
          }))
        }
      }, expectedPath)
      if (await details.locator('.sftp-transfer-dock-terminal-item').count() > 0) {
        return 100
      }
      const value = Number(await progress.getAttribute('aria-valuenow') || 0)
      if (value > 0) return value
      if (allowIndeterminate && await progress.evaluate(node => (
        node.classList.contains('sftp-transfer-dock-progress-indeterminate')
      ))) return 1
      return 0
    }, {
      timeout: 20000,
      intervals: [10, 20, 50, 100]
    }).toBeGreaterThan(0)
  } catch (error) {
    error.message += `\nTransfer snapshot: ${JSON.stringify(transferSnapshot)}`
    throw error
  }
  return dock
}

async function expectDockInsideViewport (dock) {
  const geometry = await dock.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }
  })
  expect(geometry.left).toBeGreaterThanOrEqual(0)
  expect(geometry.top).toBeGreaterThanOrEqual(0)
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth)
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight)
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
  const sshServer = await startLocalSshServer({
    sftpRoot: fixture.root,
    sftpFixture: fixture
  })
  const aiServer = await startLocalAiServer({ chunkDelayMs: 70, firstChunkDelayMs: 40 })
  let run
  let appClosed = false
  let primaryError
  let releaseLockedFile = async () => {}

  try {
    run = await launchQualityApp(electron)
    const page = run.page
    const localRoot = path.join(run.profileRoot, 'local-transfer')
    const localBody = 'ShellPilot local quality transfer\n'
    const largeUpload = Buffer.alloc(16 * 1024 * 1024, 0x5a)
    const largeDownload = Buffer.alloc(16 * 1024 * 1024, 0xa5)
    const safeDeleteBody = Buffer.alloc(32 * 1024 * 1024, 0x6d)
    const safeDeleteSamples = []
    const uploadPath = path.join(localRoot, 'quality-progress-upload.bin')
    const downloadPath = path.join(localRoot, 'quality-progress-download.bin')
    await fs.promises.mkdir(localRoot, { recursive: true })
    await fs.promises.writeFile(path.join(localRoot, 'local-seed.txt'), localBody)
    await fs.promises.writeFile(uploadPath, largeUpload)
    await fs.promises.writeFile(fixture.resolve('/quality-progress-download.bin'), largeDownload)
    const lockedUploadName = 'quality-locked-upload'
    const lockedUploadPath = path.join(localRoot, lockedUploadName)
    const lockedFilePath = path.join(lockedUploadPath, 'locked.dat')
    await fs.promises.mkdir(lockedUploadPath, { recursive: true })
    await fs.promises.writeFile(path.join(lockedUploadPath, 'normal.txt'), largeUpload)
    await fs.promises.writeFile(lockedFilePath, 'locked upload\n')
    releaseLockedFile = await lockWindowsFile(lockedFilePath)

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

    await expect.poll(() => sshServer.state.shellCount, { timeout: 20000 }).toBeGreaterThan(0)
    const terminalInput = page.locator('.session-current .xterm-helper-textarea')
    await expect(terminalInput).toBeVisible({ timeout: 20000 })
    await expect.poll(() => page.evaluate(() => Boolean(
      window.refs.get('term-' + window.store.activeTabId)?.term
    )), { timeout: 20000 }).toBe(true)
    await page.evaluate(() => window.refs.get('term-' + window.store.activeTabId)?.term?.focus())
    await expect(terminalInput).toBeFocused()
    await terminalInput.pressSequentially('echo shellpilot-e2e', { delay: 20 })
    await page.keyboard.press('Enter')
    await expect.poll(() => sshServer.state.commands, { timeout: 20000 })
      .toContain('echo shellpilot-e2e')
    await expect.poll(() => terminalText(page), { timeout: 20000 }).toContain('shellpilot-e2e')
    await page.keyboard.press('Control+C')
    await expect.poll(() => sshServer.state.ctrlCCount).toBeGreaterThan(0)

    const quickCommandResult = await page.evaluate(async () => {
      const term = window.refs.get('term-' + window.store.activeTabId)
      const run = async command => {
        const started = await term.runSafetyCommand(command, {
          source: 'quick-command',
          title: 'Quality quick command regression'
        })
        const completion = await started.waitForCompletion({ timeoutMs: 15000 })
        return {
          submittedCommand: started.execution?.submittedCommand,
          exitCode: completion.exitCode
        }
      }
      return {
        first: await run('uname -s && id -un'),
        second: await run('pwd')
      }
    })
    expect(quickCommandResult.first.submittedCommand).toMatch(/^sh -c /)
    expect(quickCommandResult.first.exitCode).toBe(0)
    expect(quickCommandResult.second.submittedCommand).toBe('pwd')
    expect(quickCommandResult.second.exitCode).toBe(0)

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('shellpilot-open-safety-center')))
    const quickCommandSafetyCenter = page.locator('.safety-operation-center-modal')
    await expect(quickCommandSafetyCenter).toBeVisible({ timeout: 20000 })
    await expect(quickCommandSafetyCenter.locator('.safety-center-summary span').first())
      .toHaveText(/执行中\s+0/)
    await quickCommandSafetyCenter.locator('.safety-center-tabs .ant-tabs-tab').nth(2).click()
    const quickCommandHistory = quickCommandSafetyCenter.locator('.safety-center-record-list')
    await expect(quickCommandHistory).toContainText('uname -s && id -un')
    await expect(quickCommandHistory).toContainText('pwd')
    await expect(quickCommandHistory).toContainText('已保留')
    await quickCommandSafetyCenter.locator('.ant-modal-close').click()

    await page.locator('.session-current .term-sftp-tabs .type-tab:visible').nth(1).click()
    await expect.poll(() => sshServer.state.sftpSessions, { timeout: 20000 }).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      return Boolean(entry?.sftp)
    })).toBe(true)

    await page.evaluate(async remotePath => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      const oldPath = entry.state.remotePath
      await new Promise(resolve => entry.setState({
        remotePath,
        remotePathTemp: remotePath
      }, resolve))
      await entry.remoteList(false, remotePath, oldPath, { rethrow: true })
    }, '/')

    await page.evaluate(async ({ remotePath, body }) => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      await entry.sftp.writeFile(remotePath, body)
    }, { remotePath: '/quality-upload.txt', body: localBody })
    await expect.poll(() => readRemoteText(page, '/quality-upload.txt')).toBe(localBody)
    assertHashEqual(await readRemoteText(page, '/remote-seed.txt'), fixture.fixtureHash)

    const remoteSeed = page.locator(
      '.session-current .file-list.remote .sftp-item[title="remote-seed.txt"]'
    )
    await expect(remoteSeed).toBeVisible({ timeout: 20000 })
    await remoteSeed.focus()
    await page.keyboard.press('Shift+F10')
    const keyboardMenu = page.locator('.ant-dropdown:visible').last()
    await expect(keyboardMenu).toBeVisible()
    await expect(keyboardMenu.getByText(/安全删除.*可恢复|Safe Delete.*Recoverable/i)).toBeVisible()
    await expect(keyboardMenu.getByText(/快速删除.*不可恢复|Fast Delete.*Permanent/i)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(remoteSeed).toBeFocused()

    const upload = await page.evaluate(({ localPath, remotePath }) => (
      window.store.mcpSftpUpload({
        tabId: window.store.activeTabId,
        localPath,
        remotePath
      })
    ), {
      localPath: uploadPath,
      remotePath: '/quality-progress-upload.bin'
    })
    const uploadDock = await expectVisibleTransferProgress(
      page,
      'quality-progress-upload.bin',
      /本地|Local/
    )
    await expectDockInsideViewport(uploadDock)
    await waitForTransferComplete(page, upload.transferId)
    expect(await fixture.hashFile('/quality-progress-upload.bin'))
      .toBe(crypto.createHash('sha256').update(largeUpload).digest('hex'))

    const originalBounds = await run.electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0].getBounds()
    ))
    let download
    try {
      await run.electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        const bounds = window.getBounds()
        window.setBounds({ ...bounds, height: 820 })
      })
      download = await page.evaluate(({ remotePath, localPath }) => (
        window.store.mcpSftpDownload({
          tabId: window.store.activeTabId,
          remotePath,
          localPath
        })
      ), {
        remotePath: '/quality-progress-download.bin',
        localPath: downloadPath
      })
      const downloadDock = await expectVisibleTransferProgress(
        page,
        'quality-progress-download.bin',
        /远程|Remote/
      )
      await expectDockInsideViewport(downloadDock)
      await waitForTransferComplete(page, download.transferId)
    } finally {
      await run.electronApp.evaluate(({ BrowserWindow }, bounds) => {
        BrowserWindow.getAllWindows()[0].setBounds(bounds)
      }, originalBounds)
    }
    expect(crypto.createHash('sha256').update(await fs.promises.readFile(downloadPath)).digest('hex'))
      .toBe(crypto.createHash('sha256').update(largeDownload).digest('hex'))

    if (process.platform === 'win32') {
      await setLocalSftpPath(page, localRoot)
      const lockedUploadRow = page.locator(
        `.session-current .file-list.local .sftp-item[title="${lockedUploadName}"]`
      )
      await expect(lockedUploadRow).toBeVisible({ timeout: 20000 })
      await lockedUploadRow.click({ button: 'right' })
      const uploadMenu = page.locator('.ant-dropdown:visible').last()
      await expect(uploadMenu).toBeVisible()
      await uploadMenu.locator('.anticon-cloud-upload').click()

      const lockedDock = await expectVisibleTransferProgress(
        page,
        lockedUploadName,
        /本地|Local/,
        { allowIndeterminate: true }
      )
      await expect(lockedDock).toHaveClass(
        /sftp-transfer-progress-dock-partial/,
        { timeout: 30000 }
      )
      await expect(lockedDock).toContainText(/成功\s*1.*跳过\s*1|1 successful.*1 skipped/i)
      await expect(lockedDock).not.toContainText(/总量计算中|Calculating total|\/\s*0 B/i)
      await expect(lockedDock.getByRole('button', {
        name: /关闭传输结果|Dismiss transfer result/i
      })).toBeVisible()
      await expect.poll(() => pathExists(
        fixture.resolve(`/${lockedUploadName}/normal.txt`)
      ), { timeout: 30000 }).toBe(true)
      await expect.poll(() => pathExists(
        fixture.resolve(`/${lockedUploadName}/locked.dat`)
      )).toBe(false)
      await expect(page.locator('.notification.error').filter({ hasText: /EBUSY/i }))
        .toHaveCount(0)
      await releaseLockedFile()
      releaseLockedFile = async () => {}
    }

    const fastDeleteName = 'quality-fast-delete'
    const fastDeletePath = fixture.resolve(`/${fastDeleteName}`)
    await fs.promises.mkdir(fastDeletePath, { recursive: true })
    await Promise.all(Array.from({ length: 5 }, (_, index) => (
      fs.promises.writeFile(path.join(fastDeletePath, `item-${index}.txt`), `item ${index}\n`)
    )))
    await page.evaluate(async () => {
      await window.refs.get('sftp-' + window.store.activeTabId).remoteList()
    })
    const fastDeleteRow = page.locator(
      `.session-current .file-list.remote .sftp-item[title="${fastDeleteName}"]`
    )
    await expect(fastDeleteRow).toBeVisible({ timeout: 20000 })
    await fastDeleteRow.click({ button: 'right' })
    const fastDeleteMenu = page.locator('.ant-dropdown:visible').last()
    await fastDeleteMenu.getByText(/快速删除.*不可恢复|Fast Delete.*Permanent/i).click()
    const fastDeleteConfirm = page.locator('.custom-modal-wrap:visible').last()
    await expect(fastDeleteConfirm).toContainText(/不会创建恢复快照|No recovery snapshot/)
    await expect(page.locator('.custom-modal-wrap:visible')).toHaveCount(1)
    const permanentDeleteButton = fastDeleteConfirm.getByRole('button', {
      name: /永久删除|Delete Permanently/i
    })
    await expect(permanentDeleteButton).toHaveClass(/is-danger/)
    await permanentDeleteButton.click()
    await expect.poll(() => pathExists(fastDeletePath), { timeout: 30000 }).toBe(false)
    await expect(fastDeleteRow).toHaveCount(0, { timeout: 30000 })
    await expect(page.locator('.ant-dropdown:visible')).toHaveCount(0, { timeout: 5000 })

    let lastSafeDeleteName = ''
    for (let index = 0; index < 3; index += 1) {
      const safeDeleteName = `quality-safe-delete-${index}.bin`
      lastSafeDeleteName = safeDeleteName
      const safeDeletePath = fixture.resolve(`/${safeDeleteName}`)
      await fs.promises.writeFile(safeDeletePath, safeDeleteBody)
      await page.evaluate(async () => {
        await window.refs.get('sftp-' + window.store.activeTabId).remoteList()
      })
      const safeDeleteRow = page.locator(
        `.session-current .file-list.remote .sftp-item[title="${safeDeleteName}"]`
      )
      await expect(safeDeleteRow).toBeVisible({ timeout: 20000 })
      await safeDeleteRow.click({ button: 'right' })
      const safeDeleteMenu = page.locator('.ant-dropdown:visible').last()
      await expect(safeDeleteMenu).toBeVisible()
      const safeDeleteConfirm = page.locator('.custom-modal-wrap:visible').last()
      let dialogVisibleAt = 0
      const clickedAt = Date.now()
      await Promise.all([
        safeDeleteMenu
          .getByText(/安全删除.*可恢复|Safe Delete.*Recoverable/i)
          .click({ force: true }),
        expect(safeDeleteConfirm).toBeVisible({ timeout: 1000 }).then(() => {
          dialogVisibleAt = Date.now()
        })
      ])
      expect(dialogVisibleAt - clickedAt).toBeLessThan(150)
      await expect(safeDeleteConfirm.locator('.custom-modal-ok-btn')).toBeDisabled()
      await expect(safeDeleteConfirm.locator('.sftp-safe-delete-progress')).toBeVisible()
      await expect(safeDeleteConfirm).toContainText(
        /扫描原文件|复制恢复快照|验证恢复快照|Scanning source|Copying recovery snapshot|Verifying recovery snapshot/i
      )
      await expect(safeDeleteConfirm).toContainText(
        /恢复快照已验证|Recovery snapshots verified/i,
        { timeout: 30000 }
      )
      const readyAt = Date.now()
      await expect(safeDeleteConfirm.locator('.custom-modal-ok-btn')).toBeEnabled()
      await safeDeleteConfirm.locator('button.custom-modal-ok-btn').click()
      await expect(safeDeleteConfirm).toContainText(
        /复核并安全删除|确认删除结果|Rechecking and safely deleting|Verifying deletion result/i
      )
      await expect.poll(() => pathExists(safeDeletePath), { timeout: 30000 }).toBe(false)
      await expect(safeDeleteRow).toHaveCount(0, { timeout: 1000 })
      safeDeleteSamples.push({
        prepareMs: readyAt - clickedAt,
        confirmToListMs: Date.now() - readyAt
      })
    }
    await test.info().attach('sftp-safe-delete-performance.json', {
      body: Buffer.from(JSON.stringify(safeDeleteSamples, null, 2)),
      contentType: 'application/json'
    })
    console.log(`[sftp-safe-delete] ${JSON.stringify(safeDeleteSamples)}`)
    expect(safeDeleteSamples.every(sample => sample.prepareMs < 10760)).toBe(true)
    expect(safeDeleteSamples.every(sample => sample.confirmToListMs < 7470)).toBe(true)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('shellpilot-open-safety-center')))
    const deleteSafetyCenter = page.locator('.safety-operation-center-modal')
    await expect(deleteSafetyCenter).toBeVisible({ timeout: 20000 })
    await deleteSafetyCenter.getByRole('tab', { name: /可回滚|Rollback/ }).click()
    await expect(deleteSafetyCenter).toContainText('SFTP 删除')
    await expect(deleteSafetyCenter).toContainText(lastSafeDeleteName)
    await deleteSafetyCenter.locator('.ant-modal-close').click()

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
    await releaseLockedFile().catch(() => {})
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
