import { LoadingOutlined } from '@ant-design/icons'

const e = window.translate

export default function AIStopIcon (props) {
  return (
    <div
      className='ai-stop-icon-square mg1l pointer'
      onClick={props.onClick}
      title={props.title || e('shellpilotAiStopRequest')}
    >
      <LoadingOutlined spin />
    </div>
  )
}
