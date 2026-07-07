import {
  Form,
  Input,
  Button,
  AutoComplete,
  Alert,
  Space
} from 'antd'
import { useEffect, useState } from 'react'
import Link from '../common/external-link'
import AiCache from './ai-cache'
import {
  aiConfigWikiLink
} from '../../common/constants'
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

export default function AIConfigForm ({ initialValues, onSubmit, showAIConfig }) {
  const [form] = Form.useForm()
  const [testing, setTesting] = useState(false)
  const baseURLAI = Form.useWatch('baseURLAI', form)

  useEffect(() => {
    if (initialValues) {
      form.setFieldsValue(initialValues)
    }
  }, [initialValues])

  function filter () {
    return true
  }

  const handleSubmit = async (values) => {
    onSubmit(values)
    addHistoryItem(STORAGE_KEY_CONFIG, values, EVENT_NAME_CONFIG)
  }

  const handleTest = async () => {
    try {
      const values = await form.validateFields()
      setTesting(true)
      const res = await window.pre.runGlobalAsync(
        'AIchat',
        '你好',
        values.modelAI,
        values.roleAI,
        values.baseURLAI,
        values.apiPathAI,
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
    } catch (e) {
      if (e.message) {
        message.error(e.message)
      }
    } finally {
      setTesting(false)
    }
  }

  function handleSelectHistory (item) {
    if (item && typeof item === 'object') {
      form.setFieldsValue(item)
    }
  }

  function renderHistoryItem (item) {
    if (!item || typeof item !== 'object') return { label: '未知配置', title: '未知配置' }
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
      <p>
        完整地址：{initialValues?.baseURLAI}{initialValues?.apiPathAI}
      </p>
      <Form
        form={form}
        onFinish={handleSubmit}
        initialValues={initialValues}
        layout='vertical'
        className='ai-config-form'
      >
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
                placeholder='输入 API 服务地址'
                style={{ width: '75%' }}
              />
            </Form.Item>
            <Form.Item
              label='API 路径'
              name='apiPathAI'
              rules={[
                { required: true, message: '请输入 API 路径' }
              ]}
              noStyle
            >
              <Input
                placeholder='/chat/completions'
                style={{ width: '25%' }}
              />
            </Form.Item>
          </Space.Compact>
        </Form.Item>
        <Form.Item
          label={e('modelAi')}
          name='modelAI'
          rules={[{ required: true, message: '请输入或选择模型' }]}
        >
          <Input
            placeholder='输入或选择模型'
          />
        </Form.Item>

        <Form.Item
          label='API 密钥'
          name='apiKeyAI'
        >
          <Password placeholder='输入你的 API 密钥' />
        </Form.Item>

        <Form.Item
          label='认证 Header'
          name='authHeaderNameAI'
          tooltip='API 认证 Header 格式。例如：Authorization: Bearer 会发送 Authorization: Bearer <key>，x-api-key 会发送 x-api-key: <key>'
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
          rules={[{ required: true, message: '请输入 AI 角色或系统提示词' }]}
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
          rules={[{ required: true, message: '请输入回答语言' }]}
        >
          <AutoComplete options={defaultLangs} placement='topLeft'>
            <Input
              placeholder={e('language')}
            />
          </AutoComplete>
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
