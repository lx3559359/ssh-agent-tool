import { Button, Input, Select, Tooltip } from 'antd'
import {
  ApiOutlined,
  FileDoneOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  StopOutlined,
  ToolOutlined
} from '@ant-design/icons'

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'healthy', label: '正常' },
  { value: 'warning', label: '警告' },
  { value: 'critical', label: '严重' },
  { value: 'offline', label: '离线' },
  { value: 'pending', label: '未采集' },
  { value: 'permission', label: '权限不足' },
  { value: 'unsupported', label: '不支持' },
  { value: 'cancelled', label: '已取消' }
]

function formatCacheHint ({ cacheTtlMs, lastCacheAt }) {
  const seconds = Math.round(cacheTtlMs / 1000)
  if (!lastCacheAt) return `缓存 ${seconds} 秒 · 尚未采集`
  const time = new Date(lastCacheAt).toLocaleTimeString('zh-CN', {
    hour12: false
  })
  return `缓存 ${seconds} 秒 · 更新于 ${time}`
}

export default function FleetStatusToolbar ({
  state,
  statusStore,
  onOpenServiceSelector,
  checkServicesButtonRef,
  onAiDiagnose
}) {
  const selectedRows = statusStore.getSelectedRows()
  const aiDiagnoseEnabled = typeof onAiDiagnose === 'function'
  const groupOptions = [
    { value: 'all', label: '全部分组' },
    ...state.groups
  ]

  const handleOpenServiceSelector = () => {
    onOpenServiceSelector()
  }
  const handleAiDiagnose = () => {
    if (typeof onAiDiagnose === 'function') onAiDiagnose(selectedRows)
  }

  return (
    <>
      <div
        className='fleet-status-toolbar'
        role='toolbar'
        aria-label='状态总览工具栏'
      >
        <Input
          className='fleet-status-search'
          aria-label='搜索服务器'
          allowClear
          prefix={<SearchOutlined />}
          placeholder='搜索名称、IP 或标签'
          value={state.filters.search}
          onChange={event => statusStore.setFilters({
            search: event.target.value
          })}
        />
        <Select
          className='fleet-status-filter'
          aria-label='全部分组'
          value={state.filters.group}
          options={groupOptions}
          onChange={group => statusStore.setFilters({ group })}
        />
        <Select
          className='fleet-status-filter'
          aria-label='全部状态'
          value={state.filters.status}
          options={statusOptions}
          onChange={status => statusStore.setFilters({ status })}
        />
        <Button
          icon={<ReloadOutlined />}
          disabled={state.running}
          onClick={() => statusStore.refreshAll()}
        >
          刷新
        </Button>
        <Button
          danger
          icon={<StopOutlined />}
          disabled={!state.running}
          onClick={() => statusStore.cancel()}
        >
          取消
        </Button>
        <span className='fleet-status-cache-hint'>
          {formatCacheHint(state)}
        </span>
        <span className='fleet-status-selected-count'>
          已选择 {state.selectedCount} 台
        </span>
      </div>

      {state.selectedCount > 0
        ? (
          <div className='fleet-status-batch-bar' role='toolbar' aria-label='批量只读操作'>
            <strong>已选择 {state.selectedCount} 台</strong>
            <Button
              ref={checkServicesButtonRef}
              size='small'
              icon={<ToolOutlined />}
              disabled={!state.selectedCount}
              onClick={handleOpenServiceSelector}
            >
              检查服务
            </Button>
            <Tooltip title={aiDiagnoseEnabled ? null : 'AI 批量诊断尚未启用'}>
              <span
                className='fleet-status-disabled-action'
                tabIndex={aiDiagnoseEnabled ? undefined : 0}
                aria-label={aiDiagnoseEnabled ? undefined : 'AI 批量诊断尚未启用'}
              >
                <Button
                  size='small'
                  icon={<RobotOutlined />}
                  disabled={!aiDiagnoseEnabled}
                  onClick={handleAiDiagnose}
                >
                  AI 批量诊断
                </Button>
              </span>
            </Tooltip>
            <Tooltip title='后续版本提供'>
              <span
                className='fleet-status-disabled-action'
                tabIndex={0}
                aria-label='检查端口：后续版本提供'
              >
                <Button size='small' icon={<ApiOutlined />} disabled>
                  检查端口
                </Button>
              </span>
            </Tooltip>
            <Tooltip title='后续版本提供'>
              <span
                className='fleet-status-disabled-action'
                tabIndex={0}
                aria-label='收集日志：后续版本提供'
              >
                <Button size='small' icon={<FileSearchOutlined />} disabled>
                  收集日志
                </Button>
              </span>
            </Tooltip>
            <Tooltip title='后续版本提供'>
              <span
                className='fleet-status-disabled-action'
                tabIndex={0}
                aria-label='导出报告：后续版本提供'
              >
                <Button size='small' icon={<FileDoneOutlined />} disabled>
                  导出报告
                </Button>
              </span>
            </Tooltip>
            <Button size='small' type='text' onClick={() => statusStore.clearSelected()}>
              清除选择
            </Button>
          </div>
          )
        : null}
    </>
  )
}
