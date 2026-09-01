const crypto = require('node:crypto')
const { _electron: electron, expect, test } = require('@playwright/test')
const { Client } = require('@electerm/ssh2')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')

const requiredEnvironmentVariables = Object.freeze([
  'SHELLPILOT_E2E_HOST',
  'SHELLPILOT_E2E_PORT',
  'SHELLPILOT_E2E_USERNAME',
  'SHELLPILOT_E2E_PASSWORD'
])

test.setTimeout(180000)
test.use({
  screenshot: 'off',
  trace: 'off',
  video: 'off'
})

function readRootConfig () {
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
  return {
    config: {
      host: values.SHELLPILOT_E2E_HOST,
      port: Number(values.SHELLPILOT_E2E_PORT),
      username: values.SHELLPILOT_E2E_USERNAME,
      password: values.SHELLPILOT_E2E_PASSWORD
    },
    missingEnvironmentVariables
  }
}

function connectSsh (config) {
  return new Promise((resolve, reject) => {
    const client = new Client()
    client.once('ready', () => resolve(client))
    client.once('error', () => reject(
      new Error('Remote maintenance connection failed')
    ))
    client.connect({ ...config, readyTimeout: 30000 })
  })
}

function execRemote (client, command, input = '') {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        return reject(new Error('Provisioning request could not start'))
      }
      let settled = false
      let stderr = ''
      const finish = callback => value => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        callback(value)
      }
      const timeout = setTimeout(finish(reject), 30000,
        new Error('Provisioning request timed out'))
      stream.resume()
      stream.stderr.on('data', data => { stderr += String(data) })
      stream.once('close', code => {
        if (code === 0) return finish(resolve)()
        const stderrPresent = Boolean(stderr.trim())
        const safeStderr = stderrPresent ? 'stderr=present' : 'stderr=empty'
        finish(reject)(new Error(
          `Provisioning request failed (${Number(code)}); ${safeStderr}`
        ))
      })
      if (input) stream.end(input)
    })
  })
}

async function createTemporarySudoUser (rootConfig) {
  const username = `spqa${crypto.randomBytes(3).toString('hex')}`
  const password = `Sp!${crypto.randomBytes(18).toString('base64url')}9`
  const client = await connectSsh(rootConfig)
  try {
    console.log('[041] provisioning prerequisite check')
    await execRemote(client, 'command -v sudo >/dev/null 2>&1')
    console.log('[041] provisioning identity setup')
    await execRemote(
      client,
      `/usr/sbin/useradd -m -s /bin/bash ${username}`
    )
    await execRemote(
      client,
      'if getent group wheel >/dev/null 2>&1; then ' +
      `/usr/sbin/usermod -aG wheel ${username}; ` +
      'elif getent group sudo >/dev/null 2>&1; then ' +
      `/usr/sbin/usermod -aG sudo ${username}; ` +
      'else exit 45; fi'
    )
    console.log('[041] provisioning credential setup')
    await execRemote(client, '/usr/sbin/chpasswd', `${username}:${password}\n`)
    return { username, password }
  } catch (error) {
    await execRemote(
      client,
      `/usr/sbin/userdel -r ${username} >/dev/null 2>&1 || true`
    ).catch(() => {})
    throw error
  } finally {
    client.end()
  }
}

async function removeTemporarySudoUser (rootConfig, username) {
  if (!/^spqa[a-f0-9]{6}$/.test(username)) {
    throw new Error('Temporary account cleanup identity is invalid')
  }
  const client = await connectSsh(rootConfig)
  try {
    await execRemote(
      client,
      `pkill -KILL -u ${username} >/dev/null 2>&1 || true; ` +
      `/usr/sbin/userdel -r ${username} >/dev/null 2>&1 || true`
    )
  } finally {
    client.end()
  }
}

async function terminalReady (page) {
  return page.evaluate(() => {
    const terminal = window.refs.get('term-' + window.store.activeTabId)
    return Boolean(
      terminal?.term &&
      terminal?.attachAddon &&
      terminal?.pid &&
      !terminal?.onClose
    )
  })
}

async function terminalBufferLength (page) {
  return page.evaluate(() => {
    try {
      const terminal = window.refs.get('term-' + window.store.activeTabId)
      return String(terminal?.getTerminalBufferText?.() || '').length
    } catch {
      return 0
    }
  })
}

async function terminalOutputSignals (page, start, expectedOutput = '') {
  return page.evaluate(({ start, expectedOutput }) => {
    let buffer = ''
    try {
      const terminal = window.refs.get('term-' + window.store.activeTabId)
      buffer = String(terminal?.getTerminalBufferText?.() || '')
    } catch {}
    const delta = buffer.slice(Math.max(0, Number(start) || 0))
    return {
      passwordPromptSeen: delta.toLowerCase().includes('password'),
      promptRecovered: /(?:^|\n)[^\n]*[#>$]\s*$/.test(delta),
      expectedOutputSeen: Boolean(expectedOutput) &&
        delta.includes(expectedOutput),
      internalLeakDetected: /__sp_|SHELLPILOT_(?:FILE|OPS|TOKEN)/
        .test(delta),
      probeLeakDetected: /shellpilot\s+root\s+one\s+read/i.test(delta)
    }
  }, { start, expectedOutput })
}

function expectNoTerminalLeak (signals) {
  expect(signals.internalLeakDetected).toBe(false)
  expect(signals.probeLeakDetected).toBe(false)
}

function randomMarkerProof () {
  const markerInput = [...crypto.randomBytes(24)]
    .map(value => String.fromCharCode(97 + (value % 16)))
    .join('')
  const markerExpectedOutput = markerInput.toUpperCase()
  const markerTypedBytes =
    `printf '%s\\n' '${markerInput}' | tr 'a-p' 'A-P'`
  expect(markerTypedBytes.includes(markerExpectedOutput)).toBe(false)
  return { markerTypedBytes, markerExpectedOutput }
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
  await expect.poll(() => terminalReady(page), {
    timeout: 30000
  }).toBe(true)
}

async function sendTerminalText (page, text, enter = true) {
  await page.evaluate(() => {
    window.refs.get('term-' + window.store.activeTabId)?.term?.focus()
  })
  const input = page.locator('.session-current .xterm-helper-textarea').last()
  await expect(input).toBeFocused()
  await input.pressSequentially(text, { delay: 5 })
  if (enter) await page.keyboard.press('Enter')
}

async function performanceSummary (page) {
  return page.evaluate(() => window.pre.runGlobalAsync('getPerformanceSummary'))
}

function metricSnapshot (summary, name) {
  return {
    samples: Number(summary?.metrics?.[name]?.sampleCount || 0),
    latestMs: Number(summary?.metrics?.[name]?.latest || 0)
  }
}

async function openHalfSftp (page) {
  const startedAt = Date.now()
  const beforeMetrics = await performanceSummary(page)
  const toggle = page.locator(
    '.session-current .split-view-toggle:visible'
  ).last()
  await expect(toggle).toBeVisible()
  if (await toggle.getAttribute('aria-pressed') !== 'true') {
    await toggle.click()
  }
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    const readiness = entry?.getSftpReadinessSnapshot?.()
    const remoteArea = document.querySelector(
      '.session-current .sftp-remote-section .file-list.remote'
    )
    return Boolean(
      entry?.sftp &&
      readiness?.fullySettled &&
      readiness?.visibleRemoteCommitted &&
      remoteArea?.getClientRects?.().length
    )
  }), { timeout: 30000 }).toBe(true)
  const idleSnapshot = await waitForSftpTaskIdle(page)
  const afterMetrics = await performanceSummary(page)
  const metricNames = [
    'first_sftp_ready_ms',
    'sftp_refresh_ms',
    'sftp_cached_paint_ms',
    'managed_input_ack_ms'
  ]
  return {
    totalMs: Date.now() - startedAt,
    cleanup: idleSnapshot,
    metrics: Object.fromEntries(metricNames.map(name => {
      const before = metricSnapshot(beforeMetrics, name)
      const after = metricSnapshot(afterMetrics, name)
      return [name, {
        beforeSamples: before.samples,
        afterSamples: after.samples,
        sampleDelta: after.samples - before.samples,
        latestMs: after.latestMs
      }]
    }))
  }
}

async function showTerminal (page) {
  const toggle = page.locator(
    '.session-current .split-view-toggle:visible'
  ).last()
  if (await toggle.getAttribute('aria-pressed') === 'true') {
    await toggle.click()
  }
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator(
    '.session-current .xterm-helper-textarea'
  ).last()).toBeVisible()
}

async function sftpCleanupSnapshot (page) {
  return page.evaluate(() => {
    const terminal = window.refs.get('term-' + window.store.activeTabId)
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    const addon = terminal?.attachAddon
    const readiness = entry?.getSftpReadinessSnapshot?.() || {}
    const refreshState = String(entry?.state.remoteRefreshState || '')
    const refreshIdle = Boolean(
      entry?.state.remoteLoading === false &&
      !['refreshing', 'cached-refreshing'].includes(refreshState)
    )
    const generationLeaseCount = Number(
      entry?.remoteFileGeneration?.capabilities?.size || 0
    )
    const legacyLeaseCount = Number(entry?.remoteFileOperations?.size || 0)
    const suppressionBufferCount = Number(addon?.suppressedData?.length || 0) +
      Number(String(addon?.suppressionReleaseMarker || '').length) +
      Number(String(addon?.suppressionScanText || '').length) +
      Number(addon?.suppressionScanBytes?.length || 0) +
      Number(addon?.managedPtyLifecycleBytes?.length || 0) +
      Number(String(addon?.managedPtyExpectedCommand || '').length) +
      Number(Boolean(addon?.onSuppressionEndCallback)) +
      Number(Boolean(addon?.suppressTimeout))
    return {
      busy: terminal?.operationsPtyTaskController?.isBusy?.() === true,
      refreshIdle,
      fullySettled: readiness.fullySettled === true,
      visibleRemoteCommitted: readiness.visibleRemoteCommitted === true,
      firstReadyCommitted: readiness.firstReadyCommitted === true,
      explicitOpenPending: readiness.explicitOpenPending === true,
      sessionBindingPending: readiness.sessionBindingPending === true,
      backgroundTaskCount: Number(readiness.backgroundTaskCount || 0),
      renderCommitCount: Number(readiness.renderCommitCount || 0),
      metricTaskCount: Number(readiness.metricTaskCount || 0),
      directoryRequestCount: Number(readiness.directoryRequestCount || 0),
      requestEpoch: Number(readiness.requestEpoch || 0),
      activeLeaseCount: Math.max(generationLeaseCount, legacyLeaseCount),
      authoritativeActiveLeaseCount: Number(
        entry?.activeRemoteFileLeases?.size || 0
      ),
      uncertainLeaseCount: Number(entry?.uncertainRemoteFileLeases?.size || 0),
      outputSuppressed: Boolean(
        addon?.outputSuppressed ||
        addon?.managedPtyEchoSuppressionActive ||
        addon?.managedPtyOutputStreamingActive
      ),
      suppressionBufferCount,
      pendingInputCount: Number(addon?.pendingInput?.length || 0)
    }
  })
}

function isSftpCleanupSnapshot (snapshot) {
  return Boolean(
    snapshot &&
    snapshot.busy === false &&
    snapshot.refreshIdle === true &&
    snapshot.fullySettled === true &&
    snapshot.visibleRemoteCommitted === true &&
    snapshot.firstReadyCommitted === true &&
    snapshot.explicitOpenPending === false &&
    snapshot.backgroundTaskCount === 0 &&
    snapshot.renderCommitCount === 0 &&
    snapshot.metricTaskCount === 0 &&
    snapshot.directoryRequestCount === 0 &&
    snapshot.activeLeaseCount === 0 &&
    snapshot.authoritativeActiveLeaseCount === 0 &&
    snapshot.uncertainLeaseCount === 0 &&
    snapshot.outputSuppressed === false &&
    snapshot.suppressionBufferCount === 0 &&
    snapshot.pendingInputCount === 0
  )
}

async function waitForSftpTaskIdle (page) {
  let settledSnapshot
  await expect.poll(async () => {
    settledSnapshot = await sftpCleanupSnapshot(page)
    return isSftpCleanupSnapshot(settledSnapshot)
  }, { timeout: 30000 }).toBe(true)
  return {
    ...settledSnapshot,
    idleStable: true
  }
}

function expectSftpCleanupSnapshot (snapshot) {
  expect(snapshot.idleStable).toBe(true)
  expect(snapshot.busy).toBe(false)
  expect(snapshot.refreshIdle).toBe(true)
  expect(snapshot.fullySettled).toBe(true)
  expect(snapshot.visibleRemoteCommitted).toBe(true)
  expect(snapshot.firstReadyCommitted).toBe(true)
  expect(snapshot.explicitOpenPending).toBe(false)
  expect(snapshot.sessionBindingPending).toBe(false)
  expect(snapshot.backgroundTaskCount).toBe(0)
  expect(snapshot.renderCommitCount).toBe(0)
  expect(snapshot.metricTaskCount).toBe(0)
  expect(snapshot.directoryRequestCount).toBe(0)
  expect(snapshot.activeLeaseCount).toBe(0)
  expect(snapshot.authoritativeActiveLeaseCount).toBe(0)
  expect(snapshot.uncertainLeaseCount).toBe(0)
  expect(snapshot.outputSuppressed).toBe(false)
  expect(snapshot.suppressionBufferCount).toBe(0)
  expect(snapshot.pendingInputCount).toBe(0)
}

test('secondary login elevation keeps half-screen SFTP internals invisible', async () => {
  const { config: rootConfig, missingEnvironmentVariables } = readRootConfig()
  test.skip(
    missingEnvironmentVariables.length > 0,
    `缺少真实服务器测试环境变量：${missingEnvironmentVariables.join(', ')}`
  )
  console.log('[041] provisioning start')
  const secondary = await createTemporarySudoUser(rootConfig)
  console.log('[041] provisioning complete')
  let run
  try {
    console.log('[041] login app start')
    run = await launchQualityApp(electron)
    console.log('[041] login connection start')
    await connectRealServer(run.page, { ...rootConfig, ...secondary })
    console.log('[041] login ready')
    expectNoTerminalLeak(await terminalOutputSignals(run.page, 0))

    const sudoStart = await terminalBufferLength(run.page)
    console.log('[041] elevation start')
    await sendTerminalText(run.page, 'sudo -k -i')
    await expect.poll(async () => (
      await terminalOutputSignals(run.page, sudoStart)
    ).passwordPromptSeen, {
      timeout: 10000
    }).toBe(true)
    await sendTerminalText(run.page, secondary.password)
    await expect.poll(async () => (
      await terminalOutputSignals(run.page, sudoStart)
    ).promptRecovered, { timeout: 15000 }).toBe(true)
    console.log('[041] elevation complete')

    const durations = []
    const cycleTimings = []
    let visibleStart = await terminalBufferLength(run.page)
    for (let cycle = 0; cycle < 3; cycle += 1) {
      console.log(`[041] half-SFTP cycle ${cycle + 1} start`)
      const timing = await openHalfSftp(run.page)
      expectSftpCleanupSnapshot(timing.cleanup)
      durations.push(timing.totalMs)
      cycleTimings.push(timing)
      console.log(`[041] half-SFTP cycle ${cycle + 1} metrics`, timing)
      const identitySignals = await run.page.evaluate(expectedLogin => {
        const entry = window.refs.get('sftp-' + window.store.activeTabId)
        const identity = entry?.state.remoteFileIdentity
        return {
          privilegedChannel: identity?.channel === 'pty-root',
          effectiveRoot: identity?.effectiveUid === '0',
          loginMatches: identity?.loginUsername === expectedLogin
        }
      }, secondary.username)
      expect(identitySignals).toEqual({
        privilegedChannel: true,
        effectiveRoot: true,
        loginMatches: true
      })
      expectNoTerminalLeak(
        await terminalOutputSignals(run.page, visibleStart)
      )
      await showTerminal(run.page)
      console.log(`[041] half-SFTP cycle ${cycle + 1} complete`)
      visibleStart = await terminalBufferLength(run.page)
    }
    console.log('[041] half-SFTP totals', durations)
    const firstReady = cycleTimings[0].metrics.first_sftp_ready_ms
    const firstRefresh = cycleTimings[0].metrics.sftp_refresh_ms
    expect(firstReady.sampleDelta).toBe(1)
    expect(firstReady.latestMs).toBeGreaterThan(0)
    expect(firstReady.latestMs).toBeLessThan(5000)
    expect(firstRefresh.sampleDelta).toBe(1)
    expect(firstRefresh.latestMs).toBeGreaterThan(0)
    expect(firstRefresh.latestMs).toBeLessThan(5000)
    for (const timing of cycleTimings.slice(1)) {
      const warmFirstReady = timing.metrics.first_sftp_ready_ms
      const warmRefresh = timing.metrics.sftp_refresh_ms
      const cachedPaint = timing.metrics.sftp_cached_paint_ms
      expect(warmFirstReady.sampleDelta).toBe(0)
      expect(warmRefresh.sampleDelta).toBe(0)
      expect(cachedPaint.sampleDelta).toBe(0)
      expect(timing.cleanup.requestEpoch).toBe(
        cycleTimings[0].cleanup.requestEpoch
      )
      expect(timing.totalMs).toBeLessThan(1500)
      expect(timing.cleanup.idleStable).toBe(true)
    }
    expect(Math.max(...durations.slice(1))).toBeLessThan(1500)
    await waitForSftpTaskIdle(run.page)

    const { markerTypedBytes, markerExpectedOutput } = randomMarkerProof()
    const beforeInput = await terminalBufferLength(run.page)
    await sendTerminalText(run.page, markerTypedBytes)
    await expect.poll(async () => {
      const signals = await terminalOutputSignals(
        run.page,
        beforeInput,
        markerExpectedOutput
      )
      return {
        expectedOutputSeen: signals.expectedOutputSeen,
        promptRecovered: signals.promptRecovered,
        internalLeakDetected: signals.internalLeakDetected,
        probeLeakDetected: signals.probeLeakDetected
      }
    }, { timeout: 10000 }).toEqual({
      expectedOutputSeen: true,
      promptRecovered: true,
      internalLeakDetected: false,
      probeLeakDetected: false
    })
    console.log('[041] login keyboard marker verified')
  } finally {
    console.log('[041] cleanup app start')
    if (run) await cleanupQualityApp(run.electronApp, run.profileRoot)
    console.log('[041] cleanup identity start')
    await removeTemporarySudoUser(rootConfig, secondary.username)
    console.log('[041] cleanup complete')
  }
})
