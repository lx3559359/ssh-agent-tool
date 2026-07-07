export const AGENT_TASK_STATUSES = ["待审批", "已审批", "已完成", "已取消"];

export function buildAgentTask(capability, context = {}) {
  const type = String(capability?.type || "").trim();
  const name = String(capability?.name || "").trim();
  const targetServer = String(context.serverName || "").trim();
  if (!["Skill", "MCP", "CLI"].includes(type)) throw new Error(`不支持的 Agent 任务类型：${type || "空"}`);
  if (!name) throw new Error("Agent 任务名称不能为空。");
  if (!targetServer) throw new Error("Agent 任务必须绑定目标服务器。");

  const createdAt = String(context.createdAt || new Date().toISOString());
  const command = type === "CLI" ? String(capability.entry || "").trim() : "";
  const entry = type === "Skill" ? String(capability.entry || "").trim() : "";
  const endpoint = type === "MCP" ? String(capability.endpoint || capability.entry || "").trim() : "";
  const headers = type === "MCP" ? normalizeMcpHeaders(capability.headers) : [];
  const commands = type === "Skill" ? normalizeSkillCommands(capability.commands) : [];
  const permission = String(capability.permission || (type === "CLI" ? "审批后执行" : "只读")).trim();
  const targetFile = String(context.fileName || "").trim();
  const serverContext = type === "Skill" ? normalizeSkillServerContext(context, targetServer, targetFile) : null;

  return {
    id: makeTaskId(type, name, targetServer),
    createdAt,
    status: "待审批",
    capabilityType: type,
    capabilityName: name,
    title: buildTaskTitle(type, name),
    description: buildTaskDescription(type, name, targetServer, targetFile),
    targetServer,
    targetFile,
    command,
    entry,
    endpoint,
    headers,
    commands,
    ...(serverContext ? { serverContext } : {}),
    permission,
    risk: permission.includes("只读") ? "低" : "中",
  };
}

export function buildSshDiagnosticAgentTask(diagnostics, context = {}) {
  const serverName = String(context.serverName || "").trim();
  if (!serverName) throw new Error("SSH 诊断任务必须绑定目标服务器。");

  const command = selectSafeDiagnosticCommand(diagnostics, context.server || {});
  const title = String(diagnostics?.title || "SSH 连接诊断").trim() || "SSH 连接诊断";
  const task = buildAgentTask(
    {
      type: "CLI",
      name: "SSH 连接诊断",
      entry: command,
      permission: "只读",
    },
    {
      serverName,
      fileName: "",
      createdAt: context.createdAt,
    },
  );

  return {
    ...task,
    description: `${title}：${String(diagnostics?.summary || "根据当前连接失败信息生成只读排查任务。").trim()}`,
    diagnosticsKind: String(diagnostics?.kind || "unknown"),
    nextSteps: (Array.isArray(diagnostics?.nextSteps) ? diagnostics.nextSteps : []).map((item) => String(item || "").trim()).filter(Boolean),
  };
}

function selectSafeDiagnosticCommand(diagnostics, server = {}) {
  const host = String(server.ip || server.host || "").trim();
  if (host) {
    const port = String(server.port || "22").trim() || "22";
    const kind = String(diagnostics?.kind || "unknown").trim() || "unknown";
    return `local:ssh-agent-tool diagnose-ssh --host ${quoteCliArg(host)} --port ${quoteCliArg(port)} --kind ${quoteCliArg(kind)}`;
  }

  const commands = Array.isArray(diagnostics?.commands) ? diagnostics.commands : [];
  const command = commands.map((item) => String(item || "").trim()).find(Boolean);
  return command || "ssh -vvv";
}

function quoteCliArg(value) {
  const text = String(value || "").trim();
  if (!text) return "\"\"";
  if (/^[A-Za-z0-9._:-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, "\\\"")}"`;
}

function normalizeMcpHeaders(headers = []) {
  return (Array.isArray(headers) ? headers : [])
    .map((item) => ({
      name: String(item?.name || "").trim(),
      value: String(item?.value || ""),
      enabled: item?.enabled !== false,
    }))
    .filter((item) => item.name);
}

export function queueAgentTask(queue, task) {
  const normalizedTask = normalizeTask(task);
  const next = Array.isArray(queue) ? [...queue] : [];
  const duplicate = next.some(
    (item) =>
      item.status === "待审批" &&
      item.capabilityType === normalizedTask.capabilityType &&
      item.capabilityName === normalizedTask.capabilityName &&
      item.targetServer === normalizedTask.targetServer,
  );
  if (!duplicate) next.unshift(normalizedTask);
  return next;
}

export function approveAgentTask(queue, taskId, approvedAt = new Date().toISOString()) {
  return updateTask(queue, taskId, (task) => ({
    ...task,
    headers: normalizeMcpHeaders(task.headers),
    status: "已审批",
    approvedAt,
  }));
}

export function completeAgentTask(queue, taskId, result = "", completedAt = new Date().toISOString()) {
  return updateTask(queue, taskId, (task) => ({
    ...task,
    status: "已完成",
    result,
    completedAt,
  }));
}

export function cancelAgentTask(queue, taskId, result = "用户取消", cancelledAt = new Date().toISOString()) {
  return updateTask(queue, taskId, (task) => {
    if (task.status === "已完成" || task.status === "已取消") return task;
    return {
      ...task,
      status: "已取消",
      result,
      cancelledAt,
    };
  });
}

export function getPendingAgentTasks(queue) {
  return (Array.isArray(queue) ? queue : []).filter((task) => task.status === "待审批");
}

export function filterAgentTasks(queue, filters = {}) {
  const tasks = (Array.isArray(queue) ? queue : []).map(normalizeTask);
  const server = String(filters.server || "").trim();
  const capabilityType = String(filters.capabilityType || "").trim();
  const status = String(filters.status || "").trim();
  const query = String(filters.query || "").trim().toLowerCase();

  return tasks.filter((task) => {
    if (server && task.targetServer !== server) return false;
    if (capabilityType && task.capabilityType !== capabilityType) return false;
    if (status && task.status !== status) return false;
    if (!query) return true;

    const searchable = [
      task.title,
      task.description,
      task.capabilityType,
      task.capabilityName,
      task.targetServer,
      task.targetFile,
      task.command,
      task.endpoint,
      task.result,
      task.status,
      task.permission,
    ]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");

    return searchable.includes(query);
  });
}

export function summarizeAgentTasks(queue) {
  const tasks = (Array.isArray(queue) ? queue : []).map(normalizeTask);
  const byType = { Skill: 0, MCP: 0, CLI: 0 };

  tasks.forEach((task) => {
    if (Object.prototype.hasOwnProperty.call(byType, task.capabilityType)) {
      byType[task.capabilityType] += 1;
    }
  });

  return {
    ...countTasksByStatus(tasks),
    byType,
  };
}

export function buildAgentInspectionReport(queue, servers = {}, options = {}) {
  const tasks = (Array.isArray(queue) ? queue : []).map(normalizeTask);
  const generatedAt = String(options.generatedAt || new Date().toLocaleString("zh-CN"));
  const lines = ["# Agent 巡检报告", "", `生成时间：${generatedAt}`, ""];

  if (tasks.length === 0) {
    lines.push("暂无 Agent 巡检任务。");
    return lines.join("\n");
  }

  const summary = countTasksByStatus(tasks);
  lines.push(`总任务 ${summary.total}，待审批 ${summary.pending}，已审批 ${summary.approved}，已完成 ${summary.completed}，已取消 ${summary.cancelled}`);
  lines.push("");

  groupTasksByServer(tasks).forEach(([serverName, serverTasks]) => {
    const server = servers?.[serverName] || {};
    const serverMeta = [
      server.ip ? `地址：${server.ip}` : "",
      server.group ? `分组：${server.group}` : "",
      server.state ? `状态：${server.state}` : "",
    ].filter(Boolean).join(" / ");

    lines.push(`## ${serverName}`);
    if (serverMeta) lines.push(serverMeta);
    lines.push("");

    serverTasks.forEach((task) => {
      lines.push(`- [${task.status}] ${task.capabilityType} / ${task.capabilityName}`);
      if (task.targetFile) lines.push(`  - 上下文文件：${task.targetFile}`);
      if (task.command) lines.push(`  - 命令：${task.command}`);
      if (task.endpoint) lines.push(`  - MCP：${task.endpoint}`);
      if (task.result) lines.push(`  - 结果：${task.result}`);
    });
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

export function buildAgentReportFileName(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const datePart = `${stamp.slice(0, 8)}-${stamp.slice(8, 14)}`;
  const title = sanitizeFileNamePart(options.title || "");
  return ["ssh-agent-inspection", datePart, title].filter(Boolean).join("-") + ".md";
}

export function buildAgentReportArchiveEntry(options = {}) {
  const createdAt = String(options.createdAt || new Date().toISOString());
  const title = String(options.title || "Agent 巡检报告").trim() || "Agent 巡检报告";
  const report = String(options.report || "");
  const createdDate = new Date(createdAt);
  const safeDate = Number.isNaN(createdDate.getTime()) ? new Date() : createdDate;
  const fileName = buildAgentReportFileName({ title, now: safeDate });

  return {
    id: `report-${createdAt}-${sanitizeFileNamePart(title)}`,
    title,
    fileName,
    content: report,
    taskCount: Number(options.taskCount || 0),
    createdAt,
  };
}

export function addAgentReportArchiveEntry(currentArchives, entry, limit = 10) {
  const normalizedEntry = normalizeReportArchiveEntry(entry);
  const next = [normalizedEntry, ...(Array.isArray(currentArchives) ? currentArchives : []).filter((item) => item?.id !== normalizedEntry.id)];
  return next.slice(0, Math.max(1, Number(limit || 10)));
}

export function filterAgentReportArchives(archives, query = "") {
  const keyword = String(query || "").trim().toLowerCase();
  const normalized = (Array.isArray(archives) ? archives : []).map(normalizeReportArchiveEntry);
  if (!keyword) return normalized;

  return normalized.filter((item) =>
    [item.title, item.fileName, item.content, item.createdAt]
      .some((field) => String(field || "").toLowerCase().includes(keyword)),
  );
}

export function removeAgentReportArchiveEntry(archives, archiveId) {
  const targetId = String(archiveId || "");
  return (Array.isArray(archives) ? archives : [])
    .map(normalizeReportArchiveEntry)
    .filter((item) => item.id !== targetId);
}

export function buildAgentReportArchiveExport(archives, options = {}) {
  return JSON.stringify(
    {
      schema: "ssh-agent-report-archive-v1",
      exportedAt: String(options.exportedAt || new Date().toISOString()),
      archives: (Array.isArray(archives) ? archives : []).map(normalizeReportArchiveEntry),
    },
    null,
    2,
  );
}

function updateTask(queue, taskId, updater) {
  return (Array.isArray(queue) ? queue : []).map((task) => (task.id === taskId ? updater(normalizeTask(task)) : task));
}

function normalizeTask(task) {
  if (!task || !task.id) throw new Error("Agent 任务无效。");
  return {
    ...task,
    status: AGENT_TASK_STATUSES.includes(task.status) ? task.status : "待审批",
  };
}

function normalizeSkillCommands(commands = []) {
  return (Array.isArray(commands) ? commands : [])
    .map((item) => {
      const command = String(item?.command || "").trim();
      if (!command) return null;
      return {
        label: String(item?.label || command).trim() || command,
        command,
      };
    })
    .filter(Boolean);
}

function normalizeSkillServerContext(context = {}, targetServer = "", targetFile = "") {
  const server = context.server && typeof context.server === "object" ? context.server : {};
  const host = String(server.ip || server.host || "").trim();
  const normalized = {
    server: String(targetServer || context.serverName || "").trim(),
    host,
    ip: host,
    port: String(server.port || "22").trim() || "22",
    user: String(server.user || "root").trim() || "root",
    cwd: String(server.cwd || "").trim(),
    group: String(server.group || "").trim(),
    file: String(targetFile || context.fileName || "").trim(),
  };

  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== ""));
}

function buildTaskTitle(type, name) {
  if (type === "Skill") return `运行 ${name}`;
  if (type === "MCP") return `调用 ${name}`;
  return `准备 CLI：${name}`;
}

function buildTaskDescription(type, name, targetServer, targetFile) {
  const fileText = targetFile ? `，上下文文件 ${targetFile}` : "";
  if (type === "MCP") return `在 ${targetServer} 上结合 ${name} 外部上下文${fileText}`;
  if (type === "CLI") return `在 ${targetServer} 的 SSH 终端中准备执行 ${name}${fileText}`;
  return `在 ${targetServer} 上运行诊断 Skill：${name}${fileText}`;
}

function makeTaskId(type, name, targetServer) {
  return `task-${type.toLowerCase()}-${name}-${targetServer}`;
}

function countTasksByStatus(tasks) {
  return tasks.reduce(
    (summary, task) => {
      summary.total += 1;
      if (task.status === "待审批") summary.pending += 1;
      else if (task.status === "已审批") summary.approved += 1;
      else if (task.status === "已完成") summary.completed += 1;
      else if (task.status === "已取消") summary.cancelled += 1;
      return summary;
    },
    { total: 0, pending: 0, approved: 0, completed: 0, cancelled: 0 },
  );
}

function groupTasksByServer(tasks) {
  const order = [];
  const groups = new Map();
  tasks.forEach((task) => {
    const serverName = task.targetServer || "未指定服务器";
    if (!groups.has(serverName)) {
      groups.set(serverName, []);
      order.push(serverName);
    }
    groups.get(serverName).push(task);
  });
  return order.map((serverName) => [serverName, groups.get(serverName)]);
}

function sanitizeFileNamePart(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeReportArchiveEntry(entry) {
  if (!entry?.id) throw new Error("报告归档记录无效。");
  return {
    id: String(entry.id),
    title: String(entry.title || "Agent 巡检报告"),
    fileName: String(entry.fileName || "ssh-agent-inspection.md"),
    content: String(entry.content || ""),
    taskCount: Number(entry.taskCount || 0),
    createdAt: String(entry.createdAt || new Date().toISOString()),
  };
}
