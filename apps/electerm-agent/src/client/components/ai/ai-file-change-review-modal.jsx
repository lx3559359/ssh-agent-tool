import { useMemo, useState } from 'react'
import Modal from '../common/modal'
import message from '../common/message'
import {
  countSelectedAiFileChanges,
  setAiFileChangeSelected
} from './ai-file-change-set.js'
import './ai-file-change-review-modal.styl'

export function AiFileChangeReviewModal ({
  initialChangeSet,
  onChange
}) {
  const [changeSet, setChangeSet] = useState(initialChangeSet)
  const [activePath, setActivePath] = useState(
    initialChangeSet.files[0]?.path || ''
  )
  const activeFile = useMemo(
    () => changeSet.files.find(file => file.path === activePath) ||
      changeSet.files[0],
    [changeSet, activePath]
  )

  function toggleFile (path, selected) {
    const next = setAiFileChangeSelected(changeSet, path, selected)
    setChangeSet(next)
    onChange?.(next)
  }

  return (
    <div className='ai-file-change-review'>
      <div className='ai-file-change-review-summary'>
        AI 准备修改 {changeSet.files.length} 个远程文件。请逐项审查，
        取消不需要的文件后再执行。
      </div>
      <div className='ai-file-change-review-body'>
        <div className='ai-file-change-review-list'>
          {
            changeSet.files.map(file => (
              <button
                type='button'
                className={file.path === activeFile?.path ? 'is-active' : ''}
                key={file.path}
                onClick={() => setActivePath(file.path)}
              >
                <input
                  type='checkbox'
                  checked={file.selected}
                  aria-label={`选择 ${file.path}`}
                  onClick={event => event.stopPropagation()}
                  onChange={event => toggleFile(file.path, event.target.checked)}
                />
                <span title={file.path}>{file.path}</span>
                {file.truncated && <small>预览已截断</small>}
              </button>
            ))
          }
        </div>
        <div className='ai-file-change-review-diff'>
          <div className='ai-file-change-review-path'>
            {activeFile?.path}
          </div>
          <pre>{activeFile?.diffPreview || '没有可显示的文本差异。'}</pre>
        </div>
      </div>
      <div className='ai-file-change-review-footer'>
        已选择 {countSelectedAiFileChanges(changeSet)} / {changeSet.files.length} 个文件
      </div>
    </div>
  )
}

export function requestAiFileChangeReview (initialChangeSet, options = {}) {
  const signal = options.signal
  if (signal?.aborted) {
    return Promise.resolve({ accepted: false, changeSet: initialChangeSet })
  }
  return new Promise(resolve => {
    let current = initialChangeSet
    let settled = false
    const modalRef = { current: null }
    const settle = (accepted, destroy = false) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (destroy) modalRef.current?.destroy?.()
      resolve({ accepted, changeSet: current })
    }
    const onAbort = () => settle(false, true)
    signal?.addEventListener('abort', onAbort, { once: true })
    modalRef.current = Modal.confirm({
      title: '审查 AI 多文件修改',
      width: 960,
      content: (
        <AiFileChangeReviewModal
          initialChangeSet={initialChangeSet}
          onChange={value => { current = value }}
        />
      ),
      okText: '创建恢复点并执行',
      cancelText: '取消',
      maskClosable: false,
      onOk: () => {
        if (countSelectedAiFileChanges(current) < 1) {
          message.warning('请至少选择一个要修改的文件。')
          settle(false)
          return
        }
        settle(true)
      },
      onCancel: () => settle(false)
    })
    if (settled) modalRef.current?.destroy?.()
  })
}
