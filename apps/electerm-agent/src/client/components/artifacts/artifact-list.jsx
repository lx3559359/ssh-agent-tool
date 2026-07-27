import { auto } from 'manate/react'
import { Empty, Input, Select, Spin, Tag } from 'antd'
import { FileTextOutlined, SearchOutlined } from '@ant-design/icons'

const e = window.translate

const formatLabel = format => String(format || '').toUpperCase()

function availableFormats (artifact) {
  const version = (artifact.versions || []).find(
    item => item.version === artifact.version
  )
  return (version?.formats || []).map(item => (
    typeof item === 'string' ? item : item?.format
  )).filter(Boolean)
}

export default auto(function ArtifactList ({ store }) {
  const items = store.artifactItems || []
  const filters = store.artifactFilters || {}
  const serverOptions = [...new Set(items.map(item => item.server).filter(Boolean))]
    .map(server => ({ label: server, value: server }))

  const updateFilter = (key, value) => {
    store.loadArtifacts({ [key]: value || '' })
  }

  return (
    <aside className='artifact-list-panel' aria-label={e('shellpilotArtifactList')}>
      <div className='artifact-list-filters'>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          value={filters.query}
          placeholder={e('shellpilotArtifactSearchTitle')}
          onChange={event => updateFilter('query', event.target.value)}
        />
        <Select
          allowClear
          value={filters.server || undefined}
          placeholder={e('shellpilotArtifactAllServers')}
          options={serverOptions}
          onChange={value => updateFilter('server', value)}
        />
        <Select
          allowClear
          value={filters.format || undefined}
          placeholder={e('shellpilotArtifactAllFormats')}
          options={[
            { label: 'Markdown', value: 'md' },
            { label: e('shellpilotArtifactFormatCsv'), value: 'csv' },
            { label: e('shellpilotArtifactFormatWord'), value: 'docx' },
            { label: e('shellpilotArtifactFormatExcel'), value: 'xlsx' },
            { label: e('shellpilotArtifactFormatPdf'), value: 'pdf' },
            { label: e('shellpilotArtifactWebFormat'), value: 'html' }
          ]}
          onChange={value => updateFilter('format', value)}
        />
      </div>
      <Spin spinning={store.artifactLoading}>
        <div className='artifact-list-items'>
          {items.length
            ? items.map(item => {
              const active = store.activeArtifactId === item.id
              const formats = availableFormats(item)
              return (
                <button
                  type='button'
                  key={item.id}
                  className={`artifact-list-item${active ? ' active' : ''}`}
                  onClick={() => store.selectArtifact(item.id)}
                >
                  <FileTextOutlined />
                  <span className='artifact-list-item-copy'>
                    <strong title={item.title}>{item.title}</strong>
                    <small>{item.server || e('shellpilotArtifactUnlinkedServer')}</small>
                  </span>
                  <span className='artifact-list-item-formats'>
                    {formats.slice(0, 2).map(format => (
                      <Tag key={format}>{formatLabel(format)}</Tag>
                    ))}
                  </span>
                </button>
              )
            })
            : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={e('shellpilotArtifactEmpty')}
              />
              )}
        </div>
      </Spin>
    </aside>
  )
})
