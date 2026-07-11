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
import {
  aiConfigWikiLink
} from '../../common/constants'
import { normalizeAIEndpoint } from '../../common/ai-endpoint'
import Password from '../common/password'
import AiHistory, { addHistoryItem } from './ai-history'
import message from '../common/message'

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
  return [...new Set(items.filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
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
  const baseURLAI = Form.useWatch('baseURLAI', form)
  const apiPathAI = Form.useWatch('apiPathAI', form)

  const endpointPreview = useMemo(
    () => getEndpointPreview(baseURLAI, apiPathAI),
    [baseURLAI, apiPathAI]
  )

  useEffect(() => {
    if (initialValues) {
      form.setFieldsValue(initialValues)
      setModelOptions(uniqueOptions([
        initialValues.modelAI,
        ...popularModels
      ]))
    }
  }, [initialValues])

  function filter () {
    return true
  }

  const handleSubmit = async (values) => {
    const nextValues = {
      ...values,
      apiPathAI: values.apiPathAI || '',
      agentSkills: getCleanAgentSkills(values.agentSkills),
      mcpServers: getCleanMcpServers(values.mcpServers)
    }
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
        message.error(res.error)
      } else if (res && res.response) {
        message.success('模型 API 配置可用')
      } else {
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
        return message.error(`拉取模型失败：${res.error}`)
      }
      const models = res?.models || []
      if (!models.length) {
        return message.warning('未获取到模型列表，请确认该接口兼容 /models 或 Ollama /api/tags。')
      }
      const options = uniqueOptions(models)
      setModelOptions(options)
      const currentModel = form.getFieldValue('modelAI')
      if (!currentModel && options[0]) {
        form.setFieldsValue({ modelAI: options[0].value })
      }
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
      setModelOptions(uniqueOptions([
        item.modelAI,
        ...popularModels
      ]))
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
        title={
          <Link to={aiConfigWikiLink}>模型 API 配置说明：{aiConfigWikiLink}</Link>
        }
        type='info'
        className='mg2y'
      />
      {
        endpointPreview && (
          <p>
            实际请求地址：{endpointPreview}
          </p>
        )
      }
      <Form
        form={form}
        onFinish={handleSubmit}
        initialValues={initialValues}
        layout='vertical'
        className='ai-config-form'
      >
        <Form.Item label='服务商模板'>
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
        >
          <Input
            placeholder='例如：DeepSeek 中转、Ollama 本地（可选）'
          />
        </Form.Item>
        <Form.Item label={renderApiUrlLabel()} required>
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
          rules={[{ required: true, message: '请输入 API 密钥' }]}
        >
          <Password placeholder='输入你的 API 密钥' />
        </Form.Item>

        <Form.Item
          label='认证 Header'
          name='authHeaderNameAI'
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
        >
          <AutoComplete options={defaultLangs} placement='topLeft'>
            <Input
              placeholder={e('language')}
            />
          </AutoComplete>
        </Form.Item>

        <Form.Item label='Agent Skill'>
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

        <Form.Item label='MCP Server'>
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
