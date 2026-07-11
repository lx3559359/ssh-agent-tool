import { memo } from 'react'
import {
  Button,
  Alert
} from 'antd'
import { buildTerminalErrorTips } from './terminal-error-help'

const e = window.translate

export default memo(function TerminalErrorHandle ({
  errorMessage,
  showEditBookmarkButton,
  onEditBookmark
}) {
  if (!errorMessage) {
    return null
  }

  function renderEditBookmarkButton () {
    if (!showEditBookmarkButton) {
      return null
    }
    return (
      <div className='terminal-error-actions pd1y'>
        <Button
          onClick={onEditBookmark}
        >
          {e('edit')} {e('bookmarks')}
        </Button>
      </div>
    )
  }

  function renderTips () {
    const tips = buildTerminalErrorTips(errorMessage)
    if (!tips.length) {
      return null
    }
    return (
      <ul className='terminal-error-tips'>
        {tips.map(tip => <li key={tip}>{tip}</li>)}
      </ul>
    )
  }

  function renderDescription () {
    const tips = renderTips()
    const actions = renderEditBookmarkButton()
    if (!tips && !actions) {
      return null
    }
    return (
      <>
        {tips}
        {actions}
      </>
    )
  }

  return (
    <Alert
      className='terminal-error-handle'
      title={errorMessage}
      type='error'
      showIcon
      banner
      description={renderDescription()}
    />
  )
})
