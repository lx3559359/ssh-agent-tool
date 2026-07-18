import { memo, useEffect, useState } from 'react'
import { ReloadOutlined } from '@ant-design/icons'
import { Flex, Select, Tag } from 'antd'
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

const e = window.translate

export default memo(function RightSidePanelAIHeader ({
  config = {},
  rightPanelVisible,
  title,
  variant = 'selects'
}) {
  const safeConfig = config || {}
  const activeAIConfig = getActiveAIConfig(safeConfig) || {}
  const aiHealthKey = getAIHealthRequestKey(activeAIConfig)
  const [aiHealthState, setAIHealthState] = useState(
    () => aiHealthCoordinator.getSnapshot(activeAIConfig)
  )

  useEffect(() => {
    if (variant !== 'status' || !rightPanelVisible) return undefined
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
  }, [aiHealthKey, rightPanelVisible, variant])

  function handleActiveAIProfileChange (profileId) {
    window.store.updateConfig(migrateAIProfiles({
      ...safeConfig,
      activeAIProfileId: profileId
    }))
  }

  function handleActiveAIModelChange (modelAI) {
    window.store.updateConfig(upsertAIProfile(safeConfig, {
      ...activeAIConfig,
      modelAI,
      aiStatus: 'stale',
      aiStatusMessage: e('shellpilotAiConfigChanged'),
      aiStatusAt: '',
      aiStatusFingerprint: ''
    }))
  }

  function handleManualAIHealthCheck () {
    aiHealthCoordinator.checkNow(activeAIConfig, { force: true }).catch(() => {})
  }

  function handleAIHealthKeyDown (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleManualAIHealthCheck()
    }
  }

  if (variant === 'status') {
    const aiModelStatus = getAIModelStatus(activeAIConfig, e, aiHealthState)
    const aiConfigured = Boolean(activeAIConfig.baseURLAI && activeAIConfig.apiKeyAI)
    return (
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
        {
          Number.isFinite(aiModelStatus.latencyMs)
            ? <span className='right-panel-model-latency'>{aiModelStatus.latencyMs}ms</span>
            : null
        }
      </Tag>
    )
  }

  const aiProfileOptions = getAIProfileOptions(safeConfig, e)
  const aiModelOptions = getAIModelOptions(activeAIConfig)
  if (!aiProfileOptions.length) {
    return (
      <div className='right-panel-subtitle'>
        {activeAIConfig.nameAI || title || e('shellpilotAiApiConfiguration')}
      </div>
    )
  }

  return (
    <Flex className='right-panel-ai-selects right-panel-ai-config-card' gap={6} align='center'>
      <Select
        size='small'
        className='right-panel-ai-profile-select'
        value={activeAIConfig.activeAIProfileId}
        options={aiProfileOptions}
        onChange={handleActiveAIProfileChange}
        popupMatchSelectWidth={false}
        title={e('shellpilotAiApiConfiguration')}
      />
      {
        aiModelOptions.length
          ? (
            <Select
              size='small'
              className='right-panel-ai-model-select'
              value={activeAIConfig.modelAI}
              options={aiModelOptions}
              onChange={handleActiveAIModelChange}
              popupMatchSelectWidth={false}
              title={e('shellpilotAiModelLabel')}
            />
            )
          : null
      }
    </Flex>
  )
})
