import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConnectionOverride,
  buildConnectionQuickFixActions,
  buildSshOpenFailureTerminalLines,
  buildSshConnectionDiagnostics,
  buildHostKeyEvidenceOverride,
  buildHostKeyTrustPrompt,
  evaluateHostKeyTrust,
  extractHostKeyFromSshResult,
} from "./connectionState.js";

test("buildConnectionOverride maps successful SSH probe result to server status", () => {
  const override = buildConnectionOverride({
    ok: true,
    state: "在线",
    tone: "green",
    latency: "18ms",
    banner: "SSH-2.0-OpenSSH_9.6",
    message: "SSH 服务可达：SSH-2.0-OpenSSH_9.6",
  });

  assert.equal(override.state, "在线");
  assert.equal(override.tone, "green");
  assert.equal(override.latency, "18ms");
  assert.deepEqual(override.evidence[0], { label: "ssh", value: "SSH 服务可达：SSH-2.0-OpenSSH_9.6" });
});

test("buildConnectionOverride maps failed probe result to offline status", () => {
  const override = buildConnectionOverride({
    ok: false,
    state: "离线",
    tone: "gray",
    latency: "--",
    message: "连接失败：timed out",
  });

  assert.equal(override.state, "离线");
  assert.equal(override.tone, "gray");
  assert.equal(override.latency, "--");
  assert.equal(override.evidence[0].value, "连接失败：timed out");
});

test("buildSshConnectionDiagnostics explains timeout failures with network checks", () => {
  const diagnostics = buildSshConnectionDiagnostics(
    {
      ok: false,
      message: "连接失败：timed out",
    },
    { ip: "10.0.1.23", port: "22", user: "root" },
  );

  assert.equal(diagnostics.kind, "timeout");
  assert.equal(diagnostics.title, "SSH 连接超时");
  assert.match(diagnostics.summary, /网络|防火墙|安全组/);
  assert.deepEqual(diagnostics.commands.slice(0, 2), ["Test-NetConnection 10.0.1.23 -Port 22", "ssh -vvv -p 22 root@10.0.1.23"]);
});

test("buildSshConnectionDiagnostics treats unreachable route errors as network failures", () => {
  const diagnostics = buildSshConnectionDiagnostics(
    {
      ok: false,
      message: "ssh: connect to host 10.0.1.23 port 22: No route to host",
    },
    { ip: "10.0.1.23", port: "22", user: "root" },
  );

  assert.equal(diagnostics.kind, "timeout");
  assert.deepEqual(diagnostics.commands.slice(0, 2), ["Test-NetConnection 10.0.1.23 -Port 22", "ssh -vvv -p 22 root@10.0.1.23"]);
  assert.match(diagnostics.nextSteps.join("\n"), /VPN|sshd|22/);
});

test("buildSshConnectionDiagnostics explains auth failures without exposing secrets", () => {
  const diagnostics = buildSshConnectionDiagnostics(
    {
      ok: false,
      message: "Authentication failed: Permission denied (publickey,password)",
    },
    { ip: "10.0.1.31", port: "2222", user: "deploy", authType: "password", credentialRef: "sshcred-prod" },
  );

  assert.equal(diagnostics.kind, "auth");
  assert.equal(diagnostics.title, "SSH 认证失败");
  assert.match(diagnostics.summary, /用户名|密码|私钥/);
  assert.deepEqual(diagnostics.commands, ["ssh -vvv -p 2222 deploy@10.0.1.31"]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /sshcred-prod|password/);
});

test("buildSshConnectionDiagnostics trusts backend sshFailure before message guessing", () => {
  const diagnostics = buildSshConnectionDiagnostics(
    {
      ok: false,
      message: "SSH 会话连接失败：Authentication failed after connection refused by proxy",
      failureKind: "refused",
      sshFailure: {
        kind: "refused",
        label: "端口拒绝",
        summary: "目标主机拒绝了 SSH 端口连接。",
        suggestions: ["确认 SSH 服务正在运行且监听了配置的端口。", "检查安全组、防火墙、端口转发和跳板机规则。"],
      },
    },
    { ip: "10.0.1.31", port: "2222", user: "deploy" },
  );

  assert.equal(diagnostics.kind, "refused");
  assert.equal(diagnostics.title, "SSH 端口拒绝连接");
  assert.match(diagnostics.summary, /拒绝了 SSH 端口连接/);
  assert.deepEqual(diagnostics.nextSteps, ["确认 SSH 服务正在运行且监听了配置的端口。", "检查安全组、防火墙、端口转发和跳板机规则。"]);
  assert.deepEqual(diagnostics.commands.slice(0, 2), ["Test-NetConnection 10.0.1.31 -Port 2222", "ssh -vvv -p 2222 deploy@10.0.1.31"]);
});

test("buildSshConnectionDiagnostics mirrors safe SSH connection options in repro commands", () => {
  const diagnostics = buildSshConnectionDiagnostics(
    {
      ok: false,
      message: "Authentication failed: Permission denied (publickey)",
    },
    {
      ip: "10.0.1.31",
      port: "2222",
      user: "deploy",
      identityFile: "C:/Users/me/.ssh/prod db",
      proxyJump: "jump user@bastion",
      timeoutSeconds: 24,
      retryCount: 2,
      keepaliveSeconds: 45,
      keepaliveCountMax: 6,
      credentialRef: "sshcred-prod",
      password: "secret",
    },
  );

  assert.deepEqual(diagnostics.commands, [
    "ssh -vvv -i 'C:/Users/me/.ssh/prod db' -o IdentitiesOnly=yes -J 'jump user@bastion' -o ConnectTimeout=24 -o ConnectionAttempts=3 -o ServerAliveInterval=45 -o ServerAliveCountMax=6 -p 2222 deploy@10.0.1.31",
  ]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /sshcred-prod|secret|password/);
});

test("buildSshConnectionDiagnostics explains unusable private key files", () => {
  const diagnostics = buildSshConnectionDiagnostics(
    {
      ok: false,
      message: "WARNING: UNPROTECTED PRIVATE KEY FILE! Permissions 0644 for 'C:/Users/me/.ssh/id_rsa' are too open. This private key will be ignored.",
    },
    { ip: "10.0.1.32", port: "22", user: "deploy", authType: "私钥" },
  );

  assert.equal(diagnostics.kind, "key-file");
  assert.equal(diagnostics.title, "SSH 私钥文件不可用");
  assert.match(diagnostics.summary, /私钥|权限|格式/);
  assert.deepEqual(diagnostics.commands, ["ssh -vvv -p 22 deploy@10.0.1.32"]);
  assert.match(diagnostics.nextSteps.join("\n"), /权限|重新选择|口令/);
});

test("buildSshConnectionDiagnostics trusts backend key-file diagnostics", () => {
  const diagnostics = buildSshConnectionDiagnostics(
    {
      ok: false,
      message: "SSH 会话连接失败",
      failureKind: "key-file",
      sshFailure: {
        kind: "key-file",
        summary: "私钥文件权限、格式或口令不可用。",
        suggestions: ["重新选择正确的私钥文件。", "如果私钥有口令，请在认证中心补录。"],
      },
    },
    { ip: "10.0.1.32", port: "22", user: "deploy", authType: "私钥" },
  );

  assert.equal(diagnostics.kind, "key-file");
  assert.equal(diagnostics.title, "SSH 私钥文件不可用");
  assert.match(diagnostics.summary, /私钥文件/);
  assert.deepEqual(diagnostics.commands, ["ssh -vvv -p 22 deploy@10.0.1.32"]);
  assert.match(diagnostics.nextSteps.join("\n"), /重新选择|认证中心/);
});

test("buildSshConnectionDiagnostics explains too many SSH Agent authentication failures", () => {
  const diagnostics = buildSshConnectionDiagnostics(
    {
      ok: false,
      message: "Received disconnect from 10.0.1.33 port 22:2: Too many authentication failures",
    },
    { ip: "10.0.1.33", port: "22", user: "ops", authType: "SSH Agent" },
  );

  assert.equal(diagnostics.kind, "agent-auth");
  assert.equal(diagnostics.title, "SSH Agent 尝试密钥过多");
  assert.match(diagnostics.summary, /SSH Agent|密钥|IdentitiesOnly/);
  assert.deepEqual(diagnostics.commands, ["ssh -vvv -p 22 ops@10.0.1.33"]);
  assert.match(diagnostics.nextSteps.join("\n"), /指定正确私钥|清理 SSH Agent/);
});

test("buildSshConnectionDiagnostics explains DNS and hostname resolution failures", () => {
  const diagnostics = buildSshConnectionDiagnostics(
    {
      ok: false,
      message: "Could not resolve hostname app.internal: Name or service not known",
    },
    { host: "app.internal", port: "2222", user: "deploy" },
  );

  assert.equal(diagnostics.kind, "dns");
  assert.equal(diagnostics.title, "SSH 主机名无法解析");
  assert.match(diagnostics.summary, /DNS|主机名|hosts/);
  assert.deepEqual(diagnostics.commands.slice(0, 2), ["nslookup app.internal", "Test-NetConnection app.internal -Port 2222"]);
  assert.deepEqual(diagnostics.commands.at(-1), "ssh -vvv -p 2222 deploy@app.internal");
});

test("buildSshConnectionDiagnostics explains SSH handshake resets", () => {
  const diagnostics = buildSshConnectionDiagnostics(
    {
      ok: false,
      message: "kex_exchange_identification: Connection reset by peer",
    },
    { ip: "10.0.1.41", port: "22", user: "ops" },
  );

  assert.equal(diagnostics.kind, "handshake");
  assert.equal(diagnostics.title, "SSH 握手被中断");
  assert.match(diagnostics.summary, /握手|重置|连接限制/);
  assert.deepEqual(diagnostics.commands.slice(0, 2), ["Test-NetConnection 10.0.1.41 -Port 22", "ssh -vvv -p 22 ops@10.0.1.41"]);
});

test("buildSshConnectionDiagnostics explains SSH algorithm negotiation failures", () => {
  const diagnostics = buildSshConnectionDiagnostics(
    {
      ok: false,
      message: "Unable to negotiate with 10.0.1.42 port 22: no matching host key type found. Their offer: ssh-rsa",
    },
    { ip: "10.0.1.42", port: "22", user: "legacy" },
  );

  assert.equal(diagnostics.kind, "algorithm");
  assert.equal(diagnostics.title, "SSH 算法协商失败");
  assert.match(diagnostics.summary, /算法|旧服务器|OpenSSH/);
  assert.deepEqual(diagnostics.commands, ["ssh -vvv -p 22 legacy@10.0.1.42"]);
  assert.match(diagnostics.nextSteps.join("\n"), /升级|临时兼容/);
});

test("extractHostKeyFromSshResult returns the first command host key", () => {
  const hostKey = extractHostKeyFromSshResult({
    results: [
      { ok: true, command: "whoami" },
      { ok: true, command: "hostname", hostKey: { type: "ssh-ed25519", sha256: "SHA256:abc123" } },
    ],
  });

  assert.deepEqual(hostKey, { type: "ssh-ed25519", sha256: "SHA256:abc123" });
});

test("extractHostKeyFromSshResult ignores proxy jump host keys", () => {
  const hostKey = extractHostKeyFromSshResult({
    hostKey: { type: "ssh-ed25519", sha256: "SHA256:proxy" },
    hostKeyContext: { role: "proxy-jump", host: "bastion.example.com", port: 2200 },
  });

  assert.equal(hostKey, null);
});

test("buildHostKeyEvidenceOverride appends host key evidence without duplicates", () => {
  const override = buildHostKeyEvidenceOverride(
    [{ label: "ssh", value: "SSH 服务可达" }, { label: "主机指纹", value: "旧指纹" }],
    { type: "ssh-ed25519", sha256: "SHA256:abc123" },
  );

  assert.equal(override.hostKey.type, "ssh-ed25519");
  assert.equal(override.hostKey.sha256, "SHA256:abc123");
  assert.deepEqual(override.evidence, [
    { label: "ssh", value: "SSH 服务可达" },
    { label: "主机指纹", value: "ssh-ed25519 SHA256:abc123" },
    { label: "指纹状态", value: "首次发现：首次发现主机指纹，请确认后信任。" },
  ]);
});

test("evaluateHostKeyTrust marks unseen matching and changed host keys", () => {
  const current = { type: "ssh-ed25519", sha256: "SHA256:new" };

  assert.deepEqual(evaluateHostKeyTrust(current, null), {
    status: "untrusted",
    label: "首次发现",
    tone: "amber",
    message: "首次发现主机指纹，请确认后信任。",
  });

  assert.deepEqual(evaluateHostKeyTrust(current, { type: "ssh-ed25519", sha256: "SHA256:new" }), {
    status: "trusted",
    label: "已信任",
    tone: "green",
    message: "主机指纹与已信任记录一致。",
  });

  assert.deepEqual(evaluateHostKeyTrust(current, { type: "ssh-rsa", sha256: "SHA256:old" }), {
    status: "changed",
    label: "指纹变更",
    tone: "red",
    message: "主机指纹与已信任记录不一致，请警惕中间人攻击或服务器重装。",
  });
});

test("buildHostKeyEvidenceOverride includes trust status evidence", () => {
  const override = buildHostKeyEvidenceOverride(
    [],
    { type: "ssh-ed25519", sha256: "SHA256:new" },
    { type: "ssh-rsa", sha256: "SHA256:old" },
  );

  assert.equal(override.hostKeyTrust.status, "changed");
  assert.deepEqual(override.evidence, [
    { label: "主机指纹", value: "ssh-ed25519 SHA256:new" },
    { label: "指纹状态", value: "指纹变更：主机指纹与已信任记录不一致，请警惕中间人攻击或服务器重装。" },
  ]);
});

test("buildHostKeyTrustPrompt asks for explicit confirmation before trusting first seen key", () => {
  const prompt = buildHostKeyTrustPrompt(
    "prod-web-01",
    { type: "ssh-ed25519", sha256: "SHA256:new" },
    null,
  );

  assert.equal(prompt.canTrust, true);
  assert.equal(prompt.severity, "warning");
  assert.match(prompt.title, /确认信任主机指纹/);
  assert.match(prompt.message, /prod-web-01/);
  assert.match(prompt.message, /ssh-ed25519 SHA256:new/);
  assert.match(prompt.message, /首次发现/);
});

test("buildHostKeyTrustPrompt warns strongly when replacing a changed trusted key", () => {
  const prompt = buildHostKeyTrustPrompt(
    "prod-web-01",
    { type: "ssh-ed25519", sha256: "SHA256:new" },
    { type: "ssh-rsa", sha256: "SHA256:old" },
  );

  assert.equal(prompt.canTrust, true);
  assert.equal(prompt.severity, "danger");
  assert.match(prompt.title, /指纹变更/);
  assert.match(prompt.message, /当前指纹：ssh-ed25519 SHA256:new/);
  assert.match(prompt.message, /已信任指纹：ssh-rsa SHA256:old/);
  assert.match(prompt.message, /中间人攻击|服务器重装/);
});

test("buildHostKeyTrustPrompt blocks empty host keys", () => {
  const prompt = buildHostKeyTrustPrompt("prod-web-01", {}, null);

  assert.equal(prompt.canTrust, false);
  assert.equal(prompt.severity, "disabled");
  assert.match(prompt.message, /没有可保存的主机指纹/);
});

test("buildConnectionQuickFixActions maps auth failures to credential repair", () => {
  const actions = buildConnectionQuickFixActions({ kind: "auth" }, { credentialRef: "" });
  const keyActions = buildConnectionQuickFixActions({ kind: "key-file" }, {});
  const agentActions = buildConnectionQuickFixActions({ kind: "agent-auth" }, {});

  assert.deepEqual(actions.slice(0, 3), [
    { id: "open-auth-center", label: "补录凭据", tone: "primary", target: "auth-center" },
    { id: "edit-connection", label: "检查连接配置", tone: "secondary", target: "server-editor" },
    { id: "test-connection", label: "重新测试", tone: "secondary", target: "connection-test" },
  ]);
  assert.equal(keyActions[0].label, "检查私钥文件");
  assert.equal(agentActions[0].label, "检查 SSH Agent");
});

test("buildConnectionQuickFixActions maps host-key failures to trust flow", () => {
  const actions = buildConnectionQuickFixActions(
    { kind: "host-key" },
    { hostKey: { type: "ssh-ed25519", sha256: "SHA256:new" } },
  );

  assert.deepEqual(actions.slice(0, 2), [
    { id: "trust-host-key", label: "确认并信任指纹", tone: "danger", target: "host-key-trust" },
    { id: "test-connection", label: "重新测试", tone: "secondary", target: "connection-test" },
  ]);
});

test("buildConnectionQuickFixActions maps network failures to editor and retry", () => {
  const timeoutActions = buildConnectionQuickFixActions({ kind: "timeout" }, {});
  const refusedActions = buildConnectionQuickFixActions({ kind: "refused" }, {});
  const dnsActions = buildConnectionQuickFixActions({ kind: "dns" }, {});
  const handshakeActions = buildConnectionQuickFixActions({ kind: "handshake" }, {});

  assert.deepEqual(timeoutActions.slice(0, 3), [
    { id: "edit-connection", label: "检查地址/端口", tone: "primary", target: "server-editor" },
    { id: "test-connection", label: "重新测试", tone: "secondary", target: "connection-test" },
    { id: "queue-agent-diagnostic", label: "交给 Agent 排查", tone: "secondary", target: "agent-diagnostic" },
  ]);
  assert.equal(refusedActions[0].label, "检查 SSH 端口");
  assert.equal(dnsActions[0].label, "检查主机名/DNS");
  assert.equal(handshakeActions[0].label, "检查 SSH 服务/限制");
});

test("buildConnectionQuickFixActions maps SSH algorithm failures to Agent diagnostics", () => {
  const actions = buildConnectionQuickFixActions({ kind: "algorithm" }, {});

  assert.deepEqual(actions.slice(0, 3), [
    { id: "test-connection", label: "重新测试", tone: "primary", target: "connection-test" },
    { id: "queue-agent-diagnostic", label: "交给 Agent 排查算法兼容", tone: "secondary", target: "agent-diagnostic" },
    { id: "open-tool-logs", label: "查看工具日志", tone: "secondary", target: "tool-logs" },
  ]);
});

test("buildConnectionQuickFixActions always offers log and diagnostic export for failures", () => {
  const actions = buildConnectionQuickFixActions({ kind: "timeout" }, {});

  assert.deepEqual(actions.slice(-2), [
    { id: "open-tool-logs", label: "查看工具日志", tone: "secondary", target: "tool-logs" },
    { id: "export-diagnostic-package", label: "导出诊断包", tone: "secondary", target: "diagnostic-package" },
  ]);
});

test("buildSshOpenFailureTerminalLines gives actionable auth repair guidance", () => {
  const lines = buildSshOpenFailureTerminalLines(
    "请先在认证中心绑定或填写 SSH 凭据。",
    { kind: "auth", label: "缺少凭据", summary: "请先在认证中心绑定或填写 SSH 凭据。" },
    {},
  );

  assert.deepEqual(lines, [
    "# 请先在认证中心绑定或填写 SSH 凭据。",
    "# 下一步：打开认证中心，补录密码、私钥或 SSH Agent 凭据。",
    "# 也可以右键终端查看会话日志、工具日志或导出诊断包。",
  ]);
});

test("buildSshOpenFailureTerminalLines includes backend SSH suggestions", () => {
  const lines = buildSshOpenFailureTerminalLines(
    "SSH 会话连接失败",
    {
      kind: "timeout",
      summary: "连接超时。",
      suggestions: ["检查安全组和防火墙。", "确认 VPN 或堡垒机链路。"],
    },
    {},
  );

  assert.deepEqual(lines, [
    "# SSH 会话连接失败",
    "# 下一步：检查地址/端口、重新测试、交给 Agent 排查。",
    "# 建议：检查安全组和防火墙。；确认 VPN 或堡垒机链路。",
    "# 也可以右键终端查看会话日志、工具日志或导出诊断包。",
  ]);
});
