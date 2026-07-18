const crypto = require('node:crypto')
const path = require('node:path')
const { _electron: electron, expect, test } = require('@playwright/test')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')

const requiredEnvironmentVariables = Object.freeze([
  'SHELLPILOT_E2E_HOST',
  'SHELLPILOT_E2E_PORT',
  'SHELLPILOT_E2E_USERNAME',
  'SHELLPILOT_E2E_PASSWORD',
  'SHELLPILOT_E2E_REMOTE_ROOT'
])

const readOnlyCommands = Object.freeze([
  'uname -s',
  'id -un',
  'pwd'
])

test.setTimeout(180000)

function readRealServerConfig () {
  const values = Object.fromEntries(requiredEnvironmentVariables.map(name => {
    const value = process.env[name] || ''
    return [name, name === 'SHELLPILOT_E2E_PASSWORD' ? value : value.trim()]
  }))
  const missingEnvironmentVariables = requiredEnvironmentVariables.filter(name => !values[name])

  if (missingEnvironmentVariables.length > 0) {
    return { config: null, missingEnvironmentVariables }
  }

  const port = Number(values.SHELLPILOT_E2E_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SHELLPILOT_E2E_PORT must be an integer between 1 and 65535')
  }

  return {
    config: {
      host: values.SHELLPILOT_E2E_HOST,
      port,
      username: values.SHELLPILOT_E2E_USERNAME,
      password: values.SHELLPILOT_E2E_PASSWORD,
      remoteRoot: assertSafeRemoteRoot(values.SHELLPILOT_E2E_REMOTE_ROOT)
    },
    missingEnvironmentVariables
  }
}

function assertSafeRemoteRoot (remoteRoot) {
  const normalized = path.posix.normalize(remoteRoot)
  if (!path.posix.isAbsolute(normalized) || normalized === '/') {
    throw new Error('SHELLPILOT_E2E_REMOTE_ROOT must be an absolute, non-root POSIX path')
  }
  return normalized.replace(/\/+$/, '')
}

function assertPathInsideSandbox (sandboxPath, candidatePath) {
  const sandbox = path.posix.resolve(sandboxPath)
  const candidate = path.posix.resolve(candidatePath)
  if (candidate !== sandbox && !candidate.startsWith(sandbox + '/')) {
    throw new Error('Refusing to access a path outside the real-server E2E sandbox')
  }
  return candidate
}

async function acceptHostKeyIfPrompted (page) {
  const modal = page.locator('.custom-modal-wrap').last()
  try {
    await modal.waitFor({ state: 'visible', timeout: 10000 })
  } catch {
    return
  }
  const confirmButton = modal.locator('button.custom-modal-ok-btn, button.ant-btn-primary').last()
  await expect(confirmButton).toBeVisible()
  await confirmButton.click()
}

async function terminalText (page) {
  return page.evaluate(() => (
    window.refs.get('term-' + window.store.activeTabId)?.getTerminalBufferText?.() || ''
  ))
}

async function connectRealServer (page, config) {
  await page.locator('.aigshell-topbar-action .anticon-plus-circle').click()
  const form = page.locator('.setting-wrap #ssh-form')
  await expect(form).toBeVisible()
  await form.locator('#ssh-form_title').fill('ShellPilot Real Server E2E')
  await form.locator('#ssh-form_host').fill(config.host)
  await form.locator('#ssh-form_port').fill(String(config.port))
  await form.locator('#ssh-form_username').fill(config.username)
  await form.locator('#ssh-form_password').fill(config.password)
  await form.locator('#ssh-form_startDirectory').fill(config.remoteRoot)
  await page.getByTestId('bookmark-save-connect').click()
  await acceptHostKeyIfPrompted(page)
  await expect.poll(() => terminalText(page), { timeout: 30000 }).not.toBe('')
}

async function runReadOnlySshChecks (page) {
  const terminal = page.locator('.session-current')
  const input = terminal.locator('.xterm-helper-textarea').last()

  for (const command of readOnlyCommands) {
    const previousLength = (await terminalText(page)).length
    await page.evaluate(() => window.refs.get('term-' + window.store.activeTabId)?.term?.focus())
    await expect(input).toBeFocused()
    await page.keyboard.type(command)
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await terminalText(page)).length, { timeout: 15000 })
      .toBeGreaterThan(previousLength + command.length)
  }
}

async function openSftp (page) {
  await page.locator('.session-current .term-sftp-tabs .type-tab:visible').nth(1).click()
  await expect.poll(() => page.evaluate(() => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    return Boolean(entry?.sftp)
  }), { timeout: 30000 }).toBe(true)
}

async function createRemoteSandbox (page, sandboxPath) {
  await page.evaluate(async sandboxPath => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    if (!entry?.sftp) throw new Error('SFTP session is not ready')
    await entry.sftp.mkdir(sandboxPath)
  }, sandboxPath)
}

async function writeRemoteText (page, remotePath, content) {
  await page.evaluate(async ({ remotePath, content }) => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    if (!entry?.sftp) throw new Error('SFTP session is not ready')
    await entry.sftp.writeFile(remotePath, content)
  }, { remotePath, content })
}

async function readRemoteText (page, remotePath) {
  return page.evaluate(async remotePath => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    if (!entry?.sftp) throw new Error('SFTP session is not ready')
    const value = await entry.sftp.readFile(remotePath)
    if (typeof value === 'string') return value
    const bytes = value?.type === 'Buffer'
      ? new Uint8Array(value.data)
      : new Uint8Array(value?.buffer || value)
    return new TextDecoder().decode(bytes)
  }, remotePath)
}

async function renameRemotePath (page, sourcePath, targetPath) {
  await page.evaluate(async ({ sourcePath, targetPath }) => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    if (!entry?.sftp) throw new Error('SFTP session is not ready')
    await entry.sftp.rename(sourcePath, targetPath)
  }, { sourcePath, targetPath })
}

async function cleanupRemoteSandbox (page, sandboxPath, candidatePaths) {
  const safeCandidates = candidatePaths.map(candidatePath => (
    assertPathInsideSandbox(sandboxPath, candidatePath)
  ))
  await page.evaluate(async ({ sandboxPath, candidatePaths }) => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    if (!entry?.sftp) throw new Error('SFTP session is not ready for cleanup')
    for (const candidatePath of candidatePaths) {
      try {
        await entry.sftp.unlink(candidatePath)
      } catch {}
    }
    await entry.sftp.rmdir(sandboxPath)
  }, { sandboxPath, candidatePaths: safeCandidates })
}

test('real server supports read-only SSH checks and isolated reversible SFTP operations', async () => {
  const { config, missingEnvironmentVariables } = readRealServerConfig()
  test.skip(
    missingEnvironmentVariables.length > 0,
    `缺少真实服务器测试环境变量：${missingEnvironmentVariables.join(', ')}`
  )

  const sandboxName = `.shellpilot-e2e-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
  const sandboxPath = path.posix.join(config.remoteRoot, sandboxName)
  const uploadedPath = assertPathInsideSandbox(sandboxPath, path.posix.join(sandboxPath, 'uploaded.txt'))
  const renamedPath = assertPathInsideSandbox(sandboxPath, path.posix.join(sandboxPath, 'renamed.txt'))
  const marker = `shellpilot-real-e2e-${crypto.randomBytes(12).toString('hex')}\n`
  let run
  let remoteSandboxCreated = false
  let primaryError
  let cleanupError

  try {
    run = await launchQualityApp(electron)
    await connectRealServer(run.page, config)
    await runReadOnlySshChecks(run.page)
    await openSftp(run.page)

    await createRemoteSandbox(run.page, sandboxPath)
    remoteSandboxCreated = true
    await writeRemoteText(run.page, uploadedPath, marker)
    await expect.poll(() => readRemoteText(run.page, uploadedPath), { timeout: 15000 }).toBe(marker)

    await renameRemotePath(run.page, uploadedPath, renamedPath)
    await expect.poll(() => readRemoteText(run.page, renamedPath), { timeout: 15000 }).toBe(marker)

    await renameRemotePath(run.page, renamedPath, uploadedPath)
    await expect.poll(() => readRemoteText(run.page, uploadedPath), { timeout: 15000 }).toBe(marker)
  } catch (error) {
    primaryError = error
  } finally {
    if (remoteSandboxCreated && run?.page && !run.page.isClosed()) {
      try {
        await cleanupRemoteSandbox(run.page, sandboxPath, [uploadedPath, renamedPath])
      } catch (error) {
        cleanupError = error
      }
    }
    if (run) {
      try {
        await cleanupQualityApp(run.electronApp, run.profileRoot)
      } catch (error) {
        cleanupError ||= error
      }
    }
  }

  if (primaryError) {
    if (cleanupError) primaryError.cleanupError = cleanupError
    throw primaryError
  }
  if (cleanupError) throw cleanupError
})
