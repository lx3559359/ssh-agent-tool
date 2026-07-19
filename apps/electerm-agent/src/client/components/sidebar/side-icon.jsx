import classNames from 'classnames'

export default function SideIcon (props) {
  const {
    show,
    className,
    title = '',
    label,
    active,
    onClick,
    children
  } = props
  if (show === false) {
    return null
  }
  const cls = classNames(className, 'control-icon-wrap', {
    active
  })
  return (
    <button
      type='button'
      className={cls}
      title={title}
      onClick={onClick}
    >
      <span className='control-icon-main'>
        {children}
        {
          label
            ? <span className='control-icon-label'>{label}</span>
            : null
        }
      </span>
    </button>
  )
}
