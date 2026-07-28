# ShellPilot Multi-Provider UX and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the four-Provider experience, history and switching semantics, security regression coverage, Chinese documentation, Windows packaging verification, and v0.5.0 release notes.

**Architecture:** The Provider adapters remain protocol-specific, but every user-facing surface consumes shared capabilities, status, events, errors, activity, and history metadata. Configuration uses four provider cards backed by one state model. Active-task locking is enforced in both renderer and main process. Diagnostics and exports use one recursive redaction policy. Release verification combines fake-provider CI, opt-in real-account smoke, and packaged Windows discovery checks.

**Tech Stack:** Electron 41, React 19, Ant Design 6, Provider Manager, Node test runner, Playwright, project smoke scripts, Electron Builder, Windows installer and portable ZIP verification.

---

## Command convention

Run every `node`, `npm`, and `npx` block from `apps/electerm-agent`. Run every `git` block, and every source scan whose paths start with `apps/electerm-agent`, from the repository root. Resolve the root with `git rev-parse --show-toplevel`; do not assume the checkout is on a particular drive.

## Preconditions

Complete and verify:

1. `2026-07-28-shellpilot-provider-core-codex.md`
2. `2026-07-28-shellpilot-grok-provider.md`
3. `2026-07-28-shellpilot-gemini-provider.md`

The repository must have working `openai-compatible`, `codex`, `grok`, and `gemini` adapters before this plan begins. This plan does not add another provider protocol.

## File map

### Create

- `apps/electerm-agent/src/client/components/ai/ai-provider-state.js`
- `apps/electerm-agent/src/client/components/ai/ai-provider-grid.jsx`
- `apps/electerm-agent/src/client/components/ai/ai-provider-activity-guard.js`
- `apps/electerm-agent/src/client/components/ai/ai-provider-history-meta.jsx`
- `apps/electerm-agent/src/app/lib/ai-providers/provider-redaction.js`
- `apps/electerm-agent/build/bin/smoke-ai-providers.js`
- `apps/electerm-agent/build/bin/smoke-ai-providers-real.js`
- `apps/electerm-agent/test/unit-ci/ai-provider-state.spec.js`
- `apps/electerm-agent/test/unit-ci/ai-provider-activity-guard.spec.js`
- `apps/electerm-agent/test/unit-ci/ai-provider-history-meta.spec.js`
- `apps/electerm-agent/test/unit-ci/provider-redaction.spec.js`
- `apps/electerm-agent/test/unit-ci/ai-provider-release-docs.spec.js`
- `apps/electerm-agent/test/unit-ci/ai-provider-package.spec.js`
- `apps/electerm-agent/test/e2e/032.ai-provider-grid.spec.js`
- `apps/electerm-agent/test/e2e/033.ai-provider-history.spec.js`
- `apps/electerm-agent/test/e2e/034.ai-provider-accessibility.spec.js`
- `apps/electerm-agent/docs/releases/v0.5.0.md`

### Modify

- `apps/electerm-agent/src/app/lib/ai-providers/provider-contract.js`
- `apps/electerm-agent/src/app/lib/ai-providers/provider-error.js`
- `apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js`
- `apps/electerm-agent/src/app/lib/ai-providers/provider-event-store.js`
- `apps/electerm-agent/src/app/lib/diagnostic-pack.js`
- `apps/electerm-agent/src/app/lib/user-config-controller.js`
- `apps/electerm-agent/src/app/lib/ipc.js`
- `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- `apps/electerm-agent/src/client/components/ai/ai-provider-card.jsx`
- `apps/electerm-agent/src/client/components/ai/ai-chat.jsx`
- `apps/electerm-agent/src/client/components/ai/ai-chat-actions.js`
- `apps/electerm-agent/src/client/components/ai/ai-chat-history.jsx`
- `apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx`
- `apps/electerm-agent/src/client/components/ai/ai-profile-transfer.js`
- `apps/electerm-agent/src/client/components/side-panel-r/right-side-panel-ai-header.jsx`
- `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`
- `apps/electerm-agent/src/client/common/shellpilot-help-content.js`
- `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- `apps/electerm-agent/src/client/components/ai/ai.styl`
- `apps/electerm-agent/build/bin/smoke-ai.js`
- `apps/electerm-agent/build/bin/package-smoke-test.js`
- `apps/electerm-agent/build/bin/verify-win-portable-zip.js`
- `apps/electerm-agent/docs/AI_PROVIDERS_TROUBLESHOOTING_ZH.md`
- `apps/electerm-agent/docs/USER_GUIDE_ZH.md`
- `apps/electerm-agent/README.md`
- `apps/electerm-agent/package.json`
- `apps/electerm-agent/test/unit-ci/ai-profile-transfer.spec.js`
- `apps/electerm-agent/test/unit-ci/diagnostic-pack.spec.js`
- `apps/electerm-agent/test/unit-ci/help-center.spec.js`
- `apps/electerm-agent/test/unit-ci/release-notes.spec.js`
- `apps/electerm-agent/test/unit-ci/verify-win-portable-zip.spec.js`
- `apps/electerm-agent/test/e2e/005.ai-config.spec.js`
- `apps/electerm-agent/test/e2e/006.ai-chat.spec.js`
- `apps/electerm-agent/test/e2e/022.secondary-ui-visual-matrix.spec.js`
- `apps/electerm-agent/test/e2e/026.ai-takeover.spec.js`

## Task 1: Define one capability-driven provider presentation state

**Files:**

- Create: `apps/electerm-agent/src/client/components/ai/ai-provider-state.js`
- Create: `apps/electerm-agent/test/unit-ci/ai-provider-state.spec.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-providers/provider-contract.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-provider-card.jsx`

- [ ] Write a complete provider-state table test.

Test all combinations that can be rendered:

- not installed;
- installed but unavailable;
- unconfigured API key;
- unauthenticated account;
- login pending;
- authenticated;
- reachable;
- selected model available;
- selected model unavailable;
- quota exceeded;
- rate limited;
- network error;
- protocol incompatible;
- credential expired;
- provider crashed;
- active request;
- stale status.

For every state assert label key, severity, primary action, available secondary actions, disabled actions, and help section.

- [ ] Run the new test.

```powershell
node --test test/unit-ci/ai-provider-state.spec.js
```

Expected: module-not-found failure.

- [ ] Normalize capability and status shapes.

Every adapter must return:

```js
{
  providerId,
  capabilities: {
    accountLogin,
    deviceLogin,
    apiKey,
    logout,
    models,
    health,
    chat,
    agent,
    streaming,
    cancellation
  },
  installation: {
    required,
    installed,
    version,
    compatible
  },
  authentication: {
    state,
    accountLabel,
    planLabel
  },
  health: {
    state,
    checkedAt,
    latencyMs,
    message
  }
}
```

Unsupported fields are false or empty, never fabricated.

- [ ] Implement pure `deriveAIProviderViewState`.

The function accepts capabilities, status, whether the profile is current, and activity. It returns presentation data only and performs no IPC or mutation.

- [ ] Refactor `ai-provider-card.jsx` to consume derived state.

Remove provider-ID condition chains for generic states and actions. Provider-specific explanatory copy may remain in a small metadata catalog.

- [ ] Run the state tests.

Expected: all state combinations pass.

- [ ] Commit the shared presentation state.

```powershell
git add apps/electerm-agent/src/client/components/ai/ai-provider-state.js apps/electerm-agent/src/client/components/ai/ai-provider-card.jsx apps/electerm-agent/src/app/lib/ai-providers/provider-contract.js apps/electerm-agent/test/unit-ci/ai-provider-state.spec.js
git commit -m "refactor(ai): unify provider presentation state"
```

## Task 2: Build the four-card configuration grid and responsive behavior

**Files:**

- Create: `apps/electerm-agent/src/client/components/ai/ai-provider-grid.jsx`
- Create: `apps/electerm-agent/test/e2e/032.ai-provider-grid.spec.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai.styl`
- Modify: `apps/electerm-agent/test/e2e/005.ai-config.spec.js`
- Modify: `apps/electerm-agent/test/e2e/022.secondary-ui-visual-matrix.spec.js`

- [ ] Add E2E tests for the final information architecture.

Assert the “模型 API” modal shows exactly these top-level choices:

1. OpenAI 兼容
2. Codex
3. Grok
4. Gemini

Verify each card has name, purpose, authentication method, status, model, current marker, and help action. Verify the OpenAI-compatible card retains access to presets and advanced endpoint fields.

- [ ] Add responsive and theme cases.

Test:

- narrow modal;
- 100%, 125%, 150%, and 200% Windows scaling;
- light and dark themes;
- long Chinese status text;
- long account email;
- empty model list;
- device-code panel;
- keyboard focus order.

- [ ] Run the new E2E and confirm failure.

```powershell
npx playwright test test/e2e/032.ai-provider-grid.spec.js --workers=1
```

- [ ] Implement `AIProviderGrid`.

Render from a fixed provider metadata order and live manager status. Do not create profiles merely by viewing cards. “设为当前” creates or updates the corresponding profile only after the user action.

- [ ] Preserve advanced OpenAI-compatible configuration.

Move the existing recommended-provider catalog, custom URL, API path, custom header, proxy, Ollama, and profile import/export UI under the OpenAI-compatible card’s advanced area.

- [ ] Add accessible status and action semantics.

Use real buttons, visible focus, `aria-live="polite"` for login and health updates, and descriptive labels that include provider name. Do not rely on color alone.

- [ ] Run grid and visual matrix tests.

```powershell
npx playwright test test/e2e/005.ai-config.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js test/e2e/032.ai-provider-grid.spec.js --workers=1
```

Expected: all layouts pass without clipped actions or inaccessible controls.

- [ ] Commit the provider grid.

```powershell
git add apps/electerm-agent/src/client/components/ai/ai-provider-grid.jsx apps/electerm-agent/src/client/components/ai/ai-config.jsx apps/electerm-agent/src/client/components/ai/ai.styl apps/electerm-agent/test/e2e/005.ai-config.spec.js apps/electerm-agent/test/e2e/022.secondary-ui-visual-matrix.spec.js apps/electerm-agent/test/e2e/032.ai-provider-grid.spec.js
git commit -m "feat(ai): add unified provider configuration grid"
```

## Task 3: Enforce active-task locking for switching, logout, and credential removal

**Files:**

- Create: `apps/electerm-agent/src/client/components/ai/ai-provider-activity-guard.js`
- Create: `apps/electerm-agent/test/unit-ci/ai-provider-activity-guard.spec.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-providers/provider-event-store.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- Modify: `apps/electerm-agent/src/client/components/side-panel-r/right-side-panel-ai-header.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat.jsx`
- Modify: `apps/electerm-agent/test/unit-ci/ai-provider-manager.spec.js`

- [ ] Write renderer guard tests.

Cover:

- ordinary chat active;
- Agent active;
- health check active;
- login active;
- completed request;
- cancelled request;
- stale history entry after restart;
- two scopes using the same provider;
- a different provider active.

Define exactly which operations are blocked:

| Activity | Switch active profile | Logout same provider | Replace/clear same credential |
|---|---:|---:|---:|
| Chat | Block | Block | Block |
| Agent | Block | Block | Block |
| Health check | Allow after canceling check | Block | Block |
| Login | Allow other profile | Cancel login first | Not applicable |

- [ ] Write main-process race tests.

Simulate activity beginning between renderer status read and mutation IPC. Assert the manager rejects the mutation. Renderer checks are usability; main-process checks are authoritative.

- [ ] Run tests and confirm failure.

```powershell
node --test test/unit-ci/ai-provider-activity-guard.spec.js test/unit-ci/ai-provider-manager.spec.js
```

- [ ] Implement main activity snapshots.

Return only:

```js
{
  active: true,
  providerId,
  profileId,
  requestId,
  mode,
  startedAt
}
```

Do not return prompts, tool arguments, event bodies, or credentials.

- [ ] Implement the renderer guard.

All card actions and side-panel selectors call the same guard. The blocked message names the active task and provides a “停止当前任务” action. It never silently cancels.

- [ ] Make destructive auth actions atomic.

The manager rechecks activity immediately before logout, key removal, or profile deletion. If a request is active, return `provider-unavailable` with action `stop-active-task`.

- [ ] Run tests.

Expected: race and UI guard tests pass.

- [ ] Commit activity locking.

```powershell
git add apps/electerm-agent/src/client/components/ai/ai-provider-activity-guard.js apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js apps/electerm-agent/src/app/lib/ai-providers/provider-event-store.js apps/electerm-agent/src/client/components/ai/ai-config.jsx apps/electerm-agent/src/client/components/side-panel-r/right-side-panel-ai-header.jsx apps/electerm-agent/src/client/components/ai/ai-chat.jsx apps/electerm-agent/test/unit-ci/ai-provider-activity-guard.spec.js apps/electerm-agent/test/unit-ci/ai-provider-manager.spec.js
git commit -m "feat(ai): guard provider changes during active tasks"
```

## Task 4: Persist provider and model history metadata safely

**Files:**

- Create: `apps/electerm-agent/src/client/components/ai/ai-provider-history-meta.jsx`
- Create: `apps/electerm-agent/test/unit-ci/ai-provider-history-meta.spec.js`
- Create: `apps/electerm-agent/test/e2e/033.ai-provider-history.spec.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-actions.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-history.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-profile-transfer.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-profile-transfer.spec.js`

- [ ] Write history metadata tests.

New history entries record:

```js
{
  provider: {
    id: 'codex',
    label: 'Codex',
    model: 'model-id',
    authMode: 'official-account'
  }
}
```

Assert:

- no account email, plan, key, token, base URL query, header value, or provider option secret is stored;
- old entries without provider metadata remain readable;
- old entries infer `openai-compatible` only for display;
- continuing a historical conversation requires its provider to be usable;
- unavailable provider offers reconnect or explicit manual provider choice;
- continuation never silently changes provider;
- exports omit credentials and login state.

- [ ] Run unit tests and confirm failure.

```powershell
node --test test/unit-ci/ai-provider-history-meta.spec.js test/unit-ci/ai-profile-transfer.spec.js
```

- [ ] Add history metadata at request creation.

Copy only the provider ID, display label, selected model, and auth mode. Freeze this metadata for the entry so later profile changes do not rewrite history.

- [ ] Render compact history badges.

Show provider and model in the entry header and tooltip. For missing providers, keep content readable and show a non-destructive continuation warning.

- [ ] Add continuation policy.

When retrying or continuing:

1. use the entry’s provider and model if available;
2. require reauthentication or configuration repair when unavailable;
3. let the user explicitly choose another current profile;
4. record the new provider on the new entry;
5. never mutate the original history metadata.

- [ ] Run unit and E2E tests.

```powershell
node --test test/unit-ci/ai-provider-history-meta.spec.js test/unit-ci/ai-profile-transfer.spec.js
npx playwright test test/e2e/033.ai-provider-history.spec.js --workers=1
```

Expected: provider/model badges and explicit continuation behavior pass.

- [ ] Commit history metadata.

```powershell
git add apps/electerm-agent/src/client/components/ai/ai-provider-history-meta.jsx apps/electerm-agent/src/client/components/ai/ai-chat-actions.js apps/electerm-agent/src/client/components/ai/ai-chat-history.jsx apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx apps/electerm-agent/src/client/components/ai/ai-profile-transfer.js apps/electerm-agent/test/unit-ci/ai-provider-history-meta.spec.js apps/electerm-agent/test/unit-ci/ai-profile-transfer.spec.js apps/electerm-agent/test/e2e/033.ai-provider-history.spec.js
git commit -m "feat(ai): record provider metadata in chat history"
```

## Task 5: Centralize provider redaction and diagnostic safety

**Files:**

- Create: `apps/electerm-agent/src/app/lib/ai-providers/provider-redaction.js`
- Create: `apps/electerm-agent/test/unit-ci/provider-redaction.spec.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-providers/provider-error.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-providers/provider-event-store.js`
- Modify: `apps/electerm-agent/src/app/lib/diagnostic-pack.js`
- Modify: `apps/electerm-agent/src/app/lib/user-config-controller.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-profile-transfer.js`
- Modify: `apps/electerm-agent/test/unit-ci/diagnostic-pack.spec.js`

- [ ] Write recursive redaction tests.

Cover strings, arrays, nested objects, error causes, URLs, CLI arguments, headers, SSE events, JSON-RPC messages, ACP updates, tool arguments, and diagnostic metadata containing:

- API keys;
- access and refresh tokens;
- cookies;
- authorization headers;
- SSH passwords;
- private keys and passphrases;
- signed URLs;
- device codes;
- capability tokens;
- Codex and Grok official credential-cache content.

Assert safe non-secret provider ID, model, version, status, error code, and latency remain.

- [ ] Run redaction and diagnostic tests.

```powershell
node --test test/unit-ci/provider-redaction.spec.js test/unit-ci/diagnostic-pack.spec.js
```

Expected: new cases fail before the central redactor exists.

- [ ] Implement one main-process redactor.

Export:

```js
redactProviderText(value)
redactProviderValue(value)
redactProviderUrl(value)
redactProviderError(error)
```

Apply depth, item-count, string-length, and total-byte limits. Preserve no stack trace in user-facing or diagnostic provider errors.

- [ ] Route all provider logging through the redactor.

Adapters may log provider ID, version, protocol method, duration, safe error code, and terminal state. They may not log request bodies, raw response bodies, headers, environment blocks, CLI output, tool arguments, or tool results.

- [ ] Sanitize diagnostic packs and exports.

Diagnostic provider data is limited to:

- app version;
- provider installation/version/compatibility;
- auth state without account identity;
- last health category and latency;
- normalized error code;
- active request count without content.

- [ ] Run tests and inspect a generated fixture pack.

```powershell
node --test test/unit-ci/provider-redaction.spec.js test/unit-ci/diagnostic-pack.spec.js test/unit-ci/ai-profile-transfer.spec.js
```

Expected: all pass and fixture archives contain no seeded secret.

- [ ] Commit redaction closure.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/provider-redaction.js apps/electerm-agent/src/app/lib/ai-providers/provider-error.js apps/electerm-agent/src/app/lib/ai-providers/provider-event-store.js apps/electerm-agent/src/app/lib/diagnostic-pack.js apps/electerm-agent/src/app/lib/user-config-controller.js apps/electerm-agent/src/client/components/ai/ai-profile-transfer.js apps/electerm-agent/test/unit-ci/provider-redaction.spec.js apps/electerm-agent/test/unit-ci/diagnostic-pack.spec.js
git commit -m "security(ai): centralize provider redaction"
```

## Task 6: Complete error recovery and manual retry semantics

**Files:**

- Modify: `apps/electerm-agent/src/app/lib/ai-providers/provider-error.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-provider-manager.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-provider-history-meta.spec.js`

- [ ] Add one test for every approved error category.

For each code assert:

- Chinese action text;
- retryable flag;
- retry action visibility;
- login/configure/upgrade/verify-state action;
- whether ordinary chat may be manually retried;
- whether Agent may be retried after no tool dispatch;
- whether Agent is blocked from retry after possible side effects.

- [ ] Add no-fallback tests.

Configure all four providers, fail the selected provider, and assert the manager never invokes another adapter. Also assert a model failure does not choose another model automatically.

- [ ] Add manual retry tests.

Manual retry creates a new request ID and new history entry. It uses the same provider and model unless the user explicitly changes them. An uncertain Agent result requires verification before the retry button is enabled.

- [ ] Run focused tests.

```powershell
node --test test/unit-ci/ai-provider-manager.spec.js test/unit-ci/ai-provider-history-meta.spec.js
```

- [ ] Implement the recovery matrix.

Keep it as data keyed by error code rather than nested conditionals. Provider-specific details are safe supplemental text.

- [ ] Render accurate terminal states.

Use:

- completed;
- cancelled;
- failed;
- uncertain and verify required.

Never render completed when remote effects could not be verified.

- [ ] Run tests.

Expected: every error and retry policy passes.

- [ ] Commit recovery semantics.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/provider-error.js apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/ai-provider-manager.spec.js apps/electerm-agent/test/unit-ci/ai-provider-history-meta.spec.js
git commit -m "feat(ai): unify provider recovery actions"
```

## Task 7: Finish in-app help, repository docs, and v0.5.0 release notes

**Files:**

- Create: `apps/electerm-agent/test/unit-ci/ai-provider-release-docs.spec.js`
- Create: `apps/electerm-agent/docs/releases/v0.5.0.md`
- Modify: `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-help-content.js`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/docs/AI_PROVIDERS_TROUBLESHOOTING_ZH.md`
- Modify: `apps/electerm-agent/docs/USER_GUIDE_ZH.md`
- Modify: `apps/electerm-agent/README.md`
- Modify: `apps/electerm-agent/test/unit-ci/help-center.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/release-notes.spec.js`

- [ ] Write documentation contract tests.

Require in-app and repository guidance for:

- provider selection principles;
- Codex installation, login, device code, models, logout, and shared session;
- Grok installation, login, device auth, ACP, models, logout, and xAI API-key distinction;
- Gemini key creation, storage, model test, billing, and OAuth non-support;
- OpenAI-compatible API, relay, proxy, custom header, Ollama, and local models;
- switching and active-task blocking;
- history provider/model labels;
- privacy and data flow;
- subscription usage versus API billing;
- every troubleshooting case approved in the design.

- [ ] Run docs tests and confirm missing coverage.

```powershell
node --test test/unit-ci/ai-provider-release-docs.spec.js test/unit-ci/help-center.spec.js test/unit-ci/release-notes.spec.js
```

- [ ] Restructure the help center section.

Add “多模型与账号登录” with deep-link anchors:

- overview;
- openai-compatible;
- codex;
- grok;
- gemini;
- switching-history;
- privacy-billing;
- troubleshooting.

Every provider card opens its own anchor.

- [ ] Complete the standalone troubleshooting guide.

Include symptoms, likely cause, safe checks, corrective action, and data-collection boundaries. Do not tell users to paste credential files or full authorization output.

- [ ] Write v0.5.0 release notes.

State:

- supported providers and auth methods;
- minimum compatible official-client behavior rather than a brittle exact version when possible;
- Codex and Grok shared-login-state impact;
- Gemini API-key-only status;
- no automatic fallback;
- Agent security boundary;
- migration behavior;
- known limitations;
- upgrade and rollback notes;
- documentation links.

- [ ] Run docs tests.

Expected: all required user-facing topics are present and capabilities are not overstated.

- [ ] Commit documentation.

```powershell
git add apps/electerm-agent/src/client/components/main/help-center-modal.jsx apps/electerm-agent/src/client/common/shellpilot-help-content.js apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/docs/AI_PROVIDERS_TROUBLESHOOTING_ZH.md apps/electerm-agent/docs/USER_GUIDE_ZH.md apps/electerm-agent/docs/releases/v0.5.0.md apps/electerm-agent/README.md apps/electerm-agent/test/unit-ci/ai-provider-release-docs.spec.js apps/electerm-agent/test/unit-ci/help-center.spec.js apps/electerm-agent/test/unit-ci/release-notes.spec.js
git commit -m "docs: complete multi-provider user guidance"
```

## Task 8: Add fake-provider smoke and opt-in real-account smoke

**Files:**

- Create: `apps/electerm-agent/build/bin/smoke-ai-providers.js`
- Create: `apps/electerm-agent/build/bin/smoke-ai-providers-real.js`
- Modify: `apps/electerm-agent/build/bin/smoke-ai.js`
- Modify: `apps/electerm-agent/package.json`

- [ ] Define deterministic fake smoke fixtures.

The fake smoke starts:

- fake Codex app-server stdio;
- fake Grok ACP stdio;
- fake Gemini HTTP/SSE;
- fake OpenAI-compatible HTTP;
- fake loopback MCP calls.

It checks status, model list, chat, Agent readonly call, Agent declined risky call, cancellation, crash, and no fallback.

- [ ] Add package scripts.

Add:

```json
{
  "smoke:ai-providers": "cross-env NODE_ENV=test electron build/bin/smoke-ai-providers.js",
  "smoke:ai-providers:real": "cross-env NODE_ENV=development electron build/bin/smoke-ai-providers-real.js"
}
```

The real script exits without failure and prints opt-in instructions unless `SHELLPILOT_REAL_PROVIDER_SMOKE=1` is set.

- [ ] Implement safe real-smoke configuration.

Real smoke reads only environment flags and existing official login state. It never prints keys, account email, device code, authorization headers, prompts, or model output. Gemini key is resolved from an explicitly selected test profile, not from a command-line argument.

- [ ] Add side-effect guardrails.

Agent write smoke requires all of:

- `SHELLPILOT_REAL_PROVIDER_SMOKE=1`;
- `SHELLPILOT_REAL_AGENT_WRITE_SMOKE=1`;
- an exact dedicated test endpoint ID;
- an exact allowed remote test directory;
- a rollback-capable test operation.

Otherwise only readonly Agent smoke runs.

- [ ] Run fake smoke.

```powershell
npm run smoke:ai-providers
```

Expected: all four fake providers pass without external credentials.

- [ ] Run real smoke in safe skip mode.

```powershell
npm run smoke:ai-providers:real
```

Expected: exit code 0 with a message that real smoke was skipped because the opt-in flag is absent.

- [ ] Commit smoke tooling.

```powershell
git add apps/electerm-agent/build/bin/smoke-ai-providers.js apps/electerm-agent/build/bin/smoke-ai-providers-real.js apps/electerm-agent/build/bin/smoke-ai.js apps/electerm-agent/package.json
git commit -m "test(ai): add multi-provider smoke coverage"
```

## Task 9: Verify accessibility, visual behavior, and provider isolation

**Files:**

- Create: `apps/electerm-agent/test/e2e/034.ai-provider-accessibility.spec.js`
- Modify: `apps/electerm-agent/test/e2e/032.ai-provider-grid.spec.js`
- Modify: `apps/electerm-agent/test/e2e/033.ai-provider-history.spec.js`
- Modify: `apps/electerm-agent/test/e2e/006.ai-chat.spec.js`
- Modify: `apps/electerm-agent/test/e2e/026.ai-takeover.spec.js`

- [ ] Add keyboard and screen-reader tests.

Verify:

- card traversal order;
- login and device-code announcements;
- modal focus containment;
- disabled-action explanation;
- status text independent of color;
- help deep links;
- confirmation dialogs return focus;
- Esc cancels only the open dialog, not an active task.

- [ ] Add provider isolation tests.

For each absent or failing adapter assert:

- app startup succeeds;
- SSH and SFTP remain usable;
- other providers remain usable;
- configuration modal still opens;
- history remains readable;
- failure does not trigger another provider.

- [ ] Add long-running activity tests.

Start chat or Agent, attempt switch, logout, key clear, and profile delete. Assert each mutation is blocked until the user stops the task.

- [ ] Run the E2E matrix.

```powershell
npx playwright test test/e2e/005.ai-config.spec.js test/e2e/006.ai-chat.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js test/e2e/026.ai-takeover.spec.js test/e2e/032.ai-provider-grid.spec.js test/e2e/033.ai-provider-history.spec.js test/e2e/034.ai-provider-accessibility.spec.js --workers=1
```

Expected: exit code 0.

- [ ] Commit E2E closure.

```powershell
git add apps/electerm-agent/test/e2e/005.ai-config.spec.js apps/electerm-agent/test/e2e/006.ai-chat.spec.js apps/electerm-agent/test/e2e/022.secondary-ui-visual-matrix.spec.js apps/electerm-agent/test/e2e/026.ai-takeover.spec.js apps/electerm-agent/test/e2e/032.ai-provider-grid.spec.js apps/electerm-agent/test/e2e/033.ai-provider-history.spec.js apps/electerm-agent/test/e2e/034.ai-provider-accessibility.spec.js
git commit -m "test(ai): close multi-provider E2E matrix"
```

## Task 10: Add packaged Windows provider verification

**Files:**

- Create: `apps/electerm-agent/test/unit-ci/ai-provider-package.spec.js`
- Modify: `apps/electerm-agent/build/bin/package-smoke-test.js`
- Modify: `apps/electerm-agent/build/bin/verify-win-portable-zip.js`
- Modify: `apps/electerm-agent/test/unit-ci/verify-win-portable-zip.spec.js`

- [ ] Write package verification tests.

Assert packaged output includes:

- provider adapter modules;
- MCP transport modules;
- preload provider bridge methods;
- help and troubleshooting docs;
- no developer credential cache;
- no test account data;
- no `.env` containing keys;
- no provider capability token;
- no absolute developer-machine CLI path.

- [ ] Add packaged discovery fixtures.

Test:

- system Codex;
- inaccessible Store alias plus bundled Codex Desktop CLI;
- missing Codex;
- system Grok;
- missing Grok;
- Gemini without external CLI;
- all providers absent except OpenAI-compatible.

- [ ] Run package unit tests.

```powershell
node --test test/unit-ci/ai-provider-package.spec.js test/unit-ci/verify-win-portable-zip.spec.js test/unit-ci/package-smoke-utils.spec.js
```

- [ ] Build the application.

```powershell
npm run b
```

Expected: renderer and main-process builds complete with exit code 0.

- [ ] Prepare Electron Builder output and run package smoke.

```powershell
npm run pb
npm run test-package-smoke
```

Expected: package smoke starts the built application and reports no missing provider module.

- [ ] Verify the Windows portable ZIP.

```powershell
npm run verify-win-portable
```

Expected: portable ZIP verification passes and the archive contains no secret fixture or developer credential file.

- [ ] Commit package verification changes.

```powershell
git add apps/electerm-agent/build/bin/package-smoke-test.js apps/electerm-agent/build/bin/verify-win-portable-zip.js apps/electerm-agent/test/unit-ci/ai-provider-package.spec.js apps/electerm-agent/test/unit-ci/verify-win-portable-zip.spec.js
git commit -m "test(ai): verify packaged provider runtime"
```

## Task 11: Set v0.5.0 metadata and run the final release gate

**Files:**

- Modify: `apps/electerm-agent/package.json`
- Modify version mirrors required by `release-version-consistency.js`.
- Modify only additional files required by final verification findings.

- [ ] Update version metadata to `0.5.0`.

Use the repository’s release-version consistency tests to identify every required version mirror. Do not edit generated package artifacts by hand.

- [ ] Run formatting and static checks.

```powershell
git diff --check
npm run lint
```

Expected: both pass.

- [ ] Run the complete unit suite.

```powershell
npm run test-unit-ci
```

Expected: exit code 0 with all provider, security, help, release, and package tests present.

- [ ] Run the full quality test group.

```powershell
npm run test3
```

Expected: exit code 0.

- [ ] Run provider smoke.

```powershell
npm run smoke:ai-providers
npm run smoke:ai-providers:real
```

Expected: fake smoke passes and real smoke safely skips without opt-in.

- [ ] Run release consistency.

```powershell
node --test test/unit-ci/release-version-consistency.spec.js test/unit-ci/release-version-baseline.spec.js test/unit-ci/release-notes.spec.js
```

Expected: v0.5.0 metadata and release notes pass.

- [ ] Inspect the complete diff and repository status.

```powershell
git status --short
git diff --stat
git diff --check
```

Expected: only intended multi-provider, documentation, test, version, and package-verification changes are present. Preserve unrelated user changes.

- [ ] Commit final release metadata and verification fixes.

```powershell
git add apps/electerm-agent/package.json apps/electerm-agent/docs/releases/v0.5.0.md
git commit -m "chore: prepare ShellPilot v0.5.0"
```

Include any additional version-mirror files required by the consistency test. Do not include unrelated working-tree changes.

## Final acceptance checklist

- [ ] Four provider cards are visible and capability-driven.
- [ ] OpenAI-compatible legacy profiles migrate and continue working.
- [ ] Codex and Grok use official account login owned by their official clients.
- [ ] Gemini uses an encrypted API key and does not claim OAuth support.
- [ ] Login success never silently changes the active provider.
- [ ] Active tasks block provider switching, logout, key removal, and profile deletion in renderer and main process.
- [ ] Ordinary chat never attaches Agent tools.
- [ ] Agent tools remain bound to one exact SSH endpoint and existing safety controls.
- [ ] Native Codex/Grok writes cannot bypass ShellPilot.
- [ ] No automatic provider or model fallback exists.
- [ ] No automatic replay occurs after a possible side effect.
- [ ] History records safe provider and model metadata and remains backward compatible.
- [ ] Errors expose actionable Chinese recovery without leaking secrets.
- [ ] Exports, logs, diagnostics, tests, and packages contain no credentials or capability tokens.
- [ ] Every provider card deep-links to its Chinese help section.
- [ ] README, user guide, troubleshooting guide, and v0.5.0 notes match delivered capabilities.
- [ ] Fake-provider CI, E2E, package smoke, portable ZIP verification, and release consistency all pass.
- [ ] Missing any optional official client does not break other providers, SSH, or SFTP.
