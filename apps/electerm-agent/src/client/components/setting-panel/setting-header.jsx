import { useEffect, useRef, useState } from 'react'
import { Input, Select, Button } from 'antd'
import { SearchOutlined, CloseOutlined } from '@ant-design/icons'
import { notification } from '../common/notification'
import { isMacJs } from '../../common/constants.js'
import {
  formatSettingsSearchShortcutTitle,
  shouldHandleSettingsSearchShortcut
} from '../../common/settings-search-interaction.js'

const e = window.translate
const searchListboxId = 'setting-search-results'

function getSearchResultId (index) {
  return `${searchListboxId}-option-${index}`
}

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
  const [activeResultIndex, setActiveResultIndex] = useState(-1)
  const resultsOpen = Boolean(query.trim() && searchResults.length)
  const activeResultId = resultsOpen && activeResultIndex >= 0
    ? getSearchResultId(activeResultIndex)
    : undefined

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

  useEffect(() => {
    function handleSearchShortcut (event) {
      if (!shouldHandleSettingsSearchShortcut(event)) {
        return
      }
      event.preventDefault()
      focusSearch()
    }

    window.addEventListener('keydown', handleSearchShortcut)
    return () => window.removeEventListener('keydown', handleSearchShortcut)
  }, [])

  function focusSearch () {
    setSearchExpanded(true)
    searchInputRef.current?.focus()
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }

  function handleSearchChange (event) {
    setActiveResultIndex(-1)
    onQueryChange(event.target.value)
  }

  function closeSearchResults () {
    setActiveResultIndex(-1)
    setSearchExpanded(false)
    onQueryChange('')
  }

  function handleSearchKeyDown (event) {
    if (event.isComposing) {
      return
    }
    if (event.key === 'ArrowDown' && resultsOpen) {
      event.preventDefault()
      setActiveResultIndex(index => index >= searchResults.length - 1 ? 0 : index + 1)
      return
    }
    if (event.key === 'ArrowUp' && resultsOpen) {
      event.preventDefault()
      setActiveResultIndex(index => index <= 0 ? searchResults.length - 1 : index - 1)
      return
    }
    if (event.key === 'Enter' && resultsOpen) {
      event.preventDefault()
      if (activeResultIndex >= 0) {
        onSearch(searchResults[activeResultIndex])
      } else {
        onSearch()
      }
      return
    }
    if (event.key === 'Escape' && (resultsOpen || query || searchExpanded)) {
      event.preventDefault()
      closeSearchResults()
    }
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
        title={formatSettingsSearchShortcutTitle(e, isMacJs)}
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
          role='combobox'
          aria-label={e('searchSettings')}
          aria-autocomplete='list'
          aria-controls={searchListboxId}
          aria-expanded={resultsOpen}
          aria-activedescendant={activeResultId}
          placeholder={e('searchSettings')}
          prefix={<SearchOutlined />}
          value={query}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
        />
        {
          resultsOpen
            ? (
              <div
                className='setting-search-results'
                id={searchListboxId}
                role='listbox'
                aria-label={e('searchSettings')}
              >
                {
                  searchResults.map((result, index) => (
                    <button
                      key={`${result.tab}:${result.itemId}`}
                      id={getSearchResultId(index)}
                      type='button'
                      role='option'
                      aria-selected={index === activeResultIndex}
                      onMouseEnter={() => setActiveResultIndex(index)}
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
