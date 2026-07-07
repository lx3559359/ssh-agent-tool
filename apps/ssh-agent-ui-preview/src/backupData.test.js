import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBackupCenterModel,
  buildBackupCredentialMatrix,
  buildBackupCredentialChecklistText,
  buildBackupExportPreview,
  buildBackupImportDialogModel,
  buildBackupImportPlan,
  buildBackupImportScopeSummary,
  buildBackupImportSubmitState,
  buildBackupImportPreview,
  buildBackupPayload,
  buildBackupFileName,
  buildBackupRestoreResultSummary,
  buildBackupHistoryEntry,
  validateBackupMasterPassword,
  hasBackupImportTargets,
  addBackupHistoryEntry,
  clearBackupHistory,
  removeBackupHistoryEntry,
  buildOpenSshConfigExport,
  buildServerInventoryCsv,
  mergeBackupCommandSnippets,
  mergeBackupPortForwardPresets,
  mergeBackupAgentCapabilities,
  mergeBackupModelProfiles,
  mergeBackupHosts,
} from "./backupData.js";

const sampleServers = {
  "prod-web-01": {
    ip: "10.0.1.23",
    port: "22",
    group: "prod",
    user: "root",
    cwd: "/var/www/app",
    policy: "readonly",
    authType: "password",
    files: [
      { type: "folder", name: "/var/www/app" },
      { type: "file", name: "app.log" },
    ],
  },
};

test("buildBackupCredentialMatrix classifies server credential restore modes", () => {
  const matrix = buildBackupCredentialMatrix({
    "prod-web-01": {
      authType: "密码",
      credentialRef: "sshcred-prod-web",
      user: "root",
      ip: "10.0.1.23",
    },
    "prod-key-01": {
      authType: "私钥",
      identityFile: "~/.ssh/prod_key",
      user: "deploy",
      ip: "10.0.1.24",
    },
    "prod-agent-01": {
      authType: "SSH Agent",
      user: "ops",
      ip: "10.0.1.25",
    },
    "prod-empty-01": {
      authType: "密码",
      user: "root",
      ip: "10.0.1.26",
    },
  }, { includeSecrets: true });

  assert.deepEqual(matrix.summary, {
    total: 4,
    encryptedReady: 1,
    pathOnly: 1,
    sshAgent: 1,
    missing: 1,
  });
  assert.deepEqual(
    matrix.rows.map((row) => [row.name, row.restoreMode, row.canRestoreSecret]),
    [
      ["prod-web-01", "加密恢复", true],
      ["prod-key-01", "路径恢复", false],
      ["prod-agent-01", "Agent 手动恢复", false],
      ["prod-empty-01", "需要补录", false],
    ],
  );
  assert.match(matrix.rows[0].backupAction, /备份主密码加密/);
  assert.match(matrix.rows[1].manualAction, /私钥文件本身/);
  assert.match(matrix.rows[2].manualAction, /SSH Agent/);
  assert.match(matrix.rows[3].manualAction, /重新录入/);
});

test("buildBackupCredentialMatrix reports encrypted credentials as skipped when secrets are disabled", () => {
  const matrix = buildBackupCredentialMatrix({
    "prod-web-01": {
      authType: "密码",
      credentialRef: "sshcred-prod-web",
      user: "root",
      ip: "10.0.1.23",
    },
  }, { includeSecrets: false });

  assert.deepEqual(matrix.summary, {
    total: 1,
    encryptedReady: 0,
    pathOnly: 0,
    sshAgent: 0,
    missing: 1,
  });
  assert.equal(matrix.rows[0].restoreMode, "脱敏导出");
  assert.match(matrix.rows[0].manualAction, /未勾选加密导出/);
});

test("buildBackupCredentialChecklistText creates a safe migration checklist without secrets", () => {
  const text = buildBackupCredentialChecklistText({
    "prod-web-01": {
      authType: "密码",
      credentialRef: "sshcred-prod-web",
      credentialSecret: "DoNotExport!123",
      user: "root",
      ip: "10.0.1.23",
    },
    "prod-key-01": {
      authType: "私钥",
      identityFile: "~/.ssh/prod_key",
      privateKey: "PRIVATE KEY",
      user: "deploy",
      ip: "10.0.1.24",
    },
    "prod-empty-01": {
      authType: "密码",
      user: "root",
      ip: "10.0.1.26",
    },
  }, { includeSecrets: true, exportedAt: "2026-07-03T10:30:00.000Z" });

  assert.match(text, /^SSH Agent 凭据迁移清单/);
  assert.match(text, /导出模式：完整加密备份/);
  assert.match(text, /统计：总数 3，可加密恢复 1，私钥路径 1，SSH Agent 0，需补录 1/);
  assert.match(text, /prod-web-01[\s\S]*加密恢复[\s\S]*导入时输入备份主密码即可恢复到本机加密凭据库/);
  assert.match(text, /prod-key-01[\s\S]*路径恢复[\s\S]*私钥文件本身不会进入备份/);
  assert.match(text, /prod-empty-01[\s\S]*需要补录[\s\S]*恢复后需要重新录入密码/);
  assert.match(text, /本清单不包含密码、私钥内容、口令短语或凭据引用/);
  assert.doesNotMatch(text, /DoNotExport|sshcred-prod-web|PRIVATE KEY/);
});

test("buildBackupRestoreResultSummary reports restored skipped and pending credentials", () => {
  const summary = buildBackupRestoreResultSummary({
    importedNames: ["prod-web-01", "prod-db-01", "prod-agent-01"],
    importedHosts: [
      { name: "prod-web-01", host: { secret: { schema: "ssh-agent-tool.secret.v1" } } },
      { name: "prod-db-01", host: { hasSecret: true } },
      { name: "prod-agent-01", host: { authType: "SSH Agent" } },
    ],
    credentialRestore: {
      ok: true,
      credentials: [{ name: "prod-web-01", credentialRef: "sshcred-prod-web", hasSecret: true }],
      skipped: 1,
    },
    restoreSecrets: true,
  });

  assert.equal(summary.visible, true);
  assert.deepEqual(summary.stats, {
    imported: 3,
    restored: 1,
    skipped: 1,
    pending: 2,
  });
  assert.match(summary.message, /已恢复 1 台服务器凭据/);
  assert.deepEqual(
    summary.rows.map((row) => [row.name, row.status, row.tone]),
    [
      ["prod-web-01", "凭据已恢复", "green"],
      ["prod-db-01", "凭据未恢复", "amber"],
      ["prod-agent-01", "需要手动确认", "blue"],
    ],
  );
});

test("buildBackupRestoreResultSummary explains config only imports", () => {
  const summary = buildBackupRestoreResultSummary({
    importedNames: ["prod-web-01"],
    importedHosts: [{ name: "prod-web-01", host: { hasSecret: true } }],
    credentialRestore: null,
    restoreSecrets: false,
  });

  assert.equal(summary.visible, true);
  assert.equal(summary.stats.restored, 0);
  assert.equal(summary.rows[0].status, "仅导入配置");
  assert.match(summary.message, /仅导入配置/);
});

test("buildBackupRestoreResultSummary matches restored credentials after server rename", () => {
  const summary = buildBackupRestoreResultSummary({
    importedNames: ["prod-web-01-导入"],
    importedHosts: [
      {
        name: "prod-web-01-导入",
        sourceName: "prod-web-01",
        host: {
          name: "prod-web-01",
          host: "10.0.1.23",
          hasSecret: true,
          secret: { schema: "ssh-agent-tool.secret.v1" },
        },
      },
    ],
    credentialRestore: {
      ok: true,
      credentials: [{ name: "prod-web-01", credentialRef: "sshcred-restored", hasSecret: true }],
      skipped: 0,
    },
    restoreSecrets: true,
  });

  assert.equal(summary.stats.restored, 1);
  assert.equal(summary.stats.pending, 0);
  assert.equal(summary.rows[0].name, "prod-web-01-导入");
  assert.equal(summary.rows[0].credentialRef, "sshcred-restored");
});

test("validateBackupMasterPassword allows redacted backups without a password", () => {
  const result = validateBackupMasterPassword("", "", false);

  assert.equal(result.valid, true);
  assert.equal(result.required, false);
  assert.equal(result.level, "none");
});

test("validateBackupMasterPassword rejects short passwords for encrypted backups", () => {
  const result = validateBackupMasterPassword("abc123", "abc123", true);

  assert.equal(result.valid, false);
  assert.equal(result.required, true);
  assert.equal(result.level, "weak");
  assert.match(result.message, /8/);
});

test("validateBackupMasterPassword rejects mismatched confirmation", () => {
  const result = validateBackupMasterPassword("OpsBackup2026!", "OpsBackup2025!", true);

  assert.equal(result.valid, false);
  assert.equal(result.level, "strong");
  assert.match(result.message, /不一致/);
});

test("validateBackupMasterPassword accepts strong confirmed backup password", () => {
  const result = validateBackupMasterPassword("OpsBackup2026!", "OpsBackup2026!", true);

  assert.equal(result.valid, true);
  assert.equal(result.level, "strong");
  assert.equal(result.message, "备份主密码强度高。");
});

test("buildBackupPayload redacts secrets by default", () => {
  const payload = buildBackupPayload({
    servers: sampleServers,
    scope: { hosts: true, sftp: true, skills: false, mcp: false, secrets: false },
    exportedAt: "2026-06-25T00:00:00.000Z",
  });

  assert.equal(payload.schema, "ssh-agent-tool.backup.v1");
  assert.equal(payload.encryption.enabled, false);
  assert.equal(payload.hosts[0].name, "prod-web-01");
  assert.equal(payload.hosts[0].authType, "redacted");
  assert.equal("secret" in payload.hosts[0], false);
  assert.deepEqual(payload.sftpBookmarks, [{ host: "prod-web-01", paths: ["/var/www/app"] }]);
});

test("buildBackupPayload preserves host-only server addresses for cross-machine restore", () => {
  const payload = buildBackupPayload({
    servers: {
      "prod-domain-01": {
        host: "web01.example.internal",
        port: "2222",
        user: "deploy",
        group: "prod",
        cwd: "/srv/app",
      },
    },
    scope: { hosts: true, sftp: false, skills: false, mcp: false, cli: false, secrets: false },
    exportedAt: "2026-06-25T00:00:00.000Z",
  });

  assert.equal(payload.hosts[0].host, "web01.example.internal");

  const restored = mergeBackupHosts({}, payload);
  assert.equal(restored.servers["prod-domain-01"].ip, "web01.example.internal");
  assert.equal(restored.servers["prod-domain-01"].port, "2222");
});

test("buildBackupPayload does not emit placeholder secrets in browser fallback", () => {
  const payload = buildBackupPayload({
    servers: { "prod-web-01": { ...sampleServers["prod-web-01"], credentialRef: "sshcred-demo" } },
    scope: { hosts: true, sftp: false, skills: false, mcp: false, secrets: true },
    exportedAt: "2026-06-25T00:00:00.000Z",
  });

  assert.equal(payload.encryption.enabled, true);
  assert.equal(payload.hosts[0].hasSecret, true);
  assert.equal("secret" in payload.hosts[0], false);
  assert.doesNotMatch(JSON.stringify(payload), /ENCRYPTED_SECRET_PREVIEW/);
});

test("buildBackupPayload includes an auditable manifest for restore preview", () => {
  const payload = buildBackupPayload({
    servers: { "prod-web-01": { ...sampleServers["prod-web-01"], credentialRef: "sshcred-demo" } },
    scope: { hosts: true, sftp: true, skills: true, mcp: true, cli: true, secrets: true },
    agentCapabilities: [
      { type: "Skill", name: "Nginx health", entry: "skills/nginx.md" },
      {
        type: "MCP",
        name: "Internal MCP",
        endpoint: "https://mcp.example.com/rpc",
        headers: [
          { name: "Authorization", value: "Bearer token", enabled: true },
          { name: "X-Team", value: "ops", enabled: true },
        ],
      },
      { type: "CLI", name: "Local df", entry: "local:df -h" },
    ],
    exportedAt: "2026-06-25T00:00:00.000Z",
  });

  assert.equal(payload.manifest.schemaVersion, 1);
  assert.equal(payload.manifest.exportedAt, "2026-06-25T00:00:00.000Z");
  assert.equal(payload.manifest.hostCount, 1);
  assert.equal(payload.manifest.sftpBookmarkCount, 1);
  assert.equal(payload.manifest.agentCapabilityCount, 3);
  assert.deepEqual(payload.manifest.capabilityCounts, { skill: 1, mcp: 1, cli: 1 });
  assert.equal(payload.manifest.encryptedCredentialCount, 1);
  assert.equal(payload.manifest.sensitiveMcpHeaderCount, 1);
  assert.equal(payload.manifest.includesSecrets, true);
});

test("buildBackupPayload preserves SSH server metadata while redacting secret refs", () => {
  const payload = buildBackupPayload({
    servers: {
      "prod-web-01": {
        ...sampleServers["prod-web-01"],
        credentialRef: "sshcred-prod-web",
        timeoutSeconds: 25,
        retryCount: 2,
        keepaliveSeconds: 45,
        keepaliveCountMax: 6,
        tags: ["nginx", "重要"],
        hostKey: { type: "ssh-ed25519", sha256: "SHA256:current" },
        trustedHostKey: { type: "ssh-ed25519", sha256: "SHA256:trusted", trustedAt: "2026-06-26T03:20:00.000Z" },
        hostKeyTrust: { status: "trusted", label: "已信任" },
        identityFile: "~/.ssh/prod_web_ed25519",
        forwardAgent: true,
        proxyJump: "bastion",
        hostKeyAlias: "prod-web-01.internal",
        localForwards: [{ localHost: "127.0.0.1", localPort: "18080", remoteHost: "127.0.0.1", remotePort: "80" }],
        remoteForwards: [{ remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" }],
        dynamicForwards: [{ bindHost: "127.0.0.1", bindPort: "1080" }],
        credentialSecret: "DoNotExport!123",
      },
    },
    scope: { hosts: true, sftp: false, skills: false, mcp: false, cli: false, secrets: true },
    exportedAt: "2026-06-25T00:00:00.000Z",
  });

  assert.equal(payload.hosts[0].timeoutSeconds, 25);
  assert.equal(payload.hosts[0].retryCount, 2);
  assert.equal(payload.hosts[0].keepaliveSeconds, 45);
  assert.equal(payload.hosts[0].keepaliveCountMax, 6);
  assert.deepEqual(payload.hosts[0].tags, ["nginx", "重要"]);
  assert.equal(payload.hosts[0].hostKey.sha256, "SHA256:current");
  assert.equal(payload.hosts[0].trustedHostKey.sha256, "SHA256:trusted");
  assert.equal(payload.hosts[0].hostKeyTrust.status, "trusted");
  assert.equal(payload.hosts[0].identityFile, "~/.ssh/prod_web_ed25519");
  assert.equal(payload.hosts[0].forwardAgent, true);
  assert.equal(payload.hosts[0].proxyJump, "bastion");
  assert.equal(payload.hosts[0].hostKeyAlias, "prod-web-01.internal");
  assert.deepEqual(payload.hosts[0].localForwards, [{ localHost: "127.0.0.1", localPort: "18080", remoteHost: "127.0.0.1", remotePort: "80" }]);
  assert.deepEqual(payload.hosts[0].remoteForwards, [{ remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" }]);
  assert.deepEqual(payload.hosts[0].dynamicForwards, [{ bindHost: "127.0.0.1", bindPort: "1080" }]);
  assert.doesNotMatch(JSON.stringify(payload), /sshcred-prod-web|DoNotExport/);
});

test("buildBackupPayload exports explicit SFTP bookmarks as migration data", () => {
  const payload = buildBackupPayload({
    servers: {
      "prod-web-01": {
        ...sampleServers["prod-web-01"],
        sftpBookmarks: ["/var/www/app", "/etc/nginx/"],
      },
    },
    modelConfig: {},
    capabilities: [],
    scope: { hosts: true, sftp: true, skills: false, mcp: false, secrets: false },
  });

  assert.deepEqual(payload.sftpBookmarks, [{ host: "prod-web-01", paths: ["/var/www/app", "/etc/nginx"] }]);
  assert.equal(payload.manifest.sftpBookmarkCount, 2);
});

test("buildBackupPayload exports model API profiles without API key secrets", () => {
  const payload = buildBackupPayload({
    servers: {},
    scope: { hosts: false, sftp: false, skills: false, mcp: false, cli: false, modelProfiles: true },
    modelConfig: {
      provider: "OpenAI 兼容",
      baseUrl: "https://api.example.com/v1",
      model: "gpt-4.1-mini",
      apiKey: "sk-must-not-export",
      apiKeyRef: "sshcred-model-api",
      hasApiKey: true,
      extraHeaders: [
        { name: "HTTP-Referer", value: "https://ops.example.com", enabled: true },
        { name: "Authorization", value: "Bearer secret", enabled: true },
      ],
      modelOptions: ["gpt-4.1-mini", "deepseek-chat"],
    },
    modelProfiles: [
      {
        id: "relay",
        name: "中转站",
        config: {
          provider: "中转站 API",
          baseUrl: "https://relay.example/v1",
          model: "gpt-relay",
          apiKey: "sk-profile-secret",
          apiKeyRef: "sshcred-profile",
          hasApiKey: true,
          modelOptions: ["gpt-relay"],
        },
      },
    ],
    exportedAt: "2026-06-25T00:00:00.000Z",
  });

  assert.equal(payload.manifest.modelProfileCount, 2);
  assert.equal(payload.modelConfig.provider, "OpenAI 兼容");
  assert.equal(payload.modelConfig.apiKey, "");
  assert.equal(payload.modelConfig.apiKeyRef, "");
  assert.equal(payload.modelConfig.hasApiKey, false);
  assert.deepEqual(payload.modelConfig.extraHeaders, [
    { name: "HTTP-Referer", value: "https://ops.example.com", enabled: true },
  ]);
  assert.deepEqual(payload.modelConfig.modelOptions, ["gpt-4.1-mini", "deepseek-chat"]);
  assert.equal(payload.modelProfiles[1].name, "中转站");
  assert.equal(payload.modelProfiles[1].config.apiKeyRef, "");
  assert.doesNotMatch(JSON.stringify(payload), /sk-must-not-export|sk-profile-secret|sshcred-model-api|sshcred-profile|Bearer secret/);
});

test("mergeBackupModelProfiles imports redacted model API profiles without duplicates", () => {
  const result = mergeBackupModelProfiles(
    [{ id: "existing", name: "Existing", config: { provider: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" } }],
    {
      schema: "ssh-agent-tool.backup.v1",
      modelProfiles: [
        { id: "relay", name: "Relay", config: { provider: "Relay", baseUrl: "https://relay.example/v1", model: "gpt-relay", apiKey: "sk-secret" } },
        { id: "existing", name: "Duplicate", config: { provider: "Dup", baseUrl: "https://dup.example/v1", model: "dup" } },
      ],
    },
  );

  assert.equal(result.profiles.length, 2);
  assert.deepEqual(result.importedNames, ["Relay"]);
  assert.equal(result.skipped, 1);
  assert.equal(result.profiles[1].config.apiKey, "");
  assert.equal(result.profiles[1].config.hasApiKey, false);
});

test("buildBackupPayload exports custom agent capabilities by type", () => {
  const payload = buildBackupPayload({
    servers: sampleServers,
    scope: { hosts: false, sftp: false, skills: true, mcp: true, cli: true, secrets: false },
    agentCapabilities: [
      { type: "Skill", name: "Nginx 深度排查", entry: "skills/nginx.md" },
      {
        type: "MCP",
        name: "Grafana",
        endpoint: "http://127.0.0.1:3000/mcp",
        headers: [
          { name: "Authorization", value: "Bearer token", enabled: true },
          { name: "X-Team", value: "ops", enabled: true },
        ],
      },
      { type: "CLI", name: "慢查询分析", entry: "mysql-slowlog --summary" },
    ],
    exportedAt: "2026-06-25T00:00:00.000Z",
  });

  assert.equal(payload.skills[0].name, "Nginx 深度排查");
  assert.equal(payload.mcp[0].name, "Grafana");
  assert.deepEqual(payload.mcp[0].headers, [
    { name: "Authorization", value: "", enabled: true, sensitive: true, redacted: true, hasSecret: true },
    { name: "X-Team", value: "ops", enabled: true },
  ]);
  assert.doesNotMatch(JSON.stringify(payload), /Bearer token/);
  assert.equal(payload.cli[0].name, "慢查询分析");
});

test("buildBackupPayload preserves Skill package metadata for migration", () => {
  const payload = buildBackupPayload({
    servers: sampleServers,
    scope: { hosts: false, sftp: false, skills: true, mcp: false, cli: false, secrets: false },
    agentCapabilities: [
      {
        type: "Skill",
        name: "Redis 延迟排查",
        description: "检查 Redis 慢命令",
        entry: "skills/redis-latency.md",
        version: "1.2.0",
        tags: ["redis", "性能"],
        parameters: [{ name: "database", description: "Redis 实例", required: true }],
        commands: [{ label: "慢命令", command: "redis-cli slowlog get 10" }],
        docs: "只读检查 slowlog、client list 和 info memory。",
      },
    ],
    exportedAt: "2026-06-25T00:00:00.000Z",
  });

  assert.deepEqual(payload.skills[0].tags, ["redis", "性能"]);
  assert.equal(payload.skills[0].version, "1.2.0");
  assert.deepEqual(payload.skills[0].parameters, [{ name: "database", description: "Redis 实例", required: true }]);
  assert.deepEqual(payload.skills[0].commands, [{ label: "慢命令", command: "redis-cli slowlog get 10" }]);
  assert.equal(payload.skills[0].docs, "只读检查 slowlog、client list 和 info memory。");
});

test("buildBackupPayload exports port forward presets without secrets", () => {
  const payload = buildBackupPayload({
    servers: sampleServers,
    scope: { hosts: false, sftp: false, skills: false, mcp: false, cli: false, portForwards: true, secrets: true },
    portForwardPresets: [
      {
        id: "pfpreset-prod-web",
        serverName: "prod-web-01",
        name: "Nginx 管理页",
        localHost: "127.0.0.1",
        localPort: 18080,
        remoteHost: "127.0.0.1",
        remotePort: 80,
        password: "DoNotExport",
      },
    ],
    exportedAt: "2026-06-25T00:00:00.000Z",
  });

  assert.equal(payload.manifest.portForwardPresetCount, 1);
  assert.deepEqual(payload.portForwards, [
    {
      id: "pfpreset-prod-web",
      serverName: "prod-web-01",
      name: "Nginx 管理页",
      localHost: "127.0.0.1",
      localPort: 18080,
      remoteHost: "127.0.0.1",
      remotePort: 80,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(payload), /DoNotExport|password/i);
});

test("mergeBackupPortForwardPresets imports valid presets without duplicates", () => {
  const backup = {
    schema: "ssh-agent-tool.backup.v1",
    portForwards: [
      { id: "pfpreset-prod-web", serverName: "prod-web-01", name: "Nginx 管理页", localHost: "127.0.0.1", localPort: "18080", remoteHost: "127.0.0.1", remotePort: "80" },
      { id: "unsafe", serverName: "prod-web-01", localHost: "0.0.0.0", localPort: "18081", remoteHost: "127.0.0.1", remotePort: "80" },
    ],
  };

  const result = mergeBackupPortForwardPresets([{ id: "pfpreset-prod-web", serverName: "prod-web-01" }], backup);

  assert.equal(result.presets.length, 1);
  assert.deepEqual(result.importedNames, []);
  assert.equal(result.skipped, 2);

  const imported = mergeBackupPortForwardPresets([], backup);
  assert.equal(imported.presets.length, 1);
  assert.equal(imported.presets[0].localPort, 18080);
  assert.deepEqual(imported.importedNames, ["Nginx 管理页"]);
  assert.equal(imported.skipped, 1);
});

test("buildBackupPayload exports custom command snippets without sensitive commands", () => {
  const payload = buildBackupPayload({
    servers: sampleServers,
    scope: {
      hosts: false,
      sftp: false,
      skills: false,
      mcp: false,
      cli: false,
      portForwards: false,
      commandSnippets: true,
      secrets: true,
    },
    commandSnippets: [
      { label: "磁盘检查", command: "df -hT" },
      { label: "Token 调试", command: 'curl -H "Authorization: Bearer abc" https://example.com' },
      { label: "数据库密码", command: "mysql --password=DoNotExport" },
    ],
    exportedAt: "2026-06-25T00:00:00.000Z",
  });

  assert.equal(payload.manifest.commandSnippetCount, 1);
  assert.deepEqual(payload.commandSnippets, [{ label: "磁盘检查", command: "df -hT", custom: true }]);
  assert.doesNotMatch(JSON.stringify(payload), /Bearer|DoNotExport|Authorization|password/i);
});

test("mergeBackupCommandSnippets imports valid snippets without duplicates or sensitive commands", () => {
  const backup = {
    schema: "ssh-agent-tool.backup.v1",
    commandSnippets: [
      { label: "磁盘检查", command: "df -hT" },
      { label: "重复磁盘", command: "DF -HT" },
      { label: "Token 调试", command: 'curl -H "Authorization: Bearer abc" https://example.com' },
      { label: "", command: "" },
    ],
  };

  const duplicateOnly = mergeBackupCommandSnippets([{ label: "已有磁盘", command: "df -hT", custom: true }], backup);
  assert.equal(duplicateOnly.snippets.length, 1);
  assert.deepEqual(duplicateOnly.importedNames, []);
  assert.equal(duplicateOnly.skipped, 4);

  const imported = mergeBackupCommandSnippets([], backup);
  assert.deepEqual(imported.snippets, [{ label: "磁盘检查", command: "df -hT", custom: true }]);
  assert.deepEqual(imported.importedNames, ["磁盘检查"]);
  assert.equal(imported.skipped, 3);
});

test("buildBackupExportPreview summarizes selected scope and sensitive fields in Chinese", () => {
  const preview = buildBackupExportPreview({
    servers: {
      "prod-web-01": {
        ...sampleServers["prod-web-01"],
        credentialRef: "sshcred-prod-web",
        files: [{ type: "folder", name: "/var/www/app" }],
      },
      "dev-empty": {
        ip: "10.0.2.15",
        user: "deploy",
      },
    },
    scope: { hosts: true, sftp: true, skills: true, mcp: true, cli: true, secrets: true },
    agentCapabilities: [
      { type: "Skill", name: "Nginx 深度排查", entry: "skills/nginx.md" },
      {
        type: "MCP",
        name: "Internal MCP",
        endpoint: "https://mcp.example.com/rpc",
        headers: [
          { name: "Authorization", value: "Bearer token", enabled: true },
          { name: "X-Team", value: "ops", enabled: true },
        ],
      },
      { type: "CLI", name: "本地诊断", entry: "local:ssh-agent-tool diagnose-ssh" },
    ],
  });

  assert.deepEqual(preview.stats.map((item) => `${item.label}:${item.value}`), [
    "SSH 主机:2",
    "SFTP 书签:1",
    "Agent 能力:3",
    "端口转发:0",
    "命令片段:0",
    "加密凭据:1",
    "敏感 Header:1",
  ]);
  assert.match(preview.summary, /将导出 2 台 SSH 主机、1 个 SFTP 书签、3 个 Agent 能力/);
  assert.match(preview.securityNote, /密码、私钥和口令短语会使用备份主密码加密/);
  assert.equal(preview.requiresMasterPassword, true);
});

test("buildBackupCenterModel separates export paths and sensitive data boundaries", () => {
  const preview = buildBackupExportPreview({
    servers: {
      "prod-web-01": {
        ...sampleServers["prod-web-01"],
        credentialRef: "sshcred-prod-web",
        files: [{ type: "folder", name: "/var/www/app" }],
      },
    },
    scope: { hosts: true, sftp: true, skills: true, mcp: true, cli: true, portForwards: true, commandSnippets: true, secrets: true },
    agentCapabilities: [
      { type: "Skill", name: "Nginx 深度排查", entry: "skills/nginx.md" },
      {
        type: "MCP",
        name: "Internal MCP",
        endpoint: "https://mcp.example.com/rpc",
        headers: [{ name: "Authorization", value: "Bearer token", enabled: true }],
      },
    ],
    portForwardPresets: [{ serverName: "prod-web-01", name: "Web 管理", localPort: 18080, remoteHost: "127.0.0.1", remotePort: 80 }],
    commandSnippets: [{ label: "磁盘检查", command: "df -hT" }],
  });

  const model = buildBackupCenterModel(preview, { historyCount: 2 });

  assert.equal(model.title, "备份中心");
  assert.match(model.summary, /完整备份/);
  assert.deepEqual(model.exportCards.map((card) => card.id), ["backup-json", "inventory-csv", "openssh-config"]);
  assert.equal(model.exportCards[0].primary, true);
  assert.equal(model.exportCards[0].encryptedCapable, true);
  assert.equal(model.exportCards[1].encryptedCapable, false);
  assert.equal(model.exportCards[2].encryptedCapable, false);
  assert.match(model.exportCards[0].security, /可加密保存密码/);
  assert.match(model.exportCards[1].security, /不会导出密码/);
  assert.match(model.exportCards[2].security, /不会导出密码/);
  assert.deepEqual(model.securityChecklist, [
    "默认导出为脱敏配置，不包含明文密码、私钥、Token 或 MCP Header 密钥。",
    "勾选“加密导出密码/密钥”后，敏感字段只写入主密码加密后的备份 JSON。",
    "CSV 清单和 OpenSSH Config 永远只导出连接元数据，适合分享和审计。",
  ]);
  assert.equal(model.historyNote, "已记录最近 2 次导出摘要，不保存备份正文或明文敏感信息。");
});

test("buildBackupHistoryEntry stores a safe export summary without backup contents", () => {
  const payload = buildBackupPayload({
    servers: {
      "prod-web-01": {
        ...sampleServers["prod-web-01"],
        credentialRef: "sshcred-prod-web",
        credentialSecret: "DoNotExport!123",
      },
    },
    scope: { hosts: true, sftp: true, skills: false, mcp: false, cli: false, secrets: true },
    exportedAt: "2026-06-26T08:10:00.000Z",
  });

  const entry = buildBackupHistoryEntry({
    payload,
    target: "F:\\Backups\\ssh-agent-tool-backup.json",
    scope: { hosts: true, sftp: true, secrets: true },
    exportResult: {
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      sizeBytes: 4096,
    },
  });

  assert.equal(entry.exportedAt, "2026-06-26T08:10:00.000Z");
  assert.equal(entry.fileName, "ssh-agent-tool-backup.json");
  assert.equal(entry.encrypted, true);
  assert.equal(entry.hostCount, 1);
  assert.equal(entry.sftpBookmarkCount, 1);
  assert.equal(entry.encryptedCredentialCount, 1);
  assert.equal(entry.sha256, "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF");
  assert.equal(entry.sizeBytes, 4096);
  assert.match(entry.fingerprint, /^[a-f0-9]{12}$/);
  assert.equal(
    entry.fingerprint,
    buildBackupHistoryEntry({
      payload,
      target: "F:\\Backups\\ssh-agent-tool-backup.json",
      scope: { hosts: true, sftp: true, secrets: true },
    }).fingerprint,
  );
  assert.notEqual(
    entry.fingerprint,
    buildBackupHistoryEntry({
      payload: { ...payload, exportedAt: "2026-06-26T08:11:00.000Z" },
      target: "F:\\Backups\\ssh-agent-tool-backup.json",
      scope: { hosts: true, sftp: true, secrets: true },
    }).fingerprint,
  );
  assert.deepEqual(entry.scope, { hosts: true, sftp: true, secrets: true });
  assert.equal(addBackupHistoryEntry([], entry)[0].sha256, entry.sha256);
  assert.doesNotMatch(JSON.stringify(entry), /DoNotExport|sshcred-prod-web|credentialRef|credentialSecret/i);
});

test("buildBackupFileName includes exported time and fingerprint", () => {
  const payload = buildBackupPayload({
    servers: sampleServers,
    scope: { hosts: true, sftp: false, skills: false, mcp: false, cli: false, secrets: false },
    exportedAt: "2026-06-26T08:20:00.000Z",
  });
  const fingerprint = buildBackupHistoryEntry({ payload, target: "backup.json" }).fingerprint;

  assert.equal(buildBackupFileName(payload), `ssh-agent-tool-backup-20260626-082000-${fingerprint}.json`);
});

test("addBackupHistoryEntry prepends deduped entries and limits history", () => {
  const oldEntry = buildBackupHistoryEntry({
    payload: { exportedAt: "2026-06-26T08:00:00.000Z", manifest: { hostCount: 1 } },
    target: "C:\\tmp\\old.json",
  });
  const duplicateReplacement = { ...oldEntry, hostCount: 2 };
  const newEntry = buildBackupHistoryEntry({
    payload: { exportedAt: "2026-06-26T08:11:00.000Z", manifest: { hostCount: 3 } },
    target: "C:\\tmp\\new.json",
  });

  const result = addBackupHistoryEntry([oldEntry], duplicateReplacement, 3);
  assert.equal(result.length, 1);
  assert.equal(result[0].hostCount, 2);

  const capped = addBackupHistoryEntry([oldEntry, { ...oldEntry, id: "second" }, { ...oldEntry, id: "third" }], newEntry, 3);
  assert.deepEqual(capped.map((item) => item.id), [newEntry.id, oldEntry.id, "second"]);
});

test("removeBackupHistoryEntry removes a selected backup record only", () => {
  const first = buildBackupHistoryEntry({
    payload: { exportedAt: "2026-06-26T08:00:00.000Z", manifest: { hostCount: 1 } },
    target: "C:\\tmp\\first.json",
  });
  const second = buildBackupHistoryEntry({
    payload: { exportedAt: "2026-06-26T08:01:00.000Z", manifest: { hostCount: 2 } },
    target: "C:\\tmp\\second.json",
  });

  const result = removeBackupHistoryEntry([first, second], first.id);

  assert.deepEqual(result.map((item) => item.id), [second.id]);
  assert.deepEqual(removeBackupHistoryEntry([first, second], "missing").map((item) => item.id), [first.id, second.id]);
});

test("clearBackupHistory returns an empty safe history list", () => {
  const entry = buildBackupHistoryEntry({
    payload: { exportedAt: "2026-06-26T08:00:00.000Z", manifest: { hostCount: 1 } },
    target: "C:\\tmp\\first.json",
  });

  assert.deepEqual(clearBackupHistory([entry]), []);
  assert.deepEqual(clearBackupHistory(null), []);
});

test("mergeBackupHosts imports backup hosts without overwriting existing names", () => {
  const backup = {
    schema: "ssh-agent-tool.backup.v1",
    hosts: [
      {
        name: "prod-web-01",
        host: "10.0.1.23",
        port: "2222",
        user: "deploy",
        group: "prod",
        cwd: "/srv/app",
        policy: "readonly",
        authType: "redacted",
        timeoutSeconds: 25,
        retryCount: 2,
        keepaliveSeconds: 45,
        keepaliveCountMax: 6,
        tags: ["nginx", "重要"],
        trustedHostKey: { type: "ssh-ed25519", sha256: "SHA256:trusted", trustedAt: "2026-06-26T03:20:00.000Z" },
        identityFile: "~/.ssh/prod_web_ed25519",
        forwardAgent: true,
        proxyJump: "bastion",
        hostKeyAlias: "prod-web-01.internal",
        localForwards: [{ localHost: "127.0.0.1", localPort: "18080", remoteHost: "127.0.0.1", remotePort: "80" }],
        remoteForwards: [{ remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" }],
        dynamicForwards: [{ bindHost: "127.0.0.1", bindPort: "1080" }],
      },
      {
        name: "prod-db-01",
        host: "10.0.1.31",
        user: "mysql",
        group: "prod",
        cwd: "/var/lib/mysql",
      },
    ],
  };

  const result = mergeBackupHosts({ "prod-web-01": sampleServers["prod-web-01"] }, backup);

  const importedServer = result.servers[result.importedNames[0]];
  assert.deepEqual(result.importedNames, ["prod-web-01-导入", "prod-db-01"]);
  assert.equal(result.importedHosts[0].name, "prod-web-01-导入");
  assert.equal(result.importedHosts[0].sourceName, "prod-web-01");
  assert.equal(result.importedHosts[0].host.host, "10.0.1.23");
  assert.equal(result.servers["prod-web-01"].ip, "10.0.1.23");
  assert.equal(result.servers["prod-web-01-导入"].port, "2222");
  assert.equal(result.servers["prod-web-01-导入"].timeoutSeconds, 25);
  assert.equal(result.servers["prod-web-01-导入"].retryCount, 2);
  assert.equal(result.servers["prod-web-01-导入"].keepaliveSeconds, 45);
  assert.equal(result.servers["prod-web-01-导入"].keepaliveCountMax, 6);
  assert.deepEqual(result.servers["prod-web-01-导入"].tags, ["nginx", "重要"]);
  assert.equal(result.servers["prod-web-01-导入"].trustedHostKey.sha256, "SHA256:trusted");
  assert.equal(result.servers["prod-web-01-导入"].identityFile, "~/.ssh/prod_web_ed25519");
  assert.equal(importedServer.forwardAgent, true);
  assert.equal(importedServer.hostKeyAlias, "prod-web-01.internal");
  assert.equal(result.servers["prod-web-01-导入"].proxyJump, "bastion");
  assert.deepEqual(result.servers["prod-web-01-导入"].localForwards, [{ localHost: "127.0.0.1", localPort: "18080", remoteHost: "127.0.0.1", remotePort: "80" }]);
  assert.deepEqual(result.servers["prod-web-01-导入"].remoteForwards, [{ remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" }]);
  assert.deepEqual(result.servers["prod-web-01-导入"].dynamicForwards, [{ bindHost: "127.0.0.1", bindPort: "1080" }]);
  assert.equal(result.servers["prod-db-01"].user, "mysql");
  assert.equal(result.skipped, 0);
});

test("mergeBackupHosts normalizes ForwardAgent yes and no string values", () => {
  const backup = {
    schema: "ssh-agent-tool.backup.v1",
    hosts: [
      {
        name: "agent-enabled",
        host: "10.0.1.50",
        user: "deploy",
        forwardAgent: "yes",
      },
      {
        name: "agent-disabled",
        host: "10.0.1.51",
        user: "deploy",
        forwardAgent: "no",
      },
    ],
  };

  const result = mergeBackupHosts({}, backup);

  assert.equal(result.servers["agent-enabled"].forwardAgent, true);
  assert.equal(result.servers["agent-disabled"].forwardAgent, false);
});

test("mergeBackupHosts rejects an unknown backup schema", () => {
  assert.throws(
    () => mergeBackupHosts({}, { schema: "unknown", hosts: [] }),
    /backup schema/,
  );
});

test("mergeBackupAgentCapabilities imports non-builtin capabilities without duplicates", () => {
  const backup = {
    schema: "ssh-agent-tool.backup.v1",
    skills: [
      { type: "Skill", name: "Linux 健康检查", builtin: true },
      { type: "Skill", name: "Nginx 深度排查", entry: "skills/nginx.md" },
    ],
    mcp: [{ type: "MCP", name: "Grafana", endpoint: "http://127.0.0.1:3000/mcp" }],
    cli: [{ type: "CLI", name: "慢查询分析", entry: "mysql-slowlog --summary" }],
  };

  const result = mergeBackupAgentCapabilities([{ type: "MCP", name: "Grafana" }], backup);

  assert.deepEqual(result.importedNames, ["Nginx 深度排查", "慢查询分析"]);
  assert.equal(result.capabilities.length, 3);
  assert.equal(result.skipped, 2);
});

test("mergeBackupAgentCapabilities restores Skill package metadata", () => {
  const backup = {
    schema: "ssh-agent-tool.backup.v1",
    skills: [
      {
        type: "Skill",
        name: "Redis 延迟排查",
        description: "检查 Redis 慢命令",
        entry: "skills/redis-latency.md",
        version: "1.2.0",
        tags: ["redis", "性能"],
        parameters: [{ name: "database", description: "Redis 实例", required: true }],
        commands: [{ label: "慢命令", command: "redis-cli slowlog get 10" }],
        docs: "只读检查 slowlog、client list 和 info memory。",
      },
    ],
    mcp: [],
    cli: [],
  };

  const result = mergeBackupAgentCapabilities([], backup);

  assert.equal(result.capabilities[0].version, "1.2.0");
  assert.deepEqual(result.capabilities[0].tags, ["redis", "性能"]);
  assert.deepEqual(result.capabilities[0].parameters, [{ name: "database", description: "Redis 实例", required: true }]);
  assert.deepEqual(result.capabilities[0].commands, [{ label: "慢命令", command: "redis-cli slowlog get 10" }]);
  assert.equal(result.capabilities[0].docs, "只读检查 slowlog、client list 和 info memory。");
});

test("buildBackupImportPreview summarizes servers capabilities and encrypted credentials", () => {
  const backup = {
    schema: "ssh-agent-tool.backup.v1",
    encryption: { enabled: true },
    hosts: [
      {
        name: "prod-web-01",
        host: "10.0.1.23",
        port: "22",
        user: "root",
        hasSecret: true,
        secret: { schema: "ssh-agent-tool.secret.v1" },
      },
      { name: "prod-cache-01", host: "10.0.1.40", user: "redis" },
      { name: "", host: "" },
    ],
    skills: [{ type: "Skill", name: "Nginx deep check", entry: "skills/nginx.md" }],
    mcp: [{ type: "MCP", name: "Grafana", endpoint: "http://127.0.0.1:3000/mcp" }],
    cli: [{ type: "CLI", name: "mysql slowlog", entry: "mysql-slowlog --summary" }],
  };

  const preview = buildBackupImportPreview(
    { "prod-web-01": sampleServers["prod-web-01"] },
    [{ type: "MCP", name: "Grafana" }],
    backup,
  );

  assert.equal(preview.valid, true);
  assert.equal(preview.encrypted, true);
  assert.equal(preview.credentialCount, 1);
  assert.deepEqual(preview.hostNames, ["prod-web-01-导入", "prod-cache-01"]);
  assert.deepEqual(preview.capabilityNames, ["Nginx deep check", "mysql slowlog"]);
  assert.equal(preview.skippedHosts, 1);
  assert.equal(preview.skippedCapabilities, 1);
  assert.match(preview.summary, /2 台服务器/);
  assert.match(preview.summary, /2 个 Agent 能力/);
  assert.match(preview.summary, /1 个加密凭据/);
});

test("buildBackupImportPreview exposes a stable backup fingerprint", () => {
  const backup = buildBackupPayload({
    servers: sampleServers,
    scope: { hosts: true, sftp: true, skills: false, mcp: false, cli: false, secrets: false },
    exportedAt: "2026-06-26T08:20:00.000Z",
  });
  const historyEntry = buildBackupHistoryEntry({
    payload: backup,
    target: "F:\\Backups\\ssh-agent-tool-backup.json",
    scope: { hosts: true, sftp: true, secrets: false },
  });

  const preview = buildBackupImportPreview({}, [], backup);
  const model = buildBackupImportDialogModel(preview);

  assert.match(preview.fingerprint, /^[a-f0-9]{12}$/);
  assert.equal(preview.fingerprint, historyEntry.fingerprint);
  assert.equal(model.fingerprint, preview.fingerprint);
});

test("buildBackupImportPreview warns when filename fingerprint does not match content", () => {
  const backup = buildBackupPayload({
    servers: sampleServers,
    scope: { hosts: true, sftp: true, skills: false, mcp: false, cli: false, secrets: false },
    exportedAt: "2026-06-26T08:20:00.000Z",
  });
  const matchingFileName = buildBackupFileName(backup);

  const matched = buildBackupImportPreview({}, [], backup, { sourceName: matchingFileName });
  assert.equal(matched.integrityWarnings.some((line) => /文件名.*校验码/.test(line)), false);

  const mismatched = buildBackupImportPreview({}, [], backup, {
    sourceName: matchingFileName.replace(/[a-f0-9]{12}\.json$/, "000000000000.json"),
  });
  const model = buildBackupImportDialogModel(mismatched);

  assert.ok(mismatched.integrityWarnings.some((line) => /文件名.*校验码.*不一致/.test(line)));
  assert.ok(model.risks.some((line) => /文件名.*校验码.*不一致/.test(line)));
});

test("buildBackupImportPreview counts encrypted MCP header secrets", () => {
  const preview = buildBackupImportPreview({}, [], {
    schema: "ssh-agent-tool.backup.v1",
    encryption: { enabled: true },
    manifest: {
      schemaVersion: 1,
      hostCount: 0,
      agentCapabilityCount: 1,
      encryptedCredentialCount: 0,
      sensitiveMcpHeaderCount: 1,
      includesSecrets: true,
    },
    mcp: [
      {
        type: "MCP",
        name: "Internal MCP",
        endpoint: "https://mcp.example.com/rpc",
        headers: [{ name: "Authorization", value: "", sensitive: true, secret: { schema: "ssh-agent-tool.secret.v1" } }],
      },
    ],
  });

  assert.equal(preview.encryptedMcpHeaderCount, 1);
  assert.deepEqual(preview.manifest, {
    schemaVersion: 1,
    hostCount: 0,
    agentCapabilityCount: 1,
    encryptedCredentialCount: 0,
    sensitiveMcpHeaderCount: 1,
    includesSecrets: true,
  });
});

test("buildBackupImportPreview surfaces skipped credential exports", () => {
  const preview = buildBackupImportPreview({}, [], {
    schema: "ssh-agent-tool.backup.v1",
    encryption: { enabled: true },
    manifest: {
      schemaVersion: 1,
      hostCount: 2,
      encryptedCredentialCount: 1,
      skippedCredentialCount: 1,
      includesSecrets: true,
    },
    hosts: [
      {
        name: "prod-web-01",
        host: "10.0.1.23",
        user: "root",
        authType: "密码",
        hasSecret: true,
        secret: { schema: "ssh-agent-tool.secret.v1" },
        secretStatus: "encrypted",
      },
      {
        name: "prod-db-01",
        host: "10.0.1.31",
        user: "root",
        authType: "密码",
        hasSecret: false,
        secretStatus: "unavailable",
      },
    ],
  });
  const model = buildBackupImportDialogModel(preview);

  assert.equal(preview.skippedCredentialCount, 1);
  assert.match(preview.summary, /1 个凭据未导出/);
  assert.deepEqual(
    model.stats.find((item) => item.label === "未导出凭据"),
    { label: "未导出凭据", value: "1" },
  );
  assert.ok(model.risks.some((line) => /1 个凭据未导出/.test(line)));
  assert.ok(model.restoreCheckLines.some((line) => /1 个凭据未导出/.test(line)));
});

test("buildBackupImportPreview reports migration risks and preserved ssh metadata", () => {
  const backup = {
    schema: "ssh-agent-tool.backup.v1",
    encryption: { enabled: false },
    hosts: [
      {
        name: "prod-web-01",
        host: "10.0.1.23",
        port: "22",
        user: "root",
        authType: "redacted",
        proxyJump: "jump@bastion:22",
        identityFile: "~/.ssh/prod_web",
        tags: ["nginx"],
      },
      {
        name: "dev-api-01",
        host: "10.0.2.30",
        user: "deploy",
        authType: "redacted",
      },
      {
        name: "secure-db-01",
        host: "10.0.3.20",
        user: "mysql",
        authType: "password",
        hasSecret: true,
      },
    ],
  };

  const preview = buildBackupImportPreview({ "prod-web-01": sampleServers["prod-web-01"] }, [], backup);

  assert.deepEqual(preview.hostConflicts, [{ sourceName: "prod-web-01", importedName: "prod-web-01-导入", host: "10.0.1.23" }]);
  assert.equal(preview.missingCredentialCount, 2);
  assert.equal(preview.proxyJumpCount, 1);
  assert.equal(preview.identityFileCount, 1);
  assert.match(preview.summary, /1 台重名服务器将自动改名/);
  assert.match(preview.summary, /2 台需要重新绑定凭据/);
});

test("buildBackupImportPreview warns when same-name hosts point to different endpoints", () => {
  const backup = {
    schema: "ssh-agent-tool.backup.v1",
    encryption: { enabled: false },
    hosts: [
      {
        name: "prod-web-01",
        host: "10.9.9.23",
        port: "2222",
        user: "deploy",
        authType: "redacted",
      },
    ],
  };

  const preview = buildBackupImportPreview(
    { "prod-web-01": { ip: "10.0.1.23", port: "22", user: "root" } },
    [],
    backup,
  );
  const model = buildBackupImportDialogModel(preview);

  assert.deepEqual(preview.hostIdentityConflicts, [
    {
      sourceName: "prod-web-01",
      importedName: "prod-web-01-导入",
      existingEndpoint: "root@10.0.1.23:22",
      incomingEndpoint: "deploy@10.9.9.23:2222",
    },
  ]);
  assert.ok(model.risks.some((line) => /同名服务器连接目标不同/.test(line)));
});

test("buildBackupImportPreview summarizes importable port forwards and command snippets", () => {
  const preview = buildBackupImportPreview({}, [], {
    schema: "ssh-agent-tool.backup.v1",
    portForwards: [
      { id: "pf-1", serverName: "prod-web-01", name: "Nginx Admin", localHost: "127.0.0.1", localPort: 18080, remoteHost: "127.0.0.1", remotePort: 80 },
    ],
    commandSnippets: [
      { label: "Disk check", command: "df -hT" },
    ],
  });

  assert.equal(preview.valid, true);
  assert.deepEqual(preview.portForwardPresetNames, ["Nginx Admin"]);
  assert.deepEqual(preview.commandSnippetNames, ["Disk check"]);
  assert.match(preview.summary, /1 .*端口转发/);
  assert.match(preview.summary, /1 .*命令片段/);
  assert.equal(hasBackupImportTargets(preview), true);
});

test("buildBackupImportPreview reports integrity warnings for manifest mismatches", () => {
  const preview = buildBackupImportPreview({}, [], {
    schema: "ssh-agent-tool.backup.v1",
    encryption: { enabled: false },
    manifest: {
      schemaVersion: 1,
      hostCount: 3,
      agentCapabilityCount: 2,
      portForwardPresetCount: 1,
      commandSnippetCount: 1,
      encryptedCredentialCount: 1,
      sensitiveMcpHeaderCount: 1,
      includesSecrets: true,
    },
    hosts: [{ name: "prod-web-01", host: "10.0.1.23" }],
    skills: [],
    mcp: [],
    cli: [],
    portForwards: [],
    commandSnippets: [],
  });

  assert.equal(preview.valid, true);
  assert.ok(preview.integrityWarnings.length >= 4);
  assert.match(preview.integrityWarnings.join("\n"), /清单.*服务器.*3.*实际.*1/);
  assert.match(preview.integrityWarnings.join("\n"), /加密标记.*不一致/);

  const model = buildBackupImportDialogModel(preview);
  assert.ok(model.risks.some((risk) => /清单.*服务器.*实际/.test(risk)));
});

test("buildBackupImportPreview prepares restore diff summary", () => {
  const preview = buildBackupImportPreview(
    { "prod-web-01": sampleServers["prod-web-01"] },
    [{ type: "MCP", name: "Grafana" }],
    {
      schema: "ssh-agent-tool.backup.v1",
      encryption: { enabled: true },
      hosts: [
        { name: "prod-web-01", host: "10.0.1.23", hasSecret: true, secret: { schema: "ssh-agent-tool.secret.v1" } },
        { name: "prod-db-01", host: "10.0.1.31" },
        { name: "", host: "" },
      ],
      skills: [{ type: "Skill", name: "Nginx Check", entry: "skills/nginx.md" }],
      mcp: [{ type: "MCP", name: "Grafana", endpoint: "http://127.0.0.1:3000/mcp" }],
      cli: [{ type: "CLI", name: "Local df", entry: "local:df -h" }],
      portForwards: [{ id: "pf-1", serverName: "prod-web-01", name: "Nginx Admin", localHost: "127.0.0.1", localPort: 18080, remoteHost: "127.0.0.1", remotePort: 80 }],
      commandSnippets: [{ label: "Disk check", command: "df -hT" }],
    },
  );

  assert.deepEqual(preview.diffSummary, {
    serversToAdd: 2,
    serversRenamed: 1,
    agentCapabilitiesToAdd: 2,
    portForwardsToAdd: 1,
    commandSnippetsToAdd: 1,
    encryptedCredentialsAvailable: 1,
    missingCredentialsAfterImport: 1,
    skippedItems: 2,
  });

  const model = buildBackupImportDialogModel(preview);
  assert.ok(model.diffLines.some((line) => /新增服务器 2 台/.test(line)));
  assert.ok(model.diffLines.some((line) => /重名自动改名 1 台/.test(line)));
  assert.ok(model.diffLines.some((line) => /跳过 2 项/.test(line)));
});

test("hasBackupImportTargets accepts backups with only port forwards or snippets", () => {
  assert.equal(hasBackupImportTargets({ hostNames: [], capabilityNames: [], portForwardPresetNames: ["pf"], commandSnippetNames: [] }), true);
  assert.equal(hasBackupImportTargets({ hostNames: [], capabilityNames: [], portForwardPresetNames: [], commandSnippetNames: ["cmd"] }), true);
  assert.equal(hasBackupImportTargets({ hostNames: [], capabilityNames: [], portForwardPresetNames: [], commandSnippetNames: [] }), false);
});

test("buildBackupImportDialogModel prepares Chinese restore choices and preview sections", () => {
  const preview = {
    valid: true,
    encrypted: true,
    manifest: {
      exportedAt: "2026-06-26T01:02:03Z",
      hostCount: 3,
      agentCapabilityCount: 2,
      encryptedCredentialCount: 1,
      sensitiveMcpHeaderCount: 1,
      includesSecrets: true,
    },
    credentialCount: 1,
    hostNames: ["prod-web-01-导入", "prod-db-01", "prod-cache-01"],
    capabilityNames: ["Nginx 巡检", "本地 df"],
    hostConflicts: [{ sourceName: "prod-web-01", importedName: "prod-web-01-导入", host: "10.0.1.23" }],
    missingCredentialCount: 2,
    proxyJumpCount: 1,
    identityFileCount: 1,
    encryptedMcpHeaderCount: 1,
    skippedHosts: 1,
    skippedCapabilities: 1,
    summary: "将导入 3 台服务器、2 个 Agent 能力，包含 1 个加密凭据。",
  };

  const model = buildBackupImportDialogModel(preview);

  assert.equal(model.title, "备份导入预览");
  assert.equal(model.canRestoreSecrets, true);
  assert.equal(model.defaultRestoreMode, "with-secrets");
  assert.deepEqual(model.stats.map((item) => item.label), ["服务器", "Agent 能力", "端口转发", "命令片段", "加密凭据", "敏感 Header"]);
  assert.deepEqual(model.stats.map((item) => item.value), ["3", "2", "0", "0", "1", "1"]);
  assert.deepEqual(model.sections[0], {
    title: "服务器",
    items: ["prod-web-01-导入", "prod-db-01", "prod-cache-01"],
    overflow: 0,
  });
  assert.deepEqual(model.sections[1], {
    title: "Agent 能力",
    items: ["Nginx 巡检", "本地 df"],
    overflow: 0,
  });
  assert.deepEqual(model.risks, [
    "1 台重名服务器会自动改名",
    "2 台服务器导入后需要重新绑定密码/密钥",
    "1 台服务器包含 ProxyJump 配置",
    "1 台服务器包含 IdentityFile 路径",
    "已跳过 1 台服务器、1 个 Agent 能力",
  ]);
  assert.match(model.securityNote, /可以选择同时恢复加密凭据/);
});

test("buildBackupImportDialogModel explains restore readiness before import", () => {
  const model = buildBackupImportDialogModel({
    valid: true,
    encrypted: true,
    manifest: {
      hostCount: 2,
      agentCapabilityCount: 1,
      encryptedCredentialCount: 2,
      sensitiveMcpHeaderCount: 1,
      includesSecrets: true,
    },
    credentialCount: 2,
    hostNames: ["prod-web", "prod-db"],
    capabilityNames: ["Internal MCP"],
    missingCredentialCount: 1,
    encryptedMcpHeaderCount: 1,
  });

  assert.deepEqual(model.restoreCheckLines, [
    "可恢复服务器凭据 2 个，MCP Header 密钥 1 个。",
    "导入后仍有 1 台服务器需要重新绑定密码/密钥。",
    "选择“同时恢复敏感信息”时需要输入备份主密码。",
  ]);
});

test("buildBackupImportDialogModel explains when encrypted secrets are unavailable", () => {
  const model = buildBackupImportDialogModel({
    valid: true,
    encrypted: false,
    manifest: {
      hostCount: 1,
      agentCapabilityCount: 0,
      encryptedCredentialCount: 0,
      sensitiveMcpHeaderCount: 0,
      includesSecrets: false,
    },
    hostNames: ["prod-web"],
    capabilityNames: [],
    missingCredentialCount: 1,
  });

  assert.deepEqual(model.restoreCheckLines, [
    "未检测到可恢复的加密敏感信息。",
    "导入后仍有 1 台服务器需要重新绑定密码/密钥。",
  ]);
});

test("buildBackupImportDialogModel lists host rename conflicts", () => {
  const model = buildBackupImportDialogModel(
    {
      valid: true,
      encrypted: false,
      manifest: { hostCount: 3, agentCapabilityCount: 0 },
      hostNames: ["prod-web-01-导入", "prod-db-01-导入", "prod-cache-01-导入"],
      capabilityNames: [],
      hostConflicts: [
        { sourceName: "prod-web-01", importedName: "prod-web-01-导入", host: "10.0.1.23" },
        { sourceName: "prod-db-01", importedName: "prod-db-01-导入", host: "10.0.1.31" },
        { sourceName: "prod-cache-01", importedName: "prod-cache-01-导入", host: "" },
      ],
    },
    2,
  );

  assert.deepEqual(model.conflictLines, [
    "prod-web-01 -> prod-web-01-导入（10.0.1.23）",
    "prod-db-01 -> prod-db-01-导入（10.0.1.31）",
    "另有 1 台重名服务器会自动改名",
  ]);
});

test("buildBackupImportScopeSummary describes selected import scope and restored secrets", () => {
  const preview = {
    encrypted: true,
    manifest: {
      hostCount: 2,
      agentCapabilityCount: 3,
      portForwardPresetCount: 1,
      commandSnippetCount: 2,
      encryptedCredentialCount: 2,
      sensitiveMcpHeaderCount: 1,
    },
    missingCredentialCount: 1,
  };

  const summary = buildBackupImportScopeSummary(preview, {
    servers: true,
    sftp: true,
    agentCapabilities: true,
    portForwards: false,
    commandSnippets: true,
    restoreSecrets: true,
  });

  assert.deepEqual(summary.lines, [
    "将导入服务器配置 2 台，SFTP 书签随服务器导入。",
    "将导入 Agent 能力 3 个、命令片段 2 个。",
    "不会导入端口转发预设。",
    "将尝试恢复服务器凭据 2 个、MCP Header 密钥 1 个。",
    "预计仍有 1 台服务器需要重新绑定凭据。",
  ]);
  assert.equal(summary.hasImportTarget, true);
  assert.equal(summary.requiresMasterPassword, true);
});

test("buildBackupImportScopeSummary reports skipped restorable credentials for config only imports", () => {
  const summary = buildBackupImportScopeSummary(
    {
      encrypted: true,
      manifest: {
        hostCount: 2,
        agentCapabilityCount: 0,
        encryptedCredentialCount: 2,
        sensitiveMcpHeaderCount: 0,
      },
      missingCredentialCount: 0,
    },
    {
      servers: true,
      sftp: true,
      agentCapabilities: false,
      restoreSecrets: false,
    },
  );

  assert.equal(summary.skippedRestorableServerCredentials, 2);
  assert.equal(summary.skippedRestorableMcpHeaders, 0);
  assert.equal(summary.willRestoreSecrets, false);
  assert.ok(summary.lines.some((line) => /2/.test(line) && /凭据|鍑嵁/.test(line) && /不会|涓嶄細/.test(line)));
  assert.equal(summary.requiresMasterPassword, false);
});

test("buildBackupImportScopeSummary reports config-only import without targets", () => {
  const summary = buildBackupImportScopeSummary(
    {
      encrypted: true,
      manifest: {
        hostCount: 2,
        agentCapabilityCount: 1,
        portForwardPresetCount: 1,
        commandSnippetCount: 1,
        encryptedCredentialCount: 1,
        sensitiveMcpHeaderCount: 1,
      },
      missingCredentialCount: 0,
    },
    {
      servers: false,
      sftp: true,
      agentCapabilities: false,
      portForwards: false,
      commandSnippets: false,
      restoreSecrets: false,
    },
  );

  assert.deepEqual(summary.lines, [
    "未选择任何可导入内容。",
    "不会恢复服务器密码、私钥或 MCP Header 密钥。",
  ]);
  assert.equal(summary.hasImportTarget, false);
  assert.equal(summary.requiresMasterPassword, false);
});

test("buildBackupImportSubmitState only requires password when selected scope can restore secrets", () => {
  assert.deepEqual(
    buildBackupImportSubmitState({
      hasImportTarget: true,
      requiresMasterPassword: false,
    }, ""),
    {
      canSubmit: true,
      requiresMasterPassword: false,
      passwordReady: true,
    },
  );

  assert.deepEqual(
    buildBackupImportSubmitState({
      hasImportTarget: true,
      requiresMasterPassword: true,
    }, "short"),
    {
      canSubmit: false,
      requiresMasterPassword: true,
      passwordReady: false,
    },
  );

  assert.deepEqual(
    buildBackupImportSubmitState({
      hasImportTarget: true,
      requiresMasterPassword: true,
    }, "Backup2026!"),
    {
      canSubmit: true,
      requiresMasterPassword: true,
      passwordReady: true,
    },
  );
});

test("buildBackupImportPlan can import only server configuration", () => {
  const backup = {
    schema: "ssh-agent-tool.backup.v1",
    encryption: { enabled: true },
    hosts: [{ name: "prod-web-01", host: "10.0.1.23", hasSecret: true, secret: { schema: "ssh-agent-tool.secret.v1" } }],
    sftpBookmarks: [{ host: "prod-web-01", paths: ["/var/www/app"] }],
    skills: [{ type: "Skill", name: "Nginx 巡检", entry: "skills/nginx.md" }],
    mcp: [
      {
        type: "MCP",
        name: "Internal MCP",
        endpoint: "https://mcp.example.com/rpc",
        headers: [{ name: "Authorization", sensitive: true, secret: { schema: "ssh-agent-tool.secret.v1" } }],
      },
    ],
    cli: [{ type: "CLI", name: "本地 df", entry: "local:df -h" }],
    portForwards: [{ id: "pf-1", serverName: "prod-web-01", localHost: "127.0.0.1", localPort: 18080, remoteHost: "127.0.0.1", remotePort: 80 }],
  };

  const plan = buildBackupImportPlan(backup, {
    servers: true,
    sftp: true,
    agentCapabilities: false,
    restoreSecrets: true,
  });

  assert.equal(plan.backup.hosts.length, 1);
  assert.equal(plan.backup.sftpBookmarks.length, 1);
  assert.deepEqual(plan.backup.skills, []);
  assert.deepEqual(plan.backup.mcp, []);
  assert.deepEqual(plan.backup.cli, []);
  assert.deepEqual(plan.backup.portForwards, []);
  assert.equal(plan.restoreServerCredentials, true);
  assert.equal(plan.restoreAgentSecrets, false);
});

test("buildBackupImportPlan can import only Agent capabilities without server secrets", () => {
  const backup = {
    schema: "ssh-agent-tool.backup.v1",
    encryption: { enabled: true },
    hosts: [{ name: "prod-web-01", host: "10.0.1.23", hasSecret: true, secret: { schema: "ssh-agent-tool.secret.v1" } }],
    sftpBookmarks: [{ host: "prod-web-01", paths: ["/var/www/app"] }],
    skills: [{ type: "Skill", name: "Nginx 巡检", entry: "skills/nginx.md" }],
    mcp: [
      {
        type: "MCP",
        name: "Internal MCP",
        endpoint: "https://mcp.example.com/rpc",
        headers: [{ name: "Authorization", sensitive: true, secret: { schema: "ssh-agent-tool.secret.v1" } }],
      },
    ],
    cli: [{ type: "CLI", name: "本地 df", entry: "local:df -h" }],
    portForwards: [{ id: "pf-1", serverName: "prod-web-01", localHost: "127.0.0.1", localPort: 18080, remoteHost: "127.0.0.1", remotePort: 80 }],
  };

  const plan = buildBackupImportPlan(backup, {
    servers: false,
    sftp: false,
    agentCapabilities: true,
    restoreSecrets: true,
  });

  assert.deepEqual(plan.backup.hosts, []);
  assert.deepEqual(plan.backup.sftpBookmarks, []);
  assert.equal(plan.backup.skills.length, 1);
  assert.equal(plan.backup.mcp.length, 1);
  assert.equal(plan.backup.cli.length, 1);
  assert.deepEqual(plan.backup.portForwards, []);
  assert.equal(plan.restoreServerCredentials, false);
  assert.equal(plan.restoreAgentSecrets, true);
});

test("buildBackupImportPlan can import only port forward presets", () => {
  const backup = {
    schema: "ssh-agent-tool.backup.v1",
    hosts: [{ name: "prod-web-01", host: "10.0.1.23" }],
    skills: [{ type: "Skill", name: "Nginx 巡检", entry: "skills/nginx.md" }],
    portForwards: [{ id: "pf-1", serverName: "prod-web-01", localHost: "127.0.0.1", localPort: 18080, remoteHost: "127.0.0.1", remotePort: 80 }],
  };

  const plan = buildBackupImportPlan(backup, {
    servers: false,
    sftp: false,
    agentCapabilities: false,
    portForwards: true,
  });

  assert.deepEqual(plan.backup.hosts, []);
  assert.deepEqual(plan.backup.skills, []);
  assert.equal(plan.backup.portForwards.length, 1);
  assert.equal(plan.includePortForwards, true);
});

test("buildBackupImportPlan can import only command snippets", () => {
  const backup = {
    schema: "ssh-agent-tool.backup.v1",
    hosts: [{ name: "prod-web-01", host: "10.0.1.23" }],
    skills: [{ type: "Skill", name: "Nginx 巡检", entry: "skills/nginx.md" }],
    commandSnippets: [{ label: "磁盘检查", command: "df -hT" }],
  };

  const plan = buildBackupImportPlan(backup, {
    servers: false,
    sftp: false,
    agentCapabilities: false,
    portForwards: false,
    commandSnippets: true,
  });

  assert.deepEqual(plan.backup.hosts, []);
  assert.deepEqual(plan.backup.skills, []);
  assert.equal(plan.backup.commandSnippets.length, 1);
  assert.equal(plan.includeCommandSnippets, true);
});

test("buildServerInventoryCsv exports server information without secrets", () => {
  const csv = buildServerInventoryCsv({
    "prod-web-01": {
      ...sampleServers["prod-web-01"],
      credentialRef: "sshcred-prod-web",
      authType: "密码",
      note: "生产 Web, owner ops",
      timeoutSeconds: 25,
      retryCount: 2,
      keepaliveSeconds: 45,
      keepaliveCountMax: 6,
      tags: ["nginx", "重要"],
      trustedHostKey: { type: "ssh-ed25519", sha256: "SHA256:trusted", trustedAt: "2026-06-26T03:20:00.000Z" },
      hostKeyTrust: { status: "trusted", label: "已信任" },
      identityFile: "~/.ssh/prod_web_ed25519",
      proxyJump: "bastion",
      localForwards: [{ localHost: "127.0.0.1", localPort: "18080", remoteHost: "127.0.0.1", remotePort: "80" }],
      remoteForwards: [{ remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" }],
      dynamicForwards: [{ bindHost: "127.0.0.1", bindPort: "1080" }],
      credentialSecret: "DoNotExport!123",
    },
    "dev-empty": {
      ip: "10.0.2.15",
      user: "deploy",
      note: "需要补充凭据",
    },
  });

  assert.match(csv, /^\ufeff服务器名称,主机地址,端口,用户名,分组,认证方式,凭据状态,凭据恢复方式,凭据处理建议,连接超时\(秒\),重试次数,SSH 保活\(秒\),默认目录,命令策略,标签,私钥路径,ProxyJump,LocalForward 数,RemoteForward 数,DynamicForward 数,主机指纹,指纹信任状态,备注/);
  assert.match(csv, /prod-web-01,10\.0\.1\.23,22,root,prod,密码,已绑定凭据,加密恢复,完整备份可恢复到本机加密凭据库,25,2,45,\/var\/www\/app,readonly,nginx; 重要,~\/\.ssh\/prod_web_ed25519,bastion,1,1,1,SHA256:trusted,已信任,"生产 Web, owner ops"/);
  assert.match(csv, /dev-empty,10\.0\.2\.15,22,deploy,,未设置,未绑定凭据,需要补录,导入后需要重新录入密码或选择私钥,10,0,30,,,,,,0,0,0,,未信任,需要补充凭据/);
  assert.match(csv, /LocalForward 数,RemoteForward 数,DynamicForward 数/);
  assert.match(csv, /bastion,1,1,1,SHA256:trusted/);
  assert.doesNotMatch(csv, /DoNotExport|sshcred-prod-web/);
});

test("buildServerInventoryCsv reports credential recovery readiness for migration", () => {
  const csv = buildServerInventoryCsv({
    "prod-password": {
      ip: "10.0.1.23",
      user: "root",
      authType: "密码",
      credentialRef: "sshcred-prod",
    },
    "prod-key-path": {
      ip: "10.0.1.24",
      user: "deploy",
      authType: "私钥",
      identityFile: "~/.ssh/prod_key",
    },
    "prod-agent": {
      ip: "10.0.1.25",
      user: "ops",
      authType: "SSH Agent",
    },
    "prod-empty": {
      ip: "10.0.1.26",
      user: "root",
      authType: "密码",
    },
  });

  assert.match(csv, /凭据恢复方式,凭据处理建议/);
  assert.match(csv, /prod-password[\s\S]*加密恢复[\s\S]*完整备份可恢复到本机加密凭据库/);
  assert.match(csv, /prod-key-path[\s\S]*路径恢复[\s\S]*需要确认私钥文件在新机器上可用/);
  assert.match(csv, /prod-agent[\s\S]*SSH Agent[\s\S]*需要确认 Windows OpenSSH Agent/);
  assert.match(csv, /prod-empty[\s\S]*需要补录[\s\S]*导入后需要重新录入密码或选择私钥/);
  assert.doesNotMatch(csv, /sshcred-prod/);
});

test("buildOpenSshConfigExport writes reusable SSH config without secrets", () => {
  const config = buildOpenSshConfigExport({
    "prod-web-01": {
      ...sampleServers["prod-web-01"],
      port: "2222",
      authType: "私钥",
      identityFile: "~/.ssh/prod_web_ed25519",
      forwardAgent: true,
      proxyJump: "jump@bastion.example.com:2200",
      hostKeyAlias: "prod-web-01.internal",
      timeoutSeconds: 25,
      retryCount: 2,
      keepaliveSeconds: 45,
      keepaliveCountMax: 6,
      tags: ["nginx", "入口"],
      note: "生产 Web 入口\npassword=DoNotExport",
      localForwards: [{ localHost: "127.0.0.1", localPort: "18080", remoteHost: "127.0.0.1", remotePort: "80" }],
      remoteForwards: [{ remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" }],
      dynamicForwards: [{ bindHost: "127.0.0.1", bindPort: "1080" }],
      credentialRef: "sshcred-prod-web",
      password: "DoNotExport!",
      privateKey: "PRIVATE KEY",
    },
    "dev box": {
      ip: "10.0.2.15",
      user: "deploy",
      port: "22",
      timeoutSeconds: 10,
    },
    "invalid-host": {
      user: "root",
    },
  }, { exportedAt: "2026-06-26T10:00:00.000Z" });

  assert.match(config, /^# Generated by SSH Agent Tool/);
  assert.match(config, /# ExportedAt 2026-06-26T10:00:00.000Z/);
  assert.match(config, /Host prod-web-01/);
  assert.match(config, /# Group prod/);
  assert.match(config, /# Tags nginx, 入口/);
  assert.match(config, /# Note 生产 Web 入口 password=\[redacted\]/);
  assert.match(config, /  HostName 10\.0\.1\.23/);
  assert.match(config, /  User root/);
  assert.match(config, /  Port 2222/);
  assert.match(config, /  IdentityFile ~\/\.ssh\/prod_web_ed25519/);
  assert.match(config, /  IdentitiesOnly yes/);
  assert.match(config, /  ForwardAgent yes/);
  assert.match(config, /  ProxyJump jump@bastion\.example\.com:2200/);
  assert.match(config, /  HostKeyAlias prod-web-01\.internal/);
  assert.match(config, /  ConnectTimeout 25/);
  assert.match(config, /  ConnectionAttempts 3/);
  assert.match(config, /  ServerAliveInterval 45/);
  assert.match(config, /  ServerAliveCountMax 6/);
  assert.match(config, /  LocalForward 127\.0\.0\.1:18080 127\.0\.0\.1:80/);
  assert.match(config, /  RemoteForward 127\.0\.0\.1:22022 127\.0\.0\.1:22/);
  assert.match(config, /  DynamicForward 127\.0\.0\.1:1080/);
  assert.match(config, /Host dev-box/);
  assert.match(config, /  HostName 10\.0\.2\.15/);
  assert.doesNotMatch(config, /invalid-host|sshcred-prod-web|DoNotExport|PRIVATE KEY|credentialRef/i);
});
