import { COMMAND_POLICY_ACTIONS, shouldRequireSecondApproval } from "./commandPolicy.js";

const DEFAULT_SKILL_COMMAND_TEMPLATES = {
  "skills/linux-health.md": [
    { label: "系统负载", command: "uptime" },
    { label: "内存使用", command: "free -h" },
    { label: "磁盘使用", command: "df -hT" },
    { label: "监听端口", command: "ss -lntp" },
    { label: "失败服务", command: "systemctl list-units --failed" },
  ],
  "skills/nginx-502.md": [
    { label: "Nginx 配置检查", command: "nginx -t" },
    { label: "Nginx 服务状态", command: "systemctl status nginx" },
    { label: "错误日志", command: "tail -n 200 /var/log/nginx/error.log" },
    { label: "监听端口", command: "ss -lntp" },
  ],
  "skills/docker-health.md": [
    { label: "容器列表", command: "docker ps" },
    { label: "容器资源", command: "docker stats --no-stream" },
    { label: "Docker 服务状态", command: "systemctl status docker" },
    { label: "Docker 日志", command: "journalctl -u docker -n 100 --no-pager" },
  ],
};

const MCP_CONNECTOR_TEMPLATES = {
  "mcp://prometheus": {
    connector: "prometheus",
    requests: (context) => [
      {
        label: "CPU 与负载趋势",
        tool: "query_range",
        params: {
          query: `node_load1{instance=~"${context.host || context.server}.*"}`,
          range: "30m",
        },
      },
      {
        label: "内存可用率",
        tool: "query",
        params: {
          query: `node_memory_MemAvailable_bytes{instance=~"${context.host || context.server}.*"} / node_memory_MemTotal_bytes{instance=~"${context.host || context.server}.*"}`,
        },
      },
      {
        label: "磁盘可用率",
        tool: "query",
        params: {
          query: `node_filesystem_avail_bytes{instance=~"${context.host || context.server}.*",mountpoint="/"} / node_filesystem_size_bytes{instance=~"${context.host || context.server}.*",mountpoint="/"}`,
        },
      },
    ],
  },
  "mcp://cmdb": {
    connector: "cmdb",
    requests: (context) => [
      {
        label: "主机资产",
        tool: "get_host",
        params: {
          host: context.host || "",
          name: context.server || "",
        },
      },
      {
        label: "依赖关系",
        tool: "list_dependencies",
        params: {
          host: context.host || "",
          name: context.server || "",
        },
      },
    ],
  },
};

export function buildAgentApprovalDecision(task, policy = {}) {
  const command = String(task?.command || "").trim();
  if (task?.capabilityType === "CLI" && isLocalCliCommand(command)) {
    const runtimeRequest = buildAgentRuntimeRequest(task);
    return {
      action: "queue_runner",
      result: `已进入 CLI Runner 队列：${runtimeRequest.command || task.capabilityName}`,
      notice: `已审批并加入 CLI Runner：${task?.capabilityName || "未命名任务"}`,
      runtimeRequest,
      auditEvent: {
        type: "agent_cli_queued",
        server: runtimeRequest.server,
        actor: "agent",
        capability: runtimeRequest.capabilityName,
        command: runtimeRequest.command,
        status: "queued",
      },
    };
  }

  if (task?.capabilityType !== "CLI" || !command) {
    const runtimeRequest = buildAgentRuntimeRequest(task);
    if (runtimeRequest) {
      const isSkill = runtimeRequest.kind === "skill";
      const target = isSkill ? runtimeRequest.entry : runtimeRequest.endpoint;
      const queueName = isSkill ? "Skill Runner 队列" : "MCP 调用队列";
      return {
        action: "queue_runner",
        result: `已进入 ${queueName}：${target || task.capabilityName}`,
        notice: `已审批并加入 ${queueName}：${task?.capabilityName || "未命名任务"}`,
        runtimeRequest,
        auditEvent: {
          type: isSkill ? "agent_skill_queued" : "agent_mcp_queued",
          server: runtimeRequest.server,
          actor: "agent",
          capability: runtimeRequest.capabilityName,
          ...(isSkill ? { entry: runtimeRequest.entry } : { endpoint: runtimeRequest.endpoint }),
          status: "queued",
        },
      };
    }

    return {
      action: "approve_only",
      result: "已审批 Agent 任务",
      notice: `已审批 Agent 任务：${task?.title || task?.capabilityName || "未命名任务"}`,
    };
  }

  if (policy.action === COMMAND_POLICY_ACTIONS.block) {
    return {
      action: "block",
      command,
      policy,
      result: policy.message || "命令策略已阻断。",
      notice: `命令策略已阻断：${policy.message || "高风险命令"}`,
      auditEvent: {
        type: "command_blocked",
        server: task.targetServer,
        actor: "agent",
        command,
        message: policy.message || "命令策略已阻断。",
        status: "blocked",
      },
    };
  }

  const requiresSecondApproval = shouldRequireSecondApproval(policy);
  return {
    action: "stage_command",
    command,
    policy,
    result: "已写入 SSH 终端输入框",
    requiresSecondApproval,
    notice: requiresSecondApproval
      ? `已写入终端，但发送前仍需二次确认：${command}`
      : `已审批并写入终端命令：${command}`,
  };
}

export function buildAgentRuntimeRequest(task) {
  if (task?.capabilityType === "Skill") {
    const request = {
      kind: "skill",
      server: String(task.targetServer || ""),
      capabilityName: String(task.capabilityName || ""),
      entry: String(task.entry || ""),
      targetFile: String(task.targetFile || ""),
      status: "queued",
    };
    const commands = normalizeSkillCommands(task.commands);
    if (commands.length) request.commands = commands;
    if (task.serverContext && typeof task.serverContext === "object") {
      const serverContext = normalizeSkillServerContext(task.serverContext, {
        server: request.server,
        file: request.targetFile,
      });
      if (Object.keys(serverContext).length) request.serverContext = serverContext;
    }
    return request;
  }

  if (task?.capabilityType === "MCP") {
    return {
      kind: "mcp",
      server: String(task.targetServer || ""),
      capabilityName: String(task.capabilityName || ""),
      endpoint: String(task.endpoint || ""),
      headers: normalizeMcpHeaders(task.headers),
      targetFile: String(task.targetFile || ""),
      status: "queued",
    };
  }

  if (task?.capabilityType === "CLI" && isLocalCliCommand(task.command)) {
    return {
      kind: "cli",
      server: String(task.targetServer || ""),
      capabilityName: String(task.capabilityName || ""),
      command: normalizeLocalCliCommand(task.command),
      targetFile: String(task.targetFile || ""),
      status: "queued",
    };
  }

  return null;
}

export function buildCliRunnerPlan(runtimeRequest) {
  const command = String(runtimeRequest?.command || "").trim();
  const capabilityName = String(runtimeRequest?.capabilityName || "未命名 CLI");
  const blocked = !command || /[;&|<>`]/.test(command);
  return {
    ready: runtimeRequest?.kind === "cli" && !blocked,
    kind: "cli",
    server: String(runtimeRequest?.server || ""),
    capabilityName,
    command,
    blockedCount: blocked ? 1 : 0,
    summary: blocked ? `CLI「${capabilityName}」包含不安全的 shell 字符，已阻止执行。` : `CLI「${capabilityName}」准备执行本地命令。`,
  };
}

export function formatCliRunnerTerminalLines(plan) {
  const server = String(plan?.server || "unknown");
  const capabilityName = String(plan?.capabilityName || "未命名 CLI");
  return [
    `[${server}]$ # Agent CLI Runner：${capabilityName}`,
    `# ${plan?.summary || "未生成 CLI 执行计划。"}`,
    plan?.command ? `local$ ${plan.command}` : "# 未配置本地命令",
  ];
}

export function formatCliRunnerResultTerminalLines(plan, result) {
  const server = String(plan?.server || "unknown");
  const capabilityName = String(plan?.capabilityName || "未命名 CLI");
  const lines = [
    `[${server}]$ # CLI Runner 结果：${capabilityName}`,
    `# returnCode=${result?.returnCode ?? 0} status=${result?.ok ? "ok" : "failed"}`,
  ];
  if (result?.stdout) lines.push(String(result.stdout));
  if (result?.stderr) lines.push(String(result.stderr));
  if (!result?.stdout && !result?.stderr && result?.message) lines.push(String(result.message));
  return lines;
}

export function buildSkillRunnerPlan(runtimeRequest, evaluatePolicy, options = {}) {
  const entry = String(runtimeRequest?.entry || "").trim();
  const templates = options.templates || DEFAULT_SKILL_COMMAND_TEMPLATES;
  const customCommands = normalizeSkillCommands(runtimeRequest?.commands);
  const template = customCommands.length ? customCommands : (Array.isArray(templates[entry]) ? templates[entry] : []);
  const skillName = String(runtimeRequest?.capabilityName || entry || "未命名 Skill");

  if (runtimeRequest?.kind !== "skill" || template.length === 0) {
    return {
      ready: false,
      kind: "skill",
      server: String(runtimeRequest?.server || ""),
      skillName,
      entry,
      commands: [],
      blockedCount: 0,
      summary: `Skill「${skillName}」暂未配置可执行命令模板。`,
    };
  }

  const commands = template.map((item) => {
    const command = renderSkillCommandTemplate(item.command, runtimeRequest?.serverContext).trim();
    return {
      label: String(item.label || command || "未命名命令"),
      command,
      policy: typeof evaluatePolicy === "function" ? evaluatePolicy(command) : {},
    };
  });
  const blockedCount = commands.filter((item) => item.policy?.action === COMMAND_POLICY_ACTIONS.block).length;

  return {
    ready: blockedCount === 0,
    kind: "skill",
    server: String(runtimeRequest.server || ""),
    skillName,
    entry,
    commands,
    blockedCount,
    summary:
      blockedCount > 0
        ? `Skill「${skillName}」包含 ${blockedCount} 条被策略阻断的命令，已停止进入执行准备。`
        : `Skill「${skillName}」已生成 ${commands.length} 条只读 SSH 诊断命令。`,
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

function normalizeSkillServerContext(context = {}, defaults = {}) {
  const source = context && typeof context === "object" ? context : {};
  const normalized = {
    server: source.server || defaults.server,
    host: source.host || source.ip || defaults.host,
    ip: source.ip || source.host || defaults.host,
    port: source.port || defaults.port,
    user: source.user || defaults.user,
    cwd: source.cwd || defaults.cwd,
    group: source.group || defaults.group,
    file: source.file || defaults.file,
  };

  return Object.fromEntries(
    Object.entries(normalized)
      .map(([key, value]) => [key, String(value || "").trim()])
      .filter(([, value]) => value !== ""),
  );
}

function renderSkillCommandTemplate(command, context = {}) {
  const source = String(command || "");
  const safeContext = normalizeSkillServerContext(context);
  return source.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(safeContext, key)) return match;
    return quoteShellValue(safeContext[key]);
  });
}

function quoteShellValue(value) {
  return `'${String(value ?? "").replace(/'/g, "'\\''")}'`;
}

export function formatSkillRunnerTerminalLines(plan) {
  const server = String(plan?.server || "unknown");
  const skillName = String(plan?.skillName || "未命名 Skill");
  const lines = [`[${server}]$ # Agent Skill Runner：${skillName}`, `# ${plan?.summary || "未生成 Skill 执行计划。"}`];

  (Array.isArray(plan?.commands) ? plan.commands : []).forEach((item, index) => {
    lines.push(`# ${index + 1}. ${item.label}`);
    lines.push(item.command);
  });

  return lines;
}

export function buildSkillRunnerDispatch(plan, options = {}) {
  const commands = Array.isArray(plan?.commands) ? plan.commands : [];
  if (!plan?.ready) {
    return {
      mode: "blocked",
      reason: "skill_plan_not_ready",
      commands: [],
    };
  }

  const sessionId = String(options.sessionId || "").trim();
  const canSend = Boolean(options.canSend);
  if (sessionId && canSend) {
    return {
      mode: "execute",
      sessionId,
      commands,
    };
  }

  return {
    mode: "stage_first",
    reason: sessionId ? "sender_unavailable" : "no_active_session",
    firstCommand: commands[0]?.command || "",
    commands,
  };
}

export function buildMcpRunnerPlan(runtimeRequest, serverContext = {}, options = {}) {
  const endpoint = String(runtimeRequest?.endpoint || "").trim();
  const templates = options.templates || MCP_CONNECTOR_TEMPLATES;
  const template = templates[endpoint];
  const capabilityName = String(runtimeRequest?.capabilityName || endpoint || "未命名 MCP");
  const context = {
    server: String(runtimeRequest?.server || ""),
    host: String(serverContext.host || serverContext.ip || ""),
    group: String(serverContext.group || ""),
    targetFile: String(runtimeRequest?.targetFile || ""),
  };

  if (runtimeRequest?.kind === "mcp" && isHttpEndpoint(endpoint)) {
    const requests = buildHttpMcpRequests();
    return {
      ready: true,
      kind: "mcp",
      server: context.server,
      capabilityName,
      endpoint,
      connector: "http-jsonrpc",
      transport: "http",
      headers: normalizeMcpHeaders(runtimeRequest.headers),
      requests,
      summary: `MCP「${capabilityName}」已生成 ${requests.length} 个 HTTP JSON-RPC 调用请求。`,
    };
  }

  if (runtimeRequest?.kind !== "mcp" || !template) {
    return {
      ready: false,
      kind: "mcp",
      server: context.server,
      capabilityName,
      endpoint,
      connector: "",
      requests: [],
      summary: `MCP「${capabilityName}」暂未配置可调用连接器。`,
    };
  }

  const requests = template.requests(context).map((item) => ({
    label: String(item.label || item.tool || "未命名请求"),
    tool: String(item.tool || ""),
    params: item.params && typeof item.params === "object" ? item.params : {},
  }));

  return {
    ready: true,
    kind: "mcp",
    server: context.server,
    capabilityName,
    endpoint,
    connector: template.connector,
    transport: "builtin",
    requests,
    summary: `MCP「${capabilityName}」已生成 ${requests.length} 个只读调用请求。`,
  };
}

export function formatMcpRunnerTerminalLines(plan) {
  const server = String(plan?.server || "unknown");
  const capabilityName = String(plan?.capabilityName || "未命名 MCP");
  const lines = [`[${server}]$ # Agent MCP Runner：${capabilityName}`, `# ${plan?.summary || "未生成 MCP 调用计划。"}`];

  (Array.isArray(plan?.requests) ? plan.requests : []).forEach((item, index) => {
    lines.push(`# ${index + 1}. ${item.label}`);
    if (plan.transport === "http") {
      lines.push(`POST ${plan.endpoint} ${JSON.stringify(item.payload || buildJsonRpcPayload(index + 1, item.method, item.params))}`);
    } else {
      lines.push(`${plan.connector}.${item.tool} ${JSON.stringify(item.params || {})}`);
    }
  });

  return lines;
}

export function formatMcpHttpResultTerminalLines(plan, result) {
  const server = String(plan?.server || "unknown");
  const capabilityName = String(plan?.capabilityName || "未命名 MCP");
  const results = Array.isArray(result?.results) ? result.results : [];
  const okCount = results.filter((item) => item?.ok).length;
  const lines = [
    `[${server}]$ # MCP HTTP 调用结果：${capabilityName}`,
    `# ${result?.message || `完成 ${okCount}/${results.length} 个请求`}`,
  ];

  results.forEach((item, index) => {
    const label = String(item?.label || item?.method || `请求 ${index + 1}`);
    const status = item?.status ?? 0;
    lines.push(`# ${index + 1}. ${label} ${item?.ok ? "成功" : "失败"} status=${status}`);
    if (item?.message && item.message !== "ok") {
      lines.push(`# ${item.message}`);
    }
    if (item?.response !== undefined && item?.response !== null) {
      lines.push(formatMcpResponsePreview(item.response));
    }
  });

  return lines;
}

function formatMcpResponsePreview(response) {
  const text = typeof response === "string" ? response : JSON.stringify(response);
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
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

function isLocalCliCommand(command) {
  return /^local:/i.test(String(command || "").trim()) || /^cli:\/\/local\//i.test(String(command || "").trim());
}

function normalizeLocalCliCommand(command) {
  return String(command || "")
    .trim()
    .replace(/^local:/i, "")
    .replace(/^cli:\/\/local\//i, "")
    .trim();
}

function isHttpEndpoint(endpoint) {
  return /^https?:\/\//i.test(endpoint);
}

function buildHttpMcpRequests() {
  return [
    {
      label: "初始化连接",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        clientInfo: { name: "SSH Agent Tool", version: "stable" },
        capabilities: {},
      },
    },
    {
      label: "列出工具",
      method: "tools/list",
      params: {},
    },
    {
      label: "列出资源",
      method: "resources/list",
      params: {},
    },
  ].map((item, index) => ({
    ...item,
    payload: buildJsonRpcPayload(index + 1, item.method, item.params),
  }));
}

function buildJsonRpcPayload(id, method, params) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };
}
