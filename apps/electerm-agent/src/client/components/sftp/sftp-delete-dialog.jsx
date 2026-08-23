import React from 'react'
import { filesize } from 'filesize'
import Modal from '../common/modal'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import {
  buildDeleteTargetPreview,
  createSafeDeleteProgressGate,
  normalizeSafeDeleteProgress,
  redactDeletePreparationError
} from './sftp-delete-dialog-model.js'

const phaseTranslationKeys = {
  'source-scan': 'shellpilotSftpSafeDeleteSourceScan',
  'snapshot-copy': 'shellpilotSftpSafeDeleteSnapshotCopy',
  'snapshot-verify': 'shellpilotSftpSafeDeleteSnapshotVerify',
  ready: 'shellpilotSftpSafeDeleteReady',
  deleting: 'shellpilotSftpSafeDeleteDeleting',
  'result-verify': 'shellpilotSftpSafeDeleteResultVerify',
  failed: 'shellpilotSftpSafeDeleteFailed'
}

function SafeDeleteDialogBody ({ progress, files, count, error, translate }) {
  const preview = buildDeleteTargetPreview(files, {
    separator: translate('shellpilotListSeparator')
  })
  const normalized = normalizeSafeDeleteProgress(progress)
  const stateText = normalized.phase === 'failed'
    ? formatShellPilotTranslation(
      translate,
      phaseTranslationKeys.failed,
      { detail: redactDeletePreparationError(error) }
    )
    : formatShellPilotTranslation(
      translate,
      phaseTranslationKeys[normalized.phase],
      {
        count: count || preview.count,
        current: normalized.targetIndex,
        total: normalized.targetCount
      }
    )
  const inProgress = !['ready', 'failed'].includes(normalized.phase)

  return (
    <div
      className={`sftp-safe-delete-dialog is-${normalized.phase}`}
      aria-busy={inProgress}
    >
      <div
        className='sftp-safe-delete-state'
        role={normalized.phase === 'failed' ? 'alert' : 'status'}
        aria-live='polite'
        aria-atomic='true'
      >
        {stateText}
      </div>
      {inProgress && (
        <div
          className={`sftp-safe-delete-progress${normalized.determinate ? '' : ' is-indeterminate'}`}
          role='progressbar'
          aria-valuemin={0}
          aria-valuemax={100}
          {...(normalized.determinate
            ? { 'aria-valuenow': normalized.percent }
            : {})}
        >
          <span
            style={normalized.determinate
              ? { width: `${normalized.percent}%` }
              : undefined}
          />
        </div>
      )}
      <div className='sftp-safe-delete-bytes'>
        {normalized.completedBytes > 0
          ? filesize(normalized.completedBytes)
          : ''}
        {normalized.determinate
          ? ` / ${filesize(normalized.totalBytes)}`
          : ''}
      </div>
      <code className='sftp-delete-targets'>{preview.names}</code>
      {preview.remaining > 0 && (
        <div>
          {formatShellPilotTranslation(
            translate,
            'shellpilotSftpDeleteMoreTargets',
            { count: preview.remaining }
          )}
        </div>
      )}
    </div>
  )
}

export function openSafeDeleteDialog ({ files, externalSignal, translate }) {
  const controller = new AbortController()
  const initialProgress = {
    phase: 'source-scan',
    targetIndex: 1,
    targetCount: files.length
  }
  let settled = false
  let currentCount = files.length
  let currentError = null
  let resolveDecision
  const decision = new Promise(resolve => { resolveDecision = resolve })
  const renderProgress = (progress, error = currentError) => (
    <SafeDeleteDialogBody
      progress={progress}
      files={files}
      count={currentCount}
      error={error}
      translate={translate}
    />
  )
  const settle = value => {
    if (settled) return
    settled = true
    externalSignal?.removeEventListener('abort', onExternalAbort)
    resolveDecision(value)
  }
  const cancel = () => {
    progressGate?.dispose()
    controller.abort()
    settle('cancel')
  }
  const onExternalAbort = () => {
    progressGate?.dispose()
    controller.abort()
    modal?.destroy()
    settle('cancel')
  }
  if (externalSignal?.aborted) {
    queueMicrotask(onExternalAbort)
  } else {
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
  }

  const modal = Modal.confirm({
    title: translate('shellpilotSftpSafeDeleteTitle'),
    content: renderProgress(initialProgress),
    okText: translate('shellpilotSftpSafeDeleteAction'),
    cancelText: translate('cancel'),
    okButtonProps: { disabled: true },
    closeOnOk: false,
    keyboardConfirm: false,
    initialFocusSelector: '.custom-modal-cancel-btn',
    onOk: () => {},
    onCancel: cancel
  })
  const progressGate = createSafeDeleteProgressGate({
    onPublish: progress => {
      modal.update({ content: renderProgress(progress) })
    }
  })

  return {
    signal: controller.signal,
    decision,
    progress (value) {
      if (!settled || ['deleting', 'result-verify'].includes(value.phase)) {
        progressGate.update(value)
      }
    },
    ready (count) {
      if (settled) return
      currentCount = count
      progressGate.update({
        phase: 'ready',
        targetIndex: count,
        targetCount: count
      })
      modal.update({
        closeOnOk: false,
        okButtonProps: { disabled: false },
        onOk: () => {
          progressGate.update({
            phase: 'deleting',
            targetIndex: 1,
            targetCount: count
          })
          modal.update({ okButtonProps: { disabled: true } })
          settle('confirm')
        }
      })
    },
    fail (error, { retryable = !settled } = {}) {
      currentError = error
      progressGate.update({
        phase: 'failed',
        targetCount: currentCount || files.length
      })
      modal.update({
        content: renderProgress({
          phase: 'failed',
          targetCount: currentCount || files.length
        }, error),
        okText: translate(retryable
          ? 'shellpilotRetry'
          : 'shellpilotCloseDialog'),
        okButtonProps: { disabled: false },
        closeOnOk: true,
        onOk: () => {
          progressGate.dispose()
          if (retryable) settle('retry')
        }
      })
    },
    complete () {
      progressGate.dispose()
      modal.destroy()
    },
    destroy () {
      progressGate.dispose()
      modal.destroy()
      controller.abort()
      settle('cancel')
    }
  }
}
