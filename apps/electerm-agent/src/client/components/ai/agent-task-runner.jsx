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
import { handoffAgentPromptToAi } from './agent-task-handoff.js'
import { getAgentTaskViewState } from './agent-task-view-state.js'
import { createAgentRunObserver } from './agent-run-observer.js'
import { createAgentRuntimeServices } from './agent-runtime-services.js'
import {
  createAgentDiagnosticKey,
  restoreAgentDiagnosticTask
} from './agent-task-recovery.js'
import * as transactionStore from '../../common/safety-transactions/transaction-store.js'
import { createTraceContext } from '../../common/quality/trace-context.js'
import { cancelRunCmd, runCmd } from '../terminal/terminal-apis.js'
import { refsStatic } from '../common/ref'
import message from '../common/message'
import './agent-task-runner.styl'

const e = key => createAgentRuntimeServices().translate(key)

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
  const runtimeServices = useMemo(() => createAgentRuntimeServices({
    store,
    refs: refsStatic,
    pre: globalThis.window?.pre,
    translate: globalThis.window?.translate
  }), [store])
  const [phase, setPhase] = useState('idle')
  const [plan, setPlan] = useState(null)
  const [task, setTask] = useState(null)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [retryRevision, setRetryRevision] = useState(0)
  const generationAbortRef = useRef(null)
  const generationRequestRef = useRef(0)
  const activeRunRef = useRef(0)
  const mountedRef = useRef(true)
  const taskTraceContextRef = useRef(null)
  const runObserverRef = useRef(null)
  const handoffCancelRef = useRef(null)
  const skipRecoveryRef = useRef(false)
  const diagnosticKey = createAgentDiagnosticKey(target)
  const uiLifecycle = useMemo(() => createAgentTaskUiLifecycle({
    abortGeneration: () => generationAbortRef.current?.abort(),
    closeView: () => onClose?.()
  }), [onClose])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      handoffCancelRef.current?.()
    }
  }, [])

  useEffect(() => {
    if (!open || !snapshot || !target || !terminal) return
    const generationToken = ++generationRequestRef.current
    activeRunRef.current += 1
    generationAbortRef.current?.abort()
    const controller = new AbortController()
    generationAbortRef.current = controller
    setPhase('generating')
    setPlan(null)
    setTask(null)
    setError('')
    setCancelling(false)

    async function generatePlan (endpoint) {
      try {
        const prompt = buildTargetedDiagnosticPrompt({ snapshot, target })
        const text = await requestDiagnosticPlanText({
          prompt,
          config: getActiveAIConfig(store?.config || {}),
          signal: controller.signal,
          observer: runObserverRef.current,
          services: runtimeServices
        })
        const nextPlan = parseDiagnosticPlan(text, { endpoint, target })
        if (!mountedRef.current || controller.signal.aborted || generationRequestRef.current !== generationToken) return
        setPlan(nextPlan)
        setPhase('plan')
      } catch (requestError) {
        if (!mountedRef.current || controller.signal.aborted || generationRequestRef.current !== generationToken) return
        setError(displayError(requestError, e('shellpilotAgentTaskPlanFailed')))
        setPhase('error')
        runObserverRef.current?.finish?.('failed', requestError?.code)
      }
    }

    async function restoreOrGenerate () {
      try {
        const endpoint = terminal.getTerminalSafetyEndpoint()
        const skipRecovery = skipRecoveryRef.current
        skipRecoveryRef.current = false
        const restored = skipRecovery
          ? null
          : await restoreAgentDiagnosticTask({
            registry: agentTaskRegistry,
            store: transactionStore,
            scopeId: endpoint.tabId,
            endpoint,
            diagnosticKey
          })
        if (!mountedRef.current || controller.signal.aborted || generationRequestRef.current !== generationToken) return
        if (restored) {
          setPlan(restored.task)
          setTask(restored.task)
          setPhase(restored.live ? 'running' : 'finished')
          return
        }
        taskTraceContextRef.current = createTraceContext({
          ...(target.requestId ? { requestId: String(target.requestId) } : {}),
          module: 'agent',
          action: 'agent-task'
        })
        runObserverRef.current = createAgentRunObserver({
          context: taskTraceContextRef.current
        })
        runObserverRef.current.start()
        await generatePlan(endpoint)
      } catch (requestError) {
        if (!mountedRef.current || controller.signal.aborted || generationRequestRef.current !== generationToken) return
        setError(displayError(requestError, e('shellpilotAgentTaskPlanFailed')))
        setPhase('error')
        runObserverRef.current?.error?.('persistence', requestError)
        runObserverRef.current?.finish?.('failed', requestError?.code)
      }
    }

    restoreOrGenerate()
    return () => controller.abort()
  }, [open, diagnosticKey, retryRevision])

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
    let createdTask = null
    try {
      const controller = createAgentTaskController({
        store: transactionStore,
        registry: agentTaskRegistry,
        observer: runObserverRef.current,
        traceContext: taskTraceContextRef.current,
        diagnosticKey,
        kind: 'diagnostic',
        scopeId: plan.endpoint?.tabId,
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
          createdTask = nextTask
          if (mountedRef.current && activeRunRef.current === runToken) setTask(nextTask)
        },
        services: runtimeServices
      })
      const completed = await controller.confirmAndRun(plan)
      if (!mountedRef.current || activeRunRef.current !== runToken) return
      setTask(completed)
      setPhase('finished')
    } catch (runError) {
      if (!mountedRef.current || activeRunRef.current !== runToken) return
      setError(displayError(runError, e('shellpilotAgentTaskRunFailed')))
      const terminalPhase = runError?.code === 'AGENT_ENDPOINT_CHANGED'
        ? 'endpoint_changed'
        : runError?.code === 'AGENT_BUDGET_EXCEEDED'
          ? 'budget_exceeded'
          : createdTask ? 'finished' : 'run-error'
      if (createdTask) {
        setTask({
          ...createdTask,
          errorCode: runError?.code || createdTask.errorCode,
          terminationReason: terminalPhase === 'finished'
            ? createdTask.terminationReason
            : terminalPhase
        })
      }
      setPhase(terminalPhase)
    }
  }

  async function handleCancelTask () {
    if (!task?.id || !agentTaskRegistry.has(task.id)) return
    setCancelling(true)
    runObserverRef.current?.cancellation?.('cancelling')
    try {
      const cancelled = await agentTaskRegistry.cancel(task.id)
      runObserverRef.current?.cancellation?.('cancel_confirmed')
      runObserverRef.current?.finish?.('cancelled')
      if (!mountedRef.current) return
      setTask(cancelled)
      setPhase('finished')
    } catch (cancelError) {
      runObserverRef.current?.cancellation?.(
        'cancel_failed',
        cancelError?.code || 'AGENT_CANCELLATION_FAILED'
      )
      runObserverRef.current?.error?.('cancellation', cancelError)
      runObserverRef.current?.finish?.(
        'cancel_failed',
        cancelError?.code || 'AGENT_CANCELLATION_FAILED'
      )
      if (mountedRef.current) {
        setError(displayError(cancelError, e('shellpilotAgentTaskCancelFailed')))
        setPhase('cancel_failed')
      }
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
    handoffCancelRef.current?.()
    handoffCancelRef.current = handoffAgentPromptToAi({
      prompt,
      getAiChat: () => runtimeServices.refs?.get('AIChat'),
      onReady: () => {
        handoffCancelRef.current = null
        handleClose()
      },
      onUnavailable: () => {
        handoffCancelRef.current = null
        message.warning(e('shellpilotAgentTaskHandoffTimeout'))
      }
    })
  }

  function handleRetryTask () {
    skipRecoveryRef.current = true
    setRetryRevision(value => value + 1)
  }

  const runState = runObserverRef.current?.snapshot?.() || null
  const viewState = getAgentTaskViewState({
    phase,
    task,
    error,
    cancelling,
    runState
  })

  function taskStateMetrics () {
    return e('shellpilotAgentTaskStateMetrics')
      .replace('{phase}', viewState.phase)
      .replace('{elapsed}', (viewState.elapsedMs / 1000).toFixed(1))
      .replace('{modelRequests}', viewState.modelRequests)
      .replace('{toolCalls}', viewState.toolCalls)
  }

  function renderTaskState () {
    return (
      <div className={`agent-task-state agent-task-state-${viewState.severity}`}>
        <Alert
          type={viewState.severity}
          showIcon
          message={e(viewState.titleKey)}
          description={viewState.status === 'cancel_failed'
            ? e('shellpilotAgentTaskCancelFailedWarning')
            : null}
        />
        <div className='agent-task-state-meta'>
          <span>{taskStateMetrics()}</span>
          {viewState.terminationReason
            ? <span>{e('shellpilotAgentTaskEndingReason').replace('{reason}', viewState.terminationReason)}</span>
            : null}
          {viewState.endpointFingerprint
            ? <code>{viewState.endpointFingerprint}</code>
            : null}
        </div>
      </div>
    )
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
    if (viewState.kind === 'error') {
      return (
        <div>
          {renderTaskState()}
          {viewState.message
            ? <Alert type='error' showIcon message={viewState.message} />
            : null}
        </div>
      )
    }
    if (viewState.kind === 'creating') {
      return (
        <div>
          {renderTaskState()}
          <Spin tip={e('shellpilotAgentTaskCreatingAudit')}><div className='agent-task-loading-space' /></Spin>
        </div>
      )
    }
    const finished = finalStatuses.has(task.status)
    return (
      <div className='agent-task-progress'>
        {renderTaskState()}
        <div className='agent-task-progress-head'>
          <div>
            <strong>{finished ? e('shellpilotAgentTaskReport') : e('shellpilotAgentTaskLiveProgress')}</strong>
            <span>{taskStatusLabelKeys[task.status] ? e(taskStatusLabelKeys[task.status]) : task.status}</span>
          </div>
          <Progress percent={progress} size='small' status={task.status === 'failed' ? 'exception' : undefined} />
        </div>
        {error || task.error ? <Alert type='error' showIcon message={error || task.error} /> : null}
        {viewState.showEvidence
          ? (
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
            )
          : null}
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
    : (
      <Space wrap className='agent-task-state-actions'>
        {viewState.canClose
          ? <Button onClick={handleClose}>{e('close')}</Button>
          : null}
        {viewState.canCancel && viewState.status === 'creating'
          ? <Tooltip title={e('shellpilotAgentTaskCancelGenerationHint')}><Button danger icon={<StopOutlined />} onClick={handleClose}>{e('shellpilotAgentTaskCancelGeneration')}</Button></Tooltip>
          : null}
        {viewState.canCancel && task
          ? (
            <Tooltip title={e('shellpilotAgentTaskCancelHint')}>
              <Button danger icon={<StopOutlined />} loading={cancelling} disabled={!agentTaskRegistry.has(task.id)} onClick={handleCancelTask}>{e('shellpilotSafetyCancelTask')}</Button>
            </Tooltip>
            )
          : null}
        {viewState.canRetry
          ? <Button type='primary' onClick={handleRetryTask}>{e('shellpilotAgentTaskRetryRun')}</Button>
          : null}
        {viewState.showEvidence && !['running', 'cancelling', 'cancel_failed'].includes(viewState.status)
          ? (
            <Tooltip title={e('shellpilotAgentTaskSendHint')}>
              <Button icon={<SendOutlined />} disabled={!task} onClick={handleSendToAi}>{e('shellpilotAgentTaskSendToAi')}</Button>
            </Tooltip>
            )
          : null}
      </Space>
      )

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
        {['running', 'finished', 'run-error'].includes(phase) ? renderTask() : null}
      </div>
    </Modal>
  )
}
