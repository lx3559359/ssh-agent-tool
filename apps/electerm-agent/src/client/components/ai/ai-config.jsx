import {
  Form,
  Input,
  Button,
  AutoComplete,
  Alert,
  Checkbox,
  Space,
  Select
} from 'antd'
import {
  MinusCircleOutlined,
  PlusOutlined
} from '@ant-design/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  migrateAIProfiles,
  removeAIProfile,
  upsertAIProfile
} from './ai-profiles'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'

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

const skillFields = [
  {
    name: 'id',
    labelKey: 'shellpilotSkillId',
    placeholderKey: 'shellpilotSkillIdPlaceholder',
    required: true
  },
  {
    name: 'title',
    labelKey: 'shellpilotSkillName',
    placeholderKey: 'shellpilotSkillNamePlaceholder',
    required: true
  },
  {
    name: 'description',
    labelKey: 'shellpilotSkillScenario',
    placeholderKey: 'shellpilotSkillScenarioPlaceholder'
  }
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
  const [testing, setTesting] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelOptions, setModelOptions] = useState([])
  const [profileOptions, setProfileOptions] = useState([])
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
    const next = upsertAIProfile(values, buildAIProfileFromValues(values))
    form.setFieldsValue(next)
    syncProfileOptions(next)
    return next
  }

  function saveProfileStatus (aiStatus, aiStatusMessage = '') {
    const values = {
      ...getCurrentFormValues(),
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
      agentSkills: saved.agentSkills || [],
      mcpServers: saved.mcpServers || [],
      proxyAI: saved.proxyAI || ''
    }
    const next = upsertAIProfile(saved, profile)
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

  const handleSubmit = async (values) => {
    const cleanValues = {
      ...getCurrentFormValues(),
      ...values,
      apiPathAI: values.apiPathAI || '',
      agentSkills: getCleanAgentSkills(values.agentSkills),
      mcpServers: getCleanMcpServers(values.mcpServers)
    }
    const nextValues = upsertAIProfile(
      cleanValues,
      buildAIProfileFromValues(cleanValues)
    )
    onSubmit({
      ...nextValues
    })
    addHistoryItem(STORAGE_KEY_CONFIG, nextValues, EVENT_NAME_CONFIG)
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
    try {
      await form.validateFields(['baseURLAI', 'apiKeyAI'])
      const values = form.getFieldsValue()
      setTesting(true)
      const res = await window.pre.runGlobalAsync(
        'AIchat',
        e('shellpilotAiTestPrompt'),
        values.modelAI,
        values.roleAI,
        values.baseURLAI,
        values.apiPathAI || '',
        values.apiKeyAI,
        values.proxyAI,
        false,
        values.authHeaderNameAI
      )
      if (res && res.error) {
        saveProfileStatus('error', res.error)
        message.error(`${e('shellpilotRequestFailed')}: ${res.error}`)
      } else if (res && res.response) {
        saveProfileStatus('available')
        message.success(e('shellpilotAiConfigAvailable'))
      } else {
        saveProfileStatus('error')
        message.error(e('shellpilotAiUnexpectedResponse'))
      }
    } catch (err) {
      if (err.message) {
        message.error(`${e('shellpilotRequestFailed')}: ${err.message}`)
      }
    } finally {
      setTesting(false)
    }
  }

  const handleLoadModels = async () => {
    try {
      const values = await form.validateFields(['baseURLAI'])
      const allValues = form.getFieldsValue()
      setLoadingModels(true)
      const res = await window.pre.runGlobalAsync(
        'AIModels',
        values.baseURLAI,
        allValues.apiKeyAI,
        allValues.proxyAI,
        allValues.authHeaderNameAI
      )
      if (res?.error) {
        const content = tf('shellpilotAiLoadModelsFailed', { detail: res.error })
        saveProfileStatus('error', res.error)
        return message.error(content)
      }
      const models = res?.models || []
      if (!models.length) {
        saveProfileStatus('error')
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
      saveProfileStatus('available')
      message.success(content)
    } catch (err) {
      if (err.message) {
        message.error(`${e('shellpilotRequestFailed')}: ${err.message}`)
      }
    } finally {
      setLoadingModels(false)
    }
  }

  function handleSelectHistory (item) {
    if (item && typeof item === 'object') {
      form.setFieldsValue(item)
      setModelOptions([
        ...getAIModelOptions(item),
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

  if (!showAIConfig) {
    return null
  }
  const defaultLangs = window.store.getLangNames().map(l => ({ value: l }))
  return (
    <>
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
      <Form
        form={form}
        onFinish={handleSubmit}
        initialValues={initialValues}
        layout='vertical'
        className='ai-config-form sp-card sp-configuration-section sp-ai-config-form'
      >
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
          label={renderApiUrlLabel()}
          required
          extra={
            <div className='ai-config-inline-help'>
              <div>
                <b>{e('shellpilotApiAddress')}:</b> {e('shellpilotAiApiAddressHelp')}
              </div>
              <div>
                <b>{e('shellpilotAiApiPath')}:</b> {e('shellpilotAiApiPathHelp')}
              </div>
            </div>
          }
        >
          <Space.Compact className='width-100'>
            <Form.Item
              label={e('shellpilotApiAddress')}
              name='baseURLAI'
              noStyle
              rules={[
                { required: true, message: e('shellpilotAiApiAddressRequired') },
                { type: 'url', message: e('shellpilotValidUrlRequired') }
              ]}
            >
              <Input
                placeholder={e('shellpilotAiApiAddressPlaceholder')}
                style={{ width: '72%' }}
              />
            </Form.Item>
            <Form.Item
              label={e('shellpilotAiApiPath')}
              name='apiPathAI'
              noStyle
            >
              <Input
                placeholder={e('shellpilotAiApiPathPlaceholder')}
                style={{ width: '28%' }}
              />
            </Form.Item>
          </Space.Compact>
        </Form.Item>
        <Form.Item
          label={e('modelAi')}
          extra={e('shellpilotAiModelExtra')}
        >
          <Space.Compact className='width-100'>
            <Form.Item
              name='modelAI'
              noStyle
            >
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

        <Form.Item
          label={e('shellpilotAiApiKey')}
          name='apiKeyAI'
          extra={e('shellpilotAiApiKeyExtra')}
          rules={[{ required: true, message: e('shellpilotAiApiKeyRequired') }]}
        >
          <Password placeholder={e('shellpilotAiApiKeyPlaceholder')} />
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
          <Form.List name='agentSkills'>
            {(fields, { add, remove }) => (
              <Space direction='vertical' className='width-100'>
                {
                  fields.map(({ key, name }) => (
                    <div className='pd1 border' key={key}>
                      <Space align='start' className='width-100'>
                        {
                          skillFields.map(item => (
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
                      <Form.Item
                        name={[name, 'prompt']}
                        label={e('shellpilotAiTroubleshootingMethod')}
                        rules={[{ required: true, message: e('shellpilotAiTroubleshootingMethodRequired') }]}
                      >
                        <Input.TextArea
                          rows={3}
                          placeholder={e('shellpilotAiTroubleshootingMethodPlaceholder')}
                        />
                      </Form.Item>
                    </div>
                  ))
                }
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => add({
                    id: '',
                    title: '',
                    description: '',
                    prompt: '',
                    disabled: false
                  })}
                >
                  {e('shellpilotAiAddSkill')}
                </Button>
              </Space>
            )}
          </Form.List>
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
          <Space>
            <Button type='primary' htmlType='submit'>
              {e('save')}
            </Button>
            <Button
              loading={testing}
              onClick={handleTest}
            >
              {e('testConnection')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
      <AiHistory
        storageKey={STORAGE_KEY_CONFIG}
        eventName={EVENT_NAME_CONFIG}
        onSelect={handleSelectHistory}
        renderItem={renderHistoryItem}
      />
      <AiCache />
    </>
  )
}
