import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip
} from 'antd'
import {
  CopyOutlined,
  DashboardOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { refs, refsStatic } from '../common/ref'
import { runCmd } from '../terminal/terminal-apis'
import { copy } from '../../common/clipboard'
import download from '../../common/download'
import message from '../common/message'
import * as ls from '../../common/safe-local-storage'
import { runServerStatusProbes } from './server-status-probes.js'
import { createServerStatusSnapshot } from './server-status-model.js'
import {
  groupServerPlatforms,
  normalizePlatformRules
} from './server-status-platforms.js'
import {
  buildServerStatusJson,
  buildServerStatusMarkdown
} from './server-status-report.js'
import { buildServerStatusAiPrompt } from './server-status-ai-context.js'
import AgentTaskRunner from '../ai/agent-task-runner.jsx'
import { isDiagnosticTargetAbnormal } from '../ai/diagnostic-plan.js'
import {
  agentTaskRegistry,
  installSafetyTaskCapability,
  recoverOrphanedAgentTasks
} from '../ai/agent-task-registry.js'
import * as transactionStore from '../../common/safety-transactions/transaction-store.js'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import './server-status-modal.styl'

const customRulesKey = 'shellpilot-server-platform-rules'
const e = window.translate
const tf = (key, replacements) => formatShellPilotTranslation(e, key, replacements)

const statusMeta = {
  healthy: ['shellpilotServerStatusHealthy', 'success'],
  warning: ['shellpilotServerStatusWarning', 'warning'],
  critical: ['shellpilotServerStatusAbnormal', 'error'],
  unknown: ['shellpilotServerStatusUnknown', 'default'],
  success: ['shellpilotServerStatusSuccess', 'success'],
  permission: ['shellpilotServerStatusPermissionLimited', 'warning'],
  unsupported: ['shellpilotServerStatusUnsupported', 'default'],
  timeout: ['shellpilotServerStatusTimeout', 'error'],
  error: ['shellpilotServerStatusFailed', 'error']
}

function endpointUser (tab = {}) {
  return tab.username || tab.user || ''
}

function endpointMatches (record = {}, tab = {}) {
  return Boolean(
    record.host &&
    endpointUser(record) &&
    tab.host === record.host &&
    Number(tab.port || 22) === Number(record.port || 22) &&
    endpointUser(tab) === endpointUser(record)
  )
}

function resolveTerminal (tab = {}) {
  const terminal = tab.id ? refs.get('term-' + tab.id) : null
  if (!terminal?.pid || !terminal.isSsh?.()) return null
  if (!endpointMatches(tab, terminal.props?.tab || {})) return null
  return terminal
}

function resultById (results, id) {
  return results.find(item => item.id === id)?.data
}

function assembleSnapshot (tab, results, customRules) {
  const system = resultById(results, 'system') || {}
  const resources = resultById(results, 'resources') || {}
  const services = resultById(results, 'services') || []
  const network = resultById(results, 'network') || {}
  const firewall = resultById(results, 'firewall') || {}
  const security = resultById(results, 'security') || {}
  const containers = resultById(results, 'containers') || []
  const platforms = groupServerPlatforms(
    { services, containers },
    { customRules }
  )
  const networks = (network.interfaces || []).map((item, index) => ({
    ...item,
    listeningPorts: index === 0 ? (network.listeningPorts || []) : []
  }))
  return createServerStatusSnapshot({
    endpoint: {
      tabId: tab.id,
      host: tab.host,
      port: Number(tab.port || 22),
      username: endpointUser(tab),
      title: tab.title || tab.name || tab.host
    },
    system,
    resources: {
      ...resources,
      cpuCores: system.cpuCores
    },
    services,
    network,
    networks,
    firewall,
    security,
    containers,
    platforms,
    probes: results
  })
}

function statusTag (status) {
  const [labelKey, color] = statusMeta[status] || ['shellpilotServerStatusUnknown', 'default']
  return <Tag color={color}>{e(labelKey)}</Tag>
}

function formatPercent (value) {
  const number = Number(value)
  return Number.isFinite(number) ? `${Math.round(number)}%` : e('shellpilotServerStatusUnknown')
}

function formatBytes (value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return e('shellpilotServerStatusUnknown')
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let result = number
  let index = 0
  while (result >= 1024 && index < units.length - 1) {
    result /= 1024
    index += 1
  }
  return `${result >= 10 || index === 0 ? result.toFixed(0) : result.toFixed(1)} ${units[index]}`
}

function formatUptime (seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value)) return e('shellpilotServerStatusUnknown')
  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  return days
    ? tf('shellpilotServerStatusUptimeDaysHours', { days, hours })
    : tf('shellpilotServerStatusUptimeHours', { hours })
}

function emptyRuleDraft () {
  return {
    name: '',
    servicePrefixes: '',
    serviceNames: '',
    pathPrefixes: '',
    composeProjects: ''
  }
}

function splitRuleValues (value) {
  return String(value || '').split(/[，,\n]/).map(item => item.trim()).filter(Boolean)
}

export default function ServerStatusModal ({ open, onClose, store, tab = {} }) {
  const [snapshots, setSnapshots] = useState({})
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [showRules, setShowRules] = useState(false)
  const [customRules, setCustomRules] = useState(() => ls.safeGetItemJSON(customRulesKey, []))
  const [ruleDraft, setRuleDraft] = useState(emptyRuleDraft)
  const [diagnosticTarget, setDiagnosticTarget] = useState(null)
  const scanRef = useRef(0)
  const autoScanRef = useRef('')
  const liveTabRef = useRef(tab)
  liveTabRef.current = tab
  const snapshot = snapshots[tab.id]

  useEffect(() => {
    installSafetyTaskCapability(store, agentTaskRegistry)
    recoverOrphanedAgentTasks({
      store: transactionStore,
      registry: agentTaskRegistry
    }).catch(error => window.store.onError(error))
  }, [store])

  function getCurrentDiagnosticEndpoint () {
    const terminal = resolveTerminal(liveTabRef.current)
    if (!terminal) throw new Error(e('shellpilotServerStatusDiagnosisDisconnected'))
    return terminal.getTerminalSafetyEndpoint()
  }

  function openDiagnostic (type, data) {
    const terminal = resolveTerminal(tab)
    if (!snapshot || !terminal) {
      message.warning(e('shellpilotServerStatusAiDiagnosisDisconnected'))
      return
    }
    setDiagnosticTarget({
      type,
      data,
      snapshot,
      terminal,
      requestId: `${type}-${Date.now()}`
    })
  }

  async function scanCurrentServer () {
    const terminal = resolveTerminal(tab)
    if (!terminal) {
      message.warning(e('shellpilotServerStatusConnectFirst'))
      return
    }
    const scanId = ++scanRef.current
    setLoading(true)
    try {
      const results = await runServerStatusProbes((command, options) => {
        return runCmd(terminal.pid, command, options)
      })
      if (scanId !== scanRef.current) return
      const next = assembleSnapshot(tab, results, customRules)
      setSnapshots(current => ({ ...current, [tab.id]: next }))
    } catch (error) {
      window.store.onError(error)
    } finally {
      if (scanId === scanRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) {
      autoScanRef.current = ''
      return
    }
    const key = `${tab.id || ''}:${tab.host || ''}:${tab.port || 22}:${endpointUser(tab)}`
    if (!key || autoScanRef.current === key) return
    autoScanRef.current = key
    scanCurrentServer()
  }, [open, tab.id, tab.host, tab.port, tab.username, tab.user])

  const maxDisk = useMemo(() => {
    const filesystems = snapshot?.resources?.filesystems || []
    return filesystems.reduce((max, item) => Math.max(max, Number(item.usedPercent) || 0), 0)
  }, [snapshot])

  function handleCopy () {
    if (!snapshot) return
    copy(buildServerStatusMarkdown(snapshot))
  }

  async function handleExport (format) {
    if (!snapshot) return
    const host = snapshot.endpoint?.host || 'server'
    const timestamp = snapshot.collectedAt.replace(/[:.]/g, '-').slice(0, 19)
    const json = format === 'json'
    await download(
      `ShellPilot-${host}-${timestamp}.${json ? 'json' : 'md'}`,
      json ? buildServerStatusJson(snapshot) : buildServerStatusMarkdown(snapshot)
    )
  }

  function handleSendToAi () {
    if (!snapshot) return
    store.handleOpenAIPanel()
    const prompt = buildServerStatusAiPrompt(snapshot)
    setTimeout(() => {
      const aiChat = refsStatic.get('AIChat')
      if (!aiChat?.setPrompt) {
        message.warning(e('shellpilotAgentTaskAssistantNotReady'))
        return
      }
      aiChat.setPrompt(prompt)
      onClose()
    }, 120)
  }

  function updateRuleDraft (key, value) {
    setRuleDraft(current => ({ ...current, [key]: value }))
  }

  function handleAddRule () {
    try {
      const candidate = {
        id: `custom-${Date.now().toString(36)}`,
        name: ruleDraft.name,
        servicePrefixes: splitRuleValues(ruleDraft.servicePrefixes),
        serviceNames: splitRuleValues(ruleDraft.serviceNames),
        pathPrefixes: splitRuleValues(ruleDraft.pathPrefixes),
        composeProjects: splitRuleValues(ruleDraft.composeProjects)
      }
      const next = normalizePlatformRules([...customRules, candidate])
      ls.safeSetItemJSON(customRulesKey, next)
      setCustomRules(next)
      setRuleDraft(emptyRuleDraft())
      message.success(e('shellpilotServerStatusRuleSaved'))
    } catch (error) {
      message.error(e('shellpilotServerStatusRuleInvalid'))
    }
  }

  function handleDeleteRule (id) {
    const next = customRules.filter(rule => rule.id !== id)
    ls.safeSetItemJSON(customRulesKey, next)
    setCustomRules(next)
  }

  function renderRulesModal () {
    return (
      <Modal
        title={e('shellpilotServerStatusPlatformRules')}
        open={showRules}
        onCancel={() => setShowRules(false)}
        footer={null}
        width={760}
        destroyOnClose={false}
      >
        <div className='server-status-rule-help'>
          {e('shellpilotServerStatusPlatformRulesHelp')}
        </div>
        <div className='server-status-rule-form'>
          <label>
            <span>{e('shellpilotServerStatusPlatformName')}</span>
            <Input value={ruleDraft.name} onChange={event => updateRuleDraft('name', event.target.value)} placeholder={e('shellpilotServerStatusPlatformNamePlaceholder')} />
          </label>
          <label>
            <span>{e('shellpilotServerStatusServicePrefix')}</span>
            <Input value={ruleDraft.servicePrefixes} onChange={event => updateRuleDraft('servicePrefixes', event.target.value)} placeholder={e('shellpilotServerStatusServicePrefixPlaceholder')} />
          </label>
          <label>
            <span>{e('shellpilotServerStatusFullServiceName')}</span>
            <Input value={ruleDraft.serviceNames} onChange={event => updateRuleDraft('serviceNames', event.target.value)} placeholder={e('shellpilotServerStatusFullServiceNamePlaceholder')} />
          </label>
          <label>
            <span>{e('shellpilotServerStatusInstallPath')}</span>
            <Input value={ruleDraft.pathPrefixes} onChange={event => updateRuleDraft('pathPrefixes', event.target.value)} placeholder={e('shellpilotServerStatusInstallPathPlaceholder')} />
          </label>
          <label>
            <span>{e('shellpilotServerStatusComposeProject')}</span>
            <Input value={ruleDraft.composeProjects} onChange={event => updateRuleDraft('composeProjects', event.target.value)} placeholder={e('shellpilotServerStatusComposeProjectPlaceholder')} />
          </label>
          <Button type='primary' icon={<PlusOutlined />} onClick={handleAddRule}>
            {e('shellpilotServerStatusAddRule')}
          </Button>
        </div>
        <div className='server-status-rule-list'>
          {customRules.length
            ? customRules.map(rule => (
              <div className='server-status-rule-row' key={rule.id}>
                <div>
                  <strong>{rule.name}</strong>
                  <span>
                    {[
                      ...(rule.servicePrefixes || []),
                      ...(rule.serviceNames || []),
                      ...(rule.pathPrefixes || []),
                      ...(rule.composeProjects || [])
                    ].join('、')}
                  </span>
                </div>
                <Popconfirm title={e('shellpilotServerStatusDeleteRuleConfirm')} onConfirm={() => handleDeleteRule(rule.id)}>
                  <Button danger type='text' icon={<DeleteOutlined />} title={e('shellpilotServerStatusDeleteRule')} />
                </Popconfirm>
              </div>
            ))
            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={e('shellpilotServerStatusNoCustomRules')} />}
        </div>
      </Modal>
    )
  }

  function renderSummary () {
    if (!snapshot) return null
    const summary = snapshot.summary || {}
    const memory = snapshot.resources?.memory || {}
    const memoryAvailable = memory.totalBytes
      ? Number(memory.availableBytes || 0) / Number(memory.totalBytes) * 100
      : null
    const items = [
      [e('shellpilotServerStatusOverall'), statusTag(snapshot.overallStatus)],
      [e('shellpilotServerStatusUptime'), formatUptime(snapshot.system?.uptimeSeconds)],
      [e('shellpilotServerStatusSystemLoad'), summary.normalizedLoad ?? e('shellpilotServerStatusUnknown')],
      [e('shellpilotServerStatusAvailableMemory'), memoryAvailable === null ? e('shellpilotServerStatusUnknown') : formatPercent(memoryAvailable)],
      [e('shellpilotServerStatusHighestDisk'), formatPercent(maxDisk)],
      [e('shellpilotServerStatusServices'), tf('shellpilotServerStatusServiceSummary', {
        running: summary.runningServices || 0,
        failed: summary.failedServices || 0
      })]
    ]
    return (
      <div className='server-status-summary'>
        {items.map(([label, value]) => (
          <div className='server-status-summary-item' key={label}>
            <span>{label}</span><strong>{value}</strong>
          </div>
        ))}
      </div>
    )
  }

  function renderPlatformGroups (compact = false) {
    const platforms = snapshot?.platforms || []
    if (!platforms.length) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={e('shellpilotServerStatusNoPlatformGroups')} />
    }
    return (
      <div className='server-status-platform-list'>
        {platforms.map(platform => (
          <details className='server-status-platform' key={platform.id} open={!compact || platform.status === 'critical'}>
            <summary>
              <strong>{platform.name}</strong>
              <span className='server-status-platform-tags'>
                <Tag>{e(platform.confidence === 'high'
                  ? 'shellpilotServerStatusHighConfidence'
                  : platform.confidence === 'medium'
                    ? 'shellpilotServerStatusMediumConfidence'
                    : 'shellpilotServerStatusLowConfidence')}
                </Tag>
                <Tag>{tf('shellpilotServerStatusServiceCount', { count: platform.services?.length || 0 })}</Tag>
                {platform.containers?.length
                  ? <Tag>{tf('shellpilotServerStatusContainerCount', { count: platform.containers.length })}</Tag>
                  : null}
                {isDiagnosticTargetAbnormal(platform)
                  ? (
                    <Tooltip title={e('shellpilotServerStatusDiagnosePlatformHint')}>
                      <Button size='small' disabled={loading} icon={<RobotOutlined />} onClick={event => { event.preventDefault(); event.stopPropagation(); openDiagnostic('platform', platform) }}>
                        {e('shellpilotServerStatusAiDiagnosis')}
                      </Button>
                    </Tooltip>
                    )
                  : null}
              </span>
            </summary>
            <div className='server-status-evidence'>
              {e('shellpilotServerStatusRecognitionBasis')} {(platform.evidence || [])
                .map(item => item.value || item.type)
                .join(`${e('shellpilotListSeparator')}${
                  (window.store?.previewLanguage || window.store?.config?.language) === 'en_us'
                    ? ' '
                    : ''
                }`) || e('shellpilotServerStatusServiceList')}
            </div>
            {(platform.services || []).slice(0, compact ? 8 : 80).map(service => (
              <div className={`server-status-row ${isDiagnosticTargetAbnormal(service) ? 'has-diagnostic' : ''}`} key={service.name}>
                <span title={service.description}>{service.name}</span>
                <span>{service.activeState || service.subState || e('shellpilotServerStatusUnknown')}</span>
                <span>{service.workingDirectory || service.fragmentPath || ''}</span>
                {isDiagnosticTargetAbnormal(service)
                  ? (
                    <Tooltip title={e('shellpilotServerStatusDiagnoseServiceHint')}>
                      <Button size='small' type='text' disabled={loading} icon={<RobotOutlined />} onClick={() => openDiagnostic('service', service)}>
                        {e('shellpilotServerStatusAiDiagnosis')}
                      </Button>
                    </Tooltip>
                    )
                  : null}
              </div>
            ))}
            {(platform.containers || []).slice(0, compact ? 5 : 50).map(container => (
              <div className={`server-status-row ${isDiagnosticTargetAbnormal(container) ? 'has-diagnostic' : ''}`} key={`${container.engine}-${container.name}`}>
                <span>{container.name}</span><span>{container.status}</span><span>{container.ports}</span>
                {isDiagnosticTargetAbnormal(container)
                  ? (
                    <Tooltip title={e('shellpilotServerStatusDiagnoseContainerHint')}>
                      <Button size='small' type='text' disabled={loading} icon={<RobotOutlined />} onClick={() => openDiagnostic('container', container)}>
                        {e('shellpilotServerStatusAiDiagnosis')}
                      </Button>
                    </Tooltip>
                    )
                  : null}
              </div>
            ))}
          </details>
        ))}
      </div>
    )
  }

  function renderAlerts () {
    const alerts = snapshot?.alerts || []
    if (!alerts.length) {
      return <div className='server-status-empty-ok'>{e('shellpilotServerStatusNoClearAbnormality')}</div>
    }
    return alerts.map((alert, index) => (
      <div className={`server-status-alert ${alert.status || 'warning'}`} key={`${alert.code}-${index}`}>
        {statusTag(alert.status)}<span>{alert.message || alert.target || alert.code}</span>
        {isDiagnosticTargetAbnormal({ status: 'warning', ...alert })
          ? (
            <Tooltip title={e('shellpilotServerStatusDiagnoseAlertHint')}>
              <Button size='small' type='text' disabled={loading} icon={<RobotOutlined />} onClick={() => openDiagnostic('alert', alert)}>
                {e('shellpilotServerStatusAiDiagnosis')}
              </Button>
            </Tooltip>
            )
          : null}
      </div>
    ))
  }

  function renderOverview () {
    const network = snapshot?.network || {}
    return (
      <div className='server-status-overview'>
        <section className='server-status-section'>
          <header>{e('shellpilotServerStatusDetectedPlatforms')}</header>
          <div className='server-status-section-scroll'>{renderPlatformGroups(true)}</div>
        </section>
        <div className='server-status-overview-side'>
          <section className='server-status-section'>
            <header>{e('shellpilotServerStatusNetworkFirewall')}</header>
            <div className='server-status-compact-list'>
              {(network.interfaces || []).slice(0, 6).map(item => (
                <div className='server-status-row' key={item.name}>
                  <span>{item.name}</span><span>{(item.addresses || []).join(', ') || e('shellpilotServerStatusNoAddress')}</span><span>{item.state}</span>
                </div>
              ))}
              <div className='server-status-row'><span>{e('shellpilotServerStatusDefaultRoute')}</span><span>{network.defaultRoute?.gateway || e('shellpilotServerStatusNotDetected')}</span><span>{network.defaultRoute?.interface || ''}</span></div>
              <div className='server-status-row'><span>{e('shellpilotServerStatusFirewall')}</span><span>{snapshot.firewall?.provider || e('shellpilotServerStatusUnrecognized')}</span><span>{snapshot.firewall?.enabled ? e('shellpilotServerStatusEnabled') : e('shellpilotServerStatusDisabled')}</span></div>
            </div>
          </section>
          <section className='server-status-section'>
            <header>{e('shellpilotServerStatusNeedsAttention')}</header>
            <div className='server-status-section-scroll'>{renderAlerts()}</div>
          </section>
        </div>
      </div>
    )
  }

  function renderResources () {
    const resources = snapshot?.resources || {}
    const memory = resources.memory || {}
    return (
      <div className='server-status-two-columns'>
        <section className='server-status-section'>
          <header>{e('shellpilotServerStatusMemoryLoad')}</header>
          <div className='server-status-resource-block'>
            <div>
              {tf('shellpilotServerStatusMemoryAvailable', {
                available: formatBytes(memory.availableBytes),
                total: formatBytes(memory.totalBytes)
              })}
            </div>
            <Progress percent={memory.totalBytes ? Math.round((1 - memory.availableBytes / memory.totalBytes) * 100) : 0} size='small' />
            <div>
              {tf('shellpilotServerStatusSwapUsed', {
                used: formatBytes((resources.swap?.totalBytes || 0) - (resources.swap?.freeBytes || 0)),
                total: formatBytes(resources.swap?.totalBytes)
              })}
            </div>
            <div>
              {tf('shellpilotServerStatusLoadValues', {
                one: resources.load?.one ?? '-',
                five: resources.load?.five ?? '-',
                fifteen: resources.load?.fifteen ?? '-'
              })}
            </div>
          </div>
        </section>
        <section className='server-status-section'>
          <header>{e('shellpilotServerStatusDiskInode')}</header>
          <div className='server-status-section-scroll'>
            {(resources.filesystems || []).map(item => (
              <div className='server-status-row' key={`${item.filesystem}-${item.mount}`}>
                <span>{item.mount}</span><span>{formatPercent(item.usedPercent)}</span><span>inode {formatPercent(item.inodeUsedPercent)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className='server-status-section server-status-span-two'>
          <header>{e('shellpilotServerStatusHighResourceProcesses')}</header>
          <div className='server-status-section-scroll'>
            {(resources.processes || []).map(item => (
              <div className='server-status-row server-status-process-row' key={`${item.pid}-${item.command}`}>
                <span>{item.command}</span>
                <span>PID {item.pid}</span>
                <span>
                  {tf('shellpilotServerStatusProcessUsage', {
                    cpu: item.cpuPercent,
                    memory: item.memoryPercent
                  })}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    )
  }

  function renderNetwork () {
    const network = snapshot?.network || {}
    return (
      <div className='server-status-two-columns'>
        <section className='server-status-section'>
          <header>{e('shellpilotServerStatusInterfacesIp')}</header>
          <div className='server-status-section-scroll'>
            {(network.interfaces || []).map(item => (
              <div className='server-status-row' key={item.name}><span>{item.name}</span><span>{(item.addresses || []).join(', ') || e('shellpilotServerStatusNoAddress')}</span><span>{item.state}</span></div>
            ))}
          </div>
        </section>
        <section className='server-status-section'>
          <header>{e('shellpilotServerStatusRoutesDns')}</header>
          <div className='server-status-compact-list'>
            <div className='server-status-row'><span>{e('shellpilotServerStatusGateway')}</span><span>{network.defaultRoute?.gateway || e('shellpilotServerStatusNotDetected')}</span><span>{network.defaultRoute?.interface || ''}</span></div>
            <div className='server-status-row'><span>DNS</span><span>{(network.dnsServers || []).join(', ') || e('shellpilotServerStatusNotDetected')}</span><span /></div>
          </div>
        </section>
        <section className='server-status-section server-status-span-two'>
          <header>{e('shellpilotServerStatusListeningPorts')}</header>
          <div className='server-status-section-scroll'>
            {(network.listeningPorts || []).map((item, index) => (
              <div className='server-status-row' key={`${item.protocol}-${item.port}-${index}`}><span>{item.protocol.toUpperCase()} {item.address}:{item.port}</span><span>{item.process || e('shellpilotServerStatusUnknownProcess')}</span><span>{item.pid ? `PID ${item.pid}` : ''}</span></div>
            ))}
          </div>
        </section>
      </div>
    )
  }

  function renderSecurity () {
    const firewall = snapshot?.firewall || {}
    const security = snapshot?.security || {}
    return (
      <div className='server-status-two-columns'>
        <section className='server-status-section'>
          <header>{e('shellpilotServerStatusFirewall')}</header>
          <div className='server-status-resource-block'>
            <div>{tf('shellpilotServerStatusFirewallType', { value: firewall.provider || e('shellpilotServerStatusUnrecognized') })}</div>
            <div>{tf('shellpilotServerStatusFirewallState', { value: firewall.enabled ? e('shellpilotServerStatusEnabled') : e('shellpilotServerStatusDisabledOrPermission') })}</div>
            <div>{tf('shellpilotServerStatusFirewallRuleCount', { count: firewall.ruleCount ?? e('shellpilotServerStatusUnknown') })}</div>
          </div>
        </section>
        <section className='server-status-section'>
          <header>{e('shellpilotServerStatusSecurityModules')}</header>
          <div className='server-status-resource-block'>
            <div>{tf('shellpilotServerStatusSelinux', { value: security.selinux || firewall.selinux || e('shellpilotServerStatusNotInstalled') })}</div>
            <div>{tf('shellpilotServerStatusAppArmor', { value: security.appArmor || e('shellpilotServerStatusNotInstalledOrPermission') })}</div>
            <div>{tf('shellpilotServerStatusCurrentSessions', { count: security.loggedInUsers?.length || 0 })}</div>
          </div>
        </section>
        <section className='server-status-section server-status-span-two'>
          <header>{e('shellpilotServerStatusRecentFailedLogins')}</header>
          <pre className='server-status-pre'>{(security.failedLogins || []).join('\n') || e('shellpilotServerStatusNoFailedLogins')}</pre>
        </section>
      </div>
    )
  }

  function renderContainers () {
    const containers = snapshot?.containers || []
    if (!containers.length) return <Empty description={e('shellpilotServerStatusNoContainerAccess')} />
    return (
      <section className='server-status-section server-status-full-section'>
        <header>{e('shellpilotServerStatusDockerPodmanContainers')}</header>
        <div className='server-status-section-scroll'>
          {containers.map(item => (
            <div className={`server-status-row ${isDiagnosticTargetAbnormal(item) ? 'has-diagnostic' : ''}`} key={`${item.engine}-${item.name}`}>
              <span>{item.name}</span><span>{item.status}</span><span>{item.composeProject || item.image}</span>
              {isDiagnosticTargetAbnormal(item)
                ? (
                  <Tooltip title={e('shellpilotServerStatusDiagnoseContainerHint')}>
                    <Button size='small' type='text' disabled={loading} icon={<RobotOutlined />} onClick={() => openDiagnostic('container', item)}>
                      {e('shellpilotServerStatusAiDiagnosis')}
                    </Button>
                  </Tooltip>
                  )
                : null}
            </div>
          ))}
        </div>
      </section>
    )
  }

  function renderRawResults () {
    return (
      <div className='server-status-raw-list'>
        {(snapshot?.probes || []).map(probe => (
          <details className='server-status-raw-probe' key={probe.id}>
            <summary><strong>{probe.label || probe.id}</strong>{statusTag(probe.status)}<span>{probe.durationMs} ms</span></summary>
            {probe.message ? <div className='server-status-probe-message'>{probe.message}</div> : null}
            <pre className='server-status-pre'>{probe.rawOutput || probe.stderr || e('shellpilotServerStatusNoOutput')}</pre>
          </details>
        ))}
      </div>
    )
  }

  const tabItems = snapshot
    ? [
        { key: 'overview', label: e('shellpilotServerStatusOverview'), children: renderOverview() },
        { key: 'platforms', label: e('shellpilotServerStatusPlatformsServices'), children: renderPlatformGroups() },
        { key: 'resources', label: e('shellpilotServerStatusResources'), children: renderResources() },
        { key: 'network', label: e('shellpilotServerStatusNetwork'), children: renderNetwork() },
        { key: 'security', label: e('shellpilotServerStatusFirewallSecurity'), children: renderSecurity() },
        { key: 'containers', label: e('shellpilotServerStatusContainers'), children: renderContainers() },
        { key: 'raw', label: e('shellpilotServerStatusRawResults'), children: renderRawResults() }
      ]
    : []

  const probeCounts = (snapshot?.probes || []).reduce((result, probe) => {
    result[probe.status] = (result[probe.status] || 0) + 1
    return result
  }, {})

  return (
    <>
      <Modal
        title={<Space><DashboardOutlined />{e('shellpilotServerStatusCenter')}</Space>}
        open={open}
        onCancel={onClose}
        footer={null}
        width={1180}
        destroyOnClose={false}
        className='server-status-modal'
      >
        <div className='server-status-toolbar'>
          <div className='server-status-endpoint'>
            {endpointUser(tab) ? `${endpointUser(tab)}@` : ''}{tab.host || e('shellpilotServerStatusNotConnected')}:{tab.port || 22}
            {snapshot?.system?.hostname ? <span> · {snapshot.system.hostname}</span> : null}
          </div>
          <Space wrap>
            <Tooltip title={e('shellpilotServerStatusCopyMarkdownSummary')}>
              <Button icon={<CopyOutlined />} disabled={!snapshot} onClick={handleCopy}>{e('shellpilotServerStatusCopyResults')}</Button>
            </Tooltip>
            <Button icon={<SettingOutlined />} onClick={() => setShowRules(true)}>{e('shellpilotServerStatusRecognitionRules')}</Button>
            <Button icon={<DownloadOutlined />} disabled={!snapshot} onClick={() => handleExport('markdown')}>{e('shellpilotServerStatusExportMarkdown')}</Button>
            <Button icon={<DownloadOutlined />} disabled={!snapshot} onClick={() => handleExport('json')}>{e('shellpilotServerStatusExportJson')}</Button>
            <Button icon={<RobotOutlined />} disabled={!snapshot} onClick={handleSendToAi}>{e('shellpilotServerStatusSendToAi')}</Button>
            <Button type='primary' icon={<ReloadOutlined />} loading={loading} onClick={scanCurrentServer}>{e('shellpilotServerStatusRefreshDetection')}</Button>
          </Space>
        </div>
        {renderSummary()}
        <Spin spinning={loading} tip={e('shellpilotServerStatusRunningReadonlyDetection')}>
          <div className='server-status-content'>
            {!snapshot && !loading
              ? <Empty description={e('shellpilotServerStatusNoSnapshotHint')} />
              : snapshot
                ? <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
                : <div className='server-status-loading-placeholder' />}
          </div>
        </Spin>
        {snapshot
          ? (
            <div className='server-status-footer'>
              <span>
                {tf('shellpilotServerStatusDetectionSummary', {
                  success: probeCounts.success || 0,
                  permission: probeCounts.permission || 0,
                  failed: (probeCounts.error || 0) + (probeCounts.timeout || 0)
                })}
              </span>
              <span>
                {new Date(snapshot.collectedAt).toLocaleString(
                  (store.previewLanguage || store.config?.language) === 'en_us' ? 'en-US' : 'zh-CN'
                )}
              </span>
            </div>
            )
          : null}
        {renderRulesModal()}
      </Modal>
      <AgentTaskRunner
        open={Boolean(diagnosticTarget)}
        onClose={() => setDiagnosticTarget(null)}
        snapshot={diagnosticTarget?.snapshot}
        target={diagnosticTarget}
        store={store}
        terminal={diagnosticTarget?.terminal}
        getCurrentEndpoint={getCurrentDiagnosticEndpoint}
      />
    </>
  )
}
