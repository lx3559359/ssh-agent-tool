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
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'

const e = window.translate
const tf = (key, replacements) => formatShellPilotTranslation(e, key, replacements)
const statusOptionKeys = [
  ['all', 'shellpilotFleetAllStatuses'],
  ['healthy', 'shellpilotFleetHealthy'],
  ['warning', 'shellpilotFleetWarning'],
  ['critical', 'shellpilotFleetCritical'],
  ['offline', 'shellpilotFleetOffline'],
  ['pending', 'shellpilotFleetPending'],
  ['permission', 'shellpilotFleetPermissionDenied'],
  ['unsupported', 'shellpilotFleetUnsupported'],
  ['cancelled', 'shellpilotFleetCancelled']
]

function formatCacheHint ({ cacheTtlMs, lastCacheAt }) {
  const seconds = Math.round(cacheTtlMs / 1000)
  if (!lastCacheAt) return tf('shellpilotFleetCacheNotCollected', { seconds })
  const language = window.store?.previewLanguage || window.store?.config?.language
  const time = new Date(lastCacheAt).toLocaleTimeString(language === 'en_us' ? 'en-US' : 'zh-CN', {
    hour12: false
  })
  return tf('shellpilotFleetCacheUpdatedAt', { seconds, time })
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
    { value: 'all', label: e('shellpilotFleetAllGroups') },
    ...state.groups
  ]
  const statusOptions = statusOptionKeys.map(([value, key]) => ({
    value,
    label: e(key)
  }))

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
        aria-label={e('shellpilotFleetOverviewToolbar')}
      >
        <Input
          className='fleet-status-search'
          aria-label={e('shellpilotFleetSearchServers')}
          allowClear
          prefix={<SearchOutlined />}
          placeholder={e('shellpilotFleetSearchPlaceholder')}
          value={state.filters.search}
          onChange={event => statusStore.setFilters({
            search: event.target.value
          })}
        />
        <Select
          className='fleet-status-filter'
          aria-label={e('shellpilotFleetAllGroups')}
          value={state.filters.group}
          options={groupOptions}
          onChange={group => statusStore.setFilters({ group })}
        />
        <Select
          className='fleet-status-filter'
          aria-label={e('shellpilotFleetAllStatuses')}
          value={state.filters.status}
          options={statusOptions}
          onChange={status => statusStore.setFilters({ status })}
        />
        <Button
          icon={<ReloadOutlined />}
          disabled={state.running}
          onClick={() => statusStore.refreshAll()}
        >
          {e('shellpilotFleetRefresh')}
        </Button>
        <Button
          danger
          icon={<StopOutlined />}
          disabled={!state.running}
          onClick={() => statusStore.cancel()}
        >
          {e('shellpilotFleetCancel')}
        </Button>
        <span className='fleet-status-cache-hint'>
          {formatCacheHint(state)}
        </span>
        <span className='fleet-status-selected-count'>
          {tf('shellpilotFleetSelectedServers', { count: state.selectedCount })}
        </span>
      </div>

      {state.selectedCount > 0
        ? (
          <div
            className='fleet-status-batch-bar'
            role='toolbar'
            aria-label={e('shellpilotFleetBatchReadonlyOperations')}
          >
            <strong>{tf('shellpilotFleetSelectedServers', { count: state.selectedCount })}</strong>
            <Button
              ref={checkServicesButtonRef}
              size='small'
              icon={<ToolOutlined />}
              disabled={!state.selectedCount}
              onClick={handleOpenServiceSelector}
            >
              {e('shellpilotFleetCheckServices')}
            </Button>
            <Tooltip title={aiDiagnoseEnabled ? null : e('shellpilotFleetAiBatchUnavailable')}>
              <span
                className='fleet-status-disabled-action'
                tabIndex={aiDiagnoseEnabled ? undefined : 0}
                aria-label={aiDiagnoseEnabled ? undefined : e('shellpilotFleetAiBatchUnavailable')}
              >
                <Button
                  size='small'
                  icon={<RobotOutlined />}
                  disabled={!aiDiagnoseEnabled}
                  onClick={handleAiDiagnose}
                >
                  {e('shellpilotFleetAiBatchDiagnosis')}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={e('shellpilotFleetComingLater')}>
              <span
                className='fleet-status-disabled-action'
                tabIndex={0}
                aria-label={e('shellpilotFleetCheckPortsComingLater')}
              >
                <Button size='small' icon={<ApiOutlined />} disabled>
                  {e('shellpilotFleetCheckPorts')}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={e('shellpilotFleetComingLater')}>
              <span
                className='fleet-status-disabled-action'
                tabIndex={0}
                aria-label={e('shellpilotFleetCollectLogsComingLater')}
              >
                <Button size='small' icon={<FileSearchOutlined />} disabled>
                  {e('shellpilotFleetCollectLogs')}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={e('shellpilotFleetComingLater')}>
              <span
                className='fleet-status-disabled-action'
                tabIndex={0}
                aria-label={e('shellpilotFleetExportReportComingLater')}
              >
                <Button size='small' icon={<FileDoneOutlined />} disabled>
                  {e('shellpilotFleetExportReport')}
                </Button>
              </span>
            </Tooltip>
            <Button size='small' type='text' onClick={() => statusStore.clearSelected()}>
              {e('shellpilotFleetClearSelection')}
            </Button>
          </div>
          )
        : null}
    </>
  )
}
