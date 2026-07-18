import React, { lazy, memo, Suspense, useRef } from 'react'
import DragHandle from '../common/drag-handle'
import LazyModuleBoundary from '../common/lazy-module-boundary'
import './right-side-panel.styl'
import {
  CloseCircleOutlined,
  InfoCircleOutlined,
  PushpinOutlined
} from '@ant-design/icons'
import { Flex, Tag, Typography } from 'antd'
import {
  getMaxRightPanelWidth,
  minRightPanelWidth,
  normalizeRightPanelWidth
} from '../main/aigshell-layout'

const RightSidePanelAIHeader = lazy(() => import('./right-side-panel-ai-header'))

export default memo(function RightSidePanel ({
  rightPanelVisible,
  rightPanelPinned,
  rightPanelWidth,
  children,
  title,
  rightPanelTab,
  config = {}
}) {
  const panelRef = useRef(null)
  const isAI = rightPanelTab === 'ai'

  if (!rightPanelVisible) {
    return null
  }

  const tag = isAI
    ? <Tag className='mg1r aigshell-ai-tag'>AI</Tag>
    : <InfoCircleOutlined className='mg1r' />
  const maxWidth = getMaxRightPanelWidth(window.innerWidth)
  const width = Math.min(normalizeRightPanelWidth(rightPanelWidth), maxWidth)

  function onDragEnd (nextWidth) {
    window.store.setRightSidePanelWidth(nextWidth)
  }

  function onDragMove (nextWidth) {
    if (panelRef.current) {
      panelRef.current.style.width = nextWidth + 'px'
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
    style: { width: `${width}px` }
  }
  const pinProps = {
    className: 'right-side-panel-pin right-side-panel-controls' + (rightPanelPinned ? ' pinned' : ''),
    onClick: togglePin
  }
  const dragProps = {
    min: minRightPanelWidth,
    max: maxWidth,
    width,
    onDragEnd,
    onDragMove,
    left: false
  }

  return (
    <div {...panelProps}>
      <DragHandle {...dragProps} />
      <Flex className='right-panel-title pd2' justify='space-between' align='flex-start'>
        <div className='right-panel-title-main'>
          <Typography.Text className='right-panel-title-text'>
            {tag} {isAI ? '助手' : title}
          </Typography.Text>
          {
            isAI
              ? (
                <LazyModuleBoundary moduleName='AI 模型状态' fallback={<div className='right-panel-subtitle'>{title}</div>}>
                  <Suspense fallback={<div className='right-panel-subtitle'>{title}</div>}>
                    <RightSidePanelAIHeader
                      config={config}
                      rightPanelVisible={rightPanelVisible}
                      title={title}
                    />
                  </Suspense>
                </LazyModuleBoundary>
                )
              : null
          }
        </div>
        <Flex className='right-panel-title-controls' align='center'>
          {
            isAI
              ? (
                <LazyModuleBoundary moduleName='AI 模型状态' fallback={null}>
                  <Suspense fallback={null}>
                    <RightSidePanelAIHeader
                      config={config}
                      rightPanelVisible={rightPanelVisible}
                      variant='status'
                    />
                  </Suspense>
                </LazyModuleBoundary>
                )
              : null
          }
          <PushpinOutlined {...pinProps} />
          <CloseCircleOutlined
            className='right-side-panel-close right-side-panel-controls mg1l'
            onClick={onClose}
          />
        </Flex>
      </Flex>
      <div className={'right-side-panel-content' + (isAI ? ' right-side-panel-content-ai' : '')}>
        {children}
      </div>
    </div>
  )
})
