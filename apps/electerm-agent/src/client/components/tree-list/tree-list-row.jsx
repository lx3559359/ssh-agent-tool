import TreeExpander from './tree-expander'
import TreeListItem from './tree-list-item'
import TreeItemOp from './tree-item-op'
import { treeLevelIndent } from './tree-list-layout'
import createName from '../../common/create-title'
import { Dropdown } from 'antd'
import { copy } from '../../common/clipboard'
import {
  buildBookmarkContextMenuItems,
  formatBookmarkPublicInfo
} from './bookmark-context-menu'

export default function TreeListRow (props) {
  const {
    row,
    keyword,
    expandedKeys,
    activeItemId,
    searchSelectedRowKey,
    staticList,
    leftSidebarWidth,
    handleExpand,
    handleUnExpand,
    del,
    openAll,
    openMoveModal,
    editItem,
    addSubCat,
    toggleFavorite,
    onSelect,
    duplicateItem,
    onDragStart,
    onDrop,
    onDragEnter,
    onDragLeave,
    onDragOver,
    isHidden
  } = props
  const { item, isGroup, parentId, depth } = row
  const groupHasChildren = Boolean(
    item?.bookmarkIds?.length ||
    item?.bookmarkGroupIds?.length
  )
  const isGroupExpanded = Boolean(keyword) || expandedKeys.includes(item.id)
  const itemProps = {
    item,
    isGroup,
    parentId,
    itemLabel: isGroup ? (item?.title || '') : createName(item),
    itemColor: item?.color,
    itemDescription: item?.description,
    itemLevel: item?.level,
    leftSidebarWidth,
    staticList,
    selectedItemId: activeItemId,
    searchSelected: searchSelectedRowKey === row.key,
    del,
    openAll,
    openMoveModal,
    editItem,
    addSubCat,
    onSelect,
    duplicateItem,
    onDragStart,
    onDrop,
    onDragEnter,
    onDragLeave,
    onDragOver,
    keyword
  }

  const createSelectEvent = (domEvent) => ({
    currentTarget: {
      getAttribute: (name) => {
        const attrs = {
          'data-item-id': item.id,
          'data-is-group': isGroup ? 'true' : 'false',
          'data-parent-id': parentId
        }
        return attrs[name]
      }
    },
    stopPropagation: () => domEvent?.stopPropagation?.()
  })

  const safeEvent = (domEvent) => ({
    stopPropagation: () => domEvent?.stopPropagation?.()
  })

  const confirmDelete = () => {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
      return true
    }
    return window.confirm(isGroup ? '确认删除这个分组？' : '确认删除这个连接？')
  }

  const onContextMenuAction = ({ key, domEvent }) => {
    domEvent?.stopPropagation?.()
    if (key === 'open') {
      return onSelect(createSelectEvent(domEvent))
    }
    if (key === 'openAll') {
      return openAll(item)
    }
    if (key === 'edit') {
      return editItem(safeEvent(domEvent), item, isGroup)
    }
    if (key === 'addSubCat') {
      return addSubCat(safeEvent(domEvent), item)
    }
    if (key === 'toggleFavorite') {
      return toggleFavorite(safeEvent(domEvent), item)
    }
    if (key === 'duplicate') {
      return duplicateItem(safeEvent(domEvent), item)
    }
    if (key === 'move') {
      return openMoveModal(safeEvent(domEvent), item, isGroup)
    }
    if (key === 'copyPublicInfo') {
      return copy(formatBookmarkPublicInfo(item))
    }
    if (key === 'delete' && confirmDelete()) {
      return del(item, safeEvent(domEvent))
    }
  }

  const contextMenuItems = buildBookmarkContextMenuItems({
    item,
    isGroup,
    staticList
  })
  const dropdownProps = {
    menu: {
      items: contextMenuItems,
      onClick: onContextMenuAction
    },
    trigger: ['contextMenu']
  }

  if (!isGroup) {
    const content = (
      <>
        <TreeListItem {...itemProps} />
        <TreeItemOp
          item={item}
          isGroup={isGroup}
          staticList={staticList}
          del={del}
          openAll={openAll}
          openMoveModal={openMoveModal}
          editItem={editItem}
          addSubCat={addSubCat}
          toggleFavorite={toggleFavorite}
          duplicateItem={duplicateItem}
        />
      </>
    )
    return (
      <div
        className={`tree-list-row${isHidden ? ' is-hidden' : ''}`}
        style={{ paddingLeft: depth * treeLevelIndent }}
      >
        <Dropdown {...dropdownProps}>
          <div className='tree-list-row-context-menu-wrap'>
            {content}
          </div>
        </Dropdown>
      </div>
    )
  }

  const groupContent = (
    <div className='tree-list-row-group'>
      <TreeExpander
        level={parentId}
        group={item}
        hasChildren={groupHasChildren}
        shouldOpen={isGroupExpanded}
        onExpand={handleExpand}
        onUnExpand={handleUnExpand}
      />
      <TreeListItem {...itemProps} />
      <TreeItemOp
        item={item}
        isGroup={isGroup}
        staticList={staticList}
        del={del}
        openAll={openAll}
        openMoveModal={openMoveModal}
        editItem={editItem}
        addSubCat={addSubCat}
        toggleFavorite={toggleFavorite}
        duplicateItem={duplicateItem}
      />
    </div>
  )

  return (
    <div
      className={`tree-list-row${isHidden ? ' is-hidden' : ''}`}
      style={{ paddingLeft: Math.max(0, (depth - 1) * treeLevelIndent) }}
    >
      <Dropdown {...dropdownProps}>
        <div className='tree-list-row-context-menu-wrap'>
          {groupContent}
        </div>
      </Dropdown>
    </div>
  )
}
