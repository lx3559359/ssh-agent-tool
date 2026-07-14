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
import { useEffect, useMemo, useState } from 'react'
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

const STORAGE_KEY_CONFIG = 'ai_config_history'
const EVENT_NAME_CONFIG = 'ai-config-history-update'

const e = window.translate
const defaultRoles = [
  {
    value: 'SSH 运维专家，优先排查服务器、网络、日志、进程、端口、磁盘、内存、Nginx、Docker 和部署问题。回答使用中文和 Markdown。'
  },
  {
    value: '终端专家，提供不同系统下的命令，简要解释用法，默认使用中文回答。'
  }
]

const providerPresets = [
  {
    label: '自定义中转站（OpenAI 兼容）',
    value: 'custom-openai-compatible',
    nameAI: '自定义中转站',
    baseURLAI: 'https://api.example.com',
    apiPathAI: '',
    modelAI: '',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    label: 'OpenAI 官方',
    value: 'openai',
    nameAI: 'OpenAI',
    baseURLAI: 'https://api.openai.com/v1',
    apiPathAI: '',
    modelAI: 'gpt-4.1-mini',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    label: 'DeepSeek 官方',
    value: 'deepseek',
    nameAI: 'DeepSeek',
    baseURLAI: 'https://api.deepseek.com',
    apiPathAI: '',
    modelAI: 'deepseek-chat',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    label: 'OpenRouter 中转',
    value: 'openrouter',
    nameAI: 'OpenRouter',
    baseURLAI: 'https://openrouter.ai/api/v1',
    apiPathAI: '',
    modelAI: 'openai/gpt-4o-mini',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    label: '硅基流动 SiliconFlow',
    value: 'siliconflow',
    nameAI: 'SiliconFlow',
    baseURLAI: 'https://api.siliconflow.cn/v1',
    apiPathAI: '',
    modelAI: 'Qwen/Qwen3-32B',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    label: '阿里云百炼 DashScope',
    value: 'dashscope',
    nameAI: '阿里云百炼',
    baseURLAI: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiPathAI: '',
    modelAI: 'qwen-plus',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    label: '智谱 GLM',
    value: 'bigmodel',
    nameAI: '智谱 GLM',
    baseURLAI: 'https://open.bigmodel.cn/api/paas/v4',
    apiPathAI: '',
    modelAI: 'glm-4-plus',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    label: 'Moonshot 月之暗面',
    value: 'moonshot',
    nameAI: 'Moonshot',
    baseURLAI: 'https://api.moonshot.cn/v1',
    apiPathAI: '',
    modelAI: 'moonshot-v1-8k',
    authHeaderNameAI: 'Authorization: Bearer'
  },
  {
    label: '火山方舟',
    value: 'volcengine',
    nameAI: '火山方舟',
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
    label: 'Ollama 本地',
    value: 'ollama',
    nameAI: 'Ollama 本地',
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
    label: 'Skill ID',
    placeholder: '例如：redis-troubleshooting',
    required: true
  },
  {
    name: 'title',
    label: '技能名称',
    placeholder: '例如：Redis 排查',
    required: true
  },
  {
    name: 'description',
    label: '适用场景',
    placeholder: '例如：连接异常、慢查询、内存占用'
  }
]

const mcpServerFields = [
  {
    name: 'name',
    label: '名称',
    placeholder: '例如：Prometheus、CMDB、知识库',
    required: true
  },
  {
    name: 'command',
    label: '启动命令',
    placeholder: 'stdio 模式，例如：prometheus-mcp'
  },
  {
    name: 'url',
    label: 'HTTP 地址',
    placeholder: 'HTTP 模式，例如：https://cmdb.example.com/mcp'
  },
  {
    name: 'description',
    label: '用途',
    placeholder: '例如：查询监控指标、服务器资产、内部文档'
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

export default function AIConfigForm ({ initialValues, onSubmit, showAIConfig }) {
  const [form] = Form.useForm()
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
    if (initialValues) {
      const normalized = migrateAIProfiles(initialValues)
      const active = getActiveAIConfig(normalized)
      form.setFieldsValue({
        ...normalized,
        ...active
      })
      setProfileOptions(getAIProfileOptions(normalized))
      setModelOptions([
        ...getAIModelOptions(normalized),
        ...uniqueOptions(popularModels)
      ])
    }
  }, [initialValues])

  function filter () {
    return true
  }

  function getCurrentFormValues () {
    return form.getFieldsValue(true)
  }

  function syncProfileOptions (config) {
    setProfileOptions(getAIProfileOptions(config))
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
      nameAI: `AI 配置 ${(saved.aiProfiles || []).length + 1}`,
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
      nameAI: preset.nameAI,
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
        '你好',
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
        message.error(res.error)
      } else if (res && res.response) {
        saveProfileStatus('available', '测试连接成功')
        message.success('模型 API 配置可用')
      } else {
        saveProfileStatus('error', '模型 API 返回异常')
        message.error('模型 API 返回异常')
      }
    } catch (err) {
      if (err.message) {
        message.error(err.message)
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
        saveProfileStatus('error', `拉取模型失败：${res.error}`)
        return message.error(`拉取模型失败：${res.error}`)
      }
      const models = res?.models || []
      if (!models.length) {
        saveProfileStatus('error', '未获取到模型列表')
        return message.warning('未获取到模型列表，请确认该接口兼容 /models 或 Ollama /api/tags。')
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
      saveProfileStatus('available', `已获取 ${options.length} 个模型`)
      message.success(`已获取 ${options.length} 个模型`)
    } catch (err) {
      if (err.message) {
        message.error(err.message)
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
      return { label: '未知配置', title: '未知配置' }
    }
    const name = item.nameAI || ''
    const model = item.modelAI || '默认模型'
    const rolePrefix = item.roleAI ? item.roleAI.substring(0, 15) + '...' : ''
    const label = name || `[${model}] ${rolePrefix}`
    const title = name
      ? `${name}\n模型：${item.modelAI}\n地址：${item.baseURLAI}`
      : `模型：${item.modelAI}\n角色：${item.roleAI}\n地址：${item.baseURLAI}`
    return { label, title }
  }

  function renderApiUrlLabel () {
    if (baseURLAI === 'https://api.atlascloud.ai/v1') {
      return <span>API 地址 (<Link to='https://atlascloud.ai'>AtlasCloud</Link>)</span>
    }
    return 'API 地址'
  }

  if (!showAIConfig) {
    return null
  }
  const defaultLangs = window.store.getLangNames().map(l => ({ value: l }))
  return (
    <>
      <Alert
        title='模型 API 快速配置'
        description='只需先填写 API 地址和 API 密钥，再点击“拉取模型”和“保存”即可使用。保存后可在右侧 AI 助手顶部切换 API 配置和模型；其他项目均为可选高级设置。完整说明请查看顶部“帮助”。'
        type='info'
        className='mg2y'
      />
      {
        endpointPreview && (
          <p className='sp-ai-endpoint-preview'>
            实际请求地址：{endpointPreview}
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
          label='API 配置'
          extra='管理多组 API / 中转站配置，右侧 AI 助手可在不同配置之间切换。'
        >
          <Space.Compact className='width-100'>
            <Select
              value={activeAIProfileId}
              options={profileOptions}
              onChange={handleProfileChange}
              style={{ width: '58%' }}
              placeholder='选择已保存的 API 配置'
            />
            <Button
              onClick={handleAddProfile}
              style={{ width: '21%' }}
            >
              新增配置
            </Button>
            <Button
              danger
              onClick={handleRemoveProfile}
              disabled={profileOptions.length <= 1}
              style={{ width: '21%' }}
            >
              删除配置
            </Button>
          </Space.Compact>
        </Form.Item>

        <Form.Item
          label='服务商模板'
          extra='快速填入常见官方模型或中转站地址；不在列表中也可以不选模板，直接自定义 API 地址和密钥。'
        >
          <Select
            showSearch
            allowClear
            placeholder='选择官方模型或中转站模板，也可以不选直接自定义'
            options={providerPresets.map(item => ({
              value: item.value,
              label: item.label
            }))}
            onChange={handlePresetChange}
            optionFilterProp='label'
          />
        </Form.Item>

        <Form.Item
          label='配置名称'
          name='nameAI'
          extra='给当前 API 起一个便于识别的名字，例如“公司中转站”“本地 Ollama”。右侧 AI 助手左侧下拉只显示这个名称。'
        >
          <Input
            placeholder='例如：DeepSeek 中转、Ollama 本地（可选）'
          />
        </Form.Item>
        <Form.Item
          label={renderApiUrlLabel()}
          required
          extra={
            <div className='ai-config-inline-help'>
              <div>
                <b>API 地址：</b>必填，可填写基础地址、带 /v1 的地址，或完整 chat/completions 地址。
              </div>
              <div>
                <b>API 路径：</b>可选，留空时自动识别；特殊网关才需要手动指定路径。
              </div>
            </div>
          }
        >
          <Space.Compact className='width-100'>
            <Form.Item
              label='API 地址'
              name='baseURLAI'
              noStyle
              rules={[
                { required: true, message: '请输入或选择 API 服务地址' },
                { type: 'url', message: '请输入有效的 URL' }
              ]}
            >
              <Input
                placeholder='例如：https://api.aigh.store、https://api.openai.com/v1，或完整 chat/completions 地址'
                style={{ width: '72%' }}
              />
            </Form.Item>
            <Form.Item
              label='API 路径'
              name='apiPathAI'
              noStyle
            >
              <Input
                placeholder='可选，留空自动识别'
                style={{ width: '28%' }}
              />
            </Form.Item>
          </Space.Compact>
        </Form.Item>
        <Form.Item
          label={e('modelAi')}
          extra='可选但建议填写。点击“拉取模型”会读取当前 API 可用模型并保存列表，之后可在右侧 AI 助手顶部右侧下拉自由切换模型。'
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
                <Input placeholder='输入模型名，或点击右侧拉取模型' />
              </AutoComplete>
            </Form.Item>
            <Button
              loading={loadingModels}
              onClick={handleLoadModels}
              style={{ width: '28%' }}
            >
              拉取模型
            </Button>
          </Space.Compact>
        </Form.Item>

        <Form.Item
          label='API 密钥'
          name='apiKeyAI'
          extra='必填，用于请求模型接口；不同服务商和中转站的 Key 需要分别配置，仅保存在本机配置中。'
          rules={[{ required: true, message: '请输入 API 密钥' }]}
        >
          <Password placeholder='输入你的 API 密钥' />
        </Form.Item>

        <Form.Item
          label='认证 Header'
          name='authHeaderNameAI'
          extra='可选。大多数 OpenAI 兼容接口保持 Authorization: Bearer 即可；少数服务商可能要求 x-api-key、api-key 或自定义 Header。'
          tooltip='API 认证 Header 格式。例如：Authorization: Bearer 会发送 Authorization: Bearer <key>；x-api-key 会发送 x-api-key: <key>'
        >
          <AutoComplete
            options={authHeaderOptions}
            filterOption={filter}
          >
            <Input placeholder='例如：Authorization: Bearer' />
          </AutoComplete>
        </Form.Item>

        <Form.Item
          label={e('roleAI')}
          name='roleAI'
          extra='可选。用于定义 AI 助手的身份和回答方式，例如 SSH 运维专家、数据库排查专家；会影响对话和命令建议的风格。'
        >
          <AutoComplete options={defaultRoles} placement='topLeft'>
            <Input.TextArea
              placeholder='输入 AI 角色或系统提示词'
              rows={1}
            />
          </AutoComplete>
        </Form.Item>

        <Form.Item
          label={e('language')}
          name='languageAI'
          extra='可选。指定 AI 默认回答语言；留空或使用客户端默认语言时，通常按当前界面语言回复。'
        >
          <AutoComplete options={defaultLangs} placement='topLeft'>
            <Input
              placeholder={e('language')}
            />
          </AutoComplete>
        </Form.Item>

        <Form.Item
          label='Agent Skill'
          extra='可选。给 Agent 增加自定义排查技能，例如 Nginx 502、Redis 慢查询、Docker 异常；技能会作为排查提示词参与 AI 分析。'
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
                              label={item.label}
                              rules={item.required
                                ? [{ required: true, message: `请输入${item.label}` }]
                                : []}
                              className='flex1'
                            >
                              <Input placeholder={item.placeholder} />
                            </Form.Item>
                          ))
                        }
                        <Form.Item
                          name={[name, 'disabled']}
                          label='状态'
                          valuePropName='checked'
                        >
                          <Checkbox>禁用</Checkbox>
                        </Form.Item>
                        <Button
                          danger
                          icon={<MinusCircleOutlined />}
                          onClick={() => remove(name)}
                        >
                          删除
                        </Button>
                      </Space>
                      <Form.Item
                        name={[name, 'prompt']}
                        label='排查方法'
                        rules={[{ required: true, message: '请输入排查方法' }]}
                      >
                        <Input.TextArea
                          rows={3}
                          placeholder='描述 Agent 使用这个 Skill 时应该关注的日志、命令、上下文和排查顺序'
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
                  新增 Skill
                </Button>
              </Space>
            )}
          </Form.List>
        </Form.Item>

        <Form.Item
          label='MCP Server'
          extra='可选。登记可供 Agent 参考或后续接入的外部 MCP 工具，例如 CMDB、Prometheus、知识库；当前会作为上下文和能力说明传给 AI。'
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
                          label='连接方式'
                          className='width-100'
                        >
                          <Select options={mcpTransportOptions} />
                        </Form.Item>
                        <Form.Item
                          name={[name, 'disabled']}
                          label='状态'
                          valuePropName='checked'
                        >
                          <Checkbox>禁用</Checkbox>
                        </Form.Item>
                        <Button
                          danger
                          icon={<MinusCircleOutlined />}
                          onClick={() => remove(name)}
                        >
                          删除
                        </Button>
                      </Space>
                      <Space align='start' className='width-100'>
                        {
                          mcpServerFields.map(item => (
                            <Form.Item
                              key={item.name}
                              name={[name, item.name]}
                              label={item.label}
                              rules={item.required
                                ? [{ required: true, message: `请输入${item.label}` }]
                                : []}
                              className='flex1'
                            >
                              <Input placeholder={item.placeholder} />
                            </Form.Item>
                          ))
                        }
                      </Space>
                      <Form.Item
                        name={[name, 'args']}
                        label='启动参数'
                      >
                        <Input placeholder='stdio 模式可选，例如：--url http://127.0.0.1:9090' />
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
                  新增 MCP Server
                </Button>
              </Space>
            )}
          </Form.List>
        </Form.Item>

        <Form.Item
          label={e('proxy')}
          name='proxyAI'
          extra='可选，仅影响模型 API 网络请求，不影响 SSH/SFTP 连接。当模型 API 在当前网络无法直连时填写代理地址，例如 socks5://127.0.0.1:1080。'
          tooltip='模型 API 请求使用的代理，例如 socks5://127.0.0.1:1080'
        >
          <AutoComplete
            options={proxyOptions}
            filterOption={filter}
            allowClear
          >
            <Input placeholder='输入代理地址（可选）' />
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
