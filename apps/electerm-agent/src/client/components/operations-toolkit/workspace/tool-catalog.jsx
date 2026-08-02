import { Empty, Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'

const e = window.translate

export function handleListboxOptionKeyDown (event, values, index, onSelect) {
  const lastIndex = values.length - 1
  let nextIndex = index
  if (['ArrowLeft', 'ArrowUp'].includes(event.key)) {
    nextIndex = index > 0 ? index - 1 : lastIndex
  } else if (['ArrowRight', 'ArrowDown'].includes(event.key)) {
    nextIndex = index < lastIndex ? index + 1 : 0
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = lastIndex
  } else {
    return
  }
  event.preventDefault()
  const listbox = event.currentTarget.parentElement
  onSelect(values[nextIndex])
  window.requestAnimationFrame(() => {
    listbox?.querySelectorAll('[role="option"]')[nextIndex]?.focus()
  })
}

export default function ToolCatalog ({
  tools,
  selectedToolId,
  keyword,
  category,
  onKeywordChange,
  onCategoryChange,
  onSelect,
  searchPlaceholder,
  modeLabel
}) {
  const categories = ['全部', ...new Set(tools.map(tool => tool.category))]
  const query = keyword.trim().toLowerCase()
  const visible = tools.filter(tool => {
    const matchesCategory = category === '全部' || tool.category === category
    const text = `${tool.title} ${tool.description} ${tool.category}`.toLowerCase()
    return matchesCategory && (!query || text.includes(query))
  })
  const visibleToolIds = visible.map(tool => tool.id)
  const activeVisibleToolId = visibleToolIds.includes(selectedToolId)
    ? selectedToolId
    : visibleToolIds[0]
  return (
    <aside className='operations-catalog'>
      <Input
        aria-label={searchPlaceholder || e('shellpilotOperationsSearch')}
        allowClear
        prefix={<SearchOutlined aria-hidden='true' />}
        value={keyword}
        onChange={event => onKeywordChange(event.target.value)}
        placeholder={searchPlaceholder || e('shellpilotOperationsSearch')}
      />
      <div
        aria-label={e('shellpilotOperationsCategories')}
        className='operations-categories'
        role='listbox'
      >
        {categories.map((item, index) => (
          <button
            aria-selected={item === category}
            className={item === category ? 'active' : ''}
            key={item}
            onClick={() => onCategoryChange(item)}
            onKeyDown={event => handleListboxOptionKeyDown(event, categories, index, onCategoryChange)}
            role='option'
            tabIndex={item === category ? 0 : -1}
            type='button'
          >
            {item}
          </button>
        ))}
      </div>
      <div
        aria-label={e('shellpilotOperationsTools')}
        className='operations-tool-list'
        role='listbox'
      >
        {visible.map((tool, index) => (
          <button
            aria-selected={tool.id === selectedToolId}
            className={tool.id === selectedToolId ? 'active' : ''}
            key={tool.id}
            onClick={() => onSelect(tool.id)}
            onKeyDown={event => handleListboxOptionKeyDown(event, visibleToolIds, index, onSelect)}
            role='option'
            tabIndex={tool.id === activeVisibleToolId ? 0 : -1}
            type='button'
          >
            <strong>{tool.title}</strong>
            <span>{tool.description}</span>
            <small>
              {tool.category} · {modeLabel || e('shellpilotOperationsReadonly')}
            </small>
          </button>
        ))}
        {!visible.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={e('shellpilotOperationsNoMatches')} /> : null}
      </div>
    </aside>
  )
}
