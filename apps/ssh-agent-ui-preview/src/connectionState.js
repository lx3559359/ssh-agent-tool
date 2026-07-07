export function buildConnectionOverride(result, server = {}) {
  const message = result?.message || "未返回连接测试结果。";
  const state = result?.state || (result?.ok ? "在线" : "离线");
  const tone = result?.tone || (result?.ok ? "green" : "gray");

  return {
    state,
    tone,
    latency: result?.latency || "--",
    sshBanner: result?.banner || "",
    lastTestMessage: message,
    sshDiagnostics: buildSshConnectionDiagnostics(result, server),
    evidence: [{ label: "ssh", value: message }],
  };
}

export function buildSshConnectionDiagnostics(result, server = {}) {
  const message = String(result?.message || result?.error || "").trim();
  if (result?.ok) {
    return {
      kind: "ok",
      title: "SSH 连接正常",
      summary: message || "SSH 端口可达，连接测试通过。",
      commands: [],
      nextSteps: ["可以继续打开 SSH 会话或读取服务器基础信息。"],
    };
  }

  const host = String(server.ip || server.host || result?.host || "").trim() || "<host>";
  const port = String(server.port || result?.port || "22").trim() || "22";
  const user = String(server.user || result?.user || "root").trim() || "root";
  const lower = message.toLowerCase();
  const sshCommand = buildDiagnosticSshCommand({ host, port, user, server });
  const structured = buildStructuredBackendDiagnostics(result, { host, port, sshCommand });
  if (structured) return structured;

  if (/no route to host|network is unreachable|host is unreachable|destination host unreachable|ehostunreach|enetunreach/.test(lower)) {
    return {
      kind: "timeout",
      title: "SSH 网络不可达",
      summary: "当前网络没有到目标主机的可用路由，常见原因是 VPN、堡垒机链路、云安全组、主机防火墙或目标网段路由未生效。",
      commands: [`Test-NetConnection ${host} -Port ${port}`, sshCommand],
      nextSteps: ["确认服务器 IP、端口和目标网段是否正确。", "检查 VPN、堡垒机、云安全组、防火墙和本机路由。", `在服务器侧确认 sshd 正在监听 ${port} 端口。`],
    };
  }

  if (/could not resolve hostname|getaddrinfo|name or service not known|temporary failure in name resolution|nodename nor servname|未知的名称或服务|无法解析|主机名/.test(lower)) {
    return {
      kind: "dns",
      title: "SSH 主机名无法解析",
      summary: "当前主机名无法通过 DNS 或本机 hosts 解析到服务器地址，可能是主机名写错、内网 DNS/VPN 未生效或 hosts 缺少记录。",
      commands: [`nslookup ${host}`, `Test-NetConnection ${host} -Port ${port}`, sshCommand],
      nextSteps: ["确认服务器主机名或 IP 是否填写正确。", "检查 VPN、内网 DNS、公司网络和本机 hosts 配置。", "如果使用 ProxyJump，确认跳板机内也能解析该主机名。"],
    };
  }

  if (/timed?\s*out|timeout|超时|i\/o timeout/.test(lower)) {
    return {
      kind: "timeout",
      title: "SSH 连接超时",
      summary: "可能是网络不可达、防火墙或安全组未放行 SSH 端口，也可能是目标主机离线。",
      commands: [`Test-NetConnection ${host} -Port ${port}`, sshCommand],
      nextSteps: ["确认服务器 IP 和端口是否正确。", "检查云安全组、防火墙、堡垒机和 VPN 路由。", "在服务器侧确认 sshd 是否监听该端口。"],
    };
  }

  if (/unprotected private key file|permissions .* are too open|bad permissions|load key .*invalid format|invalid private key|error loading key|private key will be ignored|key_load_public|私钥.*权限|私钥.*格式/.test(lower)) {
    return {
      kind: "key-file",
      title: "SSH 私钥文件不可用",
      summary: "当前私钥文件权限、格式或口令不可用，SSH 客户端会忽略该私钥或无法加载它。Windows 下也可能是选择了错误文件、私钥内容不完整或私钥口令未填写。",
      commands: [sshCommand],
      nextSteps: ["重新选择正确的私钥文件，确认内容包含完整 PRIVATE KEY。", "检查私钥文件权限，避免被其他用户读取；Windows 下确认当前用户拥有读取权限。", "如果私钥有口令，请在认证中心补录正确口令。"],
    };
  }

  if (/too many authentication failures|maxauthtries|agent refused|sign_and_send_pubkey|ssh agent|agent admitted failure|agent.*failure|认证尝试过多/.test(lower)) {
    return {
      kind: "agent-auth",
      title: "SSH Agent 尝试密钥过多",
      summary: "SSH Agent 或客户端连续尝试了过多密钥，服务器在正确凭据发送前就断开了认证。通常需要指定正确私钥、减少 Agent 中加载的密钥，或启用 IdentitiesOnly。",
      commands: [sshCommand],
      nextSteps: ["在连接配置中指定正确私钥，避免让 SSH Agent 依次尝试大量密钥。", "清理 SSH Agent 中无关密钥，或临时关闭 SSH Agent 认证。", "必要时使用 IdentitiesOnly=yes 让客户端只尝试指定身份。"],
    };
  }

  if (/permission denied|authentication failed|auth fail|认证失败|publickey|password/.test(lower)) {
    return {
      kind: "auth",
      title: "SSH 认证失败",
      summary: "可能是用户名、密码或私钥不匹配，也可能是服务器禁用了对应认证方式。",
      commands: [sshCommand],
      nextSteps: ["确认连接用户名是否正确。", "重新保存密码或私钥凭据。", "检查服务器 sshd_config 的 PasswordAuthentication、PubkeyAuthentication 配置。"],
    };
  }

  if (/refused|connection refused|拒绝/.test(lower)) {
    return {
      kind: "refused",
      title: "SSH 端口拒绝连接",
      summary: "目标主机可达，但该端口没有 SSH 服务监听，或被主机防火墙直接拒绝。",
      commands: [`Test-NetConnection ${host} -Port ${port}`, sshCommand],
      nextSteps: ["确认 SSH 端口是否为 22 或自定义端口。", "在服务器侧检查 sshd 服务状态。", "检查本机或服务器防火墙策略。"],
    };
  }

  if (/no matching|unable to negotiate|algorithm negotiation|key exchange method|host key type|kex algorithm|cipher|mac algorithm/.test(lower)) {
    return {
      kind: "algorithm",
      title: "SSH 算法协商失败",
      summary: "本机 SSH 客户端与旧服务器或特殊安全策略之间没有可用的密钥交换、主机密钥、加密或 MAC 算法。常见于旧版 OpenSSH 服务器或只开放 ssh-rsa 等旧算法的设备。",
      commands: [sshCommand],
      nextSteps: ["优先升级服务器 OpenSSH 或调整服务器端算法策略。", "如必须临时兼容旧设备，请在确认风险后使用明确的 HostKeyAlgorithms、PubkeyAcceptedAlgorithms 或 KexAlgorithms 选项。", "让 Agent 根据 ssh -vvv 输出生成最小兼容参数，并避免保存不必要的弱算法配置。"],
    };
  }

  if (/kex_exchange_identification|connection reset by peer|banner exchange|connection closed by remote host|ssh_exchange_identification|broken pipe|握手|连接被重置/.test(lower)) {
    return {
      kind: "handshake",
      title: "SSH 握手被中断",
      summary: "TCP 端口可能可达，但 SSH 握手阶段被远端关闭或重置。常见原因包括 sshd MaxStartups/连接限制、Fail2ban/安全策略、堡垒机策略、端口实际不是 SSH 服务，或服务器负载过高。",
      commands: [`Test-NetConnection ${host} -Port ${port}`, sshCommand],
      nextSteps: ["确认目标端口返回的是 SSH 服务，而不是 HTTP、代理或其他协议。", "检查 sshd MaxStartups、AllowUsers、Fail2ban、安全设备和堡垒机限制。", "查看服务器 /var/log/auth.log 或 /var/log/secure 中对应时间的拒绝记录。"],
    };
  }

  if (/host key|fingerprint|remote host identification|指纹|known_hosts/.test(lower)) {
    return {
      kind: "host-key",
      title: "主机指纹需要确认",
      summary: "SSH 主机指纹发生变化或尚未信任，需要确认是否为服务器重装、IP 复用或潜在中间人风险。",
      commands: [`ssh-keygen -R ${host}`, sshCommand],
      nextSteps: ["核对 CMDB 或云控制台中的服务器身份。", "确认指纹可信后再更新信任记录。"],
    };
  }

  return {
    kind: "unknown",
    title: "SSH 连接失败",
    summary: message || "连接测试失败，暂时无法识别具体原因。",
    commands: [`Test-NetConnection ${host} -Port ${port}`, sshCommand],
    nextSteps: ["查看详细错误信息。", "检查网络、端口、认证凭据和跳板机配置。"],
  };
}

function buildStructuredBackendDiagnostics(result, { host, port, sshCommand }) {
  const failure = result?.sshFailure && typeof result.sshFailure === "object" ? result.sshFailure : {};
  const kind = String(failure.kind || result?.failureKind || "").trim();
  if (!kind) return null;

  const titles = {
    auth: "SSH 认证失败",
    timeout: "SSH 连接超时",
    dns: "SSH 主机名无法解析",
    refused: "SSH 端口拒绝连接",
    handshake: "SSH 握手被中断",
    algorithm: "SSH 算法协商失败",
    "host-key": "主机指纹需要确认",
    "key-file": "SSH 私钥文件不可用",
    unknown: "SSH 连接失败",
  };
  if (!Object.prototype.hasOwnProperty.call(titles, kind)) return null;

  const summary = String(failure.summary || "").trim() || defaultStructuredDiagnosticSummary(kind);
  const nextSteps = Array.isArray(failure.suggestions) && failure.suggestions.length
    ? failure.suggestions.map((item) => String(item || "").trim()).filter(Boolean)
    : defaultStructuredDiagnosticSteps(kind);

  return {
    kind,
    title: titles[kind],
    summary,
    commands: buildStructuredDiagnosticCommands(kind, { host, port, sshCommand }),
    nextSteps,
  };
}

function buildStructuredDiagnosticCommands(kind, { host, port, sshCommand }) {
  if (kind === "dns") return [`nslookup ${host}`, `Test-NetConnection ${host} -Port ${port}`, sshCommand];
  if (kind === "timeout" || kind === "refused" || kind === "handshake" || kind === "unknown") {
    return [`Test-NetConnection ${host} -Port ${port}`, sshCommand];
  }
  if (kind === "host-key") return [`ssh-keygen -R ${host}`, sshCommand];
  return [sshCommand];
}

function defaultStructuredDiagnosticSummary(kind) {
  const summaries = {
    auth: "服务器拒绝了当前凭据或认证方式。",
    timeout: "连接在超时时间内没有建立成功。",
    dns: "主机名无法解析为可连接地址。",
    refused: "目标主机拒绝了 SSH 端口连接。",
    handshake: "TCP 已连接，但 SSH 握手被远端关闭或重置。",
    algorithm: "客户端和服务器没有协商出共同的 SSH 算法。",
    "host-key": "服务器主机指纹与信任记录不一致或无法读取。",
    "key-file": "当前私钥文件权限、格式或口令不可用，SSH 客户端无法加载该私钥。",
  };
  return summaries[kind] || "连接测试失败，暂时无法识别具体原因。";
}

function defaultStructuredDiagnosticSteps(kind) {
  const steps = {
    auth: ["打开认证中心确认密码、私钥、口令或 SSH Agent 是否可用。", "确认用户名、端口和跳板机配置与服务器一致。"],
    timeout: ["检查网络连通性、安全组、防火墙和 VPN/堡垒机链路。", "适当增加连接超时或重试次数后再次连接。"],
    dns: ["检查服务器地址是否拼写正确，或改用 IP 地址测试。", "确认当前网络 DNS、hosts 或内网域名解析是否可用。"],
    refused: ["确认 SSH 服务正在运行且监听了配置的端口。", "检查安全组、防火墙、端口转发和跳板机规则。"],
    handshake: ["检查 sshd 日志、MaxStartups、Fail2Ban、堡垒机策略或连接频率限制。", "确认目标端口确实是 SSH 服务。"],
    algorithm: ["检查服务器是否只支持旧算法，必要时升级 OpenSSH 或调整服务器算法配置。", "记录服务端算法后再决定是否允许兼容旧算法。"],
    "host-key": ["确认服务器是否重装或更换过密钥。", "在可信渠道核对指纹后再更新信任记录。"],
    "key-file": ["重新选择正确的私钥文件，并确认内容包含完整 PRIVATE KEY。", "如果私钥有口令，请在认证中心补录正确口令。"],
  };
  return steps[kind] || ["查看详细错误信息。", "检查网络、端口、认证凭据和跳板机配置。"];
}

function buildDiagnosticSshCommand({ host, port, user, server = {} }) {
  const safeHost = String(host || "<host>").trim() || "<host>";
  const safeUser = String(user || "root").trim() || "root";
  const safePort = String(port || "22").trim() || "22";
  const parts = ["ssh", "-vvv"];

  const identityFile = String(server.identityFile || "").trim();
  if (identityFile) {
    parts.push("-i", shellArg(identityFile));
    parts.push("-o", "IdentitiesOnly=yes");
  }

  const proxyJump = String(server.proxyJump || "").trim();
  if (proxyJump) {
    parts.push("-J", shellArg(proxyJump));
  }

  const timeoutSeconds = normalizePositiveInt(server.timeoutSeconds, 10);
  if (timeoutSeconds !== 10) {
    parts.push("-o", `ConnectTimeout=${timeoutSeconds}`);
  }

  const retryCount = normalizeNonNegativeInt(server.retryCount, 0);
  if (retryCount > 0) {
    parts.push("-o", `ConnectionAttempts=${retryCount + 1}`);
  }

  const keepaliveSeconds = normalizePositiveInt(server.keepaliveSeconds, 30);
  const keepaliveCountMax = normalizeBoundedInt(server.keepaliveCountMax, 3, 0, 10);
  if (keepaliveSeconds !== 30 || keepaliveCountMax !== 3) {
    parts.push("-o", `ServerAliveInterval=${keepaliveSeconds}`);
    parts.push("-o", `ServerAliveCountMax=${keepaliveCountMax}`);
  }

  parts.push("-p", shellArg(safePort));
  parts.push(shellArg(`${safeUser}@${safeHost}`));
  return parts.join(" ");
}

function normalizePositiveInt(value, fallback) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeNonNegativeInt(value, fallback) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeBoundedInt(value, fallback, minimum, maximum) {
  const number = Number.parseInt(String(value ?? ""), 10);
  const next = Number.isFinite(number) ? number : fallback;
  return Math.min(Math.max(next, minimum), maximum);
}

function shellArg(value) {
  const text = String(value ?? "").trim();
  if (!text) return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\"'\"'")}'`;
}

export function buildConnectionQuickFixActions(diagnostics, server = {}) {
  const kind = String(diagnostics?.kind || "").trim();
  if (!kind || kind === "ok") return [];

  if (kind === "auth") {
    return withFailureEvidenceActions([
      { id: "open-auth-center", label: "补录凭据", tone: "primary", target: "auth-center" },
      { id: "edit-connection", label: "检查连接配置", tone: "secondary", target: "server-editor" },
      { id: "test-connection", label: "重新测试", tone: "secondary", target: "connection-test" },
    ]);
  }

  if (kind === "key-file" || kind === "agent-auth") {
    return withFailureEvidenceActions([
      { id: "open-auth-center", label: kind === "key-file" ? "检查私钥文件" : "检查 SSH Agent", tone: "primary", target: "auth-center" },
      { id: "edit-connection", label: "检查认证方式", tone: "secondary", target: "server-editor" },
      { id: "test-connection", label: "重新测试", tone: "secondary", target: "connection-test" },
    ]);
  }

  if (kind === "host-key") {
    const hasHostKey = Boolean(server?.hostKey?.sha256);
    return withFailureEvidenceActions([
      ...(hasHostKey ? [{ id: "trust-host-key", label: "确认并信任指纹", tone: "danger", target: "host-key-trust" }] : []),
      { id: "test-connection", label: "重新测试", tone: "secondary", target: "connection-test" },
      { id: "queue-agent-diagnostic", label: "交给 Agent 排查", tone: "secondary", target: "agent-diagnostic" },
    ]);
  }

  if (kind === "timeout" || kind === "refused" || kind === "dns" || kind === "handshake") {
    return withFailureEvidenceActions([
      { id: "edit-connection", label: kind === "refused" ? "检查 SSH 端口" : kind === "dns" ? "检查主机名/DNS" : kind === "handshake" ? "检查 SSH 服务/限制" : "检查地址/端口", tone: "primary", target: "server-editor" },
      { id: "test-connection", label: "重新测试", tone: "secondary", target: "connection-test" },
      { id: "queue-agent-diagnostic", label: "交给 Agent 排查", tone: "secondary", target: "agent-diagnostic" },
    ]);
  }

  if (kind === "algorithm") {
    return withFailureEvidenceActions([
      { id: "test-connection", label: "重新测试", tone: "primary", target: "connection-test" },
      { id: "queue-agent-diagnostic", label: "交给 Agent 排查算法兼容", tone: "secondary", target: "agent-diagnostic" },
    ]);
  }

  return withFailureEvidenceActions([
    { id: "test-connection", label: "重新测试", tone: "primary", target: "connection-test" },
    { id: "queue-agent-diagnostic", label: "交给 Agent 排查", tone: "secondary", target: "agent-diagnostic" },
  ]);
}

export function buildSshOpenFailureTerminalLines(message = "", diagnostics = {}, server = {}) {
  const safeMessage = String(message || diagnostics?.summary || "SSH 会话连接失败").trim() || "SSH 会话连接失败";
  const kind = String(diagnostics?.kind || "").trim();
  const lines = [`# ${safeMessage}`];

  let nextStep = "";
  if (kind === "auth") {
    nextStep = "打开认证中心，补录密码、私钥或 SSH Agent 凭据。";
  } else if (kind === "config") {
    nextStep = "编辑连接配置，确认主机、端口、用户名和认证方式。";
  } else if (kind === "environment") {
    nextStep = "使用正式 Windows 客户端运行，并确认当前 EXE 来自最新版 ZIP。";
  } else {
    const actions = buildConnectionQuickFixActions(diagnostics, server)
      .filter((action) => !["tool-logs", "diagnostic-package"].includes(action.target))
      .slice(0, 3)
      .map((action) => action.label)
      .filter(Boolean);
    if (actions.length) nextStep = `${actions.join("、")}。`;
  }
  if (nextStep) lines.push(`# 下一步：${nextStep}`);

  const suggestions = Array.isArray(diagnostics?.suggestions)
    ? diagnostics.suggestions
    : Array.isArray(diagnostics?.nextSteps)
      ? diagnostics.nextSteps
      : [];
  const usefulSuggestions = suggestions
    .map((item) => String(item || "").trim())
    .filter((item) => item && item !== safeMessage && item !== String(diagnostics?.summary || "").trim())
    .slice(0, 2);
  if (usefulSuggestions.length) lines.push(`# 建议：${usefulSuggestions.join("；")}`);

  lines.push("# 也可以右键终端查看会话日志、工具日志或导出诊断包。");
  return lines;
}

function withFailureEvidenceActions(actions) {
  return [
    ...actions,
    { id: "open-tool-logs", label: "查看工具日志", tone: "secondary", target: "tool-logs" },
    { id: "export-diagnostic-package", label: "导出诊断包", tone: "secondary", target: "diagnostic-package" },
  ];
}

function isProxyJumpHostKeyResult(result) {
  return String(result?.hostKeyContext?.role || "").trim() === "proxy-jump";
}

export function extractHostKeyFromSshResult(result) {
  if (result?.hostKey?.sha256 && !isProxyJumpHostKeyResult(result)) return normalizeHostKey(result.hostKey);
  const found = (Array.isArray(result?.results) ? result.results : []).find(
    (item) => item?.hostKey?.sha256 && !isProxyJumpHostKeyResult(item),
  );
  return found ? normalizeHostKey(found.hostKey) : null;
}

export function buildHostKeyEvidenceOverride(currentEvidence = [], hostKey, trustedHostKey = null) {
  const normalized = normalizeHostKey(hostKey);
  if (!normalized) return {};

  const trust = evaluateHostKeyTrust(normalized, trustedHostKey);
  const evidence = (Array.isArray(currentEvidence) ? currentEvidence : []).filter(
    (item) => item?.label !== "主机指纹" && item?.label !== "指纹状态",
  );
  return {
    hostKey: normalized,
    hostKeyTrust: trust,
    evidence: [
      ...evidence,
      { label: "主机指纹", value: `${normalized.type} ${normalized.sha256}`.trim() },
      { label: "指纹状态", value: `${trust.label}：${trust.message}` },
    ],
  };
}

export function buildHostKeyTrustPrompt(serverName, hostKey, trustedHostKey = null) {
  const current = normalizeHostKey(hostKey);
  const trusted = normalizeHostKey(trustedHostKey);
  if (!current) {
    return {
      canTrust: false,
      severity: "disabled",
      title: "没有可保存的主机指纹",
      message: "当前服务器没有可保存的主机指纹。请先测试连接、打开 SSH 会话或读取基础信息。",
    };
  }

  const name = String(serverName || "当前服务器").trim() || "当前服务器";
  const currentLine = `${current.type} ${current.sha256}`.trim();
  const trustedLine = trusted ? `${trusted.type} ${trusted.sha256}`.trim() : "";
  const trust = evaluateHostKeyTrust(current, trusted);

  if (trust.status === "changed") {
    return {
      canTrust: true,
      severity: "danger",
      title: "指纹变更，需要确认",
      message: [
        `确认替换 ${name} 的已信任主机指纹吗？`,
        "",
        `当前指纹：${currentLine}`,
        `已信任指纹：${trustedLine}`,
        "",
        "主机指纹变更可能来自服务器重装、IP 复用，也可能是中间人攻击。",
        "请先通过 CMDB、云控制台或服务器管理员核对身份，确认可信后再继续。",
      ].join("\n"),
    };
  }

  return {
    canTrust: true,
    severity: trust.status === "trusted" ? "info" : "warning",
    title: "确认信任主机指纹",
    message: [
      `确认信任 ${name} 的主机指纹吗？`,
      "",
      `当前指纹：${currentLine}`,
      `状态：${trust.label}，${trust.message}`,
      "",
      "信任后，后续连接会用该指纹校验服务器身份。",
    ].join("\n"),
  };
}

export function evaluateHostKeyTrust(hostKey, trustedHostKey) {
  const current = normalizeHostKey(hostKey);
  if (!current) {
    return {
      status: "unknown",
      label: "未知",
      tone: "gray",
      message: "当前连接没有返回主机指纹。",
    };
  }

  const trusted = normalizeHostKey(trustedHostKey);
  if (!trusted) {
    return {
      status: "untrusted",
      label: "首次发现",
      tone: "amber",
      message: "首次发现主机指纹，请确认后信任。",
    };
  }

  if (current.sha256 === trusted.sha256 && current.type === trusted.type) {
    return {
      status: "trusted",
      label: "已信任",
      tone: "green",
      message: "主机指纹与已信任记录一致。",
    };
  }

  return {
    status: "changed",
    label: "指纹变更",
    tone: "red",
    message: "主机指纹与已信任记录不一致，请警惕中间人攻击或服务器重装。",
  };
}

function normalizeHostKey(hostKey) {
  const sha256 = String(hostKey?.sha256 || "").trim();
  if (!sha256) return null;
  return {
    type: String(hostKey?.type || "unknown").trim() || "unknown",
    sha256,
  };
}
