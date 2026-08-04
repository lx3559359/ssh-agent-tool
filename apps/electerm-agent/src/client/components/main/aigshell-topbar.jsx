import {
  ApiOutlined,
  CodeOutlined,
  DashboardOutlined,
  FolderAddOutlined,
  LinkOutlined,
  MessageOutlined,
  MoonOutlined,
  PlusCircleOutlined,
  ProfileOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SunOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import LazyModuleBoundary from '../common/lazy-module-boundary'
import { auto } from 'manate/react'
import { Button, Popover, Tooltip } from 'antd'
import QuickConnect from '../tabs/quick-connect'
import QuickConnectWizard from '../tabs/quick-connect-wizard'
import WindowControl from '../tabs/window-control'
import ConnectionInventoryModal from '../tree-list/connection-inventory-modal'
import ConnectionInfoModal from '../tree-list/connection-info-modal'
import SafetyOperationCenterModal from './safety-operation-center-modal'
import {
  logoPath1,
  packInfo,
  settingMap,
  statusMap
} from '../../common/constants'
import * as safetyTransactionStore from '../../common/safety-transactions/transaction-store.js'
import {
  commandOrphanRecoveryStartedAt,
  recoverOrphanedCommandOperationsOnce
} from '../../common/safety-transactions/command-orphan-recovery.js'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import {
  getThemeToggleTarget,
  isLightUiTheme
} from '../../common/ui-theme-pairing.js'
import './aigshell-topbar.styl'

const UpdateCenterModal = lazy(() => import('./update-center-modal'))
const HelpCenterModal = lazy(() => import('./help-center-modal'))
const ServerStatusModal = lazy(() => import('../server-status/server-status-modal'))
const SshTunnelModal = lazy(() => import('../ssh-tunnel/ssh-tunnel-modal'))
const e = window.translate

export default auto(function AIGShellTopBar ({ store }) {
  const [showConnectionInventory, setShowConnectionInventory] = useState(false)
  const [showUpdateCenter, setShowUpdateCenter] = useState(false)
  const [showHelpCenter, setShowHelpCenter] = useState(false)
  const [showSafetyCenter, setShowSafetyCenter] = useState(false)
  const [showServerStatus, setShowServerStatus] = useState(false)
  const [showSshTunnel, setShowSshTunnel] = useState(false)
  const [showConnectionWizard, setShowConnectionWizard] = useState(false)
  const [connectionInfoBookmark, setConnectionInfoBookmark] = useState(null)
  const titleBarDraggingRef = useRef(false)
  const serverStatusTriggerRef = useRef(null)
  const currentTab = store.tabs.find(tab => tab.id === store.activeTabId) || store.currentTab || {}
  const title = currentTab.title || currentTab.name || currentTab.host || e('shellpilotTopbarDisconnected')
  const online = currentTab.status === statusMap.success
  const serverStatusAvailable = Boolean(
    online &&
    currentTab.host &&
    (currentTab.type === 'ssh' || currentTab.type === undefined)
  )

  useEffect(() => {
    const openSafetyCenter = () => setShowSafetyCenter(true)
    const openUpdateCenter = () => {
      setShowUpdateCenter(true)
      window.store.upgradeInfo.showUpdateCenter = true
    }
    const openConnectionWizard = () => setShowConnectionWizard(true)
    const openHelpCenter = () => setShowHelpCenter(true)
    window.addEventListener('shellpilot-open-safety-center', openSafetyCenter)
    window.addEventListener('shellpilot-open-update-center', openUpdateCenter)
    window.addEventListener('shellpilot-open-connect-wizard', openConnectionWizard)
    window.addEventListener('shellpilot-open-help-center', openHelpCenter)
    return () => {
      window.removeEventListener('shellpilot-open-safety-center', openSafetyCenter)
      window.removeEventListener('shellpilot-open-update-center', openUpdateCenter)
      window.removeEventListener('shellpilot-open-connect-wizard', openConnectionWizard)
      window.removeEventListener('shellpilot-open-help-center', openHelpCenter)
    }
  }, [])

  useEffect(() => {
    recoverOrphanedCommandOperationsOnce({
      store: safetyTransactionStore,
      startedAt: commandOrphanRecoveryStartedAt
    }).catch(() => {
      window.store.onError?.(new Error(e('shellpilotSafetyRecoveryFailed')))
    })
  }, [])

  useEffect(() => {
    if (!store.shouldSendWindowMove) {
      return
    }
    const stopTitleBarDrag = () => {
      if (!titleBarDraggingRef.current) {
        return
      }
      titleBarDraggingRef.current = false
      window.pre.runSync('windowMove', false)
    }
    document.addEventListener('mouseup', stopTitleBarDrag)
    return () => {
      document.removeEventListener('mouseup', stopTitleBarDrag)
      stopTitleBarDrag()
    }
  }, [store.shouldSendWindowMove])

  function handleFastNew () {
    if (window.store.hasNodePty) {
      window.store.addTab()
      return
    }
    window.store.onNewSsh()
  }

  function handleCheckUpdate () {
    setShowUpdateCenter(true)
    window.store.upgradeInfo.showUpdateCenter = true
    window.store.onCheckUpdate(true)
  }

  function handleOpenServerStatus (event) {
    serverStatusTriggerRef.current = event.currentTarget
    setShowServerStatus(true)
  }

  function handleCloseServerStatus () {
    setShowServerStatus(false)
    window.requestAnimationFrame(() => {
      serverStatusTriggerRef.current?.focus()
    })
  }

  function handleCloseUpdateCenter () {
    setShowUpdateCenter(false)
    window.store.upgradeInfo.showUpdateCenter = false
  }

  function handleOpenConnectionInventory () {
    setShowConnectionInventory(true)
  }

  function handleCloseConnectionInventory () {
    setShowConnectionInventory(false)
  }

  function handleViewConnectionInfo (bookmark) {
    setConnectionInfoBookmark(bookmark)
  }

  function handleCloseConnectionInfo () {
    setConnectionInfoBookmark(null)
  }

  const activeThemes = store.getSidebarList(settingMap.terminalThemes)
  const isLightTheme = isLightUiTheme(store.config.theme, activeThemes)

  function handleToggleTheme () {
    window.store.setTheme(getThemeToggleTarget(store.config.theme))
  }

  function handleOpenQuickCommands () {
    window.store.openOperationsToolkit('quick')
  }

  function isInteractiveTitleBarTarget (target) {
    return Boolean(target?.closest?.(
      'button, a, input, textarea, select, [role="button"], .window-controls, .aigshell-topbar-actions'
    ))
  }

  function handleTitleBarMouseDown (event) {
    if (
      !store.shouldSendWindowMove ||
      event.button !== 0 ||
      isInteractiveTitleBarTarget(event.target)
    ) {
      return
    }
    titleBarDraggingRef.current = true
    window.pre.runSync('windowMove', true)
  }

  function handleTitleBarMouseUp () {
    if (!titleBarDraggingRef.current) {
      return
    }
    titleBarDraggingRef.current = false
    window.pre.runSync('windowMove', false)
  }

  function handleTitleBarDoubleClick (event) {
    if (isInteractiveTitleBarTarget(event.target)) {
      return
    }
    handleTitleBarMouseUp()
    event.preventDefault()
    if (store.isMaximized) {
      window.pre.runGlobalAsync('unmaximize')
      window.store.isMaximized = false
      return
    }
    window.pre.runGlobalAsync('maximize')
    window.store.isMaximized = true
  }

  function handleActionRailWheel (event) {
    const rail = event.currentTarget
    if (
      rail.scrollWidth <= rail.clientWidth ||
      Math.abs(event.deltaY) <= Math.abs(event.deltaX)
    ) {
      return
    }
    const previousScrollLeft = rail.scrollLeft
    rail.scrollLeft += event.deltaY
    if (rail.scrollLeft !== previousScrollLeft) {
      event.preventDefault()
    }
  }

  function handleActionRailFocus (event) {
    const rail = event.currentTarget
    const action = event.target.closest('.aigshell-topbar-action')
    if (!action || !rail.contains(action) || rail.scrollWidth <= rail.clientWidth) {
      return
    }
    const railRect = rail.getBoundingClientRect()
    const actionRect = action.getBoundingClientRect()
    if (actionRect.left < railRect.left) {
      rail.scrollLeft += actionRect.left - railRect.left
    } else if (actionRect.right > railRect.right) {
      rail.scrollLeft += actionRect.right - railRect.right
    }
  }

  const actions = [
    {
      key: 'serverStatus',
      group: 'connection',
      label: e('shellpilotTopbarServerStatus'),
      icon: <DashboardOutlined />,
      onClick: handleOpenServerStatus,
      disabled: !serverStatusAvailable
    },
    {
      key: 'new',
      group: 'connection',
      label: e('shellpilotTopbarNewConnection'),
      icon: <PlusCircleOutlined />,
      onClick: window.store.onNewSsh
    },
    {
      key: 'quick',
      group: 'connection',
      label: e('shellpilotTopbarQuickConnect'),
      icon: <ThunderboltOutlined />,
      popover: <QuickConnect formOnly />,
      onClick: handleFastNew
    },
    {
      key: 'quickCommands',
      group: 'work',
      label: e('shellpilotTopbarQuickCommands'),
      icon: <CodeOutlined />,
      onClick: handleOpenQuickCommands,
      primary: true
    },
    {
      key: 'sshTunnel',
      group: 'work',
      label: e('shellpilotTopbarSshTunnel'),
      icon: <LinkOutlined />,
      onClick: () => setShowSshTunnel(true)
    },
    {
      key: 'ai',
      group: 'work',
      label: e('shellpilotTopbarAiAssistant'),
      icon: <MessageOutlined />,
      onClick: window.store.handleOpenAIPanel
    },
    {
      key: 'model',
      group: 'work',
      label: e('shellpilotTopbarModelApi'),
      icon: <ApiOutlined />,
      onClick: window.store.toggleAIConfig
    },
    {
      key: 'backup',
      group: 'manage',
      label: e('shellpilotTopbarBackupSync'),
      icon: <FolderAddOutlined />,
      onClick: window.store.openSettingSync
    },
    {
      key: 'connections',
      group: 'manage',
      label: e('shellpilotTopbarConnectionInfo'),
      icon: <ProfileOutlined />,
      onClick: handleOpenConnectionInventory
    },
    {
      key: 'safetyCenter',
      group: 'manage',
      label: e('shellpilotTopbarSafetyCenter'),
      icon: <SafetyCertificateOutlined />,
      onClick: () => setShowSafetyCenter(true)
    },
    {
      key: 'update',
      group: 'system',
      label: e('shellpilotTopbarCheckUpdates'),
      icon: <ReloadOutlined />,
      onClick: handleCheckUpdate
    },
    {
      key: 'theme',
      group: 'system',
      label: isLightTheme
        ? e('shellpilotTopbarDarkMode')
        : e('shellpilotTopbarLightMode'),
      icon: isLightTheme ? <MoonOutlined /> : <SunOutlined />,
      onClick: handleToggleTheme
    },
    {
      key: 'setting',
      group: 'system',
      label: e('shellpilotTopbarSettings'),
      icon: <SettingOutlined />,
      onClick: window.store.openSetting
    },
    {
      key: 'help',
      group: 'system',
      label: e('shellpilotTopbarHelp'),
      icon: <QuestionCircleOutlined />,
      onClick: () => setShowHelpCenter(true)
    }
  ]

  function renderAction (item) {
    const btn = (
      <Button
        type='text'
        size='small'
        icon={item.icon}
        disabled={item.disabled}
        onClick={item.popover ? undefined : item.onClick}
        aria-label={item.label}
        data-action-key={item.key}
        className={'aigshell-topbar-action' + (item.primary ? ' aigshell-topbar-action-primary' : '')}
      >
        <span className='aigshell-topbar-action-label'>{item.label}</span>
      </Button>
    )
    if (!item.popover) {
      return btn
    }
    return (
      <Popover
        content={item.popover}
        trigger='click'
        placement='bottom'
      >
        {btn}
      </Popover>
    )
  }

  return (
    <div
      className='aigshell-topbar'
      onDoubleClick={handleTitleBarDoubleClick}
      onMouseDown={handleTitleBarMouseDown}
      onMouseUp={handleTitleBarMouseUp}
      style={store.shouldSendWindowMove ? { WebkitAppRegion: 'no-drag' } : undefined}
    >
      <div className='aigshell-topbar-brand'>
        <img src={logoPath1} alt='ShellPilot' />
        <span className='aigshell-topbar-name'>ShellPilot</span>
        <span
          className='aigshell-topbar-version'
          title={formatShellPilotTranslation(e, 'shellpilotTopbarCurrentVersion', {
            version: packInfo.version
          })}
        >v{packInfo.version}
        </span>
        <span className='aigshell-topbar-separator' />
        <span className='aigshell-topbar-current' title={title}>{title}</span>
        <Tooltip
          title={online
            ? e('shellpilotTopbarConnected')
            : e('shellpilotTopbarDisconnected')}
        >
          <span className='aigshell-topbar-status'>
            <span
              className={'aigshell-topbar-dot ' + (online ? 'online' : '')}
              aria-hidden='true'
            />
            <span className='aigshell-topbar-status-text'>
              {online
                ? e('shellpilotTopbarConnected')
                : e('shellpilotTopbarDisconnected')}
            </span>
          </span>
        </Tooltip>
      </div>
      <div
        className='aigshell-topbar-actions'
        onWheel={handleActionRailWheel}
        onFocusCapture={handleActionRailFocus}
      >
        {
          actions.map((item, index) => (
            <span
              key={item.key}
              data-action-group={item.group}
              className={'aigshell-topbar-action-wrap' + (
                index > 0 && actions[index - 1].group !== item.group
                  ? ' aigshell-topbar-action-group-boundary'
                  : ''
              )}
            >
              {renderAction(item)}
            </span>
          ))
        }
      </div>
      <WindowControl store={store} />
      <QuickConnectWizard
        open={showConnectionWizard}
        onClose={() => setShowConnectionWizard(false)}
      />
      {
        showConnectionInventory
          ? (
            <ConnectionInventoryModal
              bookmarks={store.bookmarks}
              bookmarkGroups={store.bookmarkGroups}
              onClose={handleCloseConnectionInventory}
              onViewConnectionInfo={handleViewConnectionInfo}
            />
            )
          : null
      }
      <ConnectionInfoModal
        bookmark={connectionInfoBookmark}
        bookmarkGroups={store.bookmarkGroups}
        onClose={handleCloseConnectionInfo}
      />
      {
        showUpdateCenter
          ? (
            <LazyModuleBoundary moduleName={e('shellpilotTopbarUpdateCenter')} fallback={null}>
              <Suspense fallback={null}>
                <UpdateCenterModal
                  open
                  onClose={handleCloseUpdateCenter}
                />
              </Suspense>
            </LazyModuleBoundary>
            )
          : null
      }
      {
        showHelpCenter
          ? (
            <LazyModuleBoundary moduleName={e('shellpilotTopbarHelpCenter')} fallback={null}>
              <Suspense fallback={null}>
                <HelpCenterModal
                  open
                  onClose={() => setShowHelpCenter(false)}
                />
              </Suspense>
            </LazyModuleBoundary>
            )
          : null
      }
      <SafetyOperationCenterModal
        open={showSafetyCenter}
        onClose={() => setShowSafetyCenter(false)}
        store={store}
      />
      {
        showServerStatus
          ? (
            <LazyModuleBoundary moduleName={e('shellpilotTopbarServerStatus')} fallback={null}>
              <Suspense fallback={null}>
                <ServerStatusModal
                  open
                  onClose={handleCloseServerStatus}
                  store={store}
                  tab={currentTab}
                />
              </Suspense>
            </LazyModuleBoundary>
            )
          : null
      }
      {
        showSshTunnel
          ? (
            <LazyModuleBoundary moduleName={e('shellpilotTopbarSshTunnel')} fallback={null}>
              <Suspense fallback={null}>
                <SshTunnelModal
                  open
                  onClose={() => setShowSshTunnel(false)}
                  store={store}
                  tab={currentTab}
                />
              </Suspense>
            </LazyModuleBoundary>
            )
          : null
      }
    </div>
  )
})
