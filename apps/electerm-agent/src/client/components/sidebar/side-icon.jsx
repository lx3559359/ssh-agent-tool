import classNames from 'classnames'

export default function SideIcon (props) {
  const {
    show,
    className,
    title = '',
    label,
    active,
    children
  } = props
  if (show === false) {
    return null
  }
  const cls = classNames(className, 'control-icon-wrap', {
    active
  })
  return (
    <div
      className={cls}
      title={title}
    >
      <div className='control-icon-main'>
        {children}
        {
          label
            ? <span className='control-icon-label'>{label}</span>
            : null
        }
      </div>
    </div>
  )
}
