import { useEffect, useMemo, useState } from 'react'
import { auto } from 'manate/react'
import { Button, Input, Space } from 'antd'
import {
  getUiFontAvailability,
  getUiFontPreset,
  searchUiFontPresets,
  uiFontPresets
} from '../../common/ui-font-presets.js'
import './ui-font-picker.styl'

const { Search } = Input
const groups = [
  ['recommended', 'fontGroupRecommended'],
  ['modern', 'fontGroupModern'],
  ['more', 'fontGroupMore']
]

export default auto(function UiFontPicker ({ store }) {
  const [query, setQuery] = useState('')
  const availability = useMemo(() => {
    return Object.fromEntries(uiFontPresets.map(item => [
      item.id,
      getUiFontAvailability(item)
    ]))
  }, [])

  useEffect(() => {
    return () => store.cancelUiFontPreview()
  }, [store])

  const e = window.translate
  const language = store.previewLanguage || store.config.language
  const selectedId = store.getUiFontPresetId()
  const selected = getUiFontPreset(selectedId)
  const selectedAvailable = availability[selected.id] === 'available'
  const preview = selectedAvailable ? selected : getUiFontPreset('system')
  const hasPreview = Boolean(store.previewUiFontPresetId)
  const matches = searchUiFontPresets(query)

  function selectPreset (item) {
    if (availability[item.id] !== 'available') return
    store.previewUiFontPreset(item.id)
  }

  function applyPreset () {
    store.applyUiFontPreset()
  }

  function cancelPreview () {
    store.cancelUiFontPreview()
  }

  return (
    <div className='sp-setting-field sp-setting-field-stacked sp-ui-font-picker'>
      <div className='sp-ui-font-heading'>
        <span className='inline-title'>{e('uiFont')}</span>
        <span className='color-grey'>{e('uiFontDescription')}</span>
      </div>
      <div className='sp-ui-font-layout'>
        <div className='sp-ui-font-browser'>
          <Search
            role='searchbox'
            aria-label={e('searchUiFonts')}
            placeholder={e('searchUiFonts')}
            allowClear
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <div
            className='sp-ui-font-list'
            role='listbox'
            aria-label={e('uiFont')}
          >
            {groups.map(([groupId, labelKey]) => {
              const items = matches.filter(item => item.group === groupId)
              if (!items.length) return null
              return (
                <section className='sp-ui-font-group' key={groupId}>
                  <h4>{e(labelKey)}</h4>
                  {items.map(item => {
                    const status = availability[item.id]
                    const label = language === 'en_us' ? item.en : item.zh
                    return (
                      <button
                        type='button'
                        role='option'
                        aria-label={label}
                        aria-selected={selectedId === item.id}
                        aria-disabled={status !== 'available'}
                        disabled={status !== 'available'}
                        className='sp-ui-font-option'
                        data-font-preset-id={item.id}
                        data-font-availability={status}
                        style={status === 'available'
                          ? { fontFamily: item.stack }
                          : undefined}
                        key={item.id}
                        onClick={() => selectPreset(item)}
                      >
                        <span>{label}</span>
                        {status === 'unavailable'
                          ? <small>{e('fontNotInstalled')}</small>
                          : null}
                        {status === 'unknown'
                          ? <small>{e('fontDetectionUnavailable')}</small>
                          : null}
                      </button>
                    )
                  })}
                </section>
              )
            })}
          </div>
        </div>
        <aside
          className='sp-card sp-ui-font-preview'
          style={{ fontFamily: preview.stack }}
        >
          <h4>{e('uiFontPreview')}</h4>
          <p>{e('uiFontPreviewSampleZh')}</p>
          <p>{e('uiFontPreviewSampleEn')}</p>
          <p>0123456789 !@#$%^&amp;*()</p>
          <code>{e('uiFontPreviewPath')}</code>
          {hasPreview
            ? (
              <Space wrap className='sp-ui-font-actions'>
                <Button type='primary' onClick={applyPreset}>
                  {e('applyUiFont')}
                </Button>
                <Button onClick={cancelPreview}>
                  {e('cancelUiFontPreview')}
                </Button>
              </Space>
              )
            : null}
        </aside>
      </div>
    </div>
  )
})
