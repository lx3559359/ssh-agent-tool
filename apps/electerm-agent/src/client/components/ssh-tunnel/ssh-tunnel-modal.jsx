import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip
} from 'antd'
import {
  CheckCircleOutlined,
  CopyOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  StopOutlined
} from '@ant-design/icons'
import message from '../common/message'
import { copy } from '../../common/clipboard'
import {
  getTunnelFlowText,
  getTunnelRisk,
  getTunnelTemplate,
  normalizeTunnel,
  tunnelTemplates,
  validateTunnel
} from './ssh-tunnel-definition.js'
import {
  loadSshTunnelRuntime,
  startSshTunnelRuntime,
  stopSshTunnelRuntime,
  testSshTunnelRuntime
} from './ssh-tunnel-api.js'
import './ssh-tunnel-modal.styl'

const typeOptions = [
  {
    value: 'forwardLocalToRemote',
    label: '本地转发',
    description: '从本机端口访问 SSH 服务器能够访问的服务'
  },
  {
    value: 'forwardRemoteToLocal',
    label: '远程转发',
    description: '让 SSH 服务器通过远程端口访问本机服务'
  },
  {
    value: 'dynamicForward',
    label: 'SOCKS5 动态代理',
    description: '在本机建立经过 SSH 服务器转发的 SOCKS5 代理'
  }
]

const templateOptions = Object.entries(tunnelTemplates).map(([value, item]) => ({
  value,
  label: item.name
}))

function createDefaultTunnel () {
  return {
    ...getTunnelTemplate('http'),
    id: '',
    name: 'HTTP'
  }
}

function readableError (error) {
  return String(error?.message || 'SSH 隧道操作失败')
}

function tunnelName (entry = {}) {
  return entry.definition?.name ||
    typeOptions.find(item => item.value === entry.definition?.sshTunnel)?.label ||
    'SSH 隧道'
}

function TunnelTypeCards ({ value, onChange }) {
  return (
    <div className='ssh-tunnel-type-grid'>
      {
        typeOptions.map(item => (
          <button
            type='button'
            key={item.value}
            className={'ssh-tunnel-type-card' + (value === item.value ? ' active' : '')}
            onClick={() => onChange(item.value)}
          >
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </button>
        ))
      }
    </div>
  )
}

function TunnelField ({
  label,
  hint,
  children
}) {
  return (
    <label className='ssh-tunnel-field'>
      <span className='ssh-tunnel-field-label'>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  )
}

export default function SshTunnelModal ({
  open,
  onClose,
  store,
  tab,
  onSave
}) {
  const [draft, setDraft] = useState(createDefaultTunnel)
  const [runtime, setRuntime] = useState({
    session: { connected: false },
    tunnels: []
  })
  const [loading, setLoading] = useState(false)
  const [actionId, setActionId] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('http')
  const connected = runtime.session.connected

  const refresh = useCallback(async (silent = false) => {
    if (!open) return
    if (!silent) setLoading(true)
    try {
      setRuntime(await loadSshTunnelRuntime(store, tab))
    } catch (error) {
      message.error(readableError(error))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [open, store, tab])

  useEffect(() => {
    refresh()
  }, [refresh])

  const normalizedPreview = useMemo(() => {
    try {
      return normalizeTunnel(draft)
    } catch {
      return draft
    }
  }, [draft])

  function updateDraft (key, value) {
    setDraft(current => ({
      ...current,
      [key]: value,
      id: ''
    }))
  }

  function selectType (sshTunnel) {
    const currentPort = Number(draft.sshTunnelLocalPort || 0)
    setDraft(current => ({
      ...current,
      id: '',
      sshTunnel,
      name: typeOptions.find(item => item.value === sshTunnel)?.label || '',
      sshTunnelLocalHost: current.sshTunnelLocalHost || '127.0.0.1',
      sshTunnelLocalPort: currentPort || (sshTunnel === 'dynamicForward' ? 1080 : 8080),
      sshTunnelRemoteHost: current.sshTunnelRemoteHost || '127.0.0.1',
      sshTunnelRemotePort: Number(current.sshTunnelRemotePort || 80)
    }))
    setSelectedTemplate('')
  }

  function applyTemplate (templateName) {
    const next = getTunnelTemplate(templateName)
    setSelectedTemplate(templateName)
    setDraft({
      ...next,
      id: '',
      name: tunnelTemplates[templateName].name
    })
  }

  async function confirmExposure (tunnel) {
    const risk = getTunnelRisk(tunnel)
    if (!risk.requiresConfirmation) return true
    return new Promise(resolve => {
      Modal.confirm({
        title: '确认开放监听地址',
        content: (
          <div>
            <p>{risk.message}</p>
            <p>请确认防火墙、访问来源和服务认证均已正确配置。</p>
          </div>
        ),
        okText: '确认启动',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
  }

  async function handleStart () {
    let tunnel
    try {
      tunnel = validateTunnel(draft)
    } catch (error) {
      message.warning(readableError(error))
      return
    }
    if (!connected) {
      message.info('请先连接 SSH 服务器，再启动隧道')
      return
    }
    if (!await confirmExposure(tunnel)) return
    setActionId('start')
    try {
      await startSshTunnelRuntime(store, tab, tunnel)
      message.success('SSH 隧道已启动')
      await refresh(true)
    } catch (error) {
      message.error(readableError(error))
    } finally {
      setActionId('')
    }
  }

  async function handleStop (id) {
    setActionId(id)
    try {
      await stopSshTunnelRuntime(store, tab, id)
      message.success('SSH 隧道已停止')
      await refresh(true)
    } catch (error) {
      message.error(readableError(error))
    } finally {
      setActionId('')
    }
  }

  async function handleTest (id) {
    setActionId(id)
    try {
      const result = await testSshTunnelRuntime(store, tab, id)
      if (result?.ok) {
        message.success(`连通正常${Number.isFinite(result.latencyMs) ? `，延迟 ${result.latencyMs} ms` : ''}`)
      } else {
        message.warning(result?.message || '当前隧道暂不可用')
      }
      await refresh(true)
    } catch (error) {
      message.error(readableError(error))
    } finally {
      setActionId('')
    }
  }

  function handleEdit (entry) {
    setDraft({
      ...entry.definition,
      id: ''
    })
  }

  async function handleEditAndRestart (entry) {
    await handleStop(entry.id)
    handleEdit(entry)
    message.info('原隧道已停止，请确认参数后重新启动')
  }

  function handleSave () {
    try {
      const tunnel = validateTunnel(draft)
      onSave?.(tunnel)
      message.success('当前配置已准备保存')
    } catch (error) {
      message.warning(readableError(error))
    }
  }

  const isDynamic = draft.sshTunnel === 'dynamicForward'
  const isRemote = draft.sshTunnel === 'forwardRemoteToLocal'
  const primaryText = connected ? '启动隧道' : '连接 SSH 后启动'

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={980}
      destroyOnClose={false}
      title={(
        <span className='ssh-tunnel-modal-title'>
          <LinkOutlined />
          SSH 隧道
        </span>
      )}
      className='ssh-tunnel-modal'
    >
      <Spin spinning={loading}>
        <div className='ssh-tunnel-scroll'>
          <section className='ssh-tunnel-context'>
            <div>
              <strong>{connected ? '当前 SSH 会话' : '当前未连接 SSH'}</strong>
              <span>
                {
                  connected
                    ? `${runtime.session.username}@${runtime.session.host}:${runtime.session.port}`
                    : '可以先配置参数，连接服务器后再启动'
                }
              </span>
            </div>
            <Button icon={<ReloadOutlined />} onClick={() => refresh()}>
              刷新状态
            </Button>
          </section>

          <div className='ssh-tunnel-layout'>
            <section className='ssh-tunnel-editor'>
              <div className='ssh-tunnel-section-title'>
                <div>
                  <strong>新建隧道</strong>
                  <span>选择类型和模板后，只需确认端口与目标地址</span>
                </div>
              </div>

              <TunnelTypeCards
                value={draft.sshTunnel}
                onChange={selectType}
              />

              <div className='ssh-tunnel-template-row'>
                <span>常用模板</span>
                <Select
                  value={selectedTemplate || undefined}
                  placeholder='选择模板'
                  options={templateOptions}
                  onChange={applyTemplate}
                />
              </div>

              <div className='ssh-tunnel-form-grid'>
                <TunnelField label='配置名称' hint='用于在运行列表中识别此隧道'>
                  <Input
                    value={draft.name}
                    maxLength={80}
                    placeholder='例如：本地 MySQL'
                    onChange={event => updateDraft('name', event.target.value)}
                  />
                </TunnelField>
                <TunnelField
                  label={isRemote ? '本机目标地址' : '本机监听地址'}
                  hint={isRemote ? 'SSH 服务器最终访问的本机地址' : '建议保持 127.0.0.1，避免对局域网开放'}
                >
                  <Input
                    value={draft.sshTunnelLocalHost}
                    onChange={event => updateDraft('sshTunnelLocalHost', event.target.value)}
                  />
                </TunnelField>
                <TunnelField
                  label={isRemote ? '本机目标端口' : '本机监听端口'}
                  hint='端口范围 1-65535'
                >
                  <InputNumber
                    min={1}
                    max={65535}
                    value={draft.sshTunnelLocalPort}
                    onChange={value => updateDraft('sshTunnelLocalPort', value)}
                  />
                </TunnelField>
                {
                  !isDynamic
                    ? (
                      <>
                        <TunnelField
                          label={isRemote ? '远程监听地址' : '远程目标地址'}
                          hint={isRemote ? '建议保持 127.0.0.1，避免对公网开放' : '目标服务相对于 SSH 服务器的地址'}
                        >
                          <Input
                            value={draft.sshTunnelRemoteHost}
                            onChange={event => updateDraft('sshTunnelRemoteHost', event.target.value)}
                          />
                        </TunnelField>
                        <TunnelField
                          label={isRemote ? '远程监听端口' : '远程目标端口'}
                          hint='端口范围 1-65535'
                        >
                          <InputNumber
                            min={1}
                            max={65535}
                            value={draft.sshTunnelRemotePort}
                            onChange={value => updateDraft('sshTunnelRemotePort', value)}
                          />
                        </TunnelField>
                      </>
                      )
                    : null
                }
                <TunnelField label='自动启动' hint='保存到服务器书签后，连接成功时自动启动'>
                  <Switch
                    checked={draft.autoStart !== false}
                    checkedChildren='开启'
                    unCheckedChildren='关闭'
                    onChange={value => updateDraft('autoStart', value)}
                  />
                </TunnelField>
              </div>

              <div className='ssh-tunnel-flow'>
                <span>流量路径</span>
                <strong>{getTunnelFlowText(normalizedPreview)}</strong>
              </div>

              <div className='ssh-tunnel-editor-actions'>
                <Button icon={<SaveOutlined />} onClick={handleSave}>
                  保存配置
                </Button>
                <Button
                  type='primary'
                  icon={<PlayCircleOutlined />}
                  disabled={!connected}
                  loading={actionId === 'start'}
                  onClick={handleStart}
                >
                  {primaryText}
                </Button>
              </div>
            </section>

            <section className='ssh-tunnel-runtime'>
              <div className='ssh-tunnel-section-title'>
                <div>
                  <strong>运行中的隧道</strong>
                  <span>无需重新连接 SSH，可随时测试或停止</span>
                </div>
                <Tag color={connected ? 'success' : 'default'}>
                  {connected ? `${runtime.tunnels.length} 个运行中` : '未连接'}
                </Tag>
              </div>

              {
                !connected
                  ? (
                    <Alert
                      showIcon
                      type='info'
                      message='连接 SSH 后可启动和管理隧道'
                      description='当前填写的参数不会丢失。'
                    />
                    )
                  : null
              }

              {
                connected && runtime.tunnels.length === 0
                  ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无运行中的 SSH 隧道' />
                  : null
              }

              <div className='ssh-tunnel-running-list'>
                {
                  runtime.tunnels.map(entry => (
                    <article className='ssh-tunnel-running-card' key={entry.id}>
                      <header>
                        <div>
                          <strong>{tunnelName(entry)}</strong>
                          <Tag color='success'>运行中</Tag>
                        </div>
                        <Tooltip title='复制流量路径'>
                          <Button
                            type='text'
                            size='small'
                            aria-label='复制说明'
                            icon={<CopyOutlined />}
                            onClick={() => copy(getTunnelFlowText(entry.definition))}
                          />
                        </Tooltip>
                      </header>
                      <p>{getTunnelFlowText(entry.definition)}</p>
                      {
                        entry.lastTest
                          ? (
                            <div className={'ssh-tunnel-test-result ' + (entry.lastTest.ok ? 'ok' : 'failed')}>
                              <CheckCircleOutlined />
                              {entry.lastTest.ok
                                ? `最近测试正常${Number.isFinite(entry.lastTest.latencyMs) ? ` · ${entry.lastTest.latencyMs} ms` : ''}`
                                : entry.lastTest.message || '最近测试失败'}
                            </div>
                            )
                          : null
                      }
                      <Space wrap>
                        <Button
                          size='small'
                          loading={actionId === entry.id}
                          onClick={() => handleTest(entry.id)}
                        >
                          测试
                        </Button>
                        <Button size='small' onClick={() => handleEdit(entry)}>
                          编辑
                        </Button>
                        <Button size='small' onClick={() => handleEditAndRestart(entry)}>
                          编辑并重启
                        </Button>
                        <Button
                          size='small'
                          danger
                          icon={<StopOutlined />}
                          loading={actionId === entry.id}
                          onClick={() => handleStop(entry.id)}
                        >
                          停止
                        </Button>
                      </Space>
                    </article>
                  ))
                }
              </div>
            </section>
          </div>
        </div>
      </Spin>
    </Modal>
  )
}
