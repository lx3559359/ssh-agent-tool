import { memo } from 'react'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'

const e = window.translate

export default memo(function ReconnectOverlay ({
  reconnectState,
  onReconnectNow,
  onStopReconnect
}) {
  if (!reconnectState) {
    return null
  }

  const { status, attempt, maxAttempts, countdown } = reconnectState
  let message = ''
  if (status === 'waiting') {
    message = formatShellPilotTranslation(e, 'shellpilotReconnectWaiting', {
      attempt,
      maxAttempts,
      countdown
    })
  } else if (status === 'reconnecting') {
    message = formatShellPilotTranslation(e, 'shellpilotReconnecting', {
      attempt,
      maxAttempts
    })
  } else if (status === 'failed') {
    message = formatShellPilotTranslation(e, 'shellpilotReconnectFailed', { maxAttempts })
  } else if (status === 'stopped') {
    message = e('shellpilotReconnectStopped')
  }

  if (!message) {
    return null
  }

  return (
    <div
      className={`terminal-reconnect-overlay terminal-reconnect-${status}`}
      role='status'
      aria-live='polite'
    >
      <span className='terminal-reconnect-message'>{message}</span>
      {status === 'waiting' && (
        <span className='terminal-reconnect-actions'>
          <button type='button' onClick={onReconnectNow}>{e('shellpilotReconnectNow')}</button>
          <button type='button' onClick={onStopReconnect}>{e('shellpilotStopReconnect')}</button>
        </span>
      )}
    </div>
  )
})
