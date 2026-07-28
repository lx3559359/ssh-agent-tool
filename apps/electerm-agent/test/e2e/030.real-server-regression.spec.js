const crypto = require('node:crypto')
const net = require('node:net')
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
const loopbackHost = [127, 0, 0, 1].join('.')

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
  const modal = page.locator('.custom-modal-wrap')
    .filter({ hasText: 'SHA256:' })
    .last()
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
  const wizard = page.locator('.quick-connect-wizard')
  await expect(wizard).toBeVisible()
  await wizard.locator('input:not([readonly])').first().fill(config.host)
  await wizard.locator('.quick-connect-port').fill(String(config.port))
  await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
  await wizard.locator('input:not([readonly])').first().fill(config.username)
  await wizard.locator('input[type="password"]').fill(config.password)
  await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
  await wizard.locator('.quick-connect-wizard-footer button.ant-btn-primary').click()
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

async function runTrackedQuickCommandChecks (page) {
  const result = await page.evaluate(async () => {
    const term = window.refs.get('term-' + window.store.activeTabId)
    if (!term?.runSafetyCommand) {
      throw new Error('Current terminal safety entrypoint is unavailable')
    }

    const run = async command => {
      const started = await term.runSafetyCommand(command, {
        source: 'quick-command',
        title: 'Real server quick command regression'
      })
      let completion
      try {
        completion = await started.waitForCompletion({ timeoutMs: 15000 })
      } catch (error) {
        const tail = term.getTerminalBufferText?.().slice(-1200) || ''
        const tracker = term.cmdAddon
        throw new Error([
          error?.message || String(error),
          `command=${command}`,
          `shellType=${term.shellType || ''}`,
          `shellPhase=${tracker?.shellPhase || ''}`,
          `executedCommand=${tracker?.executedCommand || ''}`,
          `lastExitCode=${tracker?.lastExitCode ?? ''}`,
          `oscSequence=${tracker?._oscSequence || 0}`,
          `inputGeneration=${tracker?._inputGeneration || 0}`,
          `expectedSubmissions=${tracker?._expectedSubmissions?.length || 0}`,
          `terminalTail=${tail}`
        ].join('\n'))
      }
      return {
        operationId: started.operationId,
        command: started.execution?.submittedCommand,
        exitCode: completion.exitCode,
        untracked: completion.untracked === true,
        trackerError: completion.trackerError || '',
        shellType: term.shellType || '',
        shellInjected: term.shellInjected === true,
        shellPhase: term.cmdAddon?.shellPhase || '',
        integrationActive: term.cmdAddon?.hasShellIntegration?.() === true,
        terminalTail: term.getTerminalBufferText?.().slice(-800) || ''
      }
    }

    const first = await run('uname -s && id -un')
    const second = await run('pwd')
    return { first, second }
  })

  expect(result.first.command).not.toBe('uname -s && id -un')
  expect(result.first.command).toMatch(/^sh -c /)
  expect(result.first.exitCode, JSON.stringify(result.first, null, 2)).toBe(0)
  expect(result.second.command).toBe('pwd')
  expect(result.second.exitCode, JSON.stringify(result.second, null, 2)).toBe(0)
}

async function runOperationsToolkitReadOnlyCheck (page) {
  const result = await page.evaluate(async () => {
    window.store.openOperationsToolkit('diagnostic')
    const diagnostic = await window.store
      .runOperationsTool('system.overview')
      .completion
    window.store.operationsToolkitTab = 'custom'
    const runbook = await window.store
      .runOperationsTool('runbook.health.baseline')
      .completion
    return {
      diagnostic: {
        status: diagnostic.status,
        steps: diagnostic.steps.map(step => ({
          status: step.status,
          exitCode: step.exitCode,
          hasOutput: Boolean(step.output)
        }))
      },
      runbook: {
        status: runbook.status,
        steps: runbook.steps.map(step => ({
          status: step.status,
          exitCode: step.exitCode,
          hasOutput: Boolean(step.output)
        }))
      },
      storedHistory: Boolean(
        window.localStorage.getItem('shellpilot-operations-task-history-v1')
      )
    }
  })

  expect(result.diagnostic.status, JSON.stringify(result, null, 2)).toBe('completed')
  expect(result.diagnostic.steps).toEqual([{
    status: 'completed',
    exitCode: 0,
    hasOutput: true
  }])
  expect(result.runbook.status, JSON.stringify(result, null, 2)).toBe('completed')
  expect(result.runbook.steps).toHaveLength(5)
  expect(result.runbook.steps.every(step => (
    step.status === 'completed' &&
    step.exitCode === 0 &&
    step.hasOutput
  ))).toBe(true)
  expect(result.storedHistory, JSON.stringify(result, null, 2)).toBe(true)
  await expect.poll(() => page.evaluate(() => (
    window.store.operationsHistory.length
  )), { timeout: 5000 }).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.operations-toolkit-workspace')).toBeVisible()
  await expect(page.locator('.operations-script-center')).toBeVisible()
  await expect(page.locator('.operations-task-panel')).toContainText('已完成')
  await page.locator('.operations-workspace-head button').click()
  await expect(page.locator('.operations-toolkit-workspace')).toBeHidden()
}

async function findFreeLocalPort () {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, loopbackHost, () => {
      const port = server.address().port
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

async function readSshBanner (port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: loopbackHost, port })
    let output = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Timed out waiting for the SSH tunnel banner'))
    }, 10000)
    const finish = (error, value) => {
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    socket.once('error', error => finish(error))
    socket.on('data', chunk => {
      output += chunk.toString('utf8')
      if (output.includes('\n')) finish(null, output.trim())
    })
  })
}

async function runNativeSshTunnelCheck (page) {
  const localPort = await findFreeLocalPort()
  await page.getByRole('button', { name: 'SSH 隧道' }).click()
  const modal = page.locator('.ssh-tunnel-modal')
  await expect(modal).toBeVisible()

  try {
    await modal.getByLabel('配置名称').fill('真实服务器 SSH 回归')
    await modal.getByLabel('本机监听地址').fill(loopbackHost)
    await modal.getByLabel('本机监听端口').fill(String(localPort))
    await modal.getByLabel('远程目标地址').fill(loopbackHost)
    await modal.getByLabel('远程目标端口').fill('22')
    await modal.getByRole('button', { name: '启动隧道' }).click()
    await expect(modal.locator('.ssh-tunnel-running-card')).toHaveCount(1)
    await expect.poll(() => readSshBanner(localPort), { timeout: 15000 })
      .toMatch(/^SSH-/)
    await modal.locator('.ssh-tunnel-running-card')
      .getByRole('button', { name: '停止' })
      .click()
    await expect(modal.locator('.ssh-tunnel-running-card')).toHaveCount(0)
  } finally {
    const stop = modal.locator('.ssh-tunnel-running-card')
      .getByRole('button', { name: '停止' })
    if (await stop.count()) await stop.click().catch(() => {})
    await modal.locator('.ant-modal-close').click().catch(() => {})
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
    await runTrackedQuickCommandChecks(run.page)
    await runNativeSshTunnelCheck(run.page)
    await runOperationsToolkitReadOnlyCheck(run.page)
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
