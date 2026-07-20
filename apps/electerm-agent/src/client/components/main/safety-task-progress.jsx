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

const e = window.translate

const sourceLabelKeys = {
  terminal: 'shellpilotSafetySourceTerminal',
  agent: 'shellpilotSafetySourceAgent',
  'quick-command': 'shellpilotSafetySourceQuickCommand',
  'server-status': 'shellpilotSafetySourceServerStatus',
  sftp: 'shellpilotSafetySourceSftp',
  unknown: 'shellpilotUnknown'
}

const stepStatusLabelKeys = {
  pending: 'shellpilotSafetyStepPending',
  running: 'shellpilotSafetyStepRunning',
  completed: 'shellpilotSafetyStepSuccess',
  success: 'shellpilotSafetyStepSuccess',
  succeeded: 'shellpilotSafetyStepSuccess',
  failed: 'shellpilotSafetyStepFailed',
  cancelled: 'shellpilotSafetyStepCancelled',
  skipped: 'shellpilotSafetyStepSkipped',
  'awaiting-confirmation': 'shellpilotSafetyStepAwaitingConfirmation'
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
      {e('shellpilotSafetyCancelTask')}
    </Button>
  )

  return (
    <section className='safety-task-progress' aria-label={`${e('shellpilotSafetyTask')} ${summary.title}`}>
      <div className='safety-task-progress-header'>
        <div className='safety-task-progress-heading'>
          <Tag>{e('shellpilotSafetySource')}：{sourceLabelKeys[summary.source] ? e(sourceLabelKeys[summary.source]) : summary.source}</Tag>
          <strong>{summary.title}</strong>
          <Tag color={statusColor}>{statusText}</Tag>
        </div>
        {canCancel
          ? cancelButton
          : <Tooltip title={e('shellpilotSafetyRunnerUnavailable')}>{cancelButton}</Tooltip>}
      </div>

      <div className='safety-task-progress-endpoint'>{summary.endpoint}</div>
      <div className='safety-task-progress-current'>
        {e('shellpilotSafetyCurrentStep')}：{summary.currentStep?.title || e('shellpilotSafetyWaitingNextStep')}
      </div>
      <Progress percent={summary.percent} size='small' showInfo={false} />
      <div className='safety-task-progress-counts'>
        <span>{e('shellpilotSafetyTotal')} {summary.total}</span>
        <span className='is-success'>{e('shellpilotSafetySuccess')} {summary.successCount}</span>
        <span className='is-error'>{e('shellpilotSafetyFailed')} {summary.failedCount}</span>
        <span>{e('shellpilotSafetyCancelled')} {summary.cancelledCount}</span>
      </div>

      {summary.riskDetails
        ? (
          <div className='safety-task-risk-details'>
            <strong>{e('shellpilotSafetyAgentRiskTransaction')}</strong>
            <span>{e('shellpilotPurpose')}：{summary.riskDetails.purpose}</span>
            <span>{e('shellpilotSafetyAffectedObjects')}：{summary.riskDetails.affectedObjects.join(', ') || e('shellpilotUnknown')}</span>
            <span>{e('shellpilotSafetyWorstCase')}：{summary.riskDetails.worstCase}</span>
            <span>{e('shellpilotSafetyResources')}：{Object.entries(summary.riskDetails.resourceImpact).map(([key, value]) => `${key}=${value}`).join(', ')}</span>
            <span>{e('shellpilotSafetyRecovery')}：{summary.riskDetails.recovery}</span>
            <span>{e('shellpilotSafetyRollbackLimits')}：{summary.riskDetails.rollbackLimits}</span>
            <span>{e('shellpilotSafetyCancellation')}：{summary.riskDetails.cancellationBehavior}</span>
          </div>
          )
        : null}

      <div className='safety-task-progress-steps'>
        {summary.steps.map(step => (
          <div className='safety-task-progress-step' key={step.id}>
            <div className='safety-task-progress-step-line'>
              <StepStatusIcon status={step.status} />
              <strong>{step.title}</strong>
              <span>{stepStatusLabelKeys[step.status] ? e(stepStatusLabelKeys[step.status]) : step.status}</span>
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
