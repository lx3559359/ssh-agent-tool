/**
 * up time info
 */

import { ClockCircleOutlined } from '@ant-design/icons'

const e = window.translate

export default function TerminalInfoUp (props) {
  const { uptime, isRemote, terminalInfos } = props
  if (!isRemote || !terminalInfos.includes('uptime')) {
    return null
  }
  return (
    <div className='terminal-info-section terminal-info-up'>
      <b><ClockCircleOutlined /> {e('shellpilotUptime')}</b>: {uptime}
    </div>
  )
}
