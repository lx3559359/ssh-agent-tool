import { Component } from 'react'
import { refs } from '../common/ref'
import generate from '../../common/uid'
import runIdle from '../../common/run-idle'
import { Spin, Button } from 'antd'
import { notification } from '../common/notification'
import Modal from '../common/modal'
import clone from '../../common/to-simple-obj'
import { isEqual, some, isArray, pick, uniq, debounce } from 'lodash-es'
import FileSection from './file-item'
import resolve from '../../common/resolve'
import isAbsPath from '../../common/is-absolute-path'
import classnames from 'classnames'
import { handleErr } from '../../common/fetch'
import { getLocalFileInfo, getFolderFromFilePath } from './file-read'
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
import { isAuthoritativeRemoteMissingError } from './remote-file-errors.js'
import {
  assertRootSftpRecoveryBinding,
  assertSftpRecoveryIdentityProvenance,
  backupRemoteFiles,
  createRootSftpRecoveryBinding,
  createSftpRecoveryBindingMismatchError,
  createSftpRecoveryUncertainError,
  restoreSftpRecoveryRecord,
  findLatestSftpRecoveryRecord
} from './sftp-safety'
import {
  createSftpTransactionAdapter,
  digestSftpText
} from './sftp-transaction-adapter.js'
import { formatSftpEditorSaveError } from './sftp-editor-permission-error.js'
import SftpTransferProgressDock from './sftp-transfer-progress-dock.jsx'
import {
  buildSftpTextChangePreview,
  readSftpSnapshotText
} from './sftp-text-change-preview.js'
import {
  createAiFileChangeSet,
  formatAiFileChangeDiffPreview
} from '../ai/ai-file-change-set.js'
import {
  requestAiFileChangeReview
} from '../ai/ai-file-change-review-modal.jsx'
import {
  nextSftpSelectionId,
  preserveSftpDraftItems,
  reconcileSelectedFileIds
} from './file-selection.js'
import {
  activateRemoteFileGeneration,
  beginSftpEntryRemoteTask,
  commitSftpEntryRemoteClient,
  destroySftpEntryClientOnce,
  drainRemoteFileGeneration,
  disposeSftpEntryReadiness,
  disposeSftpEntryScheduling,
  bindSftpEntryRemoteSession,
  beginSftpEntryRenderCommit,
  getSftpEntryReadinessSnapshot,
  initializeSftpEntryReadiness,
  initializeRemoteFileGeneration,
  isCurrentRemoteFileGeneration,
  quiesceSftpEntryTransfers,
  removeDeletedRemoteEntries,
  reconnectSftpEntryRemote,
  runTrackedSftpBackgroundTask,
  startSftpEntryExplicitInitialization,
  isCurrentSftpEntryRemoteTask,
  replaceSftpEntryTimer,
  shouldRetryUnexpectedSftpPacket,
  trackSftpEntryBackgroundTask,
  trackSftpEntryMetric
} from './sftp-entry-lifecycle.js'
import { createTransactionRunner } from '../../common/safety-transactions/transaction-runner.js'
import { buildSideEffectSafetyRequest } from '../../common/safety-transactions/side-effect-model.js'
import { assertSameSessionEndpoint } from '../../common/safety-transactions/endpoint-guard.js'
import {
  assertSameSftpSafetyEndpoint,
  buildSftpSafetyEndpoint
} from './sftp-safety-endpoint.js'
import * as sftpSafetyStore from '../../common/safety-transactions/transaction-store.js'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import {
  buildFastDeleteTargets,
  executeFastRemoteDelete
} from './sftp-fast-delete.js'
import { buildDeleteTargetPreview } from './sftp-delete-dialog-model.js'
import { openSafeDeleteDialog } from './sftp-delete-dialog.jsx'
import {
  mergeSafetyOperationRecords,
  matchesSafetyOperationEndpoint,
  readSafetyOperationRecords,
  updateSafetyOperationRecord,
  writeSafetyOperationRecords
} from '../../common/safety-operation-records'
import {
  acquireRemoteFileCapability,
  beginRemoteFileCapabilityProbe,
  createRemoteFileTransferCapability
} from './remote-file-capability.js'
import {
  AI_FILE_PREVIEW_MAX_BYTES,
  readSftpFileContext
} from '../ai/ai-chat-context-actions.js'
import {
  createRemoteFileContextReader,
  readRemoteFileBase64Preview,
  REMOTE_ATTACHMENT_MAX_BYTES
} from './remote-file-context-reader.js'
import {
  buildRemoteDirectoryCacheKey,
  createRemoteDirectoryCache
} from './remote-directory-cache.js'
import { recordPerformanceDuration } from '../../common/quality/quality-events.js'
import './sftp.styl'

const e = window.translate
const transferSafetyTerminalStates = new Set([
  'rollback-available',
  'completed',
  'kept',
  'restored',
  'failed',
  'cancelled'
])

const waitForSafeDeleteDialogPaint = () => new Promise(resolve => {
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    setTimeout(resolve, 0)
    return
  }
  globalThis.requestAnimationFrame(() => {
    // A timer queued from requestAnimationFrame runs after the browser has
    // had an opportunity to paint the already-mounted confirmation dialog.
    setTimeout(resolve, 0)
  })
})

function abortRemoteFileOperation (signal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('远程文件操作已取消。')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  throw error
}

function remoteFileOperationUnmounted () {
  const error = new Error('远程文件组件已卸载，操作已取消。')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function remoteFileOperationStale () {
  const error = new Error('远程文件会话已变化，操作已取消。')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function createRemoteFileRootRequiredError () {
  const error = new Error('该恢复记录由 root 文件操作创建；请先在当前终端重新进入 UID 0 Shell。')
  error.code = 'REMOTE_FILE_ROOT_REQUIRED'
  return error
}

function createRemoteFileRecoveryPersistenceError (cause, evidence = {}) {
  const error = createSftpRecoveryUncertainError({
    message: e('shellpilotSftpRecoveryPersistenceUncertain'),
    primaryCause: cause,
    record: evidence.record
  })
  error.cause = cause
  if (evidence.records) error.recoveryRecords = evidence.records
  return error
}

function isRemoteDirectory (stat) {
  if (typeof stat?.isDirectory === 'function') return stat.isDirectory()
  if (typeof stat?.isDirectory === 'boolean') return stat.isDirectory
  if (typeof stat?.type === 'string') {
    return stat.type === 'd' || stat.type === 'directory'
  }
  if (typeof stat?.type === 'number') return stat.type === 2
  return typeof stat?.mode === 'number' &&
    (stat.mode & 0o170000) === 0o040000
}

function formatEffectiveFileIdentity (identity, translate = e) {
  const username = String(identity?.effectiveUsername || '').trim()
  const channel = identity?.channel
  if (!username || !['sftp', 'pty-root'].includes(channel)) {
    return translate('shellpilotSftpEffectiveFileIdentityUnknown')
  }
  return formatShellPilotTranslation(
    translate,
    'shellpilotSftpEffectiveFileIdentity',
    {
      username,
      channel: translate(channel === 'pty-root'
        ? 'shellpilotSftpCurrentTerminal'
        : 'shellpilotSftpNativeChannel')
    }
  )
}

function resolveRemoteFileStatus ({
  rootLeaseCount = 0,
  unavailable = false,
  releaseUncertain = false
} = {}) {
  if (releaseUncertain) return 'uncertain'
  if (rootLeaseCount > 0) return 'busy'
  return unavailable ? 'unavailable' : 'idle'
}

function shouldRenderSshFileIdentity (props, protocolType) {
  return !props?.isFtp && protocolType !== 'ftp'
}

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
      remoteFileIdentity: {
        loginUsername: props.tab?.username || '',
        effectiveUid: '',
        effectiveUsername: '',
        channel: 'unknown'
      },
      remoteFileStatus: 'idle',
      remoteRefreshState: 'idle',
      remoteRefreshError: '',
      sftpRecoveryRecords: readSafetyOperationRecords(ls)
    }
    this.retryCount = 0
    this.sftpReadyStartedAt = 0
    this.firstSftpReadyRecorded = false
    this.remoteDirectoryCache = createRemoteDirectoryCache()
    this.remoteFileOperationBackends = new Map()
    this.remoteFileOperationBackendPins = new Map()
    this.transferSafetySessionPins = new Map()
    this.transferSafetySessionAliases = new Map()
    this.preparedTransferFileSessions = new Map()
    this.remoteFileOperationSequence = 0
    this.remoteFileOperations = new Set()
    this.remoteFileOperationSettlements = new Set()
    this.remoteFileOperationTail = Promise.resolve()
    this.remoteFileUnmounted = false
    this.remoteFileIdentityEpoch = 0
    this.activeRemoteFileLeases = new Set()
    this.uncertainRemoteFileLeases = new Set()
    this.preparedRemoteFileCapabilityProbe = null
    initializeSftpEntryReadiness(this)
    initializeRemoteFileGeneration(this)
    this.sftpSafetyProgressHandlers = new Map()
    this.sftpSafetyAdapter = createSftpTransactionAdapter({
      getSftp: operation => this.getRemoteFileOperationBackend(operation),
      onProgress: (operation, progress) => {
        this.sftpSafetyProgressHandlers.get(operation.id)?.(progress)
      }
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
    replaceSftpEntryTimer(this, 'timer', () => {
      this.setState({
        ready: true
      })
    }, 0)
  }

  componentDidUpdate (prevProps, prevState) {
    const switchedToSftp =
      prevProps.pane !== this.props.pane &&
      this.props.pane === paneMap.fileManager
    const switchedToSplitSftp =
      prevProps.sshSftpSplitView !== this.props.sshSftpSplitView &&
      this.props.sshSftpSplitView === true
    const explicitlyOpenedSftp = this.props.enableSftp === true &&
      (switchedToSftp || switchedToSplitSftp)
    if (
      explicitlyOpenedSftp &&
      this.shouldRenderRemote() &&
      this.props.tab?.sftpCreated !== true &&
      !this.state.loadingSftp &&
      !this.state.remoteLoading
    ) {
      startSftpEntryExplicitInitialization(
        this,
        () => this.initRemoteAll({ explicitOpen: true }),
        { reportError: error => this.onError(error) }
      )
    } else if (
      this.props.config.autoRefreshWhenSwitchToSftp &&
      explicitlyOpenedSftp &&
      this.state.inited
    ) {
      this.runSftpBackgroundTask(() => this.onGoto(typeMap.local))
      this.runSftpBackgroundTask(() => this.onGoto(typeMap.remote))
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
    if (this.remoteFileUnmounted) return this.remoteFileDisposalPromise
    this.remoteFileUnmounted = true
    this.disposeSftpReadiness?.()
    this.remoteDirectoryCache?.clear?.()
    this.resetRemoteFileLeaseOutcome?.({ publish: false })
    const transferSettlement = this.quiesceActiveTransfers?.()
    const preparedDrain = transferSettlement
      ? null
      : drainRemoteFileGeneration(this)
    this.remoteFileDisposalPromise = (async () => {
      let primaryError
      if (transferSettlement) {
        try {
          await transferSettlement
        } catch (error) {
          primaryError = error
        }
      }
      const drain = preparedDrain || drainRemoteFileGeneration(this)
      let result
      try {
        result = await drain.promise
      } catch (error) {
        primaryError ||= error
      } finally {
        this.clearTransferSafetySessionPins?.()
      }
      if (primaryError) throw primaryError
      return result
    })()
    this.runSftpBackgroundTask?.(() => this.remoteFileDisposalPromise)
    refs.remove(this.id)
    this.sftpSafetyProgressHandlers.clear()
    this.sftpSafetyAdapter.discardAllPreparedProofs()
    disposeSftpEntryScheduling(this)
    // Clear sort cache to prevent memory leaks
    this._sortCache?.clear()
    this._lastSortArgs = null
    return this.remoteFileDisposalPromise
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
    }, () => this.runSftpBackgroundTask(
      () => this[`${type}List`]()
    ))
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
    }, () => this.runSftpBackgroundTask(
      () => this[`${type}List`]()
    ))
  }

  getPwd = async (username, sftp = this.sftp) => {
    if (this.props.sftpPathFollowSsh && this.props.cwd) {
      return this.props.cwd
    }
    const home = await sftp.getHomeDir()
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
      selectedFiles: new Set(this.getFileList(type).map(f => f.id)),
      selectedType: type
    })
  }

  selectNext = (type, currentId, onSelected) => {
    const { selectedFiles } = this.state
    const fileList = this.getFileList(type)
    const nextId = nextSftpSelectionId(fileList, selectedFiles, 'next', currentId)
    const nextFile = fileList.find(file => file.id === nextId)
    if (nextFile) {
      this.setState({
        selectedFiles: new Set([nextFile.id])
      }, () => onSelected?.(nextFile.id))
      return nextFile.id
    }
  }

  selectPrev = (type, currentId, onSelected) => {
    const { selectedFiles } = this.state
    const fileList = this.getFileList(type)
    const nextId = nextSftpSelectionId(fileList, selectedFiles, 'previous', currentId)
    const nextFile = fileList.find(file => file.id === nextId)
    if (nextFile) {
      this.setState({
        selectedFiles: new Set([nextFile.id])
      }, () => onSelected?.(nextFile.id))
      return nextFile.id
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

  remoteDel = async (file, backend) => {
    const { name, isDirectory, path } = file
    const func = isDirectory
      ? backend.rmdir
      : backend.rm
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
    return persisted
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
    const terminal = refs.get('term-' + this.props.tab.id)
    return buildSftpSafetyEndpoint({
      tab: this.props.tab,
      terminalId: this.terminalId,
      sftpSessionGeneration: this.sftp.sshSessionGeneration,
      sftpSshTerminalPid: this.sftp.sshTerminalPid,
      terminalEndpoint: terminal?.getTerminalSafetyEndpoint?.()
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

  pinRemoteFileOperationBackend = (id, backend) => {
    this.remoteFileOperationBackends.set(id, backend)
    this.remoteFileOperationBackendPins.set(id, backend)
    return backend
  }

  unpinRemoteFileOperationBackend = id => {
    this.remoteFileOperationBackends.delete(id)
    this.remoteFileOperationBackendPins.delete(id)
  }

  getRemoteFileOperationBackend = operation => {
    const id = operation?.id
    return this.transferSafetySessionPins?.get(id)?.backend ||
      this.remoteFileOperationBackends.get(id) ||
      this.remoteFileOperationBackendPins.get(id)
  }

  assertTransferSafetySession = session => {
    if (!session || session.capability !== this || !session.backend ||
      session.sftp !== session.backend || !Object.isFrozen(session) ||
      Object.getPrototypeOf(session) !== null) {
      throw new Error('安全传输缺少当前受控文件会话，已阻止远程操作。')
    }
    return session
  }

  pinTransferSafetySession = (plan, session) => {
    const pinned = this.assertTransferSafetySession(session)
    const operationId = String(plan?.operationId || '')
    if (!operationId) throw new Error('安全传输缺少 operation id')
    const taskId = plan?.metadata?.taskId
      ? String(plan.metadata.taskId)
      : ''
    const aliases = [...new Set([operationId, taskId].filter(Boolean))]
    for (const id of aliases) {
      const existing = this.transferSafetySessionPins.get(id)
      if (existing && existing !== pinned) {
        throw new Error('安全传输会话已变更，已阻止跨后端操作。')
      }
    }
    for (const id of aliases) {
      this.transferSafetySessionPins.set(id, pinned)
      this.remoteFileOperationBackends.set(id, pinned.backend)
      this.remoteFileOperationBackendPins.set(id, pinned.backend)
    }
    this.transferSafetySessionAliases.set(operationId, Object.freeze({
      session: pinned,
      aliases: Object.freeze(aliases)
    }))
    return pinned
  }

  assertTransferSafetySessionPin = (id, session) => {
    const pinned = this.transferSafetySessionPins.get(String(id || ''))
    if (!pinned || (session && pinned !== session)) {
      throw new Error('安全传输会话绑定已失效，已阻止跨后端操作。')
    }
    return this.assertTransferSafetySession(pinned)
  }

  unpinTransferSafetySession = (id, session) => {
    const operationId = String(id || '')
    const binding = this.transferSafetySessionAliases.get(operationId)
    if (session && binding?.session && binding.session !== session) {
      return false
    }
    const aliases = binding?.aliases ||
      (Array.isArray(binding) ? binding : [operationId])
    for (const alias of aliases) {
      const pinned = this.transferSafetySessionPins.get(alias)
      if (session && pinned && pinned !== session) continue
      if (pinned) {
        this.transferSafetySessionPins.delete(alias)
        if (this.remoteFileOperationBackends.get(alias) === pinned.backend) {
          this.remoteFileOperationBackends.delete(alias)
        }
        if (this.remoteFileOperationBackendPins.get(alias) === pinned.backend) {
          this.remoteFileOperationBackendPins.delete(alias)
        }
      }
    }
    if (!binding || this.transferSafetySessionAliases.get(operationId) ===
      binding) {
      this.transferSafetySessionAliases.delete(operationId)
    }
    return true
  }

  unpinTransferSafetySessionsForSession = session => {
    if (!session) return false
    for (const [operationId, binding] of [
      ...this.transferSafetySessionAliases
    ]) {
      const aliases = binding?.aliases ||
        (Array.isArray(binding) ? binding : [operationId])
      const bindingSession = binding?.session || aliases
        .map(alias => this.transferSafetySessionPins.get(alias))
        .find(Boolean)
      if (bindingSession !== session) continue
      if (this.transferSafetySessionAliases.get(operationId) !== binding) {
        continue
      }
      this.unpinTransferSafetySession(operationId, session)
    }
    return true
  }

  clearTransferSafetySessionPins = () => {
    for (const [id, session] of this.transferSafetySessionPins) {
      if (this.remoteFileOperationBackends.get(id) === session.backend) {
        this.remoteFileOperationBackends.delete(id)
      }
      if (this.remoteFileOperationBackendPins.get(id) === session.backend) {
        this.remoteFileOperationBackendPins.delete(id)
      }
    }
    this.transferSafetySessionPins.clear()
    this.transferSafetySessionAliases.clear()
    this.preparedTransferFileSessions.clear()
  }

  quiesceActiveTransfers = () => quiesceSftpEntryTransfers(this)

  rollbackSafetyOperation = async id => {
    const operation = await this.assertSftpSafetyOperationEndpoint(id)
    const result = await this.withRemoteFileOperation({
      id: `rollback:${id}`,
      settlementOwnsCapability: true
    }, async (backend, capability) => {
      const requiresRoot = operation.metadata?.runtimeIdentity?.channel === 'pty-root'
      const currentIdentity = capability.runtimeIdentity || {}
      if (requiresRoot && (
        currentIdentity.channel !== 'pty-root' ||
        String(currentIdentity.effectiveUid) !== '0'
      )) {
        throw createRemoteFileRootRequiredError()
      }
      this.remoteFileOperationBackends.set(operation.id, backend)
      this.remoteFileOperationBackendPins?.set(operation.id, backend)
      try {
        return await this.sftpSafetyRunner.rollback(operation.id)
      } finally {
        this.remoteFileOperationBackends.delete(operation.id)
        this.remoteFileOperationBackendPins?.delete(operation.id)
      }
    })
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

  confirmPreparedSftpOperation = (title, confirmationDetails) => {
    const preview = confirmationDetails?.preview
    const prefix = {
      add: '+',
      remove: '-',
      context: ' '
    }
    return new Promise(resolve => {
      Modal.confirm({
        title,
        content: (
          <div className='sftp-safety-confirmation'>
            <div>{e('shellpilotSftpRestoreConfirmDescription')}</div>
            {
              confirmationDetails && (
                <div className='sftp-text-change-confirmation'>
                  <div className='sftp-text-change-path'>
                    {confirmationDetails.path}
                  </div>
                  {
                    preview
                      ? (
                        <>
                          <div className='sftp-text-change-summary'>
                            {formatShellPilotTranslation(
                              e,
                              'shellpilotSftpTextChangeSummary',
                              {
                                added: preview.addedLines,
                                removed: preview.removedLines
                              }
                            )}
                          </div>
                          {
                            preview.lines.length > 0 && (
                              <pre className='sftp-text-change-preview'>
                                {
                                  preview.lines.map((line, index) => (
                                    <div
                                      className={`sftp-text-change-line is-${line.type}`}
                                      key={`${line.type}-${line.oldLine || 0}-${line.newLine || 0}-${index}`}
                                    >
                                      <span>{prefix[line.type]}</span>
                                      <code>{line.text || ' '}</code>
                                    </div>
                                  ))
                                }
                              </pre>
                            )
                          }
                          {
                            preview.truncated && (
                              <div className='sftp-text-change-note'>
                                {e('shellpilotSftpTextChangeTruncated')}
                              </div>
                            )
                          }
                        </>
                        )
                      : (
                        <div className='sftp-text-change-note'>
                          {e('shellpilotSftpTextChangeUnavailable')}
                        </div>
                        )
                  }
                </div>
              )
            }
          </div>
        ),
        okText: e('shellpilotSftpConfirmExecute'),
        cancelText: e('cancel'),
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
  }

  prepareSftpSafetyOperation = async ({
    id,
    action,
    paths,
    type,
    requestedMode,
    expected,
    title,
    signal,
    metadata,
    onProgress
  }, { backend, runtimeIdentity } = {}) => {
    const request = buildSideEffectSafetyRequest({
      id: id || `sftp-${action}-${Date.now()}-${generate()}`,
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
      metadata: {
        sftpSafetyTransaction: true,
        ...(runtimeIdentity ? { runtimeIdentity } : {}),
        ...metadata
      }
    })
    request.signal = signal
    if (backend) {
      this.remoteFileOperationBackends.set(request.id, backend)
      this.remoteFileOperationBackendPins?.set(request.id, backend)
    }
    if (typeof onProgress === 'function') {
      this.sftpSafetyProgressHandlers.set(request.id, onProgress)
    }
    try {
      return await this.sftpSafetyRunner.prepare(request)
    } catch (error) {
      this.sftpSafetyProgressHandlers.delete(request.id)
      this.sftpSafetyAdapter.discardPreparedProof(request.id)
      if (backend) {
        this.remoteFileOperationBackends.delete(request.id)
        this.remoteFileOperationBackendPins?.delete(request.id)
      }
      throw error
    }
  }

  prepareTransferSafetyOperation = async (plan, session) => {
    const pinnedSession = this.pinTransferSafetySession(plan, session)
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
        traceId: plan.metadata?.traceId,
        runtimeIdentity: plan.metadata?.runtimeIdentity,
        transferTaskId: plan.metadata?.taskId
      }
    })
    try {
      const existing = await sftpSafetyStore.getOperation(request.id)
      if (existing) {
        await this.assertSftpSafetyOperationEndpoint(existing.id)
        if (existing.effectKey !== request.effectKey) {
          throw new Error('同一传输标识已绑定其他远程目标，已阻止覆盖恢复点')
        }
        return existing
      }
      return await this.sftpSafetyRunner.prepare(request)
    } catch (error) {
      this.unpinTransferSafetySession(request.id, pinnedSession)
      throw error
    }
  }

  beginTransferSafetyOperation = async (id, options = {}, session) => {
    this.assertTransferSafetySessionPin(id, session)
    await this.assertSftpSafetyOperationEndpoint(id)
    try {
      return await this.sftpSafetyRunner.beginExternalExecution(id, {
        ...options,
        confirmed: true
      })
    } catch (error) {
      try {
        await this.sftpSafetyRunner.cancel(id)
      } catch (cancelError) {
        if (Object.isExtensible(error)) error.cancelError ||= cancelError
      } finally {
        this.unpinTransferSafetySession(id, session)
      }
      throw error
    }
  }

  getTransferSafetyOperation = async (id, session) => {
    this.assertTransferSafetySessionPin(id, session)
    const operation = await this.assertSftpSafetyOperationEndpoint(id)
    if (transferSafetyTerminalStates.has(operation.state)) {
      this.unpinTransferSafetySession(id, session)
    }
    return operation
  }

  completeTransferSafetyOperation = async (id, completion, session) => {
    this.assertTransferSafetySessionPin(id, session)
    await this.assertSftpSafetyOperationEndpoint(id)
    const result = await this.sftpSafetyRunner.completeExternalExecution(
      id,
      completion
    )
    if (transferSafetyTerminalStates.has(result?.state)) {
      this.unpinTransferSafetySession(id, session)
    }
    return result
  }

  cancelTransferSafetyOperation = async (id, session, options = {}) => {
    this.assertTransferSafetySessionPin(id, session)
    await this.assertSftpSafetyOperationEndpoint(id)
    const result = await this.sftpSafetyRunner.cancel(id, options)
    if (transferSafetyTerminalStates.has(result?.state)) {
      this.unpinTransferSafetySession(id, session)
    }
    return result
  }

  runSftpSafetyOperation = async (spec, options = {}) => {
    const operationId = `sftp-${spec.action}-${Date.now()}-${generate()}`
    return this.withRemoteFileOperation({
      id: operationId,
      signal: spec.signal,
      settlementOwnsCapability: true
    }, async (backend, capability) => {
      options.onRuntimeIdentity?.(capability.runtimeIdentity || {
        channel: capability.channel || 'sftp',
        effectiveUsername: this.props.tab.username || this.props.tab.user || ''
      })
      this.remoteFileOperationBackends.set(operationId, backend)
      this.remoteFileOperationBackendPins?.set(operationId, backend)
      try {
        const operation = await this.prepareSftpSafetyOperation({
          ...spec,
          id: operationId
        }, {
          backend,
          runtimeIdentity: capability.runtimeIdentity
        })
        return await this.confirmAndExecutePreparedOperation(operation, spec, {
          ...options,
          backend,
          capability
        })
      } finally {
        this.remoteFileOperationBackends.delete(operationId)
        this.remoteFileOperationBackendPins?.delete(operationId)
      }
    })
  }

  confirmAndExecutePreparedOperation = async (
    operation,
    spec,
    options = {}
  ) => {
    let confirmationDetails = options.confirmationDetails
    if (!confirmationDetails && options.buildConfirmationDetails) {
      try {
        confirmationDetails = await options.buildConfirmationDetails(
          operation,
          options.backend,
          options.capability
        )
      } catch (error) {
        if (error?.name === 'AbortError') {
          await this.sftpSafetyRunner.cancel(operation.id)
          throw error
        }
        confirmationDetails = {
          path: Object.values(spec.paths || {})[0] || ''
        }
      }
    }
    const confirmed = await this.confirmPreparedSftpOperation(
      options.confirmTitle || `确认${spec.title || '执行 SFTP 修改'}？`,
      confirmationDetails
    )
    if (!confirmed) {
      await this.sftpSafetyRunner.cancel(operation.id)
      return false
    }
    return this.sftpSafetyRunner.execute(operation.id, {
      confirmed: true,
      sideEffectInput: options.input,
      signal: options.signal
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

  saveRemoteEditorFile = async ({ path, text, mode }, options = {}) => {
    if (this.props.isFtp) {
      await this.sftp.writeFile(path, text, mode)
      return true
    }
    const expected = await digestSftpText(text)
    const requestedMode = mode === undefined ? undefined : Number(mode) & 0o7777
    let result
    let operationIdentity
    try {
      result = await this.runSftpSafetyOperation({
        action: 'editor-save',
        paths: { target: path },
        type: 'file',
        requestedMode,
        expected,
        title: e('shellpilotSftpEditorSave'),
        signal: options.signal
      }, {
        input: { text },
        signal: options.signal,
        onRuntimeIdentity: identity => { operationIdentity = identity },
        buildConfirmationDetails: async (operation, backend) => {
          const resource = operation.plan?.resources?.[0]
          if (!resource) return { path }
          const snapshot = await readSftpSnapshotText(backend, resource, {
            signal: options.signal
          })
          if (!snapshot.available) return { path }
          return {
            path,
            preview: buildSftpTextChangePreview({
              path,
              beforeText: snapshot.text,
              afterText: text,
              existed: snapshot.existed
            })
          }
        }
      })
    } catch (error) {
      const identity = operationIdentity || {}
      throw formatSftpEditorSaveError(error, {
        path,
        loginUsername: this.props.tab.username,
        effectiveUsername: identity.effectiveUsername || this.props.tab.username,
        channel: identity.channel === 'pty-root' ? 'pty-root' : 'sftp'
      })
    }
    if (result) message.success(e('shellpilotSftpEditorSaveVerified'))
    return result
  }

  saveRemoteEditorFiles = async (files, options = {}) => {
    if (this.props.isFtp) {
      throw new Error('AI 多文件统一审查仅支持可创建恢复点的 SSH/SFTP 会话。')
    }
    if (!Array.isArray(files) || files.length < 2 || files.length > 50) {
      throw new Error('AI 多文件修改数量必须在 2 到 50 之间。')
    }
    const changeSetId = `ai-file-change-${Date.now()}-${generate()}`
    const operationIds = files.map(() => (
      `sftp-editor-save-${Date.now()}-${generate()}`
    ))
    return this.withRemoteFileOperation({
      id: changeSetId,
      signal: options.signal,
      settlementOwnsCapability: true
    }, async (backend, capability) => {
      const prepared = []
      const boundOperationIds = new Set()
      const terminalOperationIds = new Set()
      const projectCancellationError = (error, operationId, phase) => (
        Object.freeze({
          name: String(error?.name || 'Error'),
          code: String(error?.code || ''),
          message: error?.message || String(error),
          ...(operationId ? { operationId } : {}),
          ...(phase ? { phase } : {})
        })
      )
      const preserveCancellationFailure = (primaryError, cancelError) => {
        if (Object.isExtensible(primaryError)) {
          primaryError.cancelFailureHandled = true
          primaryError.cancellationFailure = cancelError
          primaryError.operationIds = cancelError.operationIds || []
          primaryError.cancelErrors = Object.freeze(
            (cancelError.cancelErrors || [cancelError])
              .filter(error => error !== primaryError)
              .map(error => projectCancellationError(
                error,
                error?.operationId,
                error?.phase || 'cancel'
              ))
          )
        }
        return primaryError
      }
      const cancelPrepared = async items => {
        const cancellable = items.filter(item => (
          !terminalOperationIds.has(item.operation.id)
        ))
        const settled = await Promise.allSettled(cancellable.map(item => (
          this.sftpSafetyRunner.cancel(item.operation.id)
        )))
        const failed = []
        settled.forEach((result, index) => {
          const item = cancellable[index]
          if (result.status === 'fulfilled') {
            terminalOperationIds.add(item.operation.id)
            this.sftpSafetyAdapter.discardPreparedProof(item.operation.id)
          } else {
            failed.push({ item, firstError: result.reason })
          }
        })
        const unresolved = []
        for (const failure of failed) {
          try {
            await this.sftpSafetyRunner.cancel(failure.item.operation.id)
            terminalOperationIds.add(failure.item.operation.id)
            this.sftpSafetyAdapter.discardPreparedProof(
              failure.item.operation.id
            )
          } catch (retryError) {
            unresolved.push({ ...failure, retryError })
          }
        }
        if (unresolved.length) {
          const firstError = unresolved[0].firstError
          if (Object.isExtensible(firstError)) {
            firstError.cancelFailureHandled = true
            firstError.operationIds = unresolved.map(value => (
              value.item.operation.id
            ))
            firstError.cancelErrors = Object.freeze(unresolved.flatMap(value => (
              [
                ...(value.firstError === firstError
                  ? []
                  : [projectCancellationError(
                      value.firstError,
                      value.item.operation.id,
                      'cancel'
                    )]),
                projectCancellationError(
                  value.retryError,
                  value.item.operation.id,
                  'cancel-retry'
                )
              ]
            )))
          }
          throw firstError
        }
      }
      try {
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index]
          const expected = await digestSftpText(file.text)
          const requestedMode = file.mode === undefined
            ? undefined
            : Number(file.mode) & 0o7777
          const operationId = operationIds[index]
          boundOperationIds.add(operationId)
          this.remoteFileOperationBackends.set(operationId, backend)
          this.remoteFileOperationBackendPins?.set(operationId, backend)
          const operation = await this.prepareSftpSafetyOperation({
            id: operationId,
            action: 'editor-save',
            paths: { target: file.path },
            type: 'file',
            requestedMode,
            expected,
            title: e('shellpilotSftpEditorSave'),
            signal: options.signal,
            metadata: {
              aiFileChangeSetId: changeSetId,
              aiFileChangeCount: files.length
            }
          }, {
            backend,
            runtimeIdentity: capability.runtimeIdentity
          })
          const item = { file, operation }
          prepared.push(item)
          const resource = operation.plan?.resources?.[0]
          const snapshot = resource
            ? await readSftpSnapshotText(backend, resource, {
              signal: options.signal
            })
            : { available: false, existed: false, text: '' }
          const preview = snapshot.available
            ? buildSftpTextChangePreview({
              path: file.path,
              beforeText: snapshot.text,
              afterText: file.text,
              existed: snapshot.existed
            })
            : null
          Object.assign(item, {
            originalFingerprint: {
              existed: resource?.original?.absent !== true,
              size: resource?.original?.size || 0,
              digest: resource?.original?.digest || '',
              digestAlgorithm: resource?.original?.digestAlgorithm || ''
            },
            proposedFingerprint: {
              existed: true,
              ...expected
            },
            diffPreview: formatAiFileChangeDiffPreview(preview)
          })
        }

        const review = await requestAiFileChangeReview(createAiFileChangeSet({
          id: changeSetId,
          files: prepared.map(item => ({
            path: item.file.path,
            originalFingerprint: item.originalFingerprint,
            proposedFingerprint: item.proposedFingerprint,
            diffPreview: item.diffPreview
          }))
        }), { signal: options.signal })
        const selectedPaths = new Set(
          review.changeSet.files
            .filter(file => file.selected)
            .map(file => file.path)
        )
        const selected = prepared.filter(item => selectedPaths.has(item.file.path))
        const excluded = prepared.filter(item => !selectedPaths.has(item.file.path))
        await cancelPrepared(excluded)
        if (!review.accepted || !selected.length) {
          await cancelPrepared(selected)
          return {
            success: false,
            cancelled: true,
            status: 'cancelled',
            files: []
          }
        }

        try {
          for (const item of selected) {
            await this.assertSftpSafetyOperationEndpoint(item.operation.id)
            await this.sftpSafetyAdapter.validatePrepared(item.operation, {
              signal: options.signal
            })
          }
        } catch (cause) {
          const error = new Error('文件在审查后发生变化，已停止全部 AI 文件修改。')
          error.code = 'AI_FILE_CHANGED_SINCE_REVIEW'
          error.cause = cause
          try {
            await cancelPrepared(selected)
          } catch (cancelError) {
            throw preserveCancellationFailure(error, cancelError)
          }
          throw error
        }

        const results = []
        for (let index = 0; index < selected.length; index += 1) {
          const item = selected[index]
          try {
            await this.sftpSafetyRunner.execute(item.operation.id, {
              confirmed: true,
              sideEffectInput: { text: item.file.text },
              signal: options.signal
            })
            terminalOperationIds.add(item.operation.id)
            results.push({
              path: item.file.path,
              status: 'completed',
              recoveryOperationId: item.operation.id
            })
          } catch (error) {
            terminalOperationIds.add(item.operation.id)
            results.push({
              path: item.file.path,
              status: 'failed',
              message: error?.message || String(error)
            })
            try {
              await cancelPrepared(selected.slice(index + 1))
            } catch (cancelError) {
              throw preserveCancellationFailure(error, cancelError)
            }
            return {
              success: false,
              cancelled: false,
              status: results.some(result => result.status === 'completed')
                ? 'partially-completed'
                : 'failed',
              files: results
            }
          }
        }
        message.success(`已安全修改 ${results.length} 个远程文件。`)
        return {
          success: true,
          cancelled: false,
          status: 'completed',
          files: results
        }
      } catch (error) {
        if (!error?.cancelFailureHandled) {
          try {
            await cancelPrepared(prepared)
          } catch (cancelError) {
            throw preserveCancellationFailure(error, cancelError)
          }
        }
        throw error
      } finally {
        boundOperationIds.forEach(id => {
          this.remoteFileOperationBackends.delete(id)
          this.remoteFileOperationBackendPins?.delete(id)
        })
      }
    })
  }

  deleteRemoteFilesWithSafety = async (files, options = {}) => {
    if (this.props.isFtp) {
      const confirmed = await this.confirmDelete(files, { signal: options.signal })
      if (!confirmed || options.signal?.aborted) return false
      for (const file of files) {
        if (options.signal?.aborted) return false
        await this.remoteDel(file, this.sftp)
      }
      return {
        deletedPaths: files.map(file => resolve(file.path, file.name)),
        operationCount: files.length,
        recoverable: false
      }
    }
    if (options.signal?.aborted) return false
    const targets = this.getRemoteSafetyTargets(files)
    while (targets.length) {
      const dialog = openSafeDeleteDialog({
        files: targets,
        externalSignal: options.signal,
        translate: e
      })
      await waitForSafeDeleteDialogPaint()
      if (dialog.signal.aborted) return false
      const operationIds = targets.map(() => (
        `sftp-delete-${Date.now()}-${generate()}`
      ))
      const batchOperationId = `safe-delete-batch-${Date.now()}-${generate()}`
      try {
        const attempt = await this.withRemoteFileOperation({
          id: batchOperationId,
          signal: dialog.signal,
          settlementOwnsCapability: true
        }, async (backend, capability) => {
          const terminalOperationIds = new Set()
          const projectCancellationError = (error, operationId, phase) => (
            Object.freeze({
              name: String(error?.name || 'Error'),
              code: String(error?.code || ''),
              message: error?.message || String(error),
              ...(operationId ? { operationId } : {}),
              ...(phase ? { phase } : {})
            })
          )
          const preserveCancellationFailure = (primaryError, cancelError) => {
            if (Object.isExtensible(primaryError)) {
              primaryError.cancelFailureHandled = true
              primaryError.cancellationFailure = cancelError
              primaryError.operationIds = cancelError.operationIds || []
              primaryError.cancelErrors = Object.freeze(
                (cancelError.cancelErrors || [cancelError])
                  .filter(error => error !== primaryError)
                  .map(error => projectCancellationError(
                    error,
                    error?.operationId,
                    error?.phase || 'cancel'
                  ))
              )
            }
            return primaryError
          }
          const discardOperation = operation => {
            terminalOperationIds.add(operation.id)
            this.sftpSafetyProgressHandlers.delete(operation.id)
            this.sftpSafetyAdapter.discardPreparedProof(operation.id)
          }
          const cancelOperations = async operations => {
            const unsettled = operations.filter(operation => (
              !terminalOperationIds.has(operation.id)
            ))
            const settled = await Promise.allSettled(unsettled.map(operation => (
              this.sftpSafetyRunner.cancel(operation.id)
            )))
            const failed = []
            settled.forEach((result, index) => {
              const operation = unsettled[index]
              if (result.status === 'fulfilled') {
                discardOperation(operation)
              } else {
                failed.push({ operation, firstError: result.reason })
              }
            })
            const unresolved = []
            for (const failure of failed) {
              try {
                await this.sftpSafetyRunner.cancel(failure.operation.id)
                discardOperation(failure.operation)
              } catch (retryError) {
                unresolved.push({ ...failure, retryError })
              }
            }
            if (unresolved.length) {
              const firstError = unresolved[0].firstError
              if (Object.isExtensible(firstError)) {
                firstError.cancelFailureHandled = true
                firstError.operationIds = unresolved.map(value => (
                  value.operation.id
                ))
                firstError.cancelErrors = Object.freeze(
                  unresolved.flatMap(value => (
                    [
                      ...(value.firstError === firstError
                        ? []
                        : [projectCancellationError(
                            value.firstError,
                            value.operation.id,
                            'cancel'
                          )]),
                      projectCancellationError(
                        value.retryError,
                        value.operation.id,
                        'cancel-retry'
                      )
                    ]
                  ))
                )
              }
              throw firstError
            }
          }
          try {
            const prepared = await Promise.allSettled(targets.map(
              async (file, index) => {
                const source = resolve(file.path, file.name)
                return this.prepareSftpSafetyOperation({
                  id: operationIds[index],
                  action: 'delete',
                  paths: { source },
                  type: file.isDirectory ? 'directory' : 'file',
                  expected: { absent: true },
                  title: e('shellpilotSftpDelete'),
                  signal: dialog.signal,
                  onProgress: progress => dialog.progress({
                    ...progress,
                    targetIndex: index + 1,
                    targetCount: targets.length
                  })
                }, {
                  backend,
                  runtimeIdentity: capability.runtimeIdentity
                })
              }
            ))
            const operations = prepared
              .filter(item => item.status === 'fulfilled')
              .map(item => item.value)
            const failed = prepared.find(item => item.status === 'rejected')

            if (dialog.signal.aborted) {
              await cancelOperations(operations)
              return false
            }

            if (failed) {
              try {
                await cancelOperations(operations)
              } catch (cancelError) {
                throw preserveCancellationFailure(failed.reason, cancelError)
              }
              dialog.fail(failed.reason)
              return await dialog.decision === 'retry' ? 'retry' : false
            }

            try {
              operations.forEach(operation => {
                this.sftpSafetyAdapter.bindPreparedProof(operation)
              })
            } catch (error) {
              try {
                await cancelOperations(operations)
              } catch (cancelError) {
                throw preserveCancellationFailure(error, cancelError)
              }
              dialog.fail(error)
              return await dialog.decision === 'retry' ? 'retry' : false
            }

            dialog.ready(operations.length)
            if (await dialog.decision !== 'confirm') {
              await cancelOperations(operations)
              return false
            }

            for (let index = 0; index < operations.length; index += 1) {
              const operation = operations[index]
              try {
                dialog.progress({
                  phase: 'deleting',
                  completedBytes: 0,
                  totalBytes: null,
                  targetIndex: index + 1,
                  targetCount: operations.length
                })
                await this.sftpSafetyRunner.execute(operation.id, {
                  confirmed: true,
                  signal: dialog.signal
                })
                discardOperation(operation)
              } catch (error) {
                try {
                  await cancelOperations(operations.slice(index))
                } catch (cancelError) {
                  throw preserveCancellationFailure(error, cancelError)
                }
                if (!options.signal?.aborted && error?.name !== 'AbortError') {
                  dialog.fail(error, { retryable: false })
                  throw error
                }
                return false
              }
            }
            const deletedPaths = targets.map(file => (
              resolve(file.path, file.name)
            ))
            dialog.complete()
            return {
              deletedPaths,
              operationCount: operations.length,
              recoverable: true
            }
          } finally {
            operationIds.forEach(id => {
              this.remoteFileOperationBackends.delete(id)
              this.remoteFileOperationBackendPins?.delete(id)
            })
          }
        })
        if (attempt === 'retry') continue
        return attempt
      } catch (error) {
        if (options.signal?.aborted || error?.name === 'AbortError') return false
        throw error
      }
    }
    return false
  }

  getRemoteSafetyTargets = (files = this.getSelectedFiles()) => {
    return files.filter(file => {
      return file?.type === typeMap.remote && !file.isParent && !file.isEmpty
    })
  }

  confirmQuickDelete = (files) => {
    const preview = buildDeleteTargetPreview(files, {
      separator: e('shellpilotListSeparator')
    })
    return new Promise(resolve => {
      let settled = false
      const settle = value => {
        if (settled) return
        settled = true
        resolve(value)
      }
      Modal.confirm({
        title: formatShellPilotTranslation(
          e,
          'shellpilotSftpFastDeleteConfirmTitle'
        ),
        content: (
          <div className='sftp-fast-delete-confirmation'>
            <div className='sftp-delete-risk-badge'>
              {e('shellpilotSftpFastDeleteRisk')}
            </div>
            <div>
              {formatShellPilotTranslation(
                e,
                'shellpilotSftpFastDeleteConfirmBody',
                { count: preview.count }
              )}
            </div>
            <code className='sftp-delete-targets'>{preview.names}</code>
            {preview.remaining > 0 && (
              <div>
                {formatShellPilotTranslation(
                  e,
                  'shellpilotSftpDeleteMoreTargets',
                  { count: preview.remaining }
                )}
              </div>
            )}
          </div>
        ),
        okText: e('shellpilotSftpFastDeleteConfirmAction'),
        cancelText: e('cancel'),
        okButtonProps: { danger: true },
        keyboardConfirm: false,
        initialFocusSelector: '.custom-modal-cancel-btn',
        onOk: () => settle(true),
        onCancel: () => settle(false)
      })
    })
  }

  quickDeleteRemoteFiles = async (files = this.getSelectedFiles()) => {
    const targets = Array.isArray(files) ? files : []
    if (!targets.length) return false

    try {
      buildFastDeleteTargets(targets)
    } catch (error) {
      window.store.onError(error)
      return false
    }

    const confirmed = await this.confirmQuickDelete(targets)
    if (!confirmed) return false

    this.onDelete = true
    let result
    try {
      const executeDelete = backend => executeFastRemoteDelete({
        sftp: backend,
        files: targets,
        concurrency: 4
      })
      result = this.props.isFtp || this.type === 'ftp'
        ? await executeDelete(this.sftp)
        : await this.withRemoteFileOperation({
          id: `quick-delete-${Date.now()}-${generate()}`,
          settlementOwnsCapability: true
        }, executeDelete)
    } catch (error) {
      window.store.onError(error)
    } finally {
      this.onDelete = false
    }

    this.setState({ selectedFiles: new Set(), selectedType: '' })
    await this.remoteList()
    if (!result) return false
    if (result.failed.length === 0) {
      message.success(formatShellPilotTranslation(
        e,
        'shellpilotSftpFastDeleteSucceeded',
        { count: result.completed.length }
      ))
      return true
    }
    const failedItems = result.failed
      .slice(0, 3)
      .map(item => item.file?.name || item.path)
      .join(e('shellpilotListSeparator')) +
      (result.failed.length > 3 ? '…' : '')
    if (result.completed.length === 0) {
      message.error(formatShellPilotTranslation(
        e,
        'shellpilotSftpFastDeleteFailed',
        {
          failed: result.failed.length,
          items: failedItems
        }
      ))
      return false
    }
    message.error(formatShellPilotTranslation(
      e,
      'shellpilotSftpFastDeletePartial',
      {
        completed: result.completed.length,
        failed: result.failed.length,
        items: failedItems
      }
    ))
    return false
  }

  quickBackupRemoteFiles = async (files = this.getSelectedFiles(), options = {}) => {
    const targets = this.getRemoteSafetyTargets(files)
    if (!targets.length) {
      if (!options.silent) message.warning('请先在远程 SFTP 面板选择文件或文件夹。')
      return false
    }
    try {
      const backup = async (backend, capability, mutation) => {
        const persistedById = new Map()
        const persistCompletedBackup = async rawRecord => {
          let record = rawRecord
          try {
            if (capability?.runtimeIdentity?.channel === 'pty-root') {
              const endpoint = this.getSftpSafetyEndpoint()
              const runtimeIdentity = Object.freeze({
                loginUsername: capability.runtimeIdentity.loginUsername ||
                  this.props.tab?.username || this.props.tab?.user || '',
                channel: capability.runtimeIdentity.channel,
                effectiveUid: capability.runtimeIdentity.effectiveUid,
                effectiveUsername:
                  capability.runtimeIdentity.effectiveUsername
              })
              const source = await backend.describeRecoveryEntry(
                record.sourcePath,
                { signal: options.signal }
              )
              const backup = await backend.describeRecoveryEntry(
                record.backupPath,
                { signal: options.signal }
              )
              record = {
                ...record,
                metadata: {
                  ...record.metadata,
                  runtimeIdentity,
                  recoveryBinding: createRootSftpRecoveryBinding({
                    record,
                    endpoint,
                    runtimeIdentity,
                    source,
                    backup
                  })
                }
              }
            }
            this.addSftpRecoveryRecords([record])
          } catch (error) {
            throw createRemoteFileRecoveryPersistenceError(error, {
              record,
              records: [record]
            })
          }
          persistedById.set(record.id, record)
          return record
        }
        const rawRecords = await backupRemoteFiles({
          sftp: backend,
          files: targets,
          tab: this.props.tab,
          onRecord: persistCompletedBackup
        })
        const records = []
        for (const record of rawRecords) {
          records.push(persistedById.get(record.id) ||
            await persistCompletedBackup(record))
        }
        mutation?.commit()
        return records
      }
      const records = this.props.isFtp || this.type === 'ftp'
        ? await backup(this.sftp)
        : await this.withRemoteFileOperation({
          id: `quick-backup-${Date.now()}-${generate()}`,
          signal: options.signal,
          settlementOwnsCapability: true
        }, backup)
      if (!options.silent) {
        message.success(formatShellPilotTranslation(e, 'shellpilotSftpBackedUpWithRecovery', {
          count: records.length
        }))
      }
      return true
    } catch (err) {
      window.store.onError(err)
      if (!options.silent) {
        message.error(err?.code === 'REMOTE_FILE_RECOVERY_UNCERTAIN'
          ? '远端备份可能已完成，但恢复记录未能持久化；请先核对再继续。'
          : 'SFTP 备份失败，原文件未改动。')
      }
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
    if (!record || !['available', 'failed', 'uncertain'].includes(record.status)) return false
    const { requiresRoot } = assertSftpRecoveryIdentityProvenance(record)
    if (!requiresRoot &&
      !matchesSafetyOperationEndpoint(record, this.props.tab || {}, true)) {
      message.warning(`请先连接服务器 ${record.host} 后再恢复。`)
      return false
    }
    let restored
    try {
      const restore = async (backend, capability, mutation) => {
        const capabilityIdentity = capability?.runtimeIdentity || {}
        const currentIdentity = capabilityIdentity.channel === 'pty-root'
          ? Object.freeze({
            loginUsername: capabilityIdentity.loginUsername ||
              this.props.tab?.username || this.props.tab?.user || '',
            channel: capabilityIdentity.channel,
            effectiveUid: capabilityIdentity.effectiveUid,
            effectiveUsername: capabilityIdentity.effectiveUsername
          })
          : capabilityIdentity
        let recoveryProof
        const persistRecord = async value => {
          const records = updateSafetyOperationRecord(
            readSafetyOperationRecords(ls),
            record.id,
            value
          )
          try {
            const persisted = this.persistSftpRecoveryRecords(records) || records
            return persisted.find(item => item.id === record.id) || value
          } catch (error) {
            throw createRemoteFileRecoveryPersistenceError(error, {
              record: value,
              records
            })
          }
        }
        this.remoteFileOperationBackends?.set(record.id, backend)
        this.remoteFileOperationBackendPins?.set(record.id, backend)
        try {
          if (requiresRoot && (
            currentIdentity.channel !== 'pty-root' ||
          String(currentIdentity.effectiveUid) !== '0'
          )) {
            throw createRemoteFileRootRequiredError()
          }
          if (requiresRoot) {
            try {
              assertSameSftpSafetyEndpoint(
                record.metadata.recoveryBinding.endpoint,
                this.getSftpSafetyEndpoint()
              )
            } catch (cause) {
              throw createSftpRecoveryBindingMismatchError(cause)
            }
            const sourceState = await backend.describeRecoveryEntry(
              record.sourcePath,
              { allowAbsent: true }
            )
            let displacedSource
            if (record.displacement?.path &&
            ['planned', 'displaced', 'duplicated', 'uncertain', 'preserved']
              .includes(record.displacement.status)) {
              displacedSource = await backend.describeRecoveryEntry(
                record.displacement.path,
                { allowAbsent: true }
              )
            }
            const backup = await backend.describeRecoveryEntry(
              record.backupPath
            )
            const duplicatedSource = record.displacement?.status === 'duplicated'
              ? record.displacement.sourceDescriptor
              : undefined
            const expectedDisplaced = record.displacement?.status === 'planned'
              ? record.displacement.targetState
              : record.displacement?.descriptor
            let boundAction
            try {
              boundAction = assertRootSftpRecoveryBinding(record, {
                endpoint: this.getSftpSafetyEndpoint(),
                runtimeIdentity: currentIdentity,
                source: sourceState,
                backup,
                sourcePath: record.sourcePath,
                expectedSource: duplicatedSource
              })
              if (record.displacement?.path &&
              record.displacement.status !== 'planned' &&
              JSON.stringify(expectedDisplaced) !==
                JSON.stringify(displacedSource)) {
                throw createSftpRecoveryBindingMismatchError()
              }
              if (record.displacement?.status === 'duplicated' &&
              (!duplicatedSource || sourceState.type === 'bound-absent')) {
                throw createSftpRecoveryBindingMismatchError()
              }
            } catch (cause) {
              const binding = record.metadata.recoveryBinding
              const expectedSource = duplicatedSource || binding.source
              const sourceChanged = sourceState.type === 'bound-absent'
                ? record.displacement?.status === 'duplicated'
                : JSON.stringify(expectedSource) !== JSON.stringify(sourceState)
              const displacedChanged = Boolean(record.displacement?.path) &&
                record.displacement.status !== 'planned' &&
                JSON.stringify(expectedDisplaced) !==
                  JSON.stringify(displacedSource)
              const backupChanged = JSON.stringify(binding.backup) !==
              JSON.stringify(backup)
              if (!sourceChanged && !displacedChanged && !backupChanged) throw cause
              const proofMismatch = {
                path: sourceChanged
                  ? record.sourcePath
                  : displacedChanged
                    ? record.displacement.path
                    : record.backupPath,
                expectedDescriptor: sourceChanged
                  ? expectedSource
                  : displacedChanged
                    ? expectedDisplaced
                    : binding.backup,
                actualDescriptor: sourceChanged
                  ? sourceState
                  : displacedChanged
                    ? displacedSource
                    : backup
              }
              const uncertainRecord = await persistRecord({
                ...record,
                status: 'uncertain',
                rollbackStatus: 'uncertain',
                proofMismatch,
                error: cause?.message || String(cause),
                failedAt: new Date().toISOString()
              })
              throw createSftpRecoveryUncertainError({
                message: e('shellpilotSftpRecoveryProofChanged'),
                primaryCause: cause,
                displacedPath: record.displacement?.path,
                displacedDescriptor: displacedSource,
                record: uncertainRecord
              })
            }
            recoveryProof = Object.freeze({
              action: boundAction,
              source: sourceState,
              backup,
              ...(displacedSource ? { displaced: displacedSource } : {})
            })
          }
          const result = await restoreSftpRecoveryRecord({
            sftp: backend,
            record,
            describeEntry: typeof backend.describeRecoveryEntry === 'function'
              ? (path, describeOptions) => backend.describeRecoveryEntry(
                  path,
                  describeOptions
                )
              : undefined,
            persistRecord,
            recoveryProof
          })
          const persisted = await persistRecord(result)
          mutation?.commit()
          return persisted
        } finally {
          this.remoteFileOperationBackends?.delete(record.id)
          this.remoteFileOperationBackendPins?.delete(record.id)
        }
      }
      restored = this.props.isFtp || this.type === 'ftp'
        ? await restore(this.sftp)
        : await this.withRemoteFileOperation({
          id: `restore:${record.id}:${generate()}`,
          settlementOwnsCapability: true
        }, restore)
    } catch (err) {
      if (err?.code === 'REMOTE_FILE_ROOT_REQUIRED' ||
        err?.code === 'REMOTE_FILE_RECOVERY_UNBOUND') {
        message.warning(err.message)
        throw err
      }
      if (!err?.recoveryRecord &&
        err?.code !== 'REMOTE_FILE_RECOVERY_BINDING_MISMATCH' &&
        err?.code !== 'REMOTE_FILE_RECOVERY_UNCERTAIN') {
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
      }
      window.store.onError(err)
      message.error(err?.code === 'REMOTE_FILE_RECOVERY_UNCERTAIN'
        ? '恢复结果不确定；恢复前内容可能位于记录的 displaced 路径，请在安全中心核对。'
        : '恢复失败；远端内容未宣告安全，请在重试前核对恢复记录。')
      return false
    }
    try {
      await this.remoteList()
    } catch (error) {
      if (!this.remoteFileUnmounted && error?.name !== 'AbortError') {
        window.store.onError(error)
      }
    }
    message.success('恢复完成；恢复前的当前内容也已另行保留。')
    return Boolean(restored)
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

  applyOptimisticRemoteDelete = (deletedPaths) => {
    return new Promise(resolve => {
      this.setState(prevState => {
        const remote = removeDeletedRemoteEntries(
          prevState.remote,
          deletedPaths
        )
        return {
          remote,
          remoteFileTree: this.buildTree(remote, typeMap.remote),
          selectedFiles: new Set(),
          selectedType: '',
          lastClickedFile: null
        }
      }, resolve)
    })
  }

  calibrateRemoteAfterSafeDelete = async () => {
    try {
      await this.remoteList(false, undefined, undefined, {
        rethrow: true,
        suppressLoading: true,
        suppressVisibleError: true
      })
    } catch (error) {
      message.warning(e('shellpilotSftpStateCalibrationFailed'))
    }
  }

  delFiles = async (_type, files = this.getSelectedFiles(), options = {}) => {
    const type = files[0]?.type || _type
    if (type === typeMap.remote) {
      this.onDelete = true
      let result
      try {
        result = await this.deleteRemoteFilesWithSafety(files, options)
        if (!result) return false
      } catch (err) {
        window.store.onError(err)
        message.error(e('shellpilotSftpDeleteFailedRecoveryRetained'))
        return false
      } finally {
        this.onDelete = false
      }
      await this.applyOptimisticRemoteDelete(result.deletedPaths)
      if (result.recoverable) {
        message.success(formatShellPilotTranslation(
          e,
          'shellpilotSftpDeletedWithRecovery',
          { count: result.operationCount }
        ))
      }
      this.calibrateRemoteAfterSafeDelete()
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
    replaceSftpEntryTimer(this, 'timer4', () => {
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

  initData = (terminalId, port, sshSessionGeneration, sshTerminalPid) => {
    const previousGeneration = String(this.sshSessionGeneration || '')
    const nextGeneration = String(sshSessionGeneration || '')
    if (previousGeneration !== nextGeneration) {
      this.remoteDirectoryCache?.clear?.()
    }
    return bindSftpEntryRemoteSession(this, {
      terminalId,
      port,
      sshSessionGeneration,
      sshTerminalPid
    }).catch(window.store.onError)
  }

  shouldRenderRemote = () => {
    const { props } = this
    return props.tab?.host && props.tab?.type !== terminalSerialType
  }

  shouldInitializeRemoteOnBind = () => (
    this.props.isFtp || this.props.enableSftp === true
  )

  isSftpVisible = () => {
    const { isFtp, pane, sshSftpSplitView } = this.props
    return isFtp || pane === paneMap.fileManager || sshSftpSplitView
  }

  normalizeSftpError = error => {
    const message = typeof error?.message === 'string'
      ? error.message.trim()
      : ''
    return message && message !== 'Error'
      ? error
      : new Error(e('shellpilotSftpUnavailable'))
  }

  runSftpBackgroundTask = task => runTrackedSftpBackgroundTask(
    this,
    task,
    { reportError: error => window.store.onError(error) }
  )

  disposeSftpReadiness = () => disposeSftpEntryReadiness(this)

  getSftpReadinessSnapshot = () => getSftpEntryReadinessSnapshot(this)

  initLocalAll = () => {
    this.localListOwner()
    this.localList()
  }

  initRemoteAll = async (options = {}) => {
    const task = beginSftpEntryRemoteTask(this)
    await this.remoteList(false, undefined, undefined, {
      lifecycleTask: task,
      explicitOpen: options.explicitOpen === true
    })
    if (isCurrentSftpEntryRemoteTask(this, task)) {
      await trackSftpEntryBackgroundTask(
        this,
        () => this.remoteListOwner(task)
      )
    }
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

  remoteListOwner = async (task) => {
    const [remoteUidTree, remoteGidTree] = await Promise.all([
      owner.remoteListUsers(this.props.pid),
      owner.remoteListGroups(this.props.pid)
    ])
    if (task && !isCurrentSftpEntryRemoteTask(this, task)) return
    const commit = beginSftpEntryRenderCommit(this)
    let prepared = false
    this.setState(() => {
      if (this.remoteFileUnmounted ||
        (task && !isCurrentSftpEntryRemoteTask(this, task))) return null
      prepared = true
      return {
        remoteGidTree,
        remoteUidTree
      }
    }, () => commit.settle({
      committed: prepared &&
        !this.remoteFileUnmounted &&
        (!task || isCurrentSftpEntryRemoteTask(this, task))
    }))
    await commit.promise
  }

  localListOwner = async () => {
    const localUidTree = await owner.localListUsers()
    const localGidTree = await owner.localListGroups()
    this.setState({
      localGidTree,
      localUidTree
    })
  }

  captureRemoteFileIdentityToken = () => Object.freeze({
    identityEpoch: this.remoteFileIdentityEpoch || 0,
    remoteFileGeneration: this.remoteFileGeneration,
    lifecycleEpoch: this.sftpLifecycleEpoch || 0,
    sshSessionGeneration: String(this.sshSessionGeneration || ''),
    sshTerminalPid: String(this.sshTerminalPid || '')
  })

  isCurrentRemoteFileIdentityToken = token => Boolean(token) &&
    token.identityEpoch === (this.remoteFileIdentityEpoch || 0) &&
    token.remoteFileGeneration?.accepting === true &&
    isCurrentRemoteFileGeneration(this, token.remoteFileGeneration) &&
    token.lifecycleEpoch === (this.sftpLifecycleEpoch || 0) &&
    token.sshSessionGeneration === String(this.sshSessionGeneration || '') &&
    token.sshTerminalPid === String(this.sshTerminalPid || '')

  resetRemoteFileLeaseOutcome = ({ publish = true } = {}) => {
    this.activeRemoteFileLeases.clear()
    this.uncertainRemoteFileLeases.clear()
    if (!publish || this.remoteFileUnmounted) return false
    this.setState({ remoteFileStatus: 'idle' })
    return true
  }

  invalidateRemoteFileIdentity = ({ preserveLeaseOutcome = true } = {}) => {
    this.remoteFileIdentityEpoch = (this.remoteFileIdentityEpoch || 0) + 1
    if (!preserveLeaseOutcome) {
      this.resetRemoteFileLeaseOutcome({ publish: false })
    }
    if (this.remoteFileUnmounted) return false
    this.setState({
      remoteFileIdentity: {
        loginUsername: this.props.tab?.username || '',
        effectiveUid: '',
        effectiveUsername: '',
        channel: 'unknown'
      },
      remoteFileStatus: resolveRemoteFileStatus({
        rootLeaseCount: this.activeRemoteFileLeases.size,
        releaseUncertain: this.uncertainRemoteFileLeases.size > 0
      })
    })
    return true
  }

  publishRemoteFileIdentity = (remoteFileIdentity, identityToken) => {
    if (!this.isCurrentRemoteFileIdentityToken(identityToken)) return false
    this.setState({
      remoteFileIdentity,
      remoteFileStatus: resolveRemoteFileStatus({
        rootLeaseCount: this.activeRemoteFileLeases.size,
        releaseUncertain: this.uncertainRemoteFileLeases.size > 0
      })
    })
    return true
  }

  publishRemoteFileLeaseState = (event, identityToken) => {
    const operationId = String(event?.operationId || '').trim()
    if (!operationId || ![
      'acquired',
      'released',
      'release-failed'
    ].includes(event?.state)) return false
    const currentTerminalSession = Boolean(identityToken) &&
      identityToken.sshSessionGeneration ===
        String(this.sshSessionGeneration || '') &&
      identityToken.sshTerminalPid === String(this.sshTerminalPid || '')
    if (!currentTerminalSession || this.remoteFileUnmounted) return false
    const currentIdentity = this.isCurrentRemoteFileIdentityToken(identityToken)
    if (event.state === 'acquired' && !currentIdentity) return false
    if (event.state !== 'acquired' &&
      !this.activeRemoteFileLeases.has(operationId) &&
      !this.uncertainRemoteFileLeases.has(operationId)) return false
    if (event.state === 'acquired') {
      this.activeRemoteFileLeases.add(operationId)
      this.uncertainRemoteFileLeases.delete(operationId)
    } else if (event.state === 'released') {
      this.activeRemoteFileLeases.delete(operationId)
      this.uncertainRemoteFileLeases.delete(operationId)
    } else {
      this.uncertainRemoteFileLeases.add(operationId)
    }
    if (event.state === 'release-failed') {
      this.setState({
        remoteFileIdentity: {
          loginUsername: this.props.tab?.username || '',
          effectiveUid: '',
          effectiveUsername: '',
          channel: 'unknown'
        },
        remoteFileStatus: resolveRemoteFileStatus({
          rootLeaseCount: this.activeRemoteFileLeases.size,
          releaseUncertain: true
        })
      })
      return true
    }
    this.setState({
      remoteFileStatus: resolveRemoteFileStatus({
        rootLeaseCount: this.activeRemoteFileLeases.size,
        releaseUncertain: this.uncertainRemoteFileLeases.size > 0
      })
    })
    return true
  }

  publishRemoteFileIdentityUnavailable = identityToken => {
    if (!this.isCurrentRemoteFileIdentityToken(identityToken)) return false
    if (this.remoteFileUnmounted || this.activeRemoteFileLeases.size) return
    this.setState({
      remoteFileIdentity: {
        loginUsername: this.props.tab?.username || '',
        effectiveUid: '',
        effectiveUsername: '',
        channel: 'unknown'
      },
      remoteFileStatus: resolveRemoteFileStatus({ unavailable: true })
    })
    return true
  }

  acquireRemoteFileOperation = async ({
    id,
    signal,
    preparedProbe,
    lifecycleTask
  } = {}) => {
    const operationId = id ||
      `file-ui-${this.props.tab.id}-${++this.remoteFileOperationSequence}`
    const sftp = this.sftp
    const lifecycleEpoch = this.sftpLifecycleEpoch || 0
    const sshSessionGeneration = String(this.sshSessionGeneration || '')
    const sshTerminalPid = String(this.sshTerminalPid || '')
    const identityToken = this.captureRemoteFileIdentityToken()
    let remoteFileIdentity
    let capability
    try {
      const acquisition = {
        operationId,
        tab: this.props.tab,
        sftp,
        getTerminal: tabId => refs.get('term-' + tabId),
        signal,
        onIdentity: identity => { remoteFileIdentity = identity },
        onLeaseState: event => this.publishRemoteFileLeaseState?.(
          event,
          identityToken
        )
      }
      capability = preparedProbe
        ? await preparedProbe.consume(acquisition)
        : await acquireRemoteFileCapability(acquisition)
      identityToken.remoteFileGeneration?.capabilities?.delete(preparedProbe)
      if (this.preparedRemoteFileCapabilityProbe?.handle === preparedProbe) {
        this.preparedRemoteFileCapabilityProbe = null
      }
    } catch (error) {
      identityToken.remoteFileGeneration?.capabilities?.delete(preparedProbe)
      if (this.preparedRemoteFileCapabilityProbe?.handle === preparedProbe) {
        this.preparedRemoteFileCapabilityProbe = null
      }
      if (error?.code === 'REMOTE_FILE_IDENTITY_UNAVAILABLE') {
        this.publishRemoteFileIdentityUnavailable?.(identityToken)
      }
      throw error
    }
    const lifecycleCurrent =
      !this.remoteFileUnmounted &&
      this.sftp === sftp &&
      (this.sftpLifecycleEpoch || 0) === lifecycleEpoch &&
      String(this.sshSessionGeneration || '') === sshSessionGeneration &&
      String(this.sshTerminalPid || '') === sshTerminalPid &&
      this.isCurrentRemoteFileIdentityToken(identityToken) &&
      (!lifecycleTask ||
        isCurrentSftpEntryRemoteTask(this, lifecycleTask))
    if (!lifecycleCurrent) {
      const staleError = remoteFileOperationStale()
      try {
        await capability.release()
      } catch (releaseError) {
        staleError.releaseError = releaseError
        this.publishRemoteFileIdentityUnavailable?.(identityToken)
      }
      throw staleError
    }
    if (remoteFileIdentity) {
      if (typeof this.publishRemoteFileIdentity === 'function') {
        this.publishRemoteFileIdentity(remoteFileIdentity, identityToken)
      } else {
        this.setState({ remoteFileIdentity })
      }
    }
    return capability
  }

  reserveTransferFileSession = async ({ transferId, signal } = {}) => {
    const id = String(transferId || '')
    if (!id) throw new Error('预备 transfer file session 缺少 transfer id')
    const existing = this.preparedTransferFileSessions.get(id)
    if (existing) return existing.session
    const acquired = await this.acquireTransferFileCapability({
      transferId: id,
      signal
    })
    let releasePromise
    const session = Object.assign(Object.create(null), {
      capability: this,
      backend: acquired.backend,
      sftp: acquired.backend,
      runtimeIdentity: acquired.runtimeIdentity,
      release: () => {
        if (releasePromise) return releasePromise
        releasePromise = Promise.resolve()
          .then(() => acquired.release())
          .finally(() => {
            this.unpinTransferSafetySessionsForSession(session)
            const current = this.preparedTransferFileSessions.get(id)
            if (current?.session === session) {
              this.preparedTransferFileSessions.delete(id)
            }
          })
        return releasePromise
      }
    })
    Object.freeze(session)
    const raced = this.preparedTransferFileSessions.get(id)
    if (raced) {
      await session.release()
      return raced.session
    }
    this.preparedTransferFileSessions.set(id, Object.freeze({
      session,
      acquired
    }))
    return session
  }

  getPreparedTransferFileSession = transferId => {
    return this.preparedTransferFileSessions.get(String(transferId || ''))
      ?.session || null
  }

  claimPreparedTransferFileSession = transferId => {
    const id = String(transferId || '')
    const record = this.preparedTransferFileSessions.get(id)
    if (!record) return null
    this.preparedTransferFileSessions.delete(id)
    return record.session
  }

  releasePreparedTransferFileSession = transferId => {
    const session = this.getPreparedTransferFileSession(transferId)
    return session ? session.release() : Promise.resolve(true)
  }

  acquireTransferFileCapability = async ({ transferId, signal } = {}) => {
    const generation = this.remoteFileGeneration ||
      initializeRemoteFileGeneration(this)
    if (!generation.accepting || this.remoteFileUnmounted) {
      throw remoteFileOperationStale()
    }
    let settleOperation
    const operationSettled = new Promise(resolve => {
      settleOperation = resolve
    })
    generation.settlements.add(operationSettled)
    let capability
    let session
    try {
      abortRemoteFileOperation(signal)
      capability = await this.acquireRemoteFileOperation({
        id: `transfer:${String(transferId || ++this.remoteFileOperationSequence)}`,
        signal
      })
      abortRemoteFileOperation(signal)
      if (this.remoteFileUnmounted || !generation.accepting ||
        !isCurrentRemoteFileGeneration(this, generation)) {
        const staleError = this.remoteFileUnmounted
          ? remoteFileOperationUnmounted()
          : remoteFileOperationStale()
        try {
          await capability.release()
        } catch (releaseError) {
          staleError.releaseError = releaseError
        }
        capability = null
        throw staleError
      }
      const transfer = createRemoteFileTransferCapability(capability)
      let releasePromise
      session = Object.assign(Object.create(null), {
        channel: transfer.channel,
        runtimeIdentity: transfer.runtimeIdentity,
        sftp: transfer.backend,
        backend: transfer.backend,
        release: () => {
          if (releasePromise) return releasePromise
          releasePromise = (async () => {
            try {
              return await transfer.release()
            } finally {
              generation.capabilities.delete(session)
              generation.settlements.delete(operationSettled)
              settleOperation()
            }
          })()
          return releasePromise
        }
      })
      if (Object.hasOwn(transfer, 'capabilities')) {
        session.capabilities = transfer.capabilities
      }
      Object.freeze(session)
      generation.capabilities.add(session)
      return session
    } catch (error) {
      if (capability) {
        try {
          await capability.release()
        } catch (releaseError) {
          error.releaseError ||= releaseError
        }
      }
      generation.settlements.delete(operationSettled)
      settleOperation()
      throw error
    }
  }

  withRemoteFileOperation = async (options, work) => {
    const generation = this.remoteFileGeneration ||
      initializeRemoteFileGeneration(this)
    if (!generation.accepting) throw remoteFileOperationStale()
    let settleOperation
    const operationSettled = new Promise(resolve => {
      settleOperation = resolve
    })
    const operationSettlements = generation.settlements
    operationSettlements.add(operationSettled)
    const previous = generation.tail || Promise.resolve()
    let unlock
    generation.tail = new Promise(resolve => {
      unlock = resolve
    })
    if (this.remoteFileGeneration === generation) {
      this.remoteFileOperationTail = generation.tail
    }
    try {
      await previous
      abortRemoteFileOperation(options?.signal)
      if (this.remoteFileUnmounted) throw remoteFileOperationUnmounted()
      if (!generation.accepting ||
        this.remoteFileGeneration !== generation) {
        throw remoteFileOperationStale()
      }
      const capability = await this.acquireRemoteFileOperation(options)
      if (this.remoteFileUnmounted ||
        !generation.accepting ||
        this.remoteFileGeneration !== generation) {
        const staleError = this.remoteFileUnmounted
          ? remoteFileOperationUnmounted()
          : remoteFileOperationStale()
        try {
          await capability.release()
        } catch (releaseError) {
          staleError.releaseError = releaseError
        }
        throw staleError
      }
      const generationCapability = options?.settlementOwnsCapability
        ? Object.freeze({ release: () => operationSettled })
        : capability
      generation.capabilities.add(generationCapability)
      let result
      let workError
      let committed = false
      const mutation = Object.freeze({
        commit: () => {
          committed = true
          return true
        }
      })
      try {
        abortRemoteFileOperation(options?.signal)
        result = await work(capability.backend, capability, mutation)
        if (!committed) {
          abortRemoteFileOperation(options?.signal)
          if (this.remoteFileUnmounted) throw remoteFileOperationUnmounted()
        }
      } catch (error) {
        workError = error
      }
      generation.capabilities.delete(generationCapability)
      let releaseError
      try {
        await capability.release()
      } catch (error) {
        releaseError = error
      }
      if (workError) {
        if (releaseError &&
          Object.isExtensible(workError) &&
          !workError.releaseError) {
          workError.releaseError = releaseError
        }
        throw workError
      }
      if (releaseError) {
        if (!committed) throw releaseError
        try { window.store.onError(releaseError) } catch {}
      }
      return result
    } finally {
      operationSettlements.delete(operationSettled)
      settleOperation()
      unlock()
    }
  }

  readRemoteFile = path => {
    if (this.type === 'ftp') return this.sftp.readFile(path)
    return this.withRemoteFileOperation(
      { id: `editor-read:${path}` },
      backend => backend.readFile(path)
    )
  }

  readRemoteFileContext = (
    file,
    { signal, maxBytes = AI_FILE_PREVIEW_MAX_BYTES } = {}
  ) => {
    if (this.type === 'ftp') {
      return readSftpFileContext({
        file,
        sftp: this.sftp,
        maxBytes
      })
    }
    const operationPath = resolve(file?.path || '', file?.name || '')
    return this.withRemoteFileOperation(
      { id: `ai-preview:${operationPath}`, signal },
      backend => readSftpFileContext({
        file,
        sftp: createRemoteFileContextReader(backend, {
          signal,
          maxPreviewBytes: maxBytes
        }),
        maxBytes
      })
    )
  }

  readRemoteFileAttachment = (
    file,
    { signal, maxBytes = REMOTE_ATTACHMENT_MAX_BYTES } = {}
  ) => {
    const filePath = resolve(file.path, file.name)
    abortRemoteFileOperation(signal)
    if (this.type === 'ftp') {
      return Promise.resolve(this.sftp.readFileBase64Preview(
        filePath,
        Math.min(Number(maxBytes) || REMOTE_ATTACHMENT_MAX_BYTES,
          REMOTE_ATTACHMENT_MAX_BYTES)
      )).then(result => {
        abortRemoteFileOperation(signal)
        return result
      })
    }
    return this.withRemoteFileOperation({
      id: `attachment:${filePath}`,
      signal
    }, backend => readRemoteFileBase64Preview(backend, filePath, {
      signal,
      maxBytes
    }))
  }

  createRemoteFile = ({ path, isDirectory }) => {
    if (this.type === 'ftp') {
      return isDirectory ? this.sftp.mkdir(path) : this.sftp.touch(path)
    }
    return this.withRemoteFileOperation(
      { id: `create:${path}` },
      backend => isDirectory ? backend.mkdir(path) : backend.touch(path)
    )
  }

  sftpList = async (backend, remotePath, { signal } = {}) => {
    abortRemoteFileOperation(signal)
    const arr = await backend.list(
      remotePath,
      signal ? { signal } : undefined
    )
    abortRemoteFileOperation(signal)
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
  }

  buildRemoteListRequestKey = ({
    returnList,
    remotePath,
    commitList
  }) => [
    String(this.sshSessionGeneration || ''),
    normalizeRemotePath(remotePath || ''),
    returnList ? 'return' : 'paint',
    commitList ? 'commit' : 'no-commit'
  ].join('\u0000')

  remoteList = (...args) => {
    const [
      returnList = false,
      remotePathReal,
      oldPath,
      options = {}
    ] = args
    const requestKey = this.buildRemoteListRequestKey({
      returnList,
      remotePath: remotePathReal || this.state.remotePath || '',
      commitList: options.commitList === true
    })
    return this.remoteDirectoryCache.runRequest(
      requestKey,
      () => this.remoteListUncoalesced(
        returnList,
        remotePathReal,
        oldPath,
        options
      )
    )
  }

  applyCachedRemoteDirectory = (remote, generation, task) => {
    const startedAt = globalThis.performance?.now?.() ?? Date.now()
    let cachedPaintCommitted = false
    this.setState(prevState => {
      if (!generation.accepting ||
        !isCurrentRemoteFileGeneration(this, generation) ||
        !isCurrentSftpEntryRemoteTask(this, task)) return null
      const nextRemote = preserveSftpDraftItems(prevState.remote, remote)
      cachedPaintCommitted = true
      const update = {
        remote: nextRemote,
        remoteFileTree: this.buildTree(nextRemote, typeMap.remote),
        remoteLoading: false,
        remoteRefreshState: 'cached-refreshing',
        remoteRefreshError: ''
      }
      return prevState.selectedType === typeMap.remote
        ? {
            ...update,
            selectedFiles: reconcileSelectedFileIds(
              prevState.remote,
              nextRemote,
              prevState.selectedFiles
            )
          }
        : update
    }, () => {
      if (!cachedPaintCommitted ||
        !generation.accepting ||
        !isCurrentRemoteFileGeneration(this, generation) ||
        !isCurrentSftpEntryRemoteTask(this, task)) return
      let acceptance
      try {
        acceptance = recordPerformanceDuration(
          'sftp_cached_paint_ms',
          (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
          { outcome: 'completed' }
        )
      } catch (error) {
        acceptance = Promise.reject(error)
      }
      Promise.allSettled([
        trackSftpEntryMetric(this, acceptance)
      ])
    })
  }

  remoteListUncoalesced = async (
    returnList = false,
    remotePathReal,
    oldPath,
    options = {}
  ) => {
    const refreshStartedAt =
      globalThis.performance?.now?.() ?? Date.now()
    if (!this.firstSftpReadyRecorded && !this.sftpReadyStartedAt) {
      this.sftpReadyStartedAt = refreshStartedAt
    }
    if (this.remoteFileUnmounted) throw remoteFileOperationUnmounted()
    const generation = initializeRemoteFileGeneration(this)
    const assertCurrentGeneration = () => {
      if (this.remoteFileUnmounted) throw remoteFileOperationUnmounted()
      if (!generation.accepting ||
        !isCurrentRemoteFileGeneration(this, generation)) {
        throw remoteFileOperationStale()
      }
    }
    assertCurrentGeneration()
    const task = options.lifecycleTask || beginSftpEntryRemoteTask(this)
    if (!isCurrentSftpEntryRemoteTask(this, task)) {
      throw remoteFileOperationStale()
    }
    const { tab, sessionOptions } = this.props
    const { username, startDirectory } = tab
    let remotePath
    const noPathInit = remotePathReal || this.state.remotePath
    if (noPathInit) {
      remotePath = noPathInit
    }
    if (!returnList && !options.suppressLoading) {
      assertCurrentGeneration()
      this.setState(() => {
        if (!generation.accepting ||
          !isCurrentRemoteFileGeneration(this, generation) ||
          !isCurrentSftpEntryRemoteTask(this, task)) return null
        return {
          remoteLoading: true,
          remoteRefreshState: 'refreshing',
          remoteRefreshError: ''
        }
      })
    }
    const oldRemote = deepCopy(
      this.state.remote
    )
    let sftp = this.sftp
    let candidateSftp = null
    let candidateCommitted = false
    let preparedProbe = null
    let cacheKey = ''
    let cachedRemote = null
    const applyCachedDirectory = runtimeIdentity => {
      cacheKey = buildRemoteDirectoryCacheKey({
        sshSessionGeneration: String(this.sshSessionGeneration || ''),
        host: tab.host,
        port: tab.port || this.port || 22,
        username,
        channel: runtimeIdentity?.channel ||
          this.state.remoteFileIdentity?.channel || 'unknown',
        effectiveUsername: runtimeIdentity?.effectiveUsername ||
          this.state.remoteFileIdentity?.effectiveUsername || '',
        path: normalizeRemotePath(remotePath)
      })
      const cached = this.remoteDirectoryCache.get(cacheKey)
      if (cached && !returnList) {
        cachedRemote = cached.value
        this.applyCachedRemoteDirectory(cachedRemote, generation, task)
      }
    }
    const abortPreparedProbe = async primaryError => {
      const handle = preparedProbe
      if (!handle) return true
      try {
        const result = await handle.abort()
        preparedProbe = null
        generation.capabilities.delete(handle)
        if (this.preparedRemoteFileCapabilityProbe?.handle === handle) {
          this.preparedRemoteFileCapabilityProbe = null
        }
        return result
      } catch (cleanupError) {
        if (primaryError && Object.isExtensible(primaryError)) {
          const cleanupErrors = Array.isArray(primaryError.cleanupErrors)
            ? primaryError.cleanupErrors
            : []
          primaryError.cleanupErrors = Object.freeze([
            ...cleanupErrors,
            cleanupError
          ])
          return false
        }
        throw cleanupError
      }
    }
    const destroyCandidate = async primaryError => {
      await abortPreparedProbe(primaryError)
      if (!candidateSftp || candidateCommitted) return false
      return destroySftpEntryClientOnce(this, candidateSftp)
    }
    try {
      if (!this.sftp) {
        assertCurrentGeneration()
        const terminal = this.type === 'ftp'
          ? null
          : refs.get('term-' + tab.id)
        const terminalEndpoint = terminal?.getTerminalSafetyEndpoint?.()
        const sshSessionGeneration = this.type === 'ftp'
          ? undefined
          : terminalEndpoint?.sshSessionGeneration
        const sshTerminalPid = this.type === 'ftp'
          ? undefined
          : terminalEndpoint?.sshTerminalPid
        sftp = await Client(
          this.terminalId,
          this.type,
          this.port,
          sshSessionGeneration,
          sshTerminalPid
        )
        candidateSftp = sftp
        try {
          assertCurrentGeneration()
        } catch (error) {
          await destroyCandidate()
          throw error
        }
        if (!isCurrentSftpEntryRemoteTask(this, task)) {
          await destroyCandidate()
          return
        }
        if (!sftp) {
          return
        }
        const config = deepCopy(
          this.props.config
        )
        assertCurrentGeneration()
        this.setState(() => {
          if (!generation.accepting ||
            !isCurrentRemoteFileGeneration(this, generation) ||
            !isCurrentSftpEntryRemoteTask(this, task)) return null
          return { loadingSftp: true }
        })
        const opts = deepCopy({
          ...tab,
          readyTimeout: config.sshReadyTimeout,
          terminalId: this.terminalId,
          keepaliveInterval: config.keepaliveInterval,
          proxy: getProxy(tab, config),
          ...sessionOptions
        })
        assertCurrentGeneration()
        if (options.explicitOpen === true && this.type !== 'ftp') {
          const currentPrepared = this.preparedRemoteFileCapabilityProbe
          if (currentPrepared?.generation === generation) {
            preparedProbe = currentPrepared.handle
          } else {
            if (currentPrepared?.handle) {
              await currentPrepared.handle.abort()
            }
            const identityToken = this.captureRemoteFileIdentityToken()
            preparedProbe = beginRemoteFileCapabilityProbe({
              operationId: `list-bootstrap:${tab.id}:${generation.id}`,
              tab,
              getTerminal: tabId => refs.get('term-' + tabId),
              signal: options.signal,
              onLeaseState: event => this.publishRemoteFileLeaseState?.(
                event,
                identityToken
              )
            })
            this.preparedRemoteFileCapabilityProbe = Object.freeze({
              generation,
              handle: preparedProbe
            })
            generation.capabilities.add(preparedProbe)
          }
        }
        const r = await sftp.connect(opts)
          .catch(e => {
            if (shouldRetryUnexpectedSftpPacket(e, {
              expectedMessage: unexpectedPacketErrorDesc,
              retryCount: this.retryCount
            })) {
              this.retryCount++
              replaceSftpEntryTimer(
                this,
                'retryHandler',
                () => {
                  if (isCurrentSftpEntryRemoteTask(this, task)) {
                    this.runSftpBackgroundTask(
                      () => reconnectSftpEntryRemote(this)
                    )
                  }
                },
                sftpRetryInterval
              )
            } else {
              throw e
            }
          })
        try {
          assertCurrentGeneration()
        } catch (error) {
          await destroyCandidate(error)
          throw error
        }
        if (!isCurrentSftpEntryRemoteTask(this, task)) {
          await destroyCandidate()
          return
        }
        assertCurrentGeneration()
        this.setState(() => {
          if (!generation.accepting ||
            !isCurrentRemoteFileGeneration(this, generation) ||
            !isCurrentSftpEntryRemoteTask(this, task)) return null
          return { loadingSftp: false }
        })
        if (!r) {
          await destroyCandidate()
          if (!isCurrentSftpEntryRemoteTask(this, task)) return
          assertCurrentGeneration()
          return this.props.editTab(tab.id, {
            sftpCreated: false
          })
        } else {
          if (this.type !== 'ftp') {
            buildSftpSafetyEndpoint({
              tab,
              terminalId: this.terminalId,
              sftpSessionGeneration: sftp.sshSessionGeneration,
              sftpSshTerminalPid: sftp.sshTerminalPid,
              terminalEndpoint: refs.get('term-' + tab.id)
                ?.getTerminalSafetyEndpoint?.()
            })
          }
          assertCurrentGeneration()
          if (!await commitSftpEntryRemoteClient(
            this,
            task,
            sftp,
            generation
          )) return
          candidateCommitted = true
          this.retryCount = 0
        }
      }

      assertCurrentGeneration()
      if (!isCurrentSftpEntryRemoteTask(this, task)) {
        await destroyCandidate()
        return
      }

      let remotePathPromise = null
      if (!remotePath) {
        if (startDirectory) {
          remotePath = normalizeRemotePath(startDirectory)
        } else if (this.type === 'ftp') {
          remotePath = await this.getPwd(username, sftp)
          assertCurrentGeneration()
          if (!isCurrentSftpEntryRemoteTask(this, task)) return
        } else {
          remotePathPromise = Promise.resolve(this.getPwd(username, sftp))
          // Capability setup can fail before its callback observes this promise.
          remotePathPromise.catch(() => {})
        }
      }

      const commitRemoteResult = async remote => {
        assertCurrentGeneration()
        if (!isCurrentSftpEntryRemoteTask(this, task)) return false
        if (cacheKey) {
          this.remoteDirectoryCache.set(cacheKey, remote)
        }
        const update = {
          remote,
          remoteFileTree: this.buildTree(remote, typeMap.remote),
          inited: true,
          remoteLoading: false,
          remoteRefreshState: 'idle',
          remoteRefreshError: ''
        }
        if (!noPathInit) {
          update.remotePath = remotePath
          update.remotePathTemp = remotePath
        }
        if (!returnList) {
          update.onEditFile = false
        }
        if (oldPath) {
          update.remotePathHistory = uniq([
            oldPath,
            ...this.state.remotePathHistory
          ]).slice(0, maxSftpHistory)
        }
        assertCurrentGeneration()
        const renderCommit = beginSftpEntryRenderCommit(this)
        let remoteStatePrepared = false
        this.setState(prevState => {
          if (!generation.accepting ||
            !isCurrentRemoteFileGeneration(this, generation) ||
            !isCurrentSftpEntryRemoteTask(this, task)) return null
          remoteStatePrepared = true
          const nextRemote = preserveSftpDraftItems(prevState.remote, remote)
          const nextUpdate = nextRemote === remote
            ? update
            : {
                ...update,
                remote: nextRemote,
                remoteFileTree: this.buildTree(nextRemote, typeMap.remote)
              }
          return prevState.selectedType === typeMap.remote
            ? {
                ...nextUpdate,
                selectedFiles: reconcileSelectedFileIds(
                  prevState.remote,
                  nextRemote,
                  prevState.selectedFiles
                )
              }
            : nextUpdate
        }, () => {
          Promise.resolve().then(async () => {
            if (!remoteStatePrepared ||
              !generation.accepting ||
              !isCurrentRemoteFileGeneration(this, generation) ||
              !isCurrentSftpEntryRemoteTask(this, task)) {
              renderCommit.settle(false)
              return
            }
            const renderedAt =
              globalThis.performance?.now?.() ?? Date.now()
            const acceptMetric = (name, duration, outcome) => {
              let acceptance
              try {
                acceptance = recordPerformanceDuration(
                  name,
                  duration,
                  { outcome }
                )
              } catch (error) {
                acceptance = Promise.reject(error)
              }
              return trackSftpEntryMetric(this, acceptance)
            }
            const metricAcceptances = [acceptMetric(
              'sftp_refresh_ms',
              renderedAt - refreshStartedAt,
              cachedRemote ? 'cache-refreshed' : 'completed'
            )]
            if (!this.firstSftpReadyRecorded) {
              this.firstSftpReadyRecorded = true
              metricAcceptances.push(acceptMetric(
                'first_sftp_ready_ms',
                renderedAt - this.sftpReadyStartedAt,
                'completed'
              ))
            }
            try {
              this.props.editTab(tab.id, {
                sftpCreated: true
              })
            } catch (error) {
              metricAcceptances.push(trackSftpEntryMetric(
                this,
                Promise.reject(error)
              ))
            }
            await Promise.allSettled(metricAcceptances)
            renderCommit.settle({
              committed: true,
              visibleRemoteCommitted: true,
              firstReadyCommitted: this.firstSftpReadyRecorded
            })
          })
        })
        const committed = await renderCommit.promise
        if (!committed) {
          assertCurrentGeneration()
          if (!isCurrentSftpEntryRemoteTask(this, task)) return false
          throw remoteFileOperationStale()
        }
        return true
      }

      let remote
      if (this.type === 'ftp') {
        assertCurrentGeneration()
        applyCachedDirectory({
          channel: 'ftp',
          effectiveUsername: username
        })
        remote = await this.sftpList(sftp, remotePath)
        assertCurrentGeneration()
        if (!isCurrentSftpEntryRemoteTask(this, task)) return
        if (!await commitSftpEntryRemoteClient(
          this,
          task,
          sftp,
          generation
        )) return
        remote = await this.updateRemoteList(remote, remotePath, sftp, task)
        assertCurrentGeneration()
      } else {
        assertCurrentGeneration()
        remote = await this.withRemoteFileOperation({
          id: `list:${remotePath || 'home'}`,
          signal: options.signal,
          preparedProbe,
          lifecycleTask: task
        }, async (backend, capability, mutation) => {
          if (remotePathPromise) {
            remotePath = await remotePathPromise
            assertCurrentGeneration()
            if (!isCurrentSftpEntryRemoteTask(this, task)) return
          }
          applyCachedDirectory(capability.runtimeIdentity)
          const listed = await this.sftpList(backend, remotePath, {
            signal: options.signal
          })
          if (!isCurrentSftpEntryRemoteTask(this, task)) return
          const updated = await this.updateRemoteList(
            listed,
            remotePath,
            backend,
            task,
            options.signal
          )
          if (!returnList || options.commitList) {
            if (!await commitRemoteResult(updated)) return
            mutation.commit()
          }
          return updated
        })
        assertCurrentGeneration()
        if (!isCurrentSftpEntryRemoteTask(this, task)) return
        if (!await commitSftpEntryRemoteClient(
          this,
          task,
          sftp,
          generation
        )) return
      }
      if (returnList && !options.commitList) {
        return remote
      }
      if (this.type === 'ftp') await commitRemoteResult(remote)
    } catch (error) {
      if (!generation.accepting ||
        !isCurrentRemoteFileGeneration(this, generation) ||
        this.remoteFileUnmounted) {
        await destroyCandidate(error)
        if (error?.name === 'AbortError') throw error
        throw remoteFileOperationStale()
      }
      if (!isCurrentSftpEntryRemoteTask(this, task)) {
        await destroyCandidate()
        return
      }
      if (candidateSftp && !candidateCommitted) {
        await destroyCandidate(error)
        if (!isCurrentSftpEntryRemoteTask(this, task)) return
        this.props.editTab(tab.id, {
          sftpCreated: false
        })
      }
      const normalizedError = this.normalizeSftpError(error)
      const fallbackRemote = cachedRemote || oldRemote
      const update = {
        remoteLoading: false,
        remote: fallbackRemote,
        remoteFileTree: this.buildTree(fallbackRemote, typeMap.remote),
        loadingSftp: false,
        remoteRefreshState: cachedRemote ? 'stale-error' : 'idle',
        remoteRefreshError: normalizedError.message
      }
      if (oldPath && !cachedRemote) {
        update.remotePath = oldPath
        update.remotePathTemp = oldPath
      }
      this.setState(() => {
        if (!generation.accepting ||
          !isCurrentRemoteFileGeneration(this, generation) ||
          !isCurrentSftpEntryRemoteTask(this, task)) return null
        return update
      })
      if (!options.suppressVisibleError) {
        if (this.isSftpVisible()) {
          this.onError(normalizedError)
        }
      }
      if (options.rethrow) throw error
    }
  }

  resolveRemoteLink = async (file, remotePath, backend, task, signal) => {
    abortRemoteFileOperation(signal)
    const { name } = file
    if (!file.isSymbol) {
      file.isSymbolicLink = false
      return file
    }
    const linkPath = resolve(remotePath, name)
    let realpath
    try {
      realpath = await backend.readlink(
        linkPath,
        signal ? { signal } : undefined
      )
    } catch (error) {
      if (isAuthoritativeRemoteMissingError(error)) return null
      throw error
    }
    abortRemoteFileOperation(signal)
    if (task && !isCurrentSftpEntryRemoteTask(this, task)) return
    if (!realpath) return null
    if (!isAbsPath(realpath)) {
      realpath = resolve(remotePath, realpath)
      abortRemoteFileOperation(signal)
      try {
        realpath = await backend.realpath(
          realpath,
          signal ? { signal } : undefined
        )
      } catch (error) {
        if (isAuthoritativeRemoteMissingError(error)) return null
        throw error
      }
      abortRemoteFileOperation(signal)
      if (task && !isCurrentSftpEntryRemoteTask(this, task)) return
    }
    let realFileInfo
    try {
      realFileInfo = await backend.stat(
        realpath,
        signal ? { signal } : undefined
      )
    } catch (error) {
      if (isAuthoritativeRemoteMissingError(error)) return null
      throw error
    }
    abortRemoteFileOperation(signal)
    if (task && !isCurrentSftpEntryRemoteTask(this, task)) return
    if (!realFileInfo) return null
    file.isSymbolicLink = true
    file.isDirectory = isRemoteDirectory(realFileInfo)
    return file
  }

  updateRemoteList = async (remotes, remotePath, backend, task, signal) => {
    if (this.type === 'ftp') return remotes
    abortRemoteFileOperation(signal)
    const remote = []
    for (const file of remotes) {
      const resolved = await this.resolveRemoteLink(
        file,
        remotePath,
        backend,
        task,
        signal
      )
      abortRemoteFileOperation(signal)
      if (task && !isCurrentSftpEntryRemoteTask(this, task)) return
      if (resolved) remote.push(resolved)
    }
    return remote
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
      this.setState(prevState => {
        const nextLocal = preserveSftpDraftItems(prevState.local, local)
        const nextUpdate = nextLocal === local
          ? update
          : {
              ...update,
              local: nextLocal,
              localFileTree: this.buildTree(nextLocal, typeMap.local)
            }
        return prevState.selectedType === typeMap.local
          ? {
              ...nextUpdate,
              selectedFiles: reconcileSelectedFileIds(
                prevState.local,
                nextLocal,
                prevState.selectedFiles
              )
            }
          : nextUpdate
      })
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

  remoteListDebounce = debounce((...args) => (
    this.runSftpBackgroundTask(() => this.remoteList(...args))
  ), 1000)

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
    }, () => this.runSftpBackgroundTask(
      () => this[`${type}List`](undefined, undefined, oldPath)
    ))
  }

  handleReloadRemoteSftp = async () => {
    this.remoteDirectoryCache?.clear?.()
    this.invalidateRemoteFileIdentity()
    this.sftpSafetyProgressHandlers.clear()
    this.sftpSafetyAdapter.discardAllPreparedProofs()
    let settlementError
    const transferSettlement = this.quiesceActiveTransfers?.()
    if (transferSettlement) {
      try {
        await transferSettlement
      } catch (error) {
        settlementError = error
      }
    }
    const drain = drainRemoteFileGeneration(this, {
      invalidateIdentity: false
    })
    await drain.promise
    this.clearTransferSafetySessionPins?.()
    if (settlementError) throw settlementError
    if (!activateRemoteFileGeneration(this, drain.generation)) return
    this.setState({
      remoteLoading: true,
      remote: [],
      remoteFileTree: new Map()
    }, () => {
      if (isCurrentRemoteFileGeneration(this, drain.generation)) {
        this.runSftpBackgroundTask(() => this.initRemoteAll())
      }
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
      return reconnectSftpEntryRemote(this)
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
    }, () => this.runSftpBackgroundTask(
      () => this[`${type}List`](undefined, undefined, oldPath)
    ))
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
      }, () => this.runSftpBackgroundTask(
        () => this[`${type}List`](
          undefined,
          undefined,
          op
        )
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
        'readRemoteFile',
        'readRemoteFileContext',
        'createRemoteFile',
        'localDel',
        'remoteDel',
        'delFiles',
        'getIndex',
        'selectAll',
        'selectPrev',
        'selectNext',
        'getFileList',
        'onGoto',
        'addTransferList',
        'renderDelConfirmTitle',
        'getSftpSafetyEndpoint',
        'getSelectedFiles',
        'getFileItemById',
        'quickDeleteRemoteFiles',
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
      const {
        remoteFileIdentity,
        remoteFileStatus,
        remoteRefreshState
      } = this.state
      const effectiveChannel = remoteFileIdentity?.channel || 'unknown'
      const showSshFileIdentity = shouldRenderSshFileIdentity(
        this.props,
        this.type
      )
      return (
        <div className='sftp-panel-title sftp-panel-title-remote pd1t pd1b pd1x'>
          <span className='sftp-panel-heading'>
            <span className='sftp-panel-location'>{e('remote')}: {username}@{host}</span>
            {showSshFileIdentity
              ? (
                <span className='sftp-panel-identities'>
                  <span className='sftp-login-identity'>
                    {formatShellPilotTranslation(
                      e,
                      'shellpilotSftpLoginIdentity',
                      { username }
                    )}
                  </span>
                  <span className={`sftp-file-identity is-${effectiveChannel}`}>
                    {effectiveChannel === 'pty-root'
                      ? (
                        <span
                          aria-hidden='true'
                          className='sftp-file-identity-marker'
                        >
                          {e('shellpilotSftpRootBadge')}
                        </span>
                        )
                      : null}
                    {formatEffectiveFileIdentity(remoteFileIdentity, e)}
                  </span>
                  {remoteFileStatus === 'busy'
                    ? (
                      <span
                        className='sftp-file-operation-status is-busy'
                        role='status'
                        aria-live='polite'
                      >
                        {e('shellpilotSftpRootLeaseBusy')}
                      </span>
                      )
                    : null}
                  {remoteFileStatus === 'unavailable'
                    ? (
                      <span
                        className='sftp-file-operation-status is-unavailable'
                        role='status'
                        aria-live='polite'
                      >
                        {e('shellpilotSftpIdentityUnavailable')}
                      </span>
                      )
                    : null}
                  {remoteFileStatus === 'uncertain'
                    ? (
                      <span
                        className='sftp-file-operation-status is-uncertain'
                        role='status'
                        aria-live='polite'
                      >
                        {e('shellpilotSftpReleaseUncertain')}
                      </span>
                      )
                    : null}
                </span>
                )
              : null}
            {remoteRefreshState !== 'idle'
              ? (
                <span
                  className={`sftp-refresh-status is-${remoteRefreshState}`}
                  role='status'
                  aria-live='polite'
                >
                  {e(remoteRefreshState === 'cached-refreshing'
                    ? 'shellpilotSftpShowingCachedRefreshing'
                    : remoteRefreshState === 'stale-error'
                      ? 'shellpilotSftpShowingCachedRefreshFailed'
                      : 'shellpilotSftpRefreshing')}
                </span>
                )
              : null}
          </span>
          <span className='sftp-safety-actions'>
            <Button
              size='small'
              type='text'
              icon={<SaveOutlined />}
              disabled={!selectedCount}
              aria-label={selectedCount
                ? formatShellPilotTranslation(e, 'shellpilotSftpQuickBackupCount', { count: selectedCount })
                : e('shellpilotSftpSelectFilesForBackup')}
              title={!selectedCount ? e('shellpilotSftpSelectFilesForBackup') : undefined}
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
            onClick={() => this.runSftpBackgroundTask(
              this.handleReloadRemoteSftp
            )}
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
        {this.isActive()
          ? (
            <SftpTransferProgressDock
              tabId={this.props.tab.id}
              username={this.props.tab.username}
            />
            )
          : null}
      </div>
    )
  }
}
