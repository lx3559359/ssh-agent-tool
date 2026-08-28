import { Component } from 'react'
import { message } from 'antd'
import copy from 'json-deep-copy'
import { isFunction } from 'lodash-es'
import generate from '../../common/uid'
import { typeMap, transferTypeMap, fileOperationsMap, fileActions } from '../../common/constants'
import format, { computeLeftTime, computePassedTime } from './transfer-speed-format'
import {
  getFolderFromFilePath,
  getLocalFileInfo,
  getRemoteFileInfo
} from '../sftp/file-read'
import resolve from '../../common/resolve'
import { refsTransfers, refsStatic, refs } from '../common/ref'
import {
  createTransferRetryProgress,
  createTransferRetryState,
  shouldRetryTransfer
} from '../../common/transfer-retry'
import {
  collectFolderTransferResults,
  createSkippedFolderResults
} from './folder-transfer-results.js'
import {
  captureLocalTransferPlan,
  createTransferAttemptGuard,
  createTransferFileSessionController,
  createTransferSafetyController,
  getTransferSafetyCompletionFailure,
  resetCrossHostSourceAttemptForRetry,
  resolveTransferRuntimeTransport,
  shouldUseLegacyZipOptimization,
  verifyCrossHostSourceContent,
  verifyCrossHostSourcePreflight,
  verifyLocalTransferPlan
} from './file-transfer-safety.js'
import {
  bindRuntimeLocalTransferPlan,
  filterPlannedDirectoryEntries,
  resolveLocalTransferSourcePlan,
  withRuntimeLocalTransferDescriptor
} from './transfer-source-plan.js'
import {
  canRecordTransferBatchResult,
  sharedTransferBatchResultCollector
} from './transfer-batch-results.js'
import {
  zipCmd,
  unzipCmd,
  rmCmd,
  mvCmd,
  mkdirCmd
} from './zip'
import { createTransferTaskAdapter } from './transfer-task-adapter.js'
import {
  buildTransferResumeCheckpoint,
  buildTransferResumeOptions
} from './transfer-resume.js'
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
    this.operationTaskId = `sftp-transfer-${id}`
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
    this.folderItemResults = []
    this.localSourcePlan = resolveLocalTransferSourcePlan(props.transfer)
    this.localSourceDescriptor = this.localSourcePlan?.descriptor ||
      props.transfer?.sourceDescriptor ||
      null
    this.agentRiskTerminalPromise = null
    this.transferTaskAdapter = createTransferTaskAdapter()
    this.transferTaskStarted = false
    this.batchResultRecorded = false
    this.remoteFileSessionController = createTransferFileSessionController({
      acquire: async ({ transferId }) => {
        const capability = refs.get('sftp-' + this.tabId)
        if (!capability) {
          throw new Error('传输端点的远程文件 capability 不可用')
        }
        if (this.isFtp) {
          if (!capability.sftp) throw new Error('FTP 传输后端不可用')
          return Object.freeze({
            capability,
            backend: capability.sftp,
            runtimeIdentity: null,
            release: async () => true
          })
        }
        const prepared = capability.claimPreparedTransferFileSession?.(
          transferId
        )
        if (prepared) return prepared
        if (typeof capability.acquireTransferFileCapability !== 'function') {
          throw new Error('当前 SFTP 会话不支持受控文件传输')
        }
        const session = await capability.acquireTransferFileCapability({
          transferId
        })
        return Object.freeze({
          capability,
          backend: session.backend,
          runtimeIdentity: session.runtimeIdentity,
          release: () => session.release()
        })
      }
    })
    this.transferSafety = createTransferSafetyController({
      getTransfer: this.getTransferSafetyInput,
      getCapability: () => this.remoteFileSessionController.current?.capability,
      getSession: () => this.remoteFileSessionController.current,
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
    if (this.props.status !== prevProps.status) {
      if (this.props.status === 'pausing') {
        this.pause()
      } else if (this.props.status === 'resuming') {
        this.resume()
      }
    } else if (
      !this.props.status &&
      this.props.pausing !== prevProps.pausing
    ) {
      this.props.pausing ? this.pause() : this.resume()
    }
  }

  ensureRemoteFileSession = async () => {
    const session = await this.remoteFileSessionController.ensure({
      transferId: this.props.transfer.id
    })
    this.remoteFileSession = session
    return session
  }

  releaseRemoteFileSession = () => {
    if (this.remoteFileSessionReleasePromise) {
      return this.remoteFileSessionReleasePromise
    }
    this.remoteFileSessionReleasePromise =
      this.remoteFileSessionController.release()
    return this.remoteFileSessionReleasePromise
  }

  componentWillUnmount () {
    this.onCancel = true
    this.transferAttempts.invalidate(this.activeAttemptToken)
    this.activeAttemptToken = null
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    const transferStillQueued = window.store?.fileTransfers?.some(
      item => item.id === this.props.transfer.id
    )
    const externallyRemoved = !this.queueRemoved &&
      !this.userCancelling &&
      !this.finishing &&
      transferStillQueued === false
    const transport = this.transport
    this.transport = null
    this.unmountPromise = (async () => {
      let primaryError
      try {
        try {
          if (this.finishing) {
            await this.queueRemovalPromise
          } else if (this.userCancelling && this.cancellationPromise) {
            await this.cancellationPromise
          } else if (!this.queueRemoved) {
            if (externallyRemoved) {
              this.recordTransferBatchResult(this.props.transfer, {
                status: 'cancelled'
              })
              await transport?.cancel()
              await this.runTransferTask('onCancelled')
            } else {
              await transport?.interrupt()
              await this.runTransferTask('onInterrupted', 'client-unmounted')
            }
          } else {
            await transport?.destroy()
          }
        } catch (error) {
          primaryError = error
        }
        try {
          await this.destroySubTransports()
        } catch (error) {
          primaryError ||= error
        }
        try {
          await this.transferSafety.dispose()
        } catch (error) {
          primaryError ||= error
        }
      } finally {
        try {
          await this.releaseRemoteFileSession()
        } catch (error) {
          primaryError ||= error
        }
      }
      if (primaryError) throw primaryError
    })().catch(error => {
      window.store?.onError(error)
    })
    this.fromFile = null
    refsTransfers.remove(this.id)
  }

  runTransferTask = (method, ...args) => {
    if (method !== 'start' && !this.transferTaskStarted) {
      return Promise.resolve(null)
    }
    return Promise.resolve(
      this.transferTaskAdapter[method](this.operationTaskId, ...args)
    ).catch(error => {
      console.warn('SFTP task history update failed:', error)
      return null
    })
  }

  getTransferTaskEndpoint = () => {
    const transfer = this.props.transfer
    const tab = window.store?.tabs?.find(item => item.id === this.tabId) || {}
    return {
      host: transfer.host || tab.host || '',
      port: transfer.port || tab.port || 22,
      username: transfer.username || tab.username || ''
    }
  }

  beginTransferTask = async (fromFile) => {
    if (this.transferTaskStarted) return
    const { transfer } = this.props
    if (transfer.typeFrom === transfer.typeTo) return
    this.transferTaskStarted = true
    this.update({
      status: 'running',
      total: Number(fromFile?.size) || 0,
      paused: false,
      pausing: false
    })
    await this.runTransferTask('start', {
      title: transfer.typeFrom === typeMap.local
        ? `上传 ${transfer.fromPath}`
        : `下载 ${transfer.fromPath}`,
      endpoint: this.getTransferTaskEndpoint(),
      progress: {
        transferred: 0,
        total: Number(fromFile?.size) || 0
      },
      metadata: {
        tabId: this.tabId,
        transferId: transfer.id,
        transferBatch: transfer.transferBatch || '',
        typeFrom: transfer.typeFrom,
        typeTo: transfer.typeTo,
        fromPath: transfer.fromPath,
        toPath: transfer.toPath,
        isDirectory: Boolean(fromFile?.isDirectory),
        sourceDescriptor: transfer.sourceDescriptor || this.localSourceDescriptor,
        safetyOperationId: transfer.safetyOperationId || '',
        conflictPolicy: transfer.conflictPolicy || '',
        runtimeIdentity: this.remoteFileSession?.runtimeIdentity || {
          channel: 'sftp',
          effectiveUsername: this.getTransferTaskEndpoint().username
        }
      }
    })
  }

  getTransferSafetyInput = () => ({
    ...this.props.transfer,
    operationTaskId: this.operationTaskId,
    fromFile: this.props.transfer.fromFile || this.fromFile,
    finalToPath: this.newPath || this.props.transfer.toPath,
    conflictPolicy: this.conflictPolicy,
    isFtp: this.isFtp,
    sourceDescriptor: this.localSourceDescriptor,
    runtimeIdentity: this.remoteFileSession?.runtimeIdentity || {
      channel: 'sftp',
      effectiveUsername: this.getTransferTaskEndpoint().username
    }
  })

  getLocalSourceTransfer = (transfer = this.props.transfer) => ({
    ...transfer,
    fromFile: transfer.fromFile || this.fromFile,
    finalToPath: this.newPath || transfer.toPath,
    conflictPolicy: this.conflictPolicy,
    isFtp: this.isFtp
  })

  getLocalSourceSkippedResults = () => {
    return Array.isArray(this.localSourcePlan?.skipped)
      ? this.localSourcePlan.skipped
      : []
  }

  syncLocalSourcePlan = (transfer, sourcePlan = null) => {
    const nextSourcePlan = sourcePlan || null
    if (nextSourcePlan) {
      bindRuntimeLocalTransferPlan(transfer, nextSourcePlan)
    }
    this.localSourcePlan = nextSourcePlan
    this.localSourceDescriptor = nextSourcePlan?.descriptor ||
      transfer?.sourceDescriptor ||
      null
    return this.localSourcePlan
  }

  bindLocalSourcePlan = (transfer, sourcePlan = null) => {
    this.syncLocalSourcePlan(transfer, sourcePlan)
    this.folderItemResults = createSkippedFolderResults(
      this.getLocalSourceSkippedResults()
    )
    return this.localSourcePlan
  }

  prepareLocalSource = async (transfer = this.props.transfer) => {
    const sourceTransfer = this.getLocalSourceTransfer(transfer)
    const sourcePlan = resolveLocalTransferSourcePlan(
      transfer,
      transfer.sourcePlan || this.localSourcePlan
    )
    if (sourcePlan) {
      this.bindLocalSourcePlan(transfer, sourcePlan)
      await verifyLocalTransferPlan({
        transfer: sourceTransfer,
        sourcePlan: this.localSourcePlan,
        prepareLocal: (fromPath, options = {}) => window.fs.prepareTransferEntry(
          fromPath,
          {
            ...options,
            pinnedSkips: this.localSourcePlan.skipped
          }
        )
      })
      return this.localSourcePlan
    }
    const plannedSource = await captureLocalTransferPlan({
      transfer: sourceTransfer,
      prepareLocal: window.fs.prepareTransferEntry
    })
    return this.bindLocalSourcePlan(transfer, plannedSource)
  }

  verifyLocalSource = (transfer = this.props.transfer) => {
    const sourcePlan = resolveLocalTransferSourcePlan(
      transfer,
      transfer.sourcePlan || this.localSourcePlan
    )
    if (sourcePlan) {
      this.syncLocalSourcePlan(transfer, sourcePlan)
    }
    return verifyLocalTransferPlan({
      transfer: this.getLocalSourceTransfer(transfer),
      sourcePlan,
      prepareLocal: (fromPath, options = {}) => window.fs.prepareTransferEntry(
        fromPath,
        {
          ...options,
          pinnedSkips: this.localSourcePlan.skipped
        }
      )
    })
  }

  getTransferRuntimeTransport = (transfer = this.props.transfer) => {
    return resolveTransferRuntimeTransport({
      transfer,
      sourcePin: this.crossHostSourcePin,
      session: this.remoteFileSessionController.current
    })
  }

  localCheckExist = (path) => {
    return getLocalFileInfo(path)
      .catch(() => null)
  }

  remoteCheckExist = async (path, tabId) => {
    const session = await this.ensureRemoteFileSession()
    if (String(tabId) !== String(this.tabId) || !session?.backend) {
      console.log('remoteCheckExist error', 'sftp not exist')
      return false
    }
    return getRemoteFileInfo(session.backend, path)
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

  tagTransferError = async (id, errorMsg) => {
    // this.clear()
    const { store } = window
    const { fileTransfers } = store
    const index = fileTransfers.findIndex(d => d.id === id)
    if (index < 0) {
      await this.releaseRemoteFileSession()
      return
    }

    const tr = copy(fileTransfers[index])
    assign(tr, {
      host: tr.host,
      error: errorMsg,
      finishTime: Date.now()
    })
    store.addTransferHistory(tr)
    await this.notifyAgentRiskTerminal({
      status: 'failed',
      error: errorMsg,
      transferId: id
    }).catch(error => window.store.onError(error))
    await refsStatic.get('transfer-queue')?.addToQueue(
      'delete',
      id
    )
    await this.releaseRemoteFileSession()
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

  recordTransferBatchResult = (transfer, update = {}) => {
    const result = {
      batchId: transfer.transferBatch,
      transferId: transfer.id,
      expected: transfer.transferBatchSize,
      status: update.status || 'success',
      skipped: update.skipped || []
    }
    if (this.batchResultRecorded || !canRecordTransferBatchResult(result)) {
      return null
    }
    const summary = sharedTransferBatchResultCollector.record(result)
    this.batchResultRecorded = true
    if (summary?.skippedCount > 0) {
      const warningText = summary.exceptionCount > 0
        ? `上传部分完成：成功 ${summary.completed} 项，跳过 ${summary.skippedCount} 项，失败 ${summary.exceptionCount} 项。`
        : `上传完成：成功 ${summary.completed} 项，跳过 ${summary.skippedCount} 项。`
      message.warning(warningText)
    }
    return summary
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
    update.skipped = update.skipped || this.getLocalSourceSkippedResults()
    const skipSourceVerification = update.skipSourceVerification === true
    let failed = update.status === 'exception' || Boolean(update.error)
    if (!failed && !skipSourceVerification) {
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
    try {
      await this.notifyAgentRiskTerminal({
        status: update.status === 'exception' || update.error ? 'failed' : 'completed',
        error: update.error || '',
        transferId: this.props.transfer.id
      })
    } catch (error) {
      window.store.onError(error)
    }
    const taskFailed = update.status === 'exception' || Boolean(update.error)
    if (taskFailed) {
      await this.runTransferTask('onFailed', update.error || 'SFTP transfer failed')
    } else {
      const size = update.size ??
        update.transferred ??
        (update.status === 'skipped' ? 0 : this.total)
      await this.runTransferTask('onCompleted', {
        transferred: size,
        total: this.total || size,
        speed: 0,
        etaSeconds: 0
      })
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
      const size = update.size ??
        update.transferred ??
        (update.status === 'skipped' ? 0 : fromFile.size)
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
        error: update.error || '',
        runtimeIdentity: this.remoteFileSession?.runtimeIdentity || {
          channel: 'sftp',
          effectiveUsername: this.getTransferTaskEndpoint().username
        },
        ...(this.folderItemResults.length
          ? {
              itemResults: this.folderItemResults.slice(0, 1000),
              itemResultCount: this.folderItemResults.length
            }
          : {})
      })
      window.store.addTransferHistory(
        r
      )
    }
    this.recordTransferBatchResult(transfer, update)
    const cbs = [
      this[typeTo + 'List']
    ]
    const cb = () => {
      cbs.forEach(cb => cb())
    }
    if (protectedAttempt) this.transferAttempts.finishCompletion(attemptToken)
    try {
      await this.finishTransfer(cb)
    } finally {
      this.releaseRemoteFileSession().catch(error => window.store.onError(error))
    }
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
    up.status = 'running'
    up.retrying = false
    up.transferred = transferredValue
    this.lastTransferred = transferredValue
    up.startTime = this.startTime
    const elapsedSeconds = Math.max(0.001, (Date.now() - up.startTime) / 1000)
    up.speedBytesPerSecond = transferredValue / elapsedSeconds
    up.speed = format(transferredValue, up.startTime)
    assign(
      up,
      computeLeftTime(transferredValue, total, up.startTime)
    )
    up.passedTime = computePassedTime(up.startTime)
    this.update(up)
    this.runTransferTask('onProgress', {
      transferred: transferredValue,
      total,
      speed: up.speedBytesPerSecond,
      etaSeconds: Math.max(0, Number(up.leftTimeInt) || 0) / 1000
    })
  }

  stopTransport = async (reason = 'completed') => {
    this.onCancel = true
    this.transferAttempts.invalidate(this.activeAttemptToken)
    this.activeAttemptToken = null
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    const transport = this.transport
    this.transport = null
    if (reason === 'cancelled') {
      await transport?.cancel()
    } else if (reason === 'interrupted') {
      await transport?.interrupt()
    }
    await this.destroySubTransports()
  }

  destroySubTransports = async () => {
    const transports = [...this.subTransports]
    this.subTransports.clear()
    await Promise.allSettled(transports.map(transport => transport?.destroy()))
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

  finishTransfer = async (callback, reason = 'completed') => {
    await this.stopTransport(reason)
    if (!this.queueRemovalPromise) {
      this.queueRemoved = true
      this.queueRemovalPromise = this.removeTransferFromQueue()
    }
    await this.queueRemovalPromise
    if (isFunction(callback)) {
      callback()
    }
  }

  notifyAgentRiskTerminal = (outcome) => {
    if (this.agentRiskTerminalPromise) return this.agentRiskTerminalPromise
    const callback = this.props.transfer?._agentRiskTerminal
    if (typeof callback !== 'function') return Promise.resolve(null)
    this.agentRiskTerminalPromise = Promise.resolve()
      .then(() => callback(outcome))
    return this.agentRiskTerminalPromise
  }

  cancelProtectedTransport = async () => {
    let primaryError
    try {
      try {
        this.recordTransferBatchResult(this.props.transfer, {
          status: 'cancelled'
        })
        await this.runTransferTask('onCancelled')
        await this.finishTransfer(undefined, 'cancelled')
      } catch (error) {
        primaryError = error
      }
    } finally {
      try {
        await this.releaseRemoteFileSession()
      } catch (error) {
        primaryError ||= error
      }
    }
    if (primaryError) throw primaryError
  }

  cancelAndWait = () => {
    if (this.cancellationPromise) return this.cancellationPromise
    this.userCancelling = true
    this.cancellationPromise = (async () => {
      let primaryError
      try {
        try {
          const transport = this.transport
          this.transport = null
          await transport?.cancel()
          await this.transferSafety.cancel()
        } catch (error) {
          primaryError = error
        }
        try {
          await this.notifyAgentRiskTerminal({
            status: 'cancelled',
            remoteState: 'unknown',
            transferId: this.props.transfer.id
          })
        } catch (error) {
          primaryError ||= error
        }
        try {
          this.recordTransferBatchResult(this.props.transfer, {
            status: 'cancelled'
          })
          await this.runTransferTask('onCancelled')
          await this.finishTransfer(undefined, 'cancelled')
        } catch (error) {
          primaryError ||= error
        }
      } finally {
        try {
          await this.releaseRemoteFileSession()
        } catch (error) {
          primaryError ||= error
        }
      }
      if (primaryError) throw primaryError
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

  onPauseAcknowledged = async (checkpoint) => {
    const transfer = this.props.transfer
    let persistedCheckpoint = checkpoint
    if (
      checkpoint?.partialPath &&
      transfer.typeFrom === typeMap.local &&
      transfer.typeTo === typeMap.remote &&
      !this.fromFile?.isDirectory
    ) {
      try {
        const source = await window.fs.describeResumeEntry(transfer.fromPath)
        const sftp = this.getTransferRuntimeTransport(transfer).sftp
        const target = await sftp.describeResumeEntry(checkpoint.partialPath)
        persistedCheckpoint = buildTransferResumeCheckpoint({
          checkpoint,
          source,
          target
        })
      } catch (error) {
        console.warn('SFTP pause checkpoint fingerprint failed:', error)
        persistedCheckpoint = {
          ...checkpoint,
          validationError: String(error?.message || error || '')
        }
      }
    }
    this.update({
      status: 'paused',
      pausing: false,
      paused: true,
      checkpoint: persistedCheckpoint
    })
    await this.runTransferTask('onPaused', persistedCheckpoint)
  }

  pause = async () => {
    try {
      await this.runTransferTask('requestPause')
      await this.transport?.pause()
    } catch (error) {
      await this.onError(error, this.activeAttemptToken)
    }
  }

  resume = async () => {
    try {
      await this.transport?.resume()
      await this.runTransferTask('onResume')
      this.update({
        status: 'running',
        pausing: false,
        paused: false
      })
    } catch (error) {
      await this.onError(error, this.activeAttemptToken)
    }
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
    const atomicUpload = !isDown && !fromFile.isDirectory && !this.isFtp
    const mergeOrOverwrite = [
      fileActions.mergeOrOverwrite,
      fileActions.mergeOrOverwriteAll
    ].includes(this.conflictPolicy)
    const resumeOptions = buildTransferResumeOptions(transfer.checkpoint)
    const handleEnd = onEnd
      ? update => onEnd(update, attemptToken)
      : update => this.onEnd(update, attemptToken)
    try {
      const transport = await sftp[transferType]({
        remotePath,
        localPath,
        isDirectory: !!fromFile.isDirectory,
        options: {
          mode,
          atomicUpload,
          atomicOverwrite: atomicUpload && mergeOrOverwrite,
          overwrite: atomicUpload && mergeOrOverwrite,
          mergeOrOverwrite,
          keepPartial: atomicUpload,
          ...resumeOptions
        },
        onData: transferred => this.onData(transferred, attemptToken),
        onError: error => this.onError(error, attemptToken),
        onPaused: this.onPauseAcknowledged,
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

    if (typeFrom === typeMap.remote || typeTo === typeMap.remote) {
      try {
        await this.ensureRemoteFileSession()
      } catch (error) {
        return this.tagTransferError(id, error.message)
      }
    }

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
      await this.beginTransferTask(fromFile)
      await this.prepareLocalSource(transfer)
      if (
        transfer.typeFrom === typeMap.local &&
        transfer.typeTo === typeMap.remote &&
        !this.isFtp
      ) {
        if (!this.localSourcePlan?.descriptor) {
          return await this.onEnd({
            status: 'skipped',
            skipped: this.getLocalSourceSkippedResults(),
            skipSourceVerification: true
          }, attemptToken)
        }
      }
      if (transfer.remote2remoteStep === 1 && !this.crossHostSourcePin) {
        const sourcePreflight = await verifyCrossHostSourcePreflight({
          transfer: {
            ...transfer,
            fromFile
          },
          getCapability: sourceTabId => String(sourceTabId) === String(this.tabId)
            ? this.remoteFileSessionController.current
            : null
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
      await this.transferFolderRecursive(
        this.getDefaultTransfer(),
        true,
        attemptToken
      )
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
    if (type === typeMap.remote) {
      if (!runtime.capability?.sftpList) {
        throw new Error('远程传输目录读取能力不可用，已停止传输。')
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
    up.status = 'running'
    up.transferred = this.transferred
    up.startTime = this.startTime
    const elapsedSeconds = Math.max(0.001, (Date.now() - up.startTime) / 1000)
    up.speedBytesPerSecond = this.transferred / elapsedSeconds
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
    const atomicUpload = !isDown && !transfer.fromFile?.isDirectory && !this.isFtp
    const mergeOrOverwrite = [
      fileActions.mergeOrOverwrite,
      fileActions.mergeOrOverwriteAll
    ].includes(this.conflictPolicy)

    return new Promise((resolve, reject) => {
      let transport

      const onSubEnd = () => {
        if (!this.transferAttempts.isCurrent(attemptToken)) {
          transport?.destroy()
          const error = new Error('传输尝试已失效。')
          error.code = 'STALE_TRANSFER_ATTEMPT'
          return reject(error)
        }
        if (transport) {
          this.subTransports.delete(transport)
          transport = null
        }
        resolve(fileSize)
      }

      const onSubError = (error) => {
        if (transport) {
          this.subTransports.delete(transport)
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
        options: {
          mode,
          atomicUpload,
          atomicOverwrite: atomicUpload && mergeOrOverwrite,
          overwrite: atomicUpload && mergeOrOverwrite,
          mergeOrOverwrite
        },
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
    const transfer = withRuntimeLocalTransferDescriptor(
      this.props.transfer,
      this.localSourceDescriptor
    )
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
          fromFile: file,
          sourceDescriptor: file.sourceDescriptor
        }

        return this.transferFileAsSubTransfer(itemTransfer, attemptToken)
      })

      const results = await Promise.allSettled(promises)
      this.assertCurrentAttempt(attemptToken)

      const summary = collectFolderTransferResults(batchFiles, results)
      this.folderItemResults.push(...summary.items)
      if (summary.completedBytes > 0) {
        this.onFolderData(summary.completedBytes, attemptToken)
      }
      if (summary.failed.length) {
        const firstFailure = summary.failed[0]
        const error = new Error(
          `${summary.failed.length} 个文件传输失败：${firstFailure.file?.name || ''} ${firstFailure.error.message}`
        )
        error.code = 'SFTP_FOLDER_ITEM_FAILED'
        error.itemResults = summary.items
        throw error
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
          fromFile: folder,
          sourceDescriptor: folder.sourceDescriptor
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
        fromFile: folder,
        sourceDescriptor: folder.sourceDescriptor
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

    let list = await this.list(typeFrom, fromPath, tabId, transfer, attemptToken)
    if (
      transfer.typeFrom === typeMap.local &&
      transfer.typeTo === typeMap.remote &&
      !this.isFtp &&
      transfer.sourceDescriptor
    ) {
      list = filterPlannedDirectoryEntries(list, transfer.sourceDescriptor)
    }
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
    const transport = this.transport
    if (transport) {
      Promise.resolve(transport?.destroy())
        .catch(error => window.store.onError(error))
    }
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
    const retryProgress = createTransferRetryProgress({
      transferred: this.transferred || this.lastTransferred,
      total: this.total
    })
    this.update({
      status: 'running',
      error: '',
      retrying: true,
      transferred: retryProgress.transferred,
      retryMode: retryProgress.mode,
      retryPreservedBytes: retryProgress.preservedTransferred,
      retryTotalBytes: retryProgress.total,
      retryAttempt: this.transferRetryState.attempt,
      retryMax: this.transferRetryState.maxRetries
    })
    this.retryTimer = setTimeout(() => this.startTransfer(), this.transferRetryState.retryDelay)
    return true
  }

  onError = async (e, attemptToken) => {
    if (this.userCancelling || this.onCancel) return
    if (!this.transferAttempts.isCurrent(attemptToken) ||
      this.transferAttempts.completing) return
    if (this.scheduleRetry(e, attemptToken)) {
      return
    }
    const up = {
      status: 'exception',
      error: e.message
    }
    await this.onEnd(up, attemptToken)
    window.store.onError(e)
  }

  mkdir = async (transfer = this.props.transfer, attemptToken) => {
    this.assertCurrentAttempt(attemptToken)
    const {
      typeTo,
      toPath
    } = transfer
    if (typeTo === typeMap.local) {
      await window.fs.mkdir(toPath)
      this.assertCurrentAttempt(attemptToken)
      return true
    }
    const sftp = this.getTransferRuntimeTransport(transfer).sftp
    await sftp.mkdir(toPath)
    this.assertCurrentAttempt(attemptToken)
    return true
  }

  render () {
    return null
  }
}
