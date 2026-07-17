import { Component } from 'react'
import copy from 'json-deep-copy'
import { isFunction } from 'lodash-es'
import generate from '../../common/uid'
import { typeMap, transferTypeMap, fileOperationsMap, fileActions } from '../../common/constants'
import format, { computeLeftTime, computePassedTime } from './transfer-speed-format'
import {
  getLocalFileInfo,
  getRemoteFileInfo,
  getFolderFromFilePath
} from '../sftp/file-read'
import resolve from '../../common/resolve'
import { refsTransfers, refsStatic, refs } from '../common/ref'
import {
  createTransferRetryState,
  shouldRetryTransfer
} from '../../common/transfer-retry'
import {
  captureLocalTransferSource,
  createTransferAttemptGuard,
  createTransferSafetyController,
  getTransferSafetyCompletionFailure,
  resetCrossHostSourceAttemptForRetry,
  resolveTransferRuntimeTransport,
  shouldUseLegacyZipOptimization,
  verifyCrossHostSourceContent,
  verifyCrossHostSourcePreflight,
  verifyLocalTransferSource
} from './file-transfer-safety.js'
import {
  zipCmd,
  unzipCmd,
  rmCmd,
  mvCmd,
  mkdirCmd
} from './zip'
import './transfer.styl'

const { assign } = Object

export default class TransportAction extends Component {
  constructor (props) {
    super(props)
    const {
      id,
      transferBatch = '',
      tabId
    } = props.transfer
    const sftp = refs.get('sftp-' + tabId)
    this.id = `tr-${transferBatch}-${id}`
    this.tabId = tabId
    refsTransfers.add(this.id, this)
    this.total = 0
    this.transferred = 0
    this.currentProgress = 1
    this.isFtp = sftp?.type === 'ftp'
    this.terminalId = sftp?.terminalId
    this.transferRetryState = createTransferRetryState(props.transfer?.retry)
    this.transferAttempts = createTransferAttemptGuard()
    this.subTransports = new Set()
    this.localSourceDescriptor = props.transfer?.sourceDescriptor || null
    this.transferSafety = createTransferSafetyController({
      getTransfer: this.getTransferSafetyInput,
      getCapability: () => refs.get('sftp-' + this.tabId),
      cancelTransport: this.cancelProtectedTransport
    })
  }

  componentDidMount () {
    if (this.props.inited) {
      this.initTransfer()
    }
  }

  componentDidUpdate (prevProps) {
    if (
      prevProps.inited !== this.props.inited &&
      this.props.inited === true
    ) {
      this.initTransfer()
    }
    if (
      this.props.pausing !== prevProps.pausing
    ) {
      if (this.props.pausing) {
        this.pause()
      } else {
        this.resume()
      }
    }
  }

  componentWillUnmount () {
    this.onCancel = true
    this.transferAttempts.invalidate(this.activeAttemptToken)
    this.activeAttemptToken = null
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.transport && this.transport.destroy()
    this.transport = null
    this.destroySubTransports()
    Promise.resolve(this.transferSafety.dispose()).catch(error => {
      window.store?.onError(error)
    })
    this.fromFile = null
    refsTransfers.remove(this.id)
  }

  getTransferSafetyInput = () => ({
    ...this.props.transfer,
    fromFile: this.props.transfer.fromFile || this.fromFile,
    finalToPath: this.newPath || this.props.transfer.toPath,
    conflictPolicy: this.conflictPolicy,
    isFtp: this.isFtp,
    sourceDescriptor: this.localSourceDescriptor
  })

  getLocalSourceTransfer = (transfer = this.props.transfer) => ({
    ...transfer,
    fromFile: transfer.fromFile || this.fromFile,
    finalToPath: this.newPath || transfer.toPath,
    conflictPolicy: this.conflictPolicy,
    isFtp: this.isFtp
  })

  prepareLocalSource = async (transfer = this.props.transfer) => {
    const sourceTransfer = this.getLocalSourceTransfer(transfer)
    if (this.localSourceDescriptor) {
      await verifyLocalTransferSource({
        transfer: sourceTransfer,
        sourceDescriptor: this.localSourceDescriptor,
        describeLocal: window.fs.describeTransferEntry
      })
      return
    }
    this.localSourceDescriptor = await captureLocalTransferSource({
      transfer: sourceTransfer,
      describeLocal: window.fs.describeTransferEntry
    })
  }

  verifyLocalSource = (transfer = this.props.transfer) => {
    return verifyLocalTransferSource({
      transfer: this.getLocalSourceTransfer(transfer),
      sourceDescriptor: this.localSourceDescriptor,
      describeLocal: window.fs.describeTransferEntry
    })
  }

  getTransferRuntimeTransport = (transfer = this.props.transfer) => {
    return resolveTransferRuntimeTransport({
      transfer,
      sourcePin: this.crossHostSourcePin,
      getCapability: tabId => refs.get('sftp-' + tabId)
    })
  }

  localCheckExist = (path) => {
    return getLocalFileInfo(path)
      .catch(() => null)
  }

  remoteCheckExist = (path, tabId) => {
    const sftp = refs.get('sftp-' + tabId)?.sftp
    if (!sftp) {
      console.log('remoteCheckExist error', 'sftp not exist')
      return false
    }
    return getRemoteFileInfo(sftp, path)
      .then(r => r)
      .catch((e) => {
        console.log('remoteCheckExist error', e)
        return false
      })
  }

  checkExist = (type, path, tabId) => {
    return this[type + 'CheckExist'](path, tabId)
  }

  update = (up) => {
    const { id } = this.props.transfer
    refsStatic.get('transfer-queue')?.addToQueue(
      'update',
      id,
      up
    )
  }

  tagTransferError = (id, errorMsg) => {
    // this.clear()
    const { store } = window
    const { fileTransfers } = store
    const index = fileTransfers.findIndex(d => d.id === id)
    if (index < 0) {
      return
    }

    const tr = copy(fileTransfers[index])
    assign(tr, {
      host: tr.host,
      error: errorMsg,
      finishTime: Date.now()
    })
    store.addTransferHistory(tr)
    refsStatic.get('transfer-queue')?.addToQueue(
      'delete',
      id
    )
  }

  // insert = (insts) => {
  //   const { fileTransfers } = window.store
  //   const { index } = this.props
  //   fileTransfers.splice(index, 1, ...insts)
  // }

  remoteList = () => {
    window.store.remoteList(this.tabId)
  }

  localList = () => {
    window.store.localList(this.tabId)
  }

  onEnd = async (update = {}, attemptToken) => {
    const protectedAttempt = attemptToken !== undefined
    if (protectedAttempt && !this.transferAttempts.beginCompletion(attemptToken)) {
      return
    }
    if (this.onCancel) {
      if (protectedAttempt) this.transferAttempts.finishCompletion(attemptToken)
      return
    }
    if (this.finishing) {
      if (protectedAttempt) this.transferAttempts.finishCompletion(attemptToken)
      return
    }
    this.finishing = true
    let failed = update.status === 'exception' || Boolean(update.error)
    if (!failed) {
      try {
        await this.verifyLocalSource()
        if (this.props.transfer.remote2remoteStep === 1) {
          this.verifiedCrossHostSource = await verifyCrossHostSourceContent({
            transfer: this.props.transfer,
            sourcePin: this.crossHostSourcePin,
            preflight: this.crossHostSourcePreflight,
            describeLocal: window.fs.describeTransferEntry
          })
        }
      } catch (error) {
        failed = true
        update = {
          ...update,
          status: 'exception',
          error: error.message
        }
      }
    }
    try {
      const completed = await this.transferSafety.complete({
        exitCode: failed ? 1 : 0
      })
      const completionFailure = getTransferSafetyCompletionFailure(completed)
      if (completionFailure) {
        update = {
          ...update,
          ...completionFailure
        }
      }
    } catch (error) {
      update = {
        ...update,
        status: 'exception',
        error: error.message
      }
      window.store.onError(error)
    }
    const {
      transfer,
      config
    } = this.props
    const {
      typeTo
    } = transfer
    const finishTime = Date.now()
    if (!config.disableTransferHistory) {
      const fromFile = transfer.fromFile || this.fromFile
      const size = update.size ?? update.transferred ?? fromFile.size
      const r = copy(transfer)
      assign(r, {
        ...(this.verifiedCrossHostSource
          ? {
              verifiedSourceEndpointKey: this.verifiedCrossHostSource.verifiedSourceEndpointKey,
              verifiedSourceIdentity: this.verifiedCrossHostSource.verifiedSourceIdentity,
              verifiedSourceContentIdentity: this.verifiedCrossHostSource.verifiedSourceContentIdentity,
              verifiedSourceDescriptor: this.verifiedCrossHostSource.verifiedSourceDescriptor
            }
          : {}),
        finishTime,
        startTime: this.startTime,
        size,
        next: null,
        speed: format(size, this?.startTime),
        status: update.status || 'success',
        error: update.error || ''
      })
      window.store.addTransferHistory(
        r
      )
    }
    const cbs = [
      this[typeTo + 'List']
    ]
    const cb = () => {
      cbs.forEach(cb => cb())
    }
    if (protectedAttempt) this.transferAttempts.finishCompletion(attemptToken)
    this.finishTransfer(cb).catch(error => window.store.onError(error))
  }

  onData = (transferred, attemptToken) => {
    if (attemptToken !== undefined && !this.transferAttempts.isCurrent(attemptToken)) {
      return
    }
    if (this.onCancel) {
      return
    }
    const { transfer } = this.props
    const fromFile = transfer.fromFile || this.fromFile || {}
    const transferredValue = typeof transferred === 'object' && transferred !== null
      ? transferred.transferred
      : transferred
    const total = typeof transferred === 'object' && transferred !== null
      ? (transferred.total || fromFile.size || 0)
      : (fromFile.size || 0)
    const up = {}
    let percent = total === 0
      ? 100
      : Math.floor(100 * transferredValue / total)
    percent = percent >= 100 ? 100 : percent
    this.total = total
    up.percent = percent
    up.status = 'active'
    up.transferred = transferredValue
    up.startTime = this.startTime
    up.speed = format(transferredValue, up.startTime)
    assign(
      up,
      computeLeftTime(transferredValue, total, up.startTime)
    )
    up.passedTime = computePassedTime(up.startTime)
    this.update(up)
  }

  stopTransport = () => {
    this.onCancel = true
    this.transferAttempts.invalidate(this.activeAttemptToken)
    this.activeAttemptToken = null
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.transport && this.transport.destroy()
    this.transport = null
    this.destroySubTransports()
  }

  destroySubTransports = () => {
    for (const transport of this.subTransports) transport?.destroy()
    this.subTransports.clear()
  }

  removeTransferFromQueue = async () => {
    const queue = refsStatic.get('transfer-queue')
    if (queue) {
      await queue.addToQueue('delete', this.props.transfer.id)
    } else {
      const { fileTransfers } = window.store
      const index = fileTransfers.findIndex(item => (
        item.id === this.props.transfer.id
      ))
      if (index >= 0) fileTransfers.splice(index, 1)
    }
  }

  finishTransfer = async (callback) => {
    this.stopTransport()
    if (!this.queueRemovalPromise) {
      this.queueRemoved = true
      this.queueRemovalPromise = this.removeTransferFromQueue()
    }
    await this.queueRemovalPromise
    if (isFunction(callback)) {
      callback()
    }
  }

  cancelProtectedTransport = async () => {
    await this.finishTransfer()
  }

  cancelAndWait = () => {
    if (this.cancellationPromise) return this.cancellationPromise
    this.userCancelling = true
    this.cancellationPromise = (async () => {
      try {
        await this.transferSafety.cancel()
      } finally {
        await this.finishTransfer()
      }
    })()
    return this.cancellationPromise
  }

  cancel = async (callback) => {
    try {
      await this.cancelAndWait()
    } catch (error) {
      window.store.onError(error)
    } finally {
      if (isFunction(callback)) callback()
    }
  }

  pause = () => {
    this.transport?.pause()
  }

  resume = () => {
    this.transport?.resume()
  }

  mvOrCp = async () => {
    const attemptToken = this.transferAttempts.start()
    if (attemptToken === null) return
    this.activeAttemptToken = attemptToken
    const {
      transfer
    } = this.props
    const {
      fromPath,
      toPath,
      typeFrom,
      operation // 'mv' or 'cp'
    } = transfer

    // Use this.newPath when set (e.g. user chose rename from conflict modal)
    let finalToPath = this.newPath || toPath

    // Check if it's a copy operation to the same path (no rename decision pending)
    if (!this.newPath && fromPath === toPath && operation === fileOperationsMap.cp) {
      finalToPath = this.handleRename(toPath, typeFrom === typeMap.remote).newPath
      transfer.toPath = finalToPath
      this.update({
        toPath: finalToPath
      })
    }
    if (typeFrom === typeMap.local) {
      try {
        await window.fs[operation](fromPath, finalToPath)
        return this.onEnd({}, attemptToken)
      } catch (e) {
        return this.onError(e, attemptToken)
      }
    }
    const sftp = this.getTransferRuntimeTransport(transfer).sftp
    try {
      await this.transferSafety.begin()
      await sftp[operation](fromPath, finalToPath)
      return this.onEnd({}, attemptToken)
    } catch (e) {
      return this.onError(e, attemptToken)
    }
  }

  transferFile = async (transfer = this.props.transfer, onEnd, attemptToken) => {
    const {
      fromPath,
      typeFrom,
      toFile = {}
    } = transfer
    const toPath = shouldUseLegacyZipOptimization({
      zip: transfer.zip,
      isFtp: this.isFtp
    })
      ? transfer.toPath
      : this.newPath || transfer.toPath
    const fromFile = transfer.fromFile || this.fromFile
    const fromMode = fromFile.mode
    const transferType = typeFrom === typeMap.local ? transferTypeMap.upload : transferTypeMap.download
    const isDown = transferType === transferTypeMap.download
    const localPath = isDown
      ? toPath
      : fromPath
    const remotePath = isDown
      ? fromPath
      : toPath
    const mode = toFile.mode || fromMode
    const sftp = this.getTransferRuntimeTransport(transfer).sftp
    const handleEnd = onEnd
      ? update => onEnd(update, attemptToken)
      : update => this.onEnd(update, attemptToken)
    try {
      const transport = await sftp[transferType]({
        remotePath,
        localPath,
        isDirectory: !!fromFile.isDirectory,
        options: { mode },
        onData: transferred => this.onData(transferred, attemptToken),
        onError: error => this.onError(error, attemptToken),
        onEnd: handleEnd
      })
      if (!this.transferAttempts.isCurrent(attemptToken)) {
        transport?.destroy()
        return
      }
      this.transport = transport
    } catch (e) {
      this.onError(e, attemptToken)
    }
  }

  isTransferAction = (action) => {
    return action.includes('rename') || action === 'transfer'
  }

  initTransfer = async () => {
    if (this.started) {
      return
    }
    this.started = true
    const { transfer } = this.props
    const {
      id,
      typeFrom,
      typeTo,
      fromPath,
      toPath,
      operation
    } = transfer

    if (
      typeFrom === typeTo &&
      fromPath === toPath &&
      operation === fileOperationsMap.mv
    ) {
      return this.cancel()
    }

    const t = Date.now()
    this.update({
      startTime: t
    })
    this.startTime = t

    const fromFile = transfer.fromFile
      ? transfer.fromFile
      : await this.checkExist(typeFrom, fromPath, this.tabId)
    if (!fromFile) {
      return this.tagTransferError(id, 'file not exist')
    }
    this.fromFile = fromFile
    this.update({
      fromFile
    })
    if (fromPath === toPath && typeFrom === typeTo) {
      return this.mvOrCp()
    }
    const hasConflict = await this.checkConflict()
    if (hasConflict) {
      return
    }

    if (typeFrom === typeTo) {
      return this.mvOrCp()
    }
    this.startTransfer()
  }

  checkConflict = async (transfer = this.props.transfer) => {
    const {
      typeTo,
      toPath,
      tabId
    } = transfer
    const transferStillExists = window.store.fileTransfers.some(t => t.id === transfer.id)
    if (!transferStillExists) {
      return false
    }
    const toFile = await this.checkExist(typeTo, toPath, tabId)

    if (toFile) {
      this.update({
        toFile
      })
      if (transfer.resolvePolicy) {
        this.onDecision(transfer.resolvePolicy)
        return true
      }
      if (this.resolvePolicy) {
        this.onDecision(this.resolvePolicy)
        return true
      }
      const transferWithToFile = {
        ...copy(transfer),
        toFile,
        fromFile: copy(transfer.fromFile || this.fromFile)
      }
      refsStatic.get('transfer-conflict')?.addConflict(transferWithToFile)
      return true
    }
    return false
  }

  onDecision = (policy) => {
    this.conflictPolicy = policy
    if (policy === fileActions.skip || policy === fileActions.cancel) {
      return this.onEnd()
    }

    if (policy === fileActions.rename) {
      const {
        typeTo,
        toPath
      } = this.props.transfer
      this.oldPath = toPath
      const { newPath, newName } = this.handleRename(toPath, typeTo === typeMap.remote)
      this.update({
        toPath: newPath
      })
      this.newPath = newPath
      this.newName = newName
    }

    const { typeFrom, typeTo } = this.props.transfer
    if (typeFrom === typeTo) {
      return this.mvOrCp()
    }
    this.startTransfer()
  }

  zipTransferFolder = async (attemptToken) => {
    const {
      transfer
    } = this.props
    const {
      fromPath,
      typeFrom
    } = transfer
    const toPath = this.oldPath || transfer.toPath
    let p
    let isFromRemote
    if (typeFrom === typeMap.local) {
      isFromRemote = false
      p = await window.fs.zipFolder(fromPath)
    } else {
      isFromRemote = true
      const terminalId = refs.get('sftp-' + this.tabId)?.terminalId
      p = await zipCmd(terminalId, fromPath)
    }
    this.zipSrc = p
    const { name } = getFolderFromFilePath(p, isFromRemote)
    const { path } = getFolderFromFilePath(toPath, !isFromRemote)
    const nTo = resolve(path, name)
    this.zipPath = nTo
    const newTrans1 = {
      ...copy(transfer),
      toPath: nTo,
      fromPath: p
    }
    this.transferFile(newTrans1, this.unzipFile, attemptToken)
  }

  unzipFile = async (update, attemptToken) => {
    if (!this.transferAttempts.isCurrent(attemptToken)) return
    const { transfer } = this.props
    const {
      typeTo
    } = transfer
    const toPath = this.zipPath
    const fromPath = this.zipSrc
    const isToRemote = typeTo === typeMap.remote
    const {
      path,
      name,
      targetPath
    } = this.buildUnzipPath(transfer)
    const {
      newName,
      terminalId
    } = this
    if (isToRemote) {
      if (newName) {
        await mkdirCmd(terminalId, path)
      }
      await unzipCmd(terminalId, toPath, path)
      if (newName) {
        const mvFrom = resolve(path, name)
        const mvTo = resolve(targetPath, newName)
        await mvCmd(terminalId, mvFrom, mvTo)
      }
    } else {
      if (newName) {
        await window.fs.mkdir(path)
      }
      await window.fs.unzipFile(toPath, path)
      if (newName) {
        const mvFrom = resolve(path, name)
        const mvTo = resolve(targetPath, newName)
        await window.fs.mv(mvFrom, mvTo)
      }
    }
    await rmCmd(terminalId, !isToRemote ? fromPath : toPath)
    await window.fs.rmrf(!isToRemote ? toPath : fromPath)
    if (newName) {
      if (isToRemote) {
        await rmCmd(terminalId, path)
      } else {
        await window.fs.rmrf(path)
      }
    }
    this.onEnd({}, attemptToken)
  }

  buildUnzipPath = (transfer) => {
    const {
      typeTo
    } = transfer
    const isToRemote = typeTo === typeMap.remote
    const toPath = this.oldPath || transfer.toPath
    const {
      newName
    } = this
    const { path } = getFolderFromFilePath(toPath, isToRemote)
    const oldName = getFolderFromFilePath(toPath, isToRemote).name
    const np = newName
      ? resolve(path, 'temp-' + newName)
      : path
    return {
      targetPath: path,
      path: np,
      name: oldName
    }
  }

  startTransfer = async () => {
    const attemptToken = this.transferAttempts.start()
    if (attemptToken === null) return
    this.activeAttemptToken = attemptToken
    try {
      const transfer = this.props.transfer
      const { fromFile = this.fromFile, zip } = transfer
      if (!fromFile) {
        this.transferAttempts.invalidate(attemptToken)
        return
      }
      await this.prepareLocalSource(transfer)
      if (transfer.remote2remoteStep === 1 && !this.crossHostSourcePin) {
        const sourcePreflight = await verifyCrossHostSourcePreflight({
          transfer: {
            ...transfer,
            fromFile
          },
          getCapability: sourceTabId => refs.get('sftp-' + sourceTabId)
        })
        this.crossHostSourcePin = sourcePreflight.runtime
        this.crossHostSourcePreflight = sourcePreflight.verified
        this.verifiedCrossHostSource = null
      }
      await this.transferSafety.begin()
      if (!fromFile.isDirectory) {
        return await this.transferFile(transfer, undefined, attemptToken)
      }
      if (shouldUseLegacyZipOptimization({ zip, isFtp: this.isFtp })) {
        return await this.zipTransferFolder(attemptToken)
      }
      if (!this.isFtp) {
        return await this.transferFile(transfer, undefined, attemptToken)
      } else {
        await this.transferFolderRecursive(this.getDefaultTransfer(), true, attemptToken)
      }
      this.onEnd({
        transferred: this.transferred,
        size: this.total
      }, attemptToken)
    } catch (e) {
      this.onError(e, attemptToken)
    }
  }

  assertCurrentAttempt = (attemptToken) => {
    if (attemptToken !== undefined &&
      !this.transferAttempts.isCurrent(attemptToken)) {
      const error = new Error('传输尝试已失效。')
      error.code = 'STALE_TRANSFER_ATTEMPT'
      throw error
    }
  }

  list = async (type, path, tabId, transfer = this.props.transfer, attemptToken) => {
    this.assertCurrentAttempt(attemptToken)
    const runtime = this.getTransferRuntimeTransport({
      ...transfer,
      tabId
    })
    if (transfer.remote2remoteStep === 1 && type === typeMap.remote) {
      if (!runtime.capability?.sftpList) {
        throw new Error('跨主机传输来源目录读取能力不可用，已停止下载。')
      }
      const result = await runtime.capability.sftpList(runtime.sftp, path)
      this.assertCurrentAttempt(attemptToken)
      return result
    }
    const result = await runtime.capability[type + 'List'](true, path)
    this.assertCurrentAttempt(attemptToken)
    return result
  }

  handleRename = (fromPath, isRemote) => {
    const { path, base, ext } = getFolderFromFilePath(fromPath, isRemote)
    const newName = `${base}(rename-${generate()})${ext ? '.' + ext : ''}`
    return {
      newPath: resolve(path, newName),
      newName
    }
  }

  onFolderData = (transferred, attemptToken) => {
    if (attemptToken !== undefined &&
      !this.transferAttempts.isCurrent(attemptToken)) return
    if (this.onCancel) {
      return
    }
    this.transferred += transferred
    const up = {}

    // Increment progress slightly with each file/folder (but never exceed 99%)
    this.currentProgress = Math.min(this.currentProgress + 0.2, 99)

    up.percent = Math.floor(this.currentProgress)
    up.status = 'active'
    up.transferred = this.transferred
    up.startTime = this.startTime
    up.speed = format(this.transferred, up.startTime)
    assign(
      up,
      computeLeftTime(this.transferred, this.total, up.startTime)
    )
    up.passedTime = computePassedTime(up.startTime)
    this.update(up)
  }

  transferFileAsSubTransfer = async (transfer, attemptToken) => {
    this.assertCurrentAttempt(attemptToken)
    const {
      fromPath,
      toPath,
      typeFrom,
      fromFile: {
        mode: fromMode,
        size: fileSize
      },
      toFile = {}
    } = transfer

    const transferType = typeFrom === typeMap.local ? transferTypeMap.upload : transferTypeMap.download
    const isDown = transferType === transferTypeMap.download
    const localPath = isDown ? toPath : fromPath
    const remotePath = isDown ? fromPath : toPath
    const mode = toFile.mode || fromMode
    const sftp = this.getTransferRuntimeTransport(transfer).sftp

    return new Promise((resolve, reject) => {
      let transport

      const onSubEnd = () => {
        if (!this.transferAttempts.isCurrent(attemptToken)) {
          transport?.destroy()
          const error = new Error('传输尝试已失效。')
          error.code = 'STALE_TRANSFER_ATTEMPT'
          return reject(error)
        }
        if (fileSize) {
          this.onFolderData(fileSize, attemptToken)
        }
        if (transport) {
          this.subTransports.delete(transport)
          transport.destroy()
          transport = null
        }
        resolve(fileSize)
      }

      const onSubError = (error) => {
        if (transport) {
          this.subTransports.delete(transport)
          transport.destroy()
          transport = null
        }
        if (!this.transferAttempts.isCurrent(attemptToken)) {
          const stale = new Error('传输尝试已失效。')
          stale.code = 'STALE_TRANSFER_ATTEMPT'
          reject(stale)
          return
        }
        reject(error)
      }

      sftp[transferType]({
        remotePath,
        localPath,
        options: { mode },
        onData: () => {},
        onError: onSubError,
        onEnd: onSubEnd
      }).then(transportInstance => {
        if (!this.transferAttempts.isCurrent(attemptToken)) {
          transportInstance?.destroy()
          const error = new Error('传输尝试已失效。')
          error.code = 'STALE_TRANSFER_ATTEMPT'
          reject(error)
          return
        }
        transport = transportInstance
        this.subTransports.add(transportInstance)
      }).catch(onSubError)
    })
  }

  getDefaultTransfer = () => {
    const transfer = this.props.transfer
    if (this.newPath) {
      const modifiedTransfer = {
        ...transfer,
        toPath: this.newPath,
        isRenamed: true
      }
      return modifiedTransfer
    }
    return transfer
  }

  // Handle file transfers in parallel batches
  transferFiles = async (files, batch, transfer, attemptToken) => {
    this.assertCurrentAttempt(attemptToken)
    if (this.onCancel) {
      return
    }

    const { fromPath, toPath } = transfer

    // Process files in batches
    for (let i = 0; i < files.length; i += batch) {
      if (this.onCancel) {
        return
      }

      const batchFiles = files.slice(i, i + batch)
      const promises = batchFiles.map(file => {
        if (this.onCancel) {
          return Promise.resolve(0)
        }

        const fromItemPath = resolve(fromPath, file.name)
        const toItemPath = resolve(toPath, file.name)

        const itemTransfer = {
          ...transfer,
          fromPath: fromItemPath,
          toPath: toItemPath,
          fromFile: file
        }

        return this.transferFileAsSubTransfer(itemTransfer, attemptToken)
      })

      // Wait for all files in batch to complete
      const results = await Promise.all(promises)
      this.assertCurrentAttempt(attemptToken)

      // Update progress once for the entire batch
      const batchTotalSize = results.reduce((sum, size) => sum + size, 0)
      if (batchTotalSize > 0) {
        this.onFolderData(batchTotalSize, attemptToken)
      }
    }
  }

  // Handle folder transfers sequentially to prevent concurrency explosion
  transferFolders = async (folders, batch, transfer, attemptToken) => {
    this.assertCurrentAttempt(attemptToken)
    if (this.onCancel) {
      return
    }

    const { fromPath, toPath } = transfer

    // Step 1: Create all folders concurrently in batches
    for (let i = 0; i < folders.length; i += batch) {
      if (this.onCancel) {
        return
      }

      const batchFolders = folders.slice(i, i + batch)
      const createFolderPromises = batchFolders.map(folder => {
        const toItemPath = resolve(toPath, folder.name)

        // Create folder itself (don't process contents)
        const createTransfer = {
          ...transfer,
          toPath: toItemPath,
          fromFile: folder
        }

        return this.mkdir(createTransfer, attemptToken)
      })

      // Create all folders in this batch concurrently
      await Promise.all(createFolderPromises)
      this.assertCurrentAttempt(attemptToken)
    }

    // Step 2: Process contents of each folder sequentially
    for (const folder of folders) {
      if (this.onCancel) {
        return
      }

      const fromItemPath = resolve(fromPath, folder.name)
      const toItemPath = resolve(toPath, folder.name)

      const itemTransfer = {
        ...transfer,
        fromPath: fromItemPath,
        toPath: toItemPath,
        fromFile: folder
      }

      // Transfer folder contents (set createFolder = false since we already created it)
      await this.transferFolderRecursive(itemTransfer, false, attemptToken)
    }
  }

  // Main recursive function using the separate handlers
  transferFolderRecursive = async (transfer = this.getDefaultTransfer(), createFolder = true, attemptToken) => {
    this.assertCurrentAttempt(attemptToken)
    if (this.onCancel) {
      return
    }
    const {
      fromPath,
      typeFrom,
      tabId,
      toFile,
      isRenamed
    } = transfer

    if (createFolder && (!toFile || isRenamed)) {
      const folderCreated = await this.mkdir(transfer, attemptToken)
      if (!folderCreated) {
        return
      }
    }

    const list = await this.list(typeFrom, fromPath, tabId, transfer, attemptToken)
    const bigFileSize = 1024 * 1024
    const smallFilesBatch = 30
    const BigFilesBatch = 3
    const foldersBatch = 50

    const {
      folders,
      smallFiles,
      largeFiles
    } = list.reduce((p, c) => {
      if (c.isDirectory) {
        p.folders.push(c)
      } else {
        this.total += c.size
        if (c.size < bigFileSize) {
          p.smallFiles.push(c)
        } else {
          p.largeFiles.push(c)
        }
      }
      return p
    }, {
      folders: [],
      smallFiles: [],
      largeFiles: []
    })

    // Process files with parallel batching
    await this.transferFiles(smallFiles, smallFilesBatch, transfer, attemptToken)
    await this.transferFiles(largeFiles, BigFilesBatch, transfer, attemptToken)

    // Process folders sequentially
    await this.transferFolders(folders, foldersBatch, transfer, attemptToken)
  }

  scheduleRetry = (e, attemptToken) => {
    if (!this.transferAttempts.isCurrent(attemptToken) ||
      this.transferAttempts.completing) return false
    if (
      this.onCancel ||
      !shouldRetryTransfer(e, this.transferRetryState)
    ) {
      return false
    }
    this.transferAttempts.invalidate(attemptToken)
    this.activeAttemptToken = null
    this.transport && this.transport.destroy()
    this.transport = null
    const retrySource = resetCrossHostSourceAttemptForRetry({
      transfer: this.props.transfer,
      sourcePin: this.crossHostSourcePin,
      verifiedSource: this.verifiedCrossHostSource,
      sourcePreflight: this.crossHostSourcePreflight
    })
    this.crossHostSourcePin = retrySource.sourcePin
    this.verifiedCrossHostSource = retrySource.verifiedSource
    this.crossHostSourcePreflight = retrySource.sourcePreflight
    this.update({
      status: 'active',
      error: '',
      retrying: true,
      retryAttempt: this.transferRetryState.attempt,
      retryMax: this.transferRetryState.maxRetries
    })
    this.retryTimer = setTimeout(() => this.startTransfer(), this.transferRetryState.retryDelay)
    return true
  }

  onError = (e, attemptToken) => {
    if (!this.transferAttempts.isCurrent(attemptToken) ||
      this.transferAttempts.completing) return
    if (this.scheduleRetry(e, attemptToken)) {
      return
    }
    const up = {
      status: 'exception',
      error: e.message
    }
    this.onEnd(up, attemptToken)
    window.store.onError(e)
  }

  mkdir = async (transfer = this.props.transfer, attemptToken) => {
    this.assertCurrentAttempt(attemptToken)
    const {
      typeTo,
      toPath
    } = transfer
    if (typeTo === typeMap.local) {
      const result = await window.fs.mkdir(toPath)
        .then(() => true)
        .catch(() => false)
      this.assertCurrentAttempt(attemptToken)
      return result
    }
    const sftp = this.getTransferRuntimeTransport(transfer).sftp
    const result = await sftp.mkdir(toPath)
      .then(() => true)
      .catch(() => false)
    this.assertCurrentAttempt(attemptToken)
    return result
  }

  render () {
    return null
  }
}
