import Modal from '../common/modal'
import './terminal-command-safety-modal.styl'

function modalTitle (kind) {
  if (kind === 'blocked') return '命令已拦截'
  if (kind === 'reversible') return '执行前保护'
  if (kind === 'retry') return '命令发送失败'
  return '高风险命令确认'
}

export default function TerminalCommandSafetyModal ({
  open,
  confirmation,
  busy,
  error,
  onExecute,
  onCancel
}) {
  if (!open || !confirmation) return null
  const reversible = confirmation.kind === 'reversible'
  const riskContext = confirmation.classification?.riskContext
  const executeText = reversible
    ? '创建恢复点并执行'
    : confirmation.kind === 'retry'
      ? '重新准备并重试'
      : '确认风险并执行一次'
  const detail = reversible
    ? '将先创建并验证恢复点，成功后才会释放当前命令。'
    : confirmation.kind === 'retry'
      ? confirmation.message
      : confirmation.kind === 'blocked'
        ? confirmation.message
        : '此操作没有自动回滚。请确认风险后仅执行一次。'
  const footer = (
    <div className='terminal-command-safety-actions'>
      <button
        type='button'
        className='custom-modal-cancel-btn'
        disabled={busy}
        onClick={onCancel}
      >
        取消
      </button>
      {confirmation.kind !== 'blocked'
        ? (
          <button
            type='button'
            className='terminal-command-safety-execute'
            disabled={busy}
            onClick={onExecute}
          >
            {busy ? '正在准备...' : executeText}
          </button>
          )
        : null}
    </div>
  )

  return (
    <Modal
      open={open}
      title={modalTitle(confirmation.kind)}
      width={500}
      maskClosable={!busy}
      keyboardConfirm={false}
      onCancel={busy ? undefined : onCancel}
      className='terminal-command-safety-modal'
      footer={footer}
    >
      <div className={`terminal-command-safety-kind is-${confirmation.kind}`}>
        {detail}
      </div>
      {riskContext
        ? (
          <div className='terminal-command-safety-risk-context'>
            <div><strong>目的：</strong>{riskContext.purpose}</div>
            <div>
              <strong>影响目标：</strong>
              {riskContext.impactTargets.join('、')}
            </div>
            <div><strong>执行后验证：</strong></div>
            <ul>
              {riskContext.verification.map((step, index) => (
                <li key={`${step.name}-${index}`}>
                  {step.name} <code>{JSON.stringify(step.args)}</code>
                </li>
              ))}
            </ul>
          </div>
          )
        : null}
      <pre className='terminal-command-safety-command'>{confirmation.command}</pre>
      {error
        ? <div className='terminal-command-safety-error'>{error}</div>
        : null}
    </Modal>
  )
}
