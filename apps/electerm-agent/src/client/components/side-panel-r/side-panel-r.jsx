import React, { memo, useEffect, useRef, useState } from 'react'
import DragHandle from '../common/drag-handle'
import './right-side-panel.styl'
import {
  CloseCircleOutlined,
  PushpinOutlined,
  InfoCircleOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import {
  Typography,
  Flex,
  Tag,
  Select
} from 'antd'
import {
  minRightPanelWidth,
  getMaxRightPanelWidth,
  normalizeRightPanelWidth
} from '../main/aigshell-layout'
import {
  getActiveAIConfig,
  getAIModelOptions,
  getAIModelStatus,
  getAIProfileOptions,
  migrateAIProfiles,
  upsertAIProfile
} from '../ai/ai-profiles'
import {
  aiHealthCoordinator,
  getAIHealthRequestKey
} from '../ai/ai-health-coordinator'
import AgentTakeoverControls from '../ai/agent-takeover-controls'

const e = window.translate

export default memo(function RightSidePanel (
  {
    rightPanelVisible,
    rightPanelPinned,
    rightPanelWidth,
    children,
    title,
    rightPanelTab,
    activeTabId,
    config = {}
  }
) {
  const panelRef = useRef(null)
  const safeConfig = config || {}
  const isAI = rightPanelTab === 'ai'
  const activeAIConfig = isAI ? getActiveAIConfig(safeConfig) || {} : safeConfig
  const aiHealthKey = isAI ? getAIHealthRequestKey(activeAIConfig) : ''
  const [aiHealthState, setAIHealthState] = useState(
    () => aiHealthCoordinator.getSnapshot(activeAIConfig)
  )

  useEffect(() => {
    if (!isAI || !rightPanelVisible) return undefined
    let mounted = true
    const updateState = () => {
      if (mounted) {
        setAIHealthState(aiHealthCoordinator.getSnapshot(activeAIConfig))
      }
    }
    const unsubscribe = aiHealthCoordinator.subscribe(updateState)
    const cancelCheck = aiHealthCoordinator.schedule(activeAIConfig)
    updateState()
    return () => {
      mounted = false
      unsubscribe()
      cancelCheck()
    }
  }, [aiHealthKey, isAI, rightPanelVisible])

  if (!rightPanelVisible) {
    return null
  }

  const aiProfileOptions = isAI ? getAIProfileOptions(safeConfig, e) : []
  const aiModelOptions = isAI ? getAIModelOptions(activeAIConfig) : []
  const aiModelStatus = isAI
    ? getAIModelStatus(activeAIConfig, e, aiHealthState)
    : null
  const aiConfigured = Boolean(activeAIConfig.baseURLAI && activeAIConfig.apiKeyAI)
  const tag = isAI
    ? <Tag className='mg1r aigshell-ai-tag'>AI</Tag>
    : <InfoCircleOutlined className='mg1r' />
  const maxWidth = getMaxRightPanelWidth(window.innerWidth)
  const width = Math.min(normalizeRightPanelWidth(rightPanelWidth), maxWidth)

  function onDragEnd (nw) {
    window.store.setRightSidePanelWidth(nw)
  }

  function onDragMove (nw) {
    if (panelRef.current) {
      panelRef.current.style.width = nw + 'px'
    }
  }

  function onClose () {
    window.store.rightPanelVisible = false
  }

  function togglePin () {
    window.store.rightPanelPinned = !window.store.rightPanelPinned
  }

  function handleActiveAIProfileChange (profileId) {
    const next = migrateAIProfiles({
      ...safeConfig,
      activeAIProfileId: profileId
    })
    window.store.updateConfig(next)
  }

  function handleActiveAIModelChange (modelAI) {
    const next = upsertAIProfile(safeConfig, {
      ...activeAIConfig,
      modelAI,
      aiStatus: 'stale',
      aiStatusMessage: e('shellpilotAiConfigChanged'),
      aiStatusAt: '',
      aiStatusFingerprint: ''
    })
    window.store.updateConfig(next)
  }

  function handleManualAIHealthCheck () {
    if (!isAI) return
    aiHealthCoordinator.checkNow(activeAIConfig, { force: true }).catch(() => {})
  }

  function handleAIHealthKeyDown (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleManualAIHealthCheck()
    }
  }

  function renderAIProfileSelect () {
    if (!isAI || !aiProfileOptions.length) {
      return (
        <div className='right-panel-subtitle'>
          {activeAIConfig.nameAI || title || 'AI 配置'}
        </div>
      )
    }

    return (
      <Select
        size='small'
        className='right-panel-ai-profile-select'
        value={activeAIConfig.activeAIProfileId}
        options={aiProfileOptions}
        onChange={handleActiveAIProfileChange}
        popupMatchSelectWidth={false}
        title='选择 AI API 配置'
      />
    )
  }

  function renderAIModelSelect () {
    if (!isAI || !aiModelOptions.length) {
      return null
    }

    return (
      <Select
        size='small'
        className='right-panel-ai-model-select'
        value={activeAIConfig.modelAI}
        options={aiModelOptions}
        onChange={handleActiveAIModelChange}
        popupMatchSelectWidth={false}
        title='选择当前 API 的模型'
      />
    )
  }

  const panelProps = {
    className: 'right-side-panel animate-fast' + (rightPanelPinned ? ' right-side-panel-pinned' : ''),
    ref: panelRef,
    style: {
      width: `${width}px`
    }
  }

  const pinProps = {
    className: 'right-side-panel-pin right-side-panel-controls' + (rightPanelPinned ? ' pinned' : ''),
    onClick: togglePin
  }
  const dragProps = {
    min: minRightPanelWidth,
    max: maxWidth,
    width,
    onDragEnd,
    onDragMove,
    left: false
  }

  return (
    <div
      {...panelProps}
    >
      <DragHandle {...dragProps} />
      <Flex className='right-panel-title pd2' justify='space-between' align='flex-start'>
        <div className='right-panel-title-main'>
          <Typography.Text className='right-panel-title-text' ellipsis>
            {tag} {isAI ? '助手' : title}
          </Typography.Text>
          {
            isAI
              ? (
                <Flex className='right-panel-ai-selects right-panel-ai-config-card' gap={6} align='center'>
                  {renderAIProfileSelect()}
                  {renderAIModelSelect()}
                </Flex>
                )
              : null
          }
          {
            isAI
              ? <AgentTakeoverControls activeTabId={activeTabId} />
              : null
          }
        </div>
        <Flex className='right-panel-title-controls' align='center'>
          {
            isAI
              ? (
                <Tag
                  className={`right-panel-model-status ${aiModelStatus.className}${aiConfigured ? ' configured' : ''}`}
                  title={aiModelStatus.title}
                  role='button'
                  tabIndex={0}
                  aria-label={e('shellpilotAiManualRecheck')}
                  onClick={handleManualAIHealthCheck}
                  onKeyDown={handleAIHealthKeyDown}
                >
                  <ReloadOutlined
                    className='right-panel-model-status-refresh'
                    spin={aiModelStatus.status === 'checking'}
                  />
                  <span>{aiModelStatus.label}</span>
                </Tag>
                )
              : null
          }
          <PushpinOutlined
            {...pinProps}
          />
          <CloseCircleOutlined
            className='right-side-panel-close right-side-panel-controls mg1l'
            onClick={onClose}
          />
        </Flex>
      </Flex>
      <div className={'right-side-panel-content' + (isAI ? ' right-side-panel-content-ai' : '')}>
        {children}
      </div>
    </div>
  )
})
