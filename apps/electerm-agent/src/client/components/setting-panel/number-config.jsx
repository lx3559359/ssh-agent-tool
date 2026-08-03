import InputNumberConfirm from '../common/input-number-confirm'
import { isNumber, isNaN } from 'lodash-es'
import { useId } from 'react'

export default function NumberConfig ({
  min,
  max,
  cls,
  title = '',
  value,
  defaultValue,
  onChange,
  step,
  extraDesc,
  width = 136
}) {
  const generatedId = useId().replace(/:/g, '')
  const helpId = title || extraDesc
    ? `setting-number-${generatedId}-help`
    : undefined
  const description = [title, extraDesc].filter(Boolean).join(' · ')
  const opts = {
    step,
    value,
    min,
    max,
    onChange,
    placeholder: defaultValue
  }
  if (title) {
    opts.formatter = v => `${description}: ${v}`
    opts.parser = (v) => {
      let vv = isNumber(v)
        ? v
        : Number(v.split(': ')[1], 10)
      if (isNaN(vv)) {
        vv = defaultValue
      }
      return vv
    }
    opts.style = {
      width: width + 'px'
    }
  }
  return (
    <div className={`pd2b ${cls || ''}`}>
      <InputNumberConfirm
        {...opts}
        aria-describedby={helpId}
        aria-label={title}
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={value}
      />
      {helpId
        ? <small className='setting-number-help' id={helpId}>{description}</small>
        : null}
    </div>
  )
}
