import { useMemo } from 'react'

const e = window.translate

function textOrUnknown (value) {
  const text = String(value ?? '').trim()
  return text || e('shellpilotUnknown')
}

export function AgentRiskConfirmationContent ({ transaction }) {
  const details = useMemo(() => {
    const endpoint = transaction.endpoint || {}
    const targetIdentity = [
      `${textOrUnknown(endpoint.username)}@${textOrUnknown(endpoint.host)}:${textOrUnknown(endpoint.port)}`,
      `fingerprint=${textOrUnknown(endpoint.hostKeyFingerprint)}`,
      `tab=${textOrUnknown(endpoint.tabId)}`,
      `pid=${textOrUnknown(endpoint.pid)}`,
      `terminalPid=${textOrUnknown(endpoint.terminalPid)}`
    ].join(' | ')
    const purpose = textOrUnknown(transaction.purpose)
    const fullCommands = transaction.calls.map(call => textOrUnknown(call.command || call.name))
    const skillArtifacts = transaction.calls
      .filter(call => call.skillArtifact)
      .map(call => ({
        skillId: call.skillArtifact.skillId,
        artifactId: call.skillArtifact.id,
        path: call.skillArtifact.path,
        target: call.skillArtifact.target,
        interpreter: call.skillArtifact.interpreter,
        packageDigest: call.skillArtifact.packageDigest,
        fileDigest: call.skillArtifact.fileDigest,
        arguments: call.skillArtifact.arguments || [],
        requestedPermissions: call.skillArtifact.requestedPermissions || [],
        content: textOrUnknown(call.expandedContent)
      }))
    const scriptEntries = transaction.calls
      .map(call => call.scriptEntry || call.skillArtifact?.path)
      .filter(Boolean)
    const affectedObjects = transaction.affectedObjects.length
      ? transaction.affectedObjects
      : ['unknown']
    const worstCase = textOrUnknown(transaction.worstCase)
    const resourceImpact = transaction.resourceImpact || {}
    const disconnectPossible = transaction.disconnectPossible ? e('yes') : e('no')
    const recovery = transaction.recovery || { type: 'unknown', verified: false }
    const rollbackLimits = textOrUnknown(transaction.rollbackLimits)
    const verification = transaction.verification.length
      ? transaction.verification
      : [e('shellpilotAgentRiskNoExtraVerification')]
    const cancellationBehavior = textOrUnknown(transaction.cancellationBehavior)
    return {
      targetIdentity,
      purpose,
      fullCommands,
      scriptEntries,
      skillArtifacts,
      affectedObjects,
      worstCase,
      resourceImpact,
      disconnectPossible,
      recovery,
      rollbackLimits,
      verification,
      cancellationBehavior
    }
  }, [transaction])

  return (
    <div className='agent-risk-confirmation-content'>
      <p className='agent-risk-warning'>{e('shellpilotAgentRiskWarning')}</p>
      {details.recovery.verified !== true && (
        <p className='agent-risk-warning'>
          {e('shellpilotAgentRiskRecoveryNotReady')}
        </p>
      )}
      <dl className='agent-risk-details'>
        <dt>{e('shellpilotAgentRiskTargetIdentity')}</dt><dd>{details.targetIdentity}</dd>
        <dt>{e('shellpilotPurpose')}</dt><dd>{details.purpose}</dd>
        <dt>{e('shellpilotAgentRiskFullCommand')}</dt><dd>{details.fullCommands.map(command => <pre key={command}>{command}</pre>)}</dd>
        <dt>{e('shellpilotAgentRiskScriptEntry')}</dt><dd>{details.scriptEntries.length ? details.scriptEntries.join(', ') : e('shellpilotUnknown')}</dd>
        {details.skillArtifacts.length > 0 && (
          <>
            <dt>{e('shellpilotAgentRiskSkillContent')}</dt>
            <dd>{details.skillArtifacts.map(artifact => (
              <div key={`${artifact.skillId}:${artifact.artifactId}:${artifact.fileDigest}`}>
                <pre>{JSON.stringify({ ...artifact, content: undefined }, null, 2)}</pre>
                <pre>{artifact.content}</pre>
              </div>
            ))}
            </dd>
          </>
        )}
        <dt>{e('shellpilotSafetyAffectedObjects')}</dt><dd>{details.affectedObjects.join(', ')}</dd>
        <dt>{e('shellpilotSafetyWorstCase')}</dt><dd>{details.worstCase}</dd>
        <dt>{e('shellpilotAgentRiskResourceImpact')}</dt>
        <dd>{['cpu', 'memory', 'disk', 'network', 'duration'].map(key => (
          <span key={key}>{key}: {textOrUnknown(details.resourceImpact[key])}</span>
        ))}
        </dd>
        <dt>{e('shellpilotAgentRiskDisconnectPossible')}</dt><dd>{details.disconnectPossible}</dd>
        <dt>{e('shellpilotAgentRiskRecoveryPoint')}</dt><dd>{textOrUnknown(details.recovery.type)} / {e('shellpilotAgentRiskVerified')}={String(details.recovery.verified === true)}</dd>
        <dt>{e('shellpilotSafetyRollbackLimits')}</dt><dd>{details.rollbackLimits}</dd>
        <dt>{e('shellpilotAgentRiskVerificationSteps')}</dt><dd><pre>{JSON.stringify(details.verification, null, 2)}</pre></dd>
        <dt>{e('shellpilotAgentRiskCancellationBehavior')}</dt><dd>{details.cancellationBehavior}</dd>
      </dl>
    </div>
  )
}

export async function requestAgentRiskConfirmation (transaction, options = {}) {
  const signal = options.signal
  if (signal?.aborted) return false
  const Modal = options.Modal || (await import('antd')).Modal
  if (signal?.aborted) return false
  return new Promise(resolve => {
    let settled = false
    const modalRef = { current: null }
    const settle = accepted => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      modalRef.current?.destroy?.()
      resolve(accepted)
    }
    const onAbort = () => settle(false)
    signal?.addEventListener('abort', onAbort, { once: true })
    modalRef.current = Modal.confirm({
      title: e('shellpilotAgentRiskConfirmTitle'),
      content: <AgentRiskConfirmationContent transaction={transaction} />,
      width: 760,
      okText: e('shellpilotAgentRiskConfirmExecute'),
      cancelText: e('cancel'),
      okButtonProps: { danger: true },
      maskClosable: false,
      keyboard: true,
      onOk: () => settle(true),
      onCancel: () => settle(false)
    })
  })
}
