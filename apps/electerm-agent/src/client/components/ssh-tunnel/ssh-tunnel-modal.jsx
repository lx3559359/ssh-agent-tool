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
  DeleteOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined
} from '@ant-design/icons'
import message from '../common/message'
import {
  getTunnelFlowText,
  getTunnelRisk,
  getTunnelTemplate,
  normalizeTunnel,
  serializeTunnelForBookmark,
  tunnelTemplates,
  validateTunnel
} from './ssh-tunnel-definition.js'
import {
  findBookmarkForTab,
  getBookmarkTunnels,
  removeBookmarkTunnel,
  upsertBookmarkTunnel
} from './ssh-tunnel-bookmark.js'
import {
  loadSshTunnelRuntime,
  startSshTunnelRuntime,
  stopSshTunnelRuntime,
  testSshTunnelRuntime
} from './ssh-tunnel-api.js'
import SshTunnelRuntimeCard from './ssh-tunnel-runtime-card.jsx'
import SshTunnelGuideModal from './ssh-tunnel-guide-modal.jsx'
import './ssh-tunnel-modal.styl'

const e = window.translate

const typeOptions = [
  {
    value: 'forwardLocalToRemote',
    label: e('shellpilotTunnelTypeLocal'),
    description: e('shellpilotTunnelTypeLocalHint')
  },
  {
    value: 'forwardRemoteToLocal',
    label: e('shellpilotTunnelTypeRemote'),
    description: e('shellpilotTunnelTypeRemoteHint')
  },
  {
    value: 'dynamicForward',
    label: e('shellpilotTunnelTypeDynamic'),
    description: e('shellpilotTunnelTypeDynamicHint')
  }
]

const templateOptions = Object.entries(tunnelTemplates).map(([value, item]) => ({
  value,
  label: item.name
}))

const tunnelHealthPresentation = {
  running: { color: 'success', label: 'shellpilotTunnelRunningStatus' },
  starting: { color: 'processing', label: 'shellpilotTunnelHealthStarting' },
  healthy: { color: 'success', label: 'shellpilotTunnelHealthHealthy' },
  reconnecting: { color: 'warning', label: 'shellpilotTunnelHealthReconnecting' },
  'port-conflict': { color: 'error', label: 'shellpilotTunnelHealthPortConflict' },
  'session-lost': { color: 'error', label: 'shellpilotTunnelHealthSessionLost' },
  stopped: { color: 'default', label: 'shellpilotTunnelHealthStopped' },
  failed: { color: 'error', label: 'shellpilotTunnelHealthFailed' }
}

function createDefaultTunnel () {
  return {
    ...getTunnelTemplate('http'),
    id: '',
    name: 'HTTP'
  }
}

function readableError (error) {
  return String(error?.message || e('shellpilotTunnelOperationFailed'))
}

function tunnelName (entry = {}) {
  return entry.definition?.name ||
    typeOptions.find(item => item.value === entry.definition?.sshTunnel)?.label ||
    e('shellpilotTopbarSshTunnel')
}

function translated (key, values = {}) {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    e(key)
  )
}

function healthPresentation (state) {
  return tunnelHealthPresentation[state] || tunnelHealthPresentation.failed
}

function guideSectionForDraft (definition = {}) {
  if (definition.sshTunnel === 'dynamicForward') return 'socks-browser'
  if (definition.sshTunnel === 'forwardRemoteToLocal') return 'remote-safety'
  if (definition.sshTunnel === 'forwardLocalToRemote') return 'how-to-access'
  return 'choose-type'
}

function runtimeEntryForCard (entry = {}) {
  return {
    ...entry,
    definition: {
      ...entry.definition,
      name: `${tunnelName(entry)} · ${e(healthPresentation(entry.state).label)}`
    }
  }
}

function showDisconnectHistory (entry) {
  const events = Array.isArray(entry.events) ? entry.events : []
  Modal.info({
    title: e('shellpilotTunnelDisconnectHistory'),
    width: 680,
    okText: e('confirm'),
    content: events.length
      ? (
        <div className='ssh-tunnel-history-list'>
          {
            events.slice().reverse().map((event, index) => {
              const health = healthPresentation(event.state)
              return (
                <div className='ssh-tunnel-history-item' key={`${event.at}-${index}`}>
                  <div>
                    <Tag color={health.color}>{e(health.label)}</Tag>
                    <span>{new Date(event.at).toLocaleString()}</span>
                  </div>
                  <strong>{event.message}</strong>
                  <code>{event.code}</code>
                </div>
              )
            })
          }
        </div>
        )
      : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={e('shellpilotTunnelNoDisconnectHistory')} />
  })
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
  tab
}) {
  const [draft, setDraft] = useState(createDefaultTunnel)
  const [savedTunnels, setSavedTunnels] = useState([])
  const [savedEditingId, setSavedEditingId] = useState('')
  const [runtime, setRuntime] = useState({
    session: { connected: false },
    tunnels: []
  })
  const [loading, setLoading] = useState(false)
  const [actionId, setActionId] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('http')
  const [portConflict, setPortConflict] = useState(null)
  const [guideState, setGuideState] = useState({
    open: false,
    section: 'choose-type',
    context: {}
  })
  const connected = runtime.session.connected
  const currentBookmark = findBookmarkForTab(store?.bookmarks || [], tab)

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

  useEffect(() => {
    if (!open || !connected) return
    const timer = window.setInterval(() => refresh(true), 3000)
    return () => window.clearInterval(timer)
  }, [connected, open, refresh])

  useEffect(() => {
    setSavedTunnels(getBookmarkTunnels(currentBookmark || {}))
    setSavedEditingId('')
  }, [open, tab?.srcId])

  const normalizedPreview = useMemo(() => {
    try {
      return normalizeTunnel(draft)
    } catch {
      return draft
    }
  }, [draft])

  function updateDraft (key, value) {
    setPortConflict(null)
    setDraft(current => ({
      ...current,
      [key]: value,
      id: ''
    }))
  }

  function openGuide (section = 'choose-type', context = {}) {
    const safeContext = context && typeof context === 'object' ? context : {}
    const definition = safeContext.definition && typeof safeContext.definition === 'object'
      ? safeContext.definition
      : {}
    setGuideState(current => ({
      ...current,
      open: true,
      section: typeof section === 'string' ? section : 'choose-type',
      context: {
        definition,
        tunnelType: safeContext.tunnelType || definition.sshTunnel || '',
        errorCode: safeContext.errorCode || '',
        helpSection: safeContext.helpSection || ''
      }
    }))
  }

  function selectType (sshTunnel) {
    setPortConflict(null)
    const currentPort = Number(draft.sshTunnelLocalPort || 0)
    setDraft(current => ({
      ...current,
      id: '',
      sshTunnel,
      usageProfile: sshTunnel === 'dynamicForward' ? 'socks5' : 'generic',
      name: typeOptions.find(item => item.value === sshTunnel)?.label || '',
      sshTunnelLocalHost: current.sshTunnelLocalHost || '127.0.0.1',
      sshTunnelLocalPort: currentPort || (sshTunnel === 'dynamicForward' ? 1080 : 8080),
      sshTunnelRemoteHost: current.sshTunnelRemoteHost || '127.0.0.1',
      sshTunnelRemotePort: Number(current.sshTunnelRemotePort || 80)
    }))
    setSavedEditingId('')
    setSelectedTemplate('')
  }

  function applyTemplate (templateName) {
    setPortConflict(null)
    const template = tunnelTemplates[templateName]
    const next = getTunnelTemplate(templateName)
    setSelectedTemplate(templateName)
    setDraft({
      ...next,
      id: '',
      name: template.name,
      usageProfile: template.usageProfile
    })
    setSavedEditingId('')
  }

  async function confirmExposure (tunnel) {
    const risk = getTunnelRisk(tunnel)
    if (!risk.requiresConfirmation) return true
    return new Promise(resolve => {
      Modal.confirm({
        title: e('shellpilotTunnelExposureTitle'),
        content: (
          <div>
            <p>{risk.message}</p>
            <p>{e('shellpilotTunnelExposureHint')}</p>
          </div>
        ),
        okText: e('shellpilotTunnelConfirmStart'),
        cancelText: e('shellpilotFleetCancel'),
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
      message.info(e('shellpilotTunnelConnectFirst'))
      return
    }
    if (!await confirmExposure(tunnel)) return
    setActionId('start')
    try {
      await startSshTunnelRuntime(store, tab, tunnel)
      setPortConflict(null)
      message.success(e('shellpilotTunnelStarted'))
      await refresh(true)
    } catch (error) {
      if (
        error?.code === 'SSH_TUNNEL_PORT_IN_USE' &&
        Number(error?.details?.requestedPort) > 0
      ) {
        setPortConflict(error.details)
        message.warning(e('shellpilotTunnelPortConflict'))
      } else {
        message.error(readableError(error))
      }
    } finally {
      setActionId('')
    }
  }

  function handleUseSuggestedPort () {
    const suggestedPort = Number(portConflict?.suggestedPort)
    if (!suggestedPort) return
    setDraft(current => ({
      ...current,
      id: '',
      sshTunnelLocalPort: suggestedPort
    }))
    setPortConflict(null)
    message.info(e('shellpilotTunnelSuggestedPortApplied'))
  }

  async function handleStop (id) {
    setActionId(id)
    try {
      await stopSshTunnelRuntime(store, tab, id)
      message.success(e('shellpilotTunnelStopped'))
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
      switch (result?.verdict) {
        case 'passed':
          message.success(e('shellpilotTunnelTestPassed'))
          break
        case 'limited':
          message.warning(e('shellpilotTunnelTestLimited'))
          break
        case 'failed':
          message.error(e('shellpilotTunnelTestFailed'))
          break
        case 'unverified':
        case 'checking':
        default:
          message.info(e('shellpilotTunnelTestUnverified'))
      }
      await refresh(true)
    } catch (error) {
      message.error(readableError(error))
    } finally {
      setActionId('')
    }
  }

  function handleEdit (entry) {
    setSavedEditingId('')
    setDraft({
      ...entry.definition,
      id: ''
    })
  }

  async function handleEditAndRestart (entry) {
    await handleStop(entry.id)
    handleEdit(entry)
    message.info(e('shellpilotTunnelRestartHint'))
  }

  function handleSave () {
    if (!currentBookmark) {
      message.warning(e('shellpilotTunnelBookmarkRequired'))
      return
    }
    try {
      const tunnel = {
        ...serializeTunnelForBookmark(draft),
        id: savedEditingId || validateTunnel(draft).id
      }
      const updatedBookmark = upsertBookmarkTunnel(currentBookmark, tunnel)
      store.editItem(currentBookmark.id, {
        sshTunnels: updatedBookmark.sshTunnels
      }, 'bookmarks')
      setSavedTunnels(updatedBookmark.sshTunnels)
      setSavedEditingId(tunnel.id)
      setDraft(tunnel)
      message.success(e('shellpilotTunnelSaved'))
    } catch (error) {
      message.warning(readableError(error))
    }
  }

  function handleLoadSaved (tunnel) {
    setSavedEditingId(tunnel.id)
    setSelectedTemplate('')
    setDraft({ ...tunnel })
  }

  function handleRemoveSaved (tunnel) {
    if (!currentBookmark) return
    Modal.confirm({
      title: e('shellpilotTunnelDeleteTitle'),
      content: translated('shellpilotTunnelDeletePrompt', {
        name: tunnel.name || e('shellpilotTopbarSshTunnel')
      }),
      okText: e('shellpilotDelete'),
      cancelText: e('shellpilotFleetCancel'),
      okButtonProps: { danger: true },
      onOk: () => {
        const updatedBookmark = removeBookmarkTunnel(currentBookmark, tunnel.id)
        store.editItem(currentBookmark.id, {
          sshTunnels: updatedBookmark.sshTunnels
        }, 'bookmarks')
        setSavedTunnels(updatedBookmark.sshTunnels)
        if (savedEditingId === tunnel.id) {
          setSavedEditingId('')
          setDraft(createDefaultTunnel())
          setSelectedTemplate('http')
        }
        message.success(e('shellpilotTunnelDeleted'))
      }
    })
  }

  const isDynamic = draft.sshTunnel === 'dynamicForward'
  const isRemote = draft.sshTunnel === 'forwardRemoteToLocal'
  const primaryText = connected
    ? e('shellpilotTunnelStart')
    : e('shellpilotTunnelConnectToStart')

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
          {e('shellpilotTopbarSshTunnel')}
        </span>
      )}
      className='ssh-tunnel-modal'
    >
      <Spin spinning={loading}>
        <div className='ssh-tunnel-scroll'>
          <section className='ssh-tunnel-context'>
            <div>
              <strong>
                {connected
                  ? e('shellpilotTunnelCurrentSession')
                  : e('shellpilotTunnelDisconnected')}
              </strong>
              <span>
                {
                  connected
                    ? `${runtime.session.username}@${runtime.session.host}:${runtime.session.port}`
                    : e('shellpilotTunnelConfigureFirst')
                }
              </span>
            </div>
            <Button icon={<ReloadOutlined />} onClick={() => refresh()}>
              {e('shellpilotTunnelRefresh')}
            </Button>
          </section>

          <div className='ssh-tunnel-layout'>
            <section className='ssh-tunnel-editor'>
              <div className='ssh-tunnel-section-title'>
                <div>
                  <strong>{e('shellpilotTunnelNew')}</strong>
                  <span>{e('shellpilotTunnelNewHint')}</span>
                </div>
                <Button
                  size='small'
                  onClick={() => openGuide(guideSectionForDraft(draft), {
                    definition: draft,
                    tunnelType: draft.sshTunnel
                  })}
                >
                  {e('shellpilotTunnelFullGuide')}
                </Button>
              </div>

              <TunnelTypeCards
                value={draft.sshTunnel}
                onChange={selectType}
              />

              <div className='ssh-tunnel-template-row'>
                <span>{e('shellpilotTunnelTemplates')}</span>
                <Select
                  value={selectedTemplate || undefined}
                  placeholder={e('shellpilotTunnelSelectTemplate')}
                  options={templateOptions}
                  onChange={applyTemplate}
                />
              </div>

              <div className='ssh-tunnel-form-grid'>
                <TunnelField
                  label={e('shellpilotTunnelName')}
                  hint={e('shellpilotTunnelNameHint')}
                >
                  <Input
                    value={draft.name}
                    maxLength={80}
                    placeholder={e('shellpilotTunnelNamePlaceholder')}
                    onChange={event => updateDraft('name', event.target.value)}
                  />
                </TunnelField>
                <TunnelField
                  label={isRemote
                    ? e('shellpilotTunnelLocalTargetHost')
                    : e('shellpilotTunnelLocalListenHost')}
                  hint={isRemote
                    ? e('shellpilotTunnelLocalTargetHostHint')
                    : e('shellpilotTunnelLocalListenHostHint')}
                >
                  <Input
                    value={draft.sshTunnelLocalHost}
                    onChange={event => updateDraft('sshTunnelLocalHost', event.target.value)}
                  />
                </TunnelField>
                <TunnelField
                  label={isRemote
                    ? e('shellpilotTunnelLocalTargetPort')
                    : e('shellpilotTunnelLocalListenPort')}
                  hint={e('shellpilotTunnelPortHint')}
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
                          label={isRemote
                            ? e('shellpilotTunnelRemoteListenHost')
                            : e('shellpilotTunnelRemoteTargetHost')}
                          hint={isRemote
                            ? e('shellpilotTunnelRemoteListenHostHint')
                            : e('shellpilotTunnelRemoteTargetHostHint')}
                        >
                          <Input
                            value={draft.sshTunnelRemoteHost}
                            onChange={event => updateDraft('sshTunnelRemoteHost', event.target.value)}
                          />
                        </TunnelField>
                        <TunnelField
                          label={isRemote
                            ? e('shellpilotTunnelRemoteListenPort')
                            : e('shellpilotTunnelRemoteTargetPort')}
                          hint={e('shellpilotTunnelPortHint')}
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
                <TunnelField
                  label={e('shellpilotTunnelAutoStart')}
                  hint={e('shellpilotTunnelAutoStartHint')}
                >
                  <Switch
                    checked={draft.autoStart !== false}
                    checkedChildren={e('shellpilotOn')}
                    unCheckedChildren={e('shellpilotOff')}
                    onChange={value => updateDraft('autoStart', value)}
                  />
                </TunnelField>
              </div>

              <div className='ssh-tunnel-flow'>
                <span>{e('shellpilotTunnelFlow')}</span>
                <strong>{getTunnelFlowText(normalizedPreview)}</strong>
              </div>

              {
                portConflict
                  ? (
                    <Alert
                      showIcon
                      type='warning'
                      className='ssh-tunnel-port-conflict'
                      message={translated('shellpilotTunnelPortConflictDetail', {
                        host: portConflict.host || '127.0.0.1',
                        port: portConflict.requestedPort
                      })}
                      description={portConflict.suggestedPort
                        ? e('shellpilotTunnelPortConflictSuggestion')
                        : e('shellpilotTunnelPortConflictNoSuggestion')}
                      action={portConflict.suggestedPort
                        ? (
                          <Button size='small' onClick={handleUseSuggestedPort}>
                            {translated('shellpilotTunnelUseSuggestedPort', {
                              port: portConflict.suggestedPort
                            })}
                          </Button>
                          )
                        : null}
                    />
                    )
                  : null
              }

              <div className='ssh-tunnel-editor-actions'>
                <Tooltip
                  title={currentBookmark
                    ? e('shellpilotTunnelSaveToBookmark')
                    : e('shellpilotTunnelSaveConnectionFirst')}
                >
                  <Button
                    icon={<SaveOutlined />}
                    disabled={!currentBookmark}
                    onClick={handleSave}
                  >
                    {savedEditingId
                      ? e('shellpilotTunnelUpdateProfile')
                      : e('shellpilotTunnelSaveProfile')}
                  </Button>
                </Tooltip>
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
              <div className='ssh-tunnel-saved-section'>
                <div className='ssh-tunnel-section-title'>
                  <div>
                    <strong>{e('shellpilotTunnelSavedProfiles')}</strong>
                    <span>
                      {
                        currentBookmark
                          ? translated('shellpilotTunnelSavedInBookmark', {
                            name: currentBookmark.title || currentBookmark.name || currentBookmark.host
                          })
                          : e('shellpilotTunnelBookmarkProfilesHint')
                      }
                    </span>
                  </div>
                  <Tag>
                    {translated('shellpilotTunnelCount', { count: savedTunnels.length })}
                  </Tag>
                </div>
                {
                  savedTunnels.length
                    ? (
                      <div className='ssh-tunnel-saved-list'>
                        {
                          savedTunnels.map(tunnel => (
                            <article
                              className={'ssh-tunnel-saved-card' + (savedEditingId === tunnel.id ? ' active' : '')}
                              key={tunnel.id}
                            >
                              <div>
                                <strong>{tunnel.name || tunnelName({ definition: tunnel })}</strong>
                                <span>{getTunnelFlowText(tunnel)}</span>
                                <Tag color={tunnel.autoStart !== false ? 'blue' : 'default'}>
                                  {tunnel.autoStart !== false
                                    ? e('shellpilotTunnelAutoStartNext')
                                    : e('shellpilotTunnelManualStartOnly')}
                                </Tag>
                              </div>
                              <Space>
                                <Button size='small' onClick={() => handleLoadSaved(tunnel)}>
                                  {e('shellpilotTunnelEdit')}
                                </Button>
                                <Tooltip title={e('shellpilotTunnelRemoveFromBookmark')}>
                                  <Button
                                    size='small'
                                    danger
                                    aria-label={e('shellpilotTunnelDeleteSaved')}
                                    icon={<DeleteOutlined />}
                                    onClick={() => handleRemoveSaved(tunnel)}
                                  />
                                </Tooltip>
                              </Space>
                            </article>
                          ))
                        }
                      </div>
                      )
                    : (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={e('shellpilotTunnelNoSavedProfiles')}
                      />
                      )
                }
              </div>

              <div className='ssh-tunnel-runtime-section'>
                <div className='ssh-tunnel-section-title'>
                  <div>
                    <strong>{e('shellpilotTunnelRunning')}</strong>
                    <span>{e('shellpilotTunnelRunningHint')}</span>
                  </div>
                  <Tag color={connected ? 'success' : 'default'}>
                    {connected
                      ? translated('shellpilotTunnelRunningCount', {
                        count: runtime.tunnels.length
                      })
                      : e('shellpilotTunnelDisconnectedShort')}
                  </Tag>
                </div>

                {
                !connected
                  ? (
                    <Alert
                      showIcon
                      type='info'
                      message={e('shellpilotTunnelConnectToManage')}
                      description={e('shellpilotTunnelDraftPreserved')}
                    />
                    )
                  : null
              }

                {
                connected && runtime.tunnels.length === 0
                  ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={e('shellpilotTunnelNoRunning')}
                    />
                    )
                  : null
              }

                <div className='ssh-tunnel-running-list'>
                  {
                  runtime.tunnels.map(entry => (
                    <SshTunnelRuntimeCard
                      key={entry.id}
                      entry={runtimeEntryForCard(entry)}
                      busy={actionId}
                      onTest={handleTest}
                      onEdit={() => handleEdit(entry)}
                      onEditAndRestart={() => handleEditAndRestart(entry)}
                      onStop={handleStop}
                      onOpenGuide={(section, context) => openGuide(section, context)}
                      onShowHistory={() => showDisconnectHistory(entry)}
                    />
                  ))
                }
                </div>
              </div>
            </section>
          </div>
        </div>
      </Spin>
      <SshTunnelGuideModal
        open={guideState.open}
        activeSection={guideState.section}
        context={guideState.context}
        onClose={() => setGuideState(current => ({
          ...current,
          open: false
        }))}
      />
    </Modal>
  )
}
