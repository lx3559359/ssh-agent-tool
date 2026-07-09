/**
 * download upgrade class
 */

const fs = require('fs')
const { resolve } = require('path')
const { spawn } = require('child_process')
const _ = require('../lib/lodash.js')
const rp = require('axios')
const { tempDir, isWin, isMac, isArm } = require('../common/runtime-constants')
const installSrc = require('../lib/install-src')
const { fsExport } = require('../lib/fs')
const { createProxyAgent } = require('../lib/proxy-agent')
const { openFile, rmrf } = fsExport
const log = require('../common/log')
const globalState = require('./global-state')

rp.defaults.proxy = false

const releaseApiUrl = 'https://api.github.com/repos/lx3559359/ssh-agent-tool/releases/latest'

function getUrl (url) {
  return url
}

function buildUpgradeEndMessage (id, data) {
  return {
    id: 'upgrade:end:' + id,
    data
  }
}

function buildUpgradeErrorMessage (id, err) {
  return {
    id: 'upgrade:err:' + id,
    error: {
      message: err.message,
      stack: err.stack
    }
  }
}

function writeUpgradeLog (logRef, level, eventName, data) {
  const method = typeof logRef?.[level] === 'function'
    ? level
    : 'info'
  logRef[method](`ShellPilot update ${eventName}`, data)
}

function buildUpgradeInstallPlan (localPath, platformInfo = {}) {
  const win = platformInfo.isWin ?? isWin
  if (!win || !/\.exe$/i.test(localPath || '')) {
    return null
  }
  return {
    command: localPath,
    args: ['/S'],
    options: {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    },
    shouldQuitApp: true
  }
}

function notifyParentProcess (message) {
  if (typeof process.send === 'function') {
    process.send(message)
  }
}

function launchUpgradeInstaller ({
  localPath,
  platformInfo = {},
  spawnImpl = spawn,
  notifyParent = notifyParentProcess,
  waitMs = 300
} = {}) {
  const plan = buildUpgradeInstallPlan(localPath, platformInfo)
  if (!plan) {
    return Promise.resolve({
      mode: 'manual-open',
      installerPath: localPath
    })
  }

  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnImpl(plan.command, plan.args, plan.options)
    } catch (err) {
      return reject(err)
    }

    let settled = false
    const settle = (err) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (err) {
        return reject(err)
      }
      child && typeof child.unref === 'function' && child.unref()
      try {
        notifyParent({
          quitForUpgrade: true,
          installerPath: localPath
        })
      } catch (notifyError) {
        log.error('ShellPilot update quit notification failed', notifyError)
      }
      resolve({
        mode: 'smooth-install',
        installerPath: localPath
      })
    }

    const timer = setTimeout(() => settle(), waitMs)
    child && typeof child.once === 'function' && child.once('error', settle)
  })
}

function finishUpgradeDownload ({
  transferred,
  expectedSize,
  onEnd,
  onError
}) {
  const size = Number(expectedSize)
  if (size > 0 && Number(transferred) < size) {
    return onError(new Error(
      `AIGShell 更新安装包下载不完整：已下载 ${transferred} 字节，期望 ${size} 字节。请重新下载。`
    ))
  }
  return onEnd()
}

function selectReleaseAsset (release, platformInfo = {}) {
  const assets = (release?.assets || []).filter(asset => {
    return asset?.name && asset?.browser_download_url
  })
  const win = platformInfo.isWin ?? isWin
  const mac = platformInfo.isMac ?? isMac
  const arm = platformInfo.isArm ?? isArm
  const src = platformInfo.installSrc || installSrc
  const candidates = []

  if (win) {
    const winArch = arm ? 'arm64' : 'x64'
    candidates.push(
      r => new RegExp(`win-${winArch}-installer\\.exe$`, 'i').test(r.name)
    )
  } else if (mac || arm) {
    candidates.push(
      r => /mac.*\.dmg$/i.test(r.name)
    )
  } else {
    candidates.push(
      r => /linux.*\.tar\.gz$/i.test(r.name)
    )
  }

  candidates.push(r => r.name.endsWith(src))

  for (const filter of candidates) {
    const asset = assets.find(filter)
    if (asset) {
      return asset
    }
  }
}

function getRequiredReleaseAsset (release, platformInfo = {}) {
  const asset = selectReleaseAsset(release, platformInfo)
  if (asset) {
    return asset
  }
  const tag = release?.tag_name ? ` ${release.tag_name}` : ''
  throw new Error(`未找到适用于当前系统的 AIGShell 更新安装包${tag}，请前往 GitHub Releases 手动下载。`)
}

function getReleaseInfo (
  releaseInfoUrl, agent
) {
  const conf = {
    url: releaseInfoUrl,
    timeout: 15000
  }
  if (agent) {
    conf.httpsAgent = agent
  }
  return rp(conf)
    .then((res) => {
      const release = res.data.release || res.data
      return getRequiredReleaseAsset(release)
    })
}

class Upgrade {
  constructor (options) {
    this.options = options
  }

  async init () {
    const {
      id,
      ws,
      proxy
    } = this.options
    const agent = createProxyAgent(proxy)
    const releaseInfoUrl = `${releaseApiUrl}?_=${+new Date()}`
    const releaseInfo = await getReleaseInfo(releaseInfoUrl, agent)
      .catch(err => this.onError(err, id, ws))
    if (!releaseInfo) {
      return
    }
    const localPath = resolve(tempDir, releaseInfo.name)
    const remotePath = getUrl(releaseInfo.browser_download_url)
    const { size } = releaseInfo
    writeUpgradeLog(log, 'info', 'download-start', {
      asset: releaseInfo.name,
      size,
      remotePath
    })
    await rmrf(localPath).catch(log.error)
    this.id = id
    this.localPath = localPath
    const readSteam = await rp({
      url: remotePath,
      httpsAgent: agent,
      responseType: 'stream'
    })
      .then(r => r.data)
      .catch(err => {
        this.onError(err, id, ws)
      })
    if (!readSteam) {
      return
    }
    const writeSteam = fs.createWriteStream(localPath)

    let count = 0

    this.pausing = false

    this.onData = _.throttle((count) => {
      if (this.onDestroy) {
        return
      }

      ws.s({
        id: 'upgrade:data:' + id,
        data: Math.floor(count * 100 / size)
      })
    }, 1000)

    readSteam.on('data', chunk => {
      const res = writeSteam.write(chunk)
      if (res) {
        count += chunk.length
        this.onData(count)
      } else {
        readSteam.pause()
        writeSteam.once('drain', () => {
          count += chunk.length
          this.onData(count)
          if (!this.pausing) {
            readSteam.resume()
          }
        })
      }
    })

    readSteam.on('close', () => {
      if (this.onDestroy) {
        return writeSteam.end()
      }
      writeSteam.end('', () => finishUpgradeDownload({
        transferred: count,
        expectedSize: size,
        onEnd: () => this.onEnd(id, ws),
        onError: err => this.onError(err, id, ws)
      }))
    })

    readSteam.on('error', (err) => this.onError(err, id, ws))

    this.readSteam = readSteam
    this.writeSteam = writeSteam
    this.ws = ws
    this.destroy = this.destroy.bind(this)
  }

  async onEnd (id, ws) {
    if (!this.onDestroy) {
      writeUpgradeLog(log, 'info', 'download-finished', {
        localPath: this.localPath
      })
      const installResult = await launchUpgradeInstaller({
        localPath: this.localPath
      }).catch(err => {
        writeUpgradeLog(log, 'error', 'smooth-install-failed', err)
        return null
      })
      if (installResult && installResult.mode === 'smooth-install') {
        ws.s(buildUpgradeEndMessage(id, installResult))
        return
      }
      openFile(this.localPath)
      notifyParentProcess({
        showFileInFolder: this.localPath
      })
      ws.s(buildUpgradeEndMessage(id, {
        mode: 'manual-open',
        installerPath: this.localPath
      }))
    }
  }

  onError (err, id, ws) {
    writeUpgradeLog(log, 'error', 'download-failed', err)
    ws.s(buildUpgradeErrorMessage(id, err))
  }

  pause () {
    this.pausing = true
    this.readSteam.pause()
  }

  resume () {
    this.pausing = false
    this.readSteam.resume()
  }

  destroy () {
    this.onDestroy = true
    this.readSteam && this.readSteam.destroy()
    this.ws && this.ws.close()
    globalState.removeUpgradeInst(this.id)
  }

  // end
}

exports.Upgrade = Upgrade
exports.buildUpgradeEndMessage = buildUpgradeEndMessage
exports.buildUpgradeErrorMessage = buildUpgradeErrorMessage
exports.buildUpgradeInstallPlan = buildUpgradeInstallPlan
exports.finishUpgradeDownload = finishUpgradeDownload
exports.getRequiredReleaseAsset = getRequiredReleaseAsset
exports.launchUpgradeInstaller = launchUpgradeInstaller
exports.selectReleaseAsset = selectReleaseAsset
exports.writeUpgradeLog = writeUpgradeLog
