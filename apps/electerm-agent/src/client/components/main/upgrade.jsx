import { PureComponent } from 'react'
import { CloseOutlined, MinusSquareOutlined, UpCircleOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { getLatestReleaseStatus } from '../../common/update-check'
import compare from '../../common/version-compare'
import Link from '../common/external-link'
import {
  isMac,
  isWin,
  packInfo
} from '../../common/constants'
import { checkSkipSrc } from '../../common/check-skip-src'
import { debounce } from 'lodash-es'
import newTerm from '../../common/new-terminal'
import Markdown from '../common/markdown'
import { refsStatic } from '../common/ref'
import message from '../common/message'
import { createTraceContext } from '../../common/quality/trace-context.js'
import { recordQualityEvent } from '../../common/quality/quality-events.js'
import './upgrade.styl'

const e = window.translate
const {
  homepage
} = packInfo

export default class Upgrade extends PureComponent {
  nativeUpdatePollTimer = null

  componentDidMount () {
    if (window.et.isWebApp) {
      return
    }
    this.id = 'upgrade'
    refsStatic.add(this.id, this)
    this.cleanupTimer = setInterval(() => {
      const { noUpdateMessageExpires } = window.store.upgradeInfo
      if (noUpdateMessageExpires && Date.now() > noUpdateMessageExpires) {
        window.store.upgradeInfo.noUpdateMessage = ''
        window.store.upgradeInfo.noUpdateMessageExpires = 0
      }
    }, 1000)
  }

  componentWillUnmount () {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }
    this.clearNativeUpdatePoll()
  }

  appUpdateCheck = (isManual) => {
    this.getLatestRelease(isManual)
  }

  changeProps = (update) => {
    Object.assign(
      window.store.upgradeInfo, update
    )
  }

  handleMinimize = () => {
    this.changeProps({
      showUpgradeModal: false
    })
    window.store.focus()
  }

  handleClose = () => {
    window.store.upgradeInfo = {}
  }

  doUpgrade = debounce(async () => {
    const traceContext = createTraceContext({
      module: 'updater',
      action: 'upgrade'
    })
    if (this.props.upgradeInfo.upgradeReady) {
      await window.pre.runGlobalAsync('nativeUpdateInstall', traceContext)
      return
    }
    const { installSrc } = this.props
    if (!isMac && !isWin && installSrc === 'npm') {
      recordQualityEvent(traceContext, {
        module: 'updater',
        action: 'install',
        phase: 'started'
      })
      try {
        const result = await window.store.addTab(
          {
            ...newTerm(undefined, true),
            runScripts: [
              {
                script: 'npm install -g aigshell',
                delay: 500
              }
            ]
          }
        )
        recordQualityEvent(traceContext, {
          module: 'updater',
          action: 'install',
          phase: 'completed',
          result: 'npm'
        })
        return result
      } catch (err) {
        recordQualityEvent(traceContext, {
          module: 'updater',
          action: 'install',
          phase: 'failed',
          result: 'failed'
        })
        throw err
      }
    }
    this.changeProps({
      upgrading: true,
      upgradePercent: 0,
      upgradeReady: false,
      error: ''
    })
    const proxy = window.store.getProxySetting()
    const updateOptions = {
      proxy,
      config: {
        updateChannel: window.store.config?.updateChannel,
        updateSource: window.store.config?.updateSource || 'auto'
      }
    }
    try {
      const checked = await window.pre.runGlobalAsync(
        'nativeUpdateCheck',
        updateOptions,
        traceContext
      )
      if (checked?.status && checked.status !== 'update') {
        this.changeProps({
          upgrading: false,
          upgradePercent: 0
        })
        this.showNoUpdateInfo(checked.message || '当前版本暂时不能在线更新。', 'warning')
        return
      }
      this.trackNativeUpdateProgress()
      const downloadState = await window.pre.runGlobalAsync(
        'nativeUpdateDownload',
        updateOptions,
        traceContext
      )
      if (downloadState?.status && downloadState.status !== 'downloading' && !downloadState.downloaded) {
        this.clearNativeUpdatePoll()
        this.changeProps({
          upgrading: false,
          upgradePercent: 0,
          upgradeReady: false,
          error: downloadState.message || '该版本暂时不能在线更新。'
        })
        return
      }
      const finalState = await window.pre.runGlobalAsync('nativeUpdateState')
      this.clearNativeUpdatePoll()
      if (!finalState?.downloaded) {
        throw new Error(finalState?.error || '更新文件尚未下载完成，请稍后重试。')
      }
      this.changeProps({
        upgrading: false,
        upgradePercent: finalState?.percent || 100,
        upgradeReady: Boolean(finalState?.downloaded)
      })
      message.success('更新已下载完成，重启客户端即可完成更新。')
    } catch (err) {
      this.clearNativeUpdatePoll()
      this.changeProps({
        upgrading: false,
        upgradePercent: 0,
        error: err?.message || '在线更新失败，请稍后重试。'
      })
    }
  }, 100)

  clearNativeUpdatePoll = () => {
    clearInterval(this.nativeUpdatePollTimer)
    this.nativeUpdatePollTimer = null
  }

  trackNativeUpdateProgress = () => {
    this.clearNativeUpdatePoll()
    this.nativeUpdatePollTimer = setInterval(async () => {
      try {
        const state = await window.pre.runGlobalAsync('nativeUpdateState')
        this.changeProps({
          upgradePercent: Math.min(state?.percent || 0, 100)
        })
        if (state?.downloaded || state?.error) {
          this.clearNativeUpdatePoll()
        }
      } catch (err) {
        this.clearNativeUpdatePoll()
      }
    }, 1000)
  }

  handleSkipVersion = () => {
    window.store.setConfig({
      skipVersion: this.props.upgradeInfo.remoteVersion
    })
    this.handleClose()
  }

  showNoUpdateInfo = (text, type = 'info') => {
    this.changeProps({
      noUpdateMessage: text,
      noUpdateMessageExpires: Date.now() + 3000
    })
    if (type === 'success') {
      message.success(text)
    } else if (type === 'warning') {
      message.warning(text)
    } else if (type === 'error') {
      message.error(text)
    } else {
      message.info(text)
    }
  }

  getLatestRelease = async (isManual = false) => {
    const { installSrc } = this.props
    const traceContext = createTraceContext({
      module: 'updater',
      action: 'check'
    })
    recordQualityEvent(traceContext, {
      module: 'updater',
      action: 'check',
      phase: 'started'
    })
    if (checkSkipSrc(installSrc)) {
      recordQualityEvent(traceContext, {
        module: 'updater',
        action: 'check',
        phase: 'completed',
        result: 'skipped'
      })
      return
    }
    const checkingMessage = isManual ? message.info('正在检查更新...', 0) : null
    this.changeProps({
      checkingRemoteVersion: true,
      error: ''
    })
    let releaseStatus
    try {
      releaseStatus = await getLatestReleaseStatus()
    } catch (err) {
      const errorMessage = err?.message || '检查更新失败，请稍后重试。'
      checkingMessage?.destroy()
      this.changeProps({
        checkingRemoteVersion: false,
        lastCheckStatus: 'unavailable',
        updateMessage: errorMessage,
        lastCheckedAt: Date.now(),
        remoteVersion: ''
      })
      if (isManual) {
        this.showNoUpdateInfo(errorMessage, 'error')
      }
      recordQualityEvent(traceContext, {
        module: 'updater',
        action: 'check',
        phase: 'failed',
        result: 'failed'
      })
      return
    }
    checkingMessage?.destroy()
    recordQualityEvent(traceContext, {
      module: 'updater',
      action: 'check',
      phase: 'completed',
      result: releaseStatus.status || 'completed'
    })
    const remoteVersion = releaseStatus.tag_name || ''
    const releaseInfo = releaseStatus.body
      ? { body: releaseStatus.body, date: releaseStatus.date || '未知日期' }
      : undefined
    this.changeProps({
      checkingRemoteVersion: false,
      lastCheckStatus: releaseStatus.status,
      updateMessage: releaseStatus.message || '',
      lastCheckedAt: Date.now(),
      remoteVersion,
      manualDownloadUrl: releaseStatus.html_url,
      releaseInfo,
      shouldUpgrade: false,
      canAutoUpgrade: false
    })
    if (releaseStatus.status === 'unavailable') {
      if (isManual) {
        this.showNoUpdateInfo(releaseStatus.message, 'error')
      }
      return
    }
    if (releaseStatus.status === 'waitingForApproval') {
      if (isManual) {
        this.showNoUpdateInfo(releaseStatus.message, 'warning')
      }
      return
    }
    if (releaseStatus.status === 'current') {
      if (isManual) {
        this.showNoUpdateInfo(releaseStatus.message || e('noNeed'), 'success')
      }
      return
    }
    const { skipVersion = 'v0.0.0' } = this.props
    const currentVer = 'v' + window.et.version.split('-')[0]
    const latestVer = remoteVersion
    if (!latestVer) {
      if (isManual) {
        this.showNoUpdateInfo(releaseStatus.message || e('noNeed'), 'success')
      }
      return
    }
    if (!isManual && compare(skipVersion, latestVer) >= 0) {
      return
    }
    const shouldUpgrade = compare(currentVer, latestVer) < 0
    if (!shouldUpgrade) {
      if (isManual) {
        this.showNoUpdateInfo(e('noNeed'), 'success')
      }
      return
    }
    const needsManualDownload = releaseStatus.status === 'manualDownloadRequired'
    const canAutoUpgrade = !needsManualDownload && (installSrc || isWin || isMac)
    if (needsManualDownload && isManual) {
      this.showNoUpdateInfo(releaseStatus.message, 'warning')
    }
    this.changeProps({
      shouldUpgrade,
      releaseInfo,
      remoteVersion: latestVer,
      manualDownloadUrl: releaseStatus.html_url,
      canAutoUpgrade,
      showUpgradeModal: !window.store.upgradeInfo.showUpdateCenter
    })
  }

  renderError = (err) => {
    return (
      <div className='upgrade-panel'>
        <div className='upgrade-panel-title fix'>
          <span className='fleft'>
            检查升级失败：{err}
          </span>
          <span className='fright'>
            <CloseOutlined className='pointer font16 close-upgrade-panel' onClick={this.handleClose} />
          </span>
        </div>
        <div className='upgrade-panel-body'>
          你可以访问
          <Link
            to={homepage}
            className='mg1x'
          >{homepage}
          </Link>
          手动下载新版本。
        </div>
      </div>
    )
  }

  renderChangeLog = () => {
    const {
      releaseInfo
    } = this.props.upgradeInfo
    if (!releaseInfo) {
      return null
    }
    return (
      <div className='pd1t'>
        <div className='bold'>更新日志：</div>
        <Markdown text={releaseInfo.body} />
        <Link
          to={packInfo.releases}
        >{e('moreChangeLog')}
        </Link>
      </div>
    )
  }

  renderSkipVersion = () => {
    return (
      <Button
        onClick={this.handleSkipVersion}
        icon={<CloseOutlined />}
        className='mg1l mg1b'
      >
        {e('skipThisVersion')}
      </Button>
    )
  }

  renderRollbackHint = () => {
    return (
      <p className='upgrade-rollback-hint'>
        回滚提示：如果新版本安装后出现异常，可以在 GitHub Releases 下载上一稳定版本，并覆盖安装到当前目录。
      </p>
    )
  }

  renderLinks = () => {
    const { manualDownloadUrl = packInfo.releases } = this.props.upgradeInfo
    const links = [
      { name: 'GitHub Releases', url: manualDownloadUrl }
    ]
    return (
      <div>
        <p>
          {e('manuallyDownloadFrom')}:
          {
            links.map((d) => {
              return (
                <Link to={d.url} className='mg1l' key={d.url}>{d.name}</Link>
              )
            })
          }
        </p>
        {this.renderRollbackHint()}
        {this.renderChangeLog()}
      </div>
    )
  }

  renderUpgradeButton = () => {
    const { upgrading, upgradePercent, checkingRemoteVersion, upgradeReady } = this.props.upgradeInfo
    if (upgradeReady) {
      return (
        <Button
          type='primary'
          icon={<UpCircleOutlined />}
          onClick={() => this.doUpgrade()}
          className='mg1b'
        >
          重启完成更新
        </Button>
      )
    }
    if (upgrading) {
      const percent = upgradePercent || 0
      return (
        <Button
          type='primary'
          icon={<UpCircleOutlined />}
          loading={checkingRemoteVersion}
          disabled
          className='mg1b'
        >
          <span>{`正在下载更新... ${Math.round(percent)}%`}</span>
        </Button>
      )
    }
    return (
      <Button
        type='primary'
        icon={<UpCircleOutlined />}
        loading={checkingRemoteVersion}
        disabled={checkingRemoteVersion}
        onClick={() => this.doUpgrade()}
        className='mg1b'
      >
        立即更新
      </Button>
    )
  }

  renderUpgradeContent = () => {
    const { installSrc } = this.props
    const { canAutoUpgrade } = this.props.upgradeInfo
    const skip = checkSkipSrc(installSrc)
    if (skip || !canAutoUpgrade) {
      return this.renderLinks()
    }
    return (
      <div>
        {this.renderUpgradeButton()}
        {this.renderSkipVersion()}
        <div className='pd1t'>
          {this.renderChangeLog()}
        </div>
      </div>
    )
  }

  renderUpgradePanel = () => {
    const { remoteVersion, releaseInfo, showUpgradeModal } = this.props.upgradeInfo
    const cls = showUpgradeModal
      ? 'animate upgrade-panel'
      : 'animate upgrade-panel upgrade-panel-hide'
    return (
      <div className={cls}>
        <div className='upgrade-panel-title fix'>
          <span className='fleft'>
            {e('newVersion')} <b>{remoteVersion} [{releaseInfo?.date || '未知日期'}]</b>
          </span>
          <span className='fright'>
            <MinusSquareOutlined className='pointer font16 close-upgrade-panel' onClick={this.handleMinimize} />
          </span>
        </div>
        <div className='upgrade-panel-body'>
          {this.renderUpgradeContent()}
        </div>
      </div>
    )
  }

  render () {
    const { shouldUpgrade, checkingRemoteVersion, error, showUpdateCenter } = this.props.upgradeInfo
    if (error && !showUpdateCenter) {
      return this.renderError(error)
    }
    if (showUpdateCenter) {
      return null
    }
    if (!shouldUpgrade) {
      return null
    }
    if (checkingRemoteVersion) {
      return null
    }
    return this.renderUpgradePanel()
  }
}
