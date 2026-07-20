// ai-chat-history.jsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { auto } from 'manate/react'
import { Button } from 'antd'
import { ArrowDownOutlined } from '@ant-design/icons'
import AIChatHistoryItem from './ai-chat-history-item'
import {
  createAIHistorySnapshot,
  getAIHistoryChangedItemIds,
  isAIHistoryNearBottom,
  mergeUnreadAIHistoryIds
} from './ai-chat-scroll'
import {
  AI_HISTORY_PAGE_SIZE,
  clampAIHistoryWindow,
  expandAIHistoryWindow,
  getVisibleAIHistory,
  syncAIHistoryWindow
} from './ai-history-window'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'

const e = window.translate

export default auto(function AIChatHistory ({ history, agentRunning }) {
  const historyRef = useRef(null)
  const stickToBottomRef = useRef(true)
  const list = Array.isArray(history) ? history : []
  const previousHistoryRef = useRef(createAIHistorySnapshot(list))
  const previousScrollHeightRef = useRef(null)
  const [unreadItemIds, setUnreadItemIds] = useState([])
  const [visibleCount, setVisibleCount] = useState(() => (
    clampAIHistoryWindow(AI_HISTORY_PAGE_SIZE, list.length)
  ))
  const visibleList = getVisibleAIHistory(list, visibleCount)
  const config = window.store?.config || {}
  const configRevisionKey = [
    config.activeAIProfileId,
    config.credentialRevisionAI,
    ...(Array.isArray(config.aiProfiles)
      ? config.aiProfiles.map(profile => (
        `${profile?.id || ''}:${profile?.credentialRevisionAI || ''}`
      ))
      : [])
  ].join('|')

  useEffect(() => {
    setVisibleCount(current => syncAIHistoryWindow(current, list.length))
  }, [list.length])

  useLayoutEffect(() => {
    const historyElement = historyRef.current
    const previousHistory = previousHistoryRef.current
    const nextHistory = createAIHistorySnapshot(list)
    const changedItemIds = getAIHistoryChangedItemIds(previousHistory, nextHistory)
    previousHistoryRef.current = nextHistory

    if (historyElement && stickToBottomRef.current) {
      historyElement.scrollTop = historyElement.scrollHeight
      setUnreadItemIds([])
      return
    }
    setUnreadItemIds(current => mergeUnreadAIHistoryIds(current, changedItemIds, false))
  }, [history])

  useLayoutEffect(() => {
    const historyElement = historyRef.current
    if (!historyElement || previousScrollHeightRef.current === null) return
    const previousScrollHeight = previousScrollHeightRef.current
    previousScrollHeightRef.current = null
    historyElement.scrollTop += historyElement.scrollHeight - previousScrollHeight
  }, [visibleCount])

  function handleScroll (event) {
    const isNearBottom = isAIHistoryNearBottom(event.currentTarget)
    stickToBottomRef.current = isNearBottom
    if (isNearBottom) {
      setUnreadItemIds([])
    }
  }

  function handleBackToLatest () {
    const historyElement = historyRef.current
    if (!historyElement) return
    stickToBottomRef.current = true
    historyElement.scrollTo?.({
      top: historyElement.scrollHeight,
      behavior: 'smooth'
    })
    if (!historyElement.scrollTo) {
      historyElement.scrollTop = historyElement.scrollHeight
    }
    setUnreadItemIds([])
  }

  function handleLoadEarlier () {
    const historyElement = historyRef.current
    if (historyElement) {
      previousScrollHeightRef.current = historyElement.scrollHeight
    }
    setVisibleCount(current => expandAIHistoryWindow(current, list.length))
  }

  return (
    <div className='ai-history-shell'>
      {
        list.length
          ? (
            <div ref={historyRef} onScroll={handleScroll} className='ai-history-wrap'>
              {
                visibleList.length < list.length
                  ? (
                    <div className='ai-history-load-earlier'>
                      <Button size='small' onClick={handleLoadEarlier}>
                        {formatShellPilotTranslation(e, 'shellpilotAiLoadEarlier', {
                          count: list.length - visibleList.length
                        })}
                      </Button>
                    </div>
                    )
                  : null
              }
              {
                visibleList.map((item) => {
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
          : (
            <div
              ref={historyRef}
              onScroll={handleScroll}
              className='ai-history-wrap ai-history-empty'
            />
            )
      }
      {
        unreadItemIds.length
          ? (
            <Button
              type='primary'
              size='small'
              className='ai-history-back-to-latest'
              icon={<ArrowDownOutlined />}
              onClick={handleBackToLatest}
              title={e('shellpilotBackToLatest')}
            >
              {e('shellpilotBackToLatest')}
              <span className='ai-history-unread-count'>
                {unreadItemIds.length > 99 ? '99+' : unreadItemIds.length}
              </span>
            </Button>
            )
          : null
      }
    </div>
  )
})
