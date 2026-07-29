import { auto } from 'manate/react'
import { useEffect } from 'react'
import { AlertOutlined, RightOutlined } from '@ant-design/icons'
import './incidents.styl'

const e = window.translate

export default auto(function IncidentHomeSummary ({ store }) {
  useEffect(() => {
    store.loadIncidentSummary()
  }, [])

  const summary = store.incidentSummary
  if (!summary?.unresolvedCount) return null
  const recentUnresolved = summary.recentUnresolved || []

  return (
    <section className='incident-home-summary'>
      <header>
        <span>
          <AlertOutlined />
          <strong>{e('shellpilotIncidentHomeTitle')}</strong>
        </span>
        <button
          type='button'
          onClick={() => store.openIncidentArchiveWorkspace()}
        >
          {e('shellpilotIncidentViewAll')}
          <RightOutlined />
        </button>
      </header>
      <div className='incident-home-summary-body'>
        <strong>{summary.unresolvedCount}</strong>
        <span>{e('shellpilotIncidentUnresolved')}</span>
        <div>
          {recentUnresolved.map(incident => (
            <button
              key={incident.id}
              type='button'
              onClick={() => store.openIncidentArchiveWorkspace(incident.id)}
            >
              <span>{incident.title}</span>
              <small>{incident.endpointLabel || e('unknown')}</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
})
