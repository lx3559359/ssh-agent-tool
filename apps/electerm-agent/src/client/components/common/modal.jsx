/**
 * Simple modal component without animation
 * Replaces antd Modal for better performance
 */

import { CloseOutlined } from '@ant-design/icons'
import classnames from 'classnames'
import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { useDialogBackgroundIsolation } from '../../common/dialog-background-isolation.js'
import { resolveShellPilotModalCopy } from '../../common/shellpilot-i18n-overrides.js'
import './modal.styl'

const e = window.translate

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
    initialFocusSelector,
    onCancel
  } = props
  const overlayRef = useRef(null)
  const contentRef = useRef(null)
  const onCancelRef = useRef(onCancel)
  const keyboardConfirmRef = useRef(keyboardConfirm)
  const titleId = useId()
  onCancelRef.current = onCancel
  keyboardConfirmRef.current = keyboardConfirm
  useDialogBackgroundIsolation(open, overlayRef)

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
        if (onCancelRef.current) {
          onCancelRef.current()
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
      } else if (keyboardConfirmRef.current && (e.key === 'Enter' || e.key === ' ')) {
        // For confirm, Enter/Space confirms
        const okBtn = content?.querySelector('.custom-modal-ok-btn')
        if (okBtn) {
          okBtn.click()
          e.preventDefault()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const requestedFocus = initialFocusSelector
      ? content?.querySelector(initialFocusSelector)
      : null
    const initialFocus = requestedFocus || getFocusableElements(content)[0] || content
    initialFocus?.focus()
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [open])

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

  return createPortal((
    <div ref={overlayRef} className={cls} style={modalStyle}>
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
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          {title && (
            <div className='custom-modal-header'>
              <div id={titleId} className='custom-modal-title'>{title}</div>
              <button
                type='button'
                className='custom-modal-close'
                aria-label={e('shellpilotCloseDialog')}
                onClick={handleClose}
              >
                <CloseOutlined aria-hidden='true' />
              </button>
            </div>
          )}
          {!title && (
            <div id={titleId} className='custom-modal-accessible-title'>
              {e('shellpilotDialog')}
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
  ), document.body)
}

Modal.displayName = 'Modal'

function createModalInstance (type, options) {
  let currentOptions = options
  const modalCopy = resolveShellPilotModalCopy(currentOptions, window.translate)
  const {
    title,
    content,
    onOk,
    onCancel,
    okButtonProps,
    closeOnOk = true,
    ...rest
  } = currentOptions
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
    if (closeOnOk) destroy()
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
        className={classnames('custom-modal-ok-btn', {
          'is-danger': okButtonProps?.danger
        })}
        disabled={okButtonProps?.disabled}
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
    currentOptions = { ...currentOptions, ...newOptions }
    const updatedOptions = currentOptions
    const updatedCopy = resolveShellPilotModalCopy(updatedOptions, window.translate)
    const {
      title: newTitle,
      content: newContent,
      onOk: newOnOk,
      onCancel: newOnCancel,
      okButtonProps: newOkButtonProps,
      closeOnOk: newCloseOnOk = closeOnOk,
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
      if (newCloseOnOk) destroy()
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
          className={classnames('custom-modal-ok-btn', {
            'is-danger': newOkButtonProps?.danger
          })}
          disabled={newOkButtonProps?.disabled}
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
