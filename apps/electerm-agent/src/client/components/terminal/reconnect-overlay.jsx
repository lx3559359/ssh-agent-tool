import { memo } from 'react'

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
    message = `自动重连：第 ${attempt}/${maxAttempts} 次，${countdown} 秒后重试`
  } else if (status === 'reconnecting') {
    message = `正在进行第 ${attempt}/${maxAttempts} 次自动重连...`
  } else if (status === 'failed') {
    message = `自动重连失败：已达到 ${maxAttempts} 次上限，请手动重连。`
  } else if (status === 'stopped') {
    message = '已停止自动重连'
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
          <button type='button' onClick={onReconnectNow}>立即重连</button>
          <button type='button' onClick={onStopReconnect}>停止重连</button>
        </span>
      )}
    </div>
  )
})
