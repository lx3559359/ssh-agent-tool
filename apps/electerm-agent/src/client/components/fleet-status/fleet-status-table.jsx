import { Button, Checkbox, Tooltip } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'

const unknownValue = '--'
const e = window.translate
const tf = (key, replacements) => formatShellPilotTranslation(e, key, replacements)

const connectionLabelKeys = {
  pending: 'shellpilotFleetPending',
  connecting: 'shellpilotFleetConnecting',
  connected: 'shellpilotFleetConnected',
  failed: 'shellpilotFleetConnectionFailed',
  offline: 'shellpilotFleetOffline',
  timeout: 'shellpilotFleetTimeout',
  auth: 'shellpilotFleetAuthenticationFailed',
  'host-key': 'shellpilotFleetHostKeyError',
  permission: 'shellpilotFleetPermissionDenied',
  unsupported: 'shellpilotFleetUnsupported',
  cancelled: 'shellpilotFleetCancelled'
}

const abnormalServiceStates = new Set([
  'critical',
  'crashed',
  'dead',
  'degraded',
  'down',
  'error',
  'failed',
  'inactive',
  'stopped',
  'unhealthy',
  'warning'
])

function finiteNumber (value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function metricPercent (value) {
  if (Array.isArray(value)) {
    const values = value.map(metricPercent).filter(number => number !== null)
    return values.length ? Math.max(...values) : null
  }
  const direct = finiteNumber(value)
  if (direct !== null) return direct
  if (!value || typeof value !== 'object') return null
  for (const key of ['usedPercent', 'usagePercent', 'percent', 'value']) {
    const number = finiteNumber(value[key])
    if (number !== null) return number
  }
  const total = finiteNumber(value.totalBytes)
  const available = finiteNumber(value.availableBytes)
  if (total > 0 && available !== null) {
    return 100 - available / total * 100
  }
  return null
}

function formatPercent (value) {
  const number = metricPercent(value)
  return number === null ? unknownValue : `${number.toFixed(1)}%`
}

function formatLoad (value) {
  const number = finiteNumber(value) ?? finiteNumber(
    value?.one ?? value?.oneMinute ?? value?.load1 ?? value?.normalized ?? value?.ratio
  )
  return number === null ? unknownValue : number.toFixed(2)
}

function formatUptime (value) {
  if (value === null || value === undefined || value === '') return unknownValue
  const seconds = finiteNumber(value)
  if (seconds === null) return String(value)
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return tf('shellpilotFleetUptimeDaysHours', { days, hours })
  if (hours) return tf('shellpilotFleetUptimeHoursMinutes', { hours, minutes })
  return tf('shellpilotFleetUptimeMinutes', { minutes })
}

function formatEndpoint (row) {
  if (!row.host) return unknownValue
  const host = row.host.includes(':') ? `[${row.host}]` : row.host
  return `${host}:${row.port || unknownValue}`
}

function formatConnection (row) {
  const connection = row.snapshot?.connection
  if (!connection) return e(connectionLabelKeys.pending)
  const label = e(connectionLabelKeys[connection.status] || connectionLabelKeys.pending)
  const latency = finiteNumber(connection.latencyMs)
  return latency === null ? label : `${label} · ${Math.round(latency)} ms`
}

function formatAddresses (snapshot) {
  const addresses = (snapshot?.network?.interfaces || [])
    .flatMap(item => Array.isArray(item?.addresses) ? item.addresses : [])
    .filter(Boolean)
  return addresses.length ? addresses.join(', ') : unknownValue
}

function formatFirewall (snapshot) {
  const firewall = snapshot?.firewall
  if (!firewall || (!firewall.provider && firewall.enabled === null)) {
    return unknownValue
  }
  const enabled = firewall.enabled === true
    ? e('shellpilotFleetEnabled')
    : (firewall.enabled === false ? e('shellpilotFleetDisabled') : unknownValue)
  return firewall.provider
    ? `${firewall.provider} · ${enabled}`
    : enabled
}

function serviceState (service) {
  return String(
    service?.activeState || service?.state || service?.status || service?.health || ''
  ).trim().toLowerCase()
}

function summarizeServices (services, predicate) {
  const matching = (services || []).filter(predicate)
  if (!matching.length) return unknownValue
  const names = matching.slice(0, 3).map(service => (
    service.name || service.service || unknownValue
  ))
  if (matching.length > names.length) {
    names.push(tf('shellpilotFleetMoreItems', { count: matching.length - names.length }))
  }
  return names.join(', ')
}

function formatAbnormalServices (snapshot) {
  return summarizeServices(snapshot?.services, service => (
    !service?.platformService &&
    !service?.engine &&
    abnormalServiceStates.has(serviceState(service))
  ))
}

function formatPlatformServices (snapshot) {
  return summarizeServices(snapshot?.services, service => (
    Boolean(service?.platformService || service?.engine)
  ))
}

function formatCollectedAt (snapshot) {
  if (!snapshot?.collectedAt) return unknownValue
  const date = new Date(snapshot.collectedAt)
  if (Number.isNaN(date.getTime())) return unknownValue
  const language = window.store?.previewLanguage || window.store?.config?.language
  return date.toLocaleString(language === 'en_us' ? 'en-US' : 'zh-CN', { hour12: false })
}

function statusClass (row) {
  return `fleet-status-state fleet-status-state-${row.overallStatus}`
}

export default function FleetStatusTable ({
  rows,
  selectedIds,
  running,
  onToggleSelected,
  onRefreshOne
}) {
  const selected = new Set(selectedIds)
  const selectedVisibleCount = rows.filter(row => selected.has(row.id)).length
  const allVisibleSelected = rows.length > 0 && selectedVisibleCount === rows.length
  const partlySelected = selectedVisibleCount > 0 && !allVisibleSelected
  const toggleVisible = () => {
    const shouldSelect = !allVisibleSelected
    for (const row of rows) {
      if (selected.has(row.id) !== shouldSelect) onToggleSelected(row.id)
    }
  }

  return (
    <div className='fleet-status-table-scroll'>
      <table className='fleet-status-table'>
        <thead>
          <tr>
            <th className='fleet-status-selection-cell'>
              <Checkbox
                aria-label={e('shellpilotFleetSelectAllVisibleServers')}
                checked={allVisibleSelected}
                indeterminate={partlySelected}
                disabled={!rows.length}
                onChange={toggleVisible}
              />
            </th>
            <th className='fleet-status-name-cell'>{e('shellpilotFleetName')}</th>
            <th>{e('shellpilotFleetGroup')}</th>
            <th>{e('shellpilotFleetIpPort')}</th>
            <th>{e('shellpilotFleetSshStatusLatency')}</th>
            <th>CPU</th>
            <th>{e('shellpilotFleetMemory')}</th>
            <th>{e('shellpilotFleetDisk')}</th>
            <th>{e('shellpilotFleetLoad')}</th>
            <th>{e('shellpilotFleetUptime')}</th>
            <th>{e('shellpilotFleetNetworkIp')}</th>
            <th>{e('shellpilotFleetFirewall')}</th>
            <th>{e('shellpilotFleetAbnormalServices')}</th>
            <th>{e('shellpilotFleetPlatformServices')}</th>
            <th>{e('shellpilotFleetCollectedAt')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length
            ? rows.map(row => (
              <tr key={row.id}>
                <td className='fleet-status-selection-cell'>
                  <Checkbox
                    aria-label={tf('shellpilotFleetSelectServer', { name: row.name })}
                    checked={selected.has(row.id)}
                    onChange={() => onToggleSelected(row.id)}
                  />
                </td>
                <td className='fleet-status-name-cell'>
                  <div className='fleet-status-name-content'>
                    <Tooltip title={row.name}><strong>{row.name}</strong></Tooltip>
                    <Tooltip title={e('shellpilotFleetCollectServerAgain')}>
                      <Button
                        type='text'
                        size='small'
                        icon={<ReloadOutlined />}
                        aria-label={tf('shellpilotFleetCollectNamedServerAgain', { name: row.name })}
                        disabled={running}
                        onClick={() => onRefreshOne(row.id, { force: true })}
                      />
                    </Tooltip>
                  </div>
                </td>
                <td>{row.group || unknownValue}</td>
                <td>{formatEndpoint(row)}</td>
                <td>
                  <Tooltip title={row.errorMessage || null}>
                    <span className={statusClass(row)}>{formatConnection(row)}</span>
                  </Tooltip>
                </td>
                <td>{formatPercent(row.snapshot?.resources?.cpu)}</td>
                <td>{formatPercent(row.snapshot?.resources?.memory)}</td>
                <td>{formatPercent(row.snapshot?.resources?.disk)}</td>
                <td>{formatLoad(row.snapshot?.resources?.load)}</td>
                <td>{formatUptime(row.snapshot?.resources?.uptime)}</td>
                <td className='fleet-status-wide-value'>{formatAddresses(row.snapshot)}</td>
                <td>{formatFirewall(row.snapshot)}</td>
                <td className='fleet-status-wide-value'>{formatAbnormalServices(row.snapshot)}</td>
                <td className='fleet-status-wide-value'>{formatPlatformServices(row.snapshot)}</td>
                <td>{formatCollectedAt(row.snapshot)}</td>
              </tr>
            ))
            : (
              <tr>
                <td className='fleet-status-no-results' colSpan={15}>
                  {e('shellpilotFleetNoMatchingServers')}
                </td>
              </tr>
              )}
        </tbody>
      </table>
    </div>
  )
}
