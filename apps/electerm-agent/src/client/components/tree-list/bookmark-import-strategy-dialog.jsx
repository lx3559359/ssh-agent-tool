import React, { useState } from 'react'
import Modal from '../common/modal'
import { bookmarkImportStrategies } from '../../common/bookmark-import-plan'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import './bookmark-import-strategy-dialog.styl'

const e = window.translate

const strategyOptions = [
  {
    value: bookmarkImportStrategies.keepLocal,
    titleKey: 'shellpilotImportKeepLocal',
    descriptionKey: 'shellpilotImportKeepLocalDescription'
  },
  {
    value: bookmarkImportStrategies.overwrite,
    titleKey: 'shellpilotImportOverwrite',
    descriptionKey: 'shellpilotImportOverwriteDescription'
  },
  {
    value: bookmarkImportStrategies.duplicate,
    titleKey: 'shellpilotImportDuplicate',
    descriptionKey: 'shellpilotImportDuplicateDescription'
  }
]

function StrategyOptions ({ onChange }) {
  const [value, setValue] = useState(bookmarkImportStrategies.keepLocal)

  const select = (nextValue) => {
    setValue(nextValue)
    onChange(nextValue)
  }

  return (
    <div className='bookmark-import-strategy-options'>
      <p>{e('shellpilotImportStrategyPrompt')}</p>
      {strategyOptions.map(option => (
        <label className='bookmark-import-strategy-option' key={option.value}>
          <input
            type='radio'
            name='bookmark-import-strategy'
            value={option.value}
            checked={value === option.value}
            onChange={() => select(option.value)}
          />
          <span>
            <strong>{e(option.titleKey)}</strong>
            <small>{e(option.descriptionKey)}</small>
          </span>
        </label>
      ))}
    </div>
  )
}

export function requestBookmarkImportStrategy ({ conflictCount = 0 } = {}) {
  return new Promise(resolve => {
    let selected = bookmarkImportStrategies.keepLocal
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    Modal.confirm({
      title: formatShellPilotTranslation(e, 'shellpilotImportConflictsFound', { count: conflictCount }),
      content: <StrategyOptions onChange={value => { selected = value }} />,
      okText: e('shellpilotStartImport'),
      cancelText: e('shellpilotCancelImport'),
      maskClosable: false,
      onOk: () => finish(selected),
      onCancel: () => finish(null)
    })
  })
}
