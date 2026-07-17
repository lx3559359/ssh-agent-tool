import { Button, Checkbox, Tooltip } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

const unknownValue = '--'

const connectionLabels = {
  pending: '未采集',
  connecting: '连接中',
  connected: '已连接',
  failed: '连接失败',
  offline: '离线',
  timeout: '超时',
  auth: '认证失败',
  'host-key': '主机密钥异常',
  permission: '权限不足',
  unsupported: '不支持',
  cancelled: '已取消'
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
  if (days) return `${days} 天 ${hours} 小时`
  if (hours) return `${hours} 小时 ${minutes} 分钟`
  return `${minutes} 分钟`
}

function formatEndpoint (row) {
  if (!row.host) return unknownValue
  const host = row.host.includes(':') ? `[${row.host}]` : row.host
  return `${host}:${row.port || unknownValue}`
}

function formatConnection (row) {
  const connection = row.snapshot?.connection
  if (!connection) return connectionLabels.pending
  const label = connectionLabels[connection.status] || connectionLabels.pending
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
    ? '已启用'
    : (firewall.enabled === false ? '未启用' : unknownValue)
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
  if (matching.length > names.length) names.push(`另 ${matching.length - names.length} 项`)
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
  return date.toLocaleString('zh-CN', { hour12: false })
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
                aria-label='选择当前列表全部服务器'
                checked={allVisibleSelected}
                indeterminate={partlySelected}
                disabled={!rows.length}
                onChange={toggleVisible}
              />
            </th>
            <th className='fleet-status-name-cell'>名称</th>
            <th>分组</th>
            <th>IP:端口</th>
            <th>SSH 状态与延迟</th>
            <th>CPU</th>
            <th>内存</th>
            <th>磁盘</th>
            <th>负载</th>
            <th>运行时间</th>
            <th>网卡 IP</th>
            <th>防火墙</th>
            <th>异常服务</th>
            <th>平台服务</th>
            <th>采集时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.length
            ? rows.map(row => (
              <tr key={row.id}>
                <td className='fleet-status-selection-cell'>
                  <Checkbox
                    aria-label={`选择 ${row.name}`}
                    checked={selected.has(row.id)}
                    onChange={() => onToggleSelected(row.id)}
                  />
                </td>
                <td className='fleet-status-name-cell'>
                  <div className='fleet-status-name-content'>
                    <Tooltip title={row.name}><strong>{row.name}</strong></Tooltip>
                    <Tooltip title='重新采集该服务器'>
                      <Button
                        type='text'
                        size='small'
                        icon={<ReloadOutlined />}
                        aria-label={`重新采集 ${row.name}`}
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
                  没有符合筛选条件的服务器
                </td>
              </tr>
              )}
        </tbody>
      </table>
    </div>
  )
}
