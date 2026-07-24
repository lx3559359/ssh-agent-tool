import { useMemo, useRef, useState } from 'react'

const lineHeight = 20
const viewportHeight = 300
const overscan = 10

export default function VirtualLog ({ text = '' }) {
  const [scrollTop, setScrollTop] = useState(0)
  const viewport = useRef(null)
  const lines = useMemo(() => String(text || '').split(/\r?\n/), [text])
  const visibleCount = Math.ceil(viewportHeight / lineHeight)
  const start = Math.max(0, Math.floor(scrollTop / lineHeight) - overscan)
  const end = Math.min(lines.length, start + visibleCount + overscan * 2)
  return (
    <div
      className='operations-virtual-log'
      ref={viewport}
      onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: lines.length * lineHeight, position: 'relative' }}>
        <pre style={{ transform: `translateY(${start * lineHeight}px)` }}>
          {lines.slice(start, end).join('\n')}
        </pre>
      </div>
    </div>
  )
}
