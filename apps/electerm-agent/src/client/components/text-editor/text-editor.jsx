/**
 * default text editor for remote file
 */

import { PureComponent } from 'react'
import TextEditorForm from './text-editor-form'
import {
  CUSTOM_EDITOR_AUTO_OPEN_LS_KEY,
  CUSTOM_EDITOR_COMMAND_LS_KEY
} from './edit-with-custom-editor'
import { Spin } from 'antd'
import Modal from '../common/modal'
import resolve from '../../common/resolve'
import generate from '../../common/uid'
import { safeGetItem } from '../../common/safe-local-storage.js'
import { refsStatic } from '../common/ref'

const e = window.translate

export default class TextEditor extends PureComponent {
  state = {
    text: '',
    path: 'loading...',
    file: null,
    id: '',
    loading: true
  }

  componentDidMount () {
    refsStatic.add('text-editor', this)
  }

  componentWillUnmount () {
    refsStatic.remove('text-editor')
    return this.closeEditorSession(this.editorSession)
  }

  setStateProxy = (state, cb) => {
    if (state && typeof state.file !== 'undefined') {
      window.store.showEditor = !!state.file
    }
    return this.setState(state, cb)
  }

  isCurrentEditorSession = session => (
    Boolean(session) && this.editorSession === session
  )

  disposeExternalEditor = async session => {
    const resource = this.externalEditorResource
    if (!resource || (session && resource.session !== session)) return
    this.externalEditorResource = null
    if (resource.listenerAttached) {
      try {
        window.pre.ipcOffEvent('file-change', resource.onFileChange)
      } catch {}
    }
    const cleanup = []
    try {
      cleanup.push(window.pre.runGlobalAsync('unwatchFile', resource.path))
    } catch {}
    if (resource.temporary) {
      try {
        cleanup.push(window.fs.unlink(resource.path))
      } catch {}
    }
    await Promise.allSettled(cleanup)
  }

  closeEditorSession = async session => {
    if (!session) return
    if (this.editorSession === session) this.editorSession = null
    await this.disposeExternalEditor(session)
  }

  openEditor = async (data) => {
    const { session, ...editorState } = data
    const previousSession = this.editorSession
    if (previousSession && previousSession !== session) {
      await this.disposeExternalEditor(previousSession)
    }
    this.editorSession = session || null
    this.setStateProxy(editorState)
    if (data.id && data.file && session) {
      return this.fetchText({ ...data, session })
    }
    if (data.id === '') {
      return this.cancel()
    }
    this.setStateProxy({ loading: false })
    return false
  }

  editWithSystemEditorDone = (data) => {
    const session = data.session || this.editorSession
    if (!this.isCurrentEditorSession(session)) return false
    if (data.text === this.state.text) {
      this.setStateProxy({ loading: false })
      return false
    }
    this.setStateProxy({ text: data.text }, () => this.doSubmit(session))
    return true
  }

  fetchText = async ({
    file, session = this.editorSession
  }) => {
    if (!this.isCurrentEditorSession(session)) return false
    this.setStateProxy({
      loading: true
    })
    const {
      path,
      name,
      type
    } = file
    const p = resolve(path, name)
    this.setStateProxy({
      path: p
    })
    let text
    try {
      text = await session.readText(p, type)
    } catch (error) {
      if (this.isCurrentEditorSession(session)) {
        this.setStateProxy({ loading: false })
        window.store.onError(error)
      }
      return false
    }
    if (!this.isCurrentEditorSession(session)) return false
    const editorCommand = this.getAutoOpenCustomEditorCommand()
    this.setStateProxy({
      text,
      loading: false
    }, () => {
      if (editorCommand) {
        this.editWithCustom(editorCommand)
      }
    })
    return text
  }

  getAutoOpenCustomEditorCommand = () => {
    if (window.et.isWebApp) {
      return ''
    }
    const autoOpen = safeGetItem(CUSTOM_EDITOR_AUTO_OPEN_LS_KEY) === 'true'
    if (!autoOpen) {
      return ''
    }
    return safeGetItem(CUSTOM_EDITOR_COMMAND_LS_KEY).trim()
  }

  doSubmit = session => {
    if (!this.isCurrentEditorSession(session)) return false
    return this.handleSubmit({
      text: this.state.text
    }, true)
  }

  handleSubmit = async (res, force = false) => {
    this.setStateProxy({
      loading: true
    })
    if (!force && res.text === this.state.text) {
      return this.cancel()
    }
    const session = this.editorSession
    const { path, file } = this.state
    if (!this.isCurrentEditorSession(session) || !file) {
      this.setStateProxy({ loading: false })
      return false
    }
    const {
      type,
      mode
    } = file
    let result
    try {
      result = await session.saveText({
        mode,
        type,
        path,
        text: res.text
      })
    } catch (error) {
      if (this.isCurrentEditorSession(session)) {
        this.setStateProxy({ loading: false })
        window.store.onError(error)
      }
      return false
    }
    if (!this.isCurrentEditorSession(session)) return Boolean(result)
    if (result && !force) {
      await this.closeEditorSession(session)
      this.setStateProxy({
        id: '',
        file: null,
        text: '',
        loading: false
      })
      try {
        await session.refresh()
      } catch (error) {
        window.store.onError(error)
      }
    } else {
      this.setStateProxy({ loading: false })
    }
    return Boolean(result)
  }

  openExternalEditor = async editorCommand => {
    const session = this.editorSession
    const file = this.state.file
    this.setStateProxy({
      loading: true
    })
    if (!this.isCurrentEditorSession(session) || !file) {
      this.setStateProxy({ loading: false })
      return false
    }
    const {
      path,
      name,
      type
    } = file
    const { text } = this.state
    await this.disposeExternalEditor(session)
    if (!this.isCurrentEditorSession(session)) return false
    let tempPath
    let temporary = false
    let resource
    const removeUntrackedTemp = async () => {
      if (!temporary || !tempPath) return
      try {
        await window.fs.unlink(tempPath)
      } catch {}
    }
    try {
      if (type === 'local') {
        tempPath = window.pre.resolve(path, name)
      } else {
        temporary = true
        tempPath = window.pre.resolve(
          window.pre.tempDir,
          `electerm-temp-${generate()}-${name}`
        )
        await window.fs.writeFile(tempPath, text)
      }
      if (!this.isCurrentEditorSession(session)) {
        await removeUntrackedTemp()
        return false
      }
      resource = {
        session,
        path: tempPath,
        temporary,
        listenerAttached: false
      }
      resource.onFileChange = (event, nextText) => {
        if (this.externalEditorResource !== resource ||
          !this.isCurrentEditorSession(session)) return
        this.editWithSystemEditorDone({
          session,
          text: nextText
        })
      }
      this.externalEditorResource = resource
      await window.pre.runGlobalAsync('watchFile', tempPath)
      if (this.externalEditorResource !== resource ||
        !this.isCurrentEditorSession(session)) {
        await this.disposeExternalEditor(session)
        return false
      }
      window.pre.ipcOnEvent('file-change', resource.onFileChange)
      resource.listenerAttached = true
      if (editorCommand) {
        await window.pre.runGlobalAsync(
          'openFileWithEditor',
          tempPath,
          editorCommand
        )
      } else {
        await window.fs.openFile(tempPath)
        window.pre.showItemInFolder(tempPath)
      }
      if (this.isCurrentEditorSession(session)) {
        this.setStateProxy({ loading: false })
        return true
      }
      return false
    } catch (error) {
      if (resource) {
        await this.disposeExternalEditor(session)
      } else {
        await removeUntrackedTemp()
      }
      if (this.isCurrentEditorSession(session)) {
        this.setStateProxy({ loading: false })
        window.store.onError(error)
      }
      return false
    }
  }

  editWith = () => this.openExternalEditor()

  editWithCustom = editorCommand => this.openExternalEditor(editorCommand)

  cancel = () => {
    const session = this.editorSession
    const cleanup = this.closeEditorSession(session)
    this.setStateProxy({
      id: '',
      file: null,
      text: '',
      loading: false
    })
    return cleanup
  }

  render () {
    const {
      file,
      path,
      loading,
      text
    } = this.state
    if (!file) {
      return null
    }
    const title = `${e('edit')} ${e('remote')} ${e('file')}: ${path}`
    const propsAll = {
      footer: null,
      title,
      maskClosable: false,
      onCancel: this.cancel,
      width: '90%',
      open: true
    }
    const pops = {
      submit: this.handleSubmit,
      text,
      cancel: this.cancel,
      editWith: this.editWith,
      editWithCustom: this.editWithCustom
    }
    return (
      <Modal
        {...propsAll}
      >
        <Spin spinning={loading}>
          <TextEditorForm
            {...pops}
          />
        </Spin>
      </Modal>
    )
  }
}
