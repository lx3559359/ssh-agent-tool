import { PureComponent } from 'react'
import { CloseOutlined, MinusSquareOutlined, UpCircleOutlined } from '@ant-design/icons'
import { Button, Select, Space } from 'antd'
import { getLatestReleaseInfo, getLatestReleaseStatus } from '../../common/update-check'
import upgrade from '../../common/upgrade'
import compare from '../../common/version-compare'
import Link from '../common/external-link'
import {
  isMac,
  isWin,
  packInfo,
  downloadUpgradeTimeout
} from '../../common/constants'
import { checkSkipSrc } from '../../common/check-skip-src'
import { debounce } from 'lodash-es'
import newTerm from '../../common/new-terminal'
import Markdown from '../common/markdown'
import { refsStatic } from '../common/ref'
import message from '../common/message'
import './upgrade.styl'

const e = window.translate
const {
  homepage
} = packInfo

const downloadMirrorList = [
  'github'
]

export default class Upgrade extends PureComponent {
  state = {
    mirror: downloadMirrorList[0]
  }

  downloadTimer = null

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

  handleMirrorChange = (mirror) => {
    this.setState({
      mirror
    })
  }

  resetDownloadTimer = () => {
    clearTimeout(this.downloadTimer)
    this.downloadTimer = setTimeout(this.timeout, downloadUpgradeTimeout)
  }

  clearDownloadTimer = () => {
    clearTimeout(this.downloadTimer)
    this.downloadTimer = null
  }

  onData = (upgradePercent) => {
    this.resetDownloadTimer()
    this.changeProps({
      upgradePercent: Math.min(upgradePercent, 100)
    })
  }

  onError = (e) => {
    this.clearDownloadTimer()
    this.changeProps({
      error: e.message || '更新下载失败'
    })
  }

  cancel = () => {
    this.clearDownloadTimer()
    this.update && this.update.destroy()
    this.changeProps({
      upgrading: false,
      upgradePercent: 0
    })
  }

  timeout = () => {
    this.cancel()
    message.error('下载超时，请重试')
  }

  onEnd = () => {
    this.clearDownloadTimer()
    this.handleClose()
  }

  doUpgrade = debounce(async () => {
    const { installSrc } = this.props
    if (!isMac && !isWin && installSrc === 'npm') {
      return window.store.addTab(
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
    }
    this.changeProps({
      upgrading: true
    })
    const proxy = window.store.getProxySetting()
    this.update = await upgrade({
      mirror: this.state.mirror,
      proxy,
      onData: this.onData,
      onEnd: this.onEnd,
      onError: this.onError
    })
    this.resetDownloadTimer()
  }, 100)

  handleSkipVersion = () => {
    window.store.setConfig({
      skipVersion: this.props.upgradeInfo.remoteVersion
    })
    this.handleClose()
  }

  showNoUpdateInfo = (text) => {
    this.changeProps({
      noUpdateMessage: text,
      noUpdateMessageExpires: Date.now() + 3000
    })
  }

  getLatestRelease = async (isManual = false) => {
    const { installSrc } = this.props
    if (checkSkipSrc(installSrc)) {
      return
    }
    this.changeProps({
      checkingRemoteVersion: true,
      error: ''
    })
    const releaseStatus = await getLatestReleaseStatus()
    this.changeProps({
      checkingRemoteVersion: false
    })
    if (releaseStatus.status === 'unavailable') {
      if (isManual) {
        this.showNoUpdateInfo(releaseStatus.message)
      }
      return
    }
    if (releaseStatus.status === 'waitingForApproval') {
      if (isManual) {
        this.showNoUpdateInfo(releaseStatus.message)
      }
      return
    }
    const { skipVersion = 'v0.0.0' } = this.props
    const currentVer = 'v' + window.et.version.split('-')[0]
    const latestVer = releaseStatus.tag_name
    if (!latestVer) {
      if (isManual) {
        this.showNoUpdateInfo(releaseStatus.message || e('noNeed'))
      }
      return
    }
    if (!isManual && compare(skipVersion, latestVer) >= 0) {
      return
    }
    const shouldUpgrade = compare(currentVer, latestVer) < 0
    if (!shouldUpgrade) {
      if (isManual) {
        this.showNoUpdateInfo(e('noNeed'))
      }
      return
    }
    const needsManualDownload = releaseStatus.status === 'manualDownloadRequired'
    const canAutoUpgrade = !needsManualDownload && (installSrc || isWin || isMac)
    let releaseInfo
    if (canAutoUpgrade) {
      releaseInfo = await getLatestReleaseInfo()
    }
    if (needsManualDownload && isManual) {
      this.showNoUpdateInfo(releaseStatus.message)
    }
    this.changeProps({
      shouldUpgrade,
      releaseInfo,
      remoteVersion: latestVer,
      manualDownloadUrl: releaseStatus.html_url,
      canAutoUpgrade,
      showUpgradeModal: true
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
        {this.renderChangeLog()}
      </div>
    )
  }

  renderMirrorSelector = () => {
    return (
      <Select
        value={this.state.mirror}
        onChange={this.handleMirrorChange}
        getPopupContainer={() => document.body}
        size='small'
        style={{ height: 32 }}
      >
        {downloadMirrorList.map((opt) => (
          <Select.Option key={opt} value={opt}>{opt}</Select.Option>
        ))}
      </Select>
    )
  }

  renderUpgradeButton = () => {
    const { upgrading, upgradePercent, checkingRemoteVersion } = this.props.upgradeInfo
    if (upgrading) {
      const percent = upgradePercent || 0
      return (
        <Button
          type='primary'
          icon={<UpCircleOutlined />}
          loading={checkingRemoteVersion}
          disabled={checkingRemoteVersion}
          onClick={() => this.cancel()}
          className='mg1b'
        >
          <span>{`${e('upgrading')}... ${percent}% ${e('cancel')}`}</span>
        </Button>
      )
    }
    return (
      <Space.Compact>
        {this.renderMirrorSelector()}
        <Button
          type='primary'
          icon={<UpCircleOutlined />}
          loading={checkingRemoteVersion}
          disabled={checkingRemoteVersion}
          onClick={() => this.doUpgrade()}
          className='mg1b'
        >
          {e('upgrade')}
        </Button>
      </Space.Compact>
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
          {this.renderLinks()}
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
    const { shouldUpgrade, checkingRemoteVersion, error } = this.props.upgradeInfo
    if (error) {
      return this.renderError(error)
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
