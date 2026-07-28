# ShellPilot Gemini Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gemini as an API-key Provider with main-process secret storage, runtime model discovery, streaming chat, function-calling Agent support, cancellation, and accurate Chinese usage guidance.

**Architecture:** `GeminiProvider` is registered with the existing `AIProviderManager` and calls the official Gemini REST API from the Electron main process. The API key is resolved from the phase-1 credential vault and is sent only in the `x-goog-api-key` header. Ordinary chat uses `streamGenerateContent` with no tools. Agent mode sends ShellPilot function declarations, executes returned function calls through the existing request-scoped Provider Tool Gateway over internal IPC, appends the exact model content plus function responses, and continues until text completion. ShellPilot does not read or reuse Gemini CLI OAuth credentials.

**Tech Stack:** Electron 41, Node.js, Axios stream responses, Gemini `v1beta` Models and Generate Content REST APIs, Server-Sent Events, the phase-1 Provider Manager and Tool Gateway, React 19, Node test runner, Playwright.

---

## Command convention

Run every `node`, `npm`, and `npx` block from `apps/electerm-agent`. Run every `git` block, and every source scan whose paths start with `apps/electerm-agent`, from the repository root. Resolve the root with `git rev-parse --show-toplevel`; do not assume the checkout is on a particular drive.

## Preconditions and release boundary

Complete the Provider core and Codex plan first. Grok may be implemented before or after this plan; Gemini does not depend on Grok.

Initial Gemini delivery includes:

- Google AI Studio Gemini API key;
- encrypted persistence through Electron `safeStorage`;
- model listing and selected-model health check;
- streaming text chat;
- custom function calling for the controlled ShellPilot Agent;
- cancellation and normalized errors;
- Chinese setup, billing, privacy, and troubleshooting guidance.

Initial Gemini delivery does not include:

- reuse of Gemini CLI personal OAuth;
- extraction of Google account cookies or tokens;
- a ShellPilot-owned Google Cloud OAuth client;
- Vertex AI service-account or Application Default Credentials;
- automatic key creation;
- automatic billing enablement.

Google Cloud OAuth remains a later enhancement and must not block this plan.

## File map

### Create

- `apps/electerm-agent/src/app/lib/ai-providers/gemini-sse-parser.js`
- `apps/electerm-agent/src/app/lib/ai-providers/gemini-message-mapper.js`
- `apps/electerm-agent/src/app/lib/ai-providers/gemini-http-client.js`
- `apps/electerm-agent/src/app/lib/ai-providers/gemini-provider.js`
- `apps/electerm-agent/test/unit-ci/gemini-sse-parser.spec.js`
- `apps/electerm-agent/test/unit-ci/gemini-message-mapper.spec.js`
- `apps/electerm-agent/test/unit-ci/gemini-http-client.spec.js`
- `apps/electerm-agent/test/unit-ci/gemini-provider.spec.js`
- `apps/electerm-agent/test/unit-ci/gemini-provider-ui.spec.js`

### Modify

- `apps/electerm-agent/src/app/lib/ai-providers/provider-credential-vault.js`
- `apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js`
- `apps/electerm-agent/src/app/lib/ai-providers/provider-tool-bridge.js`
- `apps/electerm-agent/src/app/lib/ipc.js`
- `apps/electerm-agent/src/client/components/ai/ai-profiles.js`
- `apps/electerm-agent/src/client/components/ai/ai-config-props.js`
- `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- `apps/electerm-agent/src/client/components/ai/provider-agent-tool-session.js`
- `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`
- `apps/electerm-agent/src/client/common/shellpilot-help-content.js`
- `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- `apps/electerm-agent/docs/AI_PROVIDERS_TROUBLESHOOTING_ZH.md`
- `apps/electerm-agent/docs/USER_GUIDE_ZH.md`
- `apps/electerm-agent/README.md`
- `apps/electerm-agent/test/unit-ci/ai-provider-credential-vault.spec.js`
- `apps/electerm-agent/test/unit-ci/ai-provider-manager.spec.js`
- `apps/electerm-agent/test/unit-ci/provider-tool-bridge.spec.js`
- `apps/electerm-agent/test/unit-ci/help-center.spec.js`
- `apps/electerm-agent/test/e2e/005.ai-config.spec.js`
- `apps/electerm-agent/test/e2e/006.ai-chat.spec.js`
- `apps/electerm-agent/test/e2e/026.ai-takeover.spec.js`

## Task 1: Extend the credential vault for Gemini API keys

**Files:**

- Modify: `apps/electerm-agent/src/app/lib/ai-providers/provider-credential-vault.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-profiles.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config-props.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-provider-credential-vault.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-provider-profile-contract.spec.js`

- [ ] Add failing Gemini credential tests.

Assert:

- `providerIdAI: 'gemini'` defaults to `authModeAI: 'api-key'`;
- a Gemini profile is configured only when `apiKeyAIConfigured` is true and a model is selected;
- `saveAIProviderApiKey` encrypts a Gemini key with the existing format;
- public profile data contains no plaintext or ciphertext;
- stale credential revisions are rejected;
- clearing the key sets `apiKeyAIConfigured` false;
- exported profiles omit the key and ciphertext.

- [ ] Run the focused tests.

```powershell
node --test test/unit-ci/ai-provider-credential-vault.spec.js test/unit-ci/ai-provider-profile-contract.spec.js
```

Expected: Gemini-specific assertions fail.

- [ ] Add Gemini profile defaults and validation.

Use:

```js
if (next.providerIdAI === 'gemini') {
  next.authModeAI = 'api-key'
}
```

Required fields are `apiKeyAIConfigured` and `modelAI`. `baseURLAI` is not a user-required field for the official Gemini Provider. Keep an optional advanced endpoint override out of the initial UI.

- [ ] Reuse the vault without a new secret field.

Continue storing the profile key through `apiKeyAICiphertext`. Provider ID and credential revision determine meaning. Do not create `geminiApiKey` in renderer config.

- [ ] Run tests.

Expected: all focused credential and profile tests pass.

- [ ] Commit the Gemini credential contract.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/provider-credential-vault.js apps/electerm-agent/src/client/components/ai/ai-profiles.js apps/electerm-agent/src/client/components/ai/ai-config-props.js apps/electerm-agent/test/unit-ci/ai-provider-credential-vault.spec.js apps/electerm-agent/test/unit-ci/ai-provider-profile-contract.spec.js
git commit -m "feat(ai): add Gemini credential contract"
```

## Task 2: Implement SSE parsing and Gemini message mapping

**Files:**

- Create: `apps/electerm-agent/src/app/lib/ai-providers/gemini-sse-parser.js`
- Create: `apps/electerm-agent/src/app/lib/ai-providers/gemini-message-mapper.js`
- Create: `apps/electerm-agent/test/unit-ci/gemini-sse-parser.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/gemini-message-mapper.spec.js`

- [ ] Write SSE parser tests.

Cover:

- CRLF and LF event boundaries;
- multiple `data:` lines;
- chunk boundaries inside UTF-8 characters;
- chunk boundaries inside JSON;
- comment and empty events;
- final event without trailing blank line;
- malformed JSON reported as `protocol-incompatible`;
- maximum event and total-stream byte limits;
- cancellation stops parsing immediately.

- [ ] Write message-mapper tests.

Map:

- `system` messages to `systemInstruction.parts`;
- `user` messages to Gemini role `user`;
- `assistant` messages to Gemini role `model`;
- text-only history in original order;
- unknown roles to safe user-labeled text;
- function declarations from ShellPilot tool descriptors;
- `functionCall` parts with `name`, `args`, and optional `id`;
- `functionResponse` parts with the matching name and ID;
- exact preservation of model parts, including thought-signature fields not interpreted by ShellPilot.

- [ ] Run both tests and confirm failure.

```powershell
node --test test/unit-ci/gemini-sse-parser.spec.js test/unit-ci/gemini-message-mapper.spec.js
```

- [ ] Implement a bounded incremental SSE parser.

Use `StringDecoder('utf8')`. The parser accepts Node stream chunks and calls `onEvent(parsedJson)` only after a complete event. It must not log raw event bodies.

- [ ] Implement message and tool mapping.

Function declaration mapping:

```js
function toGeminiFunctionDeclaration (tool) {
  return {
    name: tool.function.name,
    description: tool.function.description,
    parametersJsonSchema: tool.function.parameters
  }
}
```

If the installed API rejects `parametersJsonSchema`, retry only before any tool execution with the equivalent `parameters` field. Record the selected schema mode for the request; do not retry after side effects.

- [ ] Run tests.

Expected: SSE and message-mapping tests pass.

- [ ] Commit protocol mapping.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/gemini-sse-parser.js apps/electerm-agent/src/app/lib/ai-providers/gemini-message-mapper.js apps/electerm-agent/test/unit-ci/gemini-sse-parser.spec.js apps/electerm-agent/test/unit-ci/gemini-message-mapper.spec.js
git commit -m "feat(ai): add Gemini stream and message mapping"
```

## Task 3: Build the authenticated Gemini HTTP client and model discovery

**Files:**

- Create: `apps/electerm-agent/src/app/lib/ai-providers/gemini-http-client.js`
- Create: `apps/electerm-agent/test/unit-ci/gemini-http-client.spec.js`

- [ ] Write HTTP client tests with an injected Axios instance.

Assert:

- base origin is exactly `https://generativelanguage.googleapis.com`;
- API key is sent through `x-goog-api-key`;
- API key is absent from URL, query parameters, logs, errors, and response metadata;
- model listing paginates with `nextPageToken`;
- only models supporting `generateContent` are returned;
- `models/` prefix is removed from selector values;
- selected model health uses the selected model;
- AbortSignal reaches Axios;
- proxy settings use the existing proxy-agent helper;
- 400, 401, 403, 404, 429, quota, 5xx, timeout, abort, and malformed response errors map correctly.

- [ ] Run the HTTP test and confirm failure.

```powershell
node --test test/unit-ci/gemini-http-client.spec.js
```

- [ ] Implement the HTTP client.

The client accepts injected `axiosImpl`, `createProxyAgent`, and base origin. Use:

```js
headers: {
  'Content-Type': 'application/json',
  'x-goog-api-key': apiKey
}
```

Never use `?key=`. Apply a bounded timeout and maximum response size. Disable generic Axios retries.

- [ ] Implement model listing.

Call:

```text
GET /v1beta/models?pageSize=1000
```

and follow `nextPageToken`. Return:

```js
{
  id,
  name,
  displayName,
  description,
  inputTokenLimit,
  outputTokenLimit,
  supportedGenerationMethods,
  thinking
}
```

Filter to models whose `supportedGenerationMethods` includes `generateContent`.

- [ ] Implement selected-model health.

First verify the model is in the discovered list. Then make a minimal `generateContent` request with a short fixed health prompt and a small output limit. Do not persist the prompt or response.

- [ ] Run HTTP tests.

Expected: all authentication, pagination, health, cancellation, and error mapping tests pass.

- [ ] Commit the Gemini client.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/gemini-http-client.js apps/electerm-agent/test/unit-ci/gemini-http-client.spec.js
git commit -m "feat(ai): add Gemini HTTP client"
```

## Task 4: Register Gemini and add ordinary streaming chat

**Files:**

- Create: `apps/electerm-agent/src/app/lib/ai-providers/gemini-provider.js`
- Create: `apps/electerm-agent/test/unit-ci/gemini-provider.spec.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js`
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-provider-client.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-provider-manager.spec.js`
- Modify: `apps/electerm-agent/test/e2e/006.ai-chat.spec.js`

- [ ] Write provider contract tests.

Capabilities must declare:

- API-key auth;
- no account login;
- no logout;
- model listing;
- health check;
- streaming chat;
- function-calling Agent;
- cancellation.

Calling `login` or `logout` must fail as unsupported rather than report success.

- [ ] Write streaming chat tests.

Feed SSE responses containing:

- text across several events;
- repeated cumulative candidate content;
- finish reason;
- usage metadata;
- prompt safety block;
- empty candidates;
- malformed response;
- abort;
- network disconnect.

Assert only new text is emitted, usage is normalized, and exactly one terminal event occurs.

- [ ] Run provider and manager tests.

```powershell
node --test test/unit-ci/gemini-provider.spec.js test/unit-ci/ai-provider-manager.spec.js
```

- [ ] Register a lazy Gemini adapter.

The manager resolves the API key by profile ID and credential revision immediately before each call. Clear adapter-local key references in `finally`.

- [ ] Implement ordinary chat.

POST:

```text
/v1beta/models/{encodedModelId}:streamGenerateContent?alt=sse
```

Normalize the selected value by removing one leading `models/`, then apply `encodeURIComponent` to that model ID only. The only query parameter is `alt=sse`. Send `contents` and optional `systemInstruction`; send no `tools`. Accumulate candidate text safely and emit deltas.

- [ ] Implement cancellation.

Store an `AbortController` per request. `cancel(requestId)` aborts Axios and maps the terminal state to `request-cancelled`. Cancellation is idempotent.

- [ ] Run tests and chat E2E.

```powershell
node --test test/unit-ci/gemini-provider.spec.js test/unit-ci/gemini-http-client.spec.js test/unit-ci/ai-provider-manager.spec.js
npx playwright test test/e2e/006.ai-chat.spec.js --workers=1
```

Expected: Gemini streams through the same renderer consumer and attaches no tools in chat mode.

- [ ] Commit Gemini chat.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/gemini-provider.js apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js apps/electerm-agent/src/app/lib/ipc.js apps/electerm-agent/src/client/components/ai/ai-provider-client.js apps/electerm-agent/test/unit-ci/gemini-provider.spec.js apps/electerm-agent/test/unit-ci/ai-provider-manager.spec.js apps/electerm-agent/test/e2e/006.ai-chat.spec.js
git commit -m "feat(ai): add Gemini streaming chat"
```

## Task 5: Add internal function-call dispatch to the Provider Tool Gateway

**Files:**

- Modify: `apps/electerm-agent/src/app/lib/ai-providers/provider-tool-bridge.js`
- Modify: `apps/electerm-agent/src/client/components/ai/provider-agent-tool-session.js`
- Modify: `apps/electerm-agent/test/unit-ci/provider-tool-bridge.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/provider-agent-tool-session.spec.js`

- [ ] Add failing internal-dispatch tests.

Assert:

- Gemini can create a capability session without starting an HTTP listener;
- the session is still bound to request, renderer sender, endpoint, expiry, and tool allowlist;
- `invokeInternal` rejects unknown, revoked, expired, or wrong-endpoint calls;
- a batch of function calls reaches risk-batch preparation before the first execution;
- result text is bounded and sanitized;
- internal sessions share the same lifecycle revocation as HTTP MCP sessions;
- no bearer token is created when no network listener exists.

- [ ] Run bridge tests and confirm failure.

```powershell
node --test test/unit-ci/provider-tool-bridge.spec.js test/unit-ci/provider-agent-tool-session.spec.js
```

- [ ] Generalize bridge sessions.

Support:

```js
createSession({ transport: 'mcp-http', requestId, endpoint, tools, owner })
createSession({ transport: 'internal-ipc', requestId, endpoint, tools, owner })
invokeInternal({ bridgeId, requestId, endpointKey, toolCall })
```

Both transports use the same allowlist, renderer request event, response correlation, expiry, cancellation, and disposal code.

- [ ] Add batch metadata.

For Gemini parallel function calls, send the complete safe call list with the first invocation. The renderer calls existing `prepareAgentRiskBatch` once, then executes calls in returned order. If preparation is declined or fails, do not dispatch any call.

- [ ] Run bridge and safety tests.

```powershell
node --test test/unit-ci/provider-tool-bridge.spec.js test/unit-ci/provider-agent-tool-session.spec.js test/unit-ci/agent-risk-transaction.spec.js test/unit-ci/agent-tool-gateway.spec.js
```

Expected: internal and MCP transports both preserve the existing safety boundary.

- [ ] Commit internal tool dispatch.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/provider-tool-bridge.js apps/electerm-agent/src/client/components/ai/provider-agent-tool-session.js apps/electerm-agent/test/unit-ci/provider-tool-bridge.spec.js apps/electerm-agent/test/unit-ci/provider-agent-tool-session.spec.js
git commit -m "feat(ai): add internal provider tool dispatch"
```

## Task 6: Implement Gemini function-calling Agent loop

**Files:**

- Modify: `apps/electerm-agent/src/app/lib/ai-providers/gemini-provider.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-providers/gemini-message-mapper.js`
- Modify: `apps/electerm-agent/src/client/components/ai/provider-agent-tool-session.js`
- Modify: `apps/electerm-agent/test/unit-ci/gemini-provider.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/gemini-message-mapper.spec.js`
- Modify: `apps/electerm-agent/test/e2e/026.ai-takeover.spec.js`

- [ ] Add failing Agent-loop tests.

Cover:

- one readonly function call followed by final text;
- multiple parallel calls;
- a risky call accepted and verified;
- a risky call declined;
- unknown function;
- invalid arguments;
- tool execution error;
- verification failure;
- model returns text and function call in the same turn;
- maximum iteration limit;
- cancellation during model stream;
- cancellation during tool execution;
- provider failure after a possible side effect.

- [ ] Assert exact Gemini history circulation.

After a function call, append the complete model content object exactly as received:

```js
contents.push(candidate.content)
```

Then append:

```js
{
  role: 'user',
  parts: [{
    functionResponse: {
      name: functionCall.name,
      response: safeResult,
      id: functionCall.id
    }
  }]
}
```

Preserve thought-signature fields carried by model parts. Do not synthesize or inspect them.

- [ ] Send controlled function declarations.

Use the provider-neutral tool catalog already filtered by the bridge. Do not include local CLI tools. Set function-calling mode so the model may answer directly or call tools.

- [ ] Execute calls through `invokeInternal`.

Emit `tool-requested` before dispatch and `tool-completed` after a safe result. Treat returned tool output as untrusted observation. The adapter never calls SSH or SFTP code directly.

- [ ] Enforce no-replay rules.

Before any tool dispatch, a transient network failure may be retried once only if the request body is known to be side-effect free. After the first tool dispatch, disable retries for the remaining Agent request. On ambiguous mutation state, emit failure with action `verify-remote-state`.

- [ ] Run the Agent safety suite.

```powershell
node --test test/unit-ci/gemini-provider.spec.js test/unit-ci/gemini-message-mapper.spec.js test/unit-ci/provider-tool-bridge.spec.js test/unit-ci/provider-agent-tool-session.spec.js
npx playwright test test/e2e/026.ai-takeover.spec.js --workers=1
```

Expected: Gemini uses controlled functions and cannot bypass existing confirmation, verification, rollback, or cancellation.

- [ ] Commit Gemini Agent.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/gemini-provider.js apps/electerm-agent/src/app/lib/ai-providers/gemini-message-mapper.js apps/electerm-agent/src/client/components/ai/provider-agent-tool-session.js apps/electerm-agent/test/unit-ci/gemini-provider.spec.js apps/electerm-agent/test/unit-ci/gemini-message-mapper.spec.js apps/electerm-agent/test/e2e/026.ai-takeover.spec.js
git commit -m "feat(ai): add Gemini controlled Agent tools"
```

## Task 7: Add Gemini configuration card and Chinese guidance

**Files:**

- Create: `apps/electerm-agent/test/unit-ci/gemini-provider-ui.spec.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- Modify: `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-help-content.js`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/docs/AI_PROVIDERS_TROUBLESHOOTING_ZH.md`
- Modify: `apps/electerm-agent/docs/USER_GUIDE_ZH.md`
- Modify: `apps/electerm-agent/README.md`
- Modify: `apps/electerm-agent/test/unit-ci/help-center.spec.js`
- Modify: `apps/electerm-agent/test/e2e/005.ai-config.spec.js`

- [ ] Write UI structure tests.

Assert:

- Gemini card says “API Key” rather than “账号登录”;
- the key field never displays a stored key;
- configured state says the key is safely stored;
- replace and clear key are explicit actions;
- model refresh, test, set-current, and help are present;
- no “使用 Gemini CLI 登录” action exists;
- no Google OAuth claim is shown as delivered;
- active requests block key removal and provider switching.

- [ ] Run UI tests and confirm failure.

```powershell
node --test test/unit-ci/gemini-provider-ui.spec.js test/unit-ci/help-center.spec.js
```

- [ ] Implement Gemini card behavior.

Link API-key creation to the official Google AI Studio key page. Saving a new key calls controlled credential IPC, clears the input, refreshes status, and does not activate Gemini. Clearing a key requires confirmation.

- [ ] Add Chinese documentation.

Document:

- creating a key in Google AI Studio;
- encrypted local storage and renderer masking;
- model refresh and selected-model test;
- free and paid quota boundaries without promising fixed quotas;
- Google Cloud billing requirements;
- privacy and data flow;
- Agent function calls and ShellPilot risk confirmation;
- 400, 401, 403, 404, 429, quota, unavailable model, proxy, CA, and regional-access diagnosis;
- explicit prohibition on reusing Gemini CLI personal OAuth in ShellPilot;
- Google Cloud OAuth is not yet included.

- [ ] Run help and configuration E2E.

```powershell
node --test test/unit-ci/gemini-provider-ui.spec.js test/unit-ci/help-center.spec.js test/unit-ci/ai-provider-guide.spec.js
npx playwright test test/e2e/005.ai-config.spec.js --workers=1
```

Expected: the Gemini card and documentation accurately describe API-key-only delivery.

- [ ] Commit Gemini UI and guide.

```powershell
git add apps/electerm-agent/src/client/components/ai/ai-config.jsx apps/electerm-agent/src/client/components/main/help-center-modal.jsx apps/electerm-agent/src/client/common/shellpilot-help-content.js apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/docs/AI_PROVIDERS_TROUBLESHOOTING_ZH.md apps/electerm-agent/docs/USER_GUIDE_ZH.md apps/electerm-agent/README.md apps/electerm-agent/test/unit-ci/gemini-provider-ui.spec.js apps/electerm-agent/test/unit-ci/help-center.spec.js apps/electerm-agent/test/e2e/005.ai-config.spec.js
git commit -m "docs(ai): add Gemini provider guidance"
```

## Task 8: Verify the Gemini milestone

**Files:**

- Modify only files required by test findings.

- [ ] Run static and unit checks.

```powershell
npm run lint
npm run test-unit-ci
```

Expected: exit code 0.

- [ ] Run AI and Agent E2E.

```powershell
npx playwright test test/e2e/005.ai-config.spec.js test/e2e/006.ai-chat.spec.js test/e2e/026.ai-takeover.spec.js --workers=1
```

Expected: exit code 0.

- [ ] Perform an opt-in real Gemini smoke with a dedicated test key.

1. save the key;
2. close and reopen the configuration modal and confirm the key is not rendered;
3. fetch models;
4. test the selected model;
5. confirm saving the key does not activate Gemini;
6. manually activate Gemini;
7. complete streaming chat;
8. complete one readonly Agent tool;
9. decline one risky Agent tool;
10. cancel a running request;
11. clear the key;
12. inspect logs, history, export, diagnostics, and test artifacts for key leakage.

- [ ] Inspect forbidden patterns and URL construction.

```powershell
git diff --check
rg -n "\\?key=|AIza[A-Za-z0-9_-]+|gemini.*oauth.*cache|\\.gemini.*oauth|x-goog-api-key" apps/electerm-agent/src apps/electerm-agent/test apps/electerm-agent/docs
```

Expected: there is no key in a URL and no Gemini CLI credential-cache read. `x-goog-api-key` appears only in the main-process HTTP client and tests.

- [ ] Confirm verification did not pick up unrelated workspace changes.

```powershell
git status --short
git diff --name-only
```

Expected: only Gemini milestone files are listed. If verification exposed a defect, return to the owning task, add a focused regression test, make the fix, rerun that task's exact tests, and stage only those explicitly named files. Do not stage the application directory and do not create an empty verification commit.

## Gemini acceptance checklist

- [ ] Gemini profiles use API-key auth and never claim account login support.
- [ ] Keys are encrypted with the existing Electron safe-storage path.
- [ ] Renderer-visible config, request objects, history, export, logs, diagnostics, and tests contain no key.
- [ ] Model listing is runtime-driven and filters to generate-content-capable models.
- [ ] Selected-model health checks return normalized status.
- [ ] Ordinary chat sends no tools and streams normalized text.
- [ ] Agent mode sends only the scoped ShellPilot function catalog.
- [ ] Function calls execute through existing endpoint and risk controls.
- [ ] Thought-signature and model content fields are preserved without interpretation.
- [ ] Cancellation covers HTTP stream, pending tool, confirmation, and renderer runtime.
- [ ] No retry or provider fallback occurs after a possible side effect.
- [ ] Gemini CLI OAuth is not read, copied, or reused.
- [ ] Chinese setup and troubleshooting text matches API-key-only delivery.
