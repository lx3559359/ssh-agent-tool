import { Component } from 'react'
import resolve from '../../common/resolve'
import { typeMap } from '../../common/constants'
import { refs, refsStatic } from '../common/ref'
import Remote2RemoteHandler from './remote2remote-handler'
import {
  buildCrossHostSourceIdentity,
  buildTransferSourceEndpointKey
} from './file-transfer-safety.js'

const handlerRefId = 'remote2remote-handlers'

export default class Remote2RemoteHandlers extends Component {
  constructor (props) {
    super(props)
    this.handlers = new Map()
  }

  componentDidMount () {
    refsStatic.add(handlerRefId, this)
  }

  componentWillUnmount () {
    refsStatic.remove(handlerRefId)
    this.handlers.forEach(handler => {
      handler.stop()
    })
    this.handlers.clear()
  }

  canHandle = ({ fromFile, targetTab }) => {
    return fromFile?.type === typeMap.remote &&
      Boolean(fromFile?.tabId) &&
      Boolean(targetTab?.id) &&
      fromFile.tabId !== targetTab.id
  }

  createHandler = ({ fromFile, targetPathBase, targetTab }) => {
    const sourceCapability = refs.get('sftp-' + fromFile.tabId)
    if (!sourceCapability?.getSftpSafetyEndpoint) {
      throw new Error('跨主机传输无法确认来源 SFTP 安全端点，已停止操作。')
    }
    const sourceEndpointKey = buildTransferSourceEndpointKey(
      sourceCapability.getSftpSafetyEndpoint()
    )
    const sourceIdentity = buildCrossHostSourceIdentity({
      sourceEndpointKey,
      path: resolve(fromFile.path, fromFile.name),
      file: fromFile
    })
    const handler = new Remote2RemoteHandler({
      fromFile,
      toPath: resolve(targetPathBase, fromFile.name),
      sourceHost: fromFile.host,
      sourceTabId: fromFile.tabId,
      sourceEndpointKey,
      sourceIdentity,
      title: fromFile.title,
      tabType: fromFile.tabType,
      targetHost: targetTab.host,
      targetTabId: targetTab.id,
      targetTitle: targetTab.title || targetTab.host,
      targetTabType: targetTab.type,
      onDone: this.onDone
    })
    this.handlers.set(handler.id, handler)
    handler.start()
  }

  onDone = ({ id, error }) => {
    this.handlers.delete(id)
    if (error) {
      window.store.onError(new Error(error))
    }
  }

  onRemote2RemoteDrop = ({ fromFiles, toFile, targetTab }) => {
    const targetPathBase = resolve(toFile.path, toFile.name)
    let handled = false
    for (const fromFile of fromFiles) {
      if (!this.canHandle({ fromFile, targetTab })) {
        continue
      }
      handled = true
      this.createHandler({
        fromFile,
        targetPathBase,
        targetTab
      })
    }
    return handled
  }

  render () {
    return null
  }
}
