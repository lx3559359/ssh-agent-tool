import { useEffect } from 'react'
import { Input, Select, Button } from 'antd'
import { SearchOutlined, CloseOutlined } from '@ant-design/icons'
import { notification } from '../common/notification'

const e = window.translate

export default function SettingHeader (props) {
  const {
    store,
    languages,
    query,
    onQueryChange,
    onSearch,
    onClose
  } = props

  useEffect(() => {
    return () => {
      store.previewLanguage = ''
    }
  }, [store])

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
      <Input
        allowClear
        aria-label={e('searchSettings')}
        placeholder={e('searchSettings')}
        prefix={<SearchOutlined />}
        value={query}
        onChange={event => onQueryChange(event.target.value)}
        onPressEnter={onSearch}
        style={{ maxWidth: 320 }}
      />
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
