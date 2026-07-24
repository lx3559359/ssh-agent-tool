import { LoadingOutlined, StopOutlined } from '@ant-design/icons'

const e = window.translate

export default function AIStopIcon (props) {
  const label = props.title || e('shellpilotAiStopRequest')
  return (
    <button
      type='button'
      className='ai-stop-icon-square mg1l'
      onClick={props.onClick}
      title={label}
      aria-label={label}
      disabled={props.stopping}
    >
      {props.stopping ? <LoadingOutlined spin /> : <StopOutlined />}
    </button>
  )
}
