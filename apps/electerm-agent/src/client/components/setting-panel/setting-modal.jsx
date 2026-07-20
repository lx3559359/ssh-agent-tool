/**
 * hisotry/bookmark/setting modal
 */

import { auto } from 'manate/react'
import { pick } from 'lodash-es'
import { Tabs, Spin } from 'antd'
import { useEffect, useState } from 'react'
import SettingModal from './setting-wrap'
import SettingHeader from './setting-header'
import LazyModuleBoundary from '../common/lazy-module-boundary'
import { searchSettings } from '../../common/setting-search-index'
import { shouldHandleSettingsSearchShortcut } from '../../common/settings-search-interaction.js'
import {
  settingMap,
  modals
} from '../../common/constants'

const Loading = () => <div style={{ padding: 20, textAlign: 'center' }}><Spin /></div>
const settingTabLoaders = {
  [settingMap.bookmarks]: () => import('./tab-bookmarks'),
  [settingMap.setting]: () => import('./tab-settings'),
  [settingMap.terminalThemes]: () => import('./tab-themes'),
  [settingMap.quickCommands]: () => import('./tab-quick-commands'),
  [settingMap.profiles]: () => import('./tab-profiles'),
  [settingMap.widgets]: () => import('./tab-widgets')
}

function ActiveSettingTab ({ settingTab, componentProps }) {
  const [state, setState] = useState({ Component: null, error: null })

  useEffect(() => {
    let active = true
    setState({ Component: null, error: null })
    const loader = settingTabLoaders[settingTab]
    if (!loader) return () => { active = false }
    loader()
      .then(module => {
        if (active) setState({ Component: module.default, error: null })
      })
      .catch(error => {
        if (active) setState({ Component: null, error })
      })
    return () => { active = false }
  }, [settingTab])

  if (state.error) throw state.error
  if (!state.Component) return <Loading />
  return <state.Component {...componentProps} />
}

const e = window.translate

export default auto(function SettingModalWrap (props) {
  const { store } = props
  const [query, setQuery] = useState('')
  const [searchFocusRequest, setSearchFocusRequest] = useState(0)
  const effectiveLanguage = store.previewLanguage || store.config.language
  const searchResults = searchSettings(query)

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

  const selectItem = (item) => {
    window.store.setSettingItem(item)
  }

  function openSearchResult (result = searchResults[0]) {
    if (!result) {
      return
    }
    setQuery('')
    store.handleChangeSettingTab(result.tab)
    if (!result.itemId) {
      return
    }
    const item = store.getSidebarList(result.tab)
      .find(item => item.id === result.itemId)
    if (item) {
      store.setSettingItem(item)
    }
  }

  function handleClose () {
    store.previewLanguage = ''
    store.cancelUiFontPreview()
    setQuery('')
    store.hideSettingModal()
  }

  function renderTabs () {
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
      animated: false,
      items,
      onChange: store.handleChangeSettingTab,
      destroyOnHidden: true,
      className: 'setting-tabs',
      type: 'card'
    }
    function renderActiveTab () {
      return (
        <ActiveSettingTab
          settingTab={settingTab}
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
          onClose={handleClose}
        />
        <Tabs
          {...tabsProps}
        />
        <LazyModuleBoundary moduleName={e('setting')} fallback={<Loading />}>
          {renderActiveTab()}
        </LazyModuleBoundary>
      </>
    )
  }

  const {
    showModal,
    innerWidth,
    useSystemTitleBar
  } = props.store
  const show = showModal === modals.setting
  if (!show) {
    return null
  }
  return (
    <SettingModal
      onCancel={handleClose}
      visible={show}
      useSystemTitleBar={useSystemTitleBar}
      innerWidth={innerWidth}
    >
      {renderTabs()}
    </SettingModal>
  )
})
