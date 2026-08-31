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

const performanceBudgets = Object.freeze({
  firstSftpReadyMs: 3000,
  cachedPaintMs: 100,
  sftpRefreshMs: 3000
})

const internalTerminalPattern = /__sp_|SHELLPILOT_(?:FILE|OPS|TOKEN)/

test.setTimeout(180000)
test.describe.configure({ mode: 'serial' })

function readRealServerConfig () {
  const values = Object.fromEntries(requiredEnvironmentVariables.map(name => [
    name,
    name === 'SHELLPILOT_E2E_PASSWORD'
      ? process.env[name] || ''
      : String(process.env[name] || '').trim()
  ]))
  const missingEnvironmentVariables = requiredEnvironmentVariables
    .filter(name => !values[name])
  if (missingEnvironmentVariables.length) {
    return { config: null, missingEnvironmentVariables }
  }
  const port = Number(values.SHELLPILOT_E2E_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SHELLPILOT_E2E_PORT must be an integer between 1 and 65535')
  }
  const remoteRoot = path.posix.normalize(values.SHELLPILOT_E2E_REMOTE_ROOT)
    .replace(/\/+$/, '')
  if (remoteRoot !== '/tmp' && !remoteRoot.startsWith('/tmp/')) {
    throw new Error('Real VPS responsiveness checks are restricted to /tmp')
  }
  return {
    config: {
      host: values.SHELLPILOT_E2E_HOST,
      port,
      username: values.SHELLPILOT_E2E_USERNAME,
      password: values.SHELLPILOT_E2E_PASSWORD,
      remoteRoot
    },
    missingEnvironmentVariables
  }
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
  await modal.locator(
    'button.custom-modal-ok-btn, button.ant-btn-primary'
  ).last().click()
}

async function terminalState (page) {
  return page.evaluate(() => {
    const terminal = window.refs.get('term-' + window.store.activeTabId)
    let text = ''
    try {
      if (terminal?.term?.buffer) {
        text = terminal.getTerminalBufferText?.() || ''
      }
    } catch {}
    const terminalError = String(terminal?.state?.terminalError?.message || '')
      .toLowerCase()
    const terminalErrorCategory = !terminalError
      ? 'none'
      : /auth|password|permission|denied/.test(terminalError)
        ? 'authentication'
        : /timeout|timed out/.test(terminalError)
          ? 'timeout'
          : /fingerprint|host key|known_hosts/.test(terminalError)
            ? 'host-key'
            : /network|connect|socket|econn/.test(terminalError)
              ? 'connection'
              : 'other'
    return {
      terminalExists: Boolean(terminal),
      termExists: Boolean(terminal?.term),
      bufferExists: Boolean(terminal?.term?.buffer),
      attachAddonExists: Boolean(terminal?.attachAddon),
      pidExists: Boolean(terminal?.pid),
      closed: Boolean(terminal?.onClose),
      terminalErrorCategory,
      ready: Boolean(
        terminal?.term &&
        terminal?.attachAddon &&
        terminal?.pid &&
        !terminal?.onClose
      ),
      text,
      busy: terminal?.operationsPtyTaskController?.isBusy?.() === true,
      owner: terminal?.operationsPtyTaskController?.owner?.() || '',
      expectedSubmissions: terminal?.cmdAddon?._expectedSubmissions?.length || 0,
      sshSessionGeneration: String(
        terminal?.getTerminalSafetyEndpoint?.().sshSessionGeneration || ''
      )
    }
  })
}

async function connectRealServer (page, config) {
  await page.locator('.aigshell-topbar-action .anticon-plus-circle').click()
  const wizard = page.locator('.quick-connect-wizard')
  await expect(wizard).toBeVisible()
  await wizard.locator('input:not([readonly])').first().fill(config.host)
  await wizard.locator('.quick-connect-port').fill(String(config.port))
  await wizard.locator(
    '.quick-connect-wizard-footer button.ant-btn-primary'
  ).click()
  await wizard.locator('input:not([readonly])').first().fill(config.username)
  await wizard.locator('input[type="password"]').fill(config.password)
  await wizard.locator(
    '.quick-connect-wizard-footer button.ant-btn-primary'
  ).click()
  await wizard.locator(
    '.quick-connect-wizard-footer button.ant-btn-primary'
  ).click()
  await acceptHostKeyIfPrompted(page)
  let lastReadinessState
  const readReadinessState = async () => {
    const { text, sshSessionGeneration, ...state } = await terminalState(page)
    lastReadinessState = {
      ...state,
      wizardVisible: await wizard.isVisible().catch(() => false),
      hostKeyPromptVisible: await page.locator('.custom-modal-wrap')
        .filter({ hasText: 'SHA256:' })
        .last()
        .isVisible()
        .catch(() => false)
    }
    return lastReadinessState
  }
  try {
    await expect.poll(async () => (await readReadinessState()).ready, {
      timeout: 30000
    }).toBe(true)
  } catch (error) {
    const diagnostic = new Error(
      `${error.message}\nreadiness=${JSON.stringify(lastReadinessState)}`
    )
    diagnostic.cause = error
    throw diagnostic
  }
}

async function withRealServer (config, action) {
  let run
  let result
  let primaryError
  let cleanupError
  try {
    run = await launchQualityApp(electron)
    await connectRealServer(run.page, config)
    result = await action(run.page)
  } catch (error) {
    primaryError = error
  } finally {
    if (run) {
      try {
        await cleanupQualityApp(run.electronApp, run.profileRoot)
      } catch (error) {
        cleanupError = error
      }
    }
  }
  if (primaryError) {
    if (cleanupError) primaryError.cleanupError = cleanupError
    throw primaryError
  }
  if (cleanupError) throw cleanupError
  return result
}

async function sendTerminalLine (page, command) {
  await expect.poll(async () => (await terminalState(page)).ready, {
    timeout: 20000
  }).toBe(true)
  await page.evaluate(() => {
    window.refs.get('term-' + window.store.activeTabId)?.term?.focus()
  })
  const input = page.locator('.session-current .xterm-helper-textarea').last()
  await expect(input).toBeFocused()
  await input.pressSequentially(command, { delay: 5 })
  await page.keyboard.press('Enter')
}

async function expectTerminalMarker (page, marker, startLength = 0) {
  await expect.poll(async () => {
    const state = await terminalState(page)
    return state.text.slice(startLength)
  }, { timeout: 20000 }).toContain(marker)
}

async function performanceSummary (page) {
  return page.evaluate(() => window.pre.runGlobalAsync('getPerformanceSummary'))
}

function metricSampleCount (summary, name) {
  return Number(summary?.metrics?.[name]?.sampleCount || 0)
}

function latestMetric (summary, name) {
  return Number(summary?.metrics?.[name]?.latest)
}

async function openSftp (page) {
  const startedAt = Date.now()
  await page.locator(
    '.session-current .term-sftp-tabs .type-tab:visible'
  ).nth(1).click()
  await expect.poll(() => page.evaluate(() => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    return Boolean(
      entry?.sftp &&
      entry.state.inited &&
      entry.state.remoteLoading === false
    )
  }), { timeout: 30000 }).toBe(true)
  return Date.now() - startedAt
}

async function gotoRemotePath (page, remotePath) {
  const input = page.locator(
    '.session-current .sftp-remote-section .sftp-title input'
  )
  await input.fill(remotePath)
  await input.press('Enter')
  await expect.poll(() => page.evaluate(() => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    return entry?.state.remoteLoading === false
      ? entry.state.remotePath
      : ''
  }), { timeout: 30000 }).toBe(remotePath)
}

async function refreshRemoteDirectory (page) {
  const before = await performanceSummary(page)
  const beforeCached = metricSampleCount(before, 'sftp_cached_paint_ms')
  const beforeRefresh = metricSampleCount(before, 'sftp_refresh_ms')
  await page.evaluate(() => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    if (!entry) throw new Error('SFTP entry is unavailable')
    window.__shellpilotResponsivenessRefresh = entry.remoteList()
  })
  await expect.poll(async () => metricSampleCount(
    await performanceSummary(page),
    'sftp_cached_paint_ms'
  ), { timeout: 5000 }).toBeGreaterThan(beforeCached)
  await page.evaluate(() => window.__shellpilotResponsivenessRefresh)
  await expect.poll(async () => metricSampleCount(
    await performanceSummary(page),
    'sftp_refresh_ms'
  ), { timeout: 10000 }).toBeGreaterThan(beforeRefresh)
  const summary = await performanceSummary(page)
  return page.evaluate(({ cachedPaintMs, refreshMs }) => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    return {
      cachedPaintMs,
      refreshMs,
      itemCount: entry?.state.remote?.length || 0,
      coalesced: entry?.remoteDirectoryCache?.stats?.().coalesced || 0
    }
  }, {
    cachedPaintMs: latestMetric(summary, 'sftp_cached_paint_ms'),
    refreshMs: latestMetric(summary, 'sftp_refresh_ms')
  })
}

function assertTerminalRecovered (state) {
  expect(state.busy).toBe(false)
  expect(state.owner).toBe('')
  expect(state.expectedSubmissions).toBe(0)
  expect(state.text).not.toMatch(internalTerminalPattern)
}

test('round 1 - terminal and operations recover without internal echo', async () => {
  const { config, missingEnvironmentVariables } = readRealServerConfig()
  test.skip(
    missingEnvironmentVariables.length > 0,
    `缺少真实服务器测试环境变量：${missingEnvironmentVariables.join(', ')}`
  )

  await withRealServer(config, async page => {
    const marker = 'shellpilot-round-one-ready'
    const before = await terminalState(page)
    await sendTerminalLine(page, `printf '${marker}\\n'`)
    await expectTerminalMarker(page, marker, before.text.length)

    const tasks = await page.evaluate(async () => {
      const system = await window.store
        .runOperationsTool('system.overview')
        .completion
      const baseline = await window.store
        .runOperationsTool('runbook.health.baseline')
        .completion
      return [system, baseline].map(task => ({
        status: task.status,
        outputs: task.steps.map(step => Boolean(step.output)),
        exitCodes: task.steps.map(step => step.exitCode)
      }))
    })
    const taskSummary = JSON.stringify(tasks)
    expect(
      tasks.every(task => task.status === 'completed'),
      taskSummary
    ).toBe(true)
    expect(
      tasks.every(task => task.outputs.every(Boolean)),
      taskSummary
    ).toBe(true)
    expect(
      tasks.every(task => task.exitCodes.every(code => code === 0)),
      taskSummary
    )
      .toBe(true)

    await expect.poll(async () => {
      const summary = await performanceSummary(page)
      return [
        'managed_input_ack_ms',
        'operations_first_output_ms',
        'operations_total_ms'
      ].every(name => metricSampleCount(summary, name) > 0)
    }, { timeout: 5000 }).toBe(true)
    assertTerminalRecovered(await terminalState(page))
  })
})

test('round 2 - SFTP cache paints immediately and refreshes authoritatively', async () => {
  const { config, missingEnvironmentVariables } = readRealServerConfig()
  test.skip(
    missingEnvironmentVariables.length > 0,
    `缺少真实服务器测试环境变量：${missingEnvironmentVariables.join(', ')}`
  )

  const evidence = await withRealServer(config, async page => {
    const openReadyMs = await openSftp(page)
    await gotoRemotePath(page, config.remoteRoot)
    await expect.poll(async () => metricSampleCount(
      await performanceSummary(page),
      'first_sftp_ready_ms'
    ), { timeout: 5000 }).toBeGreaterThan(0)
    const initialSummary = await performanceSummary(page)
    const firstReadyMs = latestMetric(initialSummary, 'first_sftp_ready_ms')
    expect(firstReadyMs).toBeLessThanOrEqual(
      performanceBudgets.firstSftpReadyMs
    )

    const refreshes = []
    for (let round = 0; round < 3; round += 1) {
      const refresh = await refreshRemoteDirectory(page)
      expect(refresh.cachedPaintMs).toBeLessThanOrEqual(
        performanceBudgets.cachedPaintMs
      )
      expect(refresh.refreshMs).toBeLessThanOrEqual(
        performanceBudgets.sftpRefreshMs
      )
      refreshes.push(refresh)
    }
    assertTerminalRecovered(await terminalState(page))
    return {
      firstReadyMs,
      openReadyMs,
      cachedPaintMs: refreshes.map(item => item.cachedPaintMs),
      refreshMs: refreshes.map(item => item.refreshMs),
      itemCounts: refreshes.map(item => item.itemCount),
      coalesced: refreshes.at(-1).coalesced
    }
  })

  await test.info().attach('real-vps-sftp-responsiveness.json', {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: 'application/json'
  })
})

test('round 3 - cancellation reconnect and cache isolation stay usable', async () => {
  const { config, missingEnvironmentVariables } = readRealServerConfig()
  test.skip(
    missingEnvironmentVariables.length > 0,
    `缺少真实服务器测试环境变量：${missingEnvironmentVariables.join(', ')}`
  )

  await withRealServer(config, async page => {
    await openSftp(page)
    await gotoRemotePath(page, config.remoteRoot)
    const beforeReconnect = await page.evaluate(() => {
      const terminal = window.refs.get('term-' + window.store.activeTabId)
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      entry.remoteDirectoryCache.set('round-3-old-session-sentinel', [])
      return {
        generation: terminal.getTerminalSafetyEndpoint().sshSessionGeneration,
        cacheEntries: entry.remoteDirectoryCache.stats().entries
      }
    })
    expect(beforeReconnect.generation).not.toBe('')
    expect(beforeReconnect.cacheEntries).toBeGreaterThan(0)

    await page.locator(
      '.session-current .term-sftp-tabs .type-tab:visible'
    ).first().click()
    await page.evaluate(async () => {
      const terminal = window.refs.get('term-' + window.store.activeTabId)
      const lease = await terminal.acquireOperationsPtyTask(
        'real-vps-responsiveness-cancel'
      )
      const controller = new AbortController()
      window.__shellpilotResponsivenessAbort = controller
      window.__shellpilotResponsivenessCancelResult = null
      window.__shellpilotResponsivenessCancelPromise = (async () => {
        let outcome
        try {
          await lease.execute({
            taskId: 'real-vps-cancellable-sleep',
            script: 'sleep 10',
            timeoutMs: 15000,
            signal: controller.signal
          })
          outcome = { name: 'completed' }
        } catch (error) {
          outcome = { name: error?.name || 'Error' }
        } finally {
          outcome.released = await lease.release()
        }
        window.__shellpilotResponsivenessCancelResult = outcome
        return outcome
      })()
    })
    await page.waitForTimeout(200)
    await page.evaluate(() => window.__shellpilotResponsivenessAbort.abort())
    await expect.poll(() => page.evaluate(() => (
      window.__shellpilotResponsivenessCancelResult
    )), { timeout: 15000 }).not.toBeNull()
    const cancellation = await page.evaluate(() => (
      window.__shellpilotResponsivenessCancelPromise
    ))
    expect(cancellation).toEqual({ name: 'AbortError', released: true })
    await expect.poll(async () => (await terminalState(page)).busy, {
      timeout: 5000
    }).toBe(false)

    const recoveryMarker = 'shellpilot-round-three-recovered'
    const beforeMarker = await terminalState(page)
    await sendTerminalLine(page, `printf '${recoveryMarker}\\n'`)
    await expectTerminalMarker(page, recoveryMarker, beforeMarker.text.length)

    await page.evaluate(() => {
      window.refs.get('term-' + window.store.activeTabId)?.onReconnect()
    })
    await acceptHostKeyIfPrompted(page)
    await expect.poll(async () => {
      const state = await terminalState(page)
      return state.ready &&
        state.sshSessionGeneration &&
        state.sshSessionGeneration !== beforeReconnect.generation
    }, { timeout: 30000 }).toBe(true)
    await expect.poll(() => page.evaluate(() => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      return entry?.remoteDirectoryCache
        ?.get('round-3-old-session-sentinel') !== null
    }), { timeout: 10000 }).toBe(false)

    await openSftp(page)
    await gotoRemotePath(page, config.remoteRoot)
    await page.locator(
      '.session-current .term-sftp-tabs .type-tab:visible'
    ).first().click()
    const finalMarker = 'shellpilot-round-three-final'
    const beforeFinal = await terminalState(page)
    await sendTerminalLine(page, `printf '${finalMarker}\\n'`)
    await expectTerminalMarker(page, finalMarker, beforeFinal.text.length)
    assertTerminalRecovered(await terminalState(page))
  })
})
