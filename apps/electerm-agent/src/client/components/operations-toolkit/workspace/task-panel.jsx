import { Button, Progress, Tag } from 'antd'
import { StopOutlined } from '@ant-design/icons'
import VirtualLog from './virtual-log'

const e = window.translate
const statusLabels = {
  created: '已创建',
  discovering: '正在识别环境',
  ready: '准备执行',
  running: '执行中',
  verifying: '正在校验',
  completed: '已完成',
  cancelling: '正在取消',
  cancelled: '已取消',
  'timed-out': '已超时',
  failed: '执行失败',
  disconnected: '连接已断开',
  'partially-completed': '部分完成'
}

const activeStatuses = new Set([
  'created',
  'discovering',
  'ready',
  'running',
  'verifying',
  'cancelling'
])

function taskOutput (task) {
  return (task?.steps || []).map(step => {
    return [`## ${step.title}`, step.output || ''].join('\n')
  }).join('\n\n')
}

export default function TaskPanel ({ task, tool, onCancel, onAnalyze }) {
  if (!task) return null
  const completeSteps = (task.steps || []).filter(step => {
    const hasExitCode = step.exitCode !== undefined && step.exitCode !== null
    return ['completed', 'failed'].includes(step.status) || hasExitCode
  }).length
  const totalSteps = tool?.steps?.length || Math.max(1, completeSteps)
  const progress = Math.min(100, Math.round(completeSteps / totalSteps * 100))
  const running = activeStatuses.has(task.status)
  return (
    <section
      aria-labelledby='operations-task-panel-title'
      className='operations-task-panel'
    >
      <header>
        <div>
          <strong id='operations-task-panel-title'>{tool?.title || task.toolId}</strong>
          <span>{task.endpointKey}</span>
        </div>
        <Tag color={task.status === 'completed' ? 'success' : running ? 'processing' : 'error'}>
          {statusLabels[task.status] || task.status}
        </Tag>
      </header>
      <Progress
        percent={task.status === 'completed' ? 100 : progress}
        status={task.status === 'failed' ? 'exception' : undefined}
        size='small'
      />
      <div className='operations-task-steps'>
        {(tool?.steps || []).map((step, index) => {
          const result = task.steps?.find(item => item.id === step.id)
          return (
            <span className={result?.status === 'completed' ? 'done' : result?.status === 'running' || (index === completeSteps && running) ? 'running' : ''} key={step.id}>
              {index + 1}. {step.title}
            </span>
          )
        })}
      </div>
      {task.error ? <div className='operations-task-error'>{task.error}</div> : null}
      <VirtualLog text={taskOutput(task)} />
      <footer>
        {running
          ? (
            <Button
              danger
              icon={<StopOutlined />}
              loading={task.status === 'cancelling'}
              onClick={() => onCancel(task.id)}
            >
              {e('shellpilotOperationsStopTask')}
            </Button>
            )
          : <Button onClick={() => onAnalyze(task)}>{e('shellpilotOperationsAnalyzeWithAI')}</Button>}
      </footer>
    </section>
  )
}
