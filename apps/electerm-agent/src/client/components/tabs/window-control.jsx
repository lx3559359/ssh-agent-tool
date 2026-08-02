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
      <button
        type='button'
        className='window-control-box window-control-minimize'
        aria-label={e('minimize')}
        title={e('minimize')}
        onClick={minimize}
      >
        <MinusOutlined aria-hidden='true' className='iblock font12 widnow-control-icon' />
      </button>
      <button
        type='button'
        className='window-control-box window-control-maximize'
        aria-label={e(isMaximized ? 'unmaximize' : 'maximize')}
        title={e(isMaximized ? 'unmaximize' : 'maximize')}
        onClick={
          isMaximized ? unmaximize : maximize
        }
      >
        {
          isMaximized
            ? <FullscreenExitOutlined aria-hidden='true' className='iblock font13 widnow-control-icon' />
            : <FullscreenOutlined aria-hidden='true' className='iblock font13 widnow-control-icon' />
        }
      </button>
      <button
        type='button'
        className='window-control-box window-control-close'
        aria-label={e('close')}
        title={e('close')}
        onClick={closeApp}
      >
        <CloseOutlined aria-hidden='true' className='iblock font12 widnow-control-icon' />
      </button>
    </div>
  )
})
