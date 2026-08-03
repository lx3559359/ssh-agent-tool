/**
 * Bookmark from history modal - used to create bookmark from history item
 */

import React from 'react'
import { Alert, Button, Input } from 'antd'
import message from '../common/message'
import { PlusOutlined } from '@ant-design/icons'
import Modal from '../common/modal'
import { refsStatic } from '../common/ref'
import BookmarkGroupPicker from './common/bookmark-group-picker.jsx'
import generate from '../../common/uid'
import copy from 'json-deep-copy'

const e = window.translate

export default class BookmarkFromHistoryModal extends React.PureComponent {
  state = {
    visible: false,
    tab: null,
    selectedCategory: 'default',
    title: '',
    host: '',
    port: '',
    username: ''
  }

  componentDidMount () {
    refsStatic.add('bookmark-from-history-modal', this)
  }

  show (tab) {
    const selectedCategory = window.store.getLastBookmarkGroup?.() || 'default'
    this.setState({
      visible: true,
      tab: copy(tab),
      selectedCategory,
      title: tab.title || createHistoryBookmarkTitle(tab),
      host: tab.host || '',
      port: String(tab.port || defaultPortForType(tab.type)),
      username: tab.username || ''
    })
  }

  handleClose = () => {
    this.setState({
      visible: false,
      tab: null,
      selectedCategory: 'default',
      title: '',
      host: '',
      port: '',
      username: ''
    })
  }

  buildBookmark = () => {
    const { tab } = this.state
    if (!tab) return null

    const r = {
      ...tab,
      id: generate()
    }
    delete r.parentId
    delete r.category
    return r
  }

  handleConfirm = () => {
    const {
      tab,
      selectedCategory,
      title,
      host,
      port,
      username
    } = this.state
    if (!tab) {
      return
    }

    const bookmark = {
      ...this.buildBookmark(),
      title: title.trim(),
      host: host.trim(),
      port: String(port).trim(),
      username: username.trim()
    }

    window.store.saveBookmarkInGroup(bookmark, selectedCategory)
    message.success(e('Done'))
    this.handleClose()
  }

  render () {
    const {
      visible,
      tab,
      selectedCategory,
      title,
      host,
      port,
      username
    } = this.state

    if (!visible) {
      return null
    }

    const hasAuthentication = Boolean(
      tab?.password ||
      tab?.privateKey ||
      tab?.profile
    )
    const canSave = Boolean(title.trim() && host.trim() && port.trim())

    const modalProps = {
      open: visible,
      title: (
        <span>
          <PlusOutlined className='mg1r' />
          {e('bookmarks')}
        </span>
      ),
      width: 600,
      onCancel: this.handleClose,
      footer: (
        <div className='custom-modal-footer-buttons'>
          <Button onClick={this.handleClose}>
            {e('cancel')}
          </Button>
          <Button
            type='primary'
            disabled={!canSave}
            onClick={this.handleConfirm}
          >
            {e('confirm')}
          </Button>
        </div>
      )
    }

    return (
      <Modal {...modalProps}>
        <div className='bookmark-from-history-modal pd2'>
          {!hasAuthentication
            ? (
              <Alert
                className='mg2b'
                type='warning'
                showIcon
                message={e('shellpilotAuthenticationNeedsCompletion')}
              />
              )
            : null}
          <div className='pd1b'>
            <label>{e('name')}</label>
            <Input
              value={title}
              onChange={event => this.setState({ title: event.target.value })}
            />
          </div>
          <div className='pd1b'>
            <label>{e('host')}</label>
            <Input
              value={host}
              onChange={event => this.setState({ host: event.target.value })}
            />
          </div>
          <div className='pd1b'>
            <label>{e('port')}</label>
            <Input
              value={port}
              inputMode='numeric'
              onChange={event => this.setState({ port: event.target.value })}
            />
          </div>
          <div className='pd1b'>
            <label>{e('username')}</label>
            <Input
              value={username}
              onChange={event => this.setState({ username: event.target.value })}
            />
          </div>
          <div className='pd1b'>
            <label>{e('shellpilotSelectServerGroup')}</label>
            <BookmarkGroupPicker
              value={selectedCategory}
              onChange={val => this.setState({ selectedCategory: val })}
            />
          </div>
        </div>
      </Modal>
    )
  }
}

function defaultPortForType (type) {
  return String(type).toLowerCase() === 'telnet' ? 23 : 22
}

function createHistoryBookmarkTitle (tab) {
  const account = [tab.username, tab.host].filter(Boolean).join('@')
  return account || e('bookmarks')
}
