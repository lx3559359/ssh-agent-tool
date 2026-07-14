import { Button, Input, Popconfirm, Segmented, Tag } from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  LockOutlined,
  PlusOutlined
} from '@ant-design/icons'
import { useMemo, useState } from 'react'
import classnames from 'classnames'
import isColorDark from '../../common/is-color-dark'
import { getThemeDisplayName } from '../../common/shellpilot-ui-palettes.js'
import {
  getThemeCapabilities,
  selectThemeForDetails
} from '../../common/theme-preview-model.js'
import './theme-gallery.styl'

const e = window.translate

function getReadableName (item) {
  const originalName = typeof item?.name === 'string'
    ? item.name
    : ''
  const displayName = getThemeDisplayName(item, e)
  return typeof displayName === 'string' && displayName.trim()
    ? displayName
    : originalName || item?.id || e('newTheme')
}

function getThemeMode (item) {
  if (item?.mode === 'light' || item?.mode === 'dark') {
    return item.mode
  }
  const uiThemeConfig = item?.uiThemeConfig || {}
  return isColorDark(uiThemeConfig.main) ? 'dark' : 'light'
}

function getSwatchColor (uiThemeConfig, key, fallback) {
  const value = uiThemeConfig[key]
  return typeof value === 'string' && value.trim() ? value : fallback
}

export default function ThemeGallery (props) {
  const {
    themes,
    currentThemeId,
    previewThemeId,
    activeItemId,
    applying,
    languageVersion,
    onPreview,
    onApply,
    onSelect,
    onCreate,
    onCopy,
    onDelete
  } = props
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('all')
  const sourceThemes = useMemo(() => {
    return Array.isArray(themes)
      ? themes.filter(item => {
        return item &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          item.id
      })
      : []
  }, [themes])
  const visibleThemes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return sourceThemes.filter(item => {
      const displayName = getReadableName(item).toLocaleLowerCase()
      const description = item.descriptionKey
        ? e(item.descriptionKey).toLocaleLowerCase()
        : ''
      const matchesQuery = !normalizedQuery ||
        displayName.includes(normalizedQuery) ||
        description.includes(normalizedQuery)
      return matchesQuery && (mode === 'all' || getThemeMode(item) === mode)
    })
  }, [sourceThemes, query, mode, languageVersion])

  function renderDelete (item, capabilities) {
    if (!capabilities.delete || typeof onDelete !== 'function') {
      return null
    }
    return (
      <Popconfirm
        title={`${e('del')}?`}
        okText={e('del')}
        cancelText={e('cancel')}
        placement='top'
        onConfirm={() => onDelete(item)}
      >
        <Button
          danger
          icon={<DeleteOutlined />}
          aria-label={`${e('del')} ${getReadableName(item)}`}
        >
          {e('del')}
        </Button>
      </Popconfirm>
    )
  }

  return (
    <section className='sp-theme-gallery' aria-label={e('themeLibrary')}>
      <div className='sp-theme-gallery-heading'>
        <div>
          <h2>{e('themeLibrary')}</h2>
          <p>{e('uiThemes')}</p>
        </div>
        <Button icon={<PlusOutlined />} onClick={onCreate}>
          {e('newTheme')}
        </Button>
      </div>
      <div className='sp-theme-gallery-toolbar'>
        <Input
          allowClear
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={e('search')}
          aria-label={e('search')}
        />
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'all', label: e('themeFilterAll') },
            { value: 'light', label: e('themeFilterLight') },
            { value: 'dark', label: e('themeFilterDark') }
          ]}
        />
      </div>
      <div className='sp-theme-card-grid'>
        {visibleThemes.map(item => {
          const uiThemeConfig = item.uiThemeConfig || {}
          const title = getReadableName(item)
          const description = item.descriptionKey
            ? e(item.descriptionKey)
            : ''
          const active = item.id === currentThemeId
          const previewing = item.id === previewThemeId
          const selected = item.id === activeItemId
          const mode = getThemeMode(item)
          const capabilities = getThemeCapabilities(item)
          const detailsLabel = capabilities.edit
            ? e('edit')
            : e('themeViewDetails')
          const selectDetails = () => selectThemeForDetails(item, onSelect)
          const cardClassName = classnames('sp-theme-card', {
            active,
            previewing,
            selected
          })
          return (
            <article key={item.id} className={cardClassName}>
              <button
                type='button'
                className='sp-theme-palette'
                onClick={selectDetails}
                aria-label={`${detailsLabel} ${title}`}
                title={`${detailsLabel} ${title}`}
                aria-pressed={selected}
                disabled={!capabilities.select}
              >
                <i style={{ background: getSwatchColor(uiThemeConfig, 'main', '#F3F6FA') }} />
                <i style={{ background: getSwatchColor(uiThemeConfig, 'main-light', '#FFFFFF') }} />
                <i style={{ background: getSwatchColor(uiThemeConfig, 'primary', '#2878E6') }} />
                <i style={{ background: getSwatchColor(uiThemeConfig, 'text', '#253249') }} />
              </button>
              <div className='sp-theme-card-title'>
                <strong>{title}</strong>
                <Tag>
                  {e(mode === 'dark' ? 'themeFilterDark' : 'themeFilterLight')}
                </Tag>
                {!capabilities.edit
                  ? <LockOutlined title={e('themeReadonly')} />
                  : null}
              </div>
              {description ? <p>{description}</p> : null}
              <div className='sp-theme-card-actions'>
                <Button
                  disabled={!capabilities.view}
                  onClick={selectDetails}
                >
                  {capabilities.edit ? e('edit') : e('themeViewDetails')}
                </Button>
                <Button
                  type={previewing ? 'primary' : 'default'}
                  disabled={!capabilities.preview}
                  onClick={() => onPreview(item.id)}
                >
                  {e('preview')}
                </Button>
                <Button
                  type={active ? 'default' : 'primary'}
                  disabled={applying || active || !capabilities.apply}
                  onClick={() => onApply(item.id)}
                >
                  {active ? e('themeApplied') : e('apply')}
                </Button>
                <Button
                  icon={<CopyOutlined />}
                  disabled={!capabilities.copy}
                  onClick={() => onCopy(item)}
                >
                  {e('copy')}
                </Button>
                {renderDelete(item, capabilities)}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
