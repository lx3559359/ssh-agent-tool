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
import './server-status-modal.styl'

const customRulesKey = 'shellpilot-server-platform-rules'

const statusMeta = {
  healthy: ['正常', 'success'],
  warning: ['警告', 'warning'],
  critical: ['异常', 'error'],
  unknown: ['未知', 'default'],
  success: ['成功', 'success'],
  permission: ['权限受限', 'warning'],
  unsupported: ['不支持', 'default'],
  timeout: ['超时', 'error'],
  error: ['失败', 'error']
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
  const [label, color] = statusMeta[status] || [status || '未知', 'default']
  return <Tag color={color}>{label}</Tag>
}

function formatPercent (value) {
  const number = Number(value)
  return Number.isFinite(number) ? `${Math.round(number)}%` : '未知'
}

function formatBytes (value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '未知'
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
  if (!Number.isFinite(value)) return '未知'
  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  return days ? `${days} 天 ${hours} 小时` : `${hours} 小时`
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
    if (!terminal) throw new Error('当前 SSH 连接已断开，诊断任务已停止。')
    return terminal.getTerminalSafetyEndpoint()
  }

  function openDiagnostic (type, data) {
    const terminal = resolveTerminal(tab)
    if (!snapshot || !terminal) {
      message.warning('当前 SSH 会话已断开，无法启动 AI 诊断。')
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
      message.warning('请先连接 SSH 服务器后再查看状态。')
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
        message.warning('AI 助手尚未准备完成，请稍后重试。')
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
      message.success('识别规则已保存，刷新检测后生效。')
    } catch (error) {
      message.error('规则无效：名称至少 2 个字符，并填写具体的服务前缀、服务名、安装路径或 Compose 项目。')
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
        title='平台识别规则'
        open={showRules}
        onCancel={() => setShowRules(false)}
        footer={null}
        width={760}
        destroyOnClose={false}
      >
        <div className='server-status-rule-help'>
          用于识别内部或小众平台。匹配项越具体越可靠；不支持通配符和正则表达式，避免把系统服务错误归组。
        </div>
        <div className='server-status-rule-form'>
          <label><span>平台名称</span><Input value={ruleDraft.name} onChange={event => updateRuleDraft('name', event.target.value)} placeholder='例如：公司 ERP 平台' /></label>
          <label><span>服务名前缀</span><Input value={ruleDraft.servicePrefixes} onChange={event => updateRuleDraft('servicePrefixes', event.target.value)} placeholder='例如：erp-' /></label>
          <label><span>完整服务名</span><Input value={ruleDraft.serviceNames} onChange={event => updateRuleDraft('serviceNames', event.target.value)} placeholder='例如：erp-api.service, erp-worker.service' /></label>
          <label><span>安装路径</span><Input value={ruleDraft.pathPrefixes} onChange={event => updateRuleDraft('pathPrefixes', event.target.value)} placeholder='例如：/opt/company/erp' /></label>
          <label><span>Compose 项目</span><Input value={ruleDraft.composeProjects} onChange={event => updateRuleDraft('composeProjects', event.target.value)} placeholder='例如：erp-prod' /></label>
          <Button type='primary' icon={<PlusOutlined />} onClick={handleAddRule}>新增规则</Button>
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
                <Popconfirm title='删除这条识别规则？' onConfirm={() => handleDeleteRule(rule.id)}>
                  <Button danger type='text' icon={<DeleteOutlined />} title='删除规则' />
                </Popconfirm>
              </div>
            ))
            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='尚未添加自定义规则' />}
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
      ['整体状态', statusTag(snapshot.overallStatus)],
      ['运行时间', formatUptime(snapshot.system?.uptimeSeconds)],
      ['系统负载', summary.normalizedLoad ?? '未知'],
      ['可用内存', memoryAvailable === null ? '未知' : formatPercent(memoryAvailable)],
      ['磁盘最高', formatPercent(maxDisk)],
      ['服务', `${summary.runningServices || 0} 正常 / ${summary.failedServices || 0} 异常`]
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
    if (!platforms.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='未识别到平台服务组' />
    return (
      <div className='server-status-platform-list'>
        {platforms.map(platform => (
          <details className='server-status-platform' key={platform.id} open={!compact || platform.status === 'critical'}>
            <summary>
              <strong>{platform.name}</strong>
              <span className='server-status-platform-tags'>
                <Tag>{platform.confidence === 'high' ? '高置信度' : platform.confidence === 'medium' ? '中置信度' : '低置信度'}</Tag>
                <Tag>{platform.services?.length || 0} 个服务</Tag>
                {platform.containers?.length ? <Tag>{platform.containers.length} 个容器</Tag> : null}
                {isDiagnosticTargetAbnormal(platform)
                  ? (
                    <Tooltip title='生成该异常平台的只读 AI 诊断计划'>
                      <Button size='small' disabled={loading} icon={<RobotOutlined />} onClick={event => { event.preventDefault(); event.stopPropagation(); openDiagnostic('platform', platform) }}>AI 诊断</Button>
                    </Tooltip>
                    )
                  : null}
              </span>
            </summary>
            <div className='server-status-evidence'>
              识别依据：{(platform.evidence || []).map(item => item.value || item.type).join('、') || '服务清单'}
            </div>
            {(platform.services || []).slice(0, compact ? 8 : 80).map(service => (
              <div className={`server-status-row ${isDiagnosticTargetAbnormal(service) ? 'has-diagnostic' : ''}`} key={service.name}>
                <span title={service.description}>{service.name}</span>
                <span>{service.activeState || service.subState || '未知'}</span>
                <span>{service.workingDirectory || service.fragmentPath || ''}</span>
                {isDiagnosticTargetAbnormal(service)
                  ? <Tooltip title='生成该异常服务的只读 AI 诊断计划'><Button size='small' type='text' disabled={loading} icon={<RobotOutlined />} onClick={() => openDiagnostic('service', service)}>AI 诊断</Button></Tooltip>
                  : null}
              </div>
            ))}
            {(platform.containers || []).slice(0, compact ? 5 : 50).map(container => (
              <div className={`server-status-row ${isDiagnosticTargetAbnormal(container) ? 'has-diagnostic' : ''}`} key={`${container.engine}-${container.name}`}>
                <span>{container.name}</span><span>{container.status}</span><span>{container.ports}</span>
                {isDiagnosticTargetAbnormal(container)
                  ? <Tooltip title='生成该异常容器的只读 AI 诊断计划'><Button size='small' type='text' disabled={loading} icon={<RobotOutlined />} onClick={() => openDiagnostic('container', container)}>AI 诊断</Button></Tooltip>
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
    if (!alerts.length) return <div className='server-status-empty-ok'>当前检测未发现明确异常。</div>
    return alerts.map((alert, index) => (
      <div className={`server-status-alert ${alert.status || 'warning'}`} key={`${alert.code}-${index}`}>
        {statusTag(alert.status)}<span>{alert.message || alert.target || alert.code}</span>
        {isDiagnosticTargetAbnormal({ status: 'warning', ...alert })
          ? <Tooltip title='生成该告警的只读 AI 诊断计划'><Button size='small' type='text' disabled={loading} icon={<RobotOutlined />} onClick={() => openDiagnostic('alert', alert)}>AI 诊断</Button></Tooltip>
          : null}
      </div>
    ))
  }

  function renderOverview () {
    const network = snapshot?.network || {}
    return (
      <div className='server-status-overview'>
        <section className='server-status-section'>
          <header>自动识别的平台与服务组</header>
          <div className='server-status-section-scroll'>{renderPlatformGroups(true)}</div>
        </section>
        <div className='server-status-overview-side'>
          <section className='server-status-section'>
            <header>网络与防火墙</header>
            <div className='server-status-compact-list'>
              {(network.interfaces || []).slice(0, 6).map(item => (
                <div className='server-status-row' key={item.name}>
                  <span>{item.name}</span><span>{(item.addresses || []).join(', ') || '无地址'}</span><span>{item.state}</span>
                </div>
              ))}
              <div className='server-status-row'><span>默认路由</span><span>{network.defaultRoute?.gateway || '未检测到'}</span><span>{network.defaultRoute?.interface || ''}</span></div>
              <div className='server-status-row'><span>防火墙</span><span>{snapshot.firewall?.provider || '未识别'}</span><span>{snapshot.firewall?.enabled ? '已启用' : '未启用'}</span></div>
            </div>
          </section>
          <section className='server-status-section'>
            <header>需要关注</header>
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
          <header>内存与负载</header>
          <div className='server-status-resource-block'>
            <div>内存：{formatBytes(memory.availableBytes)} 可用 / {formatBytes(memory.totalBytes)}</div>
            <Progress percent={memory.totalBytes ? Math.round((1 - memory.availableBytes / memory.totalBytes) * 100) : 0} size='small' />
            <div>Swap：{formatBytes((resources.swap?.totalBytes || 0) - (resources.swap?.freeBytes || 0))} 已用 / {formatBytes(resources.swap?.totalBytes)}</div>
            <div>负载：{resources.load?.one ?? '-'} / {resources.load?.five ?? '-'} / {resources.load?.fifteen ?? '-'}</div>
          </div>
        </section>
        <section className='server-status-section'>
          <header>磁盘与 inode</header>
          <div className='server-status-section-scroll'>
            {(resources.filesystems || []).map(item => (
              <div className='server-status-row' key={`${item.filesystem}-${item.mount}`}>
                <span>{item.mount}</span><span>{formatPercent(item.usedPercent)}</span><span>inode {formatPercent(item.inodeUsedPercent)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className='server-status-section server-status-span-two'>
          <header>资源占用较高的进程</header>
          <div className='server-status-section-scroll'>
            {(resources.processes || []).map(item => (
              <div className='server-status-row server-status-process-row' key={`${item.pid}-${item.command}`}>
                <span>{item.command}</span><span>PID {item.pid}</span><span>CPU {item.cpuPercent}% · 内存 {item.memoryPercent}%</span>
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
          <header>网卡与 IP</header>
          <div className='server-status-section-scroll'>
            {(network.interfaces || []).map(item => (
              <div className='server-status-row' key={item.name}><span>{item.name}</span><span>{(item.addresses || []).join(', ') || '无地址'}</span><span>{item.state}</span></div>
            ))}
          </div>
        </section>
        <section className='server-status-section'>
          <header>路由与 DNS</header>
          <div className='server-status-compact-list'>
            <div className='server-status-row'><span>网关</span><span>{network.defaultRoute?.gateway || '未检测到'}</span><span>{network.defaultRoute?.interface || ''}</span></div>
            <div className='server-status-row'><span>DNS</span><span>{(network.dnsServers || []).join(', ') || '未检测到'}</span><span /></div>
          </div>
        </section>
        <section className='server-status-section server-status-span-two'>
          <header>监听端口与进程</header>
          <div className='server-status-section-scroll'>
            {(network.listeningPorts || []).map((item, index) => (
              <div className='server-status-row' key={`${item.protocol}-${item.port}-${index}`}><span>{item.protocol.toUpperCase()} {item.address}:{item.port}</span><span>{item.process || '未知进程'}</span><span>{item.pid ? `PID ${item.pid}` : ''}</span></div>
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
          <header>防火墙</header>
          <div className='server-status-resource-block'>
            <div>类型：{firewall.provider || '未识别'}</div>
            <div>状态：{firewall.enabled ? '已启用' : '未启用或权限不足'}</div>
            <div>规则数量：{firewall.ruleCount ?? '未知'}</div>
          </div>
        </section>
        <section className='server-status-section'>
          <header>安全模块</header>
          <div className='server-status-resource-block'>
            <div>SELinux：{security.selinux || firewall.selinux || '未安装'}</div>
            <div>AppArmor：{security.appArmor || '未安装或权限不足'}</div>
            <div>当前登录：{security.loggedInUsers?.length || 0} 条会话</div>
          </div>
        </section>
        <section className='server-status-section server-status-span-two'>
          <header>近期失败登录</header>
          <pre className='server-status-pre'>{(security.failedLogins || []).join('\n') || '未检测到，或当前账号无读取权限。'}</pre>
        </section>
      </div>
    )
  }

  function renderContainers () {
    const containers = snapshot?.containers || []
    if (!containers.length) return <Empty description='未安装容器引擎，或当前账号无访问权限' />
    return (
      <section className='server-status-section server-status-full-section'>
        <header>Docker / Podman 容器</header>
        <div className='server-status-section-scroll'>
          {containers.map(item => (
            <div className={`server-status-row ${isDiagnosticTargetAbnormal(item) ? 'has-diagnostic' : ''}`} key={`${item.engine}-${item.name}`}>
              <span>{item.name}</span><span>{item.status}</span><span>{item.composeProject || item.image}</span>
              {isDiagnosticTargetAbnormal(item)
                ? <Tooltip title='生成该异常容器的只读 AI 诊断计划'><Button size='small' type='text' disabled={loading} icon={<RobotOutlined />} onClick={() => openDiagnostic('container', item)}>AI 诊断</Button></Tooltip>
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
            <pre className='server-status-pre'>{probe.rawOutput || probe.stderr || '无输出'}</pre>
          </details>
        ))}
      </div>
    )
  }

  const tabItems = snapshot
    ? [
        { key: 'overview', label: '总览', children: renderOverview() },
        { key: 'platforms', label: '平台与服务', children: renderPlatformGroups() },
        { key: 'resources', label: '资源', children: renderResources() },
        { key: 'network', label: '网络', children: renderNetwork() },
        { key: 'security', label: '防火墙与安全', children: renderSecurity() },
        { key: 'containers', label: '容器', children: renderContainers() },
        { key: 'raw', label: '原始结果', children: renderRawResults() }
      ]
    : []

  const probeCounts = (snapshot?.probes || []).reduce((result, probe) => {
    result[probe.status] = (result[probe.status] || 0) + 1
    return result
  }, {})

  return (
    <>
      <Modal
        title={<Space><DashboardOutlined />服务器状态中心</Space>}
        open={open}
        onCancel={onClose}
        footer={null}
        width={1180}
        destroyOnClose={false}
        className='server-status-modal'
      >
        <div className='server-status-toolbar'>
          <div className='server-status-endpoint'>
            {endpointUser(tab) ? `${endpointUser(tab)}@` : ''}{tab.host || '未连接'}:{tab.port || 22}
            {snapshot?.system?.hostname ? <span> · {snapshot.system.hostname}</span> : null}
          </div>
          <Space wrap>
            <Tooltip title='复制 Markdown 摘要'><Button icon={<CopyOutlined />} disabled={!snapshot} onClick={handleCopy}>复制结果</Button></Tooltip>
            <Button icon={<SettingOutlined />} onClick={() => setShowRules(true)}>识别规则</Button>
            <Button icon={<DownloadOutlined />} disabled={!snapshot} onClick={() => handleExport('markdown')}>导出 Markdown</Button>
            <Button icon={<DownloadOutlined />} disabled={!snapshot} onClick={() => handleExport('json')}>导出 JSON</Button>
            <Button icon={<RobotOutlined />} disabled={!snapshot} onClick={handleSendToAi}>发送给 AI</Button>
            <Button type='primary' icon={<ReloadOutlined />} loading={loading} onClick={scanCurrentServer}>刷新检测</Button>
          </Space>
        </div>
        {renderSummary()}
        <Spin spinning={loading} tip='正在执行只读检测，请稍候…'>
          <div className='server-status-content'>
            {!snapshot && !loading
              ? <Empty description='尚未获取服务器状态，点击“刷新检测”开始。' />
              : snapshot
                ? <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
                : <div className='server-status-loading-placeholder' />}
          </div>
        </Spin>
        {snapshot
          ? (
            <div className='server-status-footer'>
              <span>检测完成：{probeCounts.success || 0} 项成功，{probeCounts.permission || 0} 项权限受限，{(probeCounts.error || 0) + (probeCounts.timeout || 0)} 项失败；未执行任何修改命令。</span>
              <span>{new Date(snapshot.collectedAt).toLocaleString()}</span>
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
