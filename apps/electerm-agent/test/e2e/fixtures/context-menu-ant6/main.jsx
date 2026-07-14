import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Dropdown, Popover, Table } from 'antd'
import {
  ArrowRightOutlined,
  CopyOutlined,
  DeleteOutlined,
  FolderOpenOutlined
} from '@ant-design/icons'
import '../../../../src/client/components/common/context-menu.styl'
import '../../../../src/client/components/sidebar/transfer.styl'
import '../../../../src/client/components/sidebar/transfer-history.styl'

const longLabel = '复制一个非常非常长的路径名称-with-an-unbroken-segment-that-must-wrap-cleanly'

function SemanticLabel ({ testId, children }) {
  return <span data-testid={testId}>{children}</span>
}

function App () {
  const [menuOpen, setMenuOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [lastAction, setLastAction] = useState('none')

  const submenuChildren = useMemo(() => {
    return Array.from({ length: 30 }, (_, index) => ({
      key: `submenu-${index}`,
      label: (
        <SemanticLabel testId={`submenu-child-${index}`}>
          子菜单操作 {index + 1}
        </SemanticLabel>
      )
    }))
  }, [])

  const items = useMemo(() => [
    {
      key: 'normal',
      icon: <CopyOutlined data-testid='normal-icon' />,
      label: <SemanticLabel testId='normal-label'>{longLabel}</SemanticLabel>,
      extra: <span data-testid='normal-shortcut'>Ctrl+C</span>
    },
    {
      type: 'divider'
    },
    {
      key: 'danger',
      danger: true,
      icon: <DeleteOutlined />,
      label: <SemanticLabel testId='danger-label'>删除连接</SemanticLabel>
    },
    {
      key: 'disabled',
      disabled: true,
      icon: <FolderOpenOutlined />,
      label: <SemanticLabel testId='disabled-label'>不可用操作</SemanticLabel>
    },
    {
      key: 'more',
      icon: <ArrowRightOutlined />,
      label: <SemanticLabel testId='submenu-label'>更多操作</SemanticLabel>,
      popupClassName: 'shellpilot-context-menu',
      children: submenuChildren
    }
  ], [submenuChildren])

  const columns = useMemo(() => {
    return Array.from({ length: 10 }, (_, index) => ({
      title: `传输记录字段 ${index + 1}`,
      dataIndex: `field${index}`,
      key: `field${index}`,
      width: 150
    }))
  }, [])

  const dataSource = useMemo(() => {
    return Array.from({ length: 4 }, (_, row) => {
      const record = { key: row }
      columns.forEach((column, columnIndex) => {
        record[column.dataIndex] = `记录 ${row + 1}-${columnIndex + 1}`
      })
      return record
    })
  }, [columns])

  const menu = {
    items,
    onClick: ({ key }) => {
      setLastAction(key)
      setMenuOpen(false)
    }
  }

  const transferContent = (
    <div className='transfer-fixture-content' data-testid='transfer-content'>
      <Table
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        size='small'
        scroll={{ x: 1500 }}
      />
    </div>
  )

  return (
    <main data-fixture-ready='true'>
      <div className='fixture-controls'>
        <Dropdown
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={['click']}
          placement='bottomLeft'
          autoAdjustOverflow
          classNames={{ root: 'shellpilot-context-menu' }}
          menu={menu}
        >
          <button
            className='fixture-trigger'
            data-testid='menu-trigger'
            type='button'
          >
            打开菜单
          </button>
        </Dropdown>

        <Popover
          open={transferOpen}
          onOpenChange={setTransferOpen}
          trigger='click'
          placement='bottomLeft'
          autoAdjustOverflow
          destroyOnHidden
          classNames={{
            root: 'transfer-list-card shellpilot-context-menu shellpilot-transfer-history-popover'
          }}
          content={transferContent}
        >
          <button
            className='fixture-trigger'
            data-testid='transfer-trigger'
            type='button'
          >
            打开传输记录
          </button>
        </Popover>
      </div>

      <output className='fixture-status' data-testid='last-action'>
        {lastAction}
      </output>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<App />)
