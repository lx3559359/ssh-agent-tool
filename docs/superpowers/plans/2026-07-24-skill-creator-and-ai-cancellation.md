# Streamlined Skill Creator And AI Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Make Skill creation conversational and beginner-friendly, and give both normal AI chat and Agent runs a fixed, reliable, idempotent stop control without interrupting manually entered SSH commands.

**Architecture:** Reuse the existing Skill repository, validator, automatic repair controller, Agent task registry, backend request cancellation, stream cancellation, and terminal ownership checks. Add one shared AI-run cancellation coordinator used by both the composer and history items, expose the active scoped run to the composer, and reduce the Skill review surface to a concise summary with technical details behind a collapse.

**Tech Stack:** React, Ant Design, Stylus, Electron, Node.js `node:test`, Playwright.

---

## Preconditions And Scope

- Work in `F:\SSH工具开发`.
- Preserve the existing uncommitted Skill validation and automatic-repair changes in:
  - `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
  - `apps/electerm-agent/src/client/components/ai/agent-skill-create-modal.jsx`
  - `apps/electerm-agent/src/client/components/ai/agent-skill-creator-controller.js`
  - `apps/electerm-agent/src/client/components/ai/agent-skill-creator-prompt.js`
  - `apps/electerm-agent/test/unit-ci/agent-skill-creator-controller.spec.js`
- Do not modify SSH connection, PTY input, SFTP transfer, update, or release code except where an existing Agent-owned cancellation test proves a narrowly scoped fix is required.
- Do not commit `.superpowers/`, local VPS credentials, audit output, release output, patches, or unrelated worktrees.
- Keep per-history-item stop controls during the first implementation pass; the fixed composer stop button becomes the primary control.

## Task 1: Add A Shared Scoped AI Run Cancellation Coordinator

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai/ai-run-cancellation.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-run-cancellation.spec.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-actions.js`

### Step 1: Write failing selector and ordinary-chat cancellation tests

Create `ai-run-cancellation.spec.js` with tests that:

1. Select the newest `pending`, `running`, or `stopping` entry only from the active conversation scope.
2. Ignore completed, failed, cancelled, and another terminal's entries.
3. Move a normal chat through `running -> stopping -> cancelled`.
4. Call `cancelDetachedStream`, `AIChatCancel`, and `stopStream` at most once.
5. Preserve a partial response and append one user-visible stopped marker.
6. Treat repeated cancellation as an idempotent no-op.
7. Accept completion winning the cancellation race without overwriting `completed`.

The test-facing API must be:

```js
import {
  cancelScopedAIChatRun,
  getActiveScopedAIChatRun
} from '../../src/client/components/ai/ai-run-cancellation.js'
```

Use injected dependencies:

```js
await cancelScopedAIChatRun({
  store,
  item,
  cancelAgent,
  cancelDetachedStream,
  cancelRequest,
  stopStream,
  stoppedText: '已由用户停止'
})
```

### Step 2: Run the test and verify it fails

Run:

```powershell
cd F:\SSH工具开发\apps\electerm-agent
node --test test/unit-ci/ai-run-cancellation.spec.js
```

Expected: FAIL because `ai-run-cancellation.js` does not exist.

### Step 3: Implement the coordinator

Implement:

```js
const activeStatuses = new Set(['pending', 'running', 'stopping'])
const cancellations = new Map()

export function getActiveScopedAIChatRun (history, scopeId) {
  return getAIChatHistoryForScope(history, scopeId)
    .filter(item => activeStatuses.has(item.completionStatus))
    .at(-1) || null
}

export async function cancelScopedAIChatRun (options = {}) {
  const id = String(options.item?.id || '')
  if (!id) return { cancelled: false, reason: 'missing-run' }
  if (cancellations.has(id)) return cancellations.get(id)
  const operation = cancelRunOnce(options)
  cancellations.set(id, operation)
  try {
    return await operation
  } finally {
    cancellations.delete(id)
  }
}
```

Inside `cancelRunOnce`:

- Re-read the current history entry before every terminal state write.
- Return without side effects if the current entry is no longer active.
- Write `completionStatus: 'stopping'` before awaiting external cancellation.
- For normal chat, cancel the detached poller, request, and stream.
- For Agent, call the injected `cancelAgent(item.id)` only.
- Preserve partial output and finish with `buildAgentCancellationUpdate`.
- If completion wins the race, keep `completed`.
- If cancellation cannot be confirmed, use `partially-completed`.
- Record lifecycle cancellation once through the existing quality event path.

Extend `isActiveAIChatEntry` in `ai-chat-actions.js` to treat `stopping` as active for cleanup while ensuring startup recovery converts stale `stopping` entries to failed/interrupted.

### Step 4: Run focused tests

Run:

```powershell
node --test test/unit-ci/ai-run-cancellation.spec.js test/unit-ci/ai-chat-actions.spec.js test/unit-ci/agent-cancellation-status.spec.js
```

Expected: PASS.

### Step 5: Commit

```powershell
git add apps/electerm-agent/src/client/components/ai/ai-run-cancellation.js apps/electerm-agent/src/client/components/ai/ai-chat-actions.js apps/electerm-agent/test/unit-ci/ai-run-cancellation.spec.js
git commit -m "feat: coordinate cancellable AI runs"
```

## Task 2: Put A Fixed Stop Button In The AI Composer

**Files:**
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-submit.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-stop-icon.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/ai.styl`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-chat-submit.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-conversation-safety.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-chat-layout.spec.js`
- Test: `apps/electerm-agent/test/e2e/006.ai-chat.spec.js`

### Step 1: Write failing composer-state tests

Extend `ai-chat-submit.spec.js` so `getAgentComposerActionState` returns:

```js
{ kind: 'stop', disabled: false }
```

when the current scoped conversation has an active normal chat or Agent run, independent of the selected mode. It must return:

```js
{ kind: 'stopping', disabled: true }
```

after cancellation begins, and return `send` when no active run exists.

### Step 2: Add source and layout assertions

Add assertions that:

- `ai-chat.jsx` derives `activeRun` with `getActiveScopedAIChatRun`.
- The action button calls `cancelScopedAIChatRun`.
- Enter does not submit another prompt while a run is active or stopping.
- The stop button has `aria-label`, title, and a stable `28px` square.
- The stop control is inside `.ai-chat-terminals`, not inside a folded history card.
- The day and night themes use an explicit danger color with readable contrast.

### Step 3: Run the focused tests and verify failure

```powershell
node --test test/unit-ci/ai-chat-submit.spec.js test/unit-ci/ai-conversation-safety.spec.js test/unit-ci/ai-chat-layout.spec.js
```

Expected: FAIL on missing stop composer state and missing coordinator call.

### Step 4: Implement the fixed composer stop action

In `ai-chat.jsx`:

```js
const activeRun = getActiveScopedAIChatRun(
  props.aiChatHistory,
  conversationScopeId
)
const runStopping = activeRun?.completionStatus === 'stopping'
```

Add:

```js
const handleStopActiveRun = useCallback(async () => {
  if (!activeRun) return
  await cancelScopedAIChatRun({
    store: window.store,
    item: activeRun,
    cancelAgent: cancelAgentRun,
    cancelDetachedStream: cancelDetachedAIStream,
    cancelRequest: id => window.pre.runGlobalAsync('AIChatCancel', id),
    stopStream: id => window.pre.runGlobalAsync('stopStream', id),
    stoppedText: e('shellpilotAiStoppedByUser')
  })
}, [activeRun])
```

Render `AIStopIcon` in the same fixed location as the send icon whenever `activeRun` exists. Use a solid square stop glyph, not a loading spinner, while the button is actionable. Show a spinner only during the short `stopping` state.

Refactor `ai-chat-history-item.jsx` to call the same coordinator with its local Agent cancellation callback:

```js
cancelAgent: () => abortRef.cancelCurrent
  ? abortRef.cancelCurrent()
  : cancelAgentRun(item.id)
```

This preserves the existing early-run fallback while removing duplicated cancellation state updates.

### Step 5: Add an Electron E2E stop scenario

Extend `006.ai-chat.spec.js` to:

1. Start a delayed normal AI response.
2. Verify the composer send icon changes to the stop control.
3. Stop before the first byte and assert the entry is cancelled.
4. Start a streamed response, stop after partial text, and assert partial text remains.
5. Start an Agent operation, stop it, and assert the button returns to send.
6. Repeat stop clicks and assert cancellation IPC calls occur once.

### Step 6: Run focused and E2E tests

```powershell
node --test test/unit-ci/ai-run-cancellation.spec.js test/unit-ci/ai-chat-submit.spec.js test/unit-ci/ai-conversation-safety.spec.js test/unit-ci/ai-chat-layout.spec.js
npx playwright test test/e2e/006.ai-chat.spec.js --workers=1
```

Expected: PASS.

### Step 7: Commit

```powershell
git add apps/electerm-agent/src/client/components/ai/ai-chat-submit.js apps/electerm-agent/src/client/components/ai/ai-chat.jsx apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx apps/electerm-agent/src/client/components/ai/ai-stop-icon.jsx apps/electerm-agent/src/client/components/ai/ai.styl apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/ai-chat-submit.spec.js apps/electerm-agent/test/unit-ci/ai-conversation-safety.spec.js apps/electerm-agent/test/unit-ci/ai-chat-layout.spec.js apps/electerm-agent/test/e2e/006.ai-chat.spec.js
git commit -m "feat: add fixed AI and Agent stop control"
```

## Task 3: Prove Agent Cancellation Does Not Touch Manual SSH Input

**Files:**
- Modify only if a failing test proves necessary: `apps/electerm-agent/src/client/components/ai/agent-runtime-context.js`
- Modify only if a failing test proves necessary: `apps/electerm-agent/src/client/store/mcp-handler.js`
- Modify only if a failing test proves necessary: `apps/electerm-agent/src/client/components/ai/agent-task-registry.js`
- Test: `apps/electerm-agent/test/unit-ci/agent-cancellation-lifecycle.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/agent-readonly-exec.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/ai-run-cancellation.spec.js`

### Step 1: Add ownership and idempotency tests

Add tests that:

- An Agent-owned submitted terminal command receives exactly one `\x03`.
- A queued-but-not-submitted Agent command receives no `\x03`.
- A manually entered SSH command with no Agent operation ID receives no `\x03`.
- Cancelling during plan generation, confirmation wait, MCP wait, CLI wait, and terminal wait resolves the same run to a terminal state.
- Cancellation unregisters the Agent task and releases the endpoint/scope busy lock.
- A cancellation failure produces `partially-completed`, not a false success.

### Step 2: Run tests before changing implementation

```powershell
node --test test/unit-ci/agent-cancellation-lifecycle.spec.js test/unit-ci/agent-readonly-exec.spec.js test/unit-ci/ai-run-cancellation.spec.js
```

Expected: existing ownership cases should pass; any new failing case identifies the smallest required fix.

### Step 3: Make only evidence-driven fixes

Keep these invariants:

```js
if (options.signal?.aborted && submission.sent) {
  sendCtrlCExactlyOnce()
}
```

- Never send Ctrl+C based only on “active terminal”.
- Require the current Agent runtime operation to own the terminal submission.
- Reuse the task registry's existing cancellation promise map for idempotency.
- Unregister in `finally`.
- Do not disconnect the SSH session.

### Step 4: Run the cancellation matrix

```powershell
node --test test/unit-ci/agent-cancellation*.spec.js test/unit-ci/agent-readonly-exec.spec.js test/unit-ci/agent-task-runner.spec.js test/unit-ci/terminal-safety-controller.spec.js
```

Expected: PASS with exactly one Ctrl+C for an Agent-owned submitted command.

### Step 5: Commit only if source code changed

```powershell
git add apps/electerm-agent/src/client/components/ai/agent-runtime-context.js apps/electerm-agent/src/client/store/mcp-handler.js apps/electerm-agent/src/client/components/ai/agent-task-registry.js apps/electerm-agent/test/unit-ci/agent-cancellation-lifecycle.spec.js apps/electerm-agent/test/unit-ci/agent-readonly-exec.spec.js apps/electerm-agent/test/unit-ci/ai-run-cancellation.spec.js
git commit -m "test: enforce safe Agent cancellation ownership"
```

## Task 4: Replace The Technical Skill Review With A Minimal Summary

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai/agent-skill-draft-summary.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-skill-create-modal.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-skill-draft-review.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-skill-manager.styl`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/test/unit-ci/agent-skill-create-ui.spec.js`
- Modify: `apps/electerm-agent/test/e2e/026.agent-skill-manager.spec.js`

### Step 1: Write failing minimal-review tests

Update `agent-skill-create-ui.spec.js` to require:

- A concise result summary with name, purpose, triggers, capability count, safety status, and validation state.
- Technical fields `Digest`, file digests, permissions, risk details, validation errors, warnings, and manual editor inside an Ant Design `Collapse`.
- Primary actions named “继续修改”, “保存草稿”, and “保存并启用”.
- No full `AgentSkillEditor` rendered before expanding technical details.
- A disabled draft remains the default after generation.
- High-risk permissions still require explicit confirmation.

### Step 2: Run the UI test and verify failure

```powershell
node --test test/unit-ci/agent-skill-create-ui.spec.js
```

Expected: FAIL because the current review renders all technical fields and the editor immediately.

### Step 3: Implement the summary component

`agent-skill-draft-summary.jsx` must derive user-facing data from the generated package without adding a second data model:

```js
export function getAgentSkillDraftSummary ({ draft, generated, validation }) {
  return {
    name: draft?.name || draft?.id || '',
    purpose: generated?.summary || draft?.description || '',
    triggers: draft?.triggers || [],
    capabilityCount: Array.isArray(draft?.tools) ? draft.tools.length : 0,
    safetyStatus: validation?.valid ? 'validated' : 'review-required',
    enabled: false
  }
}
```

Render a compact, accessible summary. Use restrained status tags and no nested cards.

### Step 4: Fold technical details

In `agent-skill-draft-review.jsx`:

- Render `AgentSkillDraftSummary` first.
- Put digest, file list, permissions, risk details, errors, warnings, and `AgentSkillEditor` in one collapsed panel labelled “技术详情与人工审查”.
- Auto-expand the panel only when validation has errors.
- Preserve copyable digest and all current editor behavior.

In `agent-skill-create-modal.jsx`:

- Keep the conversation visible.
- Keep automatic validation and one automatic repair.
- Remove the separate routine “验证” button from the primary path; validation remains automatic and can be retried inside details on failure.
- Keep “保存草稿” available after draft creation.
- Enable “保存并启用” only after a fresh matching validation digest.
- Keep the existing confirmation modal for enablement and high-risk permissions.

### Step 5: Update E2E selectors and behavior

Modify `026.agent-skill-manager.spec.js` to:

1. Generate a Skill from natural language.
2. Assert the minimal summary is visible.
3. Assert technical details are initially collapsed.
4. Continue the conversation and verify the summary updates.
5. Expand technical details and verify digest and editor still work.
6. Save as disabled draft.
7. Reopen, validate, confirm, and enable.
8. Verify a validation error automatically expands details and displays actionable errors.

Use data attributes for stable selectors:

```jsx
data-testid='agent-skill-draft-summary'
data-testid='agent-skill-technical-details'
data-testid='agent-skill-save-draft'
data-testid='agent-skill-save-enable'
```

### Step 6: Run focused tests

```powershell
node --test test/unit-ci/agent-skill-create-ui.spec.js test/unit-ci/agent-skill-creator-controller.spec.js
npx playwright test test/e2e/026.agent-skill-manager.spec.js --workers=1
```

Expected: PASS.

### Step 7: Commit

```powershell
git add apps/electerm-agent/src/client/components/ai/agent-skill-draft-summary.jsx apps/electerm-agent/src/client/components/ai/agent-skill-create-modal.jsx apps/electerm-agent/src/client/components/ai/agent-skill-draft-review.jsx apps/electerm-agent/src/client/components/ai/agent-skill-manager.styl apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/agent-skill-create-ui.spec.js apps/electerm-agent/test/e2e/026.agent-skill-manager.spec.js
git commit -m "feat: streamline conversational Skill creation"
```

## Task 5: Run Visual, Regression, And Build Verification

**Files:**
- Modify only for proven regressions: AI and Skill files changed above
- Evidence output only: `audit-results/` or a temporary directory outside commits

### Step 1: Run formatting and focused unit tests

```powershell
cd F:\SSH工具开发\apps\electerm-agent
npx standard src/client/components/ai/ai-run-cancellation.js src/client/components/ai/ai-chat-submit.js src/client/components/ai/ai-chat.jsx src/client/components/ai/ai-chat-history-item.jsx src/client/components/ai/ai-stop-icon.jsx src/client/components/ai/agent-skill-draft-summary.jsx src/client/components/ai/agent-skill-create-modal.jsx src/client/components/ai/agent-skill-draft-review.jsx
node --test test/unit-ci/ai-run-cancellation.spec.js test/unit-ci/ai-chat-submit.spec.js test/unit-ci/ai-conversation-safety.spec.js test/unit-ci/ai-chat-layout.spec.js test/unit-ci/agent-cancellation-lifecycle.spec.js test/unit-ci/agent-readonly-exec.spec.js test/unit-ci/agent-skill-create-ui.spec.js test/unit-ci/agent-skill-creator-controller.spec.js
```

Expected: PASS.

### Step 2: Run complete unit and critical E2E suites

```powershell
npm run test-unit-ci
npx playwright test test/e2e/006.ai-chat.spec.js test/e2e/026.agent-skill-manager.spec.js test/e2e/027.quality-core-flows.spec.js --workers=1
```

Expected: PASS.

### Step 3: Verify responsive themes and scaling

Capture and inspect these matrices:

- `1366x768`, `1920x1080`
- Windows scale simulation `100%`, `125%`, `150%`
- day and night themes
- AI idle, AI streaming, Agent running, Agent stopping
- Skill empty, generating, minimal summary, validation error, technical details expanded

Acceptance checks:

- Composer stop button is always visible and never overlaps the textarea.
- Skill modal fits without horizontal scrolling.
- Chinese text is not clipped.
- Danger, warning, and disabled colors are readable in both themes.
- Narrow right panel does not hide the stop control.

### Step 4: Compile the desktop client

```powershell
npm run compile
```

Expected: exit code 0 and no missing chunk/import errors.

### Step 5: Verify the worktree and diff

```powershell
git diff --check
git status --short
git diff --stat
```

Expected:

- No whitespace errors.
- Only intended source, test, translation, style, and plan files are staged or modified.
- No credentials, generated audit output, release assets, or `.superpowers/` files are staged.

### Step 6: Final implementation commit

If verification required small fixes:

```powershell
git add apps/electerm-agent/src/client/components/ai apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci apps/electerm-agent/test/e2e/006.ai-chat.spec.js apps/electerm-agent/test/e2e/026.agent-skill-manager.spec.js
git commit -m "test: verify Skill creation and AI cancellation"
```

Do not publish an online update in this plan. Produce a local validation build first and report the exact executable path and test results to the user.

## Self-Review Against The Approved Design

- The primary Skill flow is natural-language conversation, not a technical package editor.
- Generated Skills remain disabled until reviewed and explicitly enabled.
- Existing validation, digest, permissions, history, and automatic repair remain authoritative.
- Technical detail is preserved but collapsed.
- The stop control is fixed at the composer and works for chat and Agent.
- Cancellation is idempotent and preserves partial output.
- Agent cancellation only interrupts Agent-owned submitted terminal commands.
- Manual SSH commands and the SSH connection are never interrupted by AI cancellation.
- Safety task locks are released through existing registry cleanup.
- No release is performed before local regression and visual verification pass.
