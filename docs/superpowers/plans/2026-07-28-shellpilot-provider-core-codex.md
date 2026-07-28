# ShellPilot Provider Core and Codex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the unified AI Provider runtime, preserve every existing OpenAI-compatible profile, and deliver Codex account login, model discovery, streaming chat, and safety-gated Agent operation.

**Architecture:** The Electron main process owns provider discovery, credentials, child processes, requests, events, and cancellation. The renderer sends credential-free `ProviderRequest` objects and polls normalized `ProviderEvent` records. `OpenAICompatibleProvider` wraps the current HTTP backend without changing its network semantics. `CodexProvider` talks to `codex app-server` over stdio JSON-RPC. Agent tools are exposed only through a request-scoped loopback MCP bridge whose renderer endpoint invokes the existing `executeToolCall` safety path.

**Tech Stack:** Electron 41, Node.js CommonJS in the main process, React 19 and ES modules in the renderer, Node test runner, Axios, Express, the repository's MCP transport, Codex app-server JSON-RPC, Ant Design.

---

## Command convention

Run every `node`, `npm`, and `npx` block from `apps/electerm-agent`. Run every `git` block, and every source scan whose paths start with `apps/electerm-agent`, from the repository root. Resolve the root with `git rev-parse --show-toplevel`; do not assume the checkout is on a particular drive.

## Delivery boundary

This plan delivers phase 1 of the approved design:

- `openai-compatible` and `codex` provider IDs.
- Main-process credential resolution; provider requests contain no API key, token, cookie, SSH password, or private key.
- Existing API profiles migrate without changing profile IDs, endpoints, models, proxy settings, headers, or encrypted API keys.
- Codex official account status, browser login, device-code fallback, login cancellation, logout, model discovery, streaming chat, and controlled Agent.
- Codex native filesystem writes are blocked by a read-only sandbox. Native permission-escalation requests are declined.
- The temporary MCP bridge binds only to `127.0.0.1`, uses a random port and high-entropy bearer token, and is revoked on cancellation, endpoint change, task completion, provider change, or app shutdown.
- Codex Chinese help and repository documentation are part of phase acceptance.

Grok, Gemini, the complete four-card visual polish, and release packaging closure are handled by the subsequent plans.

## File map

### Create

- `apps/electerm-agent/src/app/lib/ai-providers/provider-contract.js`
- `apps/electerm-agent/src/app/lib/ai-providers/provider-error.js`
- `apps/electerm-agent/src/app/lib/ai-providers/provider-event-store.js`
- `apps/electerm-agent/src/app/lib/ai-providers/provider-credential-vault.js`
- `apps/electerm-agent/src/app/lib/ai-providers/stdio-json-rpc-client.js`
- `apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js`
- `apps/electerm-agent/src/app/lib/ai-providers/openai-compatible-provider.js`
- `apps/electerm-agent/src/app/lib/ai-providers/codex-provider.js`
- `apps/electerm-agent/src/app/lib/ai-providers/provider-tool-bridge.js`
- `apps/electerm-agent/src/client/components/ai/ai-provider-client.js`
- `apps/electerm-agent/src/client/components/ai/provider-agent-tool-session.js`
- `apps/electerm-agent/src/client/components/ai/ai-provider-card.jsx`
- `apps/electerm-agent/test/unit-ci/ai-provider-profile-contract.spec.js`
- `apps/electerm-agent/test/unit-ci/ai-provider-credential-vault.spec.js`
- `apps/electerm-agent/test/unit-ci/ai-provider-event-store.spec.js`
- `apps/electerm-agent/test/unit-ci/stdio-json-rpc-client.spec.js`
- `apps/electerm-agent/test/unit-ci/ai-provider-manager.spec.js`
- `apps/electerm-agent/test/unit-ci/openai-compatible-provider.spec.js`
- `apps/electerm-agent/test/unit-ci/codex-provider.spec.js`
- `apps/electerm-agent/test/unit-ci/provider-tool-bridge.spec.js`
- `apps/electerm-agent/test/unit-ci/provider-agent-tool-session.spec.js`
- `apps/electerm-agent/test/unit-ci/codex-provider-ui.spec.js`
- `apps/electerm-agent/docs/AI_PROVIDERS_TROUBLESHOOTING_ZH.md`

### Modify

- `apps/electerm-agent/src/app/lib/ai-credential-storage.js`
- `apps/electerm-agent/src/app/lib/get-config.js`
- `apps/electerm-agent/src/app/lib/user-config-controller.js`
- `apps/electerm-agent/src/app/lib/ipc.js`
- `apps/electerm-agent/src/app/preload/preload.js`
- `apps/electerm-agent/src/client/components/ai/ai-config-props.js`
- `apps/electerm-agent/src/client/components/ai/ai-profiles.js`
- `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- `apps/electerm-agent/src/client/components/ai/ai-health-coordinator.js`
- `apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx`
- `apps/electerm-agent/src/client/components/ai/ai-chat.jsx`
- `apps/electerm-agent/src/client/components/ai/agent.js`
- `apps/electerm-agent/src/client/components/ai/agent-skill-creator-controller.js`
- `apps/electerm-agent/src/client/components/ai/agent-task-controller.js`
- `apps/electerm-agent/src/client/components/side-panel-r/right-side-panel-ai-header.jsx`
- `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`
- `apps/electerm-agent/src/client/common/shellpilot-help-content.js`
- `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- `apps/electerm-agent/docs/USER_GUIDE_ZH.md`
- `apps/electerm-agent/README.md`
- `apps/electerm-agent/test/unit-ci/ai-profiles.spec.js`
- `apps/electerm-agent/test/unit-ci/ai-config-required.spec.js`
- `apps/electerm-agent/test/unit-ci/ai-credential-storage.spec.js`
- `apps/electerm-agent/test/unit-ci/ai-conversation-backend.spec.js`
- `apps/electerm-agent/test/unit-ci/agent-cancellation-status.spec.js`
- `apps/electerm-agent/test/unit-ci/help-center.spec.js`
- `apps/electerm-agent/test/e2e/005.ai-config.spec.js`
- `apps/electerm-agent/test/e2e/006.ai-chat.spec.js`

## Task 1: Add provider-aware profile migration and request contracts

**Files:**

- Create: `apps/electerm-agent/test/unit-ci/ai-provider-profile-contract.spec.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config-props.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-profiles.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-profiles.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-config-required.spec.js`

- [ ] Write failing migration tests.

Add assertions that:

```js
const migrated = migrateAIProfiles({
  activeAIProfileId: 'legacy',
  aiProfiles: [{
    id: 'legacy',
    baseURLAI: 'https://api.example.com/v1',
    modelAI: 'model-a',
    apiKeyAIConfigured: true
  }]
})

assert.equal(migrated.aiProfiles[0].providerIdAI, 'openai-compatible')
assert.equal(migrated.aiProfiles[0].authModeAI, 'api-key')
assert.equal(migrated.activeAIProfileId, 'legacy')
assert.equal(isAIConfigMissing(migrated.aiProfiles[0]), false)
assert.equal(isAIConfigMissing({
  providerIdAI: 'codex',
  authModeAI: 'official-account',
  providerStatusAI: 'authenticated'
}), false)
```

Also verify that a Codex profile is missing when it is not authenticated, while an OpenAI-compatible profile still requires a URL and stored key.

- [ ] Run the tests and confirm the intended failure.

Run:

```powershell
node --test test/unit-ci/ai-provider-profile-contract.spec.js test/unit-ci/ai-profiles.spec.js test/unit-ci/ai-config-required.spec.js
```

Expected: failures mention missing `providerIdAI`, `authModeAI`, or provider-aware required-field handling.

- [ ] Add the non-sensitive profile fields.

Add these keys to `PROFILE_KEYS`, `COMPAT_KEYS`, request-current comparison, import/export sanitation, and status fingerprints:

```js
'providerIdAI',
'authModeAI',
'providerOptionsAI',
'apiKeyAIConfigured',
'providerStatusAI'
```

Normalize profiles with:

```js
next.providerIdAI = next.providerIdAI || 'openai-compatible'
next.authModeAI = next.authModeAI ||
  (next.providerIdAI === 'openai-compatible' ? 'api-key' : 'official-account')
next.providerOptionsAI = next.providerOptionsAI &&
  typeof next.providerOptionsAI === 'object'
  ? { ...next.providerOptionsAI }
  : {}
next.apiKeyAIConfigured = next.apiKeyAIConfigured === true ||
  Boolean(next.apiKeyAI)
```

- [ ] Replace the global required-field array with provider-aware predicates.

Export:

```js
export function getAIConfigMissingFields (config = {}) {
  const providerId = config.providerIdAI || 'openai-compatible'
  if (providerId === 'openai-compatible') {
    return [
      !String(config.baseURLAI || '').trim() && 'baseURLAI',
      config.apiKeyAIConfigured !== true && !String(config.apiKeyAI || '').trim() && 'apiKeyAI'
    ].filter(Boolean)
  }
  if (providerId === 'codex' || providerId === 'grok') {
    return config.providerStatusAI === 'authenticated' ? [] : ['providerAuth']
  }
  if (providerId === 'gemini') {
    return config.apiKeyAIConfigured === true ? [] : ['apiKeyAI']
  }
  return ['providerIdAI']
}

export function isAIConfigMissing (config = {}) {
  return getAIConfigMissingFields(config).length > 0
}
```

- [ ] Run the focused tests again.

Expected: all selected tests pass and legacy profile IDs remain unchanged.

- [ ] Commit the profile contract.

```powershell
git add apps/electerm-agent/src/client/components/ai/ai-config-props.js apps/electerm-agent/src/client/components/ai/ai-profiles.js apps/electerm-agent/test/unit-ci/ai-provider-profile-contract.spec.js apps/electerm-agent/test/unit-ci/ai-profiles.spec.js apps/electerm-agent/test/unit-ci/ai-config-required.spec.js
git commit -m "feat(ai): add provider-aware profile contracts"
```

## Task 2: Keep provider credentials in the main process

**Files:**

- Create: `apps/electerm-agent/src/app/lib/ai-providers/provider-credential-vault.js`
- Create: `apps/electerm-agent/test/unit-ci/ai-provider-credential-vault.spec.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-credential-storage.js`
- Modify: `apps/electerm-agent/src/app/lib/get-config.js`
- Modify: `apps/electerm-agent/src/app/lib/user-config-controller.js`
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- Modify: `apps/electerm-agent/test/unit-ci/ai-credential-storage.spec.js`

- [ ] Write failing tests for public config projection, credential preservation, and revision binding.

The fixture must contain two encrypted profile keys. Assert that:

- public config contains `apiKeyAIConfigured: true`;
- public config contains neither `apiKeyAI` nor `apiKeyAICiphertext`;
- saving an unrelated UI field preserves both ciphertext values;
- replacing a key increments `credentialRevisionAI`;
- resolving with a stale revision fails with `auth-expired`;
- resolving with the current profile ID and revision returns the decrypted key only inside the main-process vault.

- [ ] Run the credential tests and confirm failure.

```powershell
node --test test/unit-ci/ai-provider-credential-vault.spec.js test/unit-ci/ai-credential-storage.spec.js
```

Expected: the new test fails because `getConfig()` currently restores plaintext keys into renderer-visible config.

- [ ] Implement public projection and merge-safe persistence.

The vault API and required behavior are:

- `getPublicConfig()` reads the persisted configuration and returns a deep public projection with `apiKeyAI` and `apiKeyAICiphertext` removed from every profile.
- `setApiKey({ profileId, apiKey, expectedRevision })` rejects an unknown profile or stale revision, encrypts the non-empty key with the existing helper, writes it through a merge against the latest persisted configuration, increments `credentialRevisionAI`, and returns only the public profile summary.
- `clearApiKey({ profileId, expectedRevision })` performs the same optimistic-revision check, removes the ciphertext through a merge-safe write, increments the revision, and returns the public profile summary.
- `resolveProfile({ profileId, credentialRevisionAI })` rejects an unknown or stale profile, decrypts the stored ciphertext inside the main process, and returns the adapter transport fields plus `apiKeyAI`. This method is called only by `AIProviderManager`; it is never exposed through IPC.

`resolveProfile` returns transport fields and a decrypted `apiKeyAI` to adapters, never to renderer IPC. Use the existing `safeEncrypt` and `safeDecrypt`; do not introduce another encryption format.

- [ ] Change `getConfig()` to return only public AI profile data.

Keep encrypted fields in the database and keep `globalState.config` public. Do not place decrypted values or ciphertext in the object returned by `init`.

- [ ] Add controlled credential IPC.

Expose these functions through `asyncGlobals`:

```js
saveAIProviderApiKey({ profileId, apiKey, expectedRevision })
clearAIProviderApiKey({ profileId, expectedRevision })
```

Both return a public profile summary with the new revision. Reject unknown profile IDs and stale revisions.

- [ ] Update the configuration form.

The password field starts empty even when a key exists. Show an “已安全保存；留空表示不修改” hint when `apiKeyAIConfigured` is true. On submit:

1. call `saveAIProviderApiKey` only when the field contains a new value;
2. update the profile revision from the IPC result;
3. remove `apiKeyAI` before calling `onSubmit`;
4. never restore keys from local configuration history.

- [ ] Run tests and inspect serialized configuration.

```powershell
node --test test/unit-ci/ai-provider-credential-vault.spec.js test/unit-ci/ai-credential-storage.spec.js
npm run lint
```

Expected: tests pass; lint has no errors in touched files. A JSON serialization of the public config contains neither `apiKeyAI` nor `apiKeyAICiphertext`.

- [ ] Commit the credential boundary.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/provider-credential-vault.js apps/electerm-agent/src/app/lib/ai-credential-storage.js apps/electerm-agent/src/app/lib/get-config.js apps/electerm-agent/src/app/lib/user-config-controller.js apps/electerm-agent/src/app/lib/ipc.js apps/electerm-agent/src/client/components/ai/ai-config.jsx apps/electerm-agent/test/unit-ci/ai-provider-credential-vault.spec.js apps/electerm-agent/test/unit-ci/ai-credential-storage.spec.js
git commit -m "feat(ai): keep provider credentials in main process"
```

## Task 3: Build normalized errors, events, and stdio JSON-RPC

**Files:**

- Create: `apps/electerm-agent/src/app/lib/ai-providers/provider-contract.js`
- Create: `apps/electerm-agent/src/app/lib/ai-providers/provider-error.js`
- Create: `apps/electerm-agent/src/app/lib/ai-providers/provider-event-store.js`
- Create: `apps/electerm-agent/src/app/lib/ai-providers/stdio-json-rpc-client.js`
- Create: `apps/electerm-agent/test/unit-ci/ai-provider-event-store.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/stdio-json-rpc-client.spec.js`

- [ ] Write event-store tests.

Cover:

- monotonically increasing cursors;
- bounded event count and text size;
- terminal events close a request exactly once;
- reading with a cursor returns only later events;
- cancellation is idempotent;
- expired sessions return `request-cancelled`;
- secret-like fields are redacted before storage.

- [ ] Write fake-child JSON-RPC tests.

Use `PassThrough` streams and assert:

- one-line requests include JSON-RPC IDs;
- out-of-order responses resolve the correct promise;
- notifications reach subscribers;
- server requests reach the registered handler and receive a response;
- malformed lines are ignored and counted without crashing;
- timeout, child exit, and `dispose()` reject pending calls;
- stderr is bounded and redacted.

- [ ] Run both new test files and confirm failure.

```powershell
node --test test/unit-ci/ai-provider-event-store.spec.js test/unit-ci/stdio-json-rpc-client.spec.js
```

- [ ] Implement the provider constants and error taxonomy.

Export the approved IDs, modes, event types, terminal event types, and error codes from `provider-contract.js`. `ProviderError` must serialize only:

```js
{
  code,
  providerId,
  message,
  retryable,
  action,
  details
}
```

Map authentication, quota, rate-limit, model, network, protocol, timeout, cancellation, tool, and child-process failures to the approved codes. Do not include stack traces in serialized errors.

- [ ] Implement the bounded event store.

Use a per-request record with provider ID, profile ID, mode, events, cursor, terminal state, creation time, and cleanup timer. Store safe usage totals but not prompts, raw tool output, credentials, or authorization headers.

- [ ] Implement `StdioJsonRpcClient`.

Use `child_process.spawn` with:

```js
{
  shell: false,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe']
}
```

Parse newline-delimited JSON with `readline.createInterface`. Add `request`, `notify`, `onNotification`, `onServerRequest`, `cancelPending`, and `dispose`.

- [ ] Run the tests.

Expected: both files pass, including process-exit cleanup and malformed-input coverage.

- [ ] Commit the protocol primitives.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/provider-contract.js apps/electerm-agent/src/app/lib/ai-providers/provider-error.js apps/electerm-agent/src/app/lib/ai-providers/provider-event-store.js apps/electerm-agent/src/app/lib/ai-providers/stdio-json-rpc-client.js apps/electerm-agent/test/unit-ci/ai-provider-event-store.spec.js apps/electerm-agent/test/unit-ci/stdio-json-rpc-client.spec.js
git commit -m "feat(ai): add provider protocol primitives"
```

## Task 4: Add the manager and wrap the existing OpenAI-compatible backend

**Files:**

- Create: `apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js`
- Create: `apps/electerm-agent/src/app/lib/ai-providers/openai-compatible-provider.js`
- Create: `apps/electerm-agent/src/client/components/ai/ai-provider-client.js`
- Create: `apps/electerm-agent/test/unit-ci/ai-provider-manager.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/openai-compatible-provider.spec.js`
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-health-coordinator.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-skill-creator-controller.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-task-controller.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-conversation-backend.spec.js`

- [ ] Write manager contract tests with fake adapters.

Assert:

- duplicate provider IDs are rejected;
- unsupported capabilities fail explicitly;
- profile provider ID selects exactly one adapter;
- no automatic fallback occurs after a failure;
- active request IDs are unique;
- switching or logging out while a request is active returns `provider-unavailable` with action `stop-active-task`;
- cancel and dispose are idempotent;
- every started request reaches one terminal event.

- [ ] Write OpenAI wrapper parity tests.

Inject the current functions from `src/app/lib/ai.js`. Verify exact argument ordering for health check, model listing, chat, tool chat, cancellation, and stream polling. Existing endpoint, proxy, custom-header, retry, and error semantics must not change.

- [ ] Run the tests and confirm failure.

```powershell
node --test test/unit-ci/ai-provider-manager.spec.js test/unit-ci/openai-compatible-provider.spec.js test/unit-ci/ai-conversation-backend.spec.js
```

- [ ] Implement `AIProviderManager`.

Its public methods use object arguments:

```js
getCapabilities({ providerId })
getStatus({ providerId, refresh })
login({ providerId, flow })
cancelLogin({ providerId, loginId })
logout({ providerId })
listModels({ profileId, credentialRevisionAI })
healthCheck({ profileId, credentialRevisionAI, model })
startRequest(providerRequest)
readEvents({ requestId, cursor })
cancel({ requestId })
getActivity()
dispose()
```

Validate requests before adapter selection. Resolve credentials in the manager immediately before invocation and remove them from any copied request object after the adapter call is created.

- [ ] Implement `OpenAICompatibleProvider`.

For streaming chat, call the existing `AIchat` with streaming enabled, emit only newly appended text as `text-delta`, poll `getStreamContent`, and emit one terminal event. For Agent, retain the existing `AIchatWithTools` model loop but delegate every tool batch to the provider tool gateway introduced in Task 7.

- [ ] Add controlled IPC.

Expose only the manager methods through `asyncGlobals`. Do not expose adapter instances or provider credentials. Keep legacy IPC temporarily for tests and rollback, but route renderer production calls through `ai-provider-client.js`.

- [ ] Migrate non-Agent renderer call sites.

`ai-provider-client.js` builds:

```js
{
  requestId,
  conversationId,
  mode,
  providerId,
  profileId,
  credentialRevisionAI,
  model,
  messages,
  systemPrompt,
  sshContext
}
```

It polls normalized events, assembles text, handles terminal errors, and calls the existing history update callbacks.

- [ ] Run parity and focused UI tests.

```powershell
node --test test/unit-ci/ai-provider-manager.spec.js test/unit-ci/openai-compatible-provider.spec.js test/unit-ci/ai-conversation-backend.spec.js test/unit-ci/ai-health-coordinator.spec.js
```

Expected: OpenAI-compatible profiles behave as before and renderer request objects contain no `apiKeyAI`.

- [ ] Commit the manager and compatibility adapter.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js apps/electerm-agent/src/app/lib/ai-providers/openai-compatible-provider.js apps/electerm-agent/src/app/lib/ipc.js apps/electerm-agent/src/client/components/ai/ai-provider-client.js apps/electerm-agent/src/client/components/ai/ai-health-coordinator.js apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx apps/electerm-agent/src/client/components/ai/agent-skill-creator-controller.js apps/electerm-agent/src/client/components/ai/agent-task-controller.js apps/electerm-agent/test/unit-ci/ai-provider-manager.spec.js apps/electerm-agent/test/unit-ci/openai-compatible-provider.spec.js apps/electerm-agent/test/unit-ci/ai-conversation-backend.spec.js
git commit -m "feat(ai): route requests through provider manager"
```

## Task 5: Implement Codex discovery, app-server lifecycle, account login, and models

**Files:**

- Create: `apps/electerm-agent/src/app/lib/ai-providers/codex-provider.js`
- Create: `apps/electerm-agent/test/unit-ci/codex-provider.spec.js`
- Modify: `apps/electerm-agent/src/app/lib/local-cli.js`
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
- Modify: `apps/electerm-agent/test/unit-ci/agent-local-cli.spec.js`

- [ ] Write Codex provider tests with a fake JSON-RPC client.

Cover:

- system CLI success;
- inaccessible Windows Store alias followed by Codex Desktop bundled CLI success;
- not installed;
- `initialize` handshake;
- missing required app-server methods mapped to `protocol-incompatible`;
- `account/read`;
- browser and device-code login results;
- `account/login/completed` and `account/updated`;
- login cancellation;
- logout;
- `model/list` pagination and hidden-model filtering;
- child crash and restart;
- no read of `auth.json` or `.codex/auth`.

- [ ] Run the Codex tests and confirm failure.

```powershell
node --test test/unit-ci/codex-provider.spec.js test/unit-ci/agent-local-cli.spec.js
```

- [ ] Reuse the existing resolver and add capability probing.

Export the existing Codex resolver without duplicating candidate-path logic. Start:

```text
codex app-server --stdio
```

using the resolved executable and its argument prefix. Send:

```js
await rpc.request('initialize', {
  clientInfo: {
    name: 'shellpilot',
    title: 'ShellPilot',
    version: appVersion
  },
  capabilities: {
    optOutNotificationMethods: [
      'item/reasoning/textDelta'
    ]
  }
})
rpc.notify('initialized', {})
```

Probe `account/read` and `model/list`; convert JSON-RPC method-not-found failures to `protocol-incompatible` with upgrade guidance.

- [ ] Implement account methods.

Browser login request:

```js
rpc.request('account/login/start', {
  type: 'chatgpt',
  useHostedLoginSuccessPage: true,
  appBrand: 'codex'
})
```

Device fallback:

```js
rpc.request('account/login/start', {
  type: 'chatgptDeviceCode'
})
```

Open only the returned HTTPS authentication URL with the system browser. Track `loginId`; resolve status from completion notifications; never inspect official credential files.

- [ ] Implement model discovery.

Call `model/list` with `includeHidden: false` and paginate via `nextCursor`. Preserve the last verified model list when refresh fails. Return model IDs, display names, supported reasoning efforts, default effort, modalities, and default marker.

- [ ] Run the tests.

Expected: all Codex provider and resolver tests pass, including Windows fallback and protocol-incompatible cases.

- [ ] Commit Codex authentication and discovery.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/codex-provider.js apps/electerm-agent/src/app/lib/local-cli.js apps/electerm-agent/src/app/lib/ipc.js apps/electerm-agent/test/unit-ci/codex-provider.spec.js apps/electerm-agent/test/unit-ci/agent-local-cli.spec.js
git commit -m "feat(ai): add Codex account and model provider"
```

## Task 6: Add Codex streaming chat and cancellation

**Files:**

- Modify: `apps/electerm-agent/src/app/lib/ai-providers/codex-provider.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-provider-client.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat.jsx`
- Modify: `apps/electerm-agent/test/unit-ci/codex-provider.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/agent-cancellation-status.spec.js`

- [ ] Add failing tests for a full Codex chat lifecycle.

The fake server sequence must include:

1. `thread/start`;
2. `turn/start`;
3. two `item/agentMessage/delta` notifications;
4. final `item/completed` agent message;
5. `turn/completed`.

Assert that duplicate final text is not emitted, usage is normalized, and a request ends once.

- [ ] Add failure and cancellation tests.

Cover:

- `Unauthorized` becomes `auth-required`;
- `UsageLimitExceeded` becomes `quota-exceeded`;
- hidden or removed model becomes `model-unavailable`;
- `turn/interrupt` produces `cancelled`;
- cancellation before `turn/start` response still interrupts once the turn ID is known;
- process crash becomes `provider-crashed`;
- no request is automatically replayed.

- [ ] Implement chat thread and turn handling.

For ordinary chat:

- create or resume one Codex thread per ShellPilot conversation and profile;
- use an app-owned empty temporary directory as `cwd`;
- set `approvalPolicy: 'never'`;
- set `sandboxPolicy: { type: 'readOnly', access: { type: 'restricted', includePlatformDefaults: true, readableRoots: [tempDir] } }`;
- attach no MCP server;
- decline all server-initiated command, file-change, and permission requests;
- emit only normalized text, completion, usage, cancellation, and failure events.

- [ ] Implement deterministic cancellation.

Store `requestId -> { threadId, turnId, rpc, child }`. First call `turn/interrupt`; after a bounded grace period terminate only that app-server child. Do not kill unrelated Codex CLI or Desktop processes.

- [ ] Run focused tests.

```powershell
node --test test/unit-ci/codex-provider.spec.js test/unit-ci/agent-cancellation-status.spec.js test/unit-ci/ai-chat-stream-poll.spec.js
```

Expected: streaming, cancellation, and failure mappings pass with no duplicate terminal event.

- [ ] Commit Codex chat.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/codex-provider.js apps/electerm-agent/src/client/components/ai/ai-provider-client.js apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx apps/electerm-agent/src/client/components/ai/ai-chat.jsx apps/electerm-agent/test/unit-ci/codex-provider.spec.js apps/electerm-agent/test/unit-ci/agent-cancellation-status.spec.js
git commit -m "feat(ai): add Codex streaming chat"
```

## Task 7: Build the request-scoped Provider Tool Gateway

**Files:**

- Create: `apps/electerm-agent/src/app/lib/ai-providers/provider-tool-bridge.js`
- Create: `apps/electerm-agent/src/client/components/ai/provider-agent-tool-session.js`
- Create: `apps/electerm-agent/test/unit-ci/provider-tool-bridge.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/provider-agent-tool-session.spec.js`
- Modify: `apps/electerm-agent/src/app/preload/preload.js`
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent.js`

- [ ] Write main-process bridge security tests.

Assert:

- the server listens on `127.0.0.1` and an OS-selected port;
- a 32-byte random token is generated per request;
- missing, wrong, expired, or revoked bearer tokens return 401;
- a token is bound to one request ID, one renderer `webContents.id`, one exact endpoint key, and one tool allowlist;
- `run_local_cli`, `list_local_cli_tools`, and `get_codex_cli_status` are absent;
- tool names outside the allowlist are rejected before renderer dispatch;
- renderer responses from a different sender are ignored;
- token, headers, and raw tool arguments never enter logs;
- stop closes HTTP transports and rejects pending invocations.

- [ ] Write renderer session tests.

Mock `executeToolCall` and verify:

- the current endpoint is re-resolved before every call;
- endpoint mismatch rejects before execution;
- takeover authorization is active;
- risky calls still create the existing frozen confirmation transaction;
- readonly calls use the existing fast path;
- output is bounded and sanitized;
- cancellation calls `cancelAgentRuntimeOperations`;
- a completed, cancelled, disconnected, or endpoint-changed session cannot execute later calls.

- [ ] Run the bridge tests and confirm failure.

```powershell
node --test test/unit-ci/provider-tool-bridge.spec.js test/unit-ci/provider-agent-tool-session.spec.js
```

- [ ] Implement the loopback MCP bridge.

Reuse `McpServer` and `StreamableHTTPServerTransport`, but do not instantiate or call `widget-mcp-server.js`. Start Express with `app.listen(0, '127.0.0.1')`. Authenticate with a constant-time bearer comparison. Reject requests with a non-empty browser `Origin` header.

Register only renderer-supplied public schemas whose names also exist in the main-process allowlist. A handler sends:

```js
{
  bridgeId,
  requestId,
  endpointKey,
  toolCallId,
  toolName,
  args
}
```

on `ai-provider-tool-request` and waits for a matching `ai-provider-tool-response`.

- [ ] Add narrow preload methods.

Expose:

```js
onAIProviderToolRequest(callback)
sendAIProviderToolResponse(response)
```

Do not expose arbitrary IPC channel names through these helpers.

- [ ] Implement the renderer session.

Refactor the runtime construction currently nested in `runAgentLoop` into a reusable function. The session builds the same:

- exact endpoint resolver;
- takeover registry;
- abort signal;
- cancellation set;
- selected Skill bindings;
- artifact tracking;
- tool presentation log.

Every bridge request calls the existing `executeToolCall(toolName, args, runtime)`. Do not create a second policy engine.

- [ ] Add lifecycle revocation.

Revoke the bridge on:

- request cancellation;
- request terminal event;
- tab close;
- SSH disconnect;
- host, port, username, process, or host-key fingerprint change;
- takeover disabled;
- provider switch;
- application shutdown.

- [ ] Run bridge and existing safety tests.

```powershell
node --test test/unit-ci/provider-tool-bridge.spec.js test/unit-ci/provider-agent-tool-session.spec.js test/unit-ci/agent-tool-gateway.spec.js test/unit-ci/agent-takeover-lifecycle.spec.js test/unit-ci/agent-risk-transaction.spec.js
```

Expected: all pass; the new bridge never bypasses existing confirmation or endpoint checks.

- [ ] Commit the tool gateway.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/provider-tool-bridge.js apps/electerm-agent/src/app/preload/preload.js apps/electerm-agent/src/app/lib/ipc.js apps/electerm-agent/src/client/components/ai/provider-agent-tool-session.js apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/test/unit-ci/provider-tool-bridge.spec.js apps/electerm-agent/test/unit-ci/provider-agent-tool-session.spec.js
git commit -m "feat(ai): add scoped provider tool gateway"
```

## Task 8: Connect Codex Agent to the controlled MCP bridge

**Files:**

- Modify: `apps/electerm-agent/src/app/lib/ai-providers/codex-provider.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent.js`
- Modify: `apps/electerm-agent/src/client/components/ai/provider-agent-tool-session.js`
- Modify: `apps/electerm-agent/test/unit-ci/codex-provider.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/provider-agent-tool-session.spec.js`
- Modify: `apps/electerm-agent/test/e2e/026.ai-takeover.spec.js`

- [ ] Add a failing Codex Agent integration test.

The fake app-server must:

- connect to the bridge with the bearer token;
- list only allowed ShellPilot tools;
- call one readonly tool;
- call one risky tool and receive a declined result;
- emit final assistant text;
- receive no local credential or SSH secret.

Assert that the risky operation is not dispatched and that the final history records provider ID, model, and safe tool presentation.

- [ ] Add cancellation-after-side-effect tests.

Simulate a tool result whose mutation was dispatched but verification was interrupted. Assert:

- Codex is interrupted;
- the bridge is revoked;
- the task is marked “状态不确定，请验证”;
- there is no automatic tool retry, model replay, or provider fallback.

- [ ] Start Codex app-server with request-scoped MCP configuration.

Use command-line config overrides that replace the effective MCP set for this child. Pass the token only through the child environment:

```js
const envName = 'SHELLPILOT_PROVIDER_CAPABILITY_TOKEN'
const mcpConfig = {
  shellpilot: {
    url: bridge.url,
    bearer_token_env_var: envName,
    required: true,
    enabled_tools: bridge.toolNames
  }
}
```

Serialize `mcp_servers=<TOML inline table>` as one `-c` value. Set `env[envName] = bridge.token`. Never put the token directly in process arguments.

- [ ] Start the Agent thread in a read-only native sandbox.

Use an empty app-owned temporary directory. Set `approvalPolicy: 'never'`, read-only sandbox policy, and a system instruction that requires ShellPilot MCP tools for SSH work. Decline native permission-escalation requests. Native read-only commands may remain available only inside the empty temporary directory.

- [ ] Replace the OpenAI-only renderer Agent loop entry point.

`runAgentLoop` becomes a provider-neutral coordinator:

1. select Skills and build system instructions;
2. create the exact endpoint runtime;
3. register the renderer tool session;
4. call `AIProviderStartRequest` with `mode: 'agent'`;
5. consume normalized events;
6. update history and tool presentation;
7. cancel provider, bridge, pending confirmation, and active tool as one operation.

The OpenAI-compatible adapter and Codex adapter both use this path.

- [ ] Run unit and E2E tests.

```powershell
node --test test/unit-ci/codex-provider.spec.js test/unit-ci/provider-agent-tool-session.spec.js test/unit-ci/agent-cancellation-status.spec.js
npx playwright test test/e2e/026.ai-takeover.spec.js --workers=1
```

Expected: tests pass; Codex can use the controlled tool and cannot bypass a declined risky action.

- [ ] Commit Codex Agent.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/codex-provider.js apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/src/client/components/ai/provider-agent-tool-session.js apps/electerm-agent/test/unit-ci/codex-provider.spec.js apps/electerm-agent/test/unit-ci/provider-agent-tool-session.spec.js apps/electerm-agent/test/e2e/026.ai-takeover.spec.js
git commit -m "feat(ai): connect Codex to controlled Agent tools"
```

## Task 9: Add the Codex provider card, status actions, and phase documentation

**Files:**

- Create: `apps/electerm-agent/src/client/components/ai/ai-provider-card.jsx`
- Create: `apps/electerm-agent/test/unit-ci/codex-provider-ui.spec.js`
- Create: `apps/electerm-agent/docs/AI_PROVIDERS_TROUBLESHOOTING_ZH.md`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- Modify: `apps/electerm-agent/src/client/components/side-panel-r/right-side-panel-ai-header.jsx`
- Modify: `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-help-content.js`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/docs/USER_GUIDE_ZH.md`
- Modify: `apps/electerm-agent/README.md`
- Modify: `apps/electerm-agent/test/unit-ci/help-center.spec.js`
- Modify: `apps/electerm-agent/test/e2e/005.ai-config.spec.js`

- [ ] Write structural UI tests first.

Assert the Codex card exposes:

- 未安装、未登录、登录中、已登录、连接异常、版本不兼容;
- 登录、设备码登录、取消登录、重新连接、退出登录、拉取模型、测试连接、设为当前、使用说明;
- account email and plan only when provided by the official protocol;
- explicit warning before logout;
- login success does not call the active-profile switch handler;
- active requests disable switch and logout actions.

- [ ] Run the UI tests and confirm failure.

```powershell
node --test test/unit-ci/codex-provider-ui.spec.js test/unit-ci/help-center.spec.js
```

- [ ] Implement the reusable provider card and Codex presentation.

Keep the existing advanced OpenAI-compatible fields. The card receives status and capability data rather than inferring support from provider ID. “使用说明” opens the help center at the Codex subsection.

- [ ] Update the side-panel selectors and health badge.

Use `isAIConfigMissing` and provider health data instead of testing `baseURLAI && apiKeyAI`. Show Codex model options returned by the account. Block profile or model changes while the manager reports an active request.

- [ ] Write Chinese documentation.

Document:

- system CLI and Codex Desktop bundled CLI detection;
- browser and device-code login;
- account status and model refresh;
- shared-login-state logout warning;
- subscription usage versus API billing;
- Agent takeover requirement and risk confirmation;
- Windows Store alias permission failure and bundled CLI fallback;
- browser callback failure;
- expired login, quota, missing model, incompatible version, proxy, and corporate CA diagnosis;
- privacy boundary and explicit statement that ShellPilot never reads `auth.json`.

- [ ] Run help and E2E tests.

```powershell
node --test test/unit-ci/codex-provider-ui.spec.js test/unit-ci/help-center.spec.js test/unit-ci/ai-provider-guide.spec.js
npx playwright test test/e2e/005.ai-config.spec.js test/e2e/006.ai-chat.spec.js --workers=1
```

Expected: card actions, deep-linked help, legacy advanced configuration, and chat all pass.

- [ ] Commit the Codex UI and guide.

```powershell
git add apps/electerm-agent/src/client/components/ai/ai-provider-card.jsx apps/electerm-agent/src/client/components/ai/ai-config.jsx apps/electerm-agent/src/client/components/side-panel-r/right-side-panel-ai-header.jsx apps/electerm-agent/src/client/components/main/help-center-modal.jsx apps/electerm-agent/src/client/common/shellpilot-help-content.js apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/docs/AI_PROVIDERS_TROUBLESHOOTING_ZH.md apps/electerm-agent/docs/USER_GUIDE_ZH.md apps/electerm-agent/README.md apps/electerm-agent/test/unit-ci/codex-provider-ui.spec.js apps/electerm-agent/test/unit-ci/help-center.spec.js apps/electerm-agent/test/e2e/005.ai-config.spec.js
git commit -m "docs(ai): add Codex provider guidance"
```

## Task 10: Verify phase 1 as a backward-compatible milestone

**Files:**

- Modify only files required by test findings.

- [ ] Run static checks.

```powershell
npm run lint
```

Expected: exit code 0.

- [ ] Run the full unit suite.

```powershell
npm run test-unit-ci
```

Expected: exit code 0 with no skipped provider security tests.

- [ ] Run the AI and takeover E2E slice.

```powershell
npx playwright test test/e2e/005.ai-config.spec.js test/e2e/006.ai-chat.spec.js test/e2e/026.ai-takeover.spec.js --workers=1
```

Expected: exit code 0.

- [ ] Run an OpenAI-compatible regression smoke without real credentials.

```powershell
npm run smoke:ai
```

Expected: the app starts, reports skipped real-provider checks when credentials are absent, and does not regress existing configuration validation.

- [ ] Perform an opt-in manual Codex smoke.

On a test account and non-production SSH endpoint:

1. verify system CLI and bundled CLI discovery;
2. log in through the official page;
3. confirm login does not switch the active profile;
4. manually set Codex active;
5. fetch models;
6. complete streaming chat;
7. complete one readonly Agent tool call;
8. decline one risky Agent call;
9. cancel an active Agent;
10. confirm no credential appears in logs, history, exported profiles, diagnostics, or test output.

- [ ] Inspect the diff and secret patterns.

```powershell
git diff --check
rg -n "auth\\.json|Authorization: Bearer [A-Za-z0-9]|sk-[A-Za-z0-9]|refresh_token|access_token" apps/electerm-agent/src apps/electerm-agent/test apps/electerm-agent/docs
```

Expected: `git diff --check` is clean. Matches are limited to redaction tests, documentation warnings, and schema labels; no real secret or credential-file read is present.

- [ ] Confirm verification did not pick up unrelated workspace changes.

```powershell
git status --short
git diff --name-only
```

Expected: only files deliberately changed by this phase are listed. If verification exposed a defect, return to the owning task, add a focused regression test, make the fix, rerun that task's exact tests, and stage only those explicitly named files. Do not stage the application directory and do not create an empty verification commit.

## Phase 1 acceptance checklist

- [ ] Existing API profiles preserve ID, endpoint, model, proxy, header, and encrypted key.
- [ ] Renderer-visible config and provider requests contain no credential plaintext or ciphertext.
- [ ] OpenAI-compatible chat, health, model discovery, cancellation, and Agent behavior remain operational.
- [ ] Codex works through official app-server account APIs without reading credential files.
- [ ] Codex login success does not change the active profile.
- [ ] Codex model listing and streaming chat work for the authenticated account.
- [ ] Codex Agent can access only the scoped ShellPilot MCP bridge.
- [ ] Native writes and permission escalation are blocked.
- [ ] Existing SSH endpoint, takeover, classification, confirmation, verification, rollback, and cancellation controls remain authoritative.
- [ ] No automatic provider fallback or post-side-effect retry exists.
- [ ] Codex in-app and repository usage guidance matches the delivered behavior.
