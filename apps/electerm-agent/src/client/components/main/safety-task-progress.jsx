import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  StopOutlined
} from '@ant-design/icons'
import { Button, Progress, Tag, Tooltip } from 'antd'
import {
  getSafetyTaskStatusPresentation,
  summarizeSafetyTaskProgress
} from './safety-operation-center-model.js'
import './safety-task-progress.styl'

export { summarizeSafetyTaskProgress }

const sourceLabels = {
  terminal: 'SSH 终端',
  agent: 'AI 助手',
  'quick-command': '快捷命令',
  'server-status': '服务器状态',
  sftp: 'SFTP 文件',
  unknown: '未知'
}

const stepStatusLabels = {
  pending: '等待',
  running: '执行中',
  completed: '成功',
  success: '成功',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
  skipped: '已跳过',
  'awaiting-confirmation': '等待确认'
}

function StepStatusIcon ({ status }) {
  if (['completed', 'success', 'succeeded'].includes(status)) {
    return <CheckCircleOutlined className='is-success' />
  }
  if (status === 'failed') return <CloseCircleOutlined className='is-error' />
  if (status === 'running') return <LoadingOutlined className='is-running' />
  return <MinusCircleOutlined />
}

export default function SafetyTaskProgress ({
  task,
  canCancel = false,
  cancelling = false,
  onCancel
}) {
  const summary = summarizeSafetyTaskProgress(task)
  const [statusText, statusColor] = getSafetyTaskStatusPresentation(summary.status)
  const cancelButton = (
    <Button
      danger
      size='small'
      icon={<StopOutlined />}
      loading={cancelling}
      disabled={!canCancel || cancelling}
      onClick={canCancel ? onCancel : undefined}
    >
      取消任务
    </Button>
  )

  return (
    <section className='safety-task-progress' aria-label={`任务 ${summary.title}`}>
      <div className='safety-task-progress-header'>
        <div className='safety-task-progress-heading'>
          <Tag>来源：{sourceLabels[summary.source] || summary.source}</Tag>
          <strong>{summary.title}</strong>
          <Tag color={statusColor}>{statusText}</Tag>
        </div>
        {canCancel
          ? cancelButton
          : <Tooltip title='任务执行器尚未接入'>{cancelButton}</Tooltip>}
      </div>

      <div className='safety-task-progress-endpoint'>{summary.endpoint}</div>
      <div className='safety-task-progress-current'>
        当前步骤：{summary.currentStep?.title || '等待下一步'}
      </div>
      <Progress percent={summary.percent} size='small' showInfo={false} />
      <div className='safety-task-progress-counts'>
        <span>总计 {summary.total}</span>
        <span className='is-success'>成功 {summary.successCount}</span>
        <span className='is-error'>失败 {summary.failedCount}</span>
        <span>取消 {summary.cancelledCount}</span>
      </div>

      <div className='safety-task-progress-steps'>
        {summary.steps.map(step => (
          <div className='safety-task-progress-step' key={step.id}>
            <div className='safety-task-progress-step-line'>
              <StepStatusIcon status={step.status} />
              <strong>{step.title}</strong>
              <span>{stepStatusLabels[step.status] || step.status}</span>
            </div>
            {step.commandSummary
              ? <code className='safety-task-progress-command'>{step.commandSummary}</code>
              : null}
            {step.outputPreview
              ? <pre className='safety-task-progress-output'>{step.outputPreview}</pre>
              : null}
            {step.error
              ? <div className='safety-task-progress-error'>{step.error}</div>
              : null}
          </div>
        ))}
      </div>
      {summary.error
        ? <div className='safety-task-progress-error'>{summary.error}</div>
        : null}
    </section>
  )
}
