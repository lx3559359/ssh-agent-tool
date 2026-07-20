import Modal from '../common/modal'
import './terminal-command-safety-modal.styl'

const e = window.translate

function modalTitle (kind) {
  if (kind === 'blocked') return e('shellpilotCommandBlocked')
  if (kind === 'reversible') return e('shellpilotCommandReversible')
  if (kind === 'retry') return e('shellpilotCommandRetry')
  return e('shellpilotCommandHighRisk')
}

function serializeExpected (step) {
  try {
    return JSON.stringify(step.expected)
  } catch {
    return e('shellpilotCommandSerializeFailed')
  }
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
  const endpoint = confirmation.classification?.endpoint
  const executeText = reversible
    ? e('shellpilotCommandCreateRecoveryAndRun')
    : confirmation.kind === 'retry'
      ? e('shellpilotCommandPrepareRetry')
      : e('shellpilotCommandConfirmRunOnce')
  const detail = reversible
    ? e('shellpilotCommandReversibleDetail')
    : confirmation.kind === 'retry'
      ? confirmation.message
      : confirmation.kind === 'blocked'
        ? confirmation.message
        : e('shellpilotCommandNoRollback')
  const footer = (
    <div className='terminal-command-safety-actions'>
      <button
        type='button'
        className='custom-modal-cancel-btn'
        disabled={busy}
        onClick={onCancel}
      >
        {e('cancel')}
      </button>
      {confirmation.kind !== 'blocked'
        ? (
          <button
            type='button'
            className='terminal-command-safety-execute'
            disabled={busy}
            onClick={onExecute}
          >
            {busy ? e('shellpilotPreparing') : executeText}
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
            {endpoint
              ? (
                <div className='terminal-command-safety-endpoint'>
                  <div>
                    <strong>{e('shellpilotBoundSsh')}：</strong>
                    {endpoint.username}@{endpoint.host}:{endpoint.port}
                  </div>
                  <div>
                    <strong>{e('shellpilotHostFingerprint')}：</strong>
                    <code>{endpoint.hostKeyFingerprint}</code>
                  </div>
                </div>
                )
              : null}
            <div><strong>{e('shellpilotPurpose')}：</strong>{riskContext.purpose}</div>
            <div>
              <strong>{e('shellpilotImpactTargets')}：</strong>
              {riskContext.impactTargets.join(
                e('shellpilotListSeparator') === ',' ? ', ' : e('shellpilotListSeparator')
              )}
            </div>
            <div>
              <strong>{e('shellpilotPostExecutionVerification')}：</strong>
              {riskContext.verification.length === 0 ? e('shellpilotNoExtraConditions') : null}
            </div>
            {riskContext.verification.length > 0
              ? (
                <ul>
                  {riskContext.verification.map((step, index) => (
                    <li key={`${step.name}-${index}`}>
                      {step.name} <code>{JSON.stringify(step.args)}</code>
                      {step.expected === undefined
                        ? `；${e('shellpilotNoExtraConditions')}`
                        : (
                          <>
                            ；{e('shellpilotExpected')} <code>{serializeExpected(step)}</code>
                          </>
                          )}
                    </li>
                  ))}
                </ul>
                )
              : null}
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
