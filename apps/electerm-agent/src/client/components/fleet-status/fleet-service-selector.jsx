import { useSyncExternalStore } from 'react'
import { Button, Checkbox, Drawer, Input, Select, Tooltip } from 'antd'
import {
  CloseOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined
} from '@ant-design/icons'
import { fleetServiceGroupLabels } from './fleet-service-selector-model.js'
import './fleet-service-selector.styl'

const typeLabels = { service: '系统服务', container: '容器', process: '进程' }
const sourceLabels = {
  systemd: 'systemd',
  openrc: 'OpenRC',
  sysv: 'SysV',
  docker: 'Docker',
  compose: 'Docker Compose',
  supervisor: 'Supervisor',
  pm2: 'PM2'
}
const stateLabels = {
  running: '运行中',
  stopped: '已停止',
  failed: '异常',
  starting: '启动中',
  restarting: '重启中',
  paused: '已暂停',
  unknown: '未知'
}
const autostartLabels = {
  enabled: '已启用',
  disabled: '未启用',
  static: '静态',
  masked: '已屏蔽',
  unknown: '未知'
}

function ServerStatus ({ server }) {
  if (server.status === 'loading') return <>正在检测</>
  if (server.status === 'ready') return <>已发现 {server.itemCount} 项</>
  if (server.status === 'partial') return <>已发现 {server.itemCount} 项，部分检测项失败</>
  if (server.status === 'empty') return <>未发现服务</>
  if (server.status === 'disconnected') return <>未连接或连接已断开</>
  if (server.status === 'permission') return <>权限不足</>
  if (server.status === 'unsupported') return <>当前服务器不支持服务检测</>
  if (server.status === 'cancelled') return <>已取消</>
  return <>检测失败</>
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
          <th colSpan={8}>{fleetServiceGroupLabels[group] || '其他'}</th>
        </tr>
      )
    }
    rendered.push(
      <tr className='fleet-service-selector-service-row' key={row.id}>
        <td className='fleet-service-selector-selection-cell'>
          <Checkbox
            aria-label={`选择 ${row.serverName} 的 ${row.name}`}
            checked={selected.has(row.id)}
            onChange={() => handleToggle(row.id)}
          />
        </td>
        <td title={row.serverName}>{row.serverName}</td>
        <td title={row.name}><strong>{row.name}</strong></td>
        <td>{typeLabels[row.type] || '未知'}</td>
        <td>{sourceLabels[row.source] || row.source || '--'}</td>
        <td>
          <span className={`fleet-service-selector-state fleet-service-selector-state-${row.state}`}>
            {stateLabels[row.state] || '未知'}
          </span>
        </td>
        <td>{autostartLabels[row.autostart] || '未知'}</td>
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
          <div><strong>自动识别服务</strong><span>{state.targetCount} 台服务器</span></div>
          <Tooltip title='关闭'>
            <Button
              type='text'
              icon={<CloseOutlined />}
              aria-label='关闭服务面板'
              onClick={() => serviceStore.close()}
            />
          </Tooltip>
        </div>
      )}
    >
      <div className='fleet-service-selector-content'>
        <section className='fleet-service-selector-targets' aria-live='polite'>
          <h3>目标服务器</h3>
          <ul>
            {state.servers.map(server => (
              <li key={server.key}>
                <div><strong>{server.name}</strong><span>{endpoint(server)}</span></div>
                <span className={`fleet-service-selector-server-status fleet-service-selector-server-${server.status}`}>
                  <ServerStatus server={server} />
                </span>
                {server.truncated ? <em>结果可能已截断</em> : null}
              </li>
            ))}
          </ul>
        </section>

        <div className='fleet-service-selector-toolbar' role='toolbar' aria-label='服务查看工具栏'>
          <Input
            className='fleet-service-selector-search'
            aria-label='搜索自动发现的服务'
            allowClear
            prefix={<SearchOutlined />}
            placeholder='搜索服务'
            value={state.filters.search}
            onChange={event => serviceStore.setFilters({ search: event.target.value })}
          />
          <Select
            className='fleet-service-selector-filter'
            aria-label='服务类型筛选'
            value={state.filters.group}
            onChange={group => serviceStore.setFilters({ group })}
            options={[
              { value: 'all', label: '全部类型' },
              { value: 'system', label: '系统服务' },
              { value: 'container', label: '容器' },
              { value: 'process-manager', label: '进程管理器' }
            ]}
          />
          <Select
            className='fleet-service-selector-filter'
            aria-label='服务状态筛选'
            value={state.filters.status}
            onChange={status => serviceStore.setFilters({ status })}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'running', label: '运行中' },
              { value: 'stopped', label: '已停止' },
              { value: 'abnormal', label: '异常' }
            ]}
          />
          <Button
            icon={<ReloadOutlined />}
            disabled={state.running || !state.targetCount}
            onClick={() => serviceStore.refresh({ force: true })}
          >重新检测
          </Button>
          <Button
            icon={<StopOutlined />}
            disabled={!state.running}
            onClick={() => serviceStore.cancel()}
          >取消检测
          </Button>
        </div>

        <div className='fleet-service-selector-selection-bar' role='toolbar' aria-label='服务多选工具栏'>
          <span>已选择 {state.selectedCount} 项</span>
          <Button size='small' disabled={!state.visibleRows.length} onClick={() => serviceStore.selectVisible()}>
            选择当前筛选结果
          </Button>
          <Button size='small' disabled={!state.abnormalCount} onClick={() => serviceStore.selectAbnormal()}>
            选择全部异常
          </Button>
          <Button size='small' type='text' disabled={!state.selectedCount} onClick={() => serviceStore.clearSelected()}>
            清空选择
          </Button>
          {state.truncated ? <strong>结果可能已截断</strong> : null}
        </div>

        <div className='fleet-service-selector-table-scroll'>
          <table className='fleet-service-selector-table'>
            <thead>
              <tr>
                <th className='fleet-service-selector-selection-cell'>
                  <Checkbox
                    aria-label='选择当前筛选结果中的全部服务'
                    checked={allVisibleSelected}
                    indeterminate={partlyVisibleSelected}
                    disabled={!state.visibleRows.length}
                    onChange={toggleVisible}
                  />
                </th>
                <th>服务器</th><th>服务名称</th><th>类型</th><th>来源</th>
                <th>运行状态</th><th>自启动</th><th>说明</th>
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
                      {state.running ? '正在检测所选服务器' : '没有符合条件的服务'}
                    </td>
                  </tr>
                  )}
            </tbody>
          </table>
        </div>

        <details className='fleet-service-selector-advanced'>
          <summary>高级信息</summary>
          <p>本功能仅执行固定只读探针</p>
        </details>
      </div>
    </Drawer>
  )
}
