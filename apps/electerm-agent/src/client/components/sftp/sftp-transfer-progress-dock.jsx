import React, { useEffect, useRef, useState } from 'react'
import { auto } from 'manate/react'
import { filesize } from 'filesize'
import Transporter from '../sidebar/transport-ui.jsx'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import {
  buildSftpTransferProgress,
  createSftpProgressPublishGate
} from './sftp-transfer-progress-model.js'

const e = window.translate

function formatProgressText (summary) {
  if (!summary.determinate) {
    return `${filesize(summary.transferred)} · ${e('shellpilotSftpTransferUnknownTotal')}`
  }
  return `${summary.percent}% · ${filesize(summary.transferred)} / ${filesize(summary.total)}`
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
  const terminal = ['completed', 'failed'].includes(published.status)
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
        <span className='sftp-transfer-dock-count'>{countText}</span>
        <span className='sftp-transfer-dock-current' title={currentPath}>
          {currentPath}
        </span>
        <span className='sftp-transfer-dock-metrics'>
          {formatProgressText(published)}
          {speedText ? ` · ${speedText}` : ''}
        </span>
        <button
          type='button'
          className='sftp-transfer-dock-toggle'
          aria-expanded={expanded}
          aria-controls={`sftp-transfer-details-${tabId}`}
          onClick={() => setExpanded(value => !value)}
        >
          {terminal
            ? e(published.status === 'completed'
              ? 'shellpilotSftpTransferCompleted'
              : 'shellpilotSftpTransferFailed')
            : (expanded
                ? e('shellpilotSftpTransferCollapse')
                : e('shellpilotSftpTransferExpand'))}
        </button>
      </div>
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
      {expanded
        ? (
          <div
            className='sftp-transfer-dock-details'
            id={`sftp-transfer-details-${tabId}`}
          >
            {published.items.map((transfer, index) => (
              <Transporter
                key={transfer.id}
                transfer={transfer}
                index={index}
                compact
                readOnly={terminal}
              />
            ))}
          </div>
          )
        : null}
    </section>
  )
})
