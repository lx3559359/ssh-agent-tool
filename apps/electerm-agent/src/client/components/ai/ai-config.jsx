import {
  Form,
  Input,
  Button,
  AutoComplete,
  Alert,
  Checkbox,
  Collapse,
  Space,
  Select,
  Tag
} from 'antd'
import {
  DownloadOutlined,
  GlobalOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  UploadOutlined
} from '@ant-design/icons'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { cloneDeep, isEqual } from 'lodash-es'
import Link from '../common/external-link'
import AiCache from './ai-cache'
import { normalizeAIEndpoint } from '../../common/ai-endpoint'
import Password from '../common/password'
import AiHistory, { addHistoryItem } from './ai-history'
import message from '../common/message'
import {
  buildAIProfileFromValues,
  getActiveAIConfig,
  getAIModelOptions,
  getAIProfileOptions,
  getAIStatusFingerprint,
  isAIProfileRequestCurrent,
  migrateAIProfiles,
  removeAIProfile,
  upsertAIProfile,
  upsertAIProfileWithCredentialRevision,
  withAICredentialRevision
} from './ai-profiles'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import { aiHealthCoordinator } from './ai-health-coordinator'
import {
  restoreAIConfigHistoryCredentials,
  sanitizeAIConfigHistory
} from './ai-request-credentials'
import download from '../../common/download'
import {
  createAIProfileExport,
  mergeAIProfileImport
} from './ai-profile-transfer'
import { listAgentSkills } from './agent-skill-client.js'
import { recommendedAIProviders } from './ai-provider-catalog.js'

const AgentSkillManagerModal = lazy(() => import('./agent-skill-manager-modal.jsx'))

const STORAGE_KEY_CONFIG = 'ai_config_history'
const EVENT_NAME_CONFIG = 'ai-config-history-update'

const e = window.translate
const tf = (key, replacements) => formatShellPilotTranslation(e, key, replacements)
const defaultRoleKeys = ['shellpilotAiRoleSshOps', 'shellpilotAiRoleTerminal']

const providerPresets = [
  {
    labelKey: 'shellpilotProviderCustomOpenAi',
    value: 'custom-openai-compatible',
    nameKey: 'shellpilotProviderCustomOpenAiName',
    baseURLAI: 'https://api.example.com',
    apiPathAI: '',
    modelAI: '',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    labelKey: 'shellpilotProviderOpenAiOfficial',
    value: 'openai',
    nameAI: 'OpenAI',
    baseURLAI: 'https://api.openai.com/v1',
    apiPathAI: '',
    modelAI: 'gpt-4.1-mini',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    labelKey: 'shellpilotProviderDeepSeekOfficial',
    value: 'deepseek',
    nameAI: 'DeepSeek',
    baseURLAI: 'https://api.deepseek.com',
    apiPathAI: '',
    modelAI: 'deepseek-chat',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    labelKey: 'shellpilotProviderOpenRouterRelay',
    value: 'openrouter',
    nameAI: 'OpenRouter',
    baseURLAI: 'https://openrouter.ai/api/v1',
    apiPathAI: '',
    modelAI: 'openai/gpt-4o-mini',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    labelKey: 'shellpilotProviderSiliconFlow',
    value: 'siliconflow',
    nameAI: 'SiliconFlow',
    baseURLAI: 'https://api.siliconflow.cn/v1',
    apiPathAI: '',
    modelAI: 'Qwen/Qwen3-32B',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    labelKey: 'shellpilotProviderDashScope',
    value: 'dashscope',
    nameKey: 'shellpilotProviderDashScope',
    baseURLAI: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiPathAI: '',
    modelAI: 'qwen-plus',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    labelKey: 'shellpilotProviderGlm',
    value: 'bigmodel',
    nameKey: 'shellpilotProviderGlm',
    baseURLAI: 'https://open.bigmodel.cn/api/paas/v4',
    apiPathAI: '',
    modelAI: 'glm-4-plus',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    labelKey: 'shellpilotProviderMoonshot',
    value: 'moonshot',
    nameAI: 'Moonshot',
    baseURLAI: 'https://api.moonshot.cn/v1',
    apiPathAI: '',
    modelAI: 'moonshot-v1-8k',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    labelKey: 'shellpilotProviderVolcanoArk',
    value: 'volcengine',
    nameKey: 'shellpilotProviderVolcanoArk',
    baseURLAI: 'https://ark.cn-beijing.volces.com/api/v3',
    apiPathAI: '',
    modelAI: 'doubao-seed-1-6',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    label: 'Groq',
    value: 'groq',
    nameAI: 'Groq',
    baseURLAI: 'https://api.groq.com/openai/v1',
    apiPathAI: '',
    modelAI: 'llama-3.3-70b-versatile',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    label: 'xAI Grok',
    value: 'xai-grok',
    nameAI: 'xAI Grok',
    baseURLAI: 'https://api.x.ai/v1',
    apiPathAI: '',
    modelAI: 'grok-4.5',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    label: 'Together AI',
    value: 'together',
    nameAI: 'Together AI',
    baseURLAI: 'https://api.together.xyz/v1',
    apiPathAI: '',
    modelAI: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    labelKey: 'shellpilotProviderOllamaLocal',
    value: 'ollama',
    nameKey: 'shellpilotProviderOllamaLocal',
    baseURLAI: 'http://127.0.0.1:11434/v1',
    apiPathAI: '',
    modelAI: 'qwen2.5:7b',
    authHeaderNameAI: 'Authorization: Bearer'
  }
]

const popularModels = [
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4o',
  'gpt-4o-mini',
  'deepseek-chat',
  'deepseek-reasoner',
  'Qwen/Qwen3-32B',
  'qwen-plus',
  'glm-4-plus',
  'moonshot-v1-8k',
  'doubao-seed-1-6',
  'llama-3.3-70b-versatile',
  'grok-4.5',
  'grok-4.1-fast-reasoning',
  'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  'openai/gpt-4o-mini',
  'anthropic/claude-3.5-sonnet'
]

const proxyOptions = [
  { value: 'socks5://127.0.0.1:1080' },
  { value: 'http://127.0.0.1:8080' },
  { value: 'https://proxy.example.com:3128' }
]

const authHeaderOptions = [
  { value: 'Authorization: Bearer' },
  { value: 'x-api-key' },
  { value: 'api-key' },
  { value: 'Authorization: Api-Key' },
  { value: 'Authorization' }
]

const mcpServerFields = [
  {
    name: 'name',
    labelKey: 'shellpilotMcpName',
    placeholderKey: 'shellpilotMcpNamePlaceholder',
    required: true
  },
  {
    name: 'command',
    labelKey: 'shellpilotMcpCommand',
    placeholderKey: 'shellpilotMcpCommandPlaceholder'
  },
  {
    name: 'url',
    labelKey: 'shellpilotMcpHttpAddress',
    placeholderKey: 'shellpilotMcpHttpAddressPlaceholder'
  },
  {
    name: 'description',
    labelKey: 'shellpilotMcpPurpose',
    placeholderKey: 'shellpilotMcpPurposePlaceholder'
  }
]

const mcpTransportOptions = [
  { value: 'stdio', label: 'stdio' },
  { value: 'http', label: 'HTTP' }
]

function getCleanAgentSkills (skills = []) {
  return skills
    .filter(skill => skill && (skill.id || skill.title || skill.description || skill.prompt))
    .map(skill => ({
      id: String(skill.id || '').trim(),
      title: String(skill.title || '').trim(),
      description: String(skill.description || '').trim(),
      prompt: String(skill.prompt || '').trim(),
      disabled: Boolean(skill.disabled)
    }))
}

function getCleanMcpServers (servers = []) {
  return servers
    .filter(server => server && (server.name || server.command || server.url || server.description))
    .map(server => ({
      name: String(server.name || '').trim(),
      transport: String(server.transport || 'stdio').trim(),
      command: String(server.command || '').trim(),
      args: String(server.args || '').trim(),
      url: String(server.url || '').trim(),
      description: String(server.description || '').trim(),
      disabled: Boolean(server.disabled)
    }))
}

function uniqueOptions (items = []) {
  return [...new Set(
    items
      .map(item => String(item || '').trim())
      .filter(Boolean)
  )]
    .map(value => ({ value }))
}

function getEndpointPreview (baseURLAI, apiPathAI) {
  try {
    const endpoint = normalizeAIEndpoint(baseURLAI, apiPathAI)
    return `${endpoint.baseURL}${endpoint.path}`
  } catch (e) {
    return ''
  }
}

export default function AIConfigForm ({ initialValues, languageVersion, onSubmit, showAIConfig }) {
  const [form] = Form.useForm()
  const appliedSourceRef = useRef()
  const importInputRef = useRef()
  const profileRequestGenerationRef = useRef(0)
  const [testing, setTesting] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [modelOptions, setModelOptions] = useState([])
  const [profileOptions, setProfileOptions] = useState([])
  const [skillManagerOpen, setSkillManagerOpen] = useState(false)
  const [skillCount, setSkillCount] = useState(0)
  const baseURLAI = Form.useWatch('baseURLAI', form)
  const apiPathAI = Form.useWatch('apiPathAI', form)
  const activeAIProfileId = Form.useWatch('activeAIProfileId', form)

  const endpointPreview = useMemo(
    () => getEndpointPreview(baseURLAI, apiPathAI),
    [baseURLAI, apiPathAI]
  )

  useEffect(() => {
    if (!initialValues || isEqual(appliedSourceRef.current, initialValues)) return
    const normalized = migrateAIProfiles(initialValues)
    const active = getActiveAIConfig(normalized)
    form.setFieldsValue({
      ...normalized,
      ...active
    })
    setProfileOptions(getAIProfileOptions(normalized, e))
    setModelOptions([
      ...getAIModelOptions(normalized),
      ...uniqueOptions(popularModels)
    ])
    appliedSourceRef.current = cloneDeep(initialValues)
  }, [form, initialValues])

  useEffect(() => {
    setProfileOptions(getAIProfileOptions(form.getFieldsValue(true), e))
    const touchedErrors = form.getFieldsError()
      .filter(field => field.errors.length && form.isFieldTouched(field.name))
      .map(field => field.name)
    if (touchedErrors.length) {
      form.validateFields(touchedErrors).catch(() => {})
    }
  }, [form, languageVersion])

  useEffect(() => {
    if (!showAIConfig) return
    listAgentSkills()
      .then(items => setSkillCount(Array.isArray(items) ? items.length : 0))
      .catch(() => {})
  }, [showAIConfig])

  function filter () {
    return true
  }

  function getCurrentFormValues () {
    return form.getFieldsValue(true)
  }

  function syncProfileOptions (config) {
    setProfileOptions(getAIProfileOptions(config, e))
  }

  function saveCurrentProfile () {
    const values = getCurrentFormValues()
    const next = upsertAIProfileWithCredentialRevision(values, buildAIProfileFromValues(values))
    form.setFieldsValue(next)
    syncProfileOptions(next)
    return next
  }

  function saveProfileStatus (aiStatus, aiStatusMessage = '', profileValues = {}) {
    const values = {
      ...getCurrentFormValues(),
      ...profileValues,
      aiStatus,
      aiStatusMessage: String(aiStatusMessage || ''),
      aiStatusAt: Date.now()
    }
    values.aiStatusFingerprint = getAIStatusFingerprint(values)
    const next = upsertAIProfile(values, buildAIProfileFromValues(values))
    form.setFieldsValue(next)
    syncProfileOptions(next)
    window.store.updateConfig(migrateAIProfiles(next))
    return next
  }

  function handleProfileChange (profileId) {
    const saved = saveCurrentProfile()
    const next = {
      ...saved,
      activeAIProfileId: profileId
    }
    const active = getActiveAIConfig(next)
    const merged = {
      ...next,
      ...active
    }
    form.setFieldsValue(merged)
    syncProfileOptions(merged)
    setModelOptions([
      ...getAIModelOptions(merged),
      ...uniqueOptions(popularModels)
    ])
  }

  function handleAddProfile () {
    const saved = saveCurrentProfile()
    const profile = {
      id: `ai-profile-${Date.now()}`,
      nameAI: tf('shellpilotAiConfigNumber', { count: (saved.aiProfiles || []).length + 1 }),
      baseURLAI: '',
      apiPathAI: '',
      modelAI: '',
      modelOptionsAI: [],
      roleAI: saved.roleAI || '',
      apiKeyAI: '',
      authHeaderNameAI: 'Authorization: Bearer',
      languageAI: saved.languageAI || window.store.getLangName(),
      credentialRevisionAI: '',
      agentSkills: saved.agentSkills || [],
      mcpServers: saved.mcpServers || [],
      proxyAI: saved.proxyAI || ''
    }
    const next = upsertAIProfileWithCredentialRevision(saved, profile)
    form.setFieldsValue(next)
    syncProfileOptions(next)
    setModelOptions(uniqueOptions(popularModels))
  }

  function handleRemoveProfile () {
    const values = getCurrentFormValues()
    const next = removeAIProfile(values, values.activeAIProfileId)
    const active = getActiveAIConfig(next)
    const merged = {
      ...next,
      ...active
    }
    form.setFieldsValue(merged)
    syncProfileOptions(merged)
    setModelOptions([
      ...getAIModelOptions(merged),
      ...uniqueOptions(popularModels)
    ])
  }

  async function handleExportProfiles () {
    const saved = saveCurrentProfile()
    const date = new Date().toISOString().slice(0, 10)
    await download(
      `shellpilot-ai-profiles-${date}.json`,
      JSON.stringify(createAIProfileExport(saved), null, 2)
    )
  }

  async function handleImportProfiles (event) {
    const input = event.target
    const file = input.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const merged = mergeAIProfileImport(saveCurrentProfile(), text)
      const active = getActiveAIConfig(merged)
      const next = {
        ...merged,
        ...active
      }
      form.setFieldsValue(next)
      syncProfileOptions(next)
      setModelOptions([
        ...getAIModelOptions(next),
        ...uniqueOptions(popularModels)
      ])
      message.success(e('shellpilotAiProfileImportSucceeded'))
    } catch (error) {
      message.error(tf('shellpilotAiProfileImportFailed', {
        detail: error?.message || e('shellpilotAiProfileImportInvalid')
      }))
    } finally {
      input.value = ''
    }
  }

  function getPersistedProfile (values) {
    const profiles = Array.isArray(values.aiProfiles) ? values.aiProfiles : []
    return profiles.find(item => item.id === values.activeAIProfileId)
  }

  function isProfileRequestCurrent (profile, requestGeneration) {
    return requestGeneration === profileRequestGenerationRef.current &&
      isAIProfileRequestCurrent(profile, getCurrentFormValues())
  }
  const handleSubmit = async (values) => {
    const cleanValues = {
      ...getCurrentFormValues(),
      ...values,
      apiPathAI: values.apiPathAI || '',
      agentSkills: getCleanAgentSkills(values.agentSkills),
      mcpServers: getCleanMcpServers(values.mcpServers)
    }
    const nextValues = upsertAIProfileWithCredentialRevision(
      cleanValues,
      buildAIProfileFromValues(cleanValues)
    )
    onSubmit({
      ...nextValues
    })
    addHistoryItem(
      STORAGE_KEY_CONFIG,
      sanitizeAIConfigHistory(nextValues),
      EVENT_NAME_CONFIG
    )
  }

  const handlePresetChange = (value) => {
    const preset = providerPresets.find(item => item.value === value)
    if (!preset) return
    const nextValues = {
      nameAI: preset.nameKey ? e(preset.nameKey) : preset.nameAI,
      baseURLAI: preset.baseURLAI,
      apiPathAI: preset.apiPathAI,
      modelAI: preset.modelAI,
      modelOptionsAI: [],
      aiStatus: '',
      aiStatusMessage: '',
      aiStatusAt: '',
      aiStatusFingerprint: '',
      authHeaderNameAI: preset.authHeaderNameAI
    }
    form.setFieldsValue(nextValues)
    setModelOptions(uniqueOptions([
      preset.modelAI,
      ...popularModels
    ]))
  }

  const handleTest = async () => {
    let profile
    let requestGeneration
    try {
      await form.validateFields(['baseURLAI', 'apiKeyAI'])
      const values = form.getFieldsValue(true)
      profile = withAICredentialRevision(
        buildAIProfileFromValues(values),
        getPersistedProfile(values)
      )
      form.setFieldValue('credentialRevisionAI', profile.credentialRevisionAI)
      requestGeneration = ++profileRequestGenerationRef.current
      setTesting(true)
      const result = await aiHealthCoordinator.checkNow(profile, { force: true })
      if (!isProfileRequestCurrent(profile, requestGeneration)) return
      saveProfileStatus(result.status, result.message, profile)
      if (result.status === 'available') {
        message.success(e('shellpilotAiConfigAvailable'))
      } else if (result.status === 'reachable') {
        message.warning(result.message || e('shellpilotAiReachableHint'))
      } else {
        message.error(result.message || e('shellpilotAiRecentFailure'))
      }
    } catch (err) {
      if (profile && !isProfileRequestCurrent(profile, requestGeneration)) return
      if (err.message) {
        message.error(`${e('shellpilotRequestFailed')}: ${err.message}`)
      }
    } finally {
      setTesting(false)
    }
  }

  const handleLoadModels = async () => {
    let profile
    let requestGeneration
    try {
      await form.validateFields(['baseURLAI', 'apiKeyAI'])
      const values = form.getFieldsValue(true)
      profile = withAICredentialRevision(
        buildAIProfileFromValues(values),
        getPersistedProfile(values)
      )
      form.setFieldValue('credentialRevisionAI', profile.credentialRevisionAI)
      requestGeneration = ++profileRequestGenerationRef.current
      setLoadingModels(true)
      const res = await window.pre.runGlobalAsync(
        'AIModels',
        profile.baseURLAI,
        profile.apiKeyAI,
        profile.proxyAI,
        profile.authHeaderNameAI
      )
      if (!isProfileRequestCurrent(profile, requestGeneration)) return
      if (res?.error) {
        const content = tf('shellpilotAiLoadModelsFailed', { detail: res.error })
        saveProfileStatus(res.status || 'network-error', res.error, profile)
        return message.error(content)
      }
      const models = res?.models || []
      if (!models.length) {
        aiHealthCoordinator.recordHealthResult(profile, {
          status: 'reachable',
          apiStatus: 'reachable',
          modelStatus: 'unknown',
          models: [],
          message: e('shellpilotAiNoModelsHint'),
          checkedAt: Date.now()
        })
        saveProfileStatus('reachable', e('shellpilotAiNoModelsHint'), profile)
        return message.warning(e('shellpilotAiNoModelsHint'))
      }
      const options = uniqueOptions(models)
      setModelOptions(options)
      const currentModel = form.getFieldValue('modelAI')
      const modelOptionsAI = options.map(item => item.value)
      const modelAI = currentModel || modelOptionsAI[0] || ''
      form.setFieldsValue({
        modelAI,
        modelOptionsAI
      })
      const content = tf('shellpilotAiModelsLoaded', { count: options.length })
      const nextProfile = {
        ...profile,
        modelAI,
        modelOptionsAI
      }
      aiHealthCoordinator.recordHealthResult(nextProfile, {
        status: 'reachable',
        apiStatus: 'reachable',
        modelStatus: 'unknown',
        models: modelOptionsAI,
        message: content,
        checkedAt: Date.now()
      })
      saveProfileStatus('reachable', content, nextProfile)
      message.success(content)
    } catch (err) {
      if (profile && !isProfileRequestCurrent(profile, requestGeneration)) return
      if (err.message) {
        message.error(`${e('shellpilotRequestFailed')}: ${err.message}`)
      }
    } finally {
      setLoadingModels(false)
    }
  }

  function handleSelectHistory (item) {
    if (item && typeof item === 'object') {
      const restored = restoreAIConfigHistoryCredentials(
        item,
        getCurrentFormValues()
      )
      form.setFieldsValue(restored)
      setModelOptions([
        ...getAIModelOptions(restored),
        ...uniqueOptions(popularModels)
      ])
    }
  }

  function renderHistoryItem (item) {
    if (!item || typeof item !== 'object') {
      return { label: e('shellpilotAiUnknownConfig'), title: e('shellpilotAiUnknownConfig') }
    }
    const name = item.nameAI || ''
    const model = item.modelAI || e('shellpilotAiDefaultModel')
    const rolePrefix = item.roleAI ? item.roleAI.substring(0, 15) + '...' : ''
    const label = name || `[${model}] ${rolePrefix}`
    const title = name
      ? `${name}\n${e('shellpilotAiModelLabel')}: ${item.modelAI}\n${e('shellpilotAiAddressLabel')}: ${item.baseURLAI}`
      : `${e('shellpilotAiModelLabel')}: ${item.modelAI}\n${e('shellpilotAiRoleLabel')}: ${item.roleAI}\n${e('shellpilotAiAddressLabel')}: ${item.baseURLAI}`
    return { label, title }
  }

  function renderApiUrlLabel () {
    if (baseURLAI === 'https://api.atlascloud.ai/v1') {
      return <span>{e('shellpilotApiAddress')} (<Link to='https://atlascloud.ai'>AtlasCloud</Link>)</span>
    }
    return e('shellpilotApiAddress')
  }

  function renderRecommendedProviders () {
    return (
      <section className='sp-ai-provider-guide' aria-label={e('shellpilotAiRecommendedProviders')}>
        <div className='sp-ai-provider-guide-head'>
          <div>
            <div className='sp-ai-provider-guide-title'>{e('shellpilotAiRecommendedProviders')}</div>
            <div className='sp-ai-provider-guide-description'>
              {e('shellpilotAiRecommendedProvidersDescription')}
            </div>
          </div>
        </div>
        <div className='sp-ai-provider-list'>
          {recommendedAIProviders.map(provider => (
            <div className='sp-ai-provider-item' key={provider.preset}>
              <div className='sp-ai-provider-item-main'>
                <div className='sp-ai-provider-name-row'>
                  <strong>{provider.name}</strong>
                  <Tag>{provider.region}</Tag>
                </div>
                <div className='sp-ai-provider-description'>{provider.description}</div>
                <div className='sp-ai-provider-tags'>{provider.tags.join(' · ')}</div>
              </div>
              <Space size='small' className='sp-ai-provider-actions'>
                <Button size='small' onClick={() => handlePresetChange(provider.preset)}>
                  {e('shellpilotAiUseProviderTemplate')}
                </Button>
                <Link to={provider.website}>
                  <Button size='small' type='text' icon={<GlobalOutlined />}>
                    {e('shellpilotAiOpenProviderWebsite')}
                  </Button>
                </Link>
              </Space>
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (!showAIConfig) {
    return null
  }
  const defaultLangs = window.store.getLangNames().map(l => ({ value: l }))
  return (
    <>
      <Form
        form={form}
        onFinish={handleSubmit}
        initialValues={initialValues}
        layout='vertical'
        className='ai-config-form sp-card sp-configuration-section sp-ai-config-form'
      >
        <div className='sp-ai-config-primary-fields'>
          <Form.Item
            label={renderApiUrlLabel()}
            name='baseURLAI'
            required
            extra={e('shellpilotAiApiAddressHelp')}
            rules={[
              { required: true, message: e('shellpilotAiApiAddressRequired') },
              { type: 'url', message: e('shellpilotValidUrlRequired') }
            ]}
          >
            <Input placeholder={e('shellpilotAiApiAddressPlaceholder')} />
          </Form.Item>

          <Form.Item
            label={e('shellpilotAiApiKey')}
            name='apiKeyAI'
            extra={e('shellpilotAiApiKeyExtra')}
            rules={[{ required: true, message: e('shellpilotAiApiKeyRequired') }]}
          >
            <Password placeholder={e('shellpilotAiApiKeyPlaceholder')} />
          </Form.Item>

          <Form.Item
            label={e('modelAi')}
            extra={e('shellpilotAiModelExtra')}
          >
            <Space.Compact className='width-100'>
              <Form.Item name='modelAI' noStyle>
                <AutoComplete
                  options={modelOptions}
                  filterOption={filter}
                  style={{ width: '72%' }}
                >
                  <Input placeholder={e('shellpilotAiModelPlaceholder')} />
                </AutoComplete>
              </Form.Item>
              <Button
                loading={loadingModels}
                onClick={handleLoadModels}
                style={{ width: '28%' }}
              >
                {e('shellpilotAiLoadModels')}
              </Button>
            </Space.Compact>
          </Form.Item>

          <Form.Item>
            <Button type='primary' htmlType='submit'>
              {e('save')}
            </Button>
          </Form.Item>
        </div>

        {renderRecommendedProviders()}

        <Collapse
          ghost
          className='sp-ai-config-advanced'
          activeKey={advancedOpen ? ['advanced'] : []}
          onChange={keys => setAdvancedOpen(Array.isArray(keys) ? keys.includes('advanced') : keys === 'advanced')}
          items={[{
            key: 'advanced',
            label: e('shellpilotAiAdvancedOptions'),
            extra: <span className='sp-ai-config-advanced-description'>{e('shellpilotAiAdvancedOptionsDescription')}</span>,
            children: (
              <div className='sp-ai-config-advanced-fields'>
                <Alert
                  title={e('shellpilotAiQuickSetup')}
                  description={e('shellpilotAiQuickSetupDescription')}
                  type='info'
                  className='mg2y'
                />
                {
                  endpointPreview && (
                    <p className='sp-ai-endpoint-preview'>
                      {e('shellpilotAiActualRequestAddress')}: {endpointPreview}
                    </p>
                  )
                }
                <Form.Item
                  label={e('shellpilotAiApiConfiguration')}
                  extra={e('shellpilotAiApiConfigurationExtra')}
                >
                  <Space.Compact className='width-100'>
                    <Select
                      value={activeAIProfileId}
                      options={profileOptions}
                      onChange={handleProfileChange}
                      style={{ width: '58%' }}
                      placeholder={e('shellpilotAiApiConfigurationPlaceholder')}
                    />
                    <Button
                      onClick={handleAddProfile}
                      style={{ width: '21%' }}
                    >
                      {e('shellpilotAddConfiguration')}
                    </Button>
                    <Button
                      danger
                      onClick={handleRemoveProfile}
                      disabled={profileOptions.length <= 1}
                      style={{ width: '21%' }}
                    >
                      {e('shellpilotDeleteConfiguration')}
                    </Button>
                  </Space.Compact>
                </Form.Item>

                <Form.Item
                  label={e('shellpilotAiProfileTransfer')}
                  extra={e('shellpilotAiProfileTransferExtra')}
                >
                  <Space wrap>
                    <Button
                      icon={<UploadOutlined />}
                      onClick={() => importInputRef.current?.click()}
                    >
                      {e('shellpilotAiProfileImport')}
                    </Button>
                    <Button
                      icon={<DownloadOutlined />}
                      onClick={handleExportProfiles}
                    >
                      {e('shellpilotAiProfileExportWithoutKeys')}
                    </Button>
                    <input
                      ref={importInputRef}
                      type='file'
                      accept='.json,application/json'
                      hidden
                      onChange={handleImportProfiles}
                    />
                  </Space>
                </Form.Item>

                <Form.Item
                  label={e('shellpilotAiProviderTemplate')}
                  extra={e('shellpilotAiProviderTemplateExtra')}
                >
                  <Select
                    showSearch
                    allowClear
                    placeholder={e('shellpilotAiProviderTemplatePlaceholder')}
                    options={providerPresets.map(item => ({
                      value: item.value,
                      label: item.labelKey ? e(item.labelKey) : item.label
                    }))}
                    onChange={handlePresetChange}
                    optionFilterProp='label'
                  />
                </Form.Item>

                <Form.Item
                  label={e('shellpilotAiConfigurationName')}
                  name='nameAI'
                  extra={e('shellpilotAiConfigurationNameExtra')}
                >
                  <Input
                    placeholder={e('shellpilotAiConfigurationNamePlaceholder')}
                  />
                </Form.Item>
                <Form.Item
                  label={e('shellpilotAiApiPath')}
                  name='apiPathAI'
                  extra={e('shellpilotAiApiPathHelp')}
                >
                  <Input placeholder={e('shellpilotAiApiPathPlaceholder')} />
                </Form.Item>

                <Form.Item
                  label={e('shellpilotAiAuthHeader')}
                  name='authHeaderNameAI'
                  extra={e('shellpilotAiAuthHeaderExtra')}
                  tooltip={e('shellpilotAiAuthHeaderTooltip')}
                >
                  <AutoComplete
                    options={authHeaderOptions}
                    filterOption={filter}
                  >
                    <Input placeholder={e('shellpilotAiAuthHeaderPlaceholder')} />
                  </AutoComplete>
                </Form.Item>

                <Form.Item
                  label={e('roleAI')}
                  name='roleAI'
                  extra={e('shellpilotAiRoleExtra')}
                >
                  <AutoComplete options={defaultRoleKeys.map(key => ({ value: e(key) }))} placement='topLeft'>
                    <Input.TextArea
                      placeholder={e('shellpilotAiRolePlaceholder')}
                      rows={1}
                    />
                  </AutoComplete>
                </Form.Item>

                <Form.Item
                  label={e('language')}
                  name='languageAI'
                  extra={e('shellpilotAiLanguageExtra')}
                >
                  <AutoComplete options={defaultLangs} placement='topLeft'>
                    <Input
                      placeholder={e('language')}
                    />
                  </AutoComplete>
                </Form.Item>

                <Form.Item
                  label={e('shellpilotAiAgentSkill')}
                  extra={e('shellpilotAiAgentSkillExtra')}
                >
                  <Button onClick={() => setSkillManagerOpen(true)}>
                    {tf('shellpilotSkillManageCount', { count: skillCount })}
                  </Button>
                </Form.Item>

                <Form.Item
                  label={e('shellpilotAiMcpServer')}
                  extra={e('shellpilotAiMcpServerExtra')}
                >
                  <Form.List name='mcpServers'>
                    {(fields, { add, remove }) => (
                      <Space direction='vertical' className='width-100'>
                        {
                  fields.map(({ key, name }) => (
                    <div className='pd1 border' key={key}>
                      <Space align='start' className='width-100'>
                        <Form.Item
                          name={[name, 'transport']}
                          label={e('shellpilotAiConnectionMethod')}
                          className='width-100'
                        >
                          <Select options={mcpTransportOptions} />
                        </Form.Item>
                        <Form.Item
                          name={[name, 'disabled']}
                          label={e('shellpilotStatus')}
                          valuePropName='checked'
                        >
                          <Checkbox>{e('shellpilotDisabled')}</Checkbox>
                        </Form.Item>
                        <Button
                          danger
                          icon={<MinusCircleOutlined />}
                          onClick={() => remove(name)}
                        >
                          {e('shellpilotDelete')}
                        </Button>
                      </Space>
                      <Space align='start' className='width-100'>
                        {
                          mcpServerFields.map(item => (
                            <Form.Item
                              key={item.name}
                              name={[name, item.name]}
                              label={e(item.labelKey)}
                              rules={item.required
                                ? [{ required: true, message: tf('shellpilotFieldRequired', { field: e(item.labelKey) }) }]
                                : []}
                              className='flex1'
                            >
                              <Input placeholder={e(item.placeholderKey)} />
                            </Form.Item>
                          ))
                        }
                      </Space>
                      <Form.Item
                        name={[name, 'args']}
                        label={e('shellpilotAiStartArguments')}
                      >
                        <Input placeholder={e('shellpilotAiStartArgumentsPlaceholder')} />
                      </Form.Item>
                    </div>
                  ))
                }
                        <Button
                          icon={<PlusOutlined />}
                          onClick={() => add({
                            name: '',
                            transport: 'stdio',
                            command: '',
                            args: '',
                            url: '',
                            description: '',
                            disabled: false
                          })}
                        >
                          {e('shellpilotAiAddMcpServer')}
                        </Button>
                      </Space>
                    )}
                  </Form.List>
                </Form.Item>

                <Form.Item
                  label={e('proxy')}
                  name='proxyAI'
                  extra={e('shellpilotAiProxyExtra')}
                  tooltip={e('shellpilotAiProxyTooltip')}
                >
                  <AutoComplete
                    options={proxyOptions}
                    filterOption={filter}
                    allowClear
                  >
                    <Input placeholder={e('shellpilotAiProxyPlaceholder')} />
                  </AutoComplete>
                </Form.Item>

                <Form.Item>
                  <Button
                    loading={testing}
                    onClick={handleTest}
                  >
                    {e('testConnection')}
                  </Button>
                </Form.Item>
              </div>
            )
          }]}
        />
      </Form>
      {
        skillManagerOpen
          ? (
            <Suspense fallback={null}>
              <AgentSkillManagerModal
                open
                onClose={() => setSkillManagerOpen(false)}
                onCatalogChange={items => setSkillCount(items.length)}
              />
            </Suspense>
            )
          : null
      }
      {
        advancedOpen
          ? (
            <>
              <AiHistory
                storageKey={STORAGE_KEY_CONFIG}
                eventName={EVENT_NAME_CONFIG}
                sanitizeHistory={sanitizeAIConfigHistory}
                onSelect={handleSelectHistory}
                renderItem={renderHistoryItem}
              />
              <AiCache />
            </>
            )
          : null
      }
    </>
  )
}
