import { Button, Progress, Select } from 'antd'
import { ReloadOutlined, UpCircleOutlined } from '@ant-design/icons'
import { auto } from 'manate/react'
import Modal from '../common/modal'
import Markdown from '../common/markdown'
import Link from '../common/external-link'
import { packInfo } from '../../common/constants'
import { refsStatic } from '../common/ref'
import './update-center-modal.styl'

function getStatusText (info) {
  if (info.checkingRemoteVersion) return '正在检查更新'
  if (info.upgrading) return '正在下载更新'
  if (info.upgradeReady) return '更新已下载，等待重启安装'
  if (info.error) return `更新失败：${info.error}`
  if (info.lastCheckStatus === 'current') return '当前已经是最新版本'
  if (info.lastCheckStatus === 'waitingForApproval') return '发现新版本，等待发布审批'
  if (info.lastCheckStatus === 'manualDownloadRequired') return '需要手动下载更新'
  if (info.lastCheckStatus === 'update') return '发现可用更新'
  if (info.lastCheckStatus === 'unavailable') return '暂时无法获取版本信息'
  return '尚未检查'
}

export default auto(function UpdateCenterModal ({ open, onClose }) {
  if (!open) return null

  const info = window.store.upgradeInfo || {}
  const checking = Boolean(info.checkingRemoteVersion)
  const downloading = Boolean(info.upgrading)
  const percent = Math.max(0, Math.min(Number(info.upgradePercent) || 0, 100))
  const latestVersion = info.remoteVersion || '尚未获取'
  const lastCheckedAt = info.lastCheckedAt
    ? new Date(info.lastCheckedAt).toLocaleString('zh-CN')
    : '尚未检查'
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
      title='更新中心'
      open
      onCancel={onClose}
      footer={null}
      width='min(720px, calc(100vw - 32px))'
      wrapClassName='update-center-modal'
    >
      <div className='update-center-summary'>
        <div><span>当前版本</span><b>v{packInfo.version}</b></div>
        <div><span>最新版本</span><b>{latestVersion}</b></div>
        <div><span>更新状态</span><b>{getStatusText(info)}</b></div>
        <div><span>上次检查</span><b>{lastCheckedAt}</b></div>
      </div>
      {info.updateMessage
        ? <p className='update-center-message'>{info.updateMessage}</p>
        : null}
      <div className='update-center-source'>
        <span>更新源</span>
        <Select
          value={updateSource}
          onChange={handleUpdateSourceChange}
          options={[
            { value: 'auto', label: '自动选择（国内源优先）' },
            { value: 'modelscope', label: 'ModelScope 国内源' },
            { value: 'github', label: 'GitHub' }
          ]}
        />
        <span className='color-grey'>切换后点击“重新检查”</span>
      </div>
      <div className='update-center-section'>
        <div className='update-center-section-title'>下载进度</div>
        <Progress percent={percent} status={info.error ? 'exception' : undefined} />
      </div>
      <div className='update-center-actions'>
        <Button icon={<ReloadOutlined />} loading={checking} onClick={handleCheck}>重新检查</Button>
        {canDownload
          ? (
            <Button type='primary' icon={<UpCircleOutlined />} loading={downloading} onClick={handleUpgrade}>下载更新</Button>
            )
          : null}
        {info.upgradeReady
          ? (
            <Button type='primary' icon={<UpCircleOutlined />} onClick={handleUpgrade}>重启并安装</Button>
            )
          : null}
        {info.shouldUpgrade && !info.canAutoUpgrade
          ? <Link to={manualDownloadUrl}>前往发布页下载</Link>
          : null}
      </div>
      <div className='update-center-section update-center-changelog'>
        <div className='update-center-section-title'>更新日志</div>
        {info.releaseInfo?.body
          ? <Markdown text={info.releaseInfo.body} />
          : <p>暂无更新日志。</p>}
      </div>
    </Modal>
  )
})
