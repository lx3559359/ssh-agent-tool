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
    const session = this.editorSession
    this.beginEditorTransition(null)
    this.editorUnmounted = true
    return (async () => {
      await this.waitForExternalEditorOpens()
      await this.disposeExternalEditor(session)
    })()
  }

  setStateProxy = (state, cb) => {
    if (state && typeof state.file !== 'undefined') {
      window.store.showEditor = !!state.file
    }
    return this.setState(state, cb)
  }

  beginEditorTransition = session => {
    if (this.externalEditorOpenOperation) {
      this.externalEditorOpenOperation.cancelled = true
      this.externalEditorOpenOperation = null
    }
    const transition = Object.freeze({
      epoch: (this.editorEpoch || 0) + 1,
      session: session || null
    })
    this.editorEpoch = transition.epoch
    this.editorSession = transition.session
    this.editorSessionReady = false
    return transition
  }

  captureEditorTransition = () => Object.freeze({
    epoch: this.editorEpoch || 0,
    session: this.editorSession || null
  })

  isCurrentEditorTransition = transition => (
    Boolean(transition) &&
    !this.editorUnmounted &&
    this.editorEpoch === transition.epoch &&
    this.editorSession === transition.session
  )

  isCurrentEditorSession = (session, transition) => (
    Boolean(session) &&
    this.editorSession === session &&
    (!transition || this.isCurrentEditorTransition(transition))
  )

  waitForExternalEditorOpens = async () => {
    while (this.externalEditorOpenTasks?.size) {
      await Promise.allSettled([...this.externalEditorOpenTasks])
    }
  }

  cleanupExternalEditorResource = resource => {
    if (!resource) return Promise.resolve()
    if (resource.cleanupPromise) return resource.cleanupPromise
    if (resource.listenerAttached) {
      resource.listenerAttached = false
      try {
        window.pre.ipcOffEvent('file-change', resource.onFileChange)
      } catch {}
    }
    resource.cleanupPromise = (async () => {
      try {
        await resource.watchSetupPromise
      } catch {}
      try {
        await window.pre.runGlobalAsync('unwatchFile', resource.path)
      } catch {}
      if (resource.temporary) {
        try {
          await window.fs.unlink(resource.path)
        } catch {}
      }
    })()
    return resource.cleanupPromise
  }

  disposeExternalEditor = async session => {
    const resource = this.externalEditorResource
    if (!resource || (session && resource.session !== session)) return
    this.externalEditorResource = null
    await this.cleanupExternalEditorResource(resource)
  }

  closeEditorSession = async (
    session,
    transition = this.captureEditorTransition(),
    { hide = false } = {}
  ) => {
    if (session && !this.isCurrentEditorSession(session, transition)) return null
    const closing = this.beginEditorTransition(null)
    if (hide) {
      this.setStateProxy({
        id: '',
        file: null,
        text: '',
        loading: false
      })
    }
    await this.waitForExternalEditorOpens()
    await this.disposeExternalEditor(session)
    if (!this.isCurrentEditorTransition(closing)) return null
    return closing
  }

  openEditor = async (data) => {
    if (this.editorUnmounted) return false
    const { session, ...editorState } = data
    const previousSession = this.editorSession
    const transition = this.beginEditorTransition(session)
    if (data.id && data.file && session) {
      this.setStateProxy({
        ...editorState,
        path: resolve(data.file.path, data.file.name),
        loading: true
      })
    } else if (data.id === '') {
      this.setStateProxy({
        id: '',
        file: null,
        text: '',
        loading: false
      })
    } else {
      this.setStateProxy({ ...editorState, loading: false })
    }
    await this.waitForExternalEditorOpens()
    if (!this.isCurrentEditorTransition(transition)) return false
    if (previousSession && previousSession !== session) {
      await this.disposeExternalEditor(previousSession)
      if (!this.isCurrentEditorTransition(transition)) return false
    }
    if (data.id && data.file && session) {
      return this.fetchText({ ...data, session, transition })
    }
    if (this.isCurrentEditorTransition(transition)) {
      this.editorSessionReady = true
    }
    return false
  }

  editWithSystemEditorDone = (data) => {
    const session = data.session || this.editorSession
    const transition = data.transition || this.captureEditorTransition()
    if (!this.isCurrentEditorSession(session, transition) ||
      !this.editorSessionReady) return false
    if (data.text === this.state.text) {
      this.setStateProxy({ loading: false })
      return false
    }
    this.setStateProxy(
      { text: data.text },
      () => this.doSubmit(session, transition)
    )
    return true
  }

  fetchText = async ({
    file,
    session = this.editorSession,
    transition = this.captureEditorTransition()
  }) => {
    if (!this.isCurrentEditorSession(session, transition)) return false
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
      if (this.isCurrentEditorSession(session, transition)) {
        this.setStateProxy({ loading: false })
        window.store.onError(error)
      }
      return false
    }
    if (!this.isCurrentEditorSession(session, transition)) return false
    this.editorSessionReady = true
    const editorCommand = this.getAutoOpenCustomEditorCommand()
    this.setStateProxy({
      text,
      loading: false
    }, () => {
      if (editorCommand && this.isCurrentEditorTransition(transition)) {
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

  doSubmit = (session, transition = this.captureEditorTransition()) => {
    if (!this.isCurrentEditorSession(session, transition)) return false
    return this.handleSubmit({
      text: this.state.text
    }, true, transition)
  }

  handleSubmit = async (
    res,
    force = false,
    expectedTransition
  ) => {
    const transition = expectedTransition || this.captureEditorTransition()
    const session = transition.session
    const { path, file } = this.state
    if (!this.isCurrentEditorSession(session, transition) ||
      !this.editorSessionReady || !file) {
      this.setStateProxy({ loading: false })
      return false
    }
    this.setStateProxy({
      loading: true
    })
    if (!force && res.text === this.state.text) {
      return this.cancel()
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
      if (this.isCurrentEditorSession(session, transition)) {
        this.setStateProxy({ loading: false })
        window.store.onError(error)
      }
      return false
    }
    if (!this.isCurrentEditorSession(session, transition)) {
      return Boolean(result)
    }
    if (result && !force) {
      const closing = await this.closeEditorSession(
        session,
        transition,
        { hide: true }
      )
      if (!closing) return Boolean(result)
      try {
        await session.refresh()
      } catch (error) {
        if (this.isCurrentEditorTransition(closing)) {
          window.store.onError(error)
        }
      }
      if (!this.isCurrentEditorTransition(closing)) return Boolean(result)
    } else {
      if (this.isCurrentEditorTransition(transition)) {
        this.setStateProxy({ loading: false })
      }
    }
    return Boolean(result)
  }

  openExternalEditor = editorCommand => {
    const session = this.editorSession
    const transition = this.captureEditorTransition()
    const file = this.state.file
    if (this.externalEditorOpenOperation) {
      this.externalEditorOpenOperation.cancelled = true
    }
    const operation = { cancelled: false }
    this.externalEditorOpenOperation = operation
    const precedingTasks = [...(this.externalEditorOpenTasks || [])]
    const ownsOperation = () => (
      !operation.cancelled &&
      this.externalEditorOpenOperation === operation
    )
    const isCurrentOpen = () => (
      ownsOperation() &&
      this.isCurrentEditorSession(session, transition)
    )
    const task = (async () => {
      let opened = false
      let tempPath
      let temporary = false
      let resource
      const clearResourceOwnership = () => {
        if (this.externalEditorResource === resource) {
          this.externalEditorResource = null
        }
      }
      const removeUntrackedTemp = async () => {
        if (!temporary || !tempPath) return
        try {
          await window.fs.unlink(tempPath)
        } catch {}
      }
      this.setStateProxy({
        loading: true
      })
      if (!isCurrentOpen() || !this.editorSessionReady || !file) {
        if (ownsOperation() && this.isCurrentEditorTransition(transition)) {
          this.setStateProxy({ loading: false })
        }
        return false
      }
      const {
        path,
        name,
        type
      } = file
      const { text } = this.state
      await this.disposeExternalEditor(session)
      if (!isCurrentOpen()) return false
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
        if (!isCurrentOpen()) {
          await removeUntrackedTemp()
          return false
        }
        if (precedingTasks.length) {
          await Promise.allSettled(precedingTasks)
        }
        if (!isCurrentOpen()) {
          await removeUntrackedTemp()
          return false
        }
        resource = {
          session,
          transition,
          operation,
          path: tempPath,
          temporary,
          listenerAttached: false,
          cleanupPromise: null
        }
        resource.onFileChange = (event, nextText) => {
          if (this.externalEditorResource !== resource ||
            !isCurrentOpen()) return
          this.editWithSystemEditorDone({
            session,
            transition,
            text: nextText
          })
        }
        this.externalEditorResource = resource
        resource.watchSetupPromise = Promise.resolve().then(() => (
          window.pre.runGlobalAsync('watchFile', tempPath)
        ))
        await resource.watchSetupPromise
        if (this.externalEditorResource !== resource || !isCurrentOpen()) {
          clearResourceOwnership()
          await this.cleanupExternalEditorResource(resource)
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
          if (!isCurrentOpen()) {
            clearResourceOwnership()
            await this.cleanupExternalEditorResource(resource)
            return false
          }
          window.pre.showItemInFolder(tempPath)
        }
        if (isCurrentOpen()) {
          opened = true
          this.setStateProxy({ loading: false })
          return true
        }
        return false
      } catch (error) {
        if (resource) {
          clearResourceOwnership()
          await this.cleanupExternalEditorResource(resource)
        } else {
          await removeUntrackedTemp()
        }
        if (isCurrentOpen()) {
          this.setStateProxy({ loading: false })
          window.store.onError(error)
        }
        return false
      } finally {
        if (!opened && this.externalEditorOpenOperation === operation) {
          this.externalEditorOpenOperation = null
        }
      }
    })()
    if (!this.externalEditorOpenTasks) {
      this.externalEditorOpenTasks = new Set()
    }
    const trackedTask = task.finally(() => {
      this.externalEditorOpenTasks.delete(task)
      if (!this.externalEditorOpenTasks.size) {
        this.externalEditorOpenTasks = null
      }
    })
    this.externalEditorOpenTasks.add(task)
    return trackedTask
  }

  editWith = () => this.openExternalEditor()

  editWithCustom = editorCommand => this.openExternalEditor(editorCommand)

  cancel = () => {
    const session = this.editorSession
    const transition = this.captureEditorTransition()
    return this.closeEditorSession(session, transition, { hide: true })
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
      loading,
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
