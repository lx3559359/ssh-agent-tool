import { memo } from 'react'
import {
  SwapOutlined
} from '@ant-design/icons'
import {
  Badge,
  Popover
} from 'antd'
import TransferModal from './transfer-modal'
import './transfer.styl'

const e = window.translate

export default memo(function TransferList (props) {
  const {
    fileTransfers,
    transferTab,
    transferHistory,
    active,
    onOpenSftp
  } = props
  const len = fileTransfers.length
  const color = fileTransfers.some(item => item.error) ? 'red' : 'green'
  const bdProps = {
    count: len,
    size: 'small',
    offset: [-10, -5],
    color,
    overflowCount: 99
  }
  const transferModalProps = {
    fileTransfers,
    transferHistory,
    transferTab
  }
  const popProps = {
    placement: 'right',
    trigger: 'contextMenu',
    destroyOnHidden: true,
    overlayClassName: 'transfer-list-card shellpilot-context-menu shellpilot-transfer-history-popover',
    content: <TransferModal {...transferModalProps} />
  }
  return (
    <Popover
      {...popProps}
    >
      <button
        type='button'
        className={`control-icon-wrap${active ? ' active' : ''}`}
        onClick={onOpenSftp}
        title={e('shellpilotSftpFileManagerHint')}
      >
        <span className='control-icon-main'>
          <Badge
            {...bdProps}
          >
            <SwapOutlined
              className='iblock font20 control-icon'
            />
          </Badge>
          <span className='control-icon-label'>SFTP</span>
        </span>
      </button>
    </Popover>
  )
})
