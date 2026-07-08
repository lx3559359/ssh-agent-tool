/**
 * btns
 */

import {
  CloseOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  MinusOutlined
} from '@ant-design/icons'
import { auto } from 'manate/react'
import {
  isMacJs
} from '../../common/constants'

const e = window.translate

export default auto(function WindowControl (props) {
  const {
    isMaximized,
    config
  } = props.store
  if (config.useSystemTitleBar || isMacJs) {
    return null
  }
  const minimize = () => {
    window.pre.runGlobalAsync('minimize')
  }
  const maximize = () => {
    window.pre.runGlobalAsync('maximize')
    window.store.isMaximized = true
  }
  const unmaximize = () => {
    window.pre.runGlobalAsync('unmaximize')
    window.store.isMaximized = false
  }
  const closeApp = () => {
    window.store.exit()
  }
  return (
    <div className='window-controls'>
      <div className='window-control-box window-control-minimize' onClick={minimize}>
        <MinusOutlined title={e('minimize')} className='iblock font12 widnow-control-icon' />
      </div>
      <div
        className='window-control-box window-control-maximize'
        onClick={
          isMaximized ? unmaximize : maximize
        }
      >
        {
          isMaximized
            ? <FullscreenExitOutlined title={e('unmaximize')} className='iblock font13 widnow-control-icon' />
            : <FullscreenOutlined title={e('maximize')} className='iblock font13 widnow-control-icon' />
        }
      </div>
      <div className='window-control-box window-control-close' onClick={closeApp}>
        <CloseOutlined title={e('close')} className='iblock font12 widnow-control-icon' />
      </div>
    </div>
  )
})
