import { ColorPicker } from '../bookmark-form/common/color-picker'

const e = window.translate

export default function ThemeEditSlot (props) {
  const {
    name,
    label,
    value,
    disabled,
    locked
  } = props
  function onChange (v) {
    props.onChange(v, name)
  }
  const pickerProps = {
    value,
    onChange,
    isRgba: value.startsWith('rgba'),
    disabled
  }
  return (
    <div className='theme-edit-slot'>
      <span className='theme-edit-slot-label'>{label}</span>
      <span className='theme-edit-slot-picker'>
        <ColorPicker
          {...pickerProps}
        />
      </span>
      {
        locked
          ? <span className='theme-edit-slot-lock'>{e('terminalBackgroundLocked')}</span>
          : null
      }
    </div>
  )
}
