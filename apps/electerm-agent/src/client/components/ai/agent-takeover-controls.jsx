import { useEffect, useState } from 'react'
import Modal from '../common/modal'
import message from '../common/message'
import {
  assertSameSessionEndpoint
} from '../../common/safety-transactions/endpoint-guard.js'
import { cancelAgentRunsForScope } from './agent'
import { resolveAgentRuntimeEndpoint } from './agent-runtime-context.js'
import {
  agentTakeoverRegistry
} from './agent-takeover-registry.js'
import { isTakeoverActive } from './agent-takeover-state.js'
import './ai.styl'

const e = window.translate

function getStatusLabel (record) {
  if (record?.state === 'enabling') return e('shellpilotAiTakeoverEnabling')
  if (record?.state === 'stopping') return e('shellpilotAiTakeoverStopping')
  return e('shellpilotAiTakeoverActive')
}

export default function AgentTakeoverControls ({ activeTabId }) {
  const [, setRegistrySnapshot] = useState(
    () => agentTakeoverRegistry.snapshot()
  )
  const [pendingEndpoint, setPendingEndpoint] = useState(null)
  const endpoint = resolveAgentRuntimeEndpoint(activeTabId)
  const record = endpoint ? agentTakeoverRegistry.get(endpoint) : undefined
  const isActive = Boolean(record && isTakeoverActive(record.state))
  const isStopping = record?.state === 'stopping'

  useEffect(() => agentTakeoverRegistry.subscribe(setRegistrySnapshot), [])

  function requestEnable () {
    const currentEndpoint = resolveAgentRuntimeEndpoint(activeTabId)
    if (!currentEndpoint) return
    setPendingEndpoint(currentEndpoint)
  }

  function stopTakeover () {
    if (!endpoint || !record) return
    try {
      if (record.state !== 'stopping') {
        agentTakeoverRegistry.stop(endpoint)
      }
      cancelAgentRunsForScope(activeTabId)
      agentTakeoverRegistry.disable(endpoint, 'user-stop')
    } catch (error) {
      message.error(error?.message || e('shellpilotAiTakeoverStopFailed'))
    }
  }

  function toggleTakeover () {
    if (record) {
      stopTakeover()
      return
    }
    requestEnable()
  }

  function closeConfirmation () {
    setPendingEndpoint(null)
  }

  function confirmEnable () {
    try {
      const currentEndpoint = resolveAgentRuntimeEndpoint(activeTabId)
      assertSameSessionEndpoint(pendingEndpoint, currentEndpoint)
      agentTakeoverRegistry.enable(currentEndpoint)
      agentTakeoverRegistry.transition(currentEndpoint, 'active-idle')
      setPendingEndpoint(null)
    } catch (_) {
      setPendingEndpoint(null)
      message.error(e('shellpilotAiTakeoverSessionChanged'))
    }
  }

  const unavailableText = endpoint
    ? `${endpoint.username}@${endpoint.host}:${endpoint.port}`
    : e('shellpilotAiTakeoverUnavailable')
  const switchTitle = endpoint
    ? e(record ? 'shellpilotAiTakeoverDisable' : 'shellpilotAiTakeoverEnable')
    : e('shellpilotAiTakeoverUnavailable')

  return (
    <>
      <div className='agent-takeover-controls'>
        <button
          type='button'
          className={`agent-takeover-switch${isActive ? ' active' : ''}`}
          role='switch'
          aria-checked={isActive}
          aria-describedby='agent-takeover-availability'
          disabled={!endpoint || isStopping}
          title={switchTitle}
          onClick={toggleTakeover}
        >
          <span className='agent-takeover-switch-track' aria-hidden='true'>
            <span className='agent-takeover-switch-thumb' />
          </span>
          <span>{e('shellpilotAiTakeoverLabel')}</span>
        </button>
        {
          isActive
            ? (
              <span className={`agent-takeover-badge ${record.state}`}>
                {getStatusLabel(record)}
              </span>
              )
            : null
        }
        {
          record
            ? (
              <button
                type='button'
                className='agent-takeover-stop'
                onClick={stopTakeover}
                disabled={isStopping}
              >
                {e('shellpilotAiTakeoverStop')}
              </button>
              )
            : null
        }
        <span
          id='agent-takeover-availability'
          className={`agent-takeover-availability${endpoint ? '' : ' unavailable'}`}
          title={unavailableText}
        >
          {unavailableText}
        </span>
      </div>

      <Modal
        open={Boolean(pendingEndpoint)}
        title={e('shellpilotAiTakeoverConfirmTitle')}
        width={520}
        maskClosable={false}
        keyboardConfirm={false}
        onCancel={closeConfirmation}
        wrapClassName='agent-takeover-confirm-modal'
        footer={(
          <div className='custom-modal-footer-buttons'>
            <button
              type='button'
              className='custom-modal-cancel-btn'
              onClick={closeConfirmation}
            >
              {e('cancel')}
            </button>
            <button
              type='button'
              className='custom-modal-ok-btn'
              onClick={confirmEnable}
            >
              {e('shellpilotAiTakeoverEnable')}
            </button>
          </div>
        )}
      >
        {
          pendingEndpoint
            ? (
              <div className='agent-takeover-confirm-content'>
                <p>{e('shellpilotAiTakeoverConfirmIntro')}</p>
                <dl className='agent-takeover-identity'>
                  <dt>{e('shellpilotAiTakeoverHost')}</dt>
                  <dd>{pendingEndpoint.host}</dd>
                  <dt>{e('shellpilotAiTakeoverPort')}</dt>
                  <dd>{pendingEndpoint.port}</dd>
                  <dt>{e('shellpilotAiTakeoverUser')}</dt>
                  <dd>{pendingEndpoint.username}</dd>
                  <dt>{e('shellpilotAiTakeoverFingerprint')}</dt>
                  <dd><code>{pendingEndpoint.hostKeyFingerprint}</code></dd>
                </dl>
                <ul className='agent-takeover-rules'>
                  <li>{e('shellpilotAiTakeoverReadonlyRule')}</li>
                  <li>{e('shellpilotAiTakeoverRiskRule')}</li>
                </ul>
              </div>
              )
            : null
        }
      </Modal>
    </>
  )
}
