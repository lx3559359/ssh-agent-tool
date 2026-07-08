import React, { memo, useRef } from 'react'
import DragHandle from '../common/drag-handle'
import './right-side-panel.styl'
import {
  CloseCircleOutlined,
  PushpinOutlined,
  InfoCircleOutlined
} from '@ant-design/icons'
import {
  Typography,
  Flex,
  Tag
} from 'antd'

export default memo(function RightSidePanel (
  {
    rightPanelVisible,
    rightPanelPinned,
    rightPanelWidth,
    children,
    title,
    rightPanelTab,
    config = {}
  }
) {
  const panelRef = useRef(null)

  if (!rightPanelVisible) {
    return null
  }
  const isAI = rightPanelTab === 'ai'
  const tag = isAI
    ? <Tag className='mg1r aigshell-ai-tag'>AI</Tag>
    : <InfoCircleOutlined className='mg1r' />

  function onDragEnd (nw) {
    window.store.setRightSidePanelWidth(nw)
  }

  function onDragMove (nw) {
    if (panelRef.current) {
      panelRef.current.style.width = nw + 'px'
    }
  }

  function onClose () {
    window.store.rightPanelVisible = false
  }

  function togglePin () {
    window.store.rightPanelPinned = !window.store.rightPanelPinned
  }

  const panelProps = {
    className: 'right-side-panel animate-fast' + (rightPanelPinned ? ' right-side-panel-pinned' : ''),
    ref: panelRef,
    style: {
      width: `${rightPanelWidth}px`
    }
  }

  const pinProps = {
    className: 'right-side-panel-pin right-side-panel-controls' + (rightPanelPinned ? ' pinned' : ''),
    onClick: togglePin
  }
  const dragProps = {
    min: 400,
    max: 1000,
    width: rightPanelWidth,
    onDragEnd,
    onDragMove,
    left: false
  }
  return (
    <div
      {...panelProps}
    >
      <DragHandle {...dragProps} />
      <Flex className='right-panel-title pd2' justify='space-between' align='center'>
        <div className='right-panel-title-main'>
          <Typography.Text className='right-panel-title-text' ellipsis>
            {tag} {isAI ? 'AI 助手' : title}
          </Typography.Text>
          {
            isAI
              ? (
                <div className='right-panel-subtitle'>
                  {config.nameAI || title || '自定义模型'} / {config.modelAI || '未配置模型'}
                </div>
                )
              : null
          }
        </div>
        <Flex>
          {
            isAI
              ? <Tag className='right-panel-online'>在线</Tag>
              : null
          }
          <PushpinOutlined
            {...pinProps}
          />
          <CloseCircleOutlined
            className='right-side-panel-close right-side-panel-controls mg1l'
            onClick={onClose}
          />
        </Flex>
      </Flex>
      <div className='right-side-panel-content'>
        {children}
      </div>
    </div>
  )
})
