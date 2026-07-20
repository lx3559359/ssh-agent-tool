import { auto } from 'manate/react'
import { lazy, Suspense, useEffect } from 'react'
import Layout from '../layout/layout'
import { getTerminalWorkspaceAccessibility } from '../fleet-status/fleet-status-navigation'
import FileInfoModal from '../sftp/file-info-modal'
import SettingModal from '../setting-panel/setting-modal'
import TextEditor from '../text-editor/text-editor-entry'
import Sidebar from '../sidebar'
import CssOverwrite from '../bg/css-overwrite'
import UiTheme from './ui-theme'
import UiFont from './ui-font'
import CustomCss from '../bg/custom-css.jsx'
import Resolutions from '../rdp/resolution-edit'
import TerminalInteractive from '../terminal/terminal-interactive'
import ConfirmModalStore from '../file-transfer/conflict-resolve.jsx'
import TransferQueue from '../file-transfer/transfer-queue'
import Remote2RemoteHandlers from '../file-transfer/remote2remote-handlers.jsx'
import TerminalCmdSuggestions from '../terminal/terminal-command-dropdown'
import TransportsActionStore from '../file-transfer/transports-action-store.jsx'
import classnames from 'classnames'
import ShortcutControl from '../shortcuts/shortcut-control.jsx'
import {
  footerHeight,
  isMac,
  isWin,
  quickCommandBoxHeight,
  sidebarWidth,
  textTerminalBgValue
} from '../../common/constants'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import { NotificationContainer } from '../common/notification'
import LazyModuleBoundary from '../common/lazy-module-boundary'
import InfoModal from '../sidebar/info-modal.jsx'
import RightSidePanel from '../side-panel-r/side-panel-r'
import ConnectionHoppingWarning from './connection-hopping-warnning'
import SshConfigLoadNotify from '../ssh-config/ssh-config-load-notify'
import LoadSshConfigs from '../ssh-config/load-ssh-configs'
import AIChat from '../ai/ai-chat-entry'
import AIGShellTopBar from './aigshell-topbar'
import CrashRecoveryNotice from './crash-recovery-notice'
import Opacity from '../common/opacity'
import MoveItemModal from '../tree-list/move-item-modal'
import InputContextMenu from '../common/input-context-menu'
import WorkspaceSaveModal from '../tabs/workspace-save-modal'
import BookmarkFromHistoryModal from '../bookmark-form/bookmark-from-history-modal'
import AutoSync from '../setting-sync/auto-sync'
import BatchOpRunner from '../batch-op/batch-op-runner'
import UnixTimestampTooltip from '../terminal/unix-timestamp-tooltip'
import { pick } from 'lodash-es'
import deepCopy from 'json-deep-copy'
import './wrapper.styl'
import TerminalInfo from '../terminal-info/terminal-info-entry'
import '../../common/fs.js'
import './term-fullscreen.styl'
import {
  installAgentTakeoverLifecycle
} from '../ai/agent-takeover-lifecycle.js'
import { getAIGShellGeometry } from './aigshell-layout'

const FleetStatusWorkspace = lazy(() => import('../fleet-status/fleet-status-workspace'))
const UpdateCheck = lazy(() => import('./upgrade'))
const AIConfigModal = lazy(() => import('../ai/ai-config-modal'))

export function getSafeRightPanelTitle (store, rawConfig) {
  return rawConfig ? store.rightPanelTitle : ''
}

export default auto(function Index (props) {
  useEffect(() => {
    const { store } = props
    const openTab = (event, parsed) => store.ipcOpenTab(parsed)
    const preventDocumentDrop = event => {
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('resize', store.onResize)
    const resizeTimer = setTimeout(store.triggerResize, 200)
    const { ipcOnEvent, ipcOffEvent } = window.pre
    ipcOnEvent('checkupdate', store.onCheckUpdate)
    ipcOnEvent('open-about', store.openAbout)
    ipcOnEvent('new-ssh', store.onNewSsh)
    ipcOnEvent('add-tab-from-command-line', store.addTabFromCommandLine)
    ipcOnEvent('open-tab', openTab)
    ipcOnEvent('openSettings', store.openSetting)
    ipcOnEvent('selectall', store.selectall)
    ipcOnEvent('focused', store.focus)
    ipcOnEvent('blur', store.onBlur)
    ipcOnEvent('zoom-reset', store.onZoomReset)
    ipcOnEvent('zoomin', store.onZoomIn)
    ipcOnEvent('zoomout', store.onZoomout)
    ipcOnEvent('confirm-exit', store.beforeExitApp)

    document.addEventListener('drop', preventDocumentDrop)
    document.addEventListener('dragover', preventDocumentDrop)
    window.addEventListener('offline', store.setOffline)
    const uninstallAgentTakeoverLifecycle = installAgentTakeoverLifecycle({
      onError: error => store.onError(error)
    })
    if (window.et.isWebApp) {
      window.onbeforeunload = store.beforeExit
    }
    store.isSecondInstance = window.pre.runSync('isSecondInstance')
    store.initData()
    store.checkForDbUpgrade()
    store.handleGetSerials()
    store.checkPendingDeepLink()

    return () => {
      clearTimeout(resizeTimer)
      window.removeEventListener('resize', store.onResize)
      window.removeEventListener('offline', store.setOffline)
      uninstallAgentTakeoverLifecycle()
      document.removeEventListener('drop', preventDocumentDrop)
      document.removeEventListener('dragover', preventDocumentDrop)
      ipcOffEvent('checkupdate', store.onCheckUpdate)
      ipcOffEvent('open-about', store.openAbout)
      ipcOffEvent('new-ssh', store.onNewSsh)
      ipcOffEvent('add-tab-from-command-line', store.addTabFromCommandLine)
      ipcOffEvent('open-tab', openTab)
      ipcOffEvent('openSettings', store.openSetting)
      ipcOffEvent('selectall', store.selectall)
      ipcOffEvent('focused', store.focus)
      ipcOffEvent('blur', store.onBlur)
      ipcOffEvent('zoom-reset', store.onZoomReset)
      ipcOffEvent('zoomin', store.onZoomIn)
      ipcOffEvent('zoomout', store.onZoomout)
      ipcOffEvent('confirm-exit', store.beforeExitApp)
      if (window.onbeforeunload === store.beforeExit) {
        window.onbeforeunload = null
      }
    }
  }, [])

  const { store } = props
  const {
    configLoaded,
    fullscreen,
    pinned,
    isSecondInstance,
    pinnedQuickCommandBar,
    installSrc,
    fileTransfers,
    uiThemeConfig,
    transferHistory,
    transferToConfirm,
    openResolutionEdit,
    rightPanelTab
  } = store
  const rawConfig = store.config
  const config = rawConfig || {}
  const effectiveLanguage = store.previewLanguage || config.language || 'zh_cn'
  const effectiveUiFontPresetId = store.previewUiFontPresetId ||
    config.uiFontPresetId || 'system'
  const rightPanelTitle = getSafeRightPanelTitle(store, rawConfig)
  const tabs = (store.getTabs() || []).filter(Boolean)
  const currentTab = store.currentTab || null
  const activeTabId = currentTab?.id || store.activeTabId || ''
  const upgradeInfo = deepCopy(store.upgradeInfo)
  const fleetStatusActive = store.mainWorkspaceMode === 'fleet-status'
  const aiSessionTabId = fleetStatusActive ? '' : activeTabId
  const aiConversationScopeId = fleetStatusActive
    ? 'fleet-status'
    : String(activeTabId || 'global')
  const cls = classnames({
    loaded: configLoaded,
    'not-webapp': !window.et.isWebApp,
    'system-ui': config.useSystemTitleBar,
    'not-system-ui': !config.useSystemTitleBar,
    'is-mac': isMac,
    'not-mac': !isMac,
    'is-win': isWin,
    pinned,
    'not-win': !isWin,
    'qm-pinned': pinnedQuickCommandBar,
    fullscreen,
    'is-main': !isSecondInstance
  })
  const ext1 = {
    className: cls
  }
  // Get active tab IDs
  const activeTabIds = [
    store.activeTabId0,
    store.activeTabId1,
    store.activeTabId2,
    store.activeTabId3
  ].filter(Boolean) // Remove empty strings

  const bgTabs = config.terminalBackgroundImagePath === 'index' ||
                  config.terminalBackgroundImagePath === 'randomShape' ||
                  config.terminalBackgroundImagePath === textTerminalBgValue
    ? tabs.filter(tab => activeTabIds.includes(tab.id))
    : tabs.filter(tab =>
      activeTabIds.includes(tab.id) && tab.terminalBackground?.terminalBackgroundImagePath
    )
  const confsCss = {
    ...Object.keys(config)
      .filter(d => d.startsWith('terminalBackground'))
      .reduce((p, k) => ({
        ...p,
        [k]: config[k]
      }), {}),
    activeTabIds,
    tabs: bgTabs.map(tab => {
      return {
        tabCount: tab.tabCount,
        terminalBackground: tab.terminalBackground,
        id: tab.id
      }
    })
  }
  const themeProps = {
    themeConfig: store.getUiThemeConfig()
  }
  const copiedTransfer = deepCopy(fileTransfers)
  const copiedHistory = deepCopy(transferHistory)
  const shellGeometry = getAIGShellGeometry({
    width: store.width,
    height: store.height,
    footerHeight,
    sidebarWidth,
    leftSidebarWidth: store.leftSidebarWidth,
    openedSideBar: store.openedSideBar,
    pinned: store.pinned,
    rightPanelWidth: store.rightPanelWidth,
    rightPanelVisible: store.rightPanelVisible,
    rightPanelPinned: store.rightPanelPinned,
    pinnedQuickCommandBar: store.pinnedQuickCommandBar,
    inActiveTerminal: !fleetStatusActive && store.inActiveTerminal,
    quickCommandBoxHeight,
    resizeTrigger: store.resizeTrigger
  })
  const sidebarProps = {
    ...pick(store, [
      'activeItemId',
      'history',
      'showModal',
      'showInfoModal',
      'openedSideBar',
      'height',
      'settingTab',
      'settingItem',
      'isSyncingSetting',
      'transferTab',
      'sidebarPanelTab',
      'openWidgetsModal'
    ]),
    zoom: config.zoom,
    fileTransfers: copiedTransfer,
    transferHistory: copiedHistory,
    upgradeInfo,
    pinned,
    shellGeometry
  }

  const infoModalProps = {
    ...pick(store, [
      'infoModalTab',
      'showInfoModal',
      'commandLineHelp'
    ]),
    installSrc,
    upgradeInfo: store.upgradeInfo
  }
  const conflictStoreProps = {
    fileTransferChanged: JSON.stringify(copiedTransfer),
    fileTransfers: copiedTransfer
  }
  const resProps = {
    resolutions: deepCopy(store.resolutions),
    openResolutionEdit
  }

  const rightPanelProps = {
    rightPanelVisible: store.rightPanelVisible,
    rightPanelPinned: store.rightPanelPinned,
    title: rightPanelTitle,
    rightPanelTab,
    activeTabId: aiSessionTabId,
    activeSessionStatus: currentTab?.status || '',
    config,
    shellGeometry
  }
  const terminalInfoProps = {
    rightPanelTab,
    ...deepCopy(store.terminalInfoProps),
    ...pick(
      config,
      [
        'host',
        'port',
        'saveTerminalLogToFile',
        'terminalInfos',
        'sessionLogPath'
      ]
    )
  }
  const sshConfigProps = {
    ...pick(store, [
      'settingTab',
      'showModal',
      'sshConfigs'
    ])
  }
  const warningProps = {
    hasOldConnectionHoppingBookmark: store.hasOldConnectionHoppingBookmark,
    configLoaded
  }
  const aiChatProps = {
    aiChatHistory: store.aiChatHistory,
    config,
    selectedTabIds: store.batchInputSelectedTabIds,
    tabs,
    activeTabId: aiSessionTabId,
    conversationScopeId: aiConversationScopeId,
    showAIConfig: store.showAIConfig,
    rightPanelTab
  }
  const cmdSuggestionsProps = {
    suggestions: store.terminalCommandSuggestions
  }
  const terminalWorkspaceProps = {
    className: classnames('terminal-workspace-layer', {
      'fleet-status-active': fleetStatusActive
    }),
    ...getTerminalWorkspaceAccessibility(fleetStatusActive)
  }
  return (
    <ConfigProvider
      theme={uiThemeConfig}
      locale={effectiveLanguage === 'en_us' ? enUS : zhCN}
    >
      <div {...ext1}>
        <InputContextMenu />
        <ShortcutControl config={config} />
        <CssOverwrite
          {...confsCss}
          configLoaded={configLoaded}
        />
        <Opacity opacity={config.opacity} />
        <TerminalInteractive />
        <UiTheme
          {...themeProps}
        />
        <UiFont presetId={effectiveUiFontPresetId} />
        <CustomCss customCss={config.customCss} configLoaded={configLoaded} />
        <TextEditor />
        <LazyModuleBoundary moduleName={window.translate('shellpilotUpdateCheckModule')} fallback={null}>
          <Suspense fallback={null}>
            <UpdateCheck
              skipVersion={config.skipVersion}
              upgradeInfo={upgradeInfo}
              installSrc={installSrc}
            />
          </Suspense>
        </LazyModuleBoundary>
        <FileInfoModal />
        <SettingModal store={store} />
        <MoveItemModal store={store} />
        <div
          id='outside-context'
        >
          <AIGShellTopBar store={store} />
          <CrashRecoveryNotice
            store={store}
            recoveryPlan={store.recoveryPlan}
          />
          <Sidebar {...sidebarProps} />
          <div {...terminalWorkspaceProps}>
            <Layout
              store={store}
              shellGeometry={shellGeometry}
            />
          </div>
          {
            fleetStatusActive
              ? (
                <LazyModuleBoundary moduleName={window.translate('shellpilotFleetWorkspaceModule')} fallback={null}>
                  <Suspense fallback={null}>
                    <FleetStatusWorkspace
                      store={store}
                      shellGeometry={shellGeometry}
                      active
                    />
                  </Suspense>
                </LazyModuleBoundary>
                )
              : null
          }
        </div>
        <ConfirmModalStore
          transferToConfirm={transferToConfirm}
        />
        <TransportsActionStore
          {...conflictStoreProps}
          config={config}
        />
        <Remote2RemoteHandlers />
        <Resolutions {...resProps} />
        <InfoModal {...infoModalProps} />
        <RightSidePanel {...rightPanelProps}>
          <AIChat {...aiChatProps} />
          <TerminalInfo key={activeTabId} {...terminalInfoProps} />
        </RightSidePanel>
        <SshConfigLoadNotify {...sshConfigProps} />
        <LoadSshConfigs
          showSshConfigModal={store.showSshConfigModal}
          sshConfigs={store.sshConfigs}
        />
        <ConnectionHoppingWarning {...warningProps} />
        <TerminalCmdSuggestions {...cmdSuggestionsProps} />
        <TransferQueue />
        <AutoSync config={config} />
        <WorkspaceSaveModal store={store} />
        <BookmarkFromHistoryModal />
        <NotificationContainer />
        <BatchOpRunner />
        {
          store.showAIConfigModal
            ? (
              <LazyModuleBoundary moduleName={window.translate('shellpilotModelApiConfigModule')} fallback={null}>
                <Suspense fallback={null}>
                  <AIConfigModal store={store} />
                </Suspense>
              </LazyModuleBoundary>
              )
            : null
        }
        <UnixTimestampTooltip />
      </div>
    </ConfigProvider>
  )
})
