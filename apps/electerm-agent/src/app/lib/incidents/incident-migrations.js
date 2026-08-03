const INCIDENT_MIGRATIONS = Object.freeze([
  {
    version: 1,
    run (db) {
      db.exec(`
        CREATE TABLE incidents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          endpoint_ref TEXT NOT NULL DEFAULT '',
          session_refs_json TEXT NOT NULL DEFAULT '[]',
          state TEXT NOT NULL,
          severity TEXT NOT NULL,
          service_tags_json TEXT NOT NULL DEFAULT '[]',
          custom_tags_json TEXT NOT NULL DEFAULT '[]',
          summary TEXT NOT NULL DEFAULT '',
          root_cause TEXT NOT NULL DEFAULT '',
          resolution TEXT NOT NULL DEFAULT '',
          verification_status TEXT NOT NULL DEFAULT 'pending',
          storage_policy TEXT NOT NULL DEFAULT 'standard',
          is_pinned INTEGER NOT NULL DEFAULT 0,
          is_favorite INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          resolved_at INTEGER,
          archived_at INTEGER
        );
        CREATE TABLE incident_notes (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE incident_state_events (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
          from_state TEXT,
          to_state TEXT NOT NULL,
          verification_status TEXT NOT NULL,
          actor TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_incidents_state_updated
          ON incidents(state, updated_at DESC);
        CREATE INDEX idx_incidents_endpoint_updated
          ON incidents(endpoint_ref, updated_at DESC);
        CREATE INDEX idx_incidents_severity_updated
          ON incidents(severity, updated_at DESC);
        CREATE INDEX idx_incidents_pinned_updated
          ON incidents(is_pinned DESC, updated_at DESC);
        CREATE INDEX idx_incidents_updated
          ON incidents(updated_at DESC);
        CREATE INDEX idx_incident_notes_incident_created
          ON incident_notes(incident_id, created_at DESC);
        CREATE INDEX idx_incident_state_events_incident_created
          ON incident_state_events(incident_id, created_at DESC);
        CREATE VIRTUAL TABLE incident_search USING fts5(
          incident_id UNINDEXED,
          title,
          summary,
          root_cause,
          resolution,
          service_tags,
          custom_tags,
          notes,
          tokenize = 'unicode61'
        );
      `)
    }
  },
  {
    version: 2,
    run (db) {
      db.exec(`
        CREATE TABLE incident_candidates (
          id TEXT PRIMARY KEY,
          fingerprint TEXT NOT NULL UNIQUE,
          source TEXT NOT NULL,
          source_ref TEXT NOT NULL DEFAULT '',
          endpoint_ref TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL,
          severity TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          evidence_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending',
          incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          occurrence_count INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE incident_timeline_events (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          source TEXT NOT NULL,
          source_ref TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL,
          body TEXT NOT NULL DEFAULT '',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_incident_candidates_status_updated
          ON incident_candidates(status, updated_at DESC);
        CREATE INDEX idx_incident_candidates_endpoint_updated
          ON incident_candidates(endpoint_ref, updated_at DESC);
        CREATE INDEX idx_incident_timeline_incident_created
          ON incident_timeline_events(incident_id, created_at ASC, id ASC);
        CREATE UNIQUE INDEX idx_incident_timeline_source
          ON incident_timeline_events(incident_id, kind, source, source_ref)
          WHERE source_ref <> '';
      `)
    }
  }
])

module.exports = {
  CURRENT_INCIDENT_SCHEMA_VERSION: 2,
  INCIDENT_MIGRATIONS
}
