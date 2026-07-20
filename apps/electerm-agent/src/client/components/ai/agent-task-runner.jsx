import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Modal,
  Progress,
  Space,
  Spin,
  Tag,
  Tooltip
} from 'antd'
import {
  CloseCircleOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  StopOutlined
} from '@ant-design/icons'
import { getActiveAIConfig } from './ai-profiles.js'
import {
  buildDiagnosticResultPrompt,
  buildTargetedDiagnosticPrompt,
  getDiagnosticTargetName,
  parseDiagnosticPlan
} from './diagnostic-plan.js'
import {
  createAgentTaskController,
  createAgentTaskUiLifecycle,
  requestDiagnosticPlanText
} from './agent-task-controller.js'
import { agentTaskRegistry } from './agent-task-registry.js'
import * as transactionStore from '../../common/safety-transactions/transaction-store.js'
import { createTraceContext } from '../../common/quality/trace-context.js'
import { cancelRunCmd, runCmd } from '../terminal/terminal-apis.js'
import { refsStatic } from '../common/ref'
import message from '../common/message'
import './agent-task-runner.styl'

const e = window.translate

const finalStatuses = new Set([
  'completed',
  'failed',
  'cancelled',
  'partially-completed'
])

const stepStatusMeta = {
  pending: ['shellpilotSafetyStepPending', 'default'],
  running: ['shellpilotSafetyStepRunning', 'processing'],
  completed: ['shellpilotSafetyStepSuccess', 'success'],
  failed: ['shellpilotSafetyStepFailed', 'error'],
  cancelled: ['shellpilotSafetyStepCancelled', 'default']
}

const taskStatusLabelKeys = {
  'awaiting-plan-confirmation': 'shellpilotAgentTaskAwaitingConfirmation',
  'running-readonly': 'shellpilotAgentTaskRunningReadonly',
  completed: 'shellpilotAgentTaskCompleted',
  failed: 'shellpilotAgentTaskFailed',
  cancelled: 'shellpilotSafetyStatusCancelled',
  'partially-completed': 'shellpilotSafetyStatusPartiallyCompleted'
}

function displayError (error, fallback = e('shellpilotOperationFailed')) {
  const text = String(error?.message || error || fallback).trim()
  const separator = /[:：]\s*$/.test(fallback) ? '' : ' '
  return /[\u3400-\u9fff]/.test(text) ? text : `${fallback}${separator}${text}`
}

function eventTaskStatus (event, current) {
  if (event.status === 'running' || event.status === 'completed') {
    return finalStatuses.has(current) ? current : 'running-readonly'
  }
  if (event.status === 'failed') return 'failed'
  if (event.status === 'cancelled') return 'cancelled'
  return current
}

export default function AgentTaskRunner ({
  open,
  onClose,
  store,
  snapshot,
  target,
  terminal,
  getCurrentEndpoint
}) {
  const [phase, setPhase] = useState('idle')
  const [plan, setPlan] = useState(null)
  const [task, setTask] = useState(null)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const generationAbortRef = useRef(null)
  const generationRequestRef = useRef(0)
  const activeRunRef = useRef(0)
  const mountedRef = useRef(true)
  const taskTraceContextRef = useRef(null)
  const uiLifecycle = useMemo(() => createAgentTaskUiLifecycle({
    abortGeneration: () => generationAbortRef.current?.abort(),
    closeView: () => onClose?.()
  }), [onClose])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!open || !snapshot || !target || !terminal) return
    const generationToken = ++generationRequestRef.current
    activeRunRef.current += 1
    taskTraceContextRef.current = createTraceContext({
      ...(target.requestId ? { requestId: String(target.requestId) } : {}),
      module: 'agent',
      action: 'agent-task'
    })
    generationAbortRef.current?.abort()
    const controller = new AbortController()
    generationAbortRef.current = controller
    setPhase('generating')
    setPlan(null)
    setTask(null)
    setError('')
    setCancelling(false)

    async function generatePlan () {
      try {
        const endpoint = terminal.getTerminalSafetyEndpoint()
        const prompt = buildTargetedDiagnosticPrompt({ snapshot, target })
        const text = await requestDiagnosticPlanText({
          prompt,
          config: getActiveAIConfig(store?.config || {}),
          signal: controller.signal,
          runGlobalAsync: window.pre?.runGlobalAsync?.bind(window.pre)
        })
        const nextPlan = parseDiagnosticPlan(text, { endpoint, target })
        if (!mountedRef.current || controller.signal.aborted || generationRequestRef.current !== generationToken) return
        setPlan(nextPlan)
        setPhase('plan')
      } catch (requestError) {
        if (!mountedRef.current || controller.signal.aborted || generationRequestRef.current !== generationToken) return
        setError(displayError(requestError, e('shellpilotAgentTaskPlanFailed')))
        setPhase('error')
      }
    }

    generatePlan()
    return () => controller.abort()
  }, [open, target?.requestId])

  const progress = useMemo(() => {
    const steps = task?.steps || plan?.steps || []
    if (!steps.length) return 0
    const settled = steps.filter(step => ['completed', 'failed', 'cancelled'].includes(step.status)).length
    return Math.round(settled / steps.length * 100)
  }, [plan, task])

  function handleExecutionEvent (event, runToken) {
    if (!mountedRef.current || activeRunRef.current !== runToken) return
    setTask(current => {
      if (!current || current.id !== event.taskId) return current
      const steps = current.steps.map(step => step.id === event.stepId
        ? {
            ...step,
            status: event.status,
            output: event.output || step.output
          }
        : step)
      return {
        ...current,
        steps,
        status: eventTaskStatus(event, current.status)
      }
    })
  }

  async function handleConfirm () {
    if (!plan || !terminal) return
    const runToken = ++activeRunRef.current
    setPhase('running')
    setError('')
    try {
      const controller = createAgentTaskController({
        store: transactionStore,
        registry: agentTaskRegistry,
        traceContext: taskTraceContextRef.current,
        endpoint: plan.endpoint,
        pid: terminal.pid,
        runCmd,
        cancelRunCmd,
        getCurrentEndpoint: async () => {
          if (typeof getCurrentEndpoint === 'function') {
            return getCurrentEndpoint()
          }
          if (!terminal.pid || !terminal.isSsh?.()) {
            throw new Error(e('shellpilotAgentTaskSshDisconnected'))
          }
          return terminal.getTerminalSafetyEndpoint()
        },
        onEvent: event => handleExecutionEvent(event, runToken),
        onTaskChange: nextTask => {
          if (mountedRef.current && activeRunRef.current === runToken) setTask(nextTask)
        }
      })
      const completed = await controller.confirmAndRun(plan)
      if (!mountedRef.current || activeRunRef.current !== runToken) return
      setTask(completed)
      setPhase('finished')
    } catch (runError) {
      if (!mountedRef.current || activeRunRef.current !== runToken) return
      setError(displayError(runError, e('shellpilotAgentTaskRunFailed')))
      setPhase('finished')
    }
  }

  async function handleCancelTask () {
    if (!task?.id || !agentTaskRegistry.has(task.id)) return
    setCancelling(true)
    try {
      const cancelled = await agentTaskRegistry.cancel(task.id)
      if (!mountedRef.current) return
      setTask(cancelled)
      setPhase('finished')
    } catch (cancelError) {
      if (mountedRef.current) setError(displayError(cancelError, e('shellpilotAgentTaskCancelFailed')))
    } finally {
      if (mountedRef.current) setCancelling(false)
    }
  }

  function handleClose () {
    uiLifecycle.close(phase)
  }

  function handleSendToAi () {
    if (!task || !plan) return
    const prompt = buildDiagnosticResultPrompt({ plan, task })
    store?.handleOpenAIPanel?.()
    setTimeout(() => {
      if (!refsStatic.get('AIChat')?.setPrompt) {
        message.warning(e('shellpilotAgentTaskAssistantNotReady'))
        return
      }
      refsStatic.get('AIChat')?.setPrompt(prompt)
      handleClose()
    }, 120)
  }

  function renderPlan () {
    if (!plan) return null
    return (
      <div className='agent-task-plan'>
        <Alert
          type='info'
          showIcon
          message={e('shellpilotAgentTaskPlanAwaiting')}
          description={e('shellpilotAgentTaskPlanDescription')}
        />
        <div className='agent-task-summary'>{plan.summary}</div>
        <div className='agent-task-step-list'>
          {plan.steps.map((step, index) => (
            <section className='agent-task-step' key={step.id}>
              <header><strong>{index + 1}. {step.title}</strong><Tag color='success'>{e('shellpilotSafetyAuditReadonly')}</Tag></header>
              <p>{step.purpose}</p>
              <pre>{step.command}</pre>
              <small>{e('shellpilotAgentTaskTimeoutLimit')}：{step.timeoutMs} ms</small>
            </section>
          ))}
        </div>
        <div className='agent-task-signals'>
          <strong>{e('shellpilotAgentTaskExpectedSignals')}</strong>
          <ul>{plan.expectedSignals.map(item => <li key={item}>{item}</li>)}</ul>
          <strong>{e('shellpilotAgentTaskStopConditions')}</strong>
          <ul>{plan.stopConditions.map(item => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>
    )
  }

  function renderTask () {
    if (!task) {
      return <Spin tip={e('shellpilotAgentTaskCreatingAudit')}><div className='agent-task-loading-space' /></Spin>
    }
    const finished = finalStatuses.has(task.status)
    return (
      <div className='agent-task-progress'>
        <div className='agent-task-progress-head'>
          <div>
            <strong>{finished ? e('shellpilotAgentTaskReport') : e('shellpilotAgentTaskLiveProgress')}</strong>
            <span>{taskStatusLabelKeys[task.status] ? e(taskStatusLabelKeys[task.status]) : task.status}</span>
          </div>
          <Progress percent={progress} size='small' status={task.status === 'failed' ? 'exception' : undefined} />
        </div>
        {error || task.error ? <Alert type='error' showIcon message={error || task.error} /> : null}
        <div className='agent-task-step-list'>
          {(task.steps || []).map((step, index) => {
            const meta = stepStatusMeta[step.status] || [step.status || 'shellpilotSafetyStepPending', 'default']
            const audit = step.audit?.at(-1)
            return (
              <section className={`agent-task-step ${step.status || 'pending'}`} key={step.id}>
                <header><strong>{index + 1}. {step.title}</strong><Tag color={meta[1]}>{meta[0].startsWith('shellpilot') ? e(meta[0]) : meta[0]}</Tag></header>
                <p>{step.purpose}</p>
                <pre>{step.command}</pre>
                {audit ? <small>{e('shellpilotExitCode')}：{Number.isFinite(audit.code) ? audit.code : e('shellpilotAgentTaskNoExitCode')}</small> : null}
                {step.output ? <div className='agent-task-output'><span>{e('shellpilotAgentTaskEvidencePreview')}</span><pre>{step.output}</pre></div> : null}
                {step.error ? <div className='agent-task-step-error'>{step.error}</div> : null}
              </section>
            )
          })}
        </div>
        {finished
          ? (
            <div className='agent-task-final'>
              <strong>{e('shellpilotAgentTaskSummary')}</strong>
              <p>{task.summary || plan?.summary}</p>
              <strong>{e('shellpilotAgentTaskPlannedStopConditions')}</strong>
              <p>{(task.stopConditions || plan?.stopConditions || []).join('；')}</p>
              <strong>{e('shellpilotAgentTaskStopConditionResult')}</strong>
              <p>{task.status === 'completed'
                ? e('shellpilotAgentTaskNoSystemStop')
                : e('shellpilotAgentTaskStoppedEarly')}
              </p>
              <div>{e('shellpilotAgentTaskAuditRecorded')}</div>
            </div>
            )
          : null}
      </div>
    )
  }

  const footer = phase === 'plan'
    ? (
      <Space wrap>
        <Tooltip title={e('shellpilotAgentTaskCancelPlanHint')}><Button onClick={handleClose}>{e('shellpilotAgentTaskCancelPlan')}</Button></Tooltip>
        <Tooltip title={e('shellpilotAgentTaskConfirmHint')}>
          <Button type='primary' icon={<SafetyCertificateOutlined />} onClick={handleConfirm}>{e('shellpilotAgentTaskConfirmRun')}</Button>
        </Tooltip>
      </Space>
      )
    : phase === 'running'
      ? (
        <Space wrap>
          <Tooltip title={e('shellpilotAgentTaskCloseHint')}><Button onClick={handleClose}>{e('shellpilotAgentTaskCloseWindow')}</Button></Tooltip>
          <Tooltip title={e('shellpilotAgentTaskCancelHint')}>
            <Button danger icon={<StopOutlined />} loading={cancelling} disabled={!task?.id || !agentTaskRegistry.has(task.id)} onClick={handleCancelTask}>{e('shellpilotSafetyCancelTask')}</Button>
          </Tooltip>
        </Space>
        )
      : phase === 'finished'
        ? (
          <Space wrap>
            <Button onClick={handleClose}>{e('close')}</Button>
            <Tooltip title={e('shellpilotAgentTaskSendHint')}>
              <Button icon={<SendOutlined />} disabled={!task} onClick={handleSendToAi}>{e('shellpilotAgentTaskSendToAi')}</Button>
            </Tooltip>
          </Space>
          )
        : phase === 'generating'
          ? <Tooltip title={e('shellpilotAgentTaskCancelGenerationHint')}><Button danger icon={<StopOutlined />} onClick={handleClose}>{e('shellpilotAgentTaskCancelGeneration')}</Button></Tooltip>
          : <Button onClick={handleClose}>{e('close')}</Button>

  return (
    <Modal
      title={<Space><RobotOutlined />{e('shellpilotAgentTaskReadonlyDiagnosis')} · {getDiagnosticTargetName(target)}</Space>}
      open={open}
      onCancel={handleClose}
      footer={footer}
      width={840}
      destroyOnClose={false}
      maskClosable={phase !== 'running'}
      className='agent-task-runner-modal'
      closeIcon={<CloseCircleOutlined />}
    >
      <div className='agent-task-runner-body'>
        {phase === 'generating'
          ? <Spin tip={e('shellpilotAgentTaskGeneratingPlan')}><div className='agent-task-loading-space' /></Spin>
          : null}
        {phase === 'error' ? <Alert type='error' showIcon message={error || e('shellpilotAgentTaskPlanFailed')} /> : null}
        {phase === 'plan' ? renderPlan() : null}
        {['running', 'finished'].includes(phase) ? renderTask() : null}
      </div>
    </Modal>
  )
}
