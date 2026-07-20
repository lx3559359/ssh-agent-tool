/**
 * when in alternate buffer, user press cmd + arrow up to open normal buffer content
 */

import { CloseCircleOutlined } from '@ant-design/icons'
import { memo } from 'react'

const e = window.translate

export default memo(function NormalBuffer (props) {
  if (!props.lines.length) {
    return null
  }
  const pops = {
    className: 'terminal-normal-buffer-close',
    onClick: props.close
  }
  return (
    <div className='terminal-normal-buffer'>
      <div className='terminal-normal-buffer-body'>
        {props.lines.map((d, i) => (<div key={`${i}-nmb`}>{d}</div>))}
      </div>
      <div className='terminal-normal-buffer-footer fix'>
        <span className='fleft pd1l'>
          {e('shellpilotNormalBufferContent')}
        </span>
        <span className='fright pd1r'>
          <CloseCircleOutlined
            {...pops}
          />
        </span>
      </div>
    </div>
  )
})
