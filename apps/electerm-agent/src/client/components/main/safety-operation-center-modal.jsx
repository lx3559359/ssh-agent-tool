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
  ReloadOutlined,
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
  getOperation,
  guardedPatchOperation,
  listOperations,
  listTasks
} from '../../common/safety-transactions/transaction-store.js'
import { executeSafetyCenterAction } from './safety-operation-center-actions.js'
import SafetyTaskProgress from './safety-task-progress.jsx'
import {
  buildSafetyRecordViewModel,
  buildSafetyRecoveryIntegrityResults,
  createSafetyActionLock,
  filterSafetyCenterRecords,
  findMatchingSafetySftp,
  findMatchingSafetyTerminal,
  getLegacySafetyRecord,
  getLegacyClaimStatus,
  groupSafetyCenterRecords,
  isSafetyOperationRollbackable,
  isSafetyOperationRunning,
  isLegacyOperationActionable,
  safetyOperationStatusPresentations,
  safetyTaskStatusPresentations,
  safetyRecordActionLockKey,
  subscribeSafetyCenterRefresh
} from './safety-operation-center-model.js'
import './safety-operation-center-modal.styl'

export { groupSafetyCenterRecords }

const e = window.translate

const sourceLabelKeys = {
  terminal: 'shellpilotSafetySourceTerminal',
  agent: 'shellpilotSafetySourceAgent',
  'quick-command': 'shellpilotSafetySourceQuickCommand',
  'server-status': 'shellpilotSafetySourceServerStatus',
  sftp: 'shellpilotSafetySourceSftp'
}

const sourceColors = {
  terminal: 'blue',
  agent: 'purple',
  'quick-command': 'orange',
  'server-status': 'cyan',
  sftp: 'geekblue'
}

const providerLabelKeys = {
  file: 'shellpilotSafetyProviderFile',
  permissions: 'shellpilotSafetyProviderPermissions',
  systemd: 'shellpilotSafetyProviderSystemd',
  firewall: 'shellpilotSafetyProviderFirewall',
  network: 'shellpilotSafetyProviderNetwork',
  docker: 'shellpilotSafetyProviderContainer',
  sftp: 'shellpilotSafetyProviderSftp',
  无: 'shellpilotNone'
}

const statusLabels = {
  ...safetyOperationStatusPresentations,
  ...safetyTaskStatusPresentations
}
const statusLabelKeys = {
  preparing: 'shellpilotSafetyStatusPreparing',
  'recovery-ready': 'shellpilotSafetyStatusRecoveryReady',
  'awaiting-confirmation': 'shellpilotSafetyStatusAwaitingConfirmation',
  executing: 'shellpilotSafetyStatusExecuting',
  'verification-passed': 'shellpilotSafetyStatusVerified',
  'rollback-available': 'shellpilotSafetyStatusRollbackAvailable',
  kept: 'shellpilotSafetyStatusKept',
  'rolling-back': 'shellpilotSafetyStatusRollingBack',
  restored: 'shellpilotSafetyStatusRestored',
  failed: 'shellpilotSafetyStatusFailed',
  cancelled: 'shellpilotSafetyStatusCancelled',
  draft: 'shellpilotSafetyStatusDraft',
  'awaiting-plan-confirmation': 'shellpilotSafetyStatusAwaitingPlan',
  'running-readonly': 'shellpilotSafetyStatusRunningReadonly',
  'awaiting-change-confirmation': 'shellpilotSafetyStatusAwaitingChange',
  'running-change': 'shellpilotSafetyStatusRunningChange',
  completed: 'shellpilotSafetyStatusCompleted',
  'partially-completed': 'shellpilotSafetyStatusPartiallyCompleted'
}

const actionLabels = {
  rollback: {
    title: 'shellpilotSafetyConfirmRollback',
    ok: 'shellpilotSafetyRollbackNow',
    success: 'shellpilotSafetyRollbackComplete'
  },
  keep: {
    title: 'shellpilotSafetyConfirmKeep',
    ok: 'shellpilotSafetyKeepChanges',
    success: 'shellpilotSafetyChangesKept'
  },
  cancel: {
    title: 'shellpilotSafetyConfirmCancelTask',
    ok: 'shellpilotSafetyCancelTask',
    success: 'shellpilotSafetyCancelSubmitted'
  }
}
const timelineLabelKeys = {
  已创建: 'shellpilotSafetyTimelineCreated',
  恢复点已就绪: 'shellpilotSafetyStatusRecoveryReady',
  已验证: 'shellpilotSafetyTimelineVerified',
  准备阶段: 'shellpilotSafetyTimelinePreparePhase',
  执行阶段: 'shellpilotSafetyTimelineExecutePhase',
  回滚阶段: 'shellpilotSafetyTimelineRollbackPhase',
  验证阶段: 'shellpilotSafetyTimelineVerifyPhase',
  取消阶段: 'shellpilotSafetyTimelineCancelPhase',
  只读阶段: 'shellpilotSafetyTimelineReadonlyPhase',
  已更新: 'shellpilotSafetyTimelineUpdated'
}
const verificationLabelKeys = {
  验证通过: 'shellpilotSafetyVerificationPassed',
  验证失败: 'shellpilotSafetyVerificationFailed',
  暂无验证结果: 'shellpilotSafetyVerificationMissing'
}

function formatTime (value) {
  const date = new Date(value)
  const language = window.store?.previewLanguage || window.store?.config?.language || 'zh_cn'
  return Number.isNaN(date.getTime())
    ? e('shellpilotUnknownTime')
    : date.toLocaleString(language === 'en_us' ? 'en-US' : 'zh-CN')
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
      title: e(labels.title),
      content: (
        <div className='safety-center-confirm-content'>
          <strong>{view.title}</strong>
          <span>{view.endpoint}</span>
          <code>{view.commandSummary}</code>
          {view.error ? <span>{view.error}</span> : null}
        </div>
      ),
      okText: e(labels.ok),
      cancelText: e('cancel'),
      okButtonProps: { danger: action !== 'keep' },
      onOk: () => finish(true),
      onCancel: () => finish(false)
    })
  })
}

export default function SafetyOperationCenterModal ({ open, onClose, store }) {
  const [records, setRecords] = useState([])
  const [tasks, setTasks] = useState([])
  const [integrityResults, setIntegrityResults] = useState(() => new Map())
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
  const actionLock = useRef()
  if (!actionLock.current) {
    actionLock.current = createSafetyActionLock(setRunningKeys)
  }

  const refreshRecords = useCallback(async () => {
    const version = ++refreshVersion.current
    setIntegrityResults(new Map())
    setLoading(true)
    try {
      const [nextRecords, nextTasks] = await Promise.all([
        listOperations(),
        listTasks()
      ])
      const safeRecords = Array.isArray(nextRecords) ? nextRecords : []
      const nextIntegrityResults = await buildSafetyRecoveryIntegrityResults(safeRecords)
      if (version !== refreshVersion.current) return
      setRecords(safeRecords)
      setTasks(Array.isArray(nextTasks) ? nextTasks : [])
      setIntegrityResults(nextIntegrityResults)
      setLoadError('')
    } catch (error) {
      if (version !== refreshVersion.current) return
      setLoadError('安全记录加载失败。')
      reportError(error)
    } finally {
      if (version === refreshVersion.current) {
        setLoading(false)
      }
    }
  }, [])

  const groups = useMemo(() => {
    return groupSafetyCenterRecords(records, tasks, integrityResults)
  }, [records, tasks, integrityResults])

  useEffect(() => {
    if (open) refreshRecords()
  }, [open, refreshRecords])

  useEffect(() => {
    if (!open) return
    return subscribeSafetyCenterRefresh({
      eventTarget: window,
      refresh: refreshRecords
    })
  }, [open, refreshRecords])

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

  const findOperationCapability = record => {
    if (record.effect?.adapter === 'sftp') {
      return findMatchingSafetySftp(
        record,
        tabIdsFor(record),
        tabId => refs.get('sftp-' + tabId)
      )
    }
    return findOperationTerminal(record)
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

  const resolveLegacyTarget = async (record) => {
    const legacy = getLegacySafetyRecord(record)
    if (!legacy) return undefined
    if (record.source === 'sftp') {
      const entry = findLegacySftpEntry(record)
      return entry?.sftp ? { type: 'sftp', entry } : undefined
    }
    if (record.source === 'quick-command') {
      const terminal = findSafetyOperationSession(
        legacy,
        tabIdsFor(record),
        tabId => refs.get('term-' + tabId)
      )
      return terminal ? { type: 'quick-command', terminal } : undefined
    }
  }

  const runLegacyAction = async (record, action, target) => {
    const legacy = getLegacySafetyRecord(record)
    if (!legacy) throw new Error('旧版恢复记录无效。')
    if (target.type === 'sftp') {
      return target.entry.restoreSftpRecord(legacy)
    }
    if (target.type !== 'quick-command') throw new Error('旧版恢复会话无效。')
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const output = await runCmd(
      target.terminal.pid,
      buildVerifiedQuickCommandRollbackAction(legacy, action, token)
    )
    assertVerifiedQuickCommandRollbackResult(output, token)
    return true
  }

  const handleSafetyAction = (record, action) => {
    const key = safetyRecordActionLockKey(record)
    actionLock.current.run(key, async () => {
      setRunningActions(current => ({ ...current, [key]: action }))
      try {
        const view = buildSafetyRecordViewModel(record, integrityResults)
        if (!await confirmSafetyAction(action, view)) return
        try {
          await executeSafetyCenterAction({
            record,
            action,
            getOperation,
            guardedPatchOperation,
            syncLegacyOperation: async id => {
              await listOperations()
              return getOperation(id)
            },
            resolveLegacyTarget,
            runLegacyAction,
            findModernCapability: findOperationCapability,
            taskCapability: getTaskCancelCapability(record)
          })
          message.success(e(actionLabels[action].success))
        } catch (error) {
          reportError(error)
          message.error(e('shellpilotSafetyActionFailed'))
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
      if (!isLegacyOperationActionable(record)) return null
      const staleClaim = getLegacyClaimStatus(record) === 'stale'
      if (record.source === 'sftp') {
        return (
          <Button
            icon={<UndoOutlined />}
            loading={isActionRunning(record, 'rollback')}
            disabled={busy || record.metadata?.legacyEndpointIncomplete}
            onClick={() => handleSafetyAction(record, 'rollback')}
          >
            {staleClaim
              ? e('shellpilotSafetyTakeOverRetry')
              : record.state === 'failed'
                ? e('shellpilotSafetyRetryRestore')
                : e('shellpilotSafetyRestoreNow')}
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
            {staleClaim ? e('shellpilotSafetyTakeOverKeep') : e('shellpilotSafetyKeepChanges')}
          </Button>
          <Button
            danger
            type='primary'
            icon={<UndoOutlined />}
            loading={isActionRunning(record, 'rollback')}
            disabled={busy || record.metadata?.legacyEndpointIncomplete}
            onClick={() => handleSafetyAction(record, 'rollback')}
          >
            {staleClaim
              ? e('shellpilotSafetyTakeOverRetry')
              : record.state === 'failed'
                ? e('shellpilotSafetyRetryRollback')
                : e('shellpilotSafetyRollbackNow')}
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
          {e('shellpilotSafetyCancelTask')}
        </Button>
      )
    }
    if (!isSafetyOperationRollbackable(record, integrityResults)) return null
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
              {e('shellpilotSafetyKeepChanges')}
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
          {record.state === 'failed'
            ? e('shellpilotSafetyRetryRollback')
            : e('shellpilotSafetyRollbackNow')}
        </Button>
      </Space>
    )
  }

  const renderAudit = view => {
    return view.audit.map(entry => {
      const code = entry.code === null ? '' : `，${e('shellpilotExitCode')} ${entry.code}`
      const phaseKey = {
        prepare: 'shellpilotSafetyAuditPrepare',
        execute: 'shellpilotSafetyAuditExecute',
        rollback: 'shellpilotSafetyAuditRollback',
        verify: 'shellpilotSafetyAuditVerify',
        cancel: 'shellpilotSafetyAuditCancel',
        readonly: 'shellpilotSafetyAuditReadonly'
      }[entry.phase]
      return `${formatTime(entry.timestamp)} [${phaseKey ? e(phaseKey) : e('shellpilotSafetyAudit')}${code}]\n${entry.preview}`
    }).join('\n\n')
  }

  const renderOperation = record => {
    const view = buildSafetyRecordViewModel(record, integrityResults)
    const [, statusColor] = statusLabels[view.status] || [view.status, 'default']
    const statusText = statusLabelKeys[view.status]
      ? e(statusLabelKeys[view.status])
      : view.status
    const auditExpanded = expandedAuditId === record.id
    return (
      <article className='safety-center-record' key={record.id}>
        <div className='safety-center-record-header'>
          <div className='safety-center-record-title'>
            <Tag color={sourceColors[view.source] || 'default'}>
              {sourceLabelKeys[view.source] ? e(sourceLabelKeys[view.source]) : view.source}
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
          <span className='safety-center-label'>{e('shellpilotSafetyServer')}</span>
          <span>{view.endpoint}</span>
          <span className='safety-center-label'>{e('shellpilotSafetyRecoveryType')}</span>
          <span>{providerLabelKeys[view.provider] ? e(providerLabelKeys[view.provider]) : view.provider}</span>
          {view.effectAction
            ? <><span className='safety-center-label'>{e('shellpilotSafetySftpEffect')}</span><span>{view.effectAdapter} / {view.effectAction}</span></>
            : null}
          {view.resourcePaths.length
            ? <><span className='safety-center-label'>{e('shellpilotSafetyResourcePaths')}</span><span className='safety-center-path'>{view.resourcePaths.join('；')}</span></>
            : null}
          {view.artifactPaths.length
            ? <><span className='safety-center-label'>{e('shellpilotSafetyRecoveryArtifacts')}</span><span className='safety-center-path'>{view.artifactPaths.join('；')}</span></>
            : null}
          <span className='safety-center-label'>{e('shellpilotSafetyCreatedAt')}</span>
          <span>{formatTime(view.createdAt)}</span>
          <span className='safety-center-label'>{e('shellpilotSafetyVerificationResult')}</span>
          <span>{verificationLabelKeys[view.verification]
            ? e(verificationLabelKeys[view.verification])
            : view.verification}
          </span>
          {view.backupPath
            ? <><span className='safety-center-label'>{e('shellpilotSafetyBackupPath')}</span><span className='safety-center-path'>{view.backupPath}</span></>
            : null}
          {view.recoveryPath
            ? <><span className='safety-center-label'>{e('shellpilotSafetyRecoveryPath')}</span><span className='safety-center-path'>{view.recoveryPath}</span></>
            : null}
        </div>

        <div className='safety-center-timeline' aria-label={e('shellpilotSafetyTimeline')}>
          {view.timeline.map((item, index) => (
            <span className='safety-center-timeline-item' key={`${item.timestamp}-${index}`}>
              {timelineLabelKeys[item.label] ? e(timelineLabelKeys[item.label]) : item.label} · {formatTime(item.timestamp)}
            </span>
          ))}
        </div>
        {view.error
          ? <div className='safety-center-record-error'>{e('shellpilotError')}：{view.error}</div>
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
                {e('shellpilotSafetyAuditOutput')}（{view.auditCount}）
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
    const taskProgress = (
      <SafetyTaskProgress
        key={record.id}
        task={record}
        canCancel={capability.canCancel}
        cancelling={isActionRunning(record, 'cancel')}
        onCancel={() => handleSafetyAction(record, 'cancel')}
      />
    )
    return record.riskTransaction
      ? <div className='safety-center-agent-risk-record'>{taskProgress}</div>
      : taskProgress
  }

  const tabItems = [
    ['running', 'shellpilotSafetyRunning'],
    ['rollback', 'shellpilotSafetyRollbackAvailable'],
    ['history', 'shellpilotSafetyHistory'],
    ['legacy', 'shellpilotSafetyLegacy']
  ].map(([key, labelKey]) => ({
    key,
    label: `${e(labelKey)} ${groups[key].length}`
  }))

  return (
    <Modal
      title={<Space><SafetyCertificateOutlined />{e('shellpilotSftpSafetyCenter')}</Space>}
      open={open}
      onCancel={onClose}
      footer={null}
      width={1040}
      destroyOnClose={false}
      className='safety-operation-center-modal'
    >
      <div className='safety-center-summary'>
        <span>{e('shellpilotSafetyRunning')} <strong>{groups.running.length}</strong></span>
        <span>{e('shellpilotSafetyRollbackAvailable')} <strong>{groups.rollback.length}</strong></span>
        <span>{e('shellpilotSafetyHistoryShort')} <strong>{groups.history.length}</strong></span>
        <span>{e('shellpilotSafetyLegacyShort')} <strong>{groups.legacy.length}</strong></span>
      </div>

      <Tabs
        className='safety-center-tabs'
        activeKey={activeTab}
        items={tabItems}
        onChange={setActiveTab}
      />
      <div className='safety-center-filters'>
        <Input.Search
          placeholder={e('shellpilotSafetySearchPlaceholder')}
          allowClear
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
        />
        <Select
          aria-label={e('shellpilotSafetyServer')}
          value={host}
          onChange={setHost}
          options={[
            { value: '', label: e('shellpilotSafetyAllServers') },
            ...hosts.map(value => ({ value, label: value }))
          ]}
        />
        <Select
          aria-label={e('shellpilotSafetySource')}
          value={source}
          onChange={setSource}
          options={[
            { value: '', label: e('shellpilotSafetyAllSources') },
            ...Object.entries(sourceLabelKeys).map(([value, labelKey]) => ({ value, label: e(labelKey) }))
          ]}
        />
        <Select
          aria-label={e('shellpilotSafetyStatus')}
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: e('shellpilotSafetyAllStatuses') },
            ...statuses.map(value => ({
              value,
              label: statusLabelKeys[value] ? e(statusLabelKeys[value]) : value
            }))
          ]}
        />
        <Button
          aria-label={e('refresh')}
          title={e('refresh')}
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={refreshRecords}
        />
      </div>

      <div className='safety-center-records'>
        <div className='safety-center-record-list'>
          {loading
            ? <div className='safety-center-loading'><Spin /></div>
            : filteredRecords.length
              ? filteredRecords.map(renderRecord)
              : <Empty description={loadError || e('shellpilotSafetyNoRecords')} />}
        </div>
      </div>
    </Modal>
  )
}
