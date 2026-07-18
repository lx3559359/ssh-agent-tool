/**
 * Simple modal component without animation
 * Replaces antd Modal for better performance
 */

import { CloseOutlined } from '@ant-design/icons'
import classnames from 'classnames'
import React, { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { resolveShellPilotModalCopy } from '../../common/shellpilot-i18n-overrides.js'
import './modal.styl'

function getFocusableElements (container) {
  if (!container) return []
  return [...container.querySelectorAll([
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(','))].filter(element => (
    element.getAttribute('aria-hidden') !== 'true' &&
    element.offsetParent !== null
  ))
}

export default function Modal (props) {
  const {
    open,
    title,
    width = 520,
    zIndex = 1000,
    className,
    wrapClassName,
    children,
    footer,
    maskClosable = true,
    keyboardConfirm = true,
    onCancel
  } = props
  const contentRef = useRef(null)

  function handleMaskClick (e) {
    if (e.target === e.currentTarget && maskClosable && onCancel) {
      onCancel()
    }
  }

  function handleClose () {
    if (onCancel) {
      onCancel()
    }
  }

  useEffect(() => {
    if (!open) return undefined
    const previouslyFocused = document.activeElement
    const content = contentRef.current

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (onCancel) {
          onCancel()
          e.preventDefault()
        }
      } else if (e.key === 'Tab') {
        const focusable = getFocusableElements(content)
        if (!focusable.length) {
          e.preventDefault()
          content?.focus()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || !content?.contains(active))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      } else if (keyboardConfirm && (e.key === 'Enter' || e.key === ' ')) {
        // For confirm, Enter/Space confirms
        const okBtn = document.querySelector('.custom-modal-ok-btn')
        if (okBtn) {
          okBtn.click()
          e.preventDefault()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const initialFocus = getFocusableElements(content)[0] || content
    initialFocus?.focus()
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [keyboardConfirm, open, onCancel])

  if (!open) {
    return null
  }

  const modalStyle = {
    zIndex
  }

  const contentStyle = {
    width: typeof width === 'number' ? `${width}px` : width
  }

  const cls = classnames(
    'custom-modal-wrap',
    wrapClassName,
    className
  )

  return (
    <div className={cls} style={modalStyle}>
      <div
        className='custom-modal-mask'
        onClick={handleMaskClick}
      />
      <div className='custom-modal-container' onClick={handleMaskClick}>
        <div
          ref={contentRef}
          className='custom-modal-content'
          style={contentStyle}
          role='dialog'
          aria-modal='true'
          aria-label={typeof title === 'string' ? title : undefined}
          tabIndex={-1}
        >
          {title && (
            <div className='custom-modal-header'>
              <div className='custom-modal-title'>{title}</div>
              <button
                type='button'
                className='custom-modal-close'
                onClick={handleClose}
              >
                <CloseOutlined />
              </button>
            </div>
          )}
          <div className='custom-modal-body'>
            {children}
          </div>
          {footer !== null && footer !== undefined && (
            <div className='custom-modal-footer'>
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

Modal.displayName = 'Modal'

function createModalInstance (type, options) {
  const modalCopy = resolveShellPilotModalCopy(options, window.translate)
  const {
    title,
    content,
    onOk,
    onCancel,
    ...rest
  } = options
  const { okText, cancelText } = modalCopy

  const container = document.createElement('div')
  document.body.appendChild(container)

  const root = createRoot(container)

  const destroy = () => {
    if (root && container && container.parentNode) {
      root.unmount()
      document.body.removeChild(container)
    }
  }

  const handleOk = () => {
    if (onOk) {
      onOk()
    }
    destroy()
  }

  const handleCancel = () => {
    if (onCancel) {
      onCancel()
    }
    destroy()
  }

  const hasCancel = type === 'confirm'

  const footer = (
    <div className='custom-modal-footer-buttons'>
      {hasCancel && (
        <button
          type='button'
          className='custom-modal-cancel-btn'
          onClick={handleCancel}
        >
          {cancelText}
        </button>
      )}
      <button
        type='button'
        className='custom-modal-ok-btn'
        onClick={handleOk}
      >
        {okText}
      </button>
    </div>
  )

  const modalProps = {
    ...rest,
    title,
    open: true,
    onCancel: hasCancel ? handleCancel : destroy,
    footer,
    children: content
  }

  root.render(<Modal {...modalProps} />)

  const update = (newOptions) => {
    const updatedOptions = { ...options, ...newOptions }
    const updatedCopy = resolveShellPilotModalCopy(updatedOptions, window.translate)
    const {
      title: newTitle,
      content: newContent,
      onOk: newOnOk,
      onCancel: newOnCancel,
      ...newRest
    } = updatedOptions
    const {
      okText: newOkText,
      cancelText: newCancelText
    } = updatedCopy

    const newHandleOk = () => {
      if (newOnOk) {
        newOnOk()
      }
      destroy()
    }

    const newHandleCancel = () => {
      if (newOnCancel) {
        newOnCancel()
      }
      destroy()
    }

    const newFooter = (
      <div className='custom-modal-footer-buttons'>
        {hasCancel && (
          <button
            type='button'
            className='custom-modal-cancel-btn'
            onClick={newHandleCancel}
          >
            {newCancelText}
          </button>
        )}
        <button
          type='button'
          className='custom-modal-ok-btn'
          onClick={newHandleOk}
        >
          {newOkText}
        </button>
      </div>
    )

    const newModalProps = {
      ...newRest,
      title: newTitle,
      open: true,
      onCancel: hasCancel ? newHandleCancel : destroy,
      footer: newFooter,
      children: newContent
    }

    root.render(<Modal {...newModalProps} />)
  }

  return {
    destroy,
    update
  }
}

Modal.info = (options) => {
  return createModalInstance('info', options)
}

Modal.confirm = (options) => {
  return createModalInstance('confirm', options)
}
