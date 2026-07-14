import { useEffect, useRef, useState } from 'react'
import SettingCol from './col'
import TerminalThemeForm from '../theme/theme-form'
import ThemeGallery from '../theme/theme-gallery'
import ThemePreview from '../theme/theme-preview'
import message from '../common/message'
import getInitItem from '../../common/init-setting-item'
import { getThemeDisplayName } from '../../common/shellpilot-ui-palettes.js'
import {
  applyThemeWithFeedback,
  createThemePreviewController,
  deleteThemeSafely
} from '../../common/theme-preview-model.js'
import {
  settingMap
} from '../../common/constants'

const e = window.translate

export default function TabThemes (props) {
  const [previewThemeId, setPreviewThemeId] = useState('')
  const [applying, setApplying] = useState(false)
  const [editorVersion, setEditorVersion] = useState(0)
  const {
    settingTab,
    settingItem,
    listProps,
    formProps,
    languageVersion,
    store
  } = props
  const currentThemeId = store.config.theme
  function setSavedTheme (themeId) {
    return store.setTheme(themeId)
  }
  const controllerRef = useRef(null)
  if (!controllerRef.current) {
    controllerRef.current = createThemePreviewController({
      setTheme: setSavedTheme,
      getCurrentThemeId: () => store.config.theme,
      onChange: setPreviewThemeId,
      onApplyingChange: setApplying
    })
  }
  const controller = controllerRef.current

  useEffect(() => {
    controller.clear()
  }, [controller, settingTab, currentThemeId])

  useEffect(() => {
    return () => controller.clear({ notify: false })
  }, [controller])

  if (settingTab !== settingMap.terminalThemes) {
    return null
  }

  const themes = Array.isArray(listProps?.list)
    ? listProps.list.filter(theme => theme && theme.id)
    : []
  const previewThemeItem = themes.find(theme => theme.id === previewThemeId) ||
    themes.find(theme => theme.id === currentThemeId) ||
    themes[0] || null

  async function applyTheme (themeId) {
    const result = await applyThemeWithFeedback({
      controller,
      themeId,
      errorMessage: e('themeApplyFailed'),
      showError: content => message.error(content)
    })
    return result
  }

  function previewTheme (themeId) {
    return controller.preview(themeId)
  }

  function selectTheme (item) {
    listProps.onClickItem(item)
  }

  function createTheme () {
    listProps.onClickItem(getInitItem([], settingMap.terminalThemes))
    setEditorVersion(version => version + 1)
  }

  function copyForEdit (item) {
    const displayName = getThemeDisplayName(item, e) || item.name || ''
    const copiedTheme = {
      ...item,
      id: '',
      name: `${displayName} ${e('copy')}`.trim(),
      readonly: false,
      type: undefined,
      uiThemeConfig: { ...(item.uiThemeConfig || {}) },
      themeConfig: { ...(item.themeConfig || {}) }
    }
    listProps.onClickItem(copiedTheme)
    setEditorVersion(version => version + 1)
  }

  async function deleteTheme (item) {
    return deleteThemeSafely({
      item,
      themes,
      currentThemeId: store.config.theme,
      selectedThemeId: settingItem.id,
      previewController: controller,
      setTheme: setSavedTheme,
      deleteTheme: target => store.delTheme(target),
      onSelect: selectTheme
    })
  }

  return (
    <div
      className='setting-tabs-terminal-themes'
    >
      <div className='sp-theme-center'>
        <SettingCol>
          <ThemeGallery
            themes={themes}
            currentThemeId={currentThemeId}
            previewThemeId={previewThemeId}
            activeItemId={settingItem.id}
            applying={applying}
            languageVersion={languageVersion}
            onPreview={previewTheme}
            onApply={applyTheme}
            onSelect={selectTheme}
            onCreate={createTheme}
            onCopy={copyForEdit}
            onDelete={deleteTheme}
          />
          <div className='sp-theme-editor-column'>
            <ThemePreview theme={previewThemeItem} />
            <TerminalThemeForm
              {...formProps}
              key={`${settingItem.id}:${editorVersion}`}
            />
          </div>
        </SettingCol>
      </div>
    </div>
  )
}
