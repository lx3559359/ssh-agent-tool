import {
  CloseOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { Button } from 'antd'
import { auto } from 'manate/react'
import './crash-recovery-notice.styl'

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
        <strong>上次运行异常结束</strong>
        <span>
          {restored
            ? `已恢复 ${tabCount} 个标签，均处于待重新连接状态。`
            : `可恢复 ${tabCount} 个标签，${reconnectCount} 个连接待重新连接，${interruptedCount} 个任务已中断。`}
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
              恢复标签
            </Button>
            )
          : null}
        {interruptedCount > 0
          ? (
            <Button size='small' icon={<SafetyCertificateOutlined />} onClick={openSafetyCenter}>
              查看安全中心
            </Button>
            )
          : null}
        {pendingTasks.some(task => task?.type === 'update')
          ? (
            <Button size='small' icon={<ReloadOutlined />} onClick={openUpdateCenter}>
              查看更新中心
            </Button>
            )
          : null}
        <Button size='small' type='text' icon={<CloseOutlined />} onClick={() => store.dismissRecoveryNotice()}>
          忽略
        </Button>
      </div>
    </section>
  )
})
