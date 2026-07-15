import { useEffect, useRef, useState } from 'react'
import { Input, Select, Button } from 'antd'
import { SearchOutlined, CloseOutlined } from '@ant-design/icons'
import { notification } from '../common/notification'

const e = window.translate

export default function SettingHeader (props) {
  const {
    store,
    languages,
    query,
    searchResults,
    searchFocusRequest,
    onSearchFocusHandled,
    onQueryChange,
    onSearch,
    onSelectSearchResult,
    onClose
  } = props
  const searchInputRef = useRef(null)
  const [searchExpanded, setSearchExpanded] = useState(false)

  useEffect(() => {
    return () => {
      store.previewLanguage = ''
    }
  }, [store])

  useEffect(() => {
    if (!searchFocusRequest) {
      return
    }
    focusSearch()
    onSearchFocusHandled()
  }, [searchFocusRequest])

  function focusSearch () {
    setSearchExpanded(true)
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }

  function handlePreviewLanguage (language) {
    store.previewLanguage = language
  }

  function handleApplyLanguage () {
    const language = store.previewLanguage
    if (language && language !== store.config.language) {
      store.setConfig({ language })
      store.previewLanguage = ''
      notification.info({
        message: (
          <div>
            {e('saveLang')}
            <Button
              onClick={() => window.location.reload()}
              className='mg1l'
              size='small'
            >
              {e('restartNow')}
            </Button>
          </div>
        )
      })
      return
    }
    store.previewLanguage = ''
  }

  function handleCancelLanguage () {
    store.previewLanguage = ''
  }

  function handleClose () {
    store.previewLanguage = ''
    onClose()
  }

  return (
    <header
      className='setting-header'
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 48px 0',
        position: 'relative',
        zIndex: 5
      }}
    >
      <h2 style={{ margin: 0, whiteSpace: 'nowrap' }}>{e('settingsCenter')}</h2>
      <Button
        className='setting-header-search-toggle'
        aria-label={e('searchSettings')}
        title={e('searchSettingsShortcut')}
        icon={<SearchOutlined />}
        type='text'
        onClick={focusSearch}
      />
      <div
        className={`setting-header-search ${searchExpanded ? 'is-expanded' : ''}`.trim()}
      >
        <Input
          ref={searchInputRef}
          allowClear
          aria-label={e('searchSettings')}
          placeholder={e('searchSettings')}
          prefix={<SearchOutlined />}
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          onPressEnter={() => onSearch()}
        />
        {
          searchResults.length
            ? (
              <div
                className='setting-search-results'
                role='listbox'
                aria-label={e('searchSettings')}
              >
                {
                  searchResults.map(result => (
                    <button
                      key={`${result.tab}:${result.itemId}`}
                      type='button'
                      role='option'
                      aria-selected='false'
                      onClick={() => onSelectSearchResult(result)}
                    >
                      <SearchOutlined />
                      <span>{e(result.labelKey)}</span>
                    </button>
                  ))
                }
              </div>
              )
            : null
        }
      </div>
      <span className='setting-header-auto-saved'>{e('autoSaved')}</span>
      <Select
        aria-label={e('language')}
        popupMatchSelectWidth={false}
        value={store.previewLanguage || store.config.language}
        onChange={handlePreviewLanguage}
        options={languages.map(language => ({
          value: language.id,
          label: language.name
        }))}
        style={{ minWidth: 140 }}
      />
      {
        store.previewLanguage
          ? (
            <>
              <Button
                aria-label={e('apply')}
                type='primary'
                size='small'
                onClick={handleApplyLanguage}
              >
                {e('apply')}
              </Button>
              <Button
                aria-label={e('cancel')}
                size='small'
                onClick={handleCancelLanguage}
              >
                {e('cancel')}
              </Button>
            </>
            )
          : null
      }
      <Button
        className='close-setting-wrap close-setting-wrap-icon'
        aria-label={e('close')}
        icon={<CloseOutlined />}
        type='text'
        onClick={handleClose}
      />
    </header>
  )
}
