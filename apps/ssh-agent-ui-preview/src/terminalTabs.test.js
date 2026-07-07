import assert from "node:assert/strict";
import test from "node:test";

import {
  createDuplicateTerminalTab,
  closeTerminalTabModels,
  getClosableTerminalTabIds,
  getTerminalSessionDiagnosticBadge,
  getTerminalTabServerName,
  normalizeTerminalTabModels,
  buildTerminalSessionRecoveryActions,
  closeTerminalTab,
  getTerminalSessionRecovery,
  getTerminalTabCloseImpact,
  getTerminalTabSessionState,
  moveTerminalTab,
  openNextTerminalTab,
  openTerminalTab,
  removeServerTerminalTab,
  renameTerminalTabTitle,
  renameServerTerminalTab,
  selectAdjacentTerminalTab,
  toggleTerminalTabPinned,
} from "./terminalTabs.js";

const serverNames = ["prod-web-01", "prod-db-01", "prod-nginx-02", "dev-docker-01"];

test("normalizeTerminalTabModels migrates legacy server-name tabs into tab models", () => {
  const tabs = normalizeTerminalTabModels(["prod-web-01", { id: "prod-db-01#2", serverName: "prod-db-01" }], serverNames);

  assert.deepEqual(tabs, [
    { id: "prod-web-01", serverName: "prod-web-01", title: "prod-web-01" },
    { id: "prod-db-01#2", serverName: "prod-db-01", title: "prod-db-01 #2" },
  ]);
  assert.equal(getTerminalTabServerName(tabs[1]), "prod-db-01");
  assert.equal(getTerminalTabServerName("prod-nginx-02"), "prod-nginx-02");
});

test("createDuplicateTerminalTab opens another tab for the same server with a unique id", () => {
  const tabs = normalizeTerminalTabModels(["prod-web-01"], serverNames);
  const result = createDuplicateTerminalTab(tabs, "prod-web-01", serverNames);

  assert.equal(result.selectedTabId, "prod-web-01#2");
  assert.deepEqual(result.tabs, [
    { id: "prod-web-01", serverName: "prod-web-01", title: "prod-web-01" },
    { id: "prod-web-01#2", serverName: "prod-web-01", title: "prod-web-01 #2" },
  ]);

  const third = createDuplicateTerminalTab(result.tabs, "prod-web-01", serverNames);
  assert.equal(third.selectedTabId, "prod-web-01#3");
  assert.equal(third.tabs[2].serverName, "prod-web-01");
});

test("renameTerminalTabTitle updates only the selected tab title", () => {
  const tabs = normalizeTerminalTabModels(["prod-web-01", { id: "prod-web-01#2", serverName: "prod-web-01" }], serverNames);
  const renamed = renameTerminalTabTitle(tabs, "prod-web-01#2", " Nginx 排查 ");

  assert.deepEqual(renamed, [
    { id: "prod-web-01", serverName: "prod-web-01", title: "prod-web-01" },
    { id: "prod-web-01#2", serverName: "prod-web-01", title: "Nginx 排查" },
  ]);
  assert.deepEqual(renameTerminalTabTitle(tabs, "prod-web-01#2", ""), tabs);
  assert.deepEqual(renameTerminalTabTitle(tabs, "missing", "测试"), tabs);
});

test("toggleTerminalTabPinned protects only the selected SSH tab", () => {
  const tabs = normalizeTerminalTabModels([
    "prod-web-01",
    { id: "prod-web-01#2", serverName: "prod-web-01", pinned: true },
  ], serverNames);

  assert.deepEqual(tabs, [
    { id: "prod-web-01", serverName: "prod-web-01", title: "prod-web-01" },
    { id: "prod-web-01#2", serverName: "prod-web-01", title: "prod-web-01 #2", pinned: true },
  ]);

  const pinned = toggleTerminalTabPinned(tabs, "prod-web-01");
  assert.equal(pinned[0].pinned, true);
  assert.equal(pinned[1].pinned, true);

  const unpinned = toggleTerminalTabPinned(pinned, "prod-web-01#2");
  assert.equal(unpinned[0].pinned, true);
  assert.equal(unpinned[1].pinned, undefined);
  assert.deepEqual(toggleTerminalTabPinned(tabs, "missing"), tabs);
});

test("getClosableTerminalTabIds keeps current and pinned SSH tabs", () => {
  const tabs = normalizeTerminalTabModels([
    "prod-web-01",
    { id: "prod-db-01", serverName: "prod-db-01", pinned: true },
    "prod-nginx-02",
    "dev-docker-01",
  ], serverNames);

  assert.deepEqual(getClosableTerminalTabIds(tabs, "prod-nginx-02", "others"), ["prod-web-01", "dev-docker-01"]);
  assert.deepEqual(getClosableTerminalTabIds(tabs, "prod-web-01", "right"), ["prod-nginx-02", "dev-docker-01"]);
  assert.deepEqual(getClosableTerminalTabIds(tabs, "missing", "others"), []);
  assert.deepEqual(getClosableTerminalTabIds(tabs, "prod-db-01", "right"), ["prod-nginx-02", "dev-docker-01"]);
});

test("closeTerminalTabModels closes multiple SSH tab models in one state update", () => {
  const tabs = normalizeTerminalTabModels([
    "prod-web-01",
    { id: "prod-db-01", serverName: "prod-db-01", pinned: true },
    "prod-nginx-02",
    "dev-docker-01",
  ], serverNames);

  const result = closeTerminalTabModels(tabs, ["prod-web-01", "dev-docker-01"], "prod-nginx-02", serverNames);

  assert.deepEqual(result.tabs, [
    { id: "prod-db-01", serverName: "prod-db-01", title: "prod-db-01", pinned: true },
    { id: "prod-nginx-02", serverName: "prod-nginx-02", title: "prod-nginx-02" },
  ]);
  assert.equal(result.selectedTabId, "prod-nginx-02");
  assert.equal(result.selectedServer, "prod-nginx-02");
  assert.deepEqual(result.closedTabs.map((tab) => tab.id), ["prod-web-01", "dev-docker-01"]);

  const fallback = closeTerminalTabModels(tabs, tabs.map((tab) => tab.id), "prod-web-01", serverNames);
  assert.deepEqual(fallback.tabs, [
    { id: "prod-web-01", serverName: "prod-web-01", title: "prod-web-01" },
  ]);
  assert.equal(fallback.selectedTabId, "prod-web-01");
  assert.equal(fallback.selectedServer, "prod-web-01");
});

test("moveTerminalTab reorders SSH tab models without changing their metadata", () => {
  const tabs = normalizeTerminalTabModels([
    "prod-web-01",
    { id: "prod-db-01", serverName: "prod-db-01", pinned: true },
    { id: "prod-nginx-02", serverName: "prod-nginx-02", title: "Nginx 排查" },
  ], serverNames);

  assert.deepEqual(moveTerminalTab(tabs, "prod-nginx-02", -1), [
    { id: "prod-web-01", serverName: "prod-web-01", title: "prod-web-01" },
    { id: "prod-nginx-02", serverName: "prod-nginx-02", title: "Nginx 排查" },
    { id: "prod-db-01", serverName: "prod-db-01", title: "prod-db-01", pinned: true },
  ]);
  assert.deepEqual(moveTerminalTab(tabs, "prod-web-01", -1), tabs);
  assert.deepEqual(moveTerminalTab(tabs, "prod-nginx-02", 1), tabs);
  assert.deepEqual(moveTerminalTab(tabs, "missing", 1), tabs);
});

test("openTerminalTab adds a valid server once and keeps order", () => {
  assert.deepEqual(openTerminalTab(["prod-web-01"], "prod-db-01", serverNames), ["prod-web-01", "prod-db-01"]);
  assert.deepEqual(openTerminalTab(["prod-web-01"], "missing", serverNames), ["prod-web-01"]);
  assert.deepEqual(openTerminalTab(["prod-web-01"], "prod-web-01", serverNames), ["prod-web-01"]);
});

test("closeTerminalTab selects a nearby tab and keeps at least one tab open", () => {
  const closedActive = closeTerminalTab(["prod-web-01", "prod-db-01", "prod-nginx-02"], "prod-db-01", "prod-db-01", serverNames);

  assert.deepEqual(closedActive.tabs, ["prod-web-01", "prod-nginx-02"]);
  assert.equal(closedActive.selectedServer, "prod-nginx-02");

  const closedLast = closeTerminalTab(["prod-web-01"], "prod-web-01", "prod-web-01", serverNames);
  assert.deepEqual(closedLast.tabs, ["prod-web-01"]);
  assert.equal(closedLast.selectedServer, "prod-web-01");
});

test("removeServerTerminalTab removes deleted servers and keeps a valid selection", () => {
  const removedActive = removeServerTerminalTab(
    ["prod-web-01", "prod-db-01", "prod-nginx-02"],
    "prod-db-01",
    "prod-db-01",
    ["prod-web-01", "prod-nginx-02"],
  );

  assert.deepEqual(removedActive.tabs, ["prod-web-01", "prod-nginx-02"]);
  assert.equal(removedActive.selectedServer, "prod-nginx-02");

  const keptActive = removeServerTerminalTab(
    ["prod-web-01", "prod-db-01"],
    "prod-db-01",
    "prod-web-01",
    ["prod-web-01", "prod-nginx-02"],
  );

  assert.deepEqual(keptActive.tabs, ["prod-web-01"]);
  assert.equal(keptActive.selectedServer, "prod-web-01");

  const fallback = removeServerTerminalTab(["deleted"], "deleted", "deleted", ["prod-nginx-02"]);
  assert.deepEqual(fallback.tabs, ["prod-nginx-02"]);
  assert.equal(fallback.selectedServer, "prod-nginx-02");
});

test("removeServerTerminalTab removes duplicated tab models for a deleted server", () => {
  const tabs = normalizeTerminalTabModels([
    "prod-web-01",
    { id: "prod-web-01#2", serverName: "prod-web-01", title: "prod-web-01 #2" },
    { id: "prod-db-01", serverName: "prod-db-01", pinned: true },
    "prod-nginx-02",
  ], serverNames);

  const result = removeServerTerminalTab(tabs, "prod-web-01", "prod-web-01", ["prod-db-01", "prod-nginx-02"]);

  assert.deepEqual(result.tabs, [
    { id: "prod-db-01", serverName: "prod-db-01", title: "prod-db-01", pinned: true },
    { id: "prod-nginx-02", serverName: "prod-nginx-02", title: "prod-nginx-02" },
  ]);
  assert.equal(result.selectedServer, "prod-db-01");
  assert.equal(result.selectedTabId, "prod-db-01");
  assert.deepEqual(result.removedTabs.map((tab) => tab.id), ["prod-web-01", "prod-web-01#2"]);
});

test("renameServerTerminalTab replaces old server tab and selection", () => {
  const renamed = renameServerTerminalTab(
    ["prod-web-01", "prod-db-01"],
    "prod-db-01",
    "prod-db-main",
    "prod-db-01",
    ["prod-web-01", "prod-db-main", "prod-nginx-02"],
  );

  assert.deepEqual(renamed.tabs, ["prod-web-01", "prod-db-main"]);
  assert.equal(renamed.selectedServer, "prod-db-main");

  const deduped = renameServerTerminalTab(
    ["prod-web-01", "prod-db-main", "prod-db-01"],
    "prod-db-01",
    "prod-db-main",
    "prod-web-01",
    ["prod-web-01", "prod-db-main"],
  );
  assert.deepEqual(deduped.tabs, ["prod-web-01", "prod-db-main"]);
  assert.equal(deduped.selectedServer, "prod-web-01");
});

test("openNextTerminalTab opens the next unopened server and selects it", () => {
  const result = openNextTerminalTab(["prod-web-01", "prod-db-01"], serverNames, "prod-db-01");

  assert.deepEqual(result.tabs, ["prod-web-01", "prod-db-01", "prod-nginx-02"]);
  assert.equal(result.selectedServer, "prod-nginx-02");
});

test("selectAdjacentTerminalTab cycles through open terminal tabs", () => {
  const tabs = ["prod-web-01", "prod-db-01", "prod-nginx-02"];

  assert.equal(selectAdjacentTerminalTab(tabs, serverNames, "prod-db-01", 1), "prod-nginx-02");
  assert.equal(selectAdjacentTerminalTab(tabs, serverNames, "prod-web-01", -1), "prod-nginx-02");
  assert.equal(selectAdjacentTerminalTab(tabs, serverNames, "prod-nginx-02", 1), "prod-web-01");
  assert.equal(selectAdjacentTerminalTab(["missing"], serverNames, "missing", 1), "prod-web-01");
});

test("getTerminalTabCloseImpact requires confirmation for active ssh sessions", () => {
  const impact = getTerminalTabCloseImpact("prod-web-01", {
    "prod-web-01": { sessionId: "ssh-session-1", busy: false },
    "prod-db-01": { sessionId: "", busy: false },
  });

  assert.equal(impact.hasActiveSession, true);
  assert.equal(impact.sessionId, "ssh-session-1");
  assert.match(impact.confirmMessage, /prod-web-01/);
  assert.match(impact.confirmMessage, /断开 SSH 会话/);

  const inactive = getTerminalTabCloseImpact("prod-db-01", {});
  assert.equal(inactive.hasActiveSession, false);
});

test("getTerminalTabCloseImpact blocks pinned SSH tabs before closing", () => {
  const impact = getTerminalTabCloseImpact("prod-web-01#2", {}, "prod-web-01", { pinned: true });

  assert.equal(impact.isPinned, true);
  assert.equal(impact.blocked, true);
  assert.match(impact.confirmMessage, /固定标签/);
});

test("getTerminalTabCloseImpact can look up duplicated tab sessions by tab id", () => {
  const impact = getTerminalTabCloseImpact("prod-web-01#2", {
    "prod-web-01": { sessionId: "ssh-session-1", busy: false },
    "prod-web-01#2": { sessionId: "ssh-session-2", busy: false },
  }, "prod-web-01");

  assert.equal(impact.hasActiveSession, true);
  assert.equal(impact.sessionId, "ssh-session-2");
  assert.match(impact.confirmMessage, /prod-web-01/);
});

test("getTerminalTabSessionState maps session status for tab badges", () => {
  assert.deepEqual(getTerminalTabSessionState({ sessionId: "ssh-session-1", busy: true }), {
    key: "busy",
    label: "忙碌",
    tone: "amber",
  });
  assert.deepEqual(getTerminalTabSessionState({ sessionId: "ssh-session-1", busy: false }), {
    key: "connected",
    label: "已连接",
    tone: "green",
  });
  assert.deepEqual(getTerminalTabSessionState({ sessionId: "", busy: false }), {
    key: "idle",
    label: "未连接",
    tone: "gray",
  });
});

test("getTerminalTabSessionState marks failed sessions clearly", () => {
  assert.deepEqual(getTerminalTabSessionState({ sessionId: "", busy: false, lastError: "Connection refused" }), {
    key: "error",
    label: "连接异常",
    tone: "red",
  });
});

test("getTerminalTabSessionState distinguishes disconnected sessions from never connected tabs", () => {
  assert.deepEqual(getTerminalTabSessionState({ sessionId: "", busy: false, disconnectedAt: "2026-06-26T04:00:00.000Z" }), {
    key: "disconnected",
    label: "已断开",
    tone: "amber",
  });
});

test("getTerminalSessionRecovery builds reconnect notice for failed or closed sessions", () => {
  assert.deepEqual(getTerminalSessionRecovery({ sessionId: "", lastError: "Connection refused" }), {
    visible: true,
    tone: "red",
    title: "SSH 会话异常",
    detail: "Connection refused",
    actionLabel: "重新连接",
  });

  assert.deepEqual(getTerminalSessionRecovery({ sessionId: "", disconnectedAt: "2026-06-26T04:00:00.000Z" }), {
    visible: true,
    tone: "amber",
    title: "SSH 会话已断开",
    detail: "断开时间：2026-06-26 04:00:00 UTC。可以重新连接继续操作。",
    actionLabel: "重新连接",
  });

  assert.equal(getTerminalSessionRecovery({ sessionId: "ssh-session-1" }).visible, false);
});

test("getTerminalSessionRecovery includes structured SSH failure details when available", () => {
  const recovery = getTerminalSessionRecovery({
    sessionId: "",
    lastError: "Connection refused",
    failureKind: "refused",
    sshFailure: {
      label: "端口拒绝",
      summary: "目标主机拒绝了 SSH 端口连接。",
    },
  });

  assert.equal(recovery.visible, true);
  assert.equal(recovery.title, "SSH 会话异常：端口拒绝");
  assert.match(recovery.detail, /Connection refused/);
  assert.match(recovery.detail, /目标主机拒绝了 SSH 端口连接。/);
});

test("getTerminalSessionRecovery exposes backend suggestions for visible repair guidance", () => {
  const recovery = getTerminalSessionRecovery({
    sessionId: "",
    lastError: "Permission denied",
    failureKind: "auth",
    sshFailure: {
      label: "SSH auth failed",
      summary: "Server rejected current credentials.",
      suggestions: ["Check password or private key.", "", "Confirm AllowUsers and sshd config."],
    },
  });

  assert.deepEqual(recovery.suggestions, ["Check password or private key.", "Confirm AllowUsers and sshd config."]);
});

test("getTerminalSessionDiagnosticBadge summarizes failed and disconnected sessions", () => {
  assert.deepEqual(getTerminalSessionDiagnosticBadge({
    sessionId: "",
    lastError: "Connection refused",
    sshFailure: { label: "端口拒绝", summary: "目标主机拒绝了 SSH 端口连接。" },
  }), {
    visible: true,
    tone: "red",
    label: "异常：端口拒绝",
    title: "Connection refused\n目标主机拒绝了 SSH 端口连接。",
  });

  assert.deepEqual(getTerminalSessionDiagnosticBadge({
    sessionId: "",
    disconnectedAt: "2026-06-26T04:00:00.000Z",
  }), {
    visible: true,
    tone: "amber",
    label: "已断开",
    title: "断开时间：2026-06-26 04:00:00 UTC",
  });

  assert.equal(getTerminalSessionDiagnosticBadge({ sessionId: "ssh-session-1" }).visible, false);
});

test("buildTerminalSessionRecoveryActions offers reconnect test and agent handoff for failed sessions", () => {
  const actions = buildTerminalSessionRecoveryActions({ sessionId: "", lastError: "Connection refused" });

  assert.deepEqual(actions.map((action) => action.target), ["reconnect", "reconnect-clear", "connection-test", "edit-connection", "agent-diagnostic", "copy-error-detail", "copy-diagnostic-summary", "copy-ssh-command", "session-logs", "dismiss-recovery", "export-diagnostic"]);
  assert.equal(actions[0].tone, "primary");
  assert.equal(actions.find((action) => action.target === "reconnect-clear")?.label, "清空并重连");
  assert.equal(actions.find((action) => action.target === "edit-connection")?.label, "编辑连接");
  assert.equal(actions.find((action) => action.target === "copy-error-detail")?.label, "复制错误详情");
  assert.equal(actions.find((action) => action.target === "copy-diagnostic-summary")?.label, "复制排障摘要");
  assert.equal(actions.find((action) => action.target === "copy-ssh-command")?.label, "复制 SSH 命令");
  assert.equal(actions.find((action) => action.target === "dismiss-recovery")?.label, "隐藏提示");
});

test("buildTerminalSessionRecoveryActions offers credential repair for auth failures", () => {
  const actions = buildTerminalSessionRecoveryActions({
    sessionId: "",
    lastError: "Permission denied",
    failureKind: "auth",
    sshFailure: { kind: "auth", label: "SSH 认证失败" },
  });

  assert.deepEqual(actions.map((action) => action.target).slice(0, 5), ["auth-center", "reconnect", "reconnect-clear", "connection-test", "edit-connection"]);
  assert.equal(actions[0].tone, "primary");
  assert.match(actions[0].label, /凭据|认证/);
});

test("buildTerminalSessionRecoveryActions offers safe manual recovery for closed sessions", () => {
  const actions = buildTerminalSessionRecoveryActions({ sessionId: "", disconnectedAt: "2026-06-26T04:00:00.000Z" });

  assert.deepEqual(actions.map((action) => action.target), ["reconnect", "reconnect-clear", "connection-test", "edit-connection", "copy-ssh-command", "session-logs", "dismiss-recovery", "export-diagnostic"]);
  assert.deepEqual(buildTerminalSessionRecoveryActions({ sessionId: "ssh-session-1" }), []);
  assert.deepEqual(buildTerminalSessionRecoveryActions({ busy: true, lastError: "timeout" }), []);
});
