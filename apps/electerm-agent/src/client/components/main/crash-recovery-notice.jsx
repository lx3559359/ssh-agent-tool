import {
  CloseOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { Button } from 'antd'
import { auto } from 'manate/react'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import './crash-recovery-notice.styl'

const e = window.translate

function countPendingConnections (tabs = []) {
  return tabs.filter(tab => tab?.host || tab?.type === 'local').length
}

function countInterruptedTasks (tasks = []) {
  return tasks.filter(task => ['ai', 'agent', 'safety', 'update', 'sftp'].includes(task?.type)).length
}

export default auto(function CrashRecoveryNotice ({ store, recoveryPlan }) {
  if (!recoveryPlan?.abnormalExit) return null

  const tabs = recoveryPlan.tabs || []
  const pendingTasks = recoveryPlan.pendingTasks || []
  const tabCount = tabs.length
  const reconnectCount = countPendingConnections(tabs)
  const interruptedCount = countInterruptedTasks(pendingTasks)
  const restored = recoveryPlan.tabsRestored === true

  const openSafetyCenter = () => {
    window.dispatchEvent(new CustomEvent('shellpilot-open-safety-center'))
  }
  const openUpdateCenter = () => {
    window.dispatchEvent(new CustomEvent('shellpilot-open-update-center'))
  }

  return (
    <section className='crash-recovery-notice' role='alert' aria-live='polite'>
      <div className='crash-recovery-notice-icon' aria-hidden='true'>
        <SafetyCertificateOutlined />
      </div>
      <div className='crash-recovery-notice-content'>
        <strong>{e('shellpilotCrashRecoveryTitle')}</strong>
        <span>
          {restored
            ? formatShellPilotTranslation(e, 'shellpilotCrashRecoveryRestored', { tabCount })
            : formatShellPilotTranslation(e, 'shellpilotCrashRecoveryAvailable', {
              tabCount,
              reconnectCount,
              interruptedCount
            })}
        </span>
      </div>
      <div className='crash-recovery-notice-actions'>
        {!restored && tabCount > 0
          ? (
            <Button
              type='primary'
              size='small'
              icon={<SyncOutlined />}
              onClick={() => store.restoreRecoveryTabs()}
            >
              {e('shellpilotCrashRecoveryRestoreTabs')}
            </Button>
            )
          : null}
        {interruptedCount > 0
          ? (
            <Button size='small' icon={<SafetyCertificateOutlined />} onClick={openSafetyCenter}>
              {e('shellpilotCrashRecoveryOpenSafety')}
            </Button>
            )
          : null}
        {pendingTasks.some(task => task?.type === 'update')
          ? (
            <Button size='small' icon={<ReloadOutlined />} onClick={openUpdateCenter}>
              {e('shellpilotCrashRecoveryOpenUpdates')}
            </Button>
            )
          : null}
        <Button size='small' type='text' icon={<CloseOutlined />} onClick={() => store.dismissRecoveryNotice()}>
          {e('shellpilotIgnore')}
        </Button>
      </div>
    </section>
  )
})
