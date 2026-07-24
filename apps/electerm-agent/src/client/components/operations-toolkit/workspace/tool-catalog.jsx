import { Empty, Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'

export default function ToolCatalog ({
  tools,
  selectedToolId,
  keyword,
  category,
  onKeywordChange,
  onCategoryChange,
  onSelect
}) {
  const categories = ['全部', ...new Set(tools.map(tool => tool.category))]
  const query = keyword.trim().toLowerCase()
  const visible = tools.filter(tool => {
    const matchesCategory = category === '全部' || tool.category === category
    const text = `${tool.title} ${tool.description} ${tool.category}`.toLowerCase()
    return matchesCategory && (!query || text.includes(query))
  })
  return (
    <aside className='operations-catalog'>
      <Input
        allowClear
        prefix={<SearchOutlined />}
        value={keyword}
        onChange={event => onKeywordChange(event.target.value)}
        placeholder='搜索诊断脚本'
      />
      <div className='operations-categories'>
        {categories.map(item => (
          <button
            className={item === category ? 'active' : ''}
            key={item}
            onClick={() => onCategoryChange(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className='operations-tool-list'>
        {visible.map(tool => (
          <button
            className={tool.id === selectedToolId ? 'active' : ''}
            key={tool.id}
            onClick={() => onSelect(tool.id)}
          >
            <strong>{tool.title}</strong>
            <span>{tool.description}</span>
            <small>{tool.category} · 只读</small>
          </button>
        ))}
        {!visible.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='没有匹配的脚本' /> : null}
      </div>
    </aside>
  )
}
