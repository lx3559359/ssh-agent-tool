import { auto } from 'manate/react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import classnames from 'classnames'
import { Button } from 'antd'
import { DashboardOutlined, ReloadOutlined } from '@ant-design/icons'
import { focusFleetStatusWorkspace } from './fleet-status-navigation'
import { createFleetStatusStore } from './fleet-status-store.js'
import { createFleetServiceSelectorStore } from './fleet-service-selector-store.js'
import FleetServiceSelector from './fleet-service-selector.jsx'
import FleetStatusToolbar from './fleet-status-toolbar.jsx'
import FleetStatusTable from './fleet-status-table.jsx'
import './fleet-status.styl'

export default auto(function FleetStatusWorkspace ({
  store,
  shellGeometry,
  active,
  onAiDiagnose
}) {
  const workspaceRef = useRef(null)
  const checkServicesButtonRef = useRef(null)
  const statusStoreRef = useRef(null)
  const serviceSelectorStoreRef = useRef(null)
  if (!statusStoreRef.current) {
    statusStoreRef.current = createFleetStatusStore({
      bookmarks: store.bookmarks,
      bookmarkGroups: store.bookmarkGroups,
      getBookmarks: () => store.bookmarks,
      getBookmarkGroups: () => store.bookmarkGroups
    })
  }
  if (!serviceSelectorStoreRef.current) {
    serviceSelectorStoreRef.current = createFleetServiceSelectorStore()
  }
  const statusStore = statusStoreRef.current
  const serviceSelectorStore = serviceSelectorStoreRef.current
  const statusState = useSyncExternalStore(
    statusStore.subscribe,
    statusStore.getState,
    statusStore.getState
  )

  useEffect(() => {
    statusStore.setBookmarks(store.bookmarks, store.bookmarkGroups)
  })
  useEffect(() => {
    focusFleetStatusWorkspace(active, workspaceRef.current)
  }, [active])
  useEffect(() => {
    if (!active) serviceSelectorStore.close()
  }, [active, serviceSelectorStore])
  useEffect(() => () => {
    serviceSelectorStore.close()
  }, [serviceSelectorStore])

  const bookmarkCount = statusState.bookmarkCount
  const frame = shellGeometry.terminalInsets
  const workspaceProps = {
    className: classnames('fleet-status-workspace', {
      'fleet-status-workspace-active': active
    }),
    style: frame,
    ref: workspaceRef,
    tabIndex: active ? -1 : undefined,
    'aria-hidden': !active
  }
  const filtersActive = Boolean(
    statusState.filters.search ||
    statusState.filters.group !== 'all' ||
    statusState.filters.status !== 'all'
  )
  const showTable = statusState.running ||
    filtersActive ||
    statusState.visibleRows.some(row => row.snapshot)
  const aiDiagnose = onAiDiagnose || store.onFleetStatusAiDiagnose
  const handleAiDiagnose = typeof aiDiagnose === 'function'
    ? rows => {
      const selectedServices = serviceSelectorStore.getState().selectedRows
      aiDiagnose(rows, selectedServices)
    }
    : undefined
  const handleToggleSelected = statusStore.toggleSelected
  const handleRefreshOne = statusStore.refreshOne
  const handleOpenServiceSelector = () => {
    const selectedIds = new Set(statusStore.getSelectedRows().map(row => row.id))
    const selectedBookmarks = (store.bookmarks || []).filter((bookmark, index) => {
      const id = String(bookmark?.id || bookmark?._id || `bookmark-${index}`)
      return selectedIds.has(id)
    })
    serviceSelectorStore.open(selectedBookmarks)
  }
  const handleServiceSelectorClosed = () => {
    if (!active) return
    const focusCheckServicesButton = () => checkServicesButtonRef.current?.focus()
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(focusCheckServicesButton)
    } else {
      focusCheckServicesButton()
    }
  }

  return (
    <>
      <main {...workspaceProps}>
        <div className='fleet-status-scroll'>
          <header className='fleet-status-header'>
            <div className='fleet-status-heading'>
              <h1>服务器状态总览</h1>
            </div>
            <div className='fleet-status-bookmark-count'>
              <span>已保存服务器</span>
              <strong>{bookmarkCount}</strong>
            </div>
          </header>

          {bookmarkCount
            ? (
              <>
                <FleetStatusToolbar
                  state={statusState}
                  statusStore={statusStore}
                  onOpenServiceSelector={handleOpenServiceSelector}
                  checkServicesButtonRef={checkServicesButtonRef}
                  onAiDiagnose={handleAiDiagnose}
                />
                {showTable
                  ? (
                    <FleetStatusTable
                      rows={statusState.visibleRows}
                      selectedIds={statusState.selectedIds}
                      running={statusState.running}
                      onToggleSelected={handleToggleSelected}
                      onRefreshOne={handleRefreshOne}
                    />
                    )
                  : (
                    <section className='fleet-status-empty' aria-live='polite'>
                      <DashboardOutlined className='fleet-status-empty-icon' />
                      <h2>暂无状态数据</h2>
                      <p>尚未采集服务器状态</p>
                      <Button
                        icon={<ReloadOutlined />}
                        disabled={statusState.running}
                        onClick={() => statusStore.refreshAll()}
                      >
                        刷新
                      </Button>
                    </section>
                    )}
              </>
              )
            : (
              <section className='fleet-status-empty' aria-live='polite'>
                <DashboardOutlined className='fleet-status-empty-icon' />
                <h2>请先在服务器中添加连接</h2>
              </section>
              )}
        </div>
      </main>
      <FleetServiceSelector
        serviceStore={serviceSelectorStore}
        onAfterClose={handleServiceSelectorClosed}
      />
    </>
  )
})
