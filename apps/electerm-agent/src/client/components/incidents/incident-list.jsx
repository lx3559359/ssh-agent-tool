import { useEffect, useMemo, useState } from 'react'
import classnames from 'classnames'
import {
  Button,
  DatePicker,
  Empty,
  Input,
  Pagination,
  Select,
  Spin,
  Switch,
  Tag
} from 'antd'
import {
  DatabaseOutlined,
  PlusOutlined,
  SearchOutlined,
  StarFilled
} from '@ant-design/icons'

const e = window.translate
const { RangePicker } = DatePicker

const incidentStates = [
  'investigating',
  'waiting_action',
  'verifying',
  'resolved',
  'unresolved',
  'archived',
  'false_positive'
]

const incidentSeverities = ['critical', 'high', 'medium', 'low']

function uniqueTags (items, property) {
  return [...new Set(
    (items || []).flatMap(item => item[property] || []).filter(Boolean)
  )].sort((left, right) => left.localeCompare(right))
}

function endpointTitle (endpointRef, bookmarks) {
  if (!endpointRef) return e('shellpilotIncidentNoServer')
  const bookmark = (bookmarks || []).find(item => (
    String(item.id || item._id) === String(endpointRef)
  ))
  return bookmark?.title || bookmark?.name || endpointRef
}

function formatIncidentTime (value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function filterOptions (values, prefix) {
  return values.map(value => ({
    value,
    label: prefix ? e(`${prefix}${value}`) : value
  }))
}

export default function IncidentList ({
  store,
  onCreate,
  onOpenStorage,
  onSelect
}) {
  const [search, setSearch] = useState(store.incidentFilters.query || '')
  const serviceTags = useMemo(
    () => uniqueTags(store.incidentItems, 'serviceTags'),
    [store.incidentItems]
  )
  const customTags = useMemo(
    () => uniqueTags(store.incidentItems, 'customTags'),
    [store.incidentItems]
  )
  const bookmarkOptions = useMemo(
    () => (store.bookmarks || []).map((bookmark, index) => ({
      value: String(bookmark.id || bookmark._id || `bookmark-${index}`),
      label: bookmark.title || bookmark.name || bookmark.host || e('unknown')
    })),
    [store.bookmarks]
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      const query = search.trim()
      if (query !== store.incidentFilters.query) {
        store.loadIncidentArchives({ query, page: 1 })
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const updateFilter = (field, value) => {
    store.loadIncidentArchives({ [field]: value, page: 1 })
  }
  const updateRange = (dates) => {
    store.loadIncidentArchives({
      updatedFrom: dates?.[0]?.startOf('day')?.valueOf() || null,
      updatedTo: dates?.[1]?.endOf('day')?.valueOf() || null,
      page: 1
    })
  }

  return (
    <aside className='incident-list-panel'>
      <div className='incident-list-toolbar'>
        <div className='incident-list-primary-actions'>
          <Button
            type='primary'
            icon={<PlusOutlined />}
            onClick={onCreate}
          >
            {e('shellpilotIncidentCreate')}
          </Button>
          <Button
            icon={<DatabaseOutlined />}
            onClick={onOpenStorage}
          >
            {e('shellpilotIncidentStorage')}
          </Button>
        </div>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          value={search}
          placeholder={e('shellpilotIncidentSearchPlaceholder')}
          onChange={event => setSearch(event.target.value)}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp='label'
          value={store.incidentFilters.endpointRef || undefined}
          options={bookmarkOptions}
          placeholder={e('shellpilotIncidentServerFilter')}
          onChange={value => updateFilter('endpointRef', value || '')}
        />
        <div className='incident-list-filter-grid'>
          <Select
            mode='multiple'
            maxTagCount='responsive'
            value={store.incidentFilters.state}
            options={filterOptions(
              incidentStates,
              'shellpilotIncidentState_'
            )}
            placeholder={e('shellpilotIncidentStateFilter')}
            onChange={value => updateFilter('state', value)}
          />
          <Select
            mode='multiple'
            maxTagCount='responsive'
            value={store.incidentFilters.severity}
            options={filterOptions(
              incidentSeverities,
              'shellpilotIncidentSeverity_'
            )}
            placeholder={e('shellpilotIncidentSeverityFilter')}
            onChange={value => updateFilter('severity', value)}
          />
          <Select
            mode='multiple'
            maxTagCount='responsive'
            value={store.incidentFilters.serviceTags}
            options={filterOptions(serviceTags)}
            placeholder={e('shellpilotIncidentServiceFilter')}
            onChange={value => updateFilter('serviceTags', value)}
          />
          <Select
            mode='multiple'
            maxTagCount='responsive'
            value={store.incidentFilters.customTags}
            options={filterOptions(customTags)}
            placeholder={e('shellpilotIncidentTagFilter')}
            onChange={value => updateFilter('customTags', value)}
          />
        </div>
        <RangePicker
          allowEmpty={[true, true]}
          onChange={updateRange}
        />
        <label className='incident-favorite-filter'>
          <Switch
            size='small'
            checked={store.incidentFilters.favoriteOnly}
            onChange={value => updateFilter('favoriteOnly', value)}
          />
          <span>{e('shellpilotIncidentFavoriteOnly')}</span>
        </label>
      </div>

      <div className='incident-list-scroll'>
        <Spin spinning={store.incidentLoading}>
          {store.incidentItems.length
            ? store.incidentItems.map(item => (
              <button
                type='button'
                key={item.id}
                className={classnames('incident-list-item', {
                  active: item.id === store.activeIncidentId
                })}
                onClick={() => (
                  onSelect
                    ? onSelect(item.id)
                    : store.selectIncidentArchive(item.id)
                )}
              >
                <span
                  className={
                    `incident-severity incident-severity-${item.severity}`
                  }
                />
                <span className='incident-list-copy'>
                  <strong title={item.title}>
                    {item.isFavorite && <StarFilled />}
                    {item.title}
                  </strong>
                  <small>
                    {endpointTitle(item.endpointRef, store.bookmarks)}
                  </small>
                  <span>
                    <Tag>
                      {e(`shellpilotIncidentState_${item.state}`)}
                    </Tag>
                    <time>{formatIncidentTime(item.updatedAt)}</time>
                  </span>
                </span>
              </button>
            ))
            : (
              <Empty
                className='incident-list-empty'
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={e('shellpilotIncidentEmpty')}
              />
              )}
        </Spin>
      </div>

      <Pagination
        size='small'
        current={store.incidentPage}
        pageSize={store.incidentPageSize}
        total={store.incidentTotal}
        showSizeChanger
        pageSizeOptions={[20, 40, 80]}
        onChange={(page, pageSize) => store.loadIncidentArchives({
          page,
          pageSize
        })}
      />
    </aside>
  )
}
