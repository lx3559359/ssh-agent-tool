export function getTerminalTabServerName(tab) {
  if (typeof tab === "string") return tab;
  return String(tab?.serverName || "").trim();
}

export function normalizeTerminalTabModels(tabs, allServerNames) {
  const validNames = Array.isArray(allServerNames) ? allServerNames : [];
  const seenIds = new Set();
  const result = [];

  for (const item of Array.isArray(tabs) ? tabs : []) {
    const serverName = getTerminalTabServerName(item);
    if (!validNames.includes(serverName)) continue;
    const rawId = typeof item === "object" && item ? String(item.id || "").trim() : serverName;
    const id = rawId || serverName;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const model = {
      id,
      serverName,
      title: typeof item === "object" && item?.title ? String(item.title) : buildTerminalTabTitle(serverName, id),
    };
    if (typeof item === "object" && item?.pinned) model.pinned = true;
    result.push(model);
  }

  if (result.length === 0 && validNames[0]) {
    result.push({ id: validNames[0], serverName: validNames[0], title: validNames[0] });
  }
  return result;
}

export function createDuplicateTerminalTab(tabs, serverName, allServerNames, maxTabs = 8) {
  const currentTabs = normalizeTerminalTabModels(tabs, allServerNames);
  if (!Array.isArray(allServerNames) || !allServerNames.includes(serverName)) {
    return { tabs: currentTabs, selectedTabId: currentTabs[0]?.id || "" };
  }

  const indexes = currentTabs
    .filter((tab) => tab.serverName === serverName)
    .map((tab) => {
      const match = String(tab.id || "").match(/#(\d+)$/);
      return match ? Number(match[1]) : 1;
    })
    .filter((value) => Number.isFinite(value) && value > 0);
  const nextIndex = Math.max(1, ...indexes) + 1;
  const id = `${serverName}#${nextIndex}`;
  const nextTab = { id, serverName, title: `${serverName} #${nextIndex}` };
  const nextTabs = [...currentTabs, nextTab].slice(-maxTabs);

  return { tabs: nextTabs, selectedTabId: id };
}

export function renameTerminalTabTitle(tabs, targetTabId, nextTitle) {
  const currentTabs = Array.isArray(tabs) ? tabs : [];
  const targetId = String(targetTabId || "").trim();
  const normalizedTitle = String(nextTitle || "").trim();
  if (!targetId || !normalizedTitle) return currentTabs;

  let changed = false;
  const nextTabs = currentTabs.map((tab) => {
    const tabId = typeof tab === "object" && tab ? String(tab.id || "").trim() : String(tab || "").trim();
    if (tabId !== targetId) return tab;
    changed = true;
    if (typeof tab === "object" && tab) return { ...tab, title: normalizedTitle };
    return { id: tabId, serverName: tabId, title: normalizedTitle };
  });

  return changed ? nextTabs : currentTabs;
}

export function toggleTerminalTabPinned(tabs, targetTabId) {
  const currentTabs = Array.isArray(tabs) ? tabs : [];
  const targetId = String(targetTabId || "").trim();
  if (!targetId) return currentTabs;

  let changed = false;
  const nextTabs = currentTabs.map((tab) => {
    const tabId = typeof tab === "object" && tab ? String(tab.id || "").trim() : String(tab || "").trim();
    if (tabId !== targetId) return tab;
    changed = true;
    const model = typeof tab === "object" && tab
      ? { ...tab }
      : { id: tabId, serverName: tabId, title: tabId };
    if (model.pinned) {
      delete model.pinned;
    } else {
      model.pinned = true;
    }
    return model;
  });

  return changed ? nextTabs : currentTabs;
}

export function getClosableTerminalTabIds(tabs, selectedTabId, scope = "others") {
  const currentTabs = Array.isArray(tabs) ? tabs : [];
  const targetId = String(selectedTabId || "").trim();
  const selectedIndex = currentTabs.findIndex((tab) => {
    const tabId = typeof tab === "object" && tab ? String(tab.id || "").trim() : String(tab || "").trim();
    return tabId === targetId;
  });
  if (selectedIndex < 0) return [];

  return currentTabs
    .map((tab, index) => {
      const tabId = typeof tab === "object" && tab ? String(tab.id || "").trim() : String(tab || "").trim();
      return { tab, tabId, index };
    })
    .filter(({ tab, tabId, index }) => {
      if (!tabId || tabId === targetId) return false;
      if (typeof tab === "object" && tab?.pinned) return false;
      return scope === "right" ? index > selectedIndex : true;
    })
    .map(({ tabId }) => tabId);
}

export function closeTerminalTabModels(tabs, closingTabIds, selectedTabId, allServerNames) {
  const currentTabs = normalizeTerminalTabModels(tabs, allServerNames);
  const closingIds = new Set((Array.isArray(closingTabIds) ? closingTabIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean));
  if (!closingIds.size) {
    const selectedTab = currentTabs.find((tab) => tab.id === selectedTabId) || currentTabs[0];
    return {
      tabs: currentTabs,
      selectedTabId: selectedTab?.id || "",
      selectedServer: selectedTab?.serverName || "",
      closedTabs: [],
    };
  }

  const closedTabs = currentTabs.filter((tab) => closingIds.has(tab.id));
  if (!closedTabs.length) {
    const selectedTab = currentTabs.find((tab) => tab.id === selectedTabId) || currentTabs[0];
    return {
      tabs: currentTabs,
      selectedTabId: selectedTab?.id || "",
      selectedServer: selectedTab?.serverName || "",
      closedTabs: [],
    };
  }

  const firstClosedIndex = currentTabs.findIndex((tab) => closingIds.has(tab.id));
  const remainingTabs = currentTabs.filter((tab) => !closingIds.has(tab.id));
  const fallbackTabs = normalizeTerminalTabModels([allServerNames?.[0]].filter(Boolean), allServerNames);
  const nextTabs = remainingTabs.length ? remainingTabs : fallbackTabs;
  const selectedTab = nextTabs.find((tab) => tab.id === selectedTabId)
    || nextTabs[Math.min(Math.max(firstClosedIndex, 0), nextTabs.length - 1)]
    || nextTabs[0];

  return {
    tabs: nextTabs,
    selectedTabId: selectedTab?.id || "",
    selectedServer: selectedTab?.serverName || "",
    closedTabs,
  };
}

export function moveTerminalTab(tabs, targetTabId, direction = 1) {
  const currentTabs = Array.isArray(tabs) ? tabs : [];
  const targetId = String(targetTabId || "").trim();
  const currentIndex = currentTabs.findIndex((tab) => {
    const tabId = typeof tab === "object" && tab ? String(tab.id || "").trim() : String(tab || "").trim();
    return tabId === targetId;
  });
  if (currentIndex < 0) return currentTabs;

  const step = Number(direction) < 0 ? -1 : 1;
  const nextIndex = currentIndex + step;
  if (nextIndex < 0 || nextIndex >= currentTabs.length) return currentTabs;

  const nextTabs = [...currentTabs];
  const [tab] = nextTabs.splice(currentIndex, 1);
  nextTabs.splice(nextIndex, 0, tab);
  return nextTabs;
}

export function openTerminalTab(tabs, serverName, allServerNames, maxTabs = 8) {
  const currentTabs = normalizeTabs(tabs, allServerNames);
  if (!allServerNames.includes(serverName)) return currentTabs;
  if (currentTabs.includes(serverName)) return currentTabs;
  return [...currentTabs, serverName].slice(-maxTabs);
}

export function closeTerminalTab(tabs, serverName, selectedServer, allServerNames) {
  const currentTabs = normalizeTabs(tabs, allServerNames);
  if (currentTabs.length <= 1 || !currentTabs.includes(serverName)) {
    return {
      tabs: currentTabs.length ? currentTabs : [allServerNames[0]].filter(Boolean),
      selectedServer: selectedServer || currentTabs[0] || allServerNames[0] || "",
    };
  }

  const closedIndex = currentTabs.indexOf(serverName);
  const nextTabs = currentTabs.filter((name) => name !== serverName);
  const selectedStillOpen = selectedServer !== serverName && nextTabs.includes(selectedServer);
  const selectedIndex = Math.min(closedIndex, nextTabs.length - 1);

  return {
    tabs: nextTabs,
    selectedServer: selectedStillOpen ? selectedServer : nextTabs[selectedIndex],
  };
}

export function removeServerTerminalTab(tabs, removedServerName, selectedServer, remainingServerNames) {
  const remainingNames = Array.isArray(remainingServerNames) ? remainingServerNames.filter(Boolean) : [];
  if (remainingNames.length === 0) return { tabs: [], selectedServer: "" };

  const usesTabModels = Array.isArray(tabs) && tabs.some((tab) => typeof tab === "object" && tab);
  if (usesTabModels) {
    const removedName = String(removedServerName || "").trim();
    const oldValidNames = removedName && !remainingNames.includes(removedName)
      ? [...remainingNames, removedName]
      : remainingNames;
    const currentTabs = normalizeTerminalTabModels(tabs, oldValidNames);
    const removedTabs = currentTabs.filter((tab) => tab.serverName === removedName);
    const removedIndex = currentTabs.findIndex((tab) => tab.serverName === removedName);
    const nextTabs = normalizeTerminalTabModels(
      currentTabs.filter((tab) => tab.serverName !== removedName && remainingNames.includes(tab.serverName)),
      remainingNames,
    );
    const fallbackTabs = nextTabs.length ? nextTabs : normalizeTerminalTabModels([remainingNames[0]].filter(Boolean), remainingNames);
    const selectedTab = fallbackTabs.find((tab) => tab.serverName === selectedServer)
      || fallbackTabs[Math.min(Math.max(removedIndex, 0), fallbackTabs.length - 1)]
      || fallbackTabs[0];

    return {
      tabs: fallbackTabs,
      selectedServer: selectedTab?.serverName || remainingNames[0] || "",
      selectedTabId: selectedTab?.id || "",
      removedTabs,
    };
  }

  const removedName = String(removedServerName || "").trim();
  const oldValidNames = removedName && !remainingNames.includes(removedName)
    ? [...remainingNames, removedName]
    : remainingNames;
  const currentTabs = normalizeTabs(tabs, oldValidNames);
  const removedIndex = currentTabs.indexOf(removedName);
  const nextTabs = currentTabs.filter((name) => name !== removedName && remainingNames.includes(name));
  const tabsAfterRemoval = nextTabs.length ? nextTabs : [remainingNames[0]].filter(Boolean);

  if (selectedServer && selectedServer !== removedName && tabsAfterRemoval.includes(selectedServer)) {
    return { tabs: tabsAfterRemoval, selectedServer };
  }

  const fallbackIndex = removedIndex >= 0 ? Math.min(removedIndex, tabsAfterRemoval.length - 1) : 0;
  return {
    tabs: tabsAfterRemoval,
    selectedServer: tabsAfterRemoval[fallbackIndex] || remainingNames[0] || "",
  };
}

export function renameServerTerminalTab(tabs, oldServerName, newServerName, selectedServer, allServerNames) {
  const validNames = Array.isArray(allServerNames) ? allServerNames.filter(Boolean) : [];
  if (!validNames.length) return { tabs: [], selectedServer: "" };

  const oldName = String(oldServerName || "").trim();
  const newName = String(newServerName || "").trim();
  if (!oldName || !newName || oldName === newName) {
    const currentTabs = normalizeTabs(tabs, validNames);
    return {
      tabs: currentTabs,
      selectedServer: currentTabs.includes(selectedServer) ? selectedServer : currentTabs[0] || validNames[0] || "",
    };
  }

  const oldValidNames = validNames.includes(oldName) ? validNames : [...validNames, oldName];
  const currentTabs = normalizeTabs(tabs, oldValidNames);
  const seen = new Set();
  const renamedTabs = [];
  for (const tab of currentTabs) {
    const nextName = tab === oldName ? newName : tab;
    if (!validNames.includes(nextName) || seen.has(nextName)) continue;
    seen.add(nextName);
    renamedTabs.push(nextName);
  }
  const tabsAfterRename = renamedTabs.length ? renamedTabs : [validNames[0]].filter(Boolean);

  return {
    tabs: tabsAfterRename,
    selectedServer: selectedServer === oldName
      ? newName
      : tabsAfterRename.includes(selectedServer) ? selectedServer : tabsAfterRename[0] || validNames[0] || "",
  };
}

export function openNextTerminalTab(tabs, allServerNames, selectedServer) {
  const currentTabs = normalizeTabs(tabs, allServerNames);
  const startIndex = Math.max(0, allServerNames.indexOf(selectedServer));
  const orderedNames = [...allServerNames.slice(startIndex + 1), ...allServerNames.slice(0, startIndex + 1)];
  const nextServer = orderedNames.find((name) => !currentTabs.includes(name)) || selectedServer || currentTabs[0] || allServerNames[0] || "";

  return {
    tabs: openTerminalTab(currentTabs, nextServer, allServerNames),
    selectedServer: nextServer,
  };
}

export function selectAdjacentTerminalTab(tabs, allServerNames, selectedServer, direction = 1) {
  const currentTabs = normalizeTabs(tabs, allServerNames);
  if (currentTabs.length === 0) return allServerNames?.[0] || "";
  const currentIndex = currentTabs.includes(selectedServer) ? currentTabs.indexOf(selectedServer) : 0;
  const step = Number(direction) < 0 ? -1 : 1;
  const nextIndex = (currentIndex + step + currentTabs.length) % currentTabs.length;
  return currentTabs[nextIndex] || currentTabs[0] || "";
}

export function getTerminalTabCloseImpact(sessionKey, sessions, serverName = sessionKey, tab = null) {
  const session = sessions?.[sessionKey] || {};
  const sessionId = String(session.sessionId || "").trim();
  const hasActiveSession = Boolean(sessionId);
  const isPinned = Boolean(tab?.pinned);

  if (isPinned) {
    return {
      hasActiveSession,
      sessionId,
      isPinned,
      blocked: true,
      confirmMessage: `固定标签 ${serverName} 不能直接关闭，请先取消固定。`,
    };
  }

  return {
    hasActiveSession,
    sessionId,
    isPinned,
    blocked: false,
    confirmMessage: hasActiveSession
      ? `关闭 ${serverName} 标签会断开 SSH 会话。\n\n确认断开 SSH 会话并关闭标签吗？`
      : "",
  };
}

export function getTerminalTabSessionState(session) {
  if (session?.busy) {
    return { key: "busy", label: "忙碌", tone: "amber" };
  }
  if (session?.lastError) {
    return { key: "error", label: "连接异常", tone: "red" };
  }
  if (session?.sessionId) {
    return { key: "connected", label: "已连接", tone: "green" };
  }
  if (session?.disconnectedAt) {
    return { key: "disconnected", label: "已断开", tone: "amber" };
  }
  return { key: "idle", label: "未连接", tone: "gray" };
}

export function getTerminalSessionRecovery(session) {
  if (session?.busy) {
    return { visible: false, tone: "gray", title: "", detail: "", actionLabel: "" };
  }
  if (session?.lastError) {
    const failureLabel = String(session?.sshFailure?.label || "").trim();
    const failureSummary = String(session?.sshFailure?.summary || "").trim();
    const failureSuggestions = Array.isArray(session?.sshFailure?.suggestions)
      ? session.sshFailure.suggestions.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const detailParts = [String(session.lastError), failureSummary].filter(Boolean);
    return {
      visible: true,
      tone: "red",
      title: failureLabel ? `SSH 会话异常：${failureLabel}` : "SSH 会话异常",
      detail: detailParts.join("\n"),
      actionLabel: "重新连接",
      ...(failureSuggestions.length ? { suggestions: failureSuggestions } : {}),
    };
  }
  if (session?.sessionId) {
    return { visible: false, tone: "gray", title: "", detail: "", actionLabel: "" };
  }
  if (session?.disconnectedAt) {
    const disconnectedText = formatTerminalRecoveryTime(session.disconnectedAt);
    const detail = disconnectedText
      ? `断开时间：${disconnectedText}。可以重新连接继续操作。`
      : "可以重新连接继续操作。";
    return {
      visible: true,
      tone: "amber",
      title: "SSH 会话已断开",
      detail,
      actionLabel: "重新连接",
    };
  }
  return { visible: false, tone: "gray", title: "", detail: "", actionLabel: "" };
}

export function getTerminalSessionDiagnosticBadge(session) {
  if (session?.busy || session?.sessionId) {
    return { visible: false, tone: "gray", label: "", title: "" };
  }
  if (session?.lastError) {
    const failureLabel = String(session?.sshFailure?.label || session?.failureKind || "").trim();
    const failureSummary = String(session?.sshFailure?.summary || "").trim();
    return {
      visible: true,
      tone: "red",
      label: failureLabel ? `异常：${failureLabel}` : "连接异常",
      title: [String(session.lastError), failureSummary].filter(Boolean).join("\n"),
    };
  }
  if (session?.disconnectedAt) {
    const disconnectedText = formatTerminalRecoveryTime(session.disconnectedAt);
    return {
      visible: true,
      tone: "amber",
      label: "已断开",
      title: disconnectedText ? `断开时间：${disconnectedText}` : "SSH 会话已断开，可以重新连接。",
    };
  }
  return { visible: false, tone: "gray", label: "", title: "" };
}

export function formatTerminalRecoveryTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/);
  if (isoMatch) return `${isoMatch[1]} ${isoMatch[2]} UTC`;
  return raw;
}

export function buildTerminalSessionRecoveryActions(session) {
  if (session?.busy || session?.sessionId) return [];

  if (session?.lastError) {
    const failureKind = String(session?.sshFailure?.kind || session?.failureKind || "").trim();
    const needsCredentialRepair = ["auth", "key-file", "agent-auth"].includes(failureKind);
    const credentialRepairAction = needsCredentialRepair
      ? [{
        id: "open-auth-center",
        label: failureKind === "agent-auth" ? "检查 SSH Agent" : failureKind === "key-file" ? "检查私钥文件" : "补录凭据",
        tone: "primary",
        target: "auth-center",
      }]
      : [];
    return [
      ...credentialRepairAction,
      { id: "reconnect-session", label: "重新连接", tone: needsCredentialRepair ? "secondary" : "primary", target: "reconnect" },
      { id: "reconnect-clear-session", label: "清空并重连", tone: "secondary", target: "reconnect-clear" },
      { id: "test-connection", label: "测试连接", tone: "secondary", target: "connection-test" },
      { id: "edit-connection", label: "编辑连接", tone: "secondary", target: "edit-connection" },
      { id: "agent-diagnostic", label: "交给 Agent 排查", tone: "secondary", target: "agent-diagnostic" },
      { id: "copy-error-detail", label: "复制错误详情", tone: "secondary", target: "copy-error-detail" },
      { id: "copy-diagnostic-summary", label: "复制排障摘要", tone: "secondary", target: "copy-diagnostic-summary" },
      { id: "copy-ssh-command", label: "复制 SSH 命令", tone: "secondary", target: "copy-ssh-command" },
      { id: "session-logs", label: "查看会话日志", tone: "secondary", target: "session-logs" },
      { id: "dismiss-recovery", label: "隐藏提示", tone: "secondary", target: "dismiss-recovery" },
      { id: "export-diagnostic", label: "导出诊断包", tone: "secondary", target: "export-diagnostic" },
    ];
  }

  if (session?.disconnectedAt) {
    return [
      { id: "reconnect-session", label: "重新连接", tone: "primary", target: "reconnect" },
      { id: "reconnect-clear-session", label: "清空并重连", tone: "secondary", target: "reconnect-clear" },
      { id: "test-connection", label: "测试连接", tone: "secondary", target: "connection-test" },
      { id: "edit-connection", label: "编辑连接", tone: "secondary", target: "edit-connection" },
      { id: "copy-ssh-command", label: "复制 SSH 命令", tone: "secondary", target: "copy-ssh-command" },
      { id: "session-logs", label: "查看会话日志", tone: "secondary", target: "session-logs" },
      { id: "dismiss-recovery", label: "隐藏提示", tone: "secondary", target: "dismiss-recovery" },
      { id: "export-diagnostic", label: "导出诊断包", tone: "secondary", target: "export-diagnostic" },
    ];
  }

  return [];
}

function normalizeTabs(tabs, allServerNames) {
  const validNames = Array.isArray(allServerNames) ? allServerNames : [];
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(tabs) ? tabs : []) {
    if (!validNames.includes(item) || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  if (result.length === 0 && validNames[0]) result.push(validNames[0]);
  return result;
}

function buildTerminalTabTitle(serverName, id) {
  const match = String(id || "").match(/#(\d+)$/);
  return match && match[1] !== "1" ? `${serverName} #${match[1]}` : serverName;
}
