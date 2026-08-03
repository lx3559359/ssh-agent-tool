/**
 * Simple drawer component without animation
 * Replaces antd Drawer for better performance
 */

import classnames from 'classnames'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDialogBackgroundIsolation } from '../../common/dialog-background-isolation.js'
import './drawer.styl'

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

export default function Drawer (props) {
  const {
    open,
    placement = 'left',
    size,
    zIndex = 1000,
    className,
    title,
    children,
    styles = {},
    onClose
  } = props
  const overlayRef = useRef(null)
  const contentRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  onCloseRef.current = onClose
  useDialogBackgroundIsolation(open, overlayRef)

  function handleMaskClick (e) {
    if (e.target === e.currentTarget && onClose) {
      onClose()
    }
  }

  useEffect(() => {
    if (!open) return undefined
    const previouslyFocused = document.activeElement
    const content = contentRef.current
    const handleKeyDown = (event) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        if (onCloseRef.current) {
          onCloseRef.current()
          event.preventDefault()
        }
        return
      }
      if (event.key !== 'Tab') return
      const focusable = getFocusableElements(content)
      if (!focusable.length) {
        event.preventDefault()
        content?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !content?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const initialFocus = getFocusableElements(content)[0] || content
    initialFocus?.focus()
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [open])

  if (!open) {
    return null
  }

  const drawerStyle = {
    zIndex
  }

  const contentStyle = {
    width: typeof size === 'number' ? `${size}px` : size,
    ...styles.content
  }

  const cls = classnames(
    'custom-drawer',
    `custom-drawer-${placement}`,
    className
  )

  return createPortal((
    <div ref={overlayRef} className={cls} style={drawerStyle}>
      <div
        className='custom-drawer-mask'
        onClick={handleMaskClick}
      />
      <div
        ref={contentRef}
        className='custom-drawer-content-wrapper'
        style={contentStyle}
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div id={titleId} className='custom-drawer-title'>
          {title || e('setting')}
        </div>
        <div className='custom-drawer-content'>
          {children}
        </div>
      </div>
    </div>
  ), document.body)
}
