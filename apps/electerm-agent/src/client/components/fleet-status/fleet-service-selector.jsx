import { useSyncExternalStore } from 'react'
import { Button, Checkbox, Drawer, Input, Select, Tooltip } from 'antd'
import {
  CloseOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined
} from '@ant-design/icons'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import './fleet-service-selector.styl'

const e = window.translate
const tf = (key, replacements) => formatShellPilotTranslation(e, key, replacements)
const typeLabelKeys = {
  service: 'shellpilotFleetSystemService',
  container: 'shellpilotFleetContainer',
  process: 'shellpilotFleetProcess'
}
const groupLabelKeys = {
  system: 'shellpilotFleetSystemService',
  container: 'shellpilotFleetContainer',
  'process-manager': 'shellpilotFleetProcessManager'
}
const sourceLabels = {
  systemd: 'systemd',
  openrc: 'OpenRC',
  sysv: 'SysV',
  docker: 'Docker',
  compose: 'Docker Compose',
  supervisor: 'Supervisor',
  pm2: 'PM2'
}
const stateLabelKeys = {
  running: 'shellpilotFleetRunning',
  stopped: 'shellpilotFleetStopped',
  failed: 'shellpilotFleetAbnormal',
  starting: 'shellpilotFleetStarting',
  restarting: 'shellpilotFleetRestarting',
  paused: 'shellpilotFleetPaused',
  unknown: 'shellpilotFleetUnknown'
}
const autostartLabelKeys = {
  enabled: 'shellpilotFleetEnabled',
  disabled: 'shellpilotFleetDisabled',
  static: 'shellpilotFleetStatic',
  masked: 'shellpilotFleetMasked',
  unknown: 'shellpilotFleetUnknown'
}

function ServerStatus ({ server }) {
  if (server.status === 'loading') return <>{e('shellpilotFleetDetecting')}</>
  if (server.status === 'ready') return <>{tf('shellpilotFleetFoundItems', { count: server.itemCount })}</>
  if (server.status === 'partial') return <>{tf('shellpilotFleetFoundItemsPartial', { count: server.itemCount })}</>
  if (server.status === 'empty') return <>{e('shellpilotFleetNoServicesFound')}</>
  if (server.status === 'disconnected') return <>{e('shellpilotFleetDisconnected')}</>
  if (server.status === 'permission') return <>{e('shellpilotFleetPermissionDenied')}</>
  if (server.status === 'unsupported') return <>{e('shellpilotFleetServiceDetectionUnsupported')}</>
  if (server.status === 'cancelled') return <>{e('shellpilotFleetCancelled')}</>
  return <>{e('shellpilotFleetDetectionFailed')}</>
}

function endpoint (server) {
  if (!server.host) return '--'
  const host = server.host.includes(':') ? `[${server.host}]` : server.host
  return `${host}:${server.port || 22}`
}

function ServiceRows ({ rows, selectedIds, handleToggle }) {
  const rendered = []
  const selected = new Set(selectedIds)
  let group = ''
  for (const row of rows) {
    if (row.group !== group) {
      group = row.group
      rendered.push(
        <tr className='fleet-service-selector-group-row' key={`group:${group}`}>
          <th colSpan={8}>{e(groupLabelKeys[group] || 'shellpilotFleetOther')}</th>
        </tr>
      )
    }
    rendered.push(
      <tr className='fleet-service-selector-service-row' key={row.id}>
        <td className='fleet-service-selector-selection-cell'>
          <Checkbox
            aria-label={tf('shellpilotFleetSelectServerService', {
              server: row.serverName,
              service: row.name
            })}
            checked={selected.has(row.id)}
            onChange={() => handleToggle(row.id)}
          />
        </td>
        <td title={row.serverName}>{row.serverName}</td>
        <td title={row.name}><strong>{row.name}</strong></td>
        <td>{e(typeLabelKeys[row.type] || 'shellpilotFleetUnknown')}</td>
        <td>{sourceLabels[row.source] || row.source || '--'}</td>
        <td>
          <span className={`fleet-service-selector-state fleet-service-selector-state-${row.state}`}>
            {e(stateLabelKeys[row.state] || 'shellpilotFleetUnknown')}
          </span>
        </td>
        <td>{e(autostartLabelKeys[row.autostart] || 'shellpilotFleetUnknown')}</td>
        <td title={row.description}>{row.description || '--'}</td>
      </tr>
    )
  }
  return rendered
}

export default function FleetServiceSelector ({ serviceStore, onAfterClose }) {
  const state = useSyncExternalStore(
    serviceStore.subscribe,
    serviceStore.getState,
    serviceStore.getState
  )
  const selected = new Set(state.selectedIds)
  const selectedVisible = state.visibleRows.filter(row => selected.has(row.id)).length
  const allVisibleSelected = state.visibleRows.length > 0 &&
    selectedVisible === state.visibleRows.length
  const partlyVisibleSelected = selectedVisible > 0 && !allVisibleSelected
  const toggleVisible = () => {
    serviceStore.setVisibleSelected(!allVisibleSelected)
  }

  return (
    <Drawer
      rootClassName='fleet-service-selector-drawer'
      width={1180}
      open={state.open}
      closable={false}
      destroyOnHidden={false}
      onClose={() => serviceStore.close()}
      afterOpenChange={open => {
        if (!open) onAfterClose?.()
      }}
      title={(
        <div className='fleet-service-selector-title'>
          <div>
            <strong>{e('shellpilotFleetAutoDetectServices')}</strong>
            <span>{tf('shellpilotFleetServerCount', { count: state.targetCount })}</span>
          </div>
          <Tooltip title={e('shellpilotFleetClose')}>
            <Button
              type='text'
              icon={<CloseOutlined />}
              aria-label={e('shellpilotFleetCloseServicePanel')}
              onClick={() => serviceStore.close()}
            />
          </Tooltip>
        </div>
      )}
    >
      <div className='fleet-service-selector-content'>
        <section className='fleet-service-selector-targets' aria-live='polite'>
          <h3>{e('shellpilotFleetTargetServers')}</h3>
          <ul>
            {state.servers.map(server => (
              <li key={server.key}>
                <div><strong>{server.name}</strong><span>{endpoint(server)}</span></div>
                <span className={`fleet-service-selector-server-status fleet-service-selector-server-${server.status}`}>
                  <ServerStatus server={server} />
                </span>
                {server.truncated ? <em>{e('shellpilotFleetResultsTruncated')}</em> : null}
              </li>
            ))}
          </ul>
        </section>

        <div
          className='fleet-service-selector-toolbar'
          role='toolbar'
          aria-label={e('shellpilotFleetServiceToolbar')}
        >
          <Input
            className='fleet-service-selector-search'
            aria-label={e('shellpilotFleetSearchDiscoveredServices')}
            allowClear
            prefix={<SearchOutlined />}
            placeholder={e('shellpilotFleetSearchServices')}
            value={state.filters.search}
            onChange={event => serviceStore.setFilters({ search: event.target.value })}
          />
          <Select
            className='fleet-service-selector-filter'
            aria-label={e('shellpilotFleetServiceTypeFilter')}
            value={state.filters.group}
            onChange={group => serviceStore.setFilters({ group })}
            options={[
              { value: 'all', label: e('shellpilotFleetAllTypes') },
              { value: 'system', label: e('shellpilotFleetSystemService') },
              { value: 'container', label: e('shellpilotFleetContainer') },
              { value: 'process-manager', label: e('shellpilotFleetProcessManager') }
            ]}
          />
          <Select
            className='fleet-service-selector-filter'
            aria-label={e('shellpilotFleetServiceStatusFilter')}
            value={state.filters.status}
            onChange={status => serviceStore.setFilters({ status })}
            options={[
              { value: 'all', label: e('shellpilotFleetAllStatuses') },
              { value: 'running', label: e('shellpilotFleetRunning') },
              { value: 'stopped', label: e('shellpilotFleetStopped') },
              { value: 'abnormal', label: e('shellpilotFleetAbnormal') }
            ]}
          />
          <Button
            icon={<ReloadOutlined />}
            disabled={state.running || !state.targetCount}
            onClick={() => serviceStore.refresh({ force: true })}
          >{e('shellpilotFleetDetectAgain')}
          </Button>
          <Button
            icon={<StopOutlined />}
            disabled={!state.running}
            onClick={() => serviceStore.cancel()}
          >{e('shellpilotFleetCancelDetection')}
          </Button>
        </div>

        <div
          className='fleet-service-selector-selection-bar'
          role='toolbar'
          aria-label={e('shellpilotFleetServiceSelectionToolbar')}
        >
          <span>{tf('shellpilotFleetSelectedItems', { count: state.selectedCount })}</span>
          <Button size='small' disabled={!state.visibleRows.length} onClick={() => serviceStore.selectVisible()}>
            {e('shellpilotFleetSelectFiltered')}
          </Button>
          <Button size='small' disabled={!state.abnormalCount} onClick={() => serviceStore.selectAbnormal()}>
            {e('shellpilotFleetSelectAllAbnormal')}
          </Button>
          <Button size='small' type='text' disabled={!state.selectedCount} onClick={() => serviceStore.clearSelected()}>
            {e('shellpilotFleetClearSelection')}
          </Button>
          {state.truncated ? <strong>{e('shellpilotFleetResultsTruncated')}</strong> : null}
        </div>

        <div className='fleet-service-selector-table-scroll'>
          <table className='fleet-service-selector-table'>
            <thead>
              <tr>
                <th className='fleet-service-selector-selection-cell'>
                  <Checkbox
                    aria-label={e('shellpilotFleetSelectAllFilteredServices')}
                    checked={allVisibleSelected}
                    indeterminate={partlyVisibleSelected}
                    disabled={!state.visibleRows.length}
                    onChange={toggleVisible}
                  />
                </th>
                <th>{e('shellpilotFleetServer')}</th>
                <th>{e('shellpilotFleetServiceName')}</th>
                <th>{e('shellpilotFleetType')}</th>
                <th>{e('shellpilotFleetSource')}</th>
                <th>{e('shellpilotFleetRunningStatus')}</th>
                <th>{e('shellpilotFleetAutostart')}</th>
                <th>{e('shellpilotFleetDescription')}</th>
              </tr>
            </thead>
            <tbody>
              {state.visibleRows.length
                ? (
                  <ServiceRows
                    rows={state.visibleRows}
                    selectedIds={state.selectedIds}
                    handleToggle={serviceStore.toggleSelected}
                  />
                  )
                : (
                  <tr>
                    <td className='fleet-service-selector-empty' colSpan={8}>
                      {state.running
                        ? e('shellpilotFleetDetectingSelectedServers')
                        : e('shellpilotFleetNoMatchingServices')}
                    </td>
                  </tr>
                  )}
            </tbody>
          </table>
        </div>

        <details className='fleet-service-selector-advanced'>
          <summary>{e('shellpilotFleetAdvancedInformation')}</summary>
          <p>{e('shellpilotFleetReadonlyProbeNotice')}</p>
        </details>
      </div>
    </Drawer>
  )
}
