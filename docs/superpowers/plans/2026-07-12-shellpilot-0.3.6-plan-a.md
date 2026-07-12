# ShellPilot 0.3.6 Plan A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 0.3.6 beta that strengthens log reading, AI file attachments, multiple AI API profiles, and server troubleshooting quick commands, then publish GitHub and ModelScope update assets.

**Architecture:** Keep Electerm/ShellPilot as the base. Reuse existing bounded file readers, archive readers, SFTP context, AI chat, model config, quick command, and update scripts. Add small focused helpers and UI hooks instead of rewriting SSH terminal behavior.

**Tech Stack:** Electron, React, Ant Design, Node test runner, electron-builder, GitHub Releases, ModelScope release sync.

---

### Task 1: Log Context Service

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai/log-context-service.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-log-context-service.spec.js`

- [ ] **Step 1: Write failing tests**

Add tests that expect:
- `buildLogReadPrompt` to include chunk metadata and continuation hint.
- `buildLogSearchPrompt` to include keyword matches.
- `buildArchiveLogPrompt` to list archive entries and read selected text entries.

Run: `node --test test/unit-ci/ai-log-context-service.spec.js`
Expected: FAIL with module not found.

- [ ] **Step 2: Implement minimal service**

Implement exported functions:
- `formatRangeContext(result, source)`
- `buildLogReadPrompt({ file, range })`
- `buildLogSearchPrompt({ file, search })`
- `buildArchiveLogPrompt({ file, archive, entry })`

- [ ] **Step 3: Verify**

Run: `node --test test/unit-ci/ai-log-context-service.spec.js`
Expected: PASS.

### Task 2: AI Attachment Archive Awareness

**Files:**
- Modify: `apps/electerm-agent/src/client/components/ai/ai-attachments.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-context-actions.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-attachments.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-chat-context-actions.spec.js`

- [ ] **Step 1: Write failing tests**

Extend tests to prove `.gz`, `.zip`, and `.tar.gz` attachments produce bounded AI context and SFTP dropped archives keep enough metadata for later reading.

Run: `node --test test/unit-ci/ai-attachments.spec.js test/unit-ci/ai-chat-context-actions.spec.js`
Expected: FAIL on archive context expectations.

- [ ] **Step 2: Implement minimal archive context path**

Use existing `readArchiveTextEntry` / SFTP preview helpers when the source exposes archive data. Return readable failure text when no entry is selected.

- [ ] **Step 3: Verify**

Run: `node --test test/unit-ci/ai-attachments.spec.js test/unit-ci/ai-chat-context-actions.spec.js`
Expected: PASS.

### Task 3: Multiple AI API Profiles

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai/ai-profiles.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config-props.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat.jsx`
- Test: `apps/electerm-agent/test/unit-ci/ai-profiles.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-config-required.spec.js`

- [ ] **Step 1: Write failing tests**

Expect old single config to migrate into one active profile, support adding two profiles, and allow resolving active profile by id.

Run: `node --test test/unit-ci/ai-profiles.spec.js test/unit-ci/ai-config-required.spec.js`
Expected: FAIL with missing `ai-profiles.js`.

- [ ] **Step 2: Implement profile helpers**

Implement:
- `migrateAIProfiles(config)`
- `getActiveAIConfig(config)`
- `upsertAIProfile(config, profile)`
- `removeAIProfile(config, profileId)`

Keep `baseURLAI` and `apiKeyAI` as the only required fields.

- [ ] **Step 3: Wire UI**

In AI chat, resolve `props.config` through `getActiveAIConfig`. In AI config modal, expose profile list, active profile selection, add, save, delete, and model loading against the selected profile.

- [ ] **Step 4: Verify**

Run: `node --test test/unit-ci/ai-profiles.spec.js test/unit-ci/ai-config-required.spec.js`
Expected: PASS.

### Task 4: Server Troubleshooting Quick Commands

**Files:**
- Create: `apps/electerm-agent/src/client/components/quick-commands/server-maintenance-commands.js`
- Modify: `apps/electerm-agent/src/client/store/quick-command.js`
- Test: `apps/electerm-agent/test/unit-ci/server-maintenance-quick-commands.spec.js`

- [ ] **Step 1: Write failing tests**

Expect built-in commands for system overview, disk, memory, service logs, Docker, Nginx, network, and bounded packet capture.

Run: `node --test test/unit-ci/server-maintenance-quick-commands.spec.js`
Expected: FAIL with module not found.

- [ ] **Step 2: Implement built-ins**

Export `getServerMaintenanceQuickCommands()` returning Chinese categories and safe commands. Packet capture must be bounded with `-c 100` or equivalent.

- [ ] **Step 3: Verify**

Run: `node --test test/unit-ci/server-maintenance-quick-commands.spec.js`
Expected: PASS.

### Task 5: Version, Build, Release, Update Verify

**Files:**
- Modify: `apps/electerm-agent/package.json`
- Existing scripts: `release:github`, `release:modelscope:hub`, `release:update-sources:verify`

- [ ] **Step 1: Bump version**

Set package version to `0.3.6`.

- [ ] **Step 2: Full verification**

Run:
- `npm run test-unit-ci`
- `npm run b`
- `npm run release:github`
- `npm run release:modelscope:hub`
- `npm run release:update-sources:verify`

Expected: all commands exit 0, and update verification reports `0.3.6` from GitHub and ModelScope.
