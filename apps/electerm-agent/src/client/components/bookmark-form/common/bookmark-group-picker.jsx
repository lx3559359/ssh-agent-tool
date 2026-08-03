import { useState } from 'react'
import { Button, Input, Modal, Space, TreeSelect } from 'antd'
import { FolderAddOutlined } from '@ant-design/icons'
import { auto } from 'manate/react'
import formatBookmarkGroups from './bookmark-group-tree-format'
import message from '../../common/message'
import './bookmark-group-picker.styl'

const e = window.translate

export default auto(function BookmarkGroupPicker ({
  value,
  onChange,
  allowCreate = true,
  className = '',
  id,
  'aria-describedby': ariaDescribedBy
}) {
  const { store } = window
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [parentId, setParentId] = useState(value || 'default')
  const treeData = formatBookmarkGroups(store.bookmarkGroups)

  function createGroup () {
    try {
      const group = store.createBookmarkGroup({ title, parentId })
      onChange?.(group.id)
      setTitle('')
      setCreating(false)
    } catch (error) {
      const key = error.code === 'DUPLICATE_GROUP_TITLE'
        ? 'shellpilotDuplicateServerGroup'
        : 'shellpilotCreateServerGroupFailed'
      message.error(e(key))
    }
  }

  return (
    <div className={`bookmark-group-picker ${className}`}>
      <Space.Compact className='width-100'>
        <TreeSelect
          id={id}
          aria-describedby={ariaDescribedBy}
          value={value}
          onChange={onChange}
          treeData={treeData}
          treeDefaultExpandAll
          showSearch
          placeholder={e('shellpilotSelectServerGroup')}
          className='bookmark-group-picker-select'
        />
        {allowCreate
          ? (
            <Button
              icon={<FolderAddOutlined />}
              title={e('shellpilotCreateServerGroup')}
              onClick={() => setCreating(true)}
            />
            )
          : null}
      </Space.Compact>
      <Modal
        open={creating}
        title={e('shellpilotCreateServerGroup')}
        okText={e('create')}
        cancelText={e('cancel')}
        okButtonProps={{ disabled: !title.trim() }}
        onOk={createGroup}
        onCancel={() => setCreating(false)}
      >
        <label>{e('name')}</label>
        <Input
          value={title}
          onChange={event => setTitle(event.target.value)}
          autoFocus
        />
        <label>{e('shellpilotParentGroup')}</label>
        <TreeSelect
          value={parentId || undefined}
          onChange={setParentId}
          treeData={treeData}
          treeDefaultExpandAll
          showSearch
          className='width-100'
        />
      </Modal>
    </div>
  )
})
