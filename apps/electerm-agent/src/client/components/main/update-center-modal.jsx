import { Button, Progress, Select } from 'antd'
import { ReloadOutlined, UpCircleOutlined } from '@ant-design/icons'
import { auto } from 'manate/react'
import Modal from '../common/modal'
import Markdown from '../common/markdown'
import Link from '../common/external-link'
import { packInfo } from '../../common/constants'
import { refsStatic } from '../common/ref'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import './update-center-modal.styl'

const e = window.translate

function getStatusText (info) {
  if (info.checkingRemoteVersion) return e('shellpilotUpdateChecking')
  if (info.upgrading) return e('shellpilotUpdateDownloading')
  if (info.upgradeReady) return e('shellpilotUpdateReady')
  if (info.error) return formatShellPilotTranslation(e, 'shellpilotUpdateFailedDetail', { detail: info.error })
  if (info.lastCheckStatus === 'current') return e('shellpilotUpdateCurrent')
  if (info.lastCheckStatus === 'waitingForApproval') return e('shellpilotUpdateWaitingApproval')
  if (info.lastCheckStatus === 'manualDownloadRequired') return e('shellpilotUpdateManualRequired')
  if (info.lastCheckStatus === 'update') return e('shellpilotUpdateAvailable')
  if (info.lastCheckStatus === 'unavailable') return e('shellpilotUpdateUnavailable')
  return e('shellpilotUpdateNotChecked')
}

export default auto(function UpdateCenterModal ({ open, onClose }) {
  if (!open) return null

  const info = window.store.upgradeInfo || {}
  const checking = Boolean(info.checkingRemoteVersion)
  const downloading = Boolean(info.upgrading)
  const percent = Math.max(0, Math.min(Number(info.upgradePercent) || 0, 100))
  const language = window.store.previewLanguage || window.store.config?.language || 'zh_cn'
  const latestVersion = info.remoteVersion || e('shellpilotUpdateNotAvailable')
  const lastCheckedAt = info.lastCheckedAt
    ? new Date(info.lastCheckedAt).toLocaleString(language === 'en_us' ? 'en-US' : 'zh-CN')
    : e('shellpilotUpdateNotChecked')
  const canDownload = info.shouldUpgrade && info.canAutoUpgrade && !info.upgradeReady
  const manualDownloadUrl = info.manualDownloadUrl || packInfo.releases
  const updateSource = window.store.config?.updateSource || 'auto'

  const handleCheck = () => window.store.onCheckUpdate(true)
  const handleUpgrade = () => refsStatic.get('upgrade')?.doUpgrade()
  const handleUpdateSourceChange = (value) => {
    window.store.setConfig({ updateSource: value })
    window.store.upgradeInfo.updateSource = value
  }

  return (
    <Modal
      title={e('shellpilotTopbarUpdateCenter')}
      open
      onCancel={onClose}
      footer={null}
      width='min(720px, calc(100vw - 32px))'
      wrapClassName='update-center-modal'
    >
      <div className='update-center-summary'>
        <div><span>{e('shellpilotUpdateCurrentVersion')}</span><b>v{packInfo.version}</b></div>
        <div><span>{e('shellpilotUpdateLatestVersion')}</span><b>{latestVersion}</b></div>
        <div><span>{e('shellpilotUpdateStatus')}</span><b>{getStatusText(info)}</b></div>
        <div><span>{e('shellpilotUpdateLastChecked')}</span><b>{lastCheckedAt}</b></div>
      </div>
      {info.updateMessage
        ? <p className='update-center-message'>{info.updateMessage}</p>
        : null}
      <div className='update-center-source'>
        <span>{e('shellpilotUpdateSource')}</span>
        <Select
          value={updateSource}
          onChange={handleUpdateSourceChange}
          options={[
            { value: 'auto', label: e('shellpilotUpdateSourceAuto') },
            { value: 'modelscope', label: e('shellpilotUpdateSourceModelScope') },
            { value: 'github', label: 'GitHub' }
          ]}
        />
        <span className='color-grey'>{e('shellpilotUpdateSourceHint')}</span>
      </div>
      <div className='update-center-section'>
        <div className='update-center-section-title'>{e('shellpilotUpdateDownloadProgress')}</div>
        <Progress percent={percent} status={info.error ? 'exception' : undefined} />
      </div>
      <div className='update-center-actions'>
        <Button icon={<ReloadOutlined />} loading={checking} onClick={handleCheck}>{e('shellpilotUpdateRecheck')}</Button>
        {canDownload
          ? (
            <Button type='primary' icon={<UpCircleOutlined />} loading={downloading} onClick={handleUpgrade}>{e('shellpilotUpdateDownload')}</Button>
            )
          : null}
        {info.upgradeReady
          ? (
            <Button type='primary' icon={<UpCircleOutlined />} onClick={handleUpgrade}>{e('shellpilotUpdateRestartInstall')}</Button>
            )
          : null}
        {info.shouldUpgrade && !info.canAutoUpgrade
          ? <Link to={manualDownloadUrl}>{e('shellpilotUpdateOpenReleasePage')}</Link>
          : null}
      </div>
      <div className='update-center-section update-center-changelog'>
        <div className='update-center-section-title'>{e('shellpilotUpdateChangelog')}</div>
        {info.releaseInfo?.body
          ? <Markdown text={info.releaseInfo.body} />
          : <p>{e('shellpilotUpdateNoChangelog')}</p>}
      </div>
    </Modal>
  )
})
