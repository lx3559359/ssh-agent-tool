const crypto = require('node:crypto')
const { promises: fs } = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron, expect, test } = require('@playwright/test')
const { Client: SshClient } = require('@electerm/ssh2')
const extendClient = require('./common/client-extend')
const {
  assertSafeQualityRoot,
  cleanupQualityApp,
  forceKillQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')
const {
  copyItemWithKeyboard,
  enterFolder,
  getVisibleMenuItem,
  navigateToParentFolder,
  pasteItemWithKeyboard,
  renameItem,
  verifyFileExists,
  verifyFileTransfersComplete
} = require('./common/common')

const loopbackHost = '127.0.0.1'
const requiredEnvironmentVariables = Object.freeze([
  'SHELLPILOT_E2E_HOST',
  'SHELLPILOT_E2E_PORT',
  'SHELLPILOT_E2E_USERNAME',
  'SHELLPILOT_E2E_PASSWORD',
  'SHELLPILOT_E2E_REMOTE_ROOT'
])
const protectedServiceSnapshotCommand = Object.freeze([
  'set -eu',
  'export LC_ALL=C',
  'if command -v systemctl >/dev/null 2>&1; then',
  '  systemctl show x-ui --no-pager --property=LoadState --property=ActiveState --property=SubState --property=MainPID --property=ExecMainStartTimestampMonotonic --property=FragmentPath || true',
  '  systemctl cat x-ui --no-pager | sha256sum || true',
  "  systemctl list-units --type=service --state=running --no-legend --no-pager | awk '{print $1}' | sort",
  'fi',
  'if command -v ss >/dev/null 2>&1; then',
  "  ss -H -lnt | awk '{print $1 \"|\" $4}' | sort -u",
  'fi',
  'if command -v docker >/dev/null 2>&1; then',
  "  docker ps --format '{{.Names}}|{{.Image}}|{{.State}}' | sort",
  'fi',
  'for file in /etc/systemd/system/x-ui.service /usr/lib/systemd/system/x-ui.service /usr/local/x-ui/x-ui /usr/bin/x-ui; do',
  '  if [ -f "$file" ]; then sha256sum "$file"; fi',
  'done'
]).join('\n')

let protectedServiceBaseline = ''

test.setTimeout(360000)
test.describe.configure({ mode: 'serial' })

function readConfig () {
  const values = Object.fromEntries(requiredEnvironmentVariables.map(name => [
    name,
    name === 'SHELLPILOT_E2E_PASSWORD'
      ? process.env[name] || ''
      : String(process.env[name] || '').trim()
  ]))
  const missing = requiredEnvironmentVariables.filter(name => !values[name])
  if (missing.length) return { config: null, missing }
  const port = Number(values.SHELLPILOT_E2E_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SHELLPILOT_E2E_PORT must be an integer between 1 and 65535')
  }
  const remoteRoot = path.posix.normalize(values.SHELLPILOT_E2E_REMOTE_ROOT)
    .replace(/\/+$/, '')
  if (remoteRoot !== '/tmp' && !remoteRoot.startsWith('/tmp/')) {
    throw new Error('External acceptance is restricted to /tmp')
  }
  return {
    config: {
      host: values.SHELLPILOT_E2E_HOST,
      port,
      username: values.SHELLPILOT_E2E_USERNAME,
      password: values.SHELLPILOT_E2E_PASSWORD,
      remoteRoot
    },
    missing
  }
}

test.beforeAll(async () => {
  const { config, missing } = readConfig()
  if (missing.length) return
  protectedServiceBaseline = await protectedServiceStateDigest(config)
})

test.afterAll(async () => {
  if (!protectedServiceBaseline) return
  const { config, missing } = readConfig()
  if (missing.length) return
  const current = await protectedServiceStateDigest(config)
  if (current !== protectedServiceBaseline) {
    throw new Error(
      'Protected remote service fingerprint changed; x-ui and existing service acceptance cannot pass'
    )
  }
})

function sandboxChild (sandboxPath, name) {
  const candidate = path.posix.resolve(sandboxPath, name)
  if (!candidate.startsWith(path.posix.resolve(sandboxPath) + '/')) {
    throw new Error('Refusing to access a path outside the external acceptance sandbox')
  }
  return candidate
}

async function acceptHostKeyIfPrompted (page) {
  const modal = page.locator('.custom-modal-wrap')
    .filter({ hasText: 'SHA256:' })
    .last()
  if (!await modal.isVisible({ timeout: 10000 }).catch(() => false)) return
  await modal.locator('button.custom-modal-ok-btn, button.ant-btn-primary')
    .last()
    .click()
}

async function connectRealServer (page, config) {
  await page.evaluate(server => window.store.mcpOpenTab({
    type: 'ssh',
    title: 'External acceptance',
    host: server.host,
    port: server.port,
    username: server.username,
    password: server.password,
    authType: 'password',
    useSshAgent: false,
    enableSsh: true,
    enableSftp: true
  }), config)
  await acceptHostKeyIfPrompted(page)
  await expect.poll(() => page.evaluate(() => {
    const terminal = window.refs.get('term-' + window.store.activeTabId)
    return Boolean(terminal?.pid && terminal?.hostKeyFingerprint)
  }), { timeout: 30000 }).toBe(true)
}

async function openSftp (page) {
  await page.locator('.session-current .term-sftp-tabs .type-tab:visible').nth(1).click()
  await expect.poll(() => page.evaluate(() => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    return Boolean(entry?.sftp && entry.state.remoteLoading === false)
  }), { timeout: 30000 }).toBe(true)
}

async function createRemoteSandbox (page, sandboxPath) {
  await page.evaluate(async targetPath => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    await entry.sftp.mkdir(targetPath)
  }, sandboxPath)
}

async function setPanePath (page, type, targetPath) {
  const input = page.locator(
    `.session-current .sftp-${type}-section .sftp-title input`
  )
  await input.fill(targetPath)
  await input.press('Enter')
  await expect.poll(() => page.evaluate(type => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    return {
      loading: entry?.state?.[`${type}Loading`],
      path: entry?.state?.[`${type}Path`]
    }
  }, type), { timeout: 30000 }).toEqual({ loading: false, path: targetPath })
}

async function createItemFromContextMenu (page, type, kind, name) {
  await page.locator(`.session-current .file-list.${type} .parent-file-item`)
    .click({ button: 'right' })
  await (await getVisibleMenuItem(page, kind)).click()
  const input = page.locator(
    `.session-current .file-list.${type} .sftp-item input`
  ).last()
  await input.fill(name)
  await page.locator('.session-current .sftp-panel-title').first().click()
  await expect(page.locator(
    `.session-current .file-list.${type} .sftp-item[title="${name}"]`
  )).toBeVisible({ timeout: 30000 })
}

async function createFixtureFile (page, type, name, content = '') {
  await page.evaluate(async ({ type, name, content }) => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    const separator = type === 'local' ? '\\' : '/'
    const base = entry.state[`${type}Path`].replace(/[\\/]$/, '')
    const targetPath = `${base}${separator}${name}`
    if (type === 'local') await window.fs.writeFile(targetPath, content)
    else await entry.sftp.writeFile(targetPath, content)
    await entry[`${type}List`]()
  }, { type, name, content })
  await expect(page.locator(
    `.session-current .file-list.${type} .sftp-item[title="${name}"]`
  )).toBeVisible({ timeout: 30000 })
}

async function createFixtureFolder (page, type, name) {
  await page.evaluate(async ({ type, name }) => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    const separator = type === 'local' ? '\\' : '/'
    const base = entry.state[`${type}Path`].replace(/[\\/]$/, '')
    const targetPath = `${base}${separator}${name}`
    if (type === 'local') await window.fs.mkdir(targetPath)
    else await entry.sftp.mkdir(targetPath)
    await entry[`${type}List`]()
  }, { type, name })
}

async function dragItem (page, sourceSelector, targetSelector) {
  const source = await page.locator(sourceSelector).boundingBox()
  const target = await page.locator(targetSelector).boundingBox()
  expect(source).toBeTruthy()
  expect(target).toBeTruthy()
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2
  )
  await page.mouse.down()
  await page.waitForTimeout(500)
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 20 }
  )
  await page.waitForTimeout(500)
  await page.mouse.up()
  await page.waitForTimeout(3000)
  await verifyFileTransfersComplete(page)
}

async function enterFolderByDoubleClick (page, type, folderName) {
  const item = page.locator(
    `.session-current .file-list.${type} .sftp-item[title="${folderName}"]`
  )
  await expect(item).toBeVisible()
  await item.dblclick()
  await expect.poll(() => page.evaluate(type => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    return {
      loading: entry.state[`${type}Loading`],
      path: entry.state[`${type}Path`]
    }
  }, type)).toEqual({
    loading: false,
    path: expect.stringMatching(new RegExp(`[/\\\\]${folderName}$`))
  })
}

async function editRemoteFile (page, name, content) {
  await page.locator(
    `.session-current .file-list.remote .sftp-item[title="${name}"]`
  ).click({ button: 'right' })
  await page.locator('.ant-dropdown:visible .ant-dropdown-menu-item')
    .filter({ hasText: /编辑|Edit/i })
    .first()
    .click()
  const textarea = page.locator('.custom-modal-wrap .custom-modal-body textarea')
  await expect(textarea).toBeVisible()
  await textarea.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]) await textarea.pressSequentially(lines[index])
    if (index < lines.length - 1) await page.keyboard.press('Enter')
  }
  await expect(textarea).toHaveValue(content)
  const editorDialog = textarea.locator(
    'xpath=ancestor::div[contains(@class,"custom-modal-content")]'
  )
  const saveButton = editorDialog.locator('button.ant-btn-primary').first()
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  const safetyConfirmation = page.locator('.sftp-safety-confirmation:visible')
  await expect(safetyConfirmation).toBeVisible({ timeout: 60000 })
  const safetyConfirm = safetyConfirmation.locator(
    'xpath=ancestor::div[contains(@class,"custom-modal-wrap")]'
  ).locator('button.custom-modal-ok-btn')
  await safetyConfirm.click()
  await expect(textarea).toBeHidden({ timeout: 30000 })
  await page.locator(
    `.session-current .file-list.remote .sftp-item[title="${name}"]`
  ).dblclick()
  await expect(textarea).toHaveValue(content)
  await textarea.locator(
    'xpath=ancestor::div[contains(@class,"custom-modal-content")]'
  ).locator('button.ant-btn-dashed').last().click()
}

async function changeRemotePermission (page, name, targetPath) {
  const item = page.locator(
    `.session-current .file-list.remote .sftp-item[title="${name}"]`
  )
  await item.click({ button: 'right' })
  await (await getVisibleMenuItem(page, 'editPermission')).click()
  const permissionButton = page
    .locator('.custom-modal-container .file-props > .pd1b > .pd1b')
    .filter({ hasText: /其他|other/i })
    .locator('.ant-btn')
    .filter({ hasText: /写|write/i })
    .first()
  await expect(permissionButton).toBeVisible()
  const initiallyActive = String(await permissionButton.getAttribute('class'))
    .includes('ant-btn-primary')
  await permissionButton.click()
  await expect.poll(async () => {
    return String(await permissionButton.getAttribute('class'))
      .includes('ant-btn-primary')
  }).toBe(!initiallyActive)
  await page.locator('.custom-modal-footer .ant-btn-primary').click()
  const safetyConfirmation = page.locator('.sftp-safety-confirmation:visible')
  await expect(safetyConfirmation).toBeVisible({ timeout: 30000 })
  await safetyConfirmation.locator(
    'xpath=ancestor::div[contains(@class,"custom-modal-wrap")]'
  ).locator('button.custom-modal-ok-btn').click()
  await expect.poll(() => page.evaluate(async targetPath => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    const stat = await entry.sftp.lstat(targetPath)
    return Boolean(stat.mode & 0o2)
  }, targetPath), { timeout: 30000 }).toBe(!initiallyActive)
}

async function deleteRemoteFileWithKeyboard (page, name, targetPath) {
  const item = page.locator(
    `.session-current .file-list.remote .sftp-item[title="${name}"]`
  )
  await item.click()
  await page.keyboard.press('Delete')
  const confirm = page.locator(
    '.custom-modal-wrap button.custom-modal-ok-btn:visible'
  ).first()
  await expect(confirm).toBeVisible({ timeout: 30000 })
  await confirm.click()
  await expect.poll(() => page.evaluate(async targetPath => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    try {
      await entry.sftp.lstat(targetPath)
      return true
    } catch {
      return false
    }
  }, targetPath), { timeout: 30000 }).toBe(false)
  await expect(item).toHaveCount(0, { timeout: 30000 })
}

async function removeRemoteSandbox (page, sandboxPath) {
  await page.evaluate(async targetPath => {
    const entry = window.refs.get('sftp-' + window.store.activeTabId)
    await entry.sftp.removeEntry(targetPath)
  }, sandboxPath)
}

async function cleanupRun (run) {
  const cleanupPromise = cleanupQualityApp(run.electronApp, run.profileRoot)
  const result = await Promise.race([
    cleanupPromise.then(() => 'done'),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 8000))
  ])
  if (result === 'done') return
  cleanupPromise.catch(() => {})
  await forceKillQualityApp(run.electronApp)
  await fs.rm(assertSafeQualityRoot(run.profileRoot), {
    recursive: true,
    force: true
  })
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

async function listenResponder (marker) {
  const sockets = new Set()
  const server = net.createServer(socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.end(marker + '\n')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, loopbackHost, resolve)
  })
  return {
    port: server.address().port,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      if (!server.listening) return
      await Promise.race([
        new Promise(resolve => server.close(() => resolve())),
        new Promise(resolve => setTimeout(resolve, 3000))
      ])
    }
  }
}

async function knownHostHashes (config) {
  const knownHostsPath = path.join(os.homedir(), '.ssh', 'known_hosts')
  const text = await fs.readFile(knownHostsPath, 'utf8')
  const acceptedHosts = new Set([
    config.host,
    `[${config.host}]:${config.port}`
  ])
  const hashes = new Set()
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 3 || fields[0].startsWith('#')) continue
    const names = fields[0].split(',')
    if (!names.some(name => acceptedHosts.has(name))) continue
    const key = Buffer.from(fields[2], 'base64')
    hashes.add(crypto.createHash('sha256').update(key).digest('hex'))
  }
  if (!hashes.size) {
    throw new Error('Real server host key is absent from known_hosts')
  }
  return hashes
}

async function seedKnownHost (profileRoot, config) {
  const knownHostsPath = path.join(os.homedir(), '.ssh', 'known_hosts')
  const text = await fs.readFile(knownHostsPath, 'utf8')
  const acceptedHosts = new Set([
    config.host,
    `[${config.host}]:${config.port}`
  ])
  const matchingLines = text.split(/\r?\n/).filter(line => {
    const names = line.trim().split(/\s+/)[0]?.split(',') || []
    return names.some(name => acceptedHosts.has(name))
  })
  if (!matchingLines.length) {
    throw new Error('Real server host key is absent from known_hosts')
  }
  const targetPath = path.join(profileRoot, '.ssh', 'known_hosts')
  await fs.writeFile(targetPath, matchingLines.join('\n') + '\n', {
    encoding: 'utf8',
    mode: 0o600
  })
}

async function launchExternalAcceptanceApp (config) {
  const run = await launchQualityApp(electron)
  await seedKnownHost(run.profileRoot, config)
  return run
}

async function protectedServiceStateDigest (config) {
  const acceptedHashes = await knownHostHashes(config)
  const conn = new SshClient()
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => finish(
      new Error('Protected remote service fingerprint timed out')
    ), 20000)
    const finish = (error, output = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      conn.end()
      if (error) reject(error)
      else {
        resolve(crypto.createHash('sha256').update(output).digest('hex'))
      }
    }
    conn.once('error', finish)
    conn.once('ready', () => {
      conn.exec(protectedServiceSnapshotCommand, (error, stream) => {
        if (error) return finish(error)
        let output = ''
        let stderrBytes = 0
        stream.once('error', finish)
        stream.on('data', chunk => {
          output += chunk.toString('utf8')
          if (output.length > 256 * 1024) {
            finish(new Error('Protected remote service fingerprint exceeded its output limit'))
          }
        })
        stream.stderr.on('data', chunk => {
          stderrBytes += chunk.length
          if (stderrBytes > 64 * 1024) {
            finish(new Error('Protected remote service fingerprint exceeded its error limit'))
          }
        })
        stream.once('close', code => {
          if (code !== 0) {
            finish(new Error('Protected remote service fingerprint command failed'))
          } else if (!output.trim()) {
            finish(new Error('Protected remote service fingerprint was empty'))
          } else {
            finish(null, output)
          }
        })
      })
    })
    conn.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      hostHash: 'sha256',
      hostVerifier: hash => acceptedHashes.has(hash),
      readyTimeout: 20000
    })
  })
}

async function readRemoteListener (config, remotePort) {
  const acceptedHashes = await knownHostHashes(config)
  const conn = new SshClient()
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => finish(new Error('Remote listener probe timed out')), 20000)
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      conn.end()
      if (error) reject(error)
      else resolve(value)
    }
    conn.once('error', finish)
    conn.once('ready', () => {
      conn.forwardOut(loopbackHost, 0, loopbackHost, remotePort, (error, stream) => {
        if (error) return finish(error)
        let output = ''
        stream.once('error', finish)
        stream.on('data', chunk => {
          output += chunk.toString('utf8')
          if (output.includes('\n')) {
            stream.destroy()
            finish(null, output.trim())
          }
        })
      })
    })
    conn.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      hostHash: 'sha256',
      hostVerifier: hash => acceptedHashes.has(hash),
      readyTimeout: 20000
    })
  })
}

async function openTunnelManager (page) {
  await page.getByRole('button', { name: 'SSH 隧道' }).click()
  const modal = page.locator('.ssh-tunnel-modal')
  await expect(modal).toBeVisible()
  return modal
}

async function stopTunnel (card) {
  await card.getByRole('button', { name: '停止' }).click()
  await expect(card).toHaveCount(0)
}

async function readSshBannerThroughSocks5 (port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: loopbackHost, port })
    let phase = 'greeting'
    let buffered = Buffer.alloc(0)
    const timer = setTimeout(() => finish(new Error('SOCKS5 probe timed out')), 12000)
    const finish = (error, value) => {
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    socket.once('error', finish)
    socket.once('connect', () => socket.write(Buffer.from([5, 1, 0])))
    socket.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk])
      if (phase === 'greeting' && buffered.length >= 2) {
        if (buffered[0] !== 5 || buffered[1] !== 0) {
          return finish(new Error('SOCKS5 authentication negotiation failed'))
        }
        buffered = buffered.subarray(2)
        phase = 'connect'
        socket.write(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, 0, 22]))
      }
      if (phase === 'connect' && buffered.length >= 10) {
        if (buffered[0] !== 5 || buffered[1] !== 0) {
          return finish(new Error(`SOCKS5 connect failed with code ${buffered[1]}`))
        }
        buffered = buffered.subarray(10)
        phase = 'banner'
      }
      if (phase === 'banner') {
        const text = buffered.toString('utf8')
        if (text.includes('\n')) finish(null, text.trim())
      }
    })
  })
}

async function expectConnectionClosedWithoutData (port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: loopbackHost, port })
    let received = 0
    const timer = setTimeout(() => finish(new Error('Refused destination did not close')), 12000)
    const finish = error => {
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve()
    }
    socket.once('error', error => {
      if (error.code === 'ECONNRESET') finish()
      else finish(error)
    })
    socket.on('data', chunk => { received += chunk.length })
    socket.once('close', () => {
      if (received) finish(new Error('Refused destination unexpectedly returned data'))
      else finish()
    })
  })
}

test('credentialed desktop SFTP keeps navigation and operations inside one /tmp sandbox', async () => {
  const { config, missing } = readConfig()
  test.skip(missing.length > 0, `缺少真实服务器测试环境变量：${missing.join(', ')}`)
  const token = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const sandboxPath = path.posix.join(config.remoteRoot, `.shellpilot-e2e-ui-${token}`)
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-real-sftp-ui-'))
  let run
  let remoteCreated = false
  let primaryError
  let cleanupError

  try {
    run = await launchExternalAcceptanceApp(config)
    extendClient(run.page, run.electronApp)
    await connectRealServer(run.page, config)
    await openSftp(run.page)
    await createRemoteSandbox(run.page, sandboxPath)
    remoteCreated = true
    await setPanePath(run.page, 'remote', sandboxPath)
    await setPanePath(run.page, 'local', localRoot)

    await expect(run.page.locator('.session-current .file-list.local')).toBeVisible()
    await expect(run.page.locator('.session-current .file-list.remote')).toBeVisible()
    await expect(run.page.locator('.session-current .sftp-local-section .sftp-title input'))
      .toHaveValue(localRoot)
    await expect(run.page.locator('.session-current .sftp-remote-section .sftp-title input'))
      .toHaveValue(sandboxPath)

    const uiFolder = `ui-folder-${token}`
    const uiFile = `ui-file-${token}.txt`
    await createItemFromContextMenu(run.page, 'remote', 'newFolder', uiFolder)
    await createItemFromContextMenu(run.page, 'remote', 'newFile', uiFile)
    await enterFolder(run.page, 'remote', uiFolder)
    await expect(run.page.locator('.session-current .sftp-remote-section .sftp-title input'))
      .toHaveValue(sandboxChild(sandboxPath, uiFolder))
    await navigateToParentFolder(run.page, 'remote')

    const beforeSort = await run.page.evaluate(() => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      return {
        direction: entry.state['sortDirection.remote'],
        prop: entry.state['sortProp.remote']
      }
    })
    await run.page.locator(
      '.session-current .file-list.remote .sftp-header-box[data-id="name"]'
    ).click()
    await expect.poll(() => run.page.evaluate(() => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      return {
        direction: entry.state['sortDirection.remote'],
        prop: entry.state['sortProp.remote']
      }
    })).not.toEqual(beforeSort)
    await run.page.locator(
      '.session-current .sftp-remote-section .sftp-title .anticon-reload'
    ).click()
    await expect.poll(() => run.page.evaluate(() => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      return entry.state.remoteLoading
    })).toBe(false)

    const remoteFiles = [
      `remote-a-${token}.txt`,
      `remote-b-${token}.txt`,
      `remote-c-${token}.txt`
    ]
    for (const name of remoteFiles) await createFixtureFile(run.page, 'remote', name, name)
    const moveTarget = `move-target-${token}`
    await createFixtureFolder(run.page, 'remote', moveTarget)

    const filterIcon = run.page.locator(
      '.session-current .sftp-remote-section .keyword-filter-icon'
    )
    await filterIcon.click()
    const filterInput = run.page.locator(
      '.ant-tooltip:visible .keyword-filter-input input'
    )
    await filterInput.fill(remoteFiles[0])
    await filterInput.press('Enter')
    await expect(run.page.locator(
      `.session-current .file-list.remote .sftp-item[title="${remoteFiles[0]}"]`
    )).toBeVisible()
    await expect(run.page.locator(
      `.session-current .file-list.remote .sftp-item[title="${remoteFiles[1]}"]`
    )).toHaveCount(0)
    await run.page.evaluate(() => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      entry.updateKeyword('', 'remote')
    })

    const first = run.page.locator(
      `.session-current .file-list.remote .sftp-item[title="${remoteFiles[0]}"]`
    )
    const second = run.page.locator(
      `.session-current .file-list.remote .sftp-item[title="${remoteFiles[1]}"]`
    )
    await first.click()
    await second.click({ modifiers: ['Control'] })
    await expect(first).toHaveClass(/selected/)
    await expect(second).toHaveClass(/selected/)
    await dragItem(
      run.page,
      `.session-current .file-list.remote .sftp-item[title="${remoteFiles[0]}"]`,
      `.session-current .file-list.remote .sftp-item[title="${moveTarget}"]`
    )
    await enterFolderByDoubleClick(run.page, 'remote', moveTarget)
    expect(await verifyFileExists(run.page, 'remote', remoteFiles[0])).toBe(true)
    expect(await verifyFileExists(run.page, 'remote', remoteFiles[1])).toBe(true)
    await navigateToParentFolder(run.page, 'remote')

    const third = run.page.locator(
      `.session-current .file-list.remote .sftp-item[title="${remoteFiles[2]}"]`
    )
    const contextPeer = run.page.locator(
      `.session-current .file-list.remote .sftp-item[title="${uiFile}"]`
    )
    await third.click()
    await contextPeer.click({ modifiers: ['Control'] })
    await third.click({ button: 'right' })
    await expect(await getVisibleMenuItem(run.page, 'copy')).toBeVisible()
    await run.page.keyboard.press('Escape')
    await expect(third).toHaveClass(/selected/)
    await expect(contextPeer).toHaveClass(/selected/)

    await copyItemWithKeyboard(run.page, 'remote', remoteFiles[2])
    await pasteItemWithKeyboard(run.page, 'remote', { resolveConflict: 'rename' })
    await verifyFileTransfersComplete(run.page)
    let copiedName
    await expect.poll(async () => {
      copiedName = await run.page.evaluate(name => {
        const entry = window.refs.get('sftp-' + window.store.activeTabId)
        const base = name.replace(/\.txt$/, '')
        return entry.state.remote.map(item => item.name)
          .find(item => item.startsWith(`${base}(rename-`) && item.endsWith('.txt'))
      }, remoteFiles[2])
      return Boolean(copiedName)
    }, { timeout: 30000 }).toBe(true)

    const renamedFile = `renamed-${token}.txt`
    await renameItem(run.page, 'remote', remoteFiles[2], renamedFile)
    const editedText = `ShellPilot real SFTP UI ${token}\n`
    await editRemoteFile(run.page, renamedFile, editedText)
    await changeRemotePermission(
      run.page,
      renamedFile,
      sandboxChild(sandboxPath, renamedFile)
    )

    const uploadName = `upload-${token}.txt`
    const uploadTarget = `upload-target-${token}`
    await createFixtureFile(run.page, 'local', uploadName, uploadName)
    await createFixtureFolder(run.page, 'remote', uploadTarget)
    const uploadTargetItem = run.page.locator(
      `.session-current .file-list.remote .sftp-item[title="${uploadTarget}"]`
    )
    await uploadTargetItem.scrollIntoViewIfNeeded()
    await expect(uploadTargetItem).toBeVisible()
    await dragItem(
      run.page,
      `.session-current .file-list.local .sftp-item[title="${uploadName}"]`,
      `.session-current .file-list.remote .sftp-item[title="${uploadTarget}"]`
    )
    const uploadedPath = sandboxChild(
      sandboxChild(sandboxPath, uploadTarget),
      uploadName
    )
    await expect.poll(() => run.page.evaluate(async targetPath => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      try {
        await entry.sftp.lstat(targetPath)
        return true
      } catch {
        return false
      }
    }, uploadedPath), { timeout: 30000 }).toBe(true)
    await enterFolderByDoubleClick(run.page, 'remote', uploadTarget)
    expect(await verifyFileExists(run.page, 'remote', uploadName)).toBe(true)
    await navigateToParentFolder(run.page, 'remote')

    const downloadName = `download-${token}.txt`
    await createFixtureFile(run.page, 'remote', downloadName, downloadName)
    await run.page.locator(
      `.session-current .file-list.remote .sftp-item[title="${downloadName}"]`
    ).click({ button: 'right' })
    await run.page.locator(
      '.ant-dropdown:visible .ant-dropdown-menu-item .anticon-cloud-download'
    ).click()
    await verifyFileTransfersComplete(run.page)
    expect(await verifyFileExists(run.page, 'local', downloadName)).toBe(true)

    await deleteRemoteFileWithKeyboard(
      run.page,
      copiedName,
      sandboxChild(sandboxPath, copiedName)
    )
  } catch (error) {
    primaryError = error
  } finally {
    if (remoteCreated && run?.page && !run.page.isClosed()) {
      await removeRemoteSandbox(run.page, sandboxPath).catch(error => {
        cleanupError = error
      })
    }
    if (run) {
      await cleanupRun(run).catch(error => {
        cleanupError ||= error
      })
    }
    await fs.rm(localRoot, { recursive: true, force: true }).catch(error => {
      cleanupError ||= error
    })
  }

  if (primaryError) {
    if (cleanupError) primaryError.cleanupError = cleanupError
    throw primaryError
  }
  if (cleanupError) throw cleanupError
})

test('credentialed desktop SFTP editor confirms and verifies a remote save', async () => {
  const { config, missing } = readConfig()
  test.skip(missing.length > 0, `缺少真实服务器测试环境变量：${missing.join(', ')}`)
  const token = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const sandboxPath = path.posix.join(config.remoteRoot, `.shellpilot-e2e-editor-${token}`)
  const fileName = `editor-${token}.txt`
  const content = `ShellPilot focused editor acceptance ${token}\n`
  let run
  let remoteCreated = false
  let primaryError
  let cleanupError

  try {
    run = await launchExternalAcceptanceApp(config)
    extendClient(run.page, run.electronApp)
    await connectRealServer(run.page, config)
    await openSftp(run.page)
    await createRemoteSandbox(run.page, sandboxPath)
    remoteCreated = true
    await setPanePath(run.page, 'remote', sandboxPath)
    await createFixtureFile(run.page, 'remote', fileName, 'before\n')
    await editRemoteFile(run.page, fileName, content)
    await changeRemotePermission(
      run.page,
      fileName,
      sandboxChild(sandboxPath, fileName)
    )
    await deleteRemoteFileWithKeyboard(
      run.page,
      fileName,
      sandboxChild(sandboxPath, fileName)
    )
  } catch (error) {
    primaryError = error
  } finally {
    if (remoteCreated && run?.page && !run.page.isClosed()) {
      await removeRemoteSandbox(run.page, sandboxPath).catch(error => {
        cleanupError = error
      })
    }
    if (run) {
      await cleanupRun(run).catch(error => {
        cleanupError ||= error
      })
    }
  }

  if (primaryError) {
    if (cleanupError) primaryError.cleanupError = cleanupError
    throw primaryError
  }
  if (cleanupError) throw cleanupError
})

test('credentialed desktop SFTP drag uploads into a remote folder', async () => {
  const { config, missing } = readConfig()
  test.skip(missing.length > 0, `缺少真实服务器测试环境变量：${missing.join(', ')}`)
  const token = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const sandboxPath = path.posix.join(config.remoteRoot, `.shellpilot-e2e-upload-${token}`)
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-real-upload-'))
  const fileName = `upload-${token}.txt`
  const folderName = `target-${token}`
  const targetPath = sandboxChild(sandboxChild(sandboxPath, folderName), fileName)
  let run
  let remoteCreated = false
  let primaryError
  let cleanupError

  try {
    run = await launchExternalAcceptanceApp(config)
    extendClient(run.page, run.electronApp)
    await connectRealServer(run.page, config)
    await openSftp(run.page)
    await createRemoteSandbox(run.page, sandboxPath)
    remoteCreated = true
    await setPanePath(run.page, 'remote', sandboxPath)
    await setPanePath(run.page, 'local', localRoot)
    await createFixtureFile(run.page, 'local', fileName, `${token}\n`)
    await createFixtureFolder(run.page, 'remote', folderName)
    await dragItem(
      run.page,
      `.session-current .file-list.local .sftp-item[title="${fileName}"]`,
      `.session-current .file-list.remote .sftp-item[title="${folderName}"]`
    )
    const result = await run.page.evaluate(async targetPath => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      let remoteExists = false
      try {
        await entry.sftp.lstat(targetPath)
        remoteExists = true
      } catch {}
      return {
        remoteExists,
        transferCount: window.store.fileTransfers.length,
        history: window.store.transferHistory.slice(-3).map(item => ({
          error: item.error || '',
          operation: item.operation || '',
          status: item.status || '',
          typeFrom: item.typeFrom || '',
          typeTo: item.typeTo || ''
        }))
      }
    }, targetPath)
    expect(result).toEqual({
      remoteExists: true,
      transferCount: 0,
      history: expect.arrayContaining([
        expect.objectContaining({
          error: '',
          status: 'success',
          typeFrom: 'local',
          typeTo: 'remote'
        })
      ])
    })
  } catch (error) {
    primaryError = error
  } finally {
    if (remoteCreated && run?.page && !run.page.isClosed()) {
      await removeRemoteSandbox(run.page, sandboxPath).catch(error => {
        cleanupError = error
      })
    }
    if (run) {
      await cleanupRun(run).catch(error => {
        cleanupError ||= error
      })
    }
    await fs.rm(localRoot, { recursive: true, force: true }).catch(error => {
      cleanupError ||= error
    })
  }

  if (primaryError) {
    if (cleanupError) primaryError.cleanupError = cleanupError
    throw primaryError
  }
  if (cleanupError) throw cleanupError
})

test('credentialed desktop verifies remote, SOCKS5 and refused-destination tunnel behavior', async () => {
  const { config, missing } = readConfig()
  test.skip(missing.length > 0, `缺少真实服务器测试环境变量：${missing.join(', ')}`)
  let run
  let responder
  let primaryError
  let cleanupError

  try {
    run = await launchExternalAcceptanceApp(config)
    await connectRealServer(run.page, config)
    const modal = await openTunnelManager(run.page)

    const marker = `shellpilot-remote-forward-${crypto.randomBytes(8).toString('hex')}`
    responder = await listenResponder(marker)
    const remotePort = 44000 + crypto.randomInt(0, 8000)
    await modal.locator('.ssh-tunnel-type-card')
      .filter({ hasText: '远程转发' })
      .click()
    await modal.getByLabel('配置名称').fill('真实远程转发验收')
    await modal.getByLabel('本机目标地址').fill(loopbackHost)
    await modal.getByLabel('本机目标端口').fill(String(responder.port))
    await modal.getByLabel('远程监听地址').fill(loopbackHost)
    await modal.getByLabel('远程监听端口').fill(String(remotePort))
    await modal.getByRole('button', { name: '启动隧道' }).click()
    let card = modal.locator('.ssh-tunnel-running-card')
      .filter({ hasText: '真实远程转发验收' })
    await expect(card).toBeVisible({ timeout: 30000 })
    const output = await readRemoteListener(config, remotePort)
    expect(output).toBe(marker)
    await stopTunnel(card)
    await responder.close()
    responder = null

    const socksPort = await findFreeLocalPort()
    await modal.locator('.ssh-tunnel-type-card')
      .filter({ hasText: 'SOCKS5 动态代理' })
      .click()
    await modal.getByLabel('配置名称').fill('真实 SOCKS5 验收')
    await modal.getByLabel('本机监听地址').fill(loopbackHost)
    await modal.getByLabel('本机监听端口').fill(String(socksPort))
    await modal.getByRole('button', { name: '启动隧道' }).click()
    card = modal.locator('.ssh-tunnel-running-card')
      .filter({ hasText: '真实 SOCKS5 验收' })
    await expect(card).toBeVisible({ timeout: 30000 })
    await expect(readSshBannerThroughSocks5(socksPort)).resolves.toMatch(/^SSH-/)
    await stopTunnel(card)

    const refusedLocalPort = await findFreeLocalPort()
    const refusedRemotePort = 55000 + crypto.randomInt(0, 8000)
    await modal.locator('.ssh-tunnel-type-card')
      .filter({ hasText: '本地转发' })
      .click()
    await modal.getByLabel('配置名称').fill('真实目标拒绝验收')
    await modal.getByLabel('本机监听地址').fill(loopbackHost)
    await modal.getByLabel('本机监听端口').fill(String(refusedLocalPort))
    await modal.getByLabel('远程目标地址').fill(loopbackHost)
    await modal.getByLabel('远程目标端口').fill(String(refusedRemotePort))
    await modal.getByRole('button', { name: '启动隧道' }).click()
    card = modal.locator('.ssh-tunnel-running-card')
      .filter({ hasText: '真实目标拒绝验收' })
    await expect(card).toBeVisible({ timeout: 30000 })
    await expectConnectionClosedWithoutData(refusedLocalPort)
    await expect(card.locator('.ssh-tunnel-runtime-failure'))
      .toContainText('目标服务拒绝连接', { timeout: 15000 })
    await expect(card.locator('.ssh-tunnel-runtime-failure'))
      .toContainText('SSH_TUNNEL_DESTINATION_REFUSED')
    await stopTunnel(card)
  } catch (error) {
    primaryError = error
  } finally {
    if (responder) {
      await responder.close().catch(error => { cleanupError = error })
    }
    if (run) {
      await cleanupRun(run).catch(error => {
        cleanupError ||= error
      })
    }
  }

  if (primaryError) {
    if (cleanupError) primaryError.cleanupError = cleanupError
    throw primaryError
  }
  if (cleanupError) throw cleanupError
})

test('credentialed desktop leaves no external acceptance sandboxes', async () => {
  const { config, missing } = readConfig()
  test.skip(missing.length > 0, `缺少真实服务器测试环境变量：${missing.join(', ')}`)
  let run
  let primaryError
  let cleanupError

  try {
    run = await launchExternalAcceptanceApp(config)
    await connectRealServer(run.page, config)
    await openSftp(run.page)
    const leftovers = await run.page.evaluate(async remoteRoot => {
      const entry = window.refs.get('sftp-' + window.store.activeTabId)
      const entries = await entry.sftp.list(remoteRoot)
      return entries
        .map(item => item.name)
        .filter(name => name.startsWith('.shellpilot-e2e-'))
    }, config.remoteRoot)
    expect(leftovers).toEqual([])
  } catch (error) {
    primaryError = error
  } finally {
    if (run) {
      await cleanupRun(run).catch(error => {
        cleanupError = error
      })
    }
  }

  if (primaryError) {
    if (cleanupError) primaryError.cleanupError = cleanupError
    throw primaryError
  }
  if (cleanupError) throw cleanupError
})
