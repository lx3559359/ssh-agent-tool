import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Input, Modal, Select, Space, Tag } from 'antd'
import {
  CheckOutlined,
  SafetyCertificateOutlined,
  UndoOutlined
} from '@ant-design/icons'
import { refs } from '../common/ref'
import { runCmd } from '../terminal/terminal-apis'
import message from '../common/message'
import * as ls from '../../common/safe-local-storage'
import {
  assertVerifiedQuickCommandRollbackResult,
  buildVerifiedQuickCommandRollbackAction,
  filterSafetyOperationRecords,
  findSafetyOperationSession,
  matchesSafetyOperationEndpoint,
  readSafetyOperationRecords,
  safetyOperationUpdatedEvent,
  updateSafetyOperationRecord,
  writeSafetyOperationRecords
} from '../../common/safety-operation-records'
import './safety-operation-center-modal.styl'

const sourceLabels = {
  sftp: 'SFTP 文件',
  'quick-command': '服务器修改'
}

const kindLabels = {
  backup: '快捷备份',
  trash: '安全删除',
  rename: '重命名',
  chmod: '权限修改',
  'server-change': '服务器修改'
}

const statusLabels = {
  available: ['可恢复', 'processing'],
  restored: ['已恢复', 'success'],
  kept: ['已保留', 'default'],
  failed: ['失败', 'error']
}

export default function SafetyOperationCenterModal ({ open, onClose, store }) {
  const [records, setRecords] = useState([])
  const [keyword, setKeyword] = useState('')
  const [host, setHost] = useState('')
  const [source, setSource] = useState('')
  const [status, setStatus] = useState('')
  const [runningId, setRunningId] = useState('')
  const runningRef = useRef('')

  function refreshRecords () {
    setRecords(readSafetyOperationRecords(ls))
  }

  useEffect(() => {
    if (open) refreshRecords()
  }, [open])

  useEffect(() => {
    window.addEventListener(safetyOperationUpdatedEvent, refreshRecords)
    return () => window.removeEventListener(safetyOperationUpdatedEvent, refreshRecords)
  }, [])

  const hosts = useMemo(() => {
    return [...new Set(records.map(record => record.host).filter(Boolean))]
  }, [records])

  const filtered = useMemo(() => {
    return filterSafetyOperationRecords(records, { keyword, host, source, status })
  }, [records, keyword, host, source, status])

  function persistPatch (record, patch) {
    const next = updateSafetyOperationRecord(readSafetyOperationRecords(ls), record.id, patch)
    setRecords(writeSafetyOperationRecords(ls, next))
  }

  function findSftpEntry (record) {
    const tabIds = [record.tabId, store.currentTab?.id, store.activeTabId].filter(Boolean)
    return tabIds.map(tabId => ({ tabId, entry: refs.get('sftp-' + tabId) })).find(({ tabId, entry }) => {
      return entry?.sftp && matchesSafetyOperationEndpoint(
        record,
        entry.props?.tab || {},
        true
      )
    })?.entry
  }

  async function handleSftpRestore (record) {
    if (runningRef.current) return
    const entry = findSftpEntry(record)
    if (!entry?.sftp) {
      message.warning(`请先连接服务器 ${record.host || ''} 并打开 SFTP，再执行恢复。`)
      return
    }
    runningRef.current = record.id
    setRunningId(record.id)
    try {
      await entry.restoreSftpRecord(record)
      refreshRecords()
    } finally {
      runningRef.current = ''
      setRunningId('')
    }
  }

  async function handleQuickAction (record, action) {
    if (runningRef.current) return
    const terminal = findSafetyOperationSession(
      record,
      [store.currentTab?.id, store.activeTabId],
      tabId => refs.get('term-' + tabId)
    )
    if (!terminal) {
      message.warning(`请先连接服务器 ${record.host || ''}，再执行快捷回滚。`)
      return
    }
    runningRef.current = record.id
    setRunningId(record.id)
    try {
      const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const output = await runCmd(terminal.pid, buildVerifiedQuickCommandRollbackAction(record, action, token))
      assertVerifiedQuickCommandRollbackResult(output, token)
      const now = new Date().toISOString()
      persistPatch(record, {
        status: action === 'rollback' ? 'restored' : 'kept',
        rollbackStatus: action === 'rollback' ? 'completed' : 'kept',
        restoredAt: action === 'rollback' ? now : '',
        keptAt: action === 'keep' ? now : ''
      })
      message.success(action === 'rollback' ? '快捷回滚已执行。' : '已保留新配置并取消自动回滚。')
    } catch (error) {
      persistPatch(record, {
        status: 'failed',
        rollbackStatus: 'failed',
        error: error?.message || String(error)
      })
      window.store.onError(error)
    } finally {
      runningRef.current = ''
      setRunningId('')
    }
  }

  function renderActions (record) {
    if (!['available', 'failed'].includes(record.status)) return null
    if (record.source === 'sftp') {
      return (
        <Button
          icon={<UndoOutlined />}
          loading={runningId === record.id}
          disabled={Boolean(runningId)}
          onClick={() => handleSftpRestore(record)}
        >
          {record.status === 'failed' ? '重试恢复' : '立即恢复'}
        </Button>
      )
    }
    return (
      <Space>
        <Button
          icon={<CheckOutlined />}
          loading={runningId === record.id}
          disabled={Boolean(runningId)}
          onClick={() => handleQuickAction(record, 'keep')}
        >
          保留新配置
        </Button>
        <Button
          danger
          type='primary'
          icon={<UndoOutlined />}
          loading={runningId === record.id}
          disabled={Boolean(runningId)}
          onClick={() => handleQuickAction(record, 'rollback')}
        >
          {record.status === 'failed' ? '重试回滚' : '立即回滚'}
        </Button>
      </Space>
    )
  }

  function renderRecord (record) {
    const [statusText, statusColor] = statusLabels[record.status] || [record.status, 'default']
    const location = record.backupPath || record.rollbackPath || (record.previousMode !== undefined ? `原权限 ${record.previousMode}` : '')
    return (
      <div className='safety-center-record' key={record.id}>
        <div className='safety-center-record-main'>
          <div className='safety-center-record-title'>
            <Tag color={record.source === 'sftp' ? 'blue' : 'orange'}>{sourceLabels[record.source] || record.source}</Tag>
            <strong>{kindLabels[record.kind] || record.title}</strong>
            <Tag color={statusColor}>{statusText}</Tag>
          </div>
          <div className='safety-center-record-target' title={record.target}>{record.target}</div>
          <div className='safety-center-record-meta'>
            服务器：{record.username ? `${record.username}@` : ''}{record.host || '未记录'}:{record.port || 22}
            <span>时间：{new Date(record.createdAt).toLocaleString()}</span>
          </div>
          {location ? <div className='safety-center-record-location' title={location}>恢复位置：{location}</div> : null}
          {record.error ? <div className='safety-center-record-error'>失败原因：{record.error}</div> : null}
        </div>
        <div className='safety-center-record-actions'>{renderActions(record)}</div>
      </div>
    )
  }

  return (
    <Modal
      title={<Space><SafetyCertificateOutlined />安全操作中心</Space>}
      open={open}
      onCancel={onClose}
      footer={null}
      width={940}
      destroyOnClose={false}
      className='safety-operation-center-modal'
    >
      <div className='safety-center-summary'>
        统一记录 SFTP 备份、安全删除、文件修改和服务器高风险操作。已完成的恢复记录会保留，便于追溯。
      </div>
      <div className='safety-center-filters'>
        <Input.Search placeholder='搜索对象、路径或服务器' allowClear value={keyword} onChange={event => setKeyword(event.target.value)} />
        <Select aria-label='服务器' value={host} onChange={setHost} options={[{ value: '', label: '全部服务器' }, ...hosts.map(value => ({ value, label: value }))]} />
        <Select aria-label='来源' value={source} onChange={setSource} options={[{ value: '', label: '全部来源' }, { value: 'sftp', label: 'SFTP 文件' }, { value: 'quick-command', label: '服务器修改' }]} />
        <Select aria-label='状态' value={status} onChange={setStatus} options={[{ value: '', label: '全部状态' }, { value: 'available', label: '可恢复' }, { value: 'restored', label: '已恢复' }, { value: 'kept', label: '已保留' }, { value: 'failed', label: '失败' }]} />
      </div>
      <div className='safety-center-records'>
        {filtered.length ? filtered.map(renderRecord) : <Empty description='暂无符合条件的安全操作记录' />}
      </div>
    </Modal>
  )
}
