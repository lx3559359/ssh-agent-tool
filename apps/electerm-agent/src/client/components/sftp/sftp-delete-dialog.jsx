import React from 'react'
import Modal from '../common/modal'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import {
  buildDeleteTargetPreview,
  redactDeletePreparationError
} from './sftp-delete-dialog-model.js'

function SafeDeleteDialogBody ({ state, files, count, error, translate }) {
  const preview = buildDeleteTargetPreview(files, {
    separator: translate('shellpilotListSeparator')
  })
  const stateText = state === 'ready'
    ? formatShellPilotTranslation(
      translate,
      'shellpilotSftpSafeDeleteReady',
      { count: count || preview.count }
    )
    : state === 'failed'
      ? formatShellPilotTranslation(
        translate,
        'shellpilotSftpSafeDeleteFailed',
        { detail: redactDeletePreparationError(error) }
      )
      : translate('shellpilotSftpSafeDeletePreparing')

  return (
    <div
      className={`sftp-safe-delete-dialog is-${state}`}
      aria-busy={state === 'preparing'}
    >
      <div
        className='sftp-safe-delete-state'
        role={state === 'failed' ? 'alert' : 'status'}
        aria-live='polite'
        aria-atomic='true'
      >
        {stateText}
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
  let settled = false
  let resolveDecision
  const decision = new Promise(resolve => { resolveDecision = resolve })
  const settle = value => {
    if (settled) return
    settled = true
    externalSignal?.removeEventListener('abort', onExternalAbort)
    resolveDecision(value)
  }
  const onExternalAbort = () => {
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
    content: (
      <SafeDeleteDialogBody
        state='preparing'
        files={files}
        translate={translate}
      />
    ),
    okText: translate('shellpilotSftpSafeDeleteAction'),
    cancelText: translate('cancel'),
    okButtonProps: { disabled: true },
    keyboardConfirm: false,
    initialFocusSelector: '.custom-modal-cancel-btn',
    onOk: () => {},
    onCancel: () => {
      controller.abort()
      settle('cancel')
    }
  })

  return {
    signal: controller.signal,
    decision,
    ready (count) {
      if (settled) return
      modal.update({
        content: (
          <SafeDeleteDialogBody
            state='ready'
            files={files}
            count={count}
            translate={translate}
          />
        ),
        okButtonProps: { disabled: false },
        onOk: () => settle('confirm')
      })
    },
    fail (error) {
      if (settled) return
      modal.update({
        content: (
          <SafeDeleteDialogBody
            state='failed'
            files={files}
            error={error}
            translate={translate}
          />
        ),
        okText: translate('shellpilotRetry'),
        okButtonProps: { disabled: false },
        onOk: () => settle('retry')
      })
    },
    destroy () {
      modal.destroy()
      controller.abort()
      settle('cancel')
    }
  }
}
