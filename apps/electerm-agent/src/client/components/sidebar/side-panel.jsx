import { useCallback, useRef } from 'react'
import DragHandle from '../common/drag-handle'

export default function SidePanel (props) {
  const panelRef = useRef(null)

  const onDragEnd = useCallback((nw) => {
    props.setLeftSidePanelWidth(nw)
    window.store.onResize()
  }, [props])

  const {
    visible,
    width,
    maxWidth
  } = props.shellGeometry.leftPanel
  const dragProps = {
    min: Math.min(300, maxWidth),
    max: maxWidth,
    width,
    onDragEnd,
    left: true
  }
  return (
    <div
      {...props.sideProps}
      ref={panelRef}
      draggable={false}
    >
      {
        visible && maxWidth > 0
          ? <DragHandle {...dragProps} />
          : null
      }
      {props.children}
    </div>
  )
}
