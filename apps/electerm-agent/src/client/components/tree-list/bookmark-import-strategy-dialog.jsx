import React, { useState } from 'react'
import Modal from '../common/modal'
import { bookmarkImportStrategies } from '../../common/bookmark-import-plan'
import './bookmark-import-strategy-dialog.styl'

const strategyOptions = [
  {
    value: bookmarkImportStrategies.keepLocal,
    title: '保留本地（推荐）',
    description: '保留已有连接和分组，只导入备份中的新增内容。'
  },
  {
    value: bookmarkImportStrategies.overwrite,
    title: '使用备份覆盖',
    description: '用备份内容替换匹配的本地连接和分组。'
  },
  {
    value: bookmarkImportStrategies.duplicate,
    title: '创建副本',
    description: '保留本地内容，并为冲突项创建新的连接和分组。'
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
      <p>请选择本次导入的统一处理方式：</p>
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
            <strong>{option.title}</strong>
            <small>{option.description}</small>
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
      title: `发现 ${conflictCount} 个导入冲突`,
      content: <StrategyOptions onChange={value => { selected = value }} />,
      okText: '开始导入',
      cancelText: '取消导入',
      maskClosable: false,
      onOk: () => finish(selected),
      onCancel: () => finish(null)
    })
  })
}
