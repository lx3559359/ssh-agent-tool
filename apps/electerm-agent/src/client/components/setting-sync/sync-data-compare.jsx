/**
 * Sync data comparison component
 * Shows simple diff suggestions
 */

import { useState, useEffect } from 'react'
import { Spin } from 'antd'

const e = window.translate

export default function SyncDataCompare (props) {
  const { store } = window
  const { syncType } = props
  const [loading, setLoading] = useState(false)
  const [comparison, setComparison] = useState(null)

  useEffect(() => {
    loadComparison()
  }, [syncType])

  async function loadComparison () {
    setLoading(true)
    try {
      const result = await store.previewServerDataWithCompare(syncType)
      setComparison(result)
    } catch (err) {
      console.error('Failed to load comparison:', err)
    }
    setLoading(false)
  }

  if (!comparison) {
    return null
  }

  const { comparison: comp } = comparison

  // Filter only items with differences
  const diffs = comp.filter(item => item.onlyLocal > 0 || item.onlyServer > 0)

  if (diffs.length === 0) {
    return (
      <p className='mg1t sync-diff-text'>
        {e('shellpilotDataInSync')}
      </p>
    )
  }

  const nameMap = {
    bookmarks: e('bookmarks'),
    bookmarkGroups: e('shellpilotBookmarkGroups'),
    terminalThemes: e('shellpilotTerminalThemes'),
    quickCommands: e('shellpilotQuickCommands'),
    profiles: e('shellpilotCredentialProfiles'),
    addressBookmarks: e('shellpilotAddressBookmarks'),
    workspaces: e('shellpilotWorkspaces')
  }

  const lines = diffs.map(item => {
    const displayName = nameMap[item.name] || item.name
    const localCount = item.localCount
    const serverCount = item.serverCount
    const diff = serverCount - localCount
    let action = ''
    if (diff > 0) {
      action = e('shellpilotDownload')
    } else if (diff < 0) {
      action = e('shellpilotUpload')
    }
    return {
      text: `${e('shellpilotRemote')}: ${serverCount} ${displayName}, ${e('shellpilotLocal')}: ${localCount} ${displayName}`,
      action
    }
  })

  return (
    <div className='sync-data-compare mg1t mg2b'>
      <Spin spinning={loading}>
        <div className='sync-diff-text'>
          {lines.map((line, i) => (
            <p key={i} className='mg0'>
              {line.text}
              {line.action && (
                <span className='sync-suggest-action'> {'->'} {line.action} ?</span>
              )}
            </p>
          ))}
        </div>
      </Spin>
    </div>
  )
}
