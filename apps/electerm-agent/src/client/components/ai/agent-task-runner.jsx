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
import { cancelRunCmd, runCmd } from '../terminal/terminal-apis.js'
import { refsStatic } from '../common/ref'
import message from '../common/message'
import './agent-task-runner.styl'

const finalStatuses = new Set([
  'completed',
  'failed',
  'cancelled',
  'partially-completed'
])

const stepStatusMeta = {
  pending: ['等待', 'default'],
  running: ['执行中', 'processing'],
  completed: ['成功', 'success'],
  failed: ['失败', 'error'],
  cancelled: ['已取消', 'default']
}

const taskStatusLabels = {
  'awaiting-plan-confirmation': '等待确认',
  'running-readonly': '只读诊断中',
  completed: '诊断完成',
  failed: '诊断失败',
  cancelled: '已取消',
  'partially-completed': '部分完成'
}

function displayError (error, fallback = '操作失败。') {
  const text = String(error?.message || error || fallback).trim()
  return /[\u3400-\u9fff]/.test(text) ? text : `${fallback}${text}`
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
        setError(displayError(requestError, 'AI 诊断计划生成失败：'))
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
        endpoint: plan.endpoint,
        pid: terminal.pid,
        runCmd,
        cancelRunCmd,
        getCurrentEndpoint: async () => {
          if (typeof getCurrentEndpoint === 'function') {
            return getCurrentEndpoint()
          }
          if (!terminal.pid || !terminal.isSsh?.()) {
            throw new Error('当前 SSH 连接已断开，诊断任务已停止。')
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
      setError(displayError(runError, '只读诊断执行失败：'))
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
      if (mountedRef.current) setError(displayError(cancelError, '取消任务失败：'))
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
        message.warning('AI 助手尚未准备完成，请稍后重试。')
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
          message='只读诊断计划待确认'
          description='确认前不会创建任务或执行远程命令。执行时仍会逐步复核命令和当前 SSH 端点。'
        />
        <div className='agent-task-summary'>{plan.summary}</div>
        <div className='agent-task-step-list'>
          {plan.steps.map((step, index) => (
            <section className='agent-task-step' key={step.id}>
              <header><strong>{index + 1}. {step.title}</strong><Tag color='success'>只读</Tag></header>
              <p>{step.purpose}</p>
              <pre>{step.command}</pre>
              <small>超时上限：{step.timeoutMs} ms</small>
            </section>
          ))}
        </div>
        <div className='agent-task-signals'>
          <strong>预期信号</strong>
          <ul>{plan.expectedSignals.map(item => <li key={item}>{item}</li>)}</ul>
          <strong>停止条件</strong>
          <ul>{plan.stopConditions.map(item => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>
    )
  }

  function renderTask () {
    if (!task) {
      return <Spin tip='正在创建并确认只读审计任务…'><div className='agent-task-loading-space' /></Spin>
    }
    const finished = finalStatuses.has(task.status)
    return (
      <div className='agent-task-progress'>
        <div className='agent-task-progress-head'>
          <div>
            <strong>{finished ? '诊断报告' : '实时进度'}</strong>
            <span>{taskStatusLabels[task.status] || task.status}</span>
          </div>
          <Progress percent={progress} size='small' status={task.status === 'failed' ? 'exception' : undefined} />
        </div>
        {error || task.error ? <Alert type='error' showIcon message={error || task.error} /> : null}
        <div className='agent-task-step-list'>
          {(task.steps || []).map((step, index) => {
            const meta = stepStatusMeta[step.status] || [step.status || '等待', 'default']
            const audit = step.audit?.at(-1)
            return (
              <section className={`agent-task-step ${step.status || 'pending'}`} key={step.id}>
                <header><strong>{index + 1}. {step.title}</strong><Tag color={meta[1]}>{meta[0]}</Tag></header>
                <p>{step.purpose}</p>
                <pre>{step.command}</pre>
                {audit ? <small>退出码：{Number.isFinite(audit.code) ? audit.code : '未返回'}</small> : null}
                {step.output ? <div className='agent-task-output'><span>证据预览</span><pre>{step.output}</pre></div> : null}
                {step.error ? <div className='agent-task-step-error'>{step.error}</div> : null}
              </section>
            )
          })}
        </div>
        {finished
          ? (
            <div className='agent-task-final'>
              <strong>结论摘要</strong>
              <p>{task.summary || plan?.summary}</p>
              <strong>计划停止条件</strong>
              <p>{(task.stopConditions || plan?.stopConditions || []).join('；')}</p>
              <strong>停止条件命中</strong>
              <p>{task.status === 'completed' ? '系统级停止条件未命中；计划中的语义条件未自动判定。' : '已因失败、超时、取消或端点变化停止后续步骤；计划中的语义条件未自动判定。'}</p>
              <div>完整步骤证据和结果已形成审计记录，可在安全中心查看。</div>
            </div>
            )
          : null}
      </div>
    )
  }

  const footer = phase === 'plan'
    ? (
      <Space wrap>
        <Tooltip title='放弃该计划，不创建审计任务'><Button onClick={handleClose}>取消计划</Button></Tooltip>
        <Tooltip title='创建审计任务并按顺序执行计划中的只读命令'>
          <Button type='primary' icon={<SafetyCertificateOutlined />} onClick={handleConfirm}>确认并执行</Button>
        </Tooltip>
      </Space>
      )
    : phase === 'running'
      ? (
        <Space wrap>
          <Tooltip title='关闭窗口后任务仍会继续，可在安全中心取消'><Button onClick={handleClose}>关闭窗口</Button></Tooltip>
          <Tooltip title='终止当前 SSH 命令并取消剩余步骤'>
            <Button danger icon={<StopOutlined />} loading={cancelling} disabled={!task?.id || !agentTaskRegistry.has(task.id)} onClick={handleCancelTask}>取消任务</Button>
          </Tooltip>
        </Space>
        )
      : phase === 'finished'
        ? (
          <Space wrap>
            <Button onClick={handleClose}>关闭</Button>
            <Tooltip title='仅填入脱敏诊断结果，不会自动发送'>
              <Button icon={<SendOutlined />} disabled={!task} onClick={handleSendToAi}>发送到 AI 对话</Button>
            </Tooltip>
          </Space>
          )
        : phase === 'generating'
          ? <Tooltip title='停止当前 AI 流式请求'><Button danger icon={<StopOutlined />} onClick={handleClose}>取消生成</Button></Tooltip>
          : <Button onClick={handleClose}>关闭</Button>

  return (
    <Modal
      title={<Space><RobotOutlined />AI 只读诊断 · {getDiagnosticTargetName(target)}</Space>}
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
          ? <Spin tip='正在生成仅限当前目标的只读诊断计划…'><div className='agent-task-loading-space' /></Spin>
          : null}
        {phase === 'error' ? <Alert type='error' showIcon message={error || 'AI 诊断计划生成失败。'} /> : null}
        {phase === 'plan' ? renderPlan() : null}
        {['running', 'finished'].includes(phase) ? renderTask() : null}
      </div>
    </Modal>
  )
}
