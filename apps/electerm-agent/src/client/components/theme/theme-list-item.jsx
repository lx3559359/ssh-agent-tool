/**
 * theme list render
 */

import {
  PlusOutlined,
  SunOutlined,
  MoonOutlined
} from '@ant-design/icons'
import { Tag } from 'antd'
import classnames from 'classnames'
import { defaultTheme } from '../../common/theme-defaults'
import { getThemeDisplayName } from '../../common/shellpilot-ui-palettes.js'
import highlight from '../common/highlight'
import isColorDark from '../../common/is-color-dark'

const e = window.translate

export default function ThemeListItem (props) {
  const {
    item,
    activeItemId,
    theme,
    keyword
  } = props
  function handleClickTheme () {
    props.onClickItem(item)
  }

  function renderTag () {
    if (!id) {
      return null
    }
    const { main, text } = item.uiThemeConfig || {}
    const isDark = isColorDark(main)
    const txt = isDark ? <MoonOutlined /> : <SunOutlined />
    return (
      <Tag
        color={main}
        className='mg1r'
        variant='solid'
        style={
          {
            color: text
          }
        }
      >
        {txt}
      </Tag>
    )
  }

  const { id, type } = item
  const displayName = getThemeDisplayName(item, e)
  const cls = classnames(
    'item-list-unit theme-item',
    {
      current: theme === id
    },
    {
      active: activeItemId === id
    }
  )
  let title = id === defaultTheme().id
    ? e(id)
    : displayName
  title = highlight(
    title,
    keyword
  )

  return (
    <div
      className={cls}
      onClick={handleClickTheme}
    >
      <div className='elli pd1y pd2x' title={displayName}>
        {
          !id
            ? <PlusOutlined className='mg1r' />
            : null
        }
        {renderTag()}{title}
      </div>
      {
        item.readonly || id === defaultTheme().id || type === 'iterm'
          ? null
          : props.renderDelBtn(item)
      }
    </div>
  )
}
