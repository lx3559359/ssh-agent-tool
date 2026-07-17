import { useMemo } from 'react'

function textOrUnknown (value) {
  const text = String(value ?? '').trim()
  return text || 'unknown'
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
    const disconnectPossible = transaction.disconnectPossible ? '是' : '否'
    const recovery = transaction.recovery || { type: 'unknown', verified: false }
    const rollbackLimits = textOrUnknown(transaction.rollbackLimits)
    const verification = transaction.verification.length
      ? transaction.verification
      : ['unknown']
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
      <p className='agent-risk-warning'>这是高风险二次确认。确认后仅执行已冻结的调用。</p>
      {details.recovery.verified !== true && (
        <p className='agent-risk-warning'>
          Exact recovery is not ready at this dialog. The lower safety transaction must prepare and verify it before remote dispatch; non-reversible work has no automatic rollback.
        </p>
      )}
      <dl className='agent-risk-details'>
        <dt>目标 SSH 身份</dt><dd>{details.targetIdentity}</dd>
        <dt>目的</dt><dd>{details.purpose}</dd>
        <dt>完整命令</dt><dd>{details.fullCommands.map(command => <pre key={command}>{command}</pre>)}</dd>
        <dt>脚本入口</dt><dd>{details.scriptEntries.length ? details.scriptEntries.join(', ') : 'unknown'}</dd>
        {details.skillArtifacts.length > 0 && (
          <>
            <dt>Skill 脚本完整内容</dt>
            <dd>{details.skillArtifacts.map(artifact => (
              <div key={`${artifact.skillId}:${artifact.artifactId}:${artifact.fileDigest}`}>
                <pre>{JSON.stringify({ ...artifact, content: undefined }, null, 2)}</pre>
                <pre>{artifact.content}</pre>
              </div>
            ))}
            </dd>
          </>
        )}
        <dt>影响对象</dt><dd>{details.affectedObjects.join(', ')}</dd>
        <dt>最坏结果</dt><dd>{details.worstCase}</dd>
        <dt>资源影响</dt>
        <dd>{['cpu', 'memory', 'disk', 'network', 'duration'].map(key => (
          <span key={key}>{key}: {textOrUnknown(details.resourceImpact[key])}</span>
        ))}
        </dd>
        <dt>可能断开连接</dt><dd>{details.disconnectPossible}</dd>
        <dt>恢复点</dt><dd>{textOrUnknown(details.recovery.type)} / verified={String(details.recovery.verified === true)}</dd>
        <dt>回滚限制</dt><dd>{details.rollbackLimits}</dd>
        <dt>验证步骤</dt><dd><pre>{JSON.stringify(details.verification, null, 2)}</pre></dd>
        <dt>取消行为</dt><dd>{details.cancellationBehavior}</dd>
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
      title: 'Agent 高风险事务二次确认',
      content: <AgentRiskConfirmationContent transaction={transaction} />,
      width: 760,
      okText: '确认冻结内容并执行',
      cancelText: '取消',
      okButtonProps: { danger: true },
      maskClosable: false,
      keyboard: true,
      onOk: () => settle(true),
      onCancel: () => settle(false)
    })
  })
}
