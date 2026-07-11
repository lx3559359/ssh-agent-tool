// ai-chat-history.jsx
import { useLayoutEffect, useRef } from 'react'
import { auto } from 'manate/react'
import AIChatHistoryItem from './ai-chat-history-item'

export default auto(function AIChatHistory ({ history }) {
  const historyRef = useRef(null)
  const list = Array.isArray(history) ? history : []

  useLayoutEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight
    }
  }, [history])
  if (!list.length) {
    return <div ref={historyRef} className='ai-history-wrap ai-history-empty' />
  }
  return (
    <div ref={historyRef} className='ai-history-wrap'>
      {
        list.map((item) => {
          return (
            <AIChatHistoryItem
              key={item.id}
              item={item}
            />
          )
        })
      }
    </div>
  )
})
