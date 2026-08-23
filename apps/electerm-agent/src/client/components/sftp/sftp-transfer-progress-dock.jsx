import React, { useEffect, useRef, useState } from 'react'
import { auto } from 'manate/react'
import { filesize } from 'filesize'
import { CloseOutlined } from '@ant-design/icons'
import Transporter from '../sidebar/transport-ui.jsx'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import {
  buildSftpTransferProgress,
  createSftpProgressPublishGate,
  getSftpTransferDirection,
  sanitizeSftpTransferError
} from './sftp-transfer-progress-model.js'

const e = window.translate
const directionTranslationKeys = {
  upload: 'shellpilotSftpTransferUploading',
  download: 'shellpilotSftpTransferDownloading',
  transfer: 'shellpilotSftpTransferring'
}

function formatProgressPercent (summary) {
  if (summary.outcomeCounts) return ''
  return summary.determinate
    ? `${summary.percent}%`
    : e('shellpilotSftpTransferUnknownTotal')
}

function formatProgressDetail (summary) {
  if (summary.outcomeCounts) return ''
  if (!summary.determinate) {
    return summary.transferred > 0 ? filesize(summary.transferred) : ''
  }
  return `${filesize(summary.transferred)} / ${filesize(summary.total)}`
}

function formatOutcome (summary) {
  const counts = summary.outcomeCounts || {}
  return formatShellPilotTranslation(e, summary.status === 'partial'
    ? 'shellpilotSftpTransferPartialSummary'
    : summary.status === 'failed'
      ? 'shellpilotSftpTransferFailedSummary'
      : 'shellpilotSftpTransferCompletedSummary', {
    successful: counts.successful || 0,
    skipped: counts.skipped || 0,
    failed: counts.failed || 0
  })
}

function formatTerminalTransferDetail (transfer) {
  if (transfer.outcomeCounts) {
    const status = transfer.outcomeCounts.failed > 0
      ? 'failed'
      : transfer.outcomeCounts.skipped > 0
        ? 'partial'
        : 'completed'
    return formatOutcome({ status, outcomeCounts: transfer.outcomeCounts })
  }
  const status = String(transfer.status || '')
  const error = String(transfer.error || '')
  if (status === 'skipped' && /EBUSY|resource busy|locked|being used|占用/i.test(error)) {
    return e('shellpilotSftpTransferSkippedLocked')
  }
  const statusText = e(status || 'failed')
  return error
    ? `${statusText}: ${sanitizeSftpTransferError(error)}`
    : statusText
}

function formatSpeed (speedBytesPerSecond) {
  return speedBytesPerSecond > 0
    ? `${filesize(speedBytesPerSecond)}/s`
    : ''
}

export default auto(function SftpTransferProgressDock ({ tabId }) {
  const transfers = window.store.fileTransfers || []
  const history = window.store.transferHistory || []
  const observed = buildSftpTransferProgress(transfers, tabId, history)
  const [published, setPublished] = useState(() => (
    buildSftpTransferProgress([], tabId)
  ))
  const [expanded, setExpanded] = useState(false)
  const gateRef = useRef()
  if (!gateRef.current) {
    gateRef.current = createSftpProgressPublishGate({
      onPublish: setPublished
    })
  }

  useEffect(() => {
    gateRef.current.update(observed)
  }, [
    observed.count,
    observed.statusKey,
    observed.transferred,
    observed.total,
    observed.speedBytesPerSecond
  ])

  useEffect(() => () => gateRef.current?.dispose(), [])

  if (!published.count) return null

  const countText = formatShellPilotTranslation(
    e,
    'shellpilotSftpTransferCount',
    { count: published.count }
  )
  const currentPath = published.current?.fromPathReal ||
    published.current?.fromPath || ''
  const speedText = formatSpeed(published.speedBytesPerSecond)
  const direction = getSftpTransferDirection(published.current)
  const terminal = Boolean(published.outcomeCounts)
  const directionText = terminal
    ? e(published.status === 'partial'
      ? 'shellpilotSftpTransferPartial'
      : published.status === 'completed'
        ? 'shellpilotSftpTransferCompleted'
        : 'shellpilotSftpTransferFailed')
    : e(directionTranslationKeys[direction])
  const progressPercentText = formatProgressPercent(published)
  const progressDetailText = formatProgressDetail(published)
  const outcomeText = terminal && published.outcomeCounts
    ? formatOutcome(published)
    : ''
  const progressProps = published.determinate
    ? { 'aria-valuenow': published.percent }
    : {}
  const dockClass = [
    'sftp-transfer-progress-dock',
    `sftp-transfer-progress-dock-${published.status}`,
    expanded ? 'is-expanded' : ''
  ].filter(Boolean).join(' ')

  return (
    <section className={dockClass} aria-label={e('shellpilotSftpTransferProgress')}>
      <div className='sftp-transfer-dock-summary'>
        <span className='sftp-transfer-dock-leading'>
          <span className={`sftp-transfer-dock-direction is-${direction}`}>
            {directionText}
          </span>
          <span className='sftp-transfer-dock-count'>{countText}</span>
        </span>
        {terminal
          ? (
            <span
              className='sftp-transfer-dock-outcome'
              role='status'
              aria-live='polite'
              aria-atomic='true'
            >
              {outcomeText}
            </span>
            )
          : (
            <>
              <span className='sftp-transfer-dock-current' title={currentPath}>
                {currentPath}
              </span>
              <span className='sftp-transfer-dock-metrics'>
                <span className='sftp-transfer-dock-percent'>
                  {progressPercentText}
                </span>
                <span className='sftp-transfer-dock-metrics-detail'>
                  {progressDetailText ? ` · ${progressDetailText}` : ''}
                  {speedText ? ` · ${speedText}` : ''}
                </span>
              </span>
            </>
            )}
        <button
          type='button'
          className='sftp-transfer-dock-toggle'
          aria-expanded={expanded}
          aria-controls={`sftp-transfer-details-${tabId}`}
          onClick={() => setExpanded(value => !value)}
        >
          {expanded
            ? e('shellpilotSftpTransferCollapse')
            : e(terminal
              ? 'shellpilotSftpTransferViewDetails'
              : 'shellpilotSftpTransferExpand')}
        </button>
        {terminal
          ? (
            <button
              type='button'
              className='sftp-transfer-dock-dismiss'
              aria-label={e('shellpilotSftpTransferDismiss')}
              onClick={() => gateRef.current.dismiss()}
            >
              <CloseOutlined aria-hidden='true' />
            </button>
            )
          : null}
      </div>
      {terminal
        ? null
        : (
          <div
            className={`sftp-transfer-dock-progress${published.determinate ? '' : ' sftp-transfer-dock-progress-indeterminate'}`}
            role='progressbar'
            aria-label={e('shellpilotSftpTransferProgress')}
            aria-valuemin={0}
            aria-valuemax={100}
            {...progressProps}
          >
            <span style={published.determinate
              ? { width: `${published.percent}%` }
              : undefined}
            />
          </div>
          )}
      {expanded
        ? (
          <div
            className='sftp-transfer-dock-details'
            id={`sftp-transfer-details-${tabId}`}
          >
            {published.items.map((transfer, index) => terminal
              ? (
                <div className='sftp-transfer-dock-terminal-item' key={transfer.id}>
                  <span className='sftp-transfer-dock-terminal-path'>
                    {transfer.fromPathReal || transfer.fromPath}
                    <span aria-hidden='true'> → </span>
                    {transfer.toPathReal || transfer.toPath}
                  </span>
                  <span className={`sftp-transfer-dock-terminal-status is-${transfer.status}`}>
                    {formatTerminalTransferDetail(transfer)}
                  </span>
                </div>
                )
              : (
                <Transporter
                  key={transfer.id}
                  transfer={transfer}
                  index={index}
                  compact
                  readOnly={false}
                />
                ))}
          </div>
          )
        : null}
    </section>
  )
})
