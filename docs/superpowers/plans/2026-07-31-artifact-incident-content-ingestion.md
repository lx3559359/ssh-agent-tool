# Artifact, Incident, and AI Content Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe artifact/incident deletion, local incident export, and bounded AI analysis for documents, images, and public web pages without changing SSH/SFTP core behavior.

**Architecture:** Extend the existing repository/service/IPC/store layers for deletion and export. Add a main-process content-ingestion service with format adapters, URL safety validation, and bounded normalized results; the renderer submits references and the AI request builder converts normalized content into text or multimodal messages. Existing safety/audit helpers remain the source of truth.

**Tech Stack:** Electron, Node.js CommonJS, React 19, Ant Design, SQLite, Node test runner, Playwright, OpenAI-compatible chat payloads.

---

### Task 1: Artifact workspace deletion

**Files:**
- Modify: `apps/electerm-agent/src/client/components/artifacts/artifact-list.jsx`
- Modify: `apps/electerm-agent/src/client/components/artifacts/artifact-preview.jsx`
- Modify: `apps/electerm-agent/src/client/components/artifacts/artifact-workspace.jsx`
- Modify: `apps/electerm-agent/src/client/components/artifacts/artifacts.styl`
- Test: `apps/electerm-agent/test/unit-ci/ai-artifact-workspace-delete.spec.js`

- [ ] Write a failing source-contract test proving list and preview surfaces expose a translated delete action, call `store.deleteArtifact(id)`, confirm before deletion, and select the next artifact after success.
- [ ] Run `node --test test/unit-ci/ai-artifact-workspace-delete.spec.js` and verify it fails because the workspace has no delete action.
- [ ] Add the minimal delete handler, confirmation modal, disabled/loading state, list menu, preview button, and post-delete selection behavior.
- [ ] Run the focused test and verify it passes.

### Task 2: Incident repository deletion

**Files:**
- Modify: `apps/electerm-agent/src/app/lib/incidents/incident-repository.js`
- Modify: `apps/electerm-agent/src/app/lib/incidents/incident-service.js`
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
- Modify: `apps/electerm-agent/src/client/components/incidents/incident-client.js`
- Modify: `apps/electerm-agent/src/client/store/incidents.js`
- Test: `apps/electerm-agent/test/unit-ci/incident-delete.spec.js`

- [ ] Write a failing repository test that creates an incident, note, timeline event, state event and converted candidate, deletes the incident, then verifies dependent rows are removed and the candidate remains with `incident_id = NULL`.
- [ ] Run the focused test and verify `repository.delete` is missing.
- [ ] Implement the transactional repository delete and expose it through service, IPC, client and store.
- [ ] Run the focused test and existing incident repository tests.

### Task 3: Incident export and simplified storage UI

**Files:**
- Create: `apps/electerm-agent/src/app/lib/incidents/incident-export.js`
- Modify: `apps/electerm-agent/src/app/lib/incidents/incident-service.js`
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
- Modify: `apps/electerm-agent/src/client/components/incidents/incident-client.js`
- Modify: `apps/electerm-agent/src/client/store/incidents.js`
- Modify: `apps/electerm-agent/src/client/components/incidents/incident-workspace.jsx`
- Modify: `apps/electerm-agent/src/client/components/incidents/incident-list.jsx`
- Modify: `apps/electerm-agent/src/client/components/incidents/incident-detail.jsx`
- Modify: `apps/electerm-agent/src/client/components/incidents/incidents.styl`
- Test: `apps/electerm-agent/test/unit-ci/incident-export.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/incident-workspace-actions.spec.js`

- [ ] Write failing tests for Markdown, HTML and JSON serialization, redaction, bounded output, current/filter export, delete confirmation, and absence of the manual storage/restore UI.
- [ ] Run both focused tests and verify the missing behavior.
- [ ] Implement pure exporters, system save dialog IPC, renderer actions and user feedback.
- [ ] Remove `IncidentStorageModal` from the workspace while preserving database automatic backup/recovery code.
- [ ] Run focused and incident regression tests.

### Task 4: Bounded content-ingestion core

**Files:**
- Create: `apps/electerm-agent/src/app/lib/ai-content/content-limits.js`
- Create: `apps/electerm-agent/src/app/lib/ai-content/content-errors.js`
- Create: `apps/electerm-agent/src/app/lib/ai-content/content-normalizer.js`
- Create: `apps/electerm-agent/src/app/lib/ai-content/local-file-reader.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-content-normalizer.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-local-file-reader.spec.js`

- [ ] Write failing tests for extension/MIME classification, path allowlisting, UTF-8-safe truncation, per-file/turn budgets and stable redacted errors.
- [ ] Verify the tests fail because the ingestion modules do not exist.
- [ ] Implement immutable normalized results and bounded local reads limited to user-selected paths.
- [ ] Run focused tests.

### Task 5: Office document extraction

**Files:**
- Create: `apps/electerm-agent/src/app/lib/ai-content/document-reader.js`
- Modify: `apps/electerm-agent/package.json`
- Modify: `apps/electerm-agent/package-lock.json`
- Test: `apps/electerm-agent/test/unit-ci/ai-document-reader.spec.js`
- Test fixtures: `apps/electerm-agent/test/fixtures/ai-content/`

- [ ] Add small generated fixtures and failing tests for PDF, DOCX, XLSX and PPTX extraction, table/section boundaries, macro rejection, corrupt documents and truncation.
- [ ] Run the focused test and verify missing extractors fail.
- [ ] Add minimal maintained parser dependencies and adapters; reuse existing ExcelJS where possible.
- [ ] Run focused tests and dependency audit.

### Task 6: Image and multimodal request support

**Files:**
- Create: `apps/electerm-agent/src/app/lib/ai-content/image-reader.js`
- Create: `apps/electerm-agent/src/client/components/ai/ai-model-capabilities.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-attachments.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-context-actions.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-request-messages.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-image-ingestion.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-multimodal-messages.spec.js`

- [ ] Write failing tests for allowed image types, count/byte/pixel caps, no Base64 persistence, capability labeling and OpenAI-compatible `image_url` message parts.
- [ ] Verify focused tests fail.
- [ ] Implement bounded image reads, model capability normalization, multimodal request conversion and per-attachment failure feedback.
- [ ] Add OCR fallback only when the local OCR adapter is available; otherwise return the translated visual-model guidance.
- [ ] Run focused tests.

### Task 7: Safe public webpage reader

**Files:**
- Create: `apps/electerm-agent/src/app/lib/ai-content/url-safety.js`
- Create: `apps/electerm-agent/src/app/lib/ai-content/web-reader.js`
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-context-actions.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-composer.jsx`
- Test: `apps/electerm-agent/test/unit-ci/ai-url-safety.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-web-reader.spec.js`

- [ ] Write failing tests that reject localhost, RFC1918, link-local, IPv6 local, cloud metadata, DNS rebinding and unsafe redirects while allowing bounded public HTML.
- [ ] Write failing tests for timeout, content type, response size, no credential headers and readable-text extraction.
- [ ] Implement DNS-aware validation on every redirect, bounded fetch, HTML sanitization and normalized web content.
- [ ] Add a visible “引用网页” action and treat it as read-only without confirmation.
- [ ] Run focused tests.

### Task 8: Renderer integration and localized UX

**Files:**
- Modify: `apps/electerm-agent/src/client/components/ai/ai-attachments.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-composer.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai.styl`
- Modify: `apps/electerm-agent/src/client/translate/zh_cn.js`
- Modify: `apps/electerm-agent/src/client/translate/en_us.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-content-ingestion-ui.spec.js`

- [ ] Write failing tests for translated attachment states, model capability badges, URL entry, partial attachment failure and no raw path/stack display.
- [ ] Verify the focused test fails.
- [ ] Implement the renderer states and accessible actions using existing compact ShellPilot visual patterns.
- [ ] Run translation audit and focused tests.

### Task 9: Regression and local package verification

**Files:**
- Modify: `apps/electerm-agent/test/e2e/006.ai-chat.spec.js`
- Create: `apps/electerm-agent/test/e2e/041.artifact-incident-content.spec.js`

- [ ] Add E2E coverage for artifact deletion, incident export/deletion, document attachment, image capability feedback, public URL attachment and SSH session preservation.
- [ ] Run all new unit tests.
- [ ] Run `npm run test-unit-ci`.
- [ ] Run the targeted Playwright tests at 1366x768 and 1920x1080 in light/dark modes.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Launch the local unpacked client and verify SSH terminal, SFTP and AI panel remain usable.
