import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tabs,
  Tag
} from 'antd'
import {
  CheckOutlined,
  CloseOutlined,
  DownOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  UndoOutlined
} from '@ant-design/icons'
import { refs } from '../common/ref'
import { runCmd } from '../terminal/terminal-apis'
import message from '../common/message'
import {
  assertVerifiedQuickCommandRollbackResult,
  buildVerifiedQuickCommandRollbackAction,
  findSafetyOperationSession,
  matchesSafetyOperationEndpoint
} from '../../common/safety-operation-records'
import {
  listOperations,
  listTasks,
  patchOperation
} from '../../common/safety-transactions/transaction-store.js'
import SafetyTaskProgress from './safety-task-progress.jsx'
import {
  buildSafetyRecordViewModel,
  createSafetyActionLock,
  filterSafetyCenterRecords,
  findMatchingSafetyTerminal,
  getLegacySafetyRecord,
  groupSafetyCenterRecords,
  isSafetyOperationRollbackable,
  isSafetyOperationRunning,
  routeSafetyCenterAction,
  safetyOperationStatusPresentations,
  safetyTaskStatusPresentations,
  safetyRecordActionLockKey,
  subscribeSafetyCenterRefresh
} from './safety-operation-center-model.js'
import './safety-operation-center-modal.styl'

export { groupSafetyCenterRecords }

const sourceLabels = {
  terminal: 'SSH 终端',
  agent: 'AI 助手',
  'quick-command': '快捷命令',
  'server-status': '服务器状态',
  sftp: 'SFTP 文件'
}

const sourceColors = {
  terminal: 'blue',
  agent: 'purple',
  'quick-command': 'orange',
  'server-status': 'cyan',
  sftp: 'geekblue'
}

const providerLabels = {
  file: '文件',
  permissions: '权限与属主',
  systemd: 'systemd 服务',
  firewall: '防火墙',
  network: '网络',
  docker: '容器',
  无: '无'
}

const statusLabels = {
  ...safetyOperationStatusPresentations,
  ...safetyTaskStatusPresentations
}

const actionLabels = {
  rollback: {
    title: '确认立即回滚',
    ok: '立即回滚',
    success: '回滚已完成。'
  },
  keep: {
    title: '确认保留修改',
    ok: '保留修改',
    success: '修改已保留。'
  },
  cancel: {
    title: '确认取消任务',
    ok: '取消任务',
    success: '取消请求已提交。'
  }
}

function formatTime (value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '未知时间' : date.toLocaleString('zh-CN')
}

function recordStatus (record) {
  return record.recordType === 'task' ? record.status : record.state
}

function reportError (error) {
  try {
    window.store?.onError?.(error)
  } catch {}
}

function confirmSafetyAction (action, view) {
  const labels = actionLabels[action]
  return new Promise(resolve => {
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      resolve(value)
    }
    Modal.confirm({
      title: labels.title,
      content: (
        <div className='safety-center-confirm-content'>
          <strong>{view.title}</strong>
          <span>{view.endpoint}</span>
          <code>{view.commandSummary}</code>
        </div>
      ),
      okText: labels.ok,
      cancelText: '取消',
      okButtonProps: { danger: action !== 'keep' },
      onOk: () => finish(true),
      onCancel: () => finish(false)
    })
  })
}

export default function SafetyOperationCenterModal ({ open, onClose, store }) {
  const [records, setRecords] = useState([])
  const [tasks, setTasks] = useState([])
  const [activeTab, setActiveTab] = useState('running')
  const [keyword, setKeyword] = useState('')
  const [host, setHost] = useState('')
  const [source, setSource] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [runningKeys, setRunningKeys] = useState([])
  const [runningActions, setRunningActions] = useState({})
  const [expandedAuditId, setExpandedAuditId] = useState('')
  const refreshVersion = useRef(0)
  const loaded = useRef(false)
  const actionLock = useRef()
  if (!actionLock.current) {
    actionLock.current = createSafetyActionLock(setRunningKeys)
  }

  const refreshRecords = useCallback(async () => {
    const version = ++refreshVersion.current
    if (!loaded.current) setLoading(true)
    try {
      const [nextRecords, nextTasks] = await Promise.all([
        listOperations(),
        listTasks()
      ])
      if (version !== refreshVersion.current) return
      setRecords(Array.isArray(nextRecords) ? nextRecords : [])
      setTasks(Array.isArray(nextTasks) ? nextTasks : [])
      setLoadError('')
    } catch (error) {
      if (version !== refreshVersion.current) return
      setLoadError('安全记录加载失败。')
      reportError(error)
    } finally {
      if (version === refreshVersion.current) {
        loaded.current = true
        setLoading(false)
      }
    }
  }, [])

  const groups = useMemo(() => {
    return groupSafetyCenterRecords(records, tasks)
  }, [records, tasks])
  const hasRunning = groups.running.length > 0

  useEffect(() => {
    if (open) refreshRecords()
  }, [open, refreshRecords])

  useEffect(() => {
    if (!open) return
    return subscribeSafetyCenterRefresh({
      eventTarget: window,
      refresh: refreshRecords,
      hasRunning
    })
  }, [open, hasRunning, refreshRecords])

  const allRecords = useMemo(() => {
    return Object.values(groups).flat()
  }, [groups])

  const hosts = useMemo(() => {
    return [...new Set(allRecords.map(record => {
      return record.endpoint?.host || getLegacySafetyRecord(record)?.host || ''
    }).filter(Boolean))].sort()
  }, [allRecords])

  const statuses = useMemo(() => {
    return [...new Set(allRecords.map(recordStatus).filter(Boolean))].sort((left, right) => {
      const leftLabel = statusLabels[left]?.[0] || left
      const rightLabel = statusLabels[right]?.[0] || right
      return leftLabel.localeCompare(rightLabel, 'zh-CN')
    })
  }, [allRecords])

  const filteredRecords = useMemo(() => {
    return filterSafetyCenterRecords(groups[activeTab] || [], {
      keyword,
      host,
      source,
      status
    })
  }, [groups, activeTab, keyword, host, source, status])

  const tabIdsFor = record => {
    const tabIds = Array.isArray(store.tabs) ? store.tabs.map(tab => tab.id) : []
    return [
      record.endpoint?.tabId,
      getLegacySafetyRecord(record)?.tabId,
      store.activeTabId,
      store.currentTab?.id,
      ...tabIds
    ].filter(Boolean)
  }

  const findOperationTerminal = record => {
    return findMatchingSafetyTerminal(
      record,
      tabIdsFor(record),
      tabId => refs.get('term-' + tabId)
    )
  }

  const findLegacySftpEntry = record => {
    const legacy = getLegacySafetyRecord(record)
    if (!legacy || record.metadata?.legacyEndpointIncomplete) return undefined
    return tabIdsFor(record).map(tabId => refs.get('sftp-' + tabId)).find(entry => {
      return entry?.sftp && matchesSafetyOperationEndpoint(
        legacy,
        entry.props?.tab || {},
        true
      )
    })
  }

  const getTaskCancelCapability = task => {
    const capability = store.safetyTaskCapability
    const cancel = typeof capability?.cancel === 'function'
      ? capability.cancel.bind(capability)
      : null
    let allowed = capability?.canCancel === true
    if (typeof capability?.canCancel === 'function') {
      try {
        allowed = capability.canCancel(task) === true
      } catch {
        allowed = false
      }
    }
    return {
      canCancel: Boolean(allowed && cancel),
      cancel: cancel || undefined
    }
  }

  const executeLegacyAction = async (record, action) => {
    const legacy = getLegacySafetyRecord(record)
    if (!legacy || record.metadata?.legacyEndpointIncomplete) {
      throw new Error('旧版记录的服务器端点不完整，无法安全恢复。')
    }

    let execute
    if (record.source === 'sftp') {
      if (action !== 'rollback') throw new Error('旧版 SFTP 记录不支持保留动作。')
      const entry = findLegacySftpEntry(record)
      if (!entry?.sftp) throw new Error('未找到端点匹配的活动 SFTP 会话。')
      execute = () => entry.restoreSftpRecord(legacy)
    } else if (record.source === 'quick-command') {
      const terminal = findSafetyOperationSession(
        legacy,
        tabIdsFor(record),
        tabId => refs.get('term-' + tabId)
      )
      if (!terminal) throw new Error('未找到端点匹配的活动 SSH 终端。')
      execute = async () => {
        const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const output = await runCmd(
          terminal.pid,
          buildVerifiedQuickCommandRollbackAction(legacy, action, token)
        )
        assertVerifiedQuickCommandRollbackResult(output, token)
      }
    } else {
      throw new Error('该旧版记录没有可用的恢复入口。')
    }

    try {
      await execute()
    } catch (error) {
      try {
        await patchOperation(record.id, {
          state: 'failed',
          error: error?.message || String(error),
          failedAt: new Date().toISOString()
        })
      } catch (patchError) {
        reportError(patchError)
      }
      throw error
    }

    await patchOperation(record.id, {
      state: action === 'rollback' ? 'restored' : 'kept',
      completedAt: new Date().toISOString()
    })
  }

  const handleSafetyAction = (record, action) => {
    const key = safetyRecordActionLockKey(record)
    actionLock.current.run(key, async () => {
      setRunningActions(current => ({ ...current, [key]: action }))
      try {
        const view = buildSafetyRecordViewModel(record)
        if (!await confirmSafetyAction(action, view)) return
        try {
          if (getLegacySafetyRecord(record)) {
            await executeLegacyAction(record, action)
          } else if (record.recordType === 'task') {
            await routeSafetyCenterAction({
              action,
              record,
              taskCapability: getTaskCancelCapability(record)
            })
          } else {
            const terminal = findOperationTerminal(record)
            if (!terminal) throw new Error('未找到与安全操作端点完全匹配的活动 SSH 终端。')
            await routeSafetyCenterAction({ action, record, terminal })
          }
          message.success(actionLabels[action].success)
        } catch (error) {
          reportError(error)
          message.error('操作失败，详情已写入工具日志。')
        } finally {
          await refreshRecords()
        }
      } finally {
        setRunningActions(current => {
          if (current[key] !== action) return current
          const next = { ...current }
          delete next[key]
          return next
        })
      }
    }).catch(reportError)
  }

  const isRecordBusy = record => {
    return runningKeys.includes(safetyRecordActionLockKey(record))
  }

  const isActionRunning = (record, action) => {
    return runningActions[safetyRecordActionLockKey(record)] === action
  }

  const renderOperationActions = record => {
    const busy = isRecordBusy(record)
    if (getLegacySafetyRecord(record)) {
      if (!['rollback-available', 'failed'].includes(record.state)) return null
      if (record.source === 'sftp') {
        return (
          <Button
            icon={<UndoOutlined />}
            loading={isActionRunning(record, 'rollback')}
            disabled={busy || record.metadata?.legacyEndpointIncomplete}
            onClick={() => handleSafetyAction(record, 'rollback')}
          >
            {record.state === 'failed' ? '重试恢复' : '立即恢复'}
          </Button>
        )
      }
      if (record.source !== 'quick-command') return null
      return (
        <Space wrap>
          <Button
            icon={<CheckOutlined />}
            loading={isActionRunning(record, 'keep')}
            disabled={busy || record.metadata?.legacyEndpointIncomplete}
            onClick={() => handleSafetyAction(record, 'keep')}
          >
            保留修改
          </Button>
          <Button
            danger
            type='primary'
            icon={<UndoOutlined />}
            loading={isActionRunning(record, 'rollback')}
            disabled={busy || record.metadata?.legacyEndpointIncomplete}
            onClick={() => handleSafetyAction(record, 'rollback')}
          >
            {record.state === 'failed' ? '重试回滚' : '立即回滚'}
          </Button>
        </Space>
      )
    }

    if (isSafetyOperationRunning(record)) {
      return (
        <Button
          danger
          icon={<CloseOutlined />}
          loading={isActionRunning(record, 'cancel')}
          disabled={busy}
          onClick={() => handleSafetyAction(record, 'cancel')}
        >
          取消任务
        </Button>
      )
    }
    if (!isSafetyOperationRollbackable(record)) return null
    return (
      <Space wrap>
        {record.state === 'rollback-available'
          ? (
            <Button
              icon={<CheckOutlined />}
              loading={isActionRunning(record, 'keep')}
              disabled={busy}
              onClick={() => handleSafetyAction(record, 'keep')}
            >
              保留修改
            </Button>
            )
          : null}
        <Button
          danger
          type='primary'
          icon={<UndoOutlined />}
          loading={isActionRunning(record, 'rollback')}
          disabled={busy}
          onClick={() => handleSafetyAction(record, 'rollback')}
        >
          {record.state === 'failed' ? '重试回滚' : '立即回滚'}
        </Button>
      </Space>
    )
  }

  const renderAudit = view => {
    return view.audit.map(entry => {
      const code = entry.code === null ? '' : `，退出码 ${entry.code}`
      return `${formatTime(entry.timestamp)} [${entry.phaseLabel || '审计'}${code}]\n${entry.preview}`
    }).join('\n\n')
  }

  const renderOperation = record => {
    const view = buildSafetyRecordViewModel(record)
    const [statusText, statusColor] = statusLabels[view.status] || [view.status, 'default']
    const auditExpanded = expandedAuditId === record.id
    return (
      <article className='safety-center-record' key={record.id}>
        <div className='safety-center-record-header'>
          <div className='safety-center-record-title'>
            <Tag color={sourceColors[view.source] || 'default'}>
              {sourceLabels[view.source] || view.source}
            </Tag>
            <strong>{view.title}</strong>
            <Tag color={statusColor}>{statusText}</Tag>
          </div>
          <div className='safety-center-record-actions'>
            {renderOperationActions(record)}
          </div>
        </div>

        <code className='safety-center-command' title={view.commandSummary}>
          {view.commandSummary}
        </code>
        <div className='safety-center-record-grid'>
          <span className='safety-center-label'>服务器</span>
          <span>{view.endpoint}</span>
          <span className='safety-center-label'>恢复类型</span>
          <span>{providerLabels[view.provider] || view.provider}</span>
          <span className='safety-center-label'>创建时间</span>
          <span>{formatTime(view.createdAt)}</span>
          <span className='safety-center-label'>验证结果</span>
          <span>{view.verification}</span>
          {view.backupPath
            ? <><span className='safety-center-label'>备份路径</span><span className='safety-center-path'>{view.backupPath}</span></>
            : null}
          {view.recoveryPath
            ? <><span className='safety-center-label'>恢复路径</span><span className='safety-center-path'>{view.recoveryPath}</span></>
            : null}
        </div>

        <div className='safety-center-timeline' aria-label='状态时间线'>
          {view.timeline.map((item, index) => (
            <span className='safety-center-timeline-item' key={`${item.timestamp}-${index}`}>
              {item.label} · {formatTime(item.timestamp)}
            </span>
          ))}
        </div>
        {view.error
          ? <div className='safety-center-record-error'>错误：{view.error}</div>
          : null}
        {view.auditCount
          ? (
            <div className='safety-center-audit'>
              <Button
                type='link'
                size='small'
                icon={auditExpanded ? <DownOutlined /> : <RightOutlined />}
                onClick={() => setExpandedAuditId(auditExpanded ? '' : record.id)}
              >
                审计输出（{view.auditCount}）
              </Button>
              {auditExpanded
                ? <pre className='safety-center-audit-output'>{renderAudit(view)}</pre>
                : null}
            </div>
            )
          : null}
      </article>
    )
  }

  const renderRecord = record => {
    if (record.recordType !== 'task') return renderOperation(record)
    const capability = getTaskCancelCapability(record)
    return (
      <SafetyTaskProgress
        key={record.id}
        task={record}
        canCancel={capability.canCancel}
        cancelling={isActionRunning(record, 'cancel')}
        onCancel={() => handleSafetyAction(record, 'cancel')}
      />
    )
  }

  const tabItems = [
    ['running', '执行中'],
    ['rollback', '可回滚'],
    ['history', '历史记录'],
    ['legacy', '旧版记录']
  ].map(([key, label]) => ({
    key,
    label: `${label} ${groups[key].length}`
  }))

  return (
    <Modal
      title={<Space><SafetyCertificateOutlined />安全操作中心</Space>}
      open={open}
      onCancel={onClose}
      footer={null}
      width={1040}
      destroyOnClose={false}
      className='safety-operation-center-modal'
    >
      <div className='safety-center-summary'>
        <span>执行中 <strong>{groups.running.length}</strong></span>
        <span>可回滚 <strong>{groups.rollback.length}</strong></span>
        <span>历史 <strong>{groups.history.length}</strong></span>
        <span>旧版 <strong>{groups.legacy.length}</strong></span>
      </div>

      <Tabs
        className='safety-center-tabs'
        activeKey={activeTab}
        items={tabItems}
        onChange={setActiveTab}
      />
      <div className='safety-center-filters'>
        <Input.Search
          placeholder='搜索命令、路径或服务器'
          allowClear
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
        />
        <Select
          aria-label='服务器'
          value={host}
          onChange={setHost}
          options={[
            { value: '', label: '全部服务器' },
            ...hosts.map(value => ({ value, label: value }))
          ]}
        />
        <Select
          aria-label='来源'
          value={source}
          onChange={setSource}
          options={[
            { value: '', label: '全部来源' },
            ...Object.entries(sourceLabels).map(([value, label]) => ({ value, label }))
          ]}
        />
        <Select
          aria-label='状态'
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: '全部状态' },
            ...statuses.map(value => ({
              value,
              label: statusLabels[value]?.[0] || value
            }))
          ]}
        />
      </div>

      <div className='safety-center-records'>
        <div className='safety-center-record-list'>
          {loading
            ? <div className='safety-center-loading'><Spin /></div>
            : filteredRecords.length
              ? filteredRecords.map(renderRecord)
              : <Empty description={loadError || '暂无符合条件的安全记录'} />}
        </div>
      </div>
    </Modal>
  )
}
