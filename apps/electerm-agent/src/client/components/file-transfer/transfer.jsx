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
  createTransferSafetyController,
  getTransferSafetyCompletionFailure,
  shouldUseLegacyZipOptimization,
  verifyCrossHostSourcePreflight
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
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.transport && this.transport.destroy()
    this.transport = null
    this.fromFile = null
    refsTransfers.remove(this.id)
  }

  getTransferSafetyInput = () => ({
    ...this.props.transfer,
    fromFile: this.props.transfer.fromFile || this.fromFile,
    finalToPath: this.newPath || this.props.transfer.toPath,
    conflictPolicy: this.conflictPolicy,
    isFtp: this.isFtp
  })

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

  onEnd = async (update = {}) => {
    if (this.onCancel) {
      return
    }
    if (this.finishing) return
    this.finishing = true
    const failed = update.status === 'exception' || Boolean(update.error)
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
              verifiedSourceIdentity: this.verifiedCrossHostSource.verifiedSourceIdentity
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
    this.finishTransfer(cb)
  }

  onData = (transferred) => {
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
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.transport && this.transport.destroy()
    this.transport = null
  }

  finishTransfer = (callback) => {
    this.stopTransport()
    if (!this.queueRemoved) {
      this.queueRemoved = true
      refsStatic.get('transfer-queue')?.addToQueue(
        'delete',
        this.props.transfer.id
      )
    }
    if (isFunction(callback)) {
      callback()
    }
  }

  cancelProtectedTransport = async () => {
    this.finishTransfer()
  }

  cancel = async (callback) => {
    if (this.userCancelling) return
    this.userCancelling = true
    try {
      await this.transferSafety.cancel()
    } catch (error) {
      window.store.onError(error)
    } finally {
      this.finishTransfer(callback)
    }
  }

  pause = () => {
    this.transport?.pause()
  }

  resume = () => {
    this.transport?.resume()
  }

  mvOrCp = async () => {
    const {
      transfer
    } = this.props
    const {
      fromPath,
      toPath,
      typeFrom,
      tabId,
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
        return this.onEnd()
      } catch (e) {
        return this.onError(e)
      }
    }
    const sftp = refs.get('sftp-' + tabId)?.sftp
    try {
      await this.transferSafety.begin()
      await sftp[operation](fromPath, finalToPath)
      return this.onEnd()
    } catch (e) {
      return this.onError(e)
    }
  }

  transferFile = async (transfer = this.props.transfer, onEnd = this.onEnd) => {
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
    const sftp = refs.get('sftp-' + this.tabId).sftp
    try {
      this.transport = await sftp[transferType]({
        remotePath,
        localPath,
        isDirectory: !!fromFile.isDirectory,
        options: { mode },
        onData: this.onData,
        onError: this.onError,
        onEnd
      })
    } catch (e) {
      this.onError(e)
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

  zipTransferFolder = async () => {
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
    this.transferFile(newTrans1, this.unzipFile)
  }

  unzipFile = async () => {
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
    this.onEnd()
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
    try {
      const transfer = this.props.transfer
      const { fromFile = this.fromFile, zip } = transfer
      if (!fromFile) {
        return
      }
      this.verifiedCrossHostSource = undefined
      this.verifiedCrossHostSource = await verifyCrossHostSourcePreflight({
        transfer: {
          ...transfer,
          fromFile
        },
        getCapability: sourceTabId => refs.get('sftp-' + sourceTabId)
      })
      await this.transferSafety.begin()
      if (!fromFile.isDirectory) {
        return await this.transferFile()
      }
      if (shouldUseLegacyZipOptimization({ zip, isFtp: this.isFtp })) {
        return await this.zipTransferFolder()
      }
      if (!this.isFtp) {
        return await this.transferFile()
      } else {
        await this.transferFolderRecursive()
      }
      this.onEnd({
        transferred: this.transferred,
        size: this.total
      })
    } catch (e) {
      this.onError(e)
    }
  }

  list = async (type, path, tabId) => {
    const sftp = refs.get('sftp-' + tabId)
    return sftp[type + 'List'](true, path)
  }

  handleRename = (fromPath, isRemote) => {
    const { path, base, ext } = getFolderFromFilePath(fromPath, isRemote)
    const newName = `${base}(rename-${generate()})${ext ? '.' + ext : ''}`
    return {
      newPath: resolve(path, newName),
      newName
    }
  }

  onFolderData = (transferred) => {
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

  transferFileAsSubTransfer = async (transfer) => {
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
    const sftp = refs.get('sftp-' + this.tabId).sftp

    return new Promise((resolve, reject) => {
      let transport

      const onSubEnd = () => {
        if (fileSize) {
          this.onFolderData(fileSize)
        }
        if (transport) {
          transport.destroy()
          transport = null
        }
        resolve(fileSize)
      }

      const onSubError = (error) => {
        if (transport) {
          transport.destroy()
          transport = null
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
        transport = transportInstance
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
  transferFiles = async (files, batch, transfer) => {
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

        return this.transferFileAsSubTransfer(itemTransfer)
      })

      // Wait for all files in batch to complete
      const results = await Promise.all(promises)

      // Update progress once for the entire batch
      const batchTotalSize = results.reduce((sum, size) => sum + size, 0)
      if (batchTotalSize > 0) {
        this.onFolderData(batchTotalSize)
      }
    }
  }

  // Handle folder transfers sequentially to prevent concurrency explosion
  transferFolders = async (folders, batch, transfer) => {
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

        return this.mkdir(createTransfer)
      })

      // Create all folders in this batch concurrently
      await Promise.all(createFolderPromises)
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
      await this.transferFolderRecursive(itemTransfer, false)
    }
  }

  // Main recursive function using the separate handlers
  transferFolderRecursive = async (transfer = this.getDefaultTransfer(), createFolder = true) => {
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
      const folderCreated = await this.mkdir(transfer)
      if (!folderCreated) {
        return
      }
    }

    const list = await this.list(typeFrom, fromPath, tabId)
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
    await this.transferFiles(smallFiles, smallFilesBatch, transfer)
    await this.transferFiles(largeFiles, BigFilesBatch, transfer)

    // Process folders sequentially
    await this.transferFolders(folders, foldersBatch, transfer)
  }

  scheduleRetry = (e) => {
    if (
      this.onCancel ||
      !shouldRetryTransfer(e, this.transferRetryState)
    ) {
      return false
    }
    this.transport && this.transport.destroy()
    this.transport = null
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

  onError = (e) => {
    if (this.scheduleRetry(e)) {
      return
    }
    const up = {
      status: 'exception',
      error: e.message
    }
    this.onEnd(up)
    window.store.onError(e)
  }

  mkdir = async (transfer = this.props.transfer) => {
    const {
      typeTo,
      toPath,
      tabId
    } = transfer
    if (typeTo === typeMap.local) {
      return window.fs.mkdir(toPath)
        .then(() => true)
        .catch(() => false)
    }
    const sftp = refs.get('sftp-' + tabId).sftp
    return sftp.mkdir(toPath)
      .then(() => true)
      .catch(() => false)
  }

  render () {
    return null
  }
}
