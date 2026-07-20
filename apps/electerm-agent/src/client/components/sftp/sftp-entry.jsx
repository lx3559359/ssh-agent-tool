import { Component } from 'react'
import { refs } from '../common/ref'
import generate from '../../common/uid'
import runIdle from '../../common/run-idle'
import { Spin, Button } from 'antd'
import { notification } from '../common/notification'
import Modal from '../common/modal'
import clone from '../../common/to-simple-obj'
import { isEqual, last, isNumber, some, isArray, pick, uniq, debounce } from 'lodash-es'
import FileSection from './file-item'
import resolve from '../../common/resolve'
import wait from '../../common/wait'
import isAbsPath from '../../common/is-absolute-path'
import classnames from 'classnames'
import sorterIndex from '../../common/index-sorter'
import { handleErr } from '../../common/fetch'
import { getLocalFileInfo, getRemoteFileInfo, getFolderFromFilePath } from './file-read'
import {
  typeMap, maxSftpHistory, paneMap,
  fileTypeMap,
  terminalSerialType,
  terminalFtpType,
  unexpectedPacketErrorDesc,
  sftpRetryInterval
} from '../../common/constants'
import { hasFileInClipboardText } from '../../common/clipboard'
import Client from '../../common/sftp'
import ListTable from './list-table-ui'
import deepCopy from 'json-deep-copy'
import isValidPath from '../../common/is-valid-path'
import normalizeRemotePath from '../../common/normalize-remote-path'
import {
  LoadingOutlined,
  ReloadOutlined,
  SaveOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons'
import * as owner from './owner-list'
import AddressBar from './address-bar'
import getProxy from '../../common/get-proxy'
import { createTerm } from '../terminal/terminal-apis'
import message from '../common/message'
import * as ls from '../../common/safe-local-storage'
import {
  backupRemoteFiles,
  restoreSftpRecoveryRecord,
  findLatestSftpRecoveryRecord
} from './sftp-safety'
import {
  createSftpTransactionAdapter,
  digestSftpText
} from './sftp-transaction-adapter.js'
import { createTransactionRunner } from '../../common/safety-transactions/transaction-runner.js'
import { buildSideEffectSafetyRequest } from '../../common/safety-transactions/side-effect-model.js'
import { assertSameSessionEndpoint } from '../../common/safety-transactions/endpoint-guard.js'
import { buildSftpSafetyEndpoint } from './sftp-safety-endpoint.js'
import * as sftpSafetyStore from '../../common/safety-transactions/transaction-store.js'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import {
  mergeSafetyOperationRecords,
  matchesSafetyOperationEndpoint,
  readSafetyOperationRecords,
  updateSafetyOperationRecord,
  writeSafetyOperationRecords
} from '../../common/safety-operation-records'
import './sftp.styl'

const e = window.translate

export default class Sftp extends Component {
  constructor (props) {
    super(props)
    this.state = {
      id: props.id || generate(),
      selectedFiles: new Set(),
      selectedType: '',
      lastClickedFile: null,
      onEditFile: false,
      ...this.defaultState(),
      loadingSftp: false,
      inited: false,
      ready: false,
      sftpRecoveryRecords: readSafetyOperationRecords(ls)
    }
    this.retryCount = 0
    this.sftpSafetyAdapter = createSftpTransactionAdapter({
      getSftp: () => this.sftp
    })
    this.sftpSafetyRunner = createTransactionRunner({
      runRemote: async () => {
        throw new Error('SFTP side-effect 禁止通过 shell command 执行。')
      },
      cancelRemote: async () => {},
      getCurrentEndpoint: async () => this.getSftpSafetyEndpoint(),
      buildRecoveryPlan: async () => {
        throw new Error('SFTP side-effect 禁止生成 shell recovery command。')
      },
      sideEffectAdapter: this.sftpSafetyAdapter,
      store: sftpSafetyStore
    })
  }

  componentDidMount () {
    this.id = 'sftp-' + this.props.tab.id
    refs.add(this.id, this)
    if (this.props.isFtp) {
      this.initFtpData()
    }
    this.timer = setTimeout(() => {
      this.setState({
        ready: true
      })
    }, 0)
  }

  componentDidUpdate (prevProps, prevState) {
    if (
      this.props.config.autoRefreshWhenSwitchToSftp &&
      prevProps.pane !== this.props.pane &&
      this.props.pane === paneMap.fileManager &&
      this.state.inited
    ) {
      this.onGoto(typeMap.local)
      this.onGoto(typeMap.remote)
    }
    if (
      prevState.remotePath !== this.state.remotePath &&
      this.state.selectedType === typeMap.remote
    ) {
      this.setState({
        selectedFiles: new Set()
      })
    } else if (
      prevState.localPath !== this.state.localPath &&
      this.state.selectedType === typeMap.local
    ) {
      this.setState({
        selectedFiles: new Set()
      })
    }
    if (
      this.props.sftpPathFollowSsh &&
      prevProps.cwd !== this.props.cwd
    ) {
      this.updateCwd(this.props.cwd)
    }
  }

  componentWillUnmount () {
    refs.remove(this.id)
    this.sftp && this.sftp.destroy()
    this.sftp = null
    clearTimeout(this.timer4)
    this.timer4 = null
    clearTimeout(this.timer5)
    this.timer5 = null
    // Clear sort cache to prevent memory leaks
    this._sortCache?.clear()
    this._lastSortArgs = null
  }

  initFtpData = async () => {
    this.type = 'ftp'
    const { tab } = this.props
    const { id } = tab
    const opts = clone({
      tabId: id,
      uid: tab.id,
      srcTabId: tab.id,
      termType: 'ftp',
      ...tab
    })
    const r = await createTerm(opts)
      .catch(err => {
        const text = err.message
        handleErr({ message: text })
      })
    if (!r) {
      return
    }
    const {
      port
    } = r
    this.initData(undefined, port)
  }

  directions = [
    'desc',
    'asc'
  ]

  defaultDirection = (i = 0) => {
    return this.directions[i]
  }

  getFileItemById = (id, type) => {
    if (type) {
      return this.state[`${type}FileTree`].get(id)
    }
    return this.getFileItemById(id, typeMap.local) ||
      this.getFileItemById(id, typeMap.remote)
  }

  defaultState = () => {
    const def = this.props.config.showHiddenFilesOnSftpStart
    return Object.keys(typeMap).reduce((prev, k, i) => {
      Object.assign(prev, {
        [`sortProp.${k}`]: window.store.sftpSortSetting[k].prop,
        [`sortDirection.${k}`]: window.store.sftpSortSetting[k].direction,
        [k]: [],
        [`${k}FileTree`]: new Map(),
        [`${k}Loading`]: false,
        [`${k}InputFocus`]: false,
        [`${k}ShowHiddenFile`]: def,
        [`${k}Path`]: '',
        [`${k}PathTemp`]: '',
        [`${k}PathHistory`]: [],
        [`${k}GidTree`]: new Map(),
        [`${k}UidTree`]: new Map(),
        [`${k}Keyword`]: ''
      })
      return prev
    }, {})
  }

  // Cache for memoized sort results
  _sortCache = new Map()
  _lastSortArgs = null

  sort = (list, type, sortDirection, sortProp) => {
    // Create a cache key from the arguments
    const cacheKey = JSON.stringify({
      listLength: list?.length || 0,
      listHash: this._hashList(list),
      type,
      sortDirection,
      sortProp
    })

    // Check if we have a cached result and if args haven't changed
    if (this._lastSortArgs && isEqual(this._lastSortArgs, [list, type, sortDirection, sortProp])) {
      const cached = this._sortCache.get(cacheKey)
      if (cached) {
        return cached
      }
    }

    // Compute the result
    if (!list || !list.length) {
      return []
    }

    const isDesc = sortDirection === 'desc'

    const result = list.slice().sort((a, b) => {
      // Handle items with no id first
      if (!a.id && b.id) return -1
      if (a.id && !b.id) return 1
      if (!a.id && !b.id) return 0

      // Sort directories before files
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }

      // Sort by the specified property
      let aValue = a[sortProp]
      let bValue = b[sortProp]

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase()
        bValue = bValue.toLowerCase()
        return isDesc
          ? bValue.localeCompare(aValue, { sensitivity: 'base' })
          : aValue.localeCompare(bValue, { sensitivity: 'base' })
      }

      // For non-string values, use simple comparison
      if (aValue < bValue) return isDesc ? 1 : -1
      if (aValue > bValue) return isDesc ? -1 : 1
      return 0
    })

    // Cache the result
    this._lastSortArgs = [list, type, sortDirection, sortProp]
    this._sortCache.set(cacheKey, result)

    // Limit cache size to prevent memory leaks
    if (this._sortCache.size > 10) {
      const firstKey = this._sortCache.keys().next().value
      this._sortCache.delete(firstKey)
    }

    return result
  }

  // Helper method to create a simple hash of the list for cache key
  _hashList = (list) => {
    if (!list || !list.length) return 0
    return list.reduce((hash, item, index) => {
      const str = `${item.id || ''}${item.name || ''}${item.modifyTime || ''}${index}`
      return hash + str.length
    }, 0)
  }

  isActive () {
    const { currentBatchTabId, pane, sshSftpSplitView } = this.props
    const { tab } = this.props
    const isFtp = tab.type === terminalFtpType

    return (currentBatchTabId === tab.id && (pane === paneMap.fileManager || sshSftpSplitView)) || isFtp
  }

  updateKeyword = (keyword, type) => {
    this.setState({
      [`${type}Keyword`]: keyword
    })
  }

  getCwdLocal = () => {
    if (
      !this.shouldRenderRemote() &&
      this.props.sftpPathFollowSsh &&
      this.props.cwd
    ) {
      return this.props.cwd
    }
  }

  gotoHome = async (type) => {
    const n = `${type}Path`
    const nt = n + 'Temp'
    let path

    if (type === typeMap.remote) {
      path = this.props.tab.startDirectoryRemote
      if (!path && this.sftp) {
        path = await this.getPwd(this.props.tab.username)
      }
      path = normalizeRemotePath(path)
    } else {
      path = this.getLocalHome()
    }

    this.setState({
      [n]: path,
      [nt]: path
    }, () => this[`${type}List`]())
  }

  updateCwd = (cwd = this.props.cwd) => {
    if (!this.state.inited) {
      return
    }
    const type = this.shouldRenderRemote()
      ? typeMap.remote
      : typeMap.local
    // this.setState({
    //   [`${type}PathTemp`]: cwd
    // }, () => {
    //   this.onGoto(
    //     type
    //   )
    // })
    const n = `${type}Path`
    const nt = n + 'Temp'
    this.setState({
      [n]: cwd,
      [nt]: cwd
    }, () => this[`${type}List`]())
  }

  getPwd = async (username) => {
    if (this.props.sftpPathFollowSsh && this.props.cwd) {
      return this.props.cwd
    }
    const home = await this.sftp.getHomeDir()
    if (home) {
      return home.trim()
    } else {
      return username === 'root'
        ? '/root'
        : `/home/${this.props.tab.username}`
    }
  }

  getIndex = (file) => {
    const { type } = file
    return this.getFileList(type).findIndex(f => f.id === file.id)
  }

  selectAll = (type, e) => {
    e && e.preventDefault && e.preventDefault()
    this.setState({
      selectedFiles: new Set(this.getFileList(type).map(f => f.id))
    })
  }

  selectNext = type => {
    const { selectedFiles } = this.state
    const fileList = this.getFileList(type)
    if (!fileList.length) {
      return
    }

    // Convert Set of IDs to array of indices
    const fileIndices = Array.from(selectedFiles)
      .map(id => fileList.findIndex(f => f.id === id))
      .filter(index => index !== -1)
      .sort(sorterIndex)

    const lastOne = last(fileIndices)
    let next = 0
    if (isNumber(lastOne)) {
      next = (lastOne + 1) % fileList.length
    }

    const nextFile = fileList[next]
    if (nextFile) {
      this.setState({
        selectedFiles: new Set([nextFile.id])
      })
    }
  }

  selectPrev = type => {
    const { selectedFiles } = this.state
    const fileList = this.getFileList(type)
    if (!fileList.length) {
      return
    }

    // Convert Set of IDs to array of indices
    const fileIndices = Array.from(selectedFiles)
      .map(id => fileList.findIndex(f => f.id === id))
      .filter(index => index !== -1)
      .sort(sorterIndex)

    const firstOne = fileIndices[0]
    let next = 0
    const len = fileList.length
    if (isNumber(firstOne)) {
      next = (firstOne - 1 + len) % len
    }

    const nextFile = fileList[next]
    if (nextFile) {
      this.setState({
        selectedFiles: new Set([nextFile.id])
      })
    }
  }

  localDel = async (file) => {
    const { name, isDirectory, path } = file
    const func = !isDirectory
      ? window.fs.unlink
      : window.fs.rmrf
    const p = resolve(path, name)
    await func(p).catch(window.store.onError)
  }

  remoteDel = async (file) => {
    const { name, isDirectory, path } = file
    const { sftp } = this
    const func = isDirectory
      ? sftp.rmdir
      : sftp.rm
    const p = resolve(path, name)
    await func(p).catch(window.store.onError)
  }

  confirmDelete = (files, { signal } = {}) => {
    return new Promise((resolve) => {
      let settled = false
      const modalRef = { current: null }
      const settle = (value) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        resolve(value)
      }
      const onAbort = () => {
        modalRef.current?.destroy()
        settle(false)
      }
      if (signal?.aborted) {
        settle(false)
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      modalRef.current = Modal.confirm({
        title: this.renderDelConfirmTitle(files),
        okText: e('ok'),
        cancelText: e('cancel'),
        onOk: () => settle(true),
        onCancel: () => settle(false)
      })
      if (signal?.aborted) onAbort()
    })
  }

  getSelectedFiles = (selectedFiles = this.state.selectedFiles) => {
    // Convert Set of IDs to array of file objects
    return Array.isArray(selectedFiles)
      ? selectedFiles
      : Array.from(selectedFiles)
        .map(id => this.getFileItemById(id))
        .filter(Boolean) // Filter out any undefined items
  }

  persistSftpRecoveryRecords = (records) => {
    const persisted = writeSafetyOperationRecords(ls, records)
    this.setState({ sftpRecoveryRecords: persisted })
  }

  addSftpRecoveryRecords = (added) => {
    const records = mergeSafetyOperationRecords(
      readSafetyOperationRecords(ls),
      added
    )
    this.persistSftpRecoveryRecords(records)
    return records
  }

  getSftpSafetyEndpoint = () => {
    if (!this.sftp || this.props.isFtp || this.type === 'ftp') {
      throw new Error('当前 SFTP 连接不可用，远程文件尚未修改。')
    }
    return buildSftpSafetyEndpoint({
      tab: this.props.tab,
      terminalId: this.terminalId
    })
  }

  assertSftpSafetyOperationEndpoint = async id => {
    const operation = await sftpSafetyStore.getOperation(id)
    if (!operation) throw new Error(`未找到 SFTP 安全操作：${id}`)
    if (operation.effect?.adapter !== 'sftp') {
      throw new Error('该安全操作不属于 SFTP capability。')
    }
    assertSameSessionEndpoint(operation.endpoint, this.getSftpSafetyEndpoint())
    return operation
  }

  rollbackSafetyOperation = async id => {
    await this.assertSftpSafetyOperationEndpoint(id)
    const result = await this.sftpSafetyRunner.rollback(id)
    await this.remoteList()
    return result
  }

  keepSafetyOperation = async id => {
    await this.assertSftpSafetyOperationEndpoint(id)
    return this.sftpSafetyRunner.keep(id)
  }

  cancelSafetyOperation = async id => {
    await this.assertSftpSafetyOperationEndpoint(id)
    return this.sftpSafetyRunner.cancel(id)
  }

  confirmPreparedSftpOperation = (title) => {
    return new Promise(resolve => {
      Modal.confirm({
        title,
        content: e('shellpilotSftpRestoreConfirmDescription'),
        okText: e('shellpilotSftpConfirmExecute'),
        cancelText: e('cancel'),
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
  }

  prepareSftpSafetyOperation = async ({
    action,
    paths,
    type,
    requestedMode,
    expected,
    title,
    signal
  }) => {
    const request = buildSideEffectSafetyRequest({
      id: `sftp-${action}-${Date.now()}-${generate()}`,
      source: 'sftp',
      endpoint: this.getSftpSafetyEndpoint(),
      title,
      effect: {
        adapter: 'sftp',
        action,
        paths,
        resources: Object.values(paths).map(path => ({ path, type })),
        type,
        requestedMode,
        expected: expected || {}
      },
      metadata: { sftpSafetyTransaction: true }
    })
    request.signal = signal
    return this.sftpSafetyRunner.prepare(request)
  }

  prepareTransferSafetyOperation = async (plan) => {
    const request = buildSideEffectSafetyRequest({
      id: plan.operationId,
      source: 'sftp',
      endpoint: this.getSftpSafetyEndpoint(),
      title: e('shellpilotSftpFileTransfer'),
      effect: {
        adapter: 'sftp',
        action: plan.action,
        paths: plan.paths,
        resources: Object.values(plan.paths).map(path => ({
          path,
          type: plan.type
        })),
        type: plan.type,
        expected: plan.expected,
        transfer: plan.transfer
      },
      metadata: {
        sftpSafetyTransaction: true,
        fileTransferSafety: true,
        transferBatch: plan.transfer.batchId || '',
        traceId: plan.metadata?.traceId
      }
    })
    const existing = await sftpSafetyStore.getOperation(request.id)
    if (existing) {
      await this.assertSftpSafetyOperationEndpoint(existing.id)
      if (existing.effectKey !== request.effectKey) {
        throw new Error('同一传输标识已绑定其他远程目标，已阻止覆盖恢复点')
      }
      return existing
    }
    return this.sftpSafetyRunner.prepare(request)
  }

  beginTransferSafetyOperation = async (id, options = {}) => {
    await this.assertSftpSafetyOperationEndpoint(id)
    return this.sftpSafetyRunner.beginExternalExecution(id, {
      ...options,
      confirmed: true
    })
  }

  getTransferSafetyOperation = async id => {
    return this.assertSftpSafetyOperationEndpoint(id)
  }

  completeTransferSafetyOperation = async (id, completion) => {
    await this.assertSftpSafetyOperationEndpoint(id)
    return this.sftpSafetyRunner.completeExternalExecution(id, completion)
  }

  cancelTransferSafetyOperation = async (id) => {
    await this.assertSftpSafetyOperationEndpoint(id)
    return this.sftpSafetyRunner.cancel(id)
  }

  runSftpSafetyOperation = async (spec, options = {}) => {
    const operation = await this.prepareSftpSafetyOperation(spec)
    const confirmed = await this.confirmPreparedSftpOperation(
      options.confirmTitle || `确认${spec.title || '执行 SFTP 修改'}？`
    )
    if (!confirmed) {
      await this.sftpSafetyRunner.cancel(operation.id)
      return false
    }
    return this.sftpSafetyRunner.execute(operation.id, {
      confirmed: true,
      sideEffectInput: options.input
    })
  }

  changeRemoteFileMode = async ({ path, mode, type }) => {
    const result = await this.runSftpSafetyOperation({
      action: 'chmod',
      paths: { source: path },
      type,
      requestedMode: mode,
      expected: { mode, type },
      title: e('shellpilotSftpPermissionChange')
    })
    if (result) message.success(e('shellpilotSftpPermissionRecoveryRecorded'))
    return result
  }

  renameRemoteFile = async ({ sourcePath, targetPath, type }) => {
    if (this.props.isFtp) {
      await this.sftp.rename(sourcePath, targetPath)
      return true
    }
    const result = await this.runSftpSafetyOperation({
      action: 'rename',
      paths: { source: sourcePath, target: targetPath },
      type,
      expected: {},
      title: e('shellpilotSftpRename')
    })
    if (result) message.success(e('shellpilotSftpRenameRecoveryRecorded'))
    return result
  }

  saveRemoteEditorFile = async ({ path, text, mode }) => {
    if (this.props.isFtp) {
      await this.sftp.writeFile(path, text, mode)
      return true
    }
    const expected = await digestSftpText(text)
    const requestedMode = mode === undefined ? undefined : Number(mode) & 0o7777
    const result = await this.runSftpSafetyOperation({
      action: 'editor-save',
      paths: { target: path },
      type: 'file',
      requestedMode,
      expected,
      title: e('shellpilotSftpEditorSave')
    }, {
      input: { text }
    })
    if (result) message.success(e('shellpilotSftpEditorSaveVerified'))
    return result
  }

  deleteRemoteFilesWithSafety = async (files, options = {}) => {
    if (this.props.isFtp) {
      const confirmed = await this.confirmDelete(files, { signal: options.signal })
      if (!confirmed || options.signal?.aborted) return false
      for (const file of files) {
        if (options.signal?.aborted) return false
        await this.remoteDel(file)
      }
      return true
    }
    const operations = []
    try {
      for (const file of this.getRemoteSafetyTargets(files)) {
        if (options.signal?.aborted) break
        const source = resolve(file.path, file.name)
        operations.push(await this.prepareSftpSafetyOperation({
          action: 'delete',
          paths: { source },
          type: file.isDirectory ? 'directory' : 'file',
          expected: { absent: true },
          title: e('shellpilotSftpDelete'),
          signal: options.signal
        }))
      }
    } catch (error) {
      await Promise.allSettled(operations.map(operation => (
        this.sftpSafetyRunner.cancel(operation.id)
      )))
      throw error
    }
    if (!operations.length) return false
    if (options.signal?.aborted) {
      await Promise.allSettled(operations.map(operation => (
        this.sftpSafetyRunner.cancel(operation.id)
      )))
      return false
    }
    const confirmed = await this.confirmDelete(files, { signal: options.signal })
    if (!confirmed || options.signal?.aborted) {
      await Promise.allSettled(operations.map(operation => (
        this.sftpSafetyRunner.cancel(operation.id)
      )))
      return false
    }
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index]
      if (options.signal?.aborted) {
        await Promise.allSettled(operations.slice(index).map(pending => (
          this.sftpSafetyRunner.cancel(pending.id)
        )))
        return false
      }
      try {
        await this.sftpSafetyRunner.execute(operation.id, {
          confirmed: true,
          signal: options.signal
        })
      } catch (error) {
        if (!options.signal?.aborted && error?.name !== 'AbortError') throw error
        await Promise.allSettled(operations.slice(index).map(pending => (
          this.sftpSafetyRunner.cancel(pending.id)
        )))
        return false
      }
    }
    message.success(formatShellPilotTranslation(e, 'shellpilotSftpDeletedWithRecovery', {
      count: operations.length
    }))
    return true
  }

  getRemoteSafetyTargets = (files = this.getSelectedFiles()) => {
    return files.filter(file => {
      return file?.type === typeMap.remote && !file.isParent && !file.isEmpty
    })
  }

  quickBackupRemoteFiles = async (files = this.getSelectedFiles(), options = {}) => {
    const targets = this.getRemoteSafetyTargets(files)
    if (!targets.length) {
      if (!options.silent) message.warning('请先在远程 SFTP 面板选择文件或文件夹。')
      return false
    }
    try {
      const records = await backupRemoteFiles({
        sftp: this.sftp,
        files: targets,
        tab: this.props.tab
      })
      this.addSftpRecoveryRecords(records)
      if (!options.silent) {
        message.success(formatShellPilotTranslation(e, 'shellpilotSftpBackedUpWithRecovery', {
          count: records.length
        }))
      }
      return true
    } catch (err) {
      window.store.onError(err)
      if (!options.silent) message.error('SFTP 备份失败，原文件未改动。')
      return false
    }
  }

  hasSftpRecovery = (sourcePath) => {
    return Boolean(findLatestSftpRecoveryRecord(
      readSafetyOperationRecords(ls),
      sourcePath,
      this.props.tab?.id
    ))
  }

  restoreSftpRecord = async (record) => {
    if (!record || !['available', 'failed'].includes(record.status)) return false
    if (!matchesSafetyOperationEndpoint(record, this.props.tab || {}, true)) {
      message.warning(`请先连接服务器 ${record.host} 后再恢复。`)
      return false
    }
    try {
      const restored = await restoreSftpRecoveryRecord({
        sftp: this.sftp,
        record
      })
      const records = updateSafetyOperationRecord(
        readSafetyOperationRecords(ls),
        restored.id,
        restored
      )
      this.persistSftpRecoveryRecords(records)
      await this.remoteList()
      message.success('恢复完成；恢复前的当前内容也已另行保留。')
      return true
    } catch (err) {
      const records = updateSafetyOperationRecord(
        readSafetyOperationRecords(ls),
        record.id,
        {
          status: 'failed',
          rollbackStatus: 'failed',
          error: err?.message || String(err),
          failedAt: new Date().toISOString()
        }
      )
      this.persistSftpRecoveryRecords(records)
      window.store.onError(err)
      message.error('恢复失败，原有内容未被删除。')
      return false
    }
  }

  restoreLatestSftpBackup = async (sourcePath) => {
    const record = findLatestSftpRecoveryRecord(
      readSafetyOperationRecords(ls),
      sourcePath,
      this.props.tab?.id
    )
    if (!record) {
      message.info('当前文件没有可用的备份或安全删除记录。')
      return false
    }
    return this.restoreSftpRecord(record)
  }

  openSftpSafetyCenter = () => {
    window.dispatchEvent(new CustomEvent('shellpilot-open-safety-center'))
  }

  handleOpenSftpSafetyCenter = () => {
    this.openSftpSafetyCenter()
  }

  handleQuickBackupSelected = () => {
    this.quickBackupRemoteFiles()
  }

  delFiles = async (_type, files = this.getSelectedFiles(), options = {}) => {
    const type = files[0]?.type || _type
    if (type === typeMap.remote) {
      this.onDelete = true
      try {
        const deleted = await this.deleteRemoteFilesWithSafety(files, options)
        if (!deleted) return false
      } catch (err) {
        window.store.onError(err)
        message.error(e('shellpilotSftpDeleteFailedRecoveryRetained'))
        return false
      } finally {
        this.onDelete = false
      }
      await wait(500)
      await this.remoteList()
      return true
    }

    this.onDelete = true
    const confirm = await this.confirmDelete(files)
    this.onDelete = false
    if (!confirm) return false
    for (const file of files) {
      await this.localDel(file)
    }
    this.localList()
    return true
  }

  renderDelConfirmTitle (files = this.getSelectedFiles(), pureText) {
    const hasDirectory = some(files, f => f.isDirectory)
    const isRemote = files.length && files.every(f => f.type === typeMap.remote)
    const names = hasDirectory ? e('filesAndFolders') : e('files')
    if (isRemote) {
      const title = this.props.isFtp
        ? `FTP 将永久删除所选${names}，无恢复快照。确认继续吗？（${files.length}）`
        : `恢复快照已验证。确认删除所选${names}吗？（${files.length}）`
      return pureText ? title : <div className='wordbreak'>{title}</div>
    }
    if (pureText) {
      const t1 = hasDirectory
        ? e('delTip1')
        : ''
      return `${e('delTip')} ${names} ${t1} (${files.length})`
    }
    return (
      <div className='wordbreak'>
        {e('delTip')}
        {names}
        {
          hasDirectory
            ? e('delTip1')
            : ''
        }
        (<b className='mg1x'>{files.length}</b>)
      </div>
    )
  }

  enter = (type, e) => {
    const { selectedFiles, onEditFile } = this.state
    if (onEditFile || selectedFiles.size !== 1) {
      return
    }
    const fileId = Array.from(selectedFiles)[0]
    const file = this.getFileItemById(fileId)
    if (!file) {
      return
    }
    const { isDirectory } = file
    if (isDirectory) {
      this[type + 'Dom'].enterDirectory(e, file)
    } else {
      this.setState({
        filesToConfirm: [file]
      })
    }
  }

  onInputFocus = (type) => {
    this.setState({
      [type + 'InputFocus']: true
    })
    this.inputFocus = true
  }

  onInputBlur = (type) => {
    this.inputFocus = false
    this.timer4 = setTimeout(() => {
      this.setState({
        [type + 'InputFocus']: false
      })
    }, 200)
  }

  doCopy = (type, e) => {
    const selectedFiles = this.getSelectedFiles()
    this[type + 'Dom'].onCopy(selectedFiles)
  }

  doCut = (type, e) => {
    const selectedFiles = this.getSelectedFiles()
    this[type + 'Dom'].onCut(selectedFiles)
  }

  doPaste = (type) => {
    if (!hasFileInClipboardText()) {
      return
    }
    this[type + 'Dom'].onPaste()
  }

  initData = (terminalId, port) => {
    this.terminalId = terminalId
    this.port = port
    if (this.shouldRenderRemote()) {
      this.initRemoteAll()
    }
    this.initLocalAll()
  }

  shouldRenderRemote = () => {
    const { props } = this
    return props.tab?.host && props.tab?.type !== terminalSerialType
  }

  initLocalAll = () => {
    this.localListOwner()
    this.localList()
  }

  initRemoteAll = async () => {
    await this.remoteList()
    this.remoteListOwner()
  }

  modifier = (...args) => {
    // Check if first argument is an object and contains path changes
    if (args[0] && typeof args[0] === 'object') {
      const updates = args[0]

      // Clear respective keyword if path changes
      if (updates.localPath !== undefined) {
        updates.localKeyword = ''
      }
      if (updates.remotePath !== undefined) {
        updates.remoteKeyword = ''
      }

      // For selectedFiles updates, call setState immediately for better responsiveness
      if (updates.selectedFiles !== undefined) {
        return this.setState(...args)
      }
    }

    // For other updates, use runIdle to avoid blocking the UI
    runIdle(() => this.setState(...args))
  }

  addTransferList = list => {
    window.store.addTransferList(list)
  }

  onError = e => {
    window.store.onError(e)
    this.setState({
      remoteLoading: false
    })
  }

  getFileList = type => {
    const showHide = this.state[`${type}ShowHiddenFile`]
    const keyword = this.state[`${type}Keyword`]
    let list = this.state[type]
    list = isArray(list) ? list : []

    // Combine filtering for showHide and keyword in one loop
    if (!showHide || keyword) {
      const lowerKeyword = keyword.toLowerCase()
      list = list.filter(f => {
        if (!showHide && f.name.startsWith('.')) {
          return false
        }
        if (keyword && !f.name.toLowerCase().includes(lowerKeyword)) {
          return false
        }
        return true
      })
    }

    return this.sort(
      list,
      type,
      this.state[`sortDirection.${type}`],
      this.state[`sortProp.${type}`]
    )
  }

  toggleShowHiddenFile = type => {
    const prop = `${type}ShowHiddenFile`
    const b = this.state[prop]
    this.setState({
      [prop]: !b
    })
  }

  buildTree = (arr, type) => {
    const parent = this.renderParentItem(type)
    const treeMap = new Map(arr.map(d => [d.id, d]))

    // Only add parent if it exists
    if (parent) {
      treeMap.set(parent.id, parent)
    }

    return treeMap
  }

  remoteListOwner = async () => {
    const remoteUidTree = await owner.remoteListUsers(
      this.props.pid
    )
    const remoteGidTree = await owner.remoteListGroups(
      this.props.pid
    )
    this.setState({
      remoteGidTree,
      remoteUidTree
    })
  }

  localListOwner = async () => {
    const localUidTree = await owner.localListUsers()
    const localGidTree = await owner.localListGroups()
    this.setState({
      localGidTree,
      localUidTree
    })
  }

  sftpList = (sftp, remotePath) => {
    return sftp.list(remotePath)
      .then(arr => {
        return arr.map(item => {
          const { type } = item
          return {
            ...pick(
              item,
              ['name', 'size', 'accessTime', 'modifyTime', 'mode', 'owner', 'group']
            ),
            isDirectory: type === fileTypeMap.directory,
            type: typeMap.remote,
            path: remotePath,
            isSymbol: type === fileTypeMap.link,
            id: generate()
          }
        })
      })
  }

  remoteList = async (
    returnList = false,
    remotePathReal,
    oldPath
  ) => {
    const { tab, sessionOptions } = this.props
    const { username, startDirectory } = tab
    let remotePath
    const noPathInit = remotePathReal || this.state.remotePath
    if (noPathInit) {
      remotePath = noPathInit
    }
    if (!returnList) {
      this.setState({
        remoteLoading: true
      })
    }
    const oldRemote = deepCopy(
      this.state.remote
    )
    let sftp = this.sftp
    try {
      if (!this.sftp) {
        sftp = await Client(this.terminalId, this.type, this.port)
        if (!sftp) {
          return
        }
        const config = deepCopy(
          this.props.config
        )
        this.setState({
          loadingSftp: true
        })
        const opts = deepCopy({
          ...tab,
          readyTimeout: config.sshReadyTimeout,
          terminalId: this.terminalId,
          keepaliveInterval: config.keepaliveInterval,
          proxy: getProxy(tab, config),
          ...sessionOptions
        })
        const r = await sftp.connect(opts)
          .catch(e => {
            if (
              e &&
              e.message.includes(unexpectedPacketErrorDesc) && this.retryCount
            ) {
              this.retryHandler = setTimeout(
                () => this.initData(
                  true
                ),
                sftpRetryInterval
              )
              this.retryCount++
            } else {
              throw e
            }
          })
        this.setState(() => {
          return {
            loadingSftp: false
          }
        })
        if (!r) {
          sftp.destroy()
          return this.props.editTab(tab.id, {
            sftpCreated: false
          })
        } else {
          this.sftp = sftp
        }
      }

      if (!remotePath) {
        if (startDirectory) {
          remotePath = normalizeRemotePath(startDirectory)
        } else {
          remotePath = await this.getPwd(username)
        }
      }

      const remote = await this.sftpList(sftp, remotePath)
      this.sftp = sftp
      const update = {
        remote,
        remoteFileTree: this.buildTree(remote, typeMap.remote),
        inited: true,
        remoteLoading: false
      }
      if (!noPathInit) {
        update.remotePath = remotePath
        update.remotePathTemp = remotePath
      }
      if (returnList) {
        return remote
      } else {
        update.onEditFile = false
      }
      if (oldPath) {
        update.remotePathHistory = uniq([
          oldPath,
          ...this.state.remotePathHistory
        ]).slice(0, maxSftpHistory)
      }
      this.setState(update, () => {
        if (this.type !== 'ftp') {
          this.updateRemoteList(remote, remotePath, sftp)
        }
        this.props.editTab(tab.id, {
          sftpCreated: true
        })
      })
      this.timer5 = setTimeout(() => {
        if (this.type !== 'ftp') {
          this.updateRemoteList(remote, remotePath, sftp)
        }
        this.props.editTab(tab.id, {
          sftpCreated: true
        })
      }, 1000)
    } catch (e) {
      const update = {
        remoteLoading: false,
        remote: oldRemote,
        loadingSftp: false
      }
      if (oldPath) {
        update.remotePath = oldPath
        update.remotePathTemp = oldPath
      }
      this.setState(update)
      this.onError(e)
    }
  }

  updateRemoteList = async (
    remotes,
    remotePath,
    sftp
  ) => {
    const remote = []
    for (const r of remotes) {
      const { name } = r
      if (r.isSymbol) {
        const linkPath = resolve(remotePath, name)
        let realpath = await sftp.readlink(linkPath)
          .catch(e => {
            console.debug(e)
            return null
          })
        if (!realpath) {
          continue
        }
        if (!isAbsPath(realpath)) {
          realpath = resolve(remotePath, realpath)
          realpath = await sftp.realpath(realpath)
        }
        const realFileInfo = await getRemoteFileInfo(
          sftp,
          realpath
        ).catch(e => {
          console.debug('seems a bad symbolic link')
          console.debug(e)
          return null
        })
        if (!realFileInfo) {
          continue
        }
        r.isSymbolicLink = true
        r.isDirectory = realFileInfo.isDirectory
      } else {
        r.isSymbolicLink = false
      }
      remote.push(r)
    }
    const update = {
      remote,
      remoteFileTree: this.buildTree(remote, typeMap.remote)
    }
    this.setState(update)
  }

  getLocalHome = () => {
    return this.props.tab.startDirectoryLocal ||
    this.props.config.startDirectoryLocal ||
    window.pre.homeOrTmp
  }

  localList = async (returnList = false, localPathReal, oldPath) => {
    if (!window.fs) return
    if (!returnList) {
      this.setState({
        localLoading: true
      })
    }
    const oldLocal = deepCopy(
      this.state.local
    )
    try {
      const noPathInit = localPathReal || this.state.localPath
      const localPath = noPathInit ||
        this.getCwdLocal() ||
        this.getLocalHome()
      const locals = await window.fs.readdirAsync(localPath)
      const local = []
      for (const name of locals) {
        const p = resolve(localPath, name)
        const fileObj = await getLocalFileInfo(p).catch(console.log)
        if (fileObj) {
          local.push(fileObj)
        }
      }
      const update = {
        local,
        inited: true,
        localFileTree: this.buildTree(local, typeMap.local),
        localLoading: false
      }
      if (!noPathInit) {
        update.localPath = localPath
        update.localPathTemp = localPath
      }
      if (returnList) {
        return local
      } else {
        update.onEditFile = false
      }
      if (oldPath) {
        update.localPathHistory = uniq([
          oldPath,
          ...this.state.localPathHistory
        ]).slice(0, maxSftpHistory)
      }
      this.setState(update)
    } catch (e) {
      const update = {
        localLoading: false,
        local: oldLocal
      }
      if (oldPath) {
        update.localPath = oldPath
        update.localPathTemp = oldPath
      }
      this.setState(update)
      this.onError(e)
    }
  }

  remoteListDebounce = debounce(this.remoteList, 1000)

  localListDebounce = debounce(this.localList, 1000)

  timers = {}

  onChange = (e, prop) => {
    this.setState({
      [prop]: e.target.value
    })
  }

  onClickHistory = (type, path) => {
    const n = `${type}Path`
    const oldPath = this.state[type + 'Path']
    this.setState({
      [n]: path,
      [`${n}Temp`]: path
    }, () => this[`${type}List`](undefined, undefined, oldPath))
  }

  handleReloadRemoteSftp = async () => {
    if (this.sftp) {
      this.sftp.destroy()
      this.sftp = null
    }
    this.setState({
      remoteLoading: true,
      remote: [],
      remoteFileTree: new Map()
    }, () => {
      this.initRemoteAll()
    })
  }

  handleUploadFromBrowser = () => {
    if (window.et.handleUploadFromBrowser) {
      return window.et.handleUploadFromBrowser(
        this.state.localPath,
        this.localList
      )
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = async () => {
      const files = input.files
      if (!files || !files.length) return
      const { localPath } = this.state
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('path', localPath)
        await window.api.fetch('/api/upload', {
          method: 'POST',
          body: formData
        }).catch(handleErr)
      }
      this.localList()
    }
    input.click()
  }

  parsePath = async (type, pth) => {
    const reg = /^%([^%]+)%/
    if (!reg.test(pth)) {
      return pth
    }
    const m = pth.match(reg)
    if (!m || !m[1]) {
      return pth
    }
    const envName = m[1]
    const envPath = await window.pre.runGlobalAsync('getEnv', envName)
    if (envPath) {
      return pth.replace(reg, envPath)
    }
    return pth
  }

  onGoto = async (type, e) => {
    e && e.preventDefault()
    if (type === typeMap.remote && !this.sftp) {
      return this.initData(true)
    }
    const n = `${type}Path`
    const nt = n + 'Temp'
    const oldPath = this.state[type + 'Path']
    let np = await this.parsePath(type, this.state[nt])
    if (type === typeMap.remote) {
      np = normalizeRemotePath(np)
    }
    if (!isValidPath(np)) {
      return notification.warning({
        message: e('shellpilotPathNotValid')
      })
    }
    this.setState({
      [n]: np,
      [nt]: np,
      [`${type}Keyword`]: ''
    }, () => this[`${type}List`](undefined, undefined, oldPath))
  }

  goParent = (type) => {
    const n = `${type}Path`
    const p = this.state[n]
    let np = resolve(p, '..')
    if (type === typeMap.remote) {
      np = normalizeRemotePath(np)
    }
    const op = this.state[n]
    if (np !== p) {
      this.setState({
        [n]: np,
        [n + 'Temp']: np
      }, () => this[`${type}List`](
        undefined,
        undefined,
        op
      ))
    }
  }

  getFileProps = (file, type) => {
    return {
      ...this.props,
      file,
      type,
      ...pick(this, [
        'sftp',
        'modifier',
        'localList',
        'remoteList',
        'localDel',
        'remoteDel',
        'delFiles',
        'getIndex',
        'selectAll',
        'getFileList',
        'onGoto',
        'addTransferList',
        'renderDelConfirmTitle',
        'getSelectedFiles',
        'getFileItemById',
        'quickBackupRemoteFiles',
        'changeRemoteFileMode',
        'renameRemoteFile',
        'saveRemoteEditorFile',
        'restoreLatestSftpBackup',
        'openSftpSafetyCenter',
        'hasSftpRecovery'
      ]),
      ...pick(this.state, [
        'id',
        'localPath',
        'remotePath',
        'localFileTree',
        'remoteFileTree',
        'localOrder',
        'remoteOrder',
        'sortData',
        typeMap.local,
        typeMap.remote,
        'lastClickedFile',
        'lastMataKey',
        'targetTransferType',
        'selectedFiles',
        'localGidTree',
        'remoteUidTree',
        'localUidTree',
        'remoteGidTree'
      ])
    }
  }

  renderEmptyFile = (type, extra = {}) => {
    const uniqueId = this.getPathUid(type, 'empty')
    const item = {
      type,
      name: '',
      isDirectory: true,
      id: uniqueId,
      isEmpty: true
    }
    const allProps = {
      ...this.getFileProps(item, type),
      ...extra,
      cls: 'virtual-file-unit',
      key: 'empty' + type,
      isEmpty: true,
      draggable: false,
      ref: ref => {
        this[type + 'Dom'] = ref
      }
    }
    return (
      <div
        className={`virtual-file virtual-file-${type}`}
      >
        <FileSection
          {...allProps}
          key={uniqueId}
        />
      </div>
    )
  }

  getPathUid = (type, type1) => {
    const currentPath = this.state[`${type}Path`]
    const parentPath = resolve(currentPath, '..')
    const { id } = this.props.tab
    return `${type1}-${parentPath}-${id}-${type}`
  }

  renderParentItem = (type) => {
    const currentPath = this.state[`${type}Path`]
    const parentPath = resolve(currentPath, '..')
    // Don't render parent item if we're at the root
    if (parentPath === currentPath) {
      return null
    }

    const uniqueId = this.getPathUid(type, 'parent')

    return {
      type,
      isDirectory: true,
      ...getFolderFromFilePath(parentPath, type === typeMap.remote),
      id: uniqueId,
      size: 0,
      modifyTime: 0,
      accessTime: 0,
      mode: 0,
      owner: '',
      group: '',
      isParent: true
    }
  }

  renderHistory = (type) => {
    const currentPath = this.state[type + 'Path']
    const options = this.state[type + 'PathHistory']
      .filter(o => o !== currentPath)
    const focused = this.state[type + 'InputFocus']
    if (!options.length) {
      return null
    }
    const cls = classnames(
      'sftp-history',
      `sftp-history-${type}`,
      { focused }
    )
    return (
      <div
        className={cls}
      >
        {
          options.map(o => {
            return (
              <div
                key={o}
                className='sftp-history-item'
                onClick={() => this.onClickHistory(type, o)}
              >
                {o}
              </div>
            )
          })
        }
      </div>
    )
  }

  renderSftpPanelTitle (type, username, host) {
    if (type === typeMap.remote) {
      const selectedCount = this.getRemoteSafetyTargets().length
      return (
        <div className='sftp-panel-title sftp-panel-title-remote pd1t pd1b pd1x'>
          <span className='sftp-panel-location'>{e('remote')}: {username}@{host}</span>
          <span className='sftp-safety-actions'>
            <Button
              size='small'
              type='text'
              icon={<SaveOutlined />}
              disabled={!selectedCount}
              onClick={this.handleQuickBackupSelected}
            >
              {selectedCount
                ? formatShellPilotTranslation(e, 'shellpilotSftpQuickBackupCount', { count: selectedCount })
                : e('shellpilotSftpQuickBackup')}
            </Button>
            <Button
              size='small'
              type='text'
              icon={<SafetyCertificateOutlined />}
              onClick={this.handleOpenSftpSafetyCenter}
            >
              {e('shellpilotSftpSafetyCenter')}
            </Button>
          </span>
          <ReloadOutlined
            className='pointer'
            onClick={this.handleReloadRemoteSftp}
          />
        </div>
      )
    }
    return (
      <div className='sftp-panel-title pd1t pd1b pd1x'>
        {e('local')}
      </div>
    )
  }

  renderSection (type, style, width) {
    const {
      id
    } = this.state
    const arr = this.getFileList(type)
    const loading = this.state[`${type}Loading`]
    const { host, username } = this.props.tab
    const listProps = {
      store: window.store,
      id,
      type,
      parentItem: this.renderParentItem(type),
      ...this.props,
      ...pick(
        this,
        [
          'directions',
          'renderEmptyFile',
          'getFileProps',
          'defaultDirection',
          'modifier',
          'sort'
        ]
      ),
      sortProp: this.state[`sortProp.${type}`],
      sortDirection: this.state[`sortDirection.${type}`],
      width,
      fileList: arr
    }
    const addrProps = {
      host,
      type,
      handleUploadFromBrowser: this.handleUploadFromBrowser,
      ...pick(
        this,
        [
          'onChange',
          'onGoto',
          'gotoHome',
          'onInputFocus',
          'onInputBlur',
          'toggleShowHiddenFile',
          'goParent',
          'onClickHistory',
          'updateKeyword'
        ]
      ),
      ...pick(
        this.state,
        [
          `${type}ShowHiddenFile`,
          'onGoto',
          `${type}PathTemp`,
          `${type}Path`,
          `${type}PathHistory`,
          `${type}InputFocus`,
          'loadingSftp',
          `${type}Keyword`
        ]
      )
    }
    return (
      <div
        className={`sftp-section sftp-${type}-section tw-${type}`}
        style={style}
        key={type}
        {...style}
      >
        <Spin spinning={loading}>
          <div className='pd1 sftp-panel'>
            {
              this.renderSftpPanelTitle(type, username, host)
            }
            <AddressBar
              {...addrProps}
            />
            <div
              className={`file-list ${type} relative`}
            >
              <ListTable
                {...listProps}
              />
            </div>
          </div>
        </Spin>
      </div>
    )
  }

  renderSections () {
    if (!this.isActive()) {
      return null
    }
    const arr = [
      typeMap.local,
      typeMap.remote
    ]
    const {
      height, width
    } = this.props
    const shouldRenderRemote = this.shouldRenderRemote()
    if (!shouldRenderRemote) {
      return (
        this.renderSection(arr[0], {
          width,
          left: 0,
          top: 0,
          height
        }, width)
      )
    }
    return arr.map((t, i) => {
      const style = {
        width: width / 2,
        left: i * width / 2,
        top: 0,
        height
      }
      return this.renderSection(t, style, width / 2)
    })
  }

  render () {
    const {
      id,
      ready
    } = this.state
    if (!ready) {
      return (
        <div className='pd3 aligncenter'>
          <LoadingOutlined />
        </div>
      )
    }
    const { height } = this.props
    const all = {
      className: 'sftp-wrap overhide relative',
      id: `id-${id}`,
      style: { height }
    }
    return (
      <div
        {...all}
      >
        {
          this.renderSections()
        }
      </div>
    )
  }
}
