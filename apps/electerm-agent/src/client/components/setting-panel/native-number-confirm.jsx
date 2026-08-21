import { useEffect, useRef, useState } from 'react'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'

const e = window.translate

export default function NativeNumberConfirm ({
  value,
  onChange,
  min,
  max,
  step,
  className,
  ...inputProps
}) {
  const rootRef = useRef(null)
  const [draft, setDraft] = useState(String(value ?? ''))
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(String(value ?? ''))
  }, [value, editing])

  function reset () {
    setDraft(String(value ?? ''))
    setEditing(false)
  }

  function commit () {
    const normalizedDraft = draft.trim()
    const parsedValue = Number(normalizedDraft)
    if (!normalizedDraft) {
      reset()
      return
    }
    if (!Number.isFinite(parsedValue)) {
      reset()
      return
    }
    const boundedValue = Math.min(
      max ?? Number.POSITIVE_INFINITY,
      Math.max(min ?? Number.NEGATIVE_INFINITY, parsedValue)
    )
    setDraft(String(boundedValue))
    setEditing(false)
    onChange(boundedValue)
  }

  function handleBlur (event) {
    if (rootRef.current?.contains(event.relatedTarget)) return
    if (editing) commit()
  }

  function handleKeyDown (event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      reset()
    }
  }

  return (
    <div
      className={`sp-native-number-confirm ${className || ''}`.trim()}
      onBlur={handleBlur}
      ref={rootRef}
    >
      <input
        {...inputProps}
        aria-valuenow={draft.trim() && Number.isFinite(Number(draft))
          ? Number(draft)
          : undefined}
        className='sp-native-number-confirm-input'
        max={max}
        min={min}
        onChange={event => {
          setDraft(event.target.value)
          setEditing(true)
        }}
        onKeyDown={handleKeyDown}
        step={step}
        type='number'
        value={draft}
      />
      {editing
        ? (
          <span className='sp-native-number-confirm-actions'>
            <button
              aria-label={e('ok')}
              onClick={commit}
              onMouseDown={event => event.preventDefault()}
              type='button'
            >
              <CheckOutlined aria-hidden='true' />
            </button>
            <button
              aria-label={e('cancel')}
              onClick={reset}
              onMouseDown={event => event.preventDefault()}
              type='button'
            >
              <CloseOutlined aria-hidden='true' />
            </button>
          </span>
          )
        : null}
    </div>
  )
}
