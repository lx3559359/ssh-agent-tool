# ShellPilot Grok Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Grok Build as an official-account Provider with installation detection, browser or device login, model discovery, ACP streaming chat, cancellation, and the same safety-gated ShellPilot Agent tools.

**Architecture:** `GrokProvider` is registered with the phase-1 `AIProviderManager`. It discovers the official `grok` executable, manages login as an official CLI child process, and runs `grok agent stdio` as an ACP JSON-RPC agent. Ordinary chat creates an ACP session with no tools. Agent mode creates an ACP session with the request-scoped loopback MCP bridge. Client filesystem and terminal capabilities are disabled, Grok runs with the official read-only sandbox, native local tools are denied, and ShellPilot remains the only executor of SSH effects.

**Tech Stack:** Electron 41, Node.js child processes, the phase-1 `StdioJsonRpcClient`, Agent Client Protocol version 1, Grok Build CLI, the phase-1 Provider Tool Gateway, React 19, Node test runner, Playwright.

---

## Command convention

Run every `node`, `npm`, and `npx` block from `apps/electerm-agent`. Run every `git` block, and every source scan whose paths start with `apps/electerm-agent`, from the repository root. Resolve the root with `git rev-parse --show-toplevel`; do not assume the checkout is on a particular drive.

## Preconditions

Complete and verify `2026-07-28-shellpilot-provider-core-codex.md` first. This plan depends on:

- `AIProviderManager`;
- normalized provider errors and events;
- the public profile and main-process credential boundary;
- `StdioJsonRpcClient`;
- request-scoped `ProviderToolBridge`;
- renderer `provider-agent-tool-session`;
- provider-neutral chat and Agent event consumption;
- reusable provider card and help deep links.

Do not copy Codex adapter logic into the Grok adapter. Reuse the manager, event store, bridge, and renderer safety gateway.

## File map

### Create

- `apps/electerm-agent/src/app/lib/ai-providers/grok-cli-resolver.js`
- `apps/electerm-agent/src/app/lib/ai-providers/grok-login-process.js`
- `apps/electerm-agent/src/app/lib/ai-providers/grok-acp-client.js`
- `apps/electerm-agent/src/app/lib/ai-providers/grok-provider.js`
- `apps/electerm-agent/test/unit-ci/grok-cli-resolver.spec.js`
- `apps/electerm-agent/test/unit-ci/grok-login-process.spec.js`
- `apps/electerm-agent/test/unit-ci/grok-acp-client.spec.js`
- `apps/electerm-agent/test/unit-ci/grok-provider.spec.js`
- `apps/electerm-agent/test/unit-ci/grok-provider-ui.spec.js`

### Modify

- `apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js`
- `apps/electerm-agent/src/app/lib/ipc.js`
- `apps/electerm-agent/src/client/components/ai/ai-profiles.js`
- `apps/electerm-agent/src/client/components/ai/ai-config.jsx`
- `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`
- `apps/electerm-agent/src/client/common/shellpilot-help-content.js`
- `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- `apps/electerm-agent/docs/AI_PROVIDERS_TROUBLESHOOTING_ZH.md`
- `apps/electerm-agent/docs/USER_GUIDE_ZH.md`
- `apps/electerm-agent/README.md`
- `apps/electerm-agent/test/unit-ci/ai-provider-manager.spec.js`
- `apps/electerm-agent/test/unit-ci/help-center.spec.js`
- `apps/electerm-agent/test/e2e/005.ai-config.spec.js`
- `apps/electerm-agent/test/e2e/006.ai-chat.spec.js`
- `apps/electerm-agent/test/e2e/026.ai-takeover.spec.js`

## Task 1: Detect the official Grok Build CLI without installing it

**Files:**

- Create: `apps/electerm-agent/src/app/lib/ai-providers/grok-cli-resolver.js`
- Create: `apps/electerm-agent/test/unit-ci/grok-cli-resolver.spec.js`

- [ ] Write failing resolver tests.

Cover:

- `where.exe grok` on Windows;
- `which grok` on macOS and Linux;
- first located path is inaccessible but a later path works;
- `grok version` and `grok --version` compatibility;
- executable missing;
- executable present but denied;
- command timeout;
- returned status contains no environment variables or home-directory credential paths.

- [ ] Run the new test.

```powershell
node --test test/unit-ci/grok-cli-resolver.spec.js
```

Expected: module-not-found failure.

- [ ] Implement the resolver with dependency injection.

Export `createGrokCliResolver({ execFileImpl, platform, env })`. Default `platform` to `process.platform` and `env` to `process.env`; require `execFileImpl` so tests never probe the developer machine accidentally. The returned resolver must build and deduplicate candidates in this order:

1. an explicit `GROK_CLI_PATH` from the injected environment;
2. every path returned by `where.exe grok` on Windows or `which -a grok` on macOS and Linux;
3. the bare fallback name `grok.exe` and then `grok` on Windows, or `grok` on other platforms, when the locator itself is unavailable.

For each candidate, run `--version` and then `version` only when the first form is rejected as an unsupported argument. Stop at the first successful probe and preserve the executable plus any prefix arguments in the result. If all probes fail, return the last sanitized error without throwing.

Every probe must use `shell: false`, `windowsHide: true`, UTF-8 output, a bounded buffer, and a five-second timeout. Return:

```js
{
  providerId: 'grok',
  installed,
  available,
  file,
  argsPrefix,
  installPath,
  version,
  error
}
```

Do not download, update, or execute an installer.

- [ ] Add an official install guidance constant.

The status should link to `https://docs.x.ai/build/overview` and tell Windows users to follow the current official PowerShell instructions. Do not embed a remotely fetched command for automatic execution.

- [ ] Run resolver tests.

Expected: all cases pass.

- [ ] Commit Grok discovery.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/grok-cli-resolver.js apps/electerm-agent/test/unit-ci/grok-cli-resolver.spec.js
git commit -m "feat(ai): detect Grok Build CLI"
```

## Task 2: Implement ACP transport, authentication probing, and cancellation

**Files:**

- Create: `apps/electerm-agent/src/app/lib/ai-providers/grok-acp-client.js`
- Create: `apps/electerm-agent/test/unit-ci/grok-acp-client.spec.js`

- [ ] Write ACP tests using a fake stdio child.

Cover:

- `initialize` with protocol version 1;
- `clientCapabilities.fs.readTextFile = false`;
- `clientCapabilities.fs.writeTextFile = false`;
- `clientCapabilities.terminal = false`;
- `cached_token` authentication;
- `xai.api_key` is reported but not selected for an official-account profile;
- missing supported auth method becomes `auth-required`;
- `session/new`;
- `session/update` text chunks;
- `session/prompt` completion;
- `session/cancel`;
- child crash;
- request timeout;
- malformed ACP notification;
- duplicate and late updates after cancellation.

- [ ] Run the ACP test and confirm failure.

```powershell
node --test test/unit-ci/grok-acp-client.spec.js
```

- [ ] Implement `GrokAcpClient` on top of `StdioJsonRpcClient`.

Start the official process with:

```js
[
  '--no-auto-update',
  '--sandbox', 'read-only',
  '--disallowed-tools', 'Bash,Edit,Read,Grep,WebFetch,WebSearch',
  'agent', 'stdio'
]
```

Before relying on these controls, probe `grok --help` and require support for `agent stdio`, `--sandbox`, and `--disallowed-tools`. If a required control is absent, return `protocol-incompatible` with an upgrade action instead of starting an unsafe Agent.

- [ ] Implement initialization.

Send:

```js
const init = await rpc.request('initialize', {
  protocolVersion: 1,
  clientCapabilities: {
    fs: {
      readTextFile: false,
      writeTextFile: false
    },
    terminal: false
  },
  clientInfo: {
    name: 'shellpilot',
    version: appVersion
  }
})
```

Select `cached_token` only for `authModeAI: 'official-account'`:

```js
await rpc.request('authenticate', {
  methodId: 'cached_token',
  _meta: { headless: true }
})
```

- [ ] Normalize session updates.

Map `agent_message_chunk` to `text-delta`. Preserve completion stop reason and safe usage when available. Ignore unknown update kinds while recording a bounded protocol diagnostic counter.

- [ ] Implement cancellation.

Call:

```js
rpc.notify('session/cancel', { sessionId })
```

ACP defines `session/cancel` as a notification, so do not wait for a response or retry it as a request. After a bounded grace period terminate only the child owned by the request.

- [ ] Run ACP tests.

Expected: all transport, auth, streaming, cancellation, and crash tests pass.

- [ ] Commit ACP support.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/grok-acp-client.js apps/electerm-agent/test/unit-ci/grok-acp-client.spec.js
git commit -m "feat(ai): add Grok ACP client"
```

## Task 3: Add official browser and device-code login lifecycle

**Files:**

- Create: `apps/electerm-agent/src/app/lib/ai-providers/grok-login-process.js`
- Create: `apps/electerm-agent/src/app/lib/ai-providers/grok-provider.js`
- Create: `apps/electerm-agent/test/unit-ci/grok-login-process.spec.js`

- [ ] Write login-process tests.

With a fake `spawn`, assert:

- browser flow runs `grok login`;
- device flow runs `grok login --device-auth`;
- `shell: false` and `windowsHide: true`;
- a running login has a generated `loginId`;
- safe device URL and user code can be surfaced;
- cancellation kills only the login child;
- successful exit triggers an ACP `cached_token` authentication probe;
- failed exit returns a sanitized error;
- output is bounded and redacts tokens, cookies, authorization headers, and key-shaped strings;
- two concurrent login attempts for the same provider are rejected.

- [ ] Run the login test and confirm failure.

```powershell
node --test test/unit-ci/grok-login-process.spec.js
```

- [ ] Implement browser login.

The official CLI owns the browser ceremony and credential cache. ShellPilot tracks child state but does not parse or copy credentials. Return:

```js
{
  loginId,
  flow: 'browser',
  state: 'pending'
}
```

When the child exits successfully, call the ACP authentication probe. Only then emit authenticated status.

- [ ] Implement device login.

Accept only HTTPS verification URLs from `grok login --device-auth` output. Extract a user code with a conservative uppercase-letter, digit, and dash pattern. Return the safe ceremony data to the card. Never persist it to profile history.

- [ ] Implement cancellation and disposal.

`cancelLogin(loginId)` is idempotent. Provider logout, application shutdown, and a new login attempt dispose the owned login child and pending listeners.

- [ ] Run login tests.

Expected: all pass and the source contains no Grok credential-cache path reads.

- [ ] Commit Grok login lifecycle.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/grok-login-process.js apps/electerm-agent/src/app/lib/ai-providers/grok-provider.js apps/electerm-agent/test/unit-ci/grok-login-process.spec.js
git commit -m "feat(ai): add Grok official login flow"
```

## Task 4: Implement Grok status, logout, and model discovery

**Files:**

- Create: `apps/electerm-agent/src/app/lib/ai-providers/grok-provider.js`
- Create: `apps/electerm-agent/test/unit-ci/grok-provider.spec.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js`
- Modify: `apps/electerm-agent/src/app/lib/ipc.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-provider-manager.spec.js`

- [ ] Write provider tests.

Cover:

- capabilities declare official-account login, device login, models, chat, Agent, streaming, and cancellation;
- installed but unauthenticated;
- authenticated through ACP `cached_token`;
- incompatible ACP;
- logout runs `grok logout`;
- logout completion is verified with a fresh ACP auth probe;
- model discovery prefers ACP session configuration metadata when available;
- fallback `grok models` parsing accepts JSON and line-oriented output;
- duplicate and blank models are removed;
- failure preserves the last verified model list;
- no hard-coded complete model catalog exists.

- [ ] Run provider and manager tests.

```powershell
node --test test/unit-ci/grok-provider.spec.js test/unit-ci/ai-provider-manager.spec.js
```

- [ ] Register `GrokProvider`.

Use a lazy factory so missing Grok does not affect app startup or other providers. `getStatus({refresh:false})` must not spawn a long-lived ACP process when a recent status is cached.

- [ ] Implement model parsing.

Prefer a machine-readable output if the installed CLI supports it. Otherwise accept conservative model IDs matching:

```js
/^[a-z0-9][a-z0-9._:/-]{1,127}$/i
```

Ignore headings, prices, explanations, terminal escape codes, and blank lines.

- [ ] Implement shared-login-state logout.

The manager checks for active Grok requests before logout. The UI confirmation text must state that `grok logout` can affect Grok Build sessions outside ShellPilot.

- [ ] Run tests.

Expected: provider registration is isolated; status, logout, model parsing, and last-known-good preservation pass.

- [ ] Commit the Grok provider.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/grok-provider.js apps/electerm-agent/src/app/lib/ai-providers/provider-manager.js apps/electerm-agent/src/app/lib/ipc.js apps/electerm-agent/test/unit-ci/grok-provider.spec.js apps/electerm-agent/test/unit-ci/ai-provider-manager.spec.js
git commit -m "feat(ai): register Grok provider"
```

## Task 5: Add ordinary Grok streaming chat

**Files:**

- Modify: `apps/electerm-agent/src/app/lib/ai-providers/grok-provider.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-providers/grok-acp-client.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-provider-client.js`
- Modify: `apps/electerm-agent/test/unit-ci/grok-provider.spec.js`
- Modify: `apps/electerm-agent/test/e2e/006.ai-chat.spec.js`

- [ ] Add a failing full-chat test.

Assert the provider:

- starts an ACP session in an empty app-owned temporary directory;
- sends `mcpServers: []`;
- sends sanitized conversation text;
- emits incremental text in order;
- emits one completion;
- records provider and model in history;
- attaches no ShellPilot tools in chat mode.

- [ ] Add error mapping tests.

Map ACP or child output to:

- `auth-required`;
- `quota-exceeded`;
- `rate-limited`;
- `model-unavailable`;
- `network-error`;
- `request-timeout`;
- `provider-crashed`;
- `request-cancelled`.

Do not infer success from process exit alone when `session/prompt` failed.

- [ ] Implement session creation and prompt.

Use:

```js
const { sessionId } = await acp.request('session/new', {
  cwd: isolatedCwd,
  mcpServers: []
})

await acp.request('session/prompt', {
  sessionId,
  prompt: request.messages.map(message => ({
    type: 'text',
    text: formatProviderMessage(message)
  }))
})
```

Validate the selected model against the latest successful `grok models` result, reject control characters, and start the request-owned child with `--model <id>` before `agent stdio`. Do not invent a model field in `session/new`; the documented CLI model flag is the source of truth for this phase.

- [ ] Add deterministic session cleanup.

Close the ACP session when supported, dispose the child, remove the empty temporary directory, and release the event-store record on expiry. Leave official login state untouched.

- [ ] Run focused tests and chat E2E.

```powershell
node --test test/unit-ci/grok-provider.spec.js test/unit-ci/grok-acp-client.spec.js
npx playwright test test/e2e/006.ai-chat.spec.js --workers=1
```

Expected: Grok text streams through the same renderer event consumer as Codex and OpenAI-compatible providers.

- [ ] Commit Grok chat.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/grok-provider.js apps/electerm-agent/src/app/lib/ai-providers/grok-acp-client.js apps/electerm-agent/src/client/components/ai/ai-provider-client.js apps/electerm-agent/test/unit-ci/grok-provider.spec.js apps/electerm-agent/test/e2e/006.ai-chat.spec.js
git commit -m "feat(ai): add Grok streaming chat"
```

## Task 6: Connect Grok Agent to the request-scoped MCP bridge

**Files:**

- Modify: `apps/electerm-agent/src/app/lib/ai-providers/grok-provider.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-providers/grok-acp-client.js`
- Modify: `apps/electerm-agent/src/app/lib/ai-providers/provider-tool-bridge.js`
- Modify: `apps/electerm-agent/src/client/components/ai/provider-agent-tool-session.js`
- Modify: `apps/electerm-agent/test/unit-ci/grok-provider.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/provider-tool-bridge.spec.js`
- Modify: `apps/electerm-agent/test/e2e/026.ai-takeover.spec.js`

- [ ] Add failing Grok Agent integration tests.

The fake ACP agent must advertise HTTP MCP support and assert this session declaration:

```js
{
  type: 'http',
  name: 'shellpilot',
  url: bridge.url,
  headers: [{
    name: 'Authorization',
    value: `Bearer ${bridge.token}`
  }]
}
```

The test then lists tools, calls a readonly tool, calls a risky tool, and completes.

- [ ] Add capability and fail-closed tests.

Assert Agent mode fails with `protocol-incompatible` when:

- ACP protocol version 1 is unavailable;
- HTTP MCP is not advertised;
- native tool-deny flags are unavailable;
- read-only sandbox is unavailable;
- bridge initialization fails.

Ordinary chat must remain available when only Agent-specific capabilities are missing.

- [ ] Attach the bridge only in Agent mode.

Create the bridge after exact endpoint authorization and before `session/new`. Pass the token only in the in-memory ACP request. Never place it in CLI arguments, profile config, history, diagnostics, or logs.

- [ ] Enforce native local-tool restrictions.

The child launch must retain:

- `--sandbox read-only`;
- `--disallowed-tools Bash,Edit,Read,Grep,WebFetch,WebSearch`;
- ACP client terminal capability false;
- ACP client filesystem capabilities false;
- empty app-owned `cwd`.

Do not pass `--always-approve`.

- [ ] Reuse renderer safety execution.

Grok MCP calls must reach the same `provider-agent-tool-session` created for Codex. Existing endpoint binding, classification, confirmation, verification, rollback, output bounding, untrusted-observation wrapping, and cancellation remain unchanged.

- [ ] Add post-effect failure tests.

If ACP crashes after a mutation is dispatched but before verification completes, mark the task uncertain and do not restart ACP automatically. A user may manually start a new diagnosis after verifying remote state.

- [ ] Run the safety suite.

```powershell
node --test test/unit-ci/grok-provider.spec.js test/unit-ci/provider-tool-bridge.spec.js test/unit-ci/provider-agent-tool-session.spec.js test/unit-ci/agent-tool-gateway.spec.js
npx playwright test test/e2e/026.ai-takeover.spec.js --workers=1
```

Expected: Grok invokes only scoped MCP tools and cannot bypass declined or failed ShellPilot safety checks.

- [ ] Commit Grok Agent.

```powershell
git add apps/electerm-agent/src/app/lib/ai-providers/grok-provider.js apps/electerm-agent/src/app/lib/ai-providers/grok-acp-client.js apps/electerm-agent/src/app/lib/ai-providers/provider-tool-bridge.js apps/electerm-agent/src/client/components/ai/provider-agent-tool-session.js apps/electerm-agent/test/unit-ci/grok-provider.spec.js apps/electerm-agent/test/unit-ci/provider-tool-bridge.spec.js apps/electerm-agent/test/e2e/026.ai-takeover.spec.js
git commit -m "feat(ai): connect Grok to controlled Agent tools"
```

## Task 7: Add the Grok card and Chinese usage guidance

**Files:**

- Create: `apps/electerm-agent/test/unit-ci/grok-provider-ui.spec.js`
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

Assert the Grok card shows:

- install status and official install link;
- browser login and device login;
- pending login cancellation;
- authenticated, unavailable, and incompatible states;
- model refresh, test, reconnect, logout, set-current, and help;
- login success does not activate Grok;
- active Grok task blocks switching and logout;
- the existing “xAI Grok API” preset remains an `openai-compatible` API-key option and is not relabeled as account login.

- [ ] Run UI tests and confirm failure.

```powershell
node --test test/unit-ci/grok-provider-ui.spec.js test/unit-ci/help-center.spec.js
```

- [ ] Add Grok card state and actions.

Use capabilities returned by the adapter. Show device code only in memory while login is pending. Clear it on success, failure, cancellation, card unmount, and app restart.

- [ ] Add Chinese help.

Document:

- Grok Build versus xAI API-key profiles;
- official installation;
- browser and device login;
- ACP capability checks;
- model selection;
- subscription usage and API billing differences;
- shared logout effect;
- read-only native sandbox and ShellPilot Agent confirmation;
- missing CLI, failed browser launch, disabled device auth, expired session, quota, model, proxy, CA, protocol, and corporate policy troubleshooting.

- [ ] Run help and configuration E2E tests.

```powershell
node --test test/unit-ci/grok-provider-ui.spec.js test/unit-ci/help-center.spec.js test/unit-ci/ai-provider-guide.spec.js
npx playwright test test/e2e/005.ai-config.spec.js --workers=1
```

Expected: Grok account and xAI API-key choices are visually and semantically distinct.

- [ ] Commit the Grok UI and guide.

```powershell
git add apps/electerm-agent/src/client/components/ai/ai-config.jsx apps/electerm-agent/src/client/components/main/help-center-modal.jsx apps/electerm-agent/src/client/common/shellpilot-help-content.js apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/docs/AI_PROVIDERS_TROUBLESHOOTING_ZH.md apps/electerm-agent/docs/USER_GUIDE_ZH.md apps/electerm-agent/README.md apps/electerm-agent/test/unit-ci/grok-provider-ui.spec.js apps/electerm-agent/test/unit-ci/help-center.spec.js apps/electerm-agent/test/e2e/005.ai-config.spec.js
git commit -m "docs(ai): add Grok provider guidance"
```

## Task 8: Verify the Grok milestone

**Files:**

- Modify only files required by test findings.

- [ ] Run static and unit checks.

```powershell
npm run lint
npm run test-unit-ci
```

Expected: both exit with code 0.

- [ ] Run AI and Agent E2E.

```powershell
npx playwright test test/e2e/005.ai-config.spec.js test/e2e/006.ai-chat.spec.js test/e2e/026.ai-takeover.spec.js --workers=1
```

Expected: exit code 0.

- [ ] Perform an opt-in real Grok smoke on a test account.

1. verify missing-CLI guidance on a clean machine or isolated PATH;
2. verify installed CLI detection;
3. complete browser login;
4. complete device login when the account policy permits it;
5. confirm login does not switch the active provider;
6. fetch models and manually select Grok;
7. complete streaming chat;
8. complete one readonly Agent action;
9. decline one risky Agent action;
10. cancel a running Agent;
11. confirm `grok logout` warning and behavior;
12. inspect logs and exported profiles for credential leakage.

- [ ] Inspect source and artifacts for forbidden behavior.

```powershell
git diff --check
rg -n "always-approve|dangerously|\\.grok.*token|Authorization: Bearer [A-Za-z0-9]|XAI_API_KEY" apps/electerm-agent/src apps/electerm-agent/test apps/electerm-agent/docs
```

Expected: matches are limited to assertions that unsafe flags are absent, redaction tests, public environment-variable documentation, and protocol header construction held only in request memory.

- [ ] Confirm verification did not pick up unrelated workspace changes.

```powershell
git status --short
git diff --name-only
```

Expected: only Grok milestone files are listed. If verification exposed a defect, return to the owning task, add a focused regression test, make the fix, rerun that task's exact tests, and stage only those explicitly named files. Do not stage the application directory and do not create an empty verification commit.

## Grok acceptance checklist

- [ ] Missing Grok Build does not affect Codex, OpenAI-compatible providers, or SSH.
- [ ] ShellPilot never installs Grok Build automatically.
- [ ] Official login state is owned by Grok Build and not copied by ShellPilot.
- [ ] Browser and device flows can be cancelled.
- [ ] Authenticated status is verified through ACP.
- [ ] Model discovery is runtime-driven and preserves last-known-good data on refresh failure.
- [ ] Ordinary chat attaches no tools.
- [ ] Agent mode requires ACP, HTTP MCP, read-only sandbox, and native tool-deny support.
- [ ] Grok Agent uses only request-scoped ShellPilot MCP tools for SSH effects.
- [ ] No automatic restart, retry, or provider fallback occurs after a possible side effect.
- [ ] Existing xAI API-key profiles remain distinct and operational.
- [ ] Grok Chinese help matches the delivered behavior.
