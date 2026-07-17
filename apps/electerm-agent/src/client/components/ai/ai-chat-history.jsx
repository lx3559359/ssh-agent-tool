// ai-chat-history.jsx
import { useLayoutEffect, useRef } from 'react'
import { auto } from 'manate/react'
import AIChatHistoryItem from './ai-chat-history-item'
import { isAIHistoryNearBottom } from './ai-chat-scroll'

export default auto(function AIChatHistory ({ history }) {
  const historyRef = useRef(null)
  const stickToBottomRef = useRef(true)
  const list = Array.isArray(history) ? history : []
  const config = window.store?.config || {}
  const agentRunning = Boolean(window.store?.agentRunning)
  const configRevisionKey = [
    config.activeAIProfileId,
    config.credentialRevisionAI,
    ...(Array.isArray(config.aiProfiles)
      ? config.aiProfiles.map(profile => (
        `${profile?.id || ''}:${profile?.credentialRevisionAI || ''}`
      ))
      : [])
  ].join('|')

  useLayoutEffect(() => {
    if (historyRef.current && stickToBottomRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight
    }
  }, [history])

  function handleScroll (event) {
    stickToBottomRef.current = isAIHistoryNearBottom(event.currentTarget)
  }

  if (!list.length) {
    return (
      <div
        ref={historyRef}
        onScroll={handleScroll}
        className='ai-history-wrap ai-history-empty'
      />
    )
  }
  return (
    <div ref={historyRef} onScroll={handleScroll} className='ai-history-wrap'>
      {
        list.map((item) => {
          return (
            <AIChatHistoryItem
              key={item.id}
              item={item}
              config={config}
              configRevisionKey={configRevisionKey}
              agentRunning={agentRunning}
            />
          )
        })
      }
    </div>
  )
})
