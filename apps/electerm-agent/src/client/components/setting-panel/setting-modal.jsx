/**
 * hisotry/bookmark/setting modal
 */

import { auto } from 'manate/react'
import { pick } from 'lodash-es'
import { Spin } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SettingModal from './setting-wrap'
import SettingHeader from './setting-header'
import LazyModuleBoundary from '../common/lazy-module-boundary'
import { searchSettings } from '../../common/setting-search-index'
import { shouldHandleSettingsSearchShortcut } from '../../common/settings-search-interaction.js'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import {
  settingMap,
  modals
} from '../../common/constants'

const Loading = () => <div style={{ padding: 20, textAlign: 'center' }}><Spin /></div>

function SettingsTabNavigation ({ activeKey, activeTabReadyKey, items, onChange }) {
  const tabRefs = useRef(new Map())
  const pendingFocusKeyRef = useRef('')

  useEffect(() => {
    if (
      pendingFocusKeyRef.current !== activeKey ||
      activeTabReadyKey !== activeKey
    ) return undefined
    const frameId = window.requestAnimationFrame(() => {
      tabRefs.current.get(activeKey)?.focus({ preventScroll: true })
      pendingFocusKeyRef.current = ''
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [activeKey, activeTabReadyKey])

  function handleKeyDown (event, index) {
    let nextIndex = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % items.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + items.length) % items.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = items.length - 1
    } else {
      return
    }
    event.preventDefault()
    const nextItem = items[nextIndex]
    pendingFocusKeyRef.current = nextItem.key
    onChange(nextItem.key)
  }

  return (
    <nav className='setting-tabs' aria-label={e('setting')}>
      <div className='setting-tabs-native-list' role='tablist'>
        {items.map((item, index) => (
          <button
            aria-controls={`setting-panel-${item.key}`}
            aria-selected={item.key === activeKey}
            className='setting-tabs-native-tab'
            id={`setting-tab-${item.key}`}
            key={item.key}
            onClick={() => onChange(item.key)}
            onKeyDown={event => handleKeyDown(event, index)}
            ref={node => {
              if (node) tabRefs.current.set(item.key, node)
              else tabRefs.current.delete(item.key)
            }}
            role='tab'
            tabIndex={item.key === activeKey ? 0 : -1}
            type='button'
          >
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
const settingTabLoaders = {
  [settingMap.bookmarks]: () => import('./tab-bookmarks'),
  [settingMap.setting]: () => import('./tab-settings'),
  [settingMap.terminalThemes]: () => import('./tab-themes'),
  [settingMap.quickCommands]: () => import('./tab-quick-commands'),
  [settingMap.profiles]: () => import('./tab-profiles'),
  [settingMap.widgets]: () => import('./tab-widgets')
}
const settingTabComponents = new Map()
const settingTabLoads = new Map()

function loadSettingTab (settingTab) {
  if (settingTabComponents.has(settingTab)) {
    return Promise.resolve(settingTabComponents.get(settingTab))
  }
  if (settingTabLoads.has(settingTab)) {
    return settingTabLoads.get(settingTab)
  }
  const loader = settingTabLoaders[settingTab]
  if (!loader) {
    return Promise.reject(new Error(formatShellPilotTranslation(
      e,
      'shellpilotModuleLoadFailed',
      { module: e('setting') }
    )))
  }
  const load = loader()
    .then(module => {
      const Component = module.default
      settingTabComponents.set(settingTab, Component)
      settingTabLoads.delete(settingTab)
      return Component
    })
    .catch(error => {
      settingTabLoads.delete(settingTab)
      throw error
    })
  settingTabLoads.set(settingTab, load)
  return load
}

function getInitialSettingTabState (settingTab) {
  return {
    settingTab,
    Component: settingTabComponents.get(settingTab) || null,
    error: null
  }
}

function preloadInitialSettingTab (settingTab) {
  const initialSettingTab = settingTabLoaders[settingTab]
    ? settingTab
    : settingMap.setting
  return loadSettingTab(initialSettingTab).catch(() => undefined)
}

function ActiveSettingTab ({ settingTab, componentProps, onActiveTabReady }) {
  const [state, setState] = useState(() => getInitialSettingTabState(settingTab))

  useEffect(() => {
    let active = true
    const cachedComponent = settingTabComponents.get(settingTab)
    if (cachedComponent) {
      if (
        state.settingTab !== settingTab ||
        state.Component !== cachedComponent ||
        state.error
      ) {
        setState({ settingTab, Component: cachedComponent, error: null })
      }
      return () => { active = false }
    }
    setState({ settingTab, Component: null, error: null })
    loadSettingTab(settingTab)
      .then(Component => {
        if (active) {
          setState({ settingTab, Component, error: null })
        }
      })
      .catch(error => {
        if (active) setState({ settingTab, Component: null, error })
      })
    return () => { active = false }
  }, [settingTab])

  useEffect(() => {
    if (state.settingTab === settingTab && state.Component) {
      onActiveTabReady(settingTab)
    }
  }, [state.settingTab, state.Component, settingTab, onActiveTabReady])

  if (state.settingTab === settingTab && state.error) throw state.error
  if (state.settingTab !== settingTab || !state.Component) return <Loading />
  return <state.Component {...componentProps} />
}

const e = window.translate

const SettingModalContent = auto(function SettingModalContent ({
  store,
  query,
  searchFocusRequest,
  activeTabReadyKey,
  setQuery,
  setSearchFocusRequest,
  setActiveTabReadyKey,
  onClose
}) {
  const effectiveLanguage = store.previewLanguage || store.config.language
  const searchResults = searchSettings(query)

  const selectItem = (item) => {
    window.store.setSettingItem(item)
  }

  function handleChangeSettingTab (settingTab) {
    setActiveTabReadyKey('')
    store.handleChangeSettingTab(settingTab)
  }

  function openSearchResult (result = searchResults[0]) {
    if (!result) {
      return
    }
    setQuery('')
    handleChangeSettingTab(result.tab)
    if (!result.itemId) {
      return
    }
    const item = store.getSidebarList(result.tab)
      .find(item => item.id === result.itemId)
    if (item) {
      store.setSettingItem(item)
    }
  }

  const tabsShouldConfirmDel = [
    settingMap.bookmarks,
    settingMap.terminalThemes
  ]
  const { settingTab, settingItem, settingSidebarList, bookmarkSelectMode } = store
  const props0 = {
    store,
    activeItemId: settingItem.id,
    type: settingTab,
    onClickItem: selectItem,
    shouldConfirmDel: tabsShouldConfirmDel.includes(settingTab),
    list: settingSidebarList
  }
  const { bookmarks, bookmarkGroups, widgetInstances } = store
  const formProps = {
    store,
    formData: settingItem,
    type: settingTab,
    hide: store.hideSettingModal,
    ...pick(store, [
      'currentBookmarkGroupId',
      'config'
    ]),
    bookmarkGroups,
    bookmarks,
    widgetInstancesLength: widgetInstances.length,
    serials: store.serials,
    loaddingSerials: store.loaddingSerials
  }
  const treeProps = {
    ...props0,
    bookmarkSelectMode,
    bookmarkGroups,
    bookmarkGroupTree: store.bookmarkGroupTree,
    bookmarksMap: store.bookmarksMap,
    bookmarks,
    ...pick(store, [
      'currentBookmarkGroupId',
      'config',
      'checkedKeys',
      'expandedKeys',
      'leftSidebarWidth',
      'initLoadingData'
    ])
  }
  const items = [
    {
      key: settingMap.bookmarks,
      label: e(settingMap.bookmarks),
      children: null
    },
    {
      key: settingMap.setting,
      label: e(settingMap.setting),
      children: null
    },
    {
      key: settingMap.terminalThemes,
      label: e('uiThemes'),
      children: null
    },
    {
      key: settingMap.quickCommands,
      label: e(settingMap.quickCommands),
      children: null
    },
    {
      key: settingMap.profiles,
      label: e(settingMap.profiles),
      children: null
    },
    {
      key: settingMap.widgets,
      label: <>{e('widgets')} <sup>{e('shellpilotPreview')}</sup></>,
      children: null
    }
  ]
  const tabsProps = {
    activeKey: settingTab,
    activeTabReadyKey,
    animated: false,
    items,
    onChange: handleChangeSettingTab,
    destroyOnHidden: true,
    className: 'setting-tabs',
    type: 'card'
  }
  function renderActiveTab () {
    return (
      <ActiveSettingTab
        settingTab={settingTab}
        onActiveTabReady={setActiveTabReadyKey}
        componentProps={{
          languageVersion: effectiveLanguage,
          listProps: props0,
          treeProps,
          settingItem,
          formProps,
          store,
          settingTab
        }}
      />
    )
  }
  return (
    <>
      <SettingHeader
        store={store}
        languages={window.et.langs || []}
        query={query}
        searchResults={searchResults}
        searchFocusRequest={searchFocusRequest}
        onSearchFocusHandled={() => setSearchFocusRequest(0)}
        onQueryChange={setQuery}
        onSearch={openSearchResult}
        onSelectSearchResult={openSearchResult}
        onClose={onClose}
      />
      <SettingsTabNavigation {...tabsProps} />
      <div
        aria-labelledby={`setting-tab-${settingTab}`}
        className='setting-tab-panel'
        id={`setting-panel-${settingTab}`}
        role='tabpanel'
      >
        <LazyModuleBoundary moduleName={e('setting')} fallback={<Loading />}>
          {renderActiveTab()}
        </LazyModuleBoundary>
      </div>
    </>
  )
})

export default auto(function SettingModalWrap (props) {
  const { store } = props
  const [query, setQuery] = useState('')
  const [searchFocusRequest, setSearchFocusRequest] = useState(0)
  const [activeTabReadyKey, setActiveTabReadyKey] = useState('')
  const hasOpenedRef = useRef(false)

  useEffect(() => {
    let idleId = null
    const timerId = window.setTimeout(() => {
      const preload = () => preloadInitialSettingTab(settingMap.setting)
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(preload, { timeout: 1200 })
      } else {
        preload()
      }
    }, 800)
    return () => {
      window.clearTimeout(timerId)
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId)
      }
    }
  }, [store])

  useEffect(() => {
    function handleSearchShortcut (event) {
      if (!shouldHandleSettingsSearchShortcut(event)) {
        return
      }
      event.preventDefault()
      if (store.showModal !== modals.setting) {
        setQuery('')
        store.openSetting()
        setSearchFocusRequest(value => value + 1)
      }
    }

    window.addEventListener('keydown', handleSearchShortcut)
    return () => window.removeEventListener('keydown', handleSearchShortcut)
  }, [store])

  const handleClose = useCallback(() => {
    store.previewLanguage = ''
    store.cancelUiFontPreview()
    setQuery('')
    store.hideSettingModal(true)
  }, [store])

  const settingContent = useMemo(() => (
    <SettingModalContent
      store={store}
      query={query}
      searchFocusRequest={searchFocusRequest}
      activeTabReadyKey={activeTabReadyKey}
      setQuery={setQuery}
      setSearchFocusRequest={setSearchFocusRequest}
      setActiveTabReadyKey={setActiveTabReadyKey}
      onClose={handleClose}
    />
  ), [store, query, searchFocusRequest, activeTabReadyKey, handleClose])

  const {
    showModal,
    innerWidth,
    useSystemTitleBar
  } = props.store
  const show = showModal === modals.setting
  if (show) hasOpenedRef.current = true
  if (!hasOpenedRef.current) {
    return null
  }
  return (
    <SettingModal
      onCancel={handleClose}
      visible={show}
      useSystemTitleBar={useSystemTitleBar}
      innerWidth={innerWidth}
    >
      {settingContent}
    </SettingModal>
  )
})
