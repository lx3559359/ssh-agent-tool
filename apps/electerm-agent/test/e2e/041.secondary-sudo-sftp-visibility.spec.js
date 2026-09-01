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
const internalTerminalPattern = /__sp_|SHELLPILOT_(?:FILE|OPS|TOKEN)/
const leakedProbePattern = /shellpilot\s+root\s+one\s+read/i

test.setTimeout(180000)

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
    client.once('error', reject)
    client.connect({ ...config, readyTimeout: 30000 })
  })
}

function execRemote (client, command, input = '') {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error)
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
        finish(reject)(new Error(`Provisioning request failed (${code}): ${stderr.trim()}`))
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

async function terminalState (page) {
  return page.evaluate(() => {
    const terminal = window.refs.get('term-' + window.store.activeTabId)
    let text = ''
    try {
      text = terminal?.getTerminalBufferText?.() || ''
    } catch {}
    return {
      ready: Boolean(
        terminal?.term &&
        terminal?.attachAddon &&
        terminal?.pid &&
        !terminal?.onClose
      ),
      text
    }
  })
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
  await expect.poll(async () => (await terminalState(page)).ready, {
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
    return Boolean(
      entry?.sftp &&
      entry.state.inited &&
      entry.state.remoteLoading === false
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
    idleStable: idleSnapshot.idleStable,
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

async function sftpTaskState (page) {
  return page.evaluate(() => {
    const terminal = window.refs.get('term-' + window.store.activeTabId)
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    const refreshState = String(entry?.state.remoteRefreshState || '')
    return {
      idle: Boolean(
        terminal?.operationsPtyTaskController?.isBusy?.() !== true &&
        entry?.state.remoteLoading === false &&
        !['refreshing', 'cached-refreshing'].includes(refreshState)
      ),
      refreshState
    }
  })
}

async function waitForSftpTaskIdle (page, stableMs = 250) {
  let stableSnapshot
  await expect.poll(async () => {
    const before = await sftpTaskState(page)
    if (!before.idle) return false
    await page.waitForTimeout(stableMs)
    const after = await sftpTaskState(page)
    const stable = Boolean(
      after.idle && after.refreshState === before.refreshState
    )
    if (stable) stableSnapshot = after
    return stable
  }, { timeout: 30000 }).toBe(true)
  return {
    ...stableSnapshot,
    idleStable: true
  }
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
    await run.page.waitForTimeout(1500)
    console.log('[041] login ready')
    const loginText = (await terminalState(run.page)).text
    expect(loginText).not.toMatch(internalTerminalPattern)
    expect(loginText).not.toMatch(leakedProbePattern)

    const sudoStart = loginText.length
    console.log('[041] elevation start')
    await sendTerminalText(run.page, 'sudo -k -i')
    await run.page.waitForTimeout(2000)
    await expect.poll(async () => (
      await terminalState(run.page)
    ).text.slice(sudoStart).toLowerCase(), {
      timeout: 10000
    }).toContain('password')
    await sendTerminalText(run.page, secondary.password)
    await expect.poll(async () => (
      await terminalState(run.page)
    ).text.slice(sudoStart), { timeout: 15000 }).toMatch(/#\s*$/)
    console.log('[041] elevation complete')

    const durations = []
    const cycleTimings = []
    let visibleStart = (await terminalState(run.page)).text.length
    for (let cycle = 0; cycle < 3; cycle += 1) {
      console.log(`[041] half-SFTP cycle ${cycle + 1} start`)
      const timing = await openHalfSftp(run.page)
      durations.push(timing.totalMs)
      cycleTimings.push(timing)
      console.log(`[041] half-SFTP cycle ${cycle + 1} metrics`, timing)
      const identity = await run.page.evaluate(() => {
        const entry = window.refs.get('sftp-' + window.store.activeTabId)
        return entry?.state.remoteFileIdentity || null
      })
      expect(identity?.channel).toBe('pty-root')
      expect(identity?.effectiveUid).toBe('0')
      expect(identity?.loginUsername).toBe(secondary.username)
      const terminalText = (await terminalState(run.page)).text
      const visibleDelta = terminalText.slice(visibleStart)
      expect(visibleDelta).not.toMatch(internalTerminalPattern)
      expect(visibleDelta).not.toMatch(leakedProbePattern)
      await showTerminal(run.page)
      console.log(`[041] half-SFTP cycle ${cycle + 1} complete`)
      visibleStart = (await terminalState(run.page)).text.length
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
      expect([0, 1]).toContain(cachedPaint.sampleDelta)
      if (cachedPaint.sampleDelta === 1) {
        expect(cachedPaint.latestMs).toBeGreaterThan(0)
        expect(cachedPaint.latestMs).toBeLessThan(1500)
      } else {
        expect(warmRefresh.sampleDelta).toBe(0)
        expect(timing.totalMs).toBeLessThan(1500)
        expect(timing.idleStable).toBe(true)
      }
    }
    expect(Math.max(...durations.slice(1))).toBeLessThan(1500)
    await waitForSftpTaskIdle(run.page)

    const inputMarker = 'shellpilot-secondary-terminal-ok'
    const beforeInput = (await terminalState(run.page)).text.length
    await sendTerminalText(run.page, `printf '${inputMarker}\\n'`)
    await expect.poll(async () => (
      await terminalState(run.page)
    ).text.slice(beforeInput), { timeout: 10000 }).toContain(inputMarker)
    console.log('[041] login keyboard marker verified')
  } finally {
    console.log('[041] cleanup app start')
    if (run) await cleanupQualityApp(run.electronApp, run.profileRoot)
    console.log('[041] cleanup identity start')
    await removeTemporarySudoUser(rootConfig, secondary.username)
    console.log('[041] cleanup complete')
  }
})
