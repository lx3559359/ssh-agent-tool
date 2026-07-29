import React, { useCallback, useEffect, useRef } from 'react'
import createTitle, { createTitleWithTag } from '../../common/create-title'
import { DeleteOutlined, BookFilled } from '@ant-design/icons'
import { Dropdown } from 'antd'
import { refsStatic } from '../common/ref'

const e = window.translate

export default function HistoryItem (props) {
  const { store } = window
  const {
    item
  } = props
  const timeoutRef = useRef(null)

  const handleClick = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      store.onSelectHistory(item.tab)
    }, 10)
  }, [item.tab])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  function handleDelete (e) {
    e.stopPropagation()
    const { id } = item
    const i = store.history.findIndex((i) => i.id === id)
    if (i !== -1) {
      store.history.splice(i, 1)
    }
  }

  function handleBookmark (e) {
    e.stopPropagation()
    if (existingBookmark) {
      return
    }
    refsStatic.get('bookmark-from-history-modal')?.show(item.tab)
  }
  if (!item.tab) {
    return null
  }
  const existingBookmark = store.bookmarks.find(bookmark => (
    sameConnection(bookmark, item.tab)
  ))
  const title = createTitleWithTag(item.tab)
  const tt = createTitle(item.tab)
  const menuItems = [
    {
      key: 'save',
      label: existingBookmark
        ? e('shellpilotHistoryAlreadySaved')
        : e('shellpilotSaveHistoryAsServer'),
      disabled: Boolean(existingBookmark)
    }
  ]
  const handleMenuClick = ({ key, domEvent }) => {
    domEvent?.stopPropagation()
    if (key === 'save' && !existingBookmark) {
      refsStatic.get('bookmark-from-history-modal')?.show(item.tab)
    }
  }
  return (
    <Dropdown
      trigger={['contextMenu']}
      menu={{
        items: menuItems,
        onClick: handleMenuClick
      }}
    >
      <div
        className='item-list-unit'
        title={tt}
        onClick={handleClick}
      >
        <div className='elli pd1y pd2x'>
          {title}
          {existingBookmark
            ? (
              <span className='history-item-saved'>
                {e('shellpilotHistoryAlreadySaved')}
              </span>
              )
            : null}
        </div>
        <BookFilled
          className='list-item-bookmark'
          title={existingBookmark
            ? e('shellpilotHistoryAlreadySaved')
            : e('shellpilotSaveHistoryAsServer')}
          onClick={handleBookmark}
        />
        <DeleteOutlined
          className='list-item-edit'
          onClick={handleDelete}
        />
      </div>
    </Dropdown>
  )
}

function sameConnection (bookmark, tab) {
  const leftPort = String(bookmark.port || defaultPort(bookmark.type))
  const rightPort = String(tab.port || defaultPort(tab.type))
  return normalize(bookmark.type || 'ssh') === normalize(tab.type || 'ssh') &&
    normalize(bookmark.host) === normalize(tab.host) &&
    leftPort === rightPort &&
    normalize(bookmark.username) === normalize(tab.username)
}

function defaultPort (type) {
  return normalize(type) === 'telnet' ? 23 : 22
}

function normalize (value) {
  return String(value || '').trim().toLowerCase()
}
