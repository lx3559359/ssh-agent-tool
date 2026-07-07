import assert from "node:assert/strict";
import test from "node:test";

import {
  batchUpdateCustomServers,
  buildAuthCenterModel,
  buildConnectionCheckReport,
  buildConnectionCheckRepairPlan,
  buildImportFollowupPrompt,
  buildImportReadinessSummary,
  buildServerContextActionModel,
  buildCustomServer,
  buildServerCopyInfo,
  buildServerCopySshCommand,
  buildServerTroubleshootingSummary,
  buildSshSessionLogContext,
  buildVisibleServerMap,
  buildServerProfileMarkdown,
  deleteCustomServer,
  filterServerGroups,
  flattenServerGroupNames,
  getServerAuthStatus,
  hasUsableServerAuth,
  validateSshSessionOpenTarget,
  normalizeConnectionRetries,
  normalizeServerTags,
  normalizeConnectionTimeout,
  parseSshCommandToServerForm,
  revokeHostKeyTrustForServer,
  summarizeBatchServerResults,
  toggleCustomServerFavorite,
  trustHostKeyForServer,
  upsertCustomServer,
  validateServerConnectionForm,
} from "./serverManagement.js";

test("buildServerContextActionModel exposes SSH SFTP edit delete and copy actions", () => {
  const model = buildServerContextActionModel("prod-web", {
    server: {
      ip: "10.0.1.23",
      user: "root",
      credentialRef: "cred-web",
      state: "在线",
    },
    isCustomServer: true,
    session: { sessionId: "sess-1", busy: false },
  });

  assert.equal(model.title, "prod-web");
  assert.deepEqual(
    model.items.filter((item) => !item.separator).map((item) => item.id),
    [
      "connect",
      "open-server-new-terminal-tab",
      "connect-server-new-terminal-tab",
      "interrupt-server-command",
      "reconnect-server-session",
      "disconnect-server-session",
      "open-sftp",
      "refresh-sftp",
      "upload-sftp",
      "test",
      "basic",
      "server-session-logs",
      "server-tool-logs",
      "server-diagnostic-package",
      "server-auth-center",
      "copy-ssh-command",
      "copy-server-info",
      "copy-openssh-config",
      "copy-troubleshooting-summary",
      "toggle-server-favorite",
      "edit",
      "duplicate-server-as-new-host",
      "export",
      "backup-server",
      "delete",
    ],
  );
  assert.equal(model.items.find((item) => item.id === "open-sftp").disabled, false);
  assert.equal(model.items.find((item) => item.id === "upload-sftp").disabled, false);
  assert.equal(model.items.find((item) => item.id === "disconnect-server-session").disabled, false);
  assert.equal(model.items.find((item) => item.id === "copy-openssh-config").label, "复制 OpenSSH Config");
  assert.equal(model.items.find((item) => item.id === "copy-ssh-command").shortcut, "Ctrl+Shift+Y");
  assert.equal(model.items.find((item) => item.id === "toggle-server-favorite").label, "固定服务器");
  assert.equal(model.items.find((item) => item.id === "toggle-server-favorite").disabled, false);
  assert.equal(model.items.find((item) => item.id === "edit").shortcut, "Ctrl+Shift+I");
  assert.equal(model.items.find((item) => item.id === "delete").label, "删除服务器");
  assert.equal(model.items.find((item) => item.id === "delete").shortcut, "Delete");
  assert.equal(model.items.find((item) => item.id === "backup-server").label, "备份此服务器");
});

test("buildServerContextActionModel disables session and SFTP actions when auth is missing", () => {
  const model = buildServerContextActionModel("demo", {
    server: { ip: "10.0.1.23", user: "root", authType: "密码" },
    isCustomServer: false,
    session: {},
  });

  assert.equal(model.items.find((item) => item.id === "connect").disabled, true);
  assert.equal(model.items.find((item) => item.id === "open-sftp").disabled, true);
  assert.equal(model.items.find((item) => item.id === "refresh-sftp").disabled, true);
  assert.equal(model.items.find((item) => item.id === "upload-sftp").disabled, true);
  assert.equal(model.items.find((item) => item.id === "toggle-server-favorite").label, "固定服务器");
  assert.equal(model.items.find((item) => item.id === "toggle-server-favorite").disabled, true);
  assert.equal(model.items.find((item) => item.id === "delete").label, "从列表隐藏");
});

test("buildCustomServer preserves SFTP bookmarks when editing a saved server", () => {
  const built = buildCustomServer(
    {
      name: "prod-web-01",
      host: "10.0.1.23",
      user: "root",
      cwd: "/var/www/app",
      group: "prod",
    },
    { sftpBookmarks: ["/var/www/app/", "/etc/nginx"] },
  );

  assert.deepEqual(built["prod-web-01"].sftpBookmarks, ["/var/www/app", "/etc/nginx"]);
});

test("buildServerContextActionModel can unpin favorite custom servers", () => {
  const model = buildServerContextActionModel("prod-web", {
    server: {
      ip: "10.0.1.23",
      user: "root",
      credentialRef: "cred-web",
      isFavorite: true,
    },
    isCustomServer: true,
  });

  const favoriteAction = model.items.find((item) => item.id === "toggle-server-favorite");
  assert.equal(favoriteAction.label, "取消固定服务器");
  assert.equal(favoriteAction.disabled, false);
});

test("buildServerCopySshCommand creates a reusable ssh command without secrets", () => {
  const command = buildServerCopySshCommand("prod-web", {
    ip: "10.0.1.23",
    port: "22022",
    user: "root",
    password: "DoNotCopy",
    credentialRef: "sshcred-prod",
  });

  assert.equal(command, "ssh -p 22022 root@10.0.1.23");
  assert.doesNotMatch(command, /DoNotCopy|sshcred-prod|password|credential/i);
});

test("buildServerCopySshCommand mirrors timeout retry key and jump settings", () => {
  const command = buildServerCopySshCommand("prod-db", {
    ip: "10.0.1.31",
    port: "2222",
    user: "mysql",
    identityFile: "C:/Users/me/.ssh/prod db",
    proxyJump: "jump user@bastion",
    hostKeyAlias: "prod-db.internal",
    timeoutSeconds: 12,
    retryCount: 2,
    keepaliveSeconds: 45,
    password: "DoNotCopy",
    credentialRef: "sshcred-prod",
  });

  assert.equal(command, "ssh -i 'C:/Users/me/.ssh/prod db' -o IdentitiesOnly=yes -J 'jump user@bastion' -o HostKeyAlias=prod-db.internal -o ConnectTimeout=12 -o ConnectionAttempts=3 -o ServerAliveInterval=45 -o ServerAliveCountMax=3 -p 2222 mysql@10.0.1.31");
  assert.doesNotMatch(command, /DoNotCopy|sshcred-prod|password|credential/i);
});

test("buildServerCopySshCommand preserves SSH agent forwarding", () => {
  const command = buildServerCopySshCommand("prod-web", {
    ip: "10.0.1.23",
    user: "deploy",
    forwardAgent: true,
  });

  assert.equal(command, "ssh -A deploy@10.0.1.23");
});

test("buildServerCopySshCommand preserves imported ServerAliveCountMax", () => {
  const command = buildServerCopySshCommand("prod-db", {
    ip: "10.0.1.31",
    user: "mysql",
    keepaliveSeconds: 45,
    keepaliveCountMax: 6,
  });

  assert.equal(command, "ssh -o ServerAliveInterval=45 -o ServerAliveCountMax=6 mysql@10.0.1.31");
});

test("buildServerCopySshCommand preserves port forwards", () => {
  const command = buildServerCopySshCommand("prod-web", {
    ip: "10.0.1.23",
    user: "deploy",
    localForwards: [{ localHost: "127.0.0.1", localPort: "18080", remoteHost: "10.0.1.23", remotePort: "80" }],
    remoteForwards: [{ remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" }],
    dynamicForwards: [{ bindHost: "127.0.0.1", bindPort: "1080" }],
  });

  assert.equal(command, "ssh -L 127.0.0.1:18080:10.0.1.23:80 -R 127.0.0.1:22022:127.0.0.1:22 -D 127.0.0.1:1080 deploy@10.0.1.23");
});

test("parseSshCommandToServerForm imports a common ssh command into a server draft", () => {
  const result = parseSshCommandToServerForm("ssh -i C:/Users/me/.ssh/prod -J bastion -o HostKeyAlias=prod-web.internal -o ConnectTimeout=24 -o ConnectionAttempts=3 -p 22022 deploy@10.0.1.23");

  assert.deepEqual(result, {
    ok: true,
    form: {
      name: "10.0.1.23",
      host: "10.0.1.23",
      user: "deploy",
      port: "22022",
      group: "SSH 命令导入",
      authType: "私钥",
      identityFile: "C:/Users/me/.ssh/prod",
      proxyJump: "bastion",
      hostKeyAlias: "prod-web.internal",
      timeoutSeconds: "24",
      retryCount: "2",
      keepaliveSeconds: "30",
      cwd: "/home/deploy",
      note: "从 SSH 命令导入，已解析端口、用户、私钥、ProxyJump 和常用连接参数。",
      tags: "ssh-command-import",
    },
  });
});

test("parseSshCommandToServerForm accepts quoted values and host aliases", () => {
  const result = parseSshCommandToServerForm("ssh -i 'C:/Users/me/.ssh/prod db' -o ServerAliveInterval=45 -o ServerAliveCountMax=6 admin@prod-db");

  assert.equal(result.ok, true);
  assert.equal(result.form.name, "prod-db");
  assert.equal(result.form.host, "prod-db");
  assert.equal(result.form.user, "admin");
  assert.equal(result.form.port, "22");
  assert.equal(result.form.identityFile, "C:/Users/me/.ssh/prod db");
  assert.equal(result.form.keepaliveSeconds, "45");
  assert.equal(result.form.keepaliveCountMax, "6");
  assert.equal(result.form.authType, "私钥");
});

test("parseSshCommandToServerForm preserves SSH agent forwarding flags", () => {
  const enabled = parseSshCommandToServerForm("ssh -A -o ForwardAgent=yes deploy@prod-web");
  const disabled = parseSshCommandToServerForm("ssh -A -o ForwardAgent=no deploy@prod-db");

  assert.equal(enabled.ok, true);
  assert.equal(enabled.form.forwardAgent, true);
  assert.equal(disabled.ok, true);
  assert.equal(disabled.form.forwardAgent, false);
});

test("parseSshCommandToServerForm accepts ssh uri targets from cloud consoles", () => {
  const result = parseSshCommandToServerForm("ssh ssh://deploy@example.com:22022");

  assert.equal(result.ok, true);
  assert.equal(result.form.name, "example.com");
  assert.equal(result.form.host, "example.com");
  assert.equal(result.form.user, "deploy");
  assert.equal(result.form.port, "22022");
  assert.equal(result.form.cwd, "/home/deploy");
});

test("parseSshCommandToServerForm accepts lightweight user host port targets", () => {
  const result = parseSshCommandToServerForm("deploy@example.com:22022");

  assert.equal(result.ok, true);
  assert.equal(result.form.name, "example.com");
  assert.equal(result.form.host, "example.com");
  assert.equal(result.form.user, "deploy");
  assert.equal(result.form.port, "22022");
  assert.equal(result.form.cwd, "/home/deploy");
});

test("parseSshCommandToServerForm accepts compact OpenSSH short options", () => {
  const result = parseSshCommandToServerForm("ssh -ldeploy -p2222 -iC:/Users/me/.ssh/prod -Jjump@bastion example.com");

  assert.equal(result.ok, true);
  assert.equal(result.form.host, "example.com");
  assert.equal(result.form.user, "deploy");
  assert.equal(result.form.port, "2222");
  assert.equal(result.form.identityFile, "C:/Users/me/.ssh/prod");
  assert.equal(result.form.proxyJump, "jump@bastion");
});

test("parseSshCommandToServerForm accepts Windows ssh.exe commands", () => {
  const simple = parseSshCommandToServerForm("ssh.exe -p 22022 deploy@example.com");
  const fullPath = parseSshCommandToServerForm('"C:/Windows/System32/OpenSSH/ssh.exe" -i "C:/Users/me/.ssh/prod key" admin@10.0.1.23');

  assert.equal(simple.ok, true);
  assert.equal(simple.form.host, "example.com");
  assert.equal(simple.form.user, "deploy");
  assert.equal(simple.form.port, "22022");
  assert.equal(fullPath.ok, true);
  assert.equal(fullPath.form.host, "10.0.1.23");
  assert.equal(fullPath.form.user, "admin");
  assert.equal(fullPath.form.identityFile, "C:/Users/me/.ssh/prod key");
});

test("parseSshCommandToServerForm uses OpenSSH HostName option as the real host", () => {
  const result = parseSshCommandToServerForm("ssh -o HostName=10.0.1.23 -o User=deploy -o Port=22022 prod-web");

  assert.equal(result.ok, true);
  assert.equal(result.form.name, "prod-web");
  assert.equal(result.form.host, "10.0.1.23");
  assert.equal(result.form.user, "deploy");
  assert.equal(result.form.port, "22022");
});

test("parseSshCommandToServerForm accepts OpenSSH config style option values", () => {
  const result = parseSshCommandToServerForm("ssh -o 'HostName 10.0.1.23' -o 'User deploy' -o 'Port 22022' -o 'ServerAliveCountMax 6' prod-web");

  assert.equal(result.ok, true);
  assert.equal(result.form.name, "prod-web");
  assert.equal(result.form.host, "10.0.1.23");
  assert.equal(result.form.user, "deploy");
  assert.equal(result.form.port, "22022");
  assert.equal(result.form.keepaliveCountMax, "6");
});

test("parseSshCommandToServerForm accepts split OpenSSH option key value pairs", () => {
  const result = parseSshCommandToServerForm("ssh -o HostName 10.0.1.23 -o User deploy -o Port 22022 -o ConnectTimeout 24 -o ServerAliveCountMax 6 prod-web");

  assert.equal(result.ok, true);
  assert.equal(result.form.name, "prod-web");
  assert.equal(result.form.host, "10.0.1.23");
  assert.equal(result.form.user, "deploy");
  assert.equal(result.form.port, "22022");
  assert.equal(result.form.timeoutSeconds, "24");
  assert.equal(result.form.keepaliveCountMax, "6");
});

test("parseSshCommandToServerForm imports OpenSSH port forwards", () => {
  const result = parseSshCommandToServerForm("ssh -L 127.0.0.1:18080:10.0.1.23:80 -R 127.0.0.1:22022:127.0.0.1:22 -D 127.0.0.1:1080 deploy@example.com");

  assert.equal(result.ok, true);
  assert.deepEqual(result.form.localForwards, [
    { localHost: "127.0.0.1", localPort: "18080", remoteHost: "10.0.1.23", remotePort: "80" },
  ]);
  assert.deepEqual(result.form.remoteForwards, [
    { remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" },
  ]);
  assert.deepEqual(result.form.dynamicForwards, [
    { bindHost: "127.0.0.1", bindPort: "1080" },
  ]);
});

test("parseSshCommandToServerForm preserves Windows backslash paths", () => {
  const result = parseSshCommandToServerForm('"C:\\Windows\\System32\\OpenSSH\\ssh.exe" -i "C:\\Users\\me\\.ssh\\prod key" admin@10.0.1.23');

  assert.equal(result.ok, true);
  assert.equal(result.form.host, "10.0.1.23");
  assert.equal(result.form.user, "admin");
  assert.equal(result.form.identityFile, "C:\\Users\\me\\.ssh\\prod key");
});

test("parseSshCommandToServerForm rejects commands that are not usable ssh targets", () => {
  assert.deepEqual(parseSshCommandToServerForm("scp file root@10.0.1.23:/tmp/"), {
    ok: false,
    message: "请粘贴以 ssh 开头的连接命令。",
  });
  assert.equal(parseSshCommandToServerForm("ssh -p 22").ok, false);
});

test("buildServerCopyInfo creates a sanitized one-server connection summary", () => {
  const info = buildServerCopyInfo("prod-web", {
    ip: "10.0.1.23",
    port: "22",
    user: "root",
    group: "生产环境",
    authType: "密码",
    credentialRef: "sshcred-prod",
    password: "DoNotCopy",
    privateKey: "PRIVATE KEY",
    identityFile: "C:/Users/me/.ssh/id_ed25519",
    proxyJump: "bastion",
    timeoutSeconds: 24,
    retryCount: 2,
    cwd: "/var/www/app",
    tags: ["web", "nginx"],
    note: "入口服务",
  });

  assert.match(info, /服务器：prod-web/);
  assert.match(info, /SSH 命令：ssh -i C:\/Users\/me\/\.ssh\/id_ed25519 -o IdentitiesOnly=yes -J bastion -o ConnectTimeout=24 -o ConnectionAttempts=3 root@10\.0\.1\.23/);
  assert.match(info, /认证方式：密码（已绑定凭据）/);
  assert.match(info, /私钥路径：C:\/Users\/me\/\.ssh\/id_ed25519/);
  assert.match(info, /连接超时：24 秒/);
  assert.match(info, /重试次数：2 次/);
  assert.match(info, /安全说明：连接信息不包含密码、私钥内容、模型密钥或本机凭据引用/);
  assert.match(info, /OpenSSH Config：/);
  assert.match(info, /Host prod-web\n  HostName 10\.0\.1\.23\n  User root\n  Port 22\n  ConnectTimeout 24\n  ConnectionAttempts 3\n  ServerAliveInterval 30\n  ServerAliveCountMax 3\n  IdentityFile C:\/Users\/me\/\.ssh\/id_ed25519\n  IdentitiesOnly yes\n  ProxyJump bastion/);
  assert.doesNotMatch(info, /DoNotCopy|PRIVATE KEY|sshcred-prod|API Key|password/i);
});

test("buildServerTroubleshootingSummary creates a redacted SSH troubleshooting clipboard summary", () => {
  const summary = buildServerTroubleshootingSummary("prod-web", {
    ip: "10.0.1.23",
    port: "22022",
    user: "root",
    group: "生产环境",
    authType: "密码",
    credentialRef: "sshcred-prod",
    password: "DoNotCopy",
    privateKey: "PRIVATE KEY",
    identityFile: "C:/Users/me/.ssh/id_ed25519",
    timeoutSeconds: 24,
    retryCount: 2,
    keepaliveSeconds: 45,
    sshDiagnostics: {
      kind: "network",
      title: "连接超时",
      summary: "无法连通 10.0.1.23:22022",
      actions: [{ label: "检查安全组" }, { id: "edit-connection" }],
    },
  });

  assert.match(summary, /SSH 服务器排障摘要/);
  assert.match(summary, /服务器：prod-web/);
  assert.match(summary, /主机：10\.0\.1\.23:22022/);
  assert.match(summary, /认证状态：密码已绑定/);
  assert.match(summary, /复现命令：ssh -i C:\/Users\/me\/\.ssh\/id_ed25519 -o IdentitiesOnly=yes -o ConnectTimeout=24 -o ConnectionAttempts=3 -o ServerAliveInterval=45 -o ServerAliveCountMax=3 -p 22022 root@10\.0\.1\.23/);
  assert.match(summary, /诊断类型：network/);
  assert.match(summary, /诊断标题：连接超时/);
  assert.match(summary, /诊断摘要：无法连通 10\.0\.1\.23:22022/);
  assert.match(summary, /建议动作：检查安全组；edit-connection/);
  assert.doesNotMatch(summary, /DoNotCopy|PRIVATE KEY|sshcred-prod|credentialRef|password|privateKey/i);
});

test("buildSshSessionLogContext keeps useful SSH diagnostics without secrets", () => {
  const context = buildSshSessionLogContext("prod-web", {
    ip: "10.0.1.23",
    port: "2222",
    user: "root",
    authType: "密码",
    timeoutSeconds: 24,
    retryCount: 2,
    keepaliveSeconds: 45,
    proxyJump: "jump@bastion:22",
    identityFile: "C:/Users/me/.ssh/id_ed25519",
    credentialRef: "sshcred-prod",
    password: "DoNotLog",
    privateKey: "PRIVATE KEY",
  });

  assert.deepEqual(context, {
    server: "prod-web",
    host: "10.0.1.23",
    port: 2222,
    user: "root",
    authType: "密码",
    timeoutSeconds: 24,
    retryCount: 2,
    keepaliveSeconds: 45,
    proxyJump: "jump@bastion:22",
    identityFile: "C:/Users/me/.ssh/id_ed25519",
  });
  assert.doesNotMatch(JSON.stringify(context), /DoNotLog|PRIVATE KEY|sshcred-prod|credentialRef|password/i);
});

test("buildAuthCenterModel summarizes encrypted password credential readiness", () => {
  const model = buildAuthCenterModel("prod-web", {
    authType: "密码",
    credentialRef: "cred-web",
    proxyJump: "bastion",
    timeoutSeconds: 20,
    retryCount: 2,
    trustedHostKey: { sha256: "SHA256:abc" },
    hostKeyTrust: { label: "已信任" },
  });

  assert.equal(model.title, "prod-web 认证中心");
  assert.equal(model.ready, true);
  assert.equal(model.status.label, "密码已绑定");
  assert.deepEqual(
    model.summaryItems.map((item) => item.label),
    ["认证方式", "凭据状态", "私钥路径", "ProxyJump", "连接超时", "重试次数", "主机指纹"],
  );
  assert.match(model.guidance[0], /可以直接发起 SSH 连接/);
  assert.equal(model.primaryAction.label, "编辑认证");
});

test("buildAuthCenterModel guides missing SSH credentials", () => {
  const model = buildAuthCenterModel("dev", {
    authType: "密码",
    timeoutSeconds: 10,
    retryCount: 0,
  });

  assert.equal(model.ready, false);
  assert.equal(model.status.tone, "amber");
  assert.match(model.guidance.join(" "), /保存 SSH 密码|选择私钥|SSH Agent/);
});

test("buildAuthCenterModel gives auth-specific missing credential guidance", () => {
  const passwordModel = buildAuthCenterModel("dev-password", {
    authType: "密码",
  });
  const keyModel = buildAuthCenterModel("dev-key", {
    authType: "私钥",
  });

  assert.equal(passwordModel.ready, false);
  assert.equal(passwordModel.status.label, "密码未绑定");
  assert.match(passwordModel.guidance.join(" "), /请保存 SSH 密码/);
  assert.doesNotMatch(passwordModel.guidance.join(" "), /选择私钥|SSH Agent/);

  assert.equal(keyModel.ready, false);
  assert.equal(keyModel.status.label, "私钥未设置");
  assert.match(keyModel.guidance.join(" "), /请选择私钥文件或填写私钥路径/);
  assert.doesNotMatch(keyModel.guidance.join(" "), /保存 SSH 密码|SSH Agent/);
});

test("buildAuthCenterModel treats private key path as usable auth", () => {
  const model = buildAuthCenterModel("db", {
    authType: "私钥",
    identityFile: "~/.ssh/db",
  });

  assert.equal(model.ready, true);
  assert.equal(model.status.label, "私钥路径可用");
  assert.match(model.guidance.join(" "), /~\/.ssh\/db/);
});

test("buildAuthCenterModel treats SSH Agent auth as usable", () => {
  const model = buildAuthCenterModel("agent-host", {
    authType: "SSH Agent",
  });

  assert.equal(model.ready, true);
  assert.equal(model.status.label, "SSH Agent 可用");
  assert.match(model.guidance.join(" "), /Windows OpenSSH Agent/);
});

const baseForm = {
  name: "prod-web",
  host: "10.0.1.23",
  port: "2222",
  user: "root",
  group: "生产环境",
  authType: "密码",
  credentialRef: "sshcred-prod",
  cwd: "/var/www/app",
  note: "入口服务器",
  tags: "web, nginx, entry",
};

test("buildCustomServer creates a usable SSH server record", () => {
  const result = buildCustomServer(baseForm);

  assert.equal(result["prod-web"].ip, "10.0.1.23");
  assert.equal(result["prod-web"].port, "2222");
  assert.equal(result["prod-web"].timeoutSeconds, 10);
  assert.equal(result["prod-web"].retryCount, 0);
  assert.equal(result["prod-web"].hasCredential, true);
  assert.equal(result["prod-web"].files[0].name, "/var/www/app");
  assert.deepEqual(result["prod-web"].tags, ["web", "nginx", "entry"]);
});

test("buildCustomServer uses readable Chinese defaults for new server records", () => {
  const result = buildCustomServer({
    name: "dev-box",
    host: "10.0.2.15",
    user: "devops",
  });
  const server = result["dev-box"];

  assert.equal(server.group, "自定义");
  assert.equal(server.state, "未测试");
  assert.equal(server.authType, "密码");
  assert.equal(server.files[0].meta, "默认目录");
  assert.deepEqual(server.plan, ["测试 SSH 端口连通性", "验证认证方式", "读取系统基础信息", "生成首次巡检建议"]);
  assert.doesNotMatch(JSON.stringify(server), /鑷|鏈|瀵|鐩|杩|楠|璇|鐢|绛/);
});

test("buildCustomServer normalizes legacy modal auth values to readable Chinese", () => {
  const passwordServer = buildCustomServer({ ...baseForm, authType: "password", credentialRef: "cred-web" })["prod-web"];
  const keyServer = buildCustomServer({ ...baseForm, authType: "key", identityFile: "~/.ssh/prod_web" })["prod-web"];

  assert.equal(passwordServer.authType, "密码");
  assert.equal(passwordServer.evidence.find((item) => item.label === "auth")?.value, "密码");
  assert.equal(keyServer.authType, "私钥");
  assert.equal(keyServer.identityFile, "~/.ssh/prod_web");
});

test("validateServerConnectionForm returns actionable errors before saving a SSH server", () => {
  assert.deepEqual(validateServerConnectionForm(baseForm, ["prod-db"], "").ok, true);

  assert.deepEqual(validateServerConnectionForm({ ...baseForm, name: "" }, [], ""), {
    ok: false,
    field: "name",
    message: "请填写连接名称。",
  });
  assert.equal(validateServerConnectionForm({ ...baseForm, host: "" }, [], "").field, "host");
  assert.equal(validateServerConnectionForm({ ...baseForm, port: "70000" }, [], "").field, "port");
  assert.equal(validateServerConnectionForm({ ...baseForm, timeoutSeconds: "2" }, [], "").field, "timeoutSeconds");
  assert.equal(validateServerConnectionForm({ ...baseForm, retryCount: "9" }, [], "").field, "retryCount");
  assert.equal(validateServerConnectionForm({ ...baseForm, keepaliveCountMax: "11" }, [], "").field, "keepaliveCountMax");
  assert.equal(
    validateServerConnectionForm({ ...baseForm, authType: "私钥", identityFile: "", credentialSecret: "", credentialRef: "" }, [], "").field,
    "identityFile",
  );
  assert.equal(
    validateServerConnectionForm({ ...baseForm, authType: "key", identityFile: "", credentialSecret: "", credentialRef: "" }, [], "").field,
    "identityFile",
  );
});

test("validateSshSessionOpenTarget blocks missing host user or auth before opening SSH", () => {
  assert.deepEqual(validateSshSessionOpenTarget({ ip: "10.0.1.23", user: "root", credentialRef: "cred-web" }), { ok: true, message: "" });
  assert.deepEqual(validateSshSessionOpenTarget({ ip: "", user: "root", credentialRef: "cred-web" }), {
    ok: false,
    field: "host",
    message: "当前服务器缺少主机地址，请先编辑连接并填写主机/IP。",
  });
  assert.equal(validateSshSessionOpenTarget({ ip: "10.0.1.23", user: "", credentialRef: "cred-web" }).field, "user");
  assert.equal(validateSshSessionOpenTarget({ ip: "10.0.1.23", user: "root", credentialRef: "" }).field, "auth");
});

test("validateServerConnectionForm blocks duplicate names but allows editing the current name", () => {
  assert.deepEqual(validateServerConnectionForm(baseForm, ["prod-web"], "").field, "name");
  assert.deepEqual(validateServerConnectionForm(baseForm, ["prod-web"], "prod-web").ok, true);
});

test("buildCustomServer stores normalized connection timeout and retry count", () => {
  const result = buildCustomServer({ ...baseForm, timeoutSeconds: "35", retryCount: "2" });

  assert.equal(result["prod-web"].timeoutSeconds, 35);
  assert.equal(result["prod-web"].retryCount, 2);
});

test("buildCustomServer stores normalized SSH keepalive interval", () => {
  const result = buildCustomServer({ ...baseForm, keepaliveSeconds: "45" });

  assert.equal(result["prod-web"].keepaliveSeconds, 45);
});

test("buildCustomServer preserves imported port forward metadata", () => {
  const result = buildCustomServer({
    ...baseForm,
    localForwards: [{ localHost: "127.0.0.1", localPort: "18080", remoteHost: "10.0.1.23", remotePort: "80" }],
    remoteForwards: [{ remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" }],
    dynamicForwards: [{ bindHost: "127.0.0.1", bindPort: "1080" }],
  });

  assert.deepEqual(result["prod-web"].localForwards, [
    { localHost: "127.0.0.1", localPort: "18080", remoteHost: "10.0.1.23", remotePort: "80" },
  ]);
  assert.deepEqual(result["prod-web"].remoteForwards, [
    { remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" },
  ]);
  assert.deepEqual(result["prod-web"].dynamicForwards, [
    { bindHost: "127.0.0.1", bindPort: "1080" },
  ]);
});

test("buildCustomServer preserves identity file path metadata", () => {
  const result = buildCustomServer({ ...baseForm, authType: "私钥", identityFile: "~/.ssh/prod_web" });

  assert.equal(result["prod-web"].identityFile, "~/.ssh/prod_web");
});

test("buildCustomServer preserves proxy jump metadata", () => {
  const result = buildCustomServer({ ...baseForm, proxyJump: "bastion" });

  assert.equal(result["prod-web"].proxyJump, "bastion");
});

test("buildCustomServer preserves host key alias metadata", () => {
  const result = buildCustomServer({ ...baseForm, hostKeyAlias: "prod-web.internal" });

  assert.equal(result["prod-web"].hostKeyAlias, "prod-web.internal");
});

test("buildCustomServer preserves SSH agent forwarding metadata", () => {
  const result = buildCustomServer({ ...baseForm, forwardAgent: true });

  assert.equal(result["prod-web"].forwardAgent, true);
  assert.ok(result["prod-web"].evidence.some((item) => item.label === "forwardAgent" && item.value === "yes"));
});

test("buildCustomServer stores favorite metadata for pinned servers", () => {
  const result = buildCustomServer({ ...baseForm, isFavorite: true });

  assert.equal(result["prod-web"].isFavorite, true);
});

test("upsertCustomServer preserves existing favorite state when form omits it", () => {
  const existing = buildCustomServer({ ...baseForm, isFavorite: true })["prod-web"];
  const current = { "prod-web": existing };

  const result = upsertCustomServer(current, "prod-web", {
    ...baseForm,
    host: "10.0.1.25",
  });

  assert.equal(result.servers["prod-web"].isFavorite, true);
});

test("upsertCustomServer preserves existing identity file when form omits it", () => {
  const existing = buildCustomServer({ ...baseForm, authType: "私钥", identityFile: "~/.ssh/prod_web" })["prod-web"];
  const current = { "prod-web": existing };

  const result = upsertCustomServer(current, "prod-web", {
    ...baseForm,
    authType: "私钥",
    host: "10.0.1.25",
  });

  assert.equal(result.servers["prod-web"].identityFile, "~/.ssh/prod_web");
});

test("upsertCustomServer preserves existing proxy jump when form omits it", () => {
  const existing = buildCustomServer({ ...baseForm, proxyJump: "bastion" })["prod-web"];
  const current = { "prod-web": existing };

  const result = upsertCustomServer(current, "prod-web", {
    ...baseForm,
    host: "10.0.1.25",
  });

  assert.equal(result.servers["prod-web"].proxyJump, "bastion");
});

test("normalizeConnectionTimeout clamps invalid and extreme values", () => {
  assert.equal(normalizeConnectionTimeout(""), 10);
  assert.equal(normalizeConnectionTimeout("2"), 3);
  assert.equal(normalizeConnectionTimeout("120"), 60);
  assert.equal(normalizeConnectionTimeout("18"), 18);
});

test("normalizeConnectionRetries clamps invalid and extreme values", () => {
  assert.equal(normalizeConnectionRetries(""), 0);
  assert.equal(normalizeConnectionRetries("-1"), 0);
  assert.equal(normalizeConnectionRetries("9"), 3);
  assert.equal(normalizeConnectionRetries("2"), 2);
});

test("buildCustomServer clamps invalid and extreme SSH keepalive intervals", () => {
  assert.equal(buildCustomServer({ ...baseForm, keepaliveSeconds: "" })["prod-web"].keepaliveSeconds, 30);
  assert.equal(buildCustomServer({ ...baseForm, keepaliveSeconds: "0" })["prod-web"].keepaliveSeconds, 0);
  assert.equal(buildCustomServer({ ...baseForm, keepaliveSeconds: "5" })["prod-web"].keepaliveSeconds, 10);
  assert.equal(buildCustomServer({ ...baseForm, keepaliveSeconds: "900" })["prod-web"].keepaliveSeconds, 300);
});

test("normalizeServerTags accepts comma separated text and removes duplicates", () => {
  assert.deepEqual(normalizeServerTags(" web, nginx，entry, web "), ["web", "nginx", "entry"]);
});

test("upsertCustomServer renames a server and removes the old key", () => {
  const current = { "old-web": buildCustomServer({ ...baseForm, name: "old-web" })["old-web"] };

  const result = upsertCustomServer(current, "old-web", { ...baseForm, name: "new-web", host: "10.0.1.24" });

  assert.equal(result.name, "new-web");
  assert.equal(result.servers["old-web"], undefined);
  assert.equal(result.servers["new-web"].ip, "10.0.1.24");
  assert.equal(result.servers["new-web"].credentialRef, "sshcred-prod");
});

test("upsertCustomServer preserves existing credential when form has no new credential ref", () => {
  const existing = buildCustomServer(baseForm)["prod-web"];
  const current = { "prod-web": existing };

  const result = upsertCustomServer(current, "prod-web", {
    ...baseForm,
    host: "10.0.1.25",
    credentialRef: "",
  });

  assert.equal(result.servers["prod-web"].ip, "10.0.1.25");
  assert.equal(result.servers["prod-web"].credentialRef, "sshcred-prod");
});

test("deleteCustomServer removes only the requested custom server", () => {
  const current = {
    "prod-web": buildCustomServer(baseForm)["prod-web"],
    "prod-db": buildCustomServer({ ...baseForm, name: "prod-db", host: "10.0.1.31" })["prod-db"],
  };

  const result = deleteCustomServer(current, "prod-web");

  assert.equal(result.deleted, true);
  assert.equal(result.servers["prod-web"], undefined);
  assert.equal(result.servers["prod-db"].ip, "10.0.1.31");
});

test("buildVisibleServerMap hides builtin examples while keeping custom overrides", () => {
  const builtin = {
    "prod-web": { ip: "10.0.1.23", group: "生产环境" },
    "prod-db": { ip: "10.0.1.31", group: "生产环境" },
  };
  const custom = {
    "prod-web": buildCustomServer({ ...baseForm, name: "prod-web", host: "10.0.9.23" })["prod-web"],
  };

  const result = buildVisibleServerMap(builtin, custom, ["prod-web", "prod-db", "missing"]);

  assert.equal(result["prod-web"].ip, "10.0.9.23");
  assert.equal(result["prod-db"], undefined);
});

test("toggleCustomServerFavorite updates only custom servers", () => {
  const current = {
    "prod-web": buildCustomServer(baseForm)["prod-web"],
  };

  const favorite = toggleCustomServerFavorite(current, "prod-web", true);
  assert.equal(favorite.updated, true);
  assert.equal(favorite.servers["prod-web"].isFavorite, true);

  const skipped = toggleCustomServerFavorite(favorite.servers, "builtin-demo", true);
  assert.equal(skipped.updated, false);
  assert.equal(skipped.servers["prod-web"].isFavorite, true);
});

test("trustHostKeyForServer stores the current host key for custom servers", () => {
  const current = {
    "prod-web": buildCustomServer(baseForm)["prod-web"],
  };
  const hostKey = { type: "ssh-ed25519", sha256: "SHA256:abc123" };

  const result = trustHostKeyForServer(current, "prod-web", hostKey, "2026-06-26T03:20:00.000Z");

  assert.equal(result.trusted, true);
  assert.deepEqual(result.servers["prod-web"].trustedHostKey, {
    type: "ssh-ed25519",
    sha256: "SHA256:abc123",
    trustedAt: "2026-06-26T03:20:00.000Z",
  });
});

test("trustHostKeyForServer skips missing servers or empty host keys", () => {
  const current = {
    "prod-web": buildCustomServer(baseForm)["prod-web"],
  };

  assert.equal(trustHostKeyForServer(current, "missing", { type: "ssh-ed25519", sha256: "SHA256:abc123" }).trusted, false);
  assert.equal(trustHostKeyForServer(current, "prod-web", {}).trusted, false);
});

test("revokeHostKeyTrustForServer removes trusted fingerprint without losing current host key", () => {
  const current = {
    "prod-web": {
      ...buildCustomServer(baseForm)["prod-web"],
      hostKey: { type: "ssh-ed25519", sha256: "SHA256:current" },
      trustedHostKey: { type: "ssh-ed25519", sha256: "SHA256:current", trustedAt: "2026-06-26T03:20:00.000Z" },
      hostKeyTrust: { status: "trusted", label: "已信任", tone: "green" },
      evidence: [
        { label: "ssh", value: "SSH 服务可达" },
        { label: "主机指纹", value: "ssh-ed25519 SHA256:current" },
        { label: "指纹状态", value: "已信任：主机指纹与已信任记录一致。" },
      ],
    },
  };

  const result = revokeHostKeyTrustForServer(current, "prod-web");

  assert.equal(result.revoked, true);
  assert.equal(result.servers["prod-web"].trustedHostKey, undefined);
  assert.deepEqual(result.servers["prod-web"].hostKey, { type: "ssh-ed25519", sha256: "SHA256:current" });
  assert.equal(result.servers["prod-web"].hostKeyTrust.status, "untrusted");
  assert.equal(result.servers["prod-web"].hostKeyTrust.label, "未信任");
  assert.deepEqual(result.servers["prod-web"].evidence.find((item) => item.label === "指纹状态"), {
    label: "指纹状态",
    value: "未信任：已撤销本工具保存的信任记录，请重新核对后再信任。",
  });
});

test("batchUpdateCustomServers updates only selected custom servers and reports skipped names", () => {
  const current = {
    "import-web": buildCustomServer({ ...baseForm, name: "import-web", group: "SSH 配置导入", tags: "web" })["import-web"],
    "import-db": buildCustomServer({ ...baseForm, name: "import-db", host: "10.0.1.31", group: "SSH 配置导入", tags: "db" })["import-db"],
  };

  const result = batchUpdateCustomServers(current, ["import-web", "builtin-demo", "import-db"], {
    group: "生产环境",
    tags: "prod, imported",
    policy: "生产只读策略",
  });

  assert.equal(result.updated, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.skippedNames, ["builtin-demo"]);
  assert.equal(result.servers["import-web"].group, "生产环境");
  assert.equal(result.servers["import-web"].policy, "生产只读策略");
  assert.deepEqual(result.servers["import-db"].tags, ["prod", "imported"]);
});

test("batchUpdateCustomServers leaves fields unchanged when patch values are blank", () => {
  const current = {
    "import-web": buildCustomServer({ ...baseForm, name: "import-web", group: "SSH 配置导入", policy: "默认确认策略", tags: "web" })["import-web"],
  };

  const result = batchUpdateCustomServers(current, ["import-web"], {
    group: "",
    tags: "",
    policy: "生产确认策略",
  });

  assert.equal(result.updated, 1);
  assert.equal(result.servers["import-web"].group, "SSH 配置导入");
  assert.deepEqual(result.servers["import-web"].tags, ["web"]);
  assert.equal(result.servers["import-web"].policy, "生产确认策略");
});

test("filterServerGroups searches server identity fields and groups matches", () => {
  const servers = {
    "prod-web": {
      ip: "10.0.1.23",
      user: "root",
      group: "prod",
      state: "online",
      note: "entry server",
      tags: ["web", "nginx"],
    },
    "prod-db": {
      ip: "10.0.1.31",
      user: "mysql",
      group: "prod",
      state: "warning",
      note: "database",
      tags: ["mysql"],
    },
    "dev-docker": {
      ip: "10.0.2.15",
      user: "devops",
      group: "dev",
      state: "offline",
      note: "container lab",
      tags: ["docker"],
    },
  };

  const result = filterServerGroups(servers, { query: "nginx", status: "全部" });

  assert.deepEqual(result, [
    {
      group: "prod",
      servers: [["prod-web", servers["prod-web"]]],
    },
  ]);
});

test("filterServerGroups filters by status while preserving group order", () => {
  const servers = {
    "prod-web": { ip: "10.0.1.23", user: "root", group: "prod", state: "在线", tags: ["web"] },
    "prod-db": { ip: "10.0.1.31", user: "mysql", group: "prod", state: "警告", tags: ["mysql"] },
    "dev-docker": { ip: "10.0.2.15", user: "devops", group: "dev", state: "离线", tags: ["docker"] },
  };

  const result = filterServerGroups(servers, { query: "", status: "警告" });

  assert.deepEqual(result, [
    {
      group: "prod",
      servers: [["prod-db", servers["prod-db"]]],
    },
  ]);
});

test("filterServerGroups filters by credential binding state", () => {
  const servers = {
    "prod-web": { ip: "10.0.1.23", user: "root", group: "prod", state: "在线", authType: "密码", credentialRef: "cred-web" },
    "prod-db": { ip: "10.0.1.31", user: "mysql", group: "prod", state: "警告", authType: "私钥", credentialRef: "", identityFile: "~/.ssh/db" },
    "dev": { ip: "10.0.2.15", user: "devops", group: "dev", state: "离线", authType: "SSH Agent" },
  };

  const bound = filterServerGroups(servers, { authStatus: "已绑定" });
  const missing = filterServerGroups(servers, { authStatus: "未绑定" });

  assert.deepEqual(flattenServerGroupNames(bound), ["prod-web", "prod-db", "dev"]);
  assert.deepEqual(flattenServerGroupNames(missing), []);
});

test("filterServerGroups sorts favorite servers first inside each group", () => {
  const servers = {
    "prod-web": { ip: "10.0.1.23", user: "root", group: "prod", state: "online", tags: ["web"] },
    "prod-db": { ip: "10.0.1.31", user: "mysql", group: "prod", state: "online", tags: ["db"], isFavorite: true },
    "prod-cache": { ip: "10.0.1.40", user: "redis", group: "prod", state: "online", tags: ["cache"], isFavorite: true },
    "dev-box": { ip: "10.0.2.15", user: "devops", group: "dev", state: "online", tags: ["dev"] },
  };

  const result = filterServerGroups(servers);

  assert.deepEqual(flattenServerGroupNames(result), ["prod-db", "prod-cache", "prod-web", "dev-box"]);
});

test("getServerAuthStatus summarizes credential binding without exposing secrets", () => {
  assert.deepEqual(getServerAuthStatus({ authType: "私钥", credentialRef: "cred-1" }), {
    label: "私钥已绑定",
    state: "已绑定",
    tone: "green",
  });
  assert.deepEqual(getServerAuthStatus({ authType: "密码", credentialRef: "" }), {
    label: "密码未绑定",
    state: "未绑定",
    tone: "amber",
  });
  assert.deepEqual(getServerAuthStatus({ authType: "私钥", credentialRef: "", identityFile: "" }), {
    label: "私钥未设置",
    state: "未绑定",
    tone: "amber",
  });
  assert.deepEqual(getServerAuthStatus({ authType: "私钥", credentialRef: "", identityFile: "~/.ssh/prod" }), {
    label: "私钥路径可用",
    state: "已绑定",
    tone: "green",
  });
  assert.deepEqual(getServerAuthStatus({ authType: "SSH Agent", credentialRef: "" }), {
    label: "SSH Agent 可用",
    state: "已绑定",
    tone: "green",
  });
});

test("hasUsableServerAuth accepts encrypted credentials or identity file paths", () => {
  assert.equal(hasUsableServerAuth({ credentialRef: "cred-1" }), true);
  assert.equal(hasUsableServerAuth({ authType: "私钥", identityFile: "~/.ssh/prod" }), true);
  assert.equal(hasUsableServerAuth({ authType: "SSH Agent" }), true);
  assert.equal(hasUsableServerAuth({ authType: "密码", identityFile: "~/.ssh/prod" }), false);
  assert.equal(hasUsableServerAuth({ authType: "私钥", identityFile: "" }), false);
});

test("flattenServerGroupNames returns current filtered server names in display order", () => {
  const groups = [
    { group: "prod", servers: [["prod-web", {}], ["prod-db", {}]] },
    { group: "dev", servers: [["dev-docker", {}]] },
  ];

  assert.deepEqual(flattenServerGroupNames(groups), ["prod-web", "prod-db", "dev-docker"]);
});

test("summarizeBatchServerResults counts ok failed and skipped results", () => {
  const summary = summarizeBatchServerResults([
    { name: "prod-web", status: "ok" },
    { name: "prod-db", status: "failed" },
    { name: "dev-docker", status: "skipped" },
  ]);

  assert.deepEqual(summary, {
    total: 3,
    ok: 1,
    failed: 1,
    skipped: 1,
  });
});

test("buildImportFollowupPrompt prepares Chinese actions for newly imported servers", () => {
  const servers = {
    "prod-web-01": { ip: "10.0.1.23" },
    "prod-db-01": { ip: "10.0.1.31" },
  };

  const prompt = buildImportFollowupPrompt({
    source: "backup",
    importedNames: ["prod-web-01", "missing", "prod-web-01", "prod-db-01"],
    servers,
  });

  assert.equal(prompt.visible, true);
  assert.deepEqual(prompt.targetNames, ["prod-web-01", "prod-db-01"]);
  assert.equal(prompt.title, "备份导入后校验");
  assert.match(prompt.message, /已导入 2 台服务器/);
  assert.deepEqual(prompt.actions.map((item) => item.label), ["测试本次导入", "读取基础信息", "加入 Agent 巡检"]);
});

test("buildImportReadinessSummary classifies imported servers before first test", () => {
  const servers = {
    "prod-web-01": { ip: "10.0.1.23", port: "22", authType: "密码", credentialRef: "cred-web" },
    "prod-db-01": { ip: "10.0.1.31", port: "2222", authType: "私钥", identityFile: "~/.ssh/prod-db", proxyJump: "bastion" },
    "prod-cache-01": { ip: "10.0.1.40", port: "22", authType: "密码" },
    "broken": { ip: "", port: "70000", authType: "密码" },
  };

  const summary = buildImportReadinessSummary(["prod-web-01", "prod-db-01", "prod-cache-01", "broken", "missing"], servers);

  assert.deepEqual(summary, {
    total: 4,
    ready: 2,
    missingAuth: 2,
    invalidAddress: 1,
    invalidPort: 1,
    proxyJump: 1,
    identityFile: 1,
    readyNames: ["prod-web-01", "prod-db-01"],
    needsAttention: ["prod-cache-01", "broken"],
    message: "预检：4 台服务器，可直接测试 2 台，缺少认证 2 台，地址异常 1 台，端口异常 1 台，包含 ProxyJump 1 台，包含私钥路径 1 台。",
  });
});

test("buildImportFollowupPrompt hides itself when no imported server can be found", () => {
  const prompt = buildImportFollowupPrompt({
    source: "ssh-config",
    importedNames: ["missing"],
    servers: {},
  });

  assert.equal(prompt.visible, false);
  assert.deepEqual(prompt.targetNames, []);
});

test("buildConnectionCheckReport exports readable markdown without credential references", () => {
  const report = buildConnectionCheckReport({
    title: "批量连接校验报告",
    generatedAt: "2026-06-26T08:00:00.000Z",
    servers: {
      "prod-web": { ip: "10.0.1.23", port: "22", user: "root", group: "生产", credentialRef: "sshcred-secret" },
      "prod-db": { ip: "10.0.1.31", port: "2222", user: "mysql", group: "生产" },
    },
    results: [
      { name: "prod-web", status: "ok", latency: "18ms", message: "SSH 端口可达" },
      { name: "prod-db", status: "failed", latency: "--", message: "连接超时" },
      { name: "missing", status: "skipped", message: "服务器不存在" },
    ],
  });

  assert.match(report, /^# 批量连接校验报告/);
  assert.match(report, /生成时间：2026-06-26T08:00:00.000Z/);
  assert.match(report, /总数 3，成功 1，失败 1，跳过 1/);
  assert.match(report, /\| prod-web \| 10\.0\.1\.23 \| 22 \| root \| 生产 \| 成功 \| 18ms \| SSH 端口可达 \|/);
  assert.match(report, /\| prod-db \| 10\.0\.1\.31 \| 2222 \| mysql \| 生产 \| 失败 \| -- \| 连接超时 \|/);
  assert.doesNotMatch(report, /sshcred-secret|password|credentialRef/i);
});

test("buildConnectionCheckRepairPlan groups failed checks into actionable repairs", () => {
  const plan = buildConnectionCheckRepairPlan({
    servers: {
      "prod-web": { ip: "10.0.1.23", port: "22", user: "root", credentialRef: "cred-web" },
      "prod-db": { ip: "10.0.1.31", port: "2222", user: "mysql" },
      "prod-cache": { ip: "10.0.1.40", port: "22", user: "cache", hostKey: { sha256: "SHA256:abc" } },
      "prod-dns": { host: "app.internal", port: "22", user: "deploy" },
      "prod-handshake": { ip: "10.0.1.41", port: "22", user: "ops" },
      "prod-legacy": { ip: "10.0.1.42", port: "22", user: "legacy" },
      "prod-key": { ip: "10.0.1.43", port: "22", user: "deploy", authType: "私钥" },
      "prod-agent": { ip: "10.0.1.44", port: "22", user: "ops", authType: "SSH Agent" },
    },
    results: [
      { name: "prod-web", status: "ok", message: "SSH port reachable" },
      { name: "prod-db", status: "failed", message: "Permission denied (publickey,password)" },
      { name: "prod-cache", status: "failed", message: "REMOTE HOST IDENTIFICATION HAS CHANGED" },
      { name: "prod-dns", status: "failed", message: "Could not resolve hostname app.internal" },
      { name: "prod-handshake", status: "failed", message: "kex_exchange_identification: Connection reset by peer" },
      { name: "prod-legacy", status: "failed", message: "Unable to negotiate: no matching host key type found" },
      { name: "prod-key", status: "failed", message: "WARNING: UNPROTECTED PRIVATE KEY FILE! This private key will be ignored." },
      { name: "prod-agent", status: "failed", message: "Too many authentication failures" },
      { name: "missing", status: "skipped", message: "missing" },
    ],
  });

  assert.equal(plan.visible, true);
  assert.deepEqual(plan.summary, { total: 9, failed: 7, auth: 3, network: 2, hostKey: 1, algorithm: 1, unknown: 0 });
  assert.deepEqual(plan.rows.map((row) => row.name), ["prod-db", "prod-cache", "prod-dns", "prod-handshake", "prod-legacy", "prod-key", "prod-agent"]);
  assert.deepEqual(plan.rows[0].actions.map((action) => action.target), ["auth-center", "server-editor", "connection-test", "tool-logs", "diagnostic-package"]);
  assert.deepEqual(plan.rows[1].actions.map((action) => action.target), ["host-key-trust", "connection-test", "agent-diagnostic", "tool-logs", "diagnostic-package"]);
  assert.equal(plan.rows[2].actions[0].label, "检查主机名/DNS");
  assert.equal(plan.rows[3].actions[0].label, "检查 SSH 服务/限制");
  assert.equal(plan.rows[4].kind, "algorithm");
  assert.equal(plan.rows[5].actions[0].label, "检查私钥文件");
  assert.equal(plan.rows[6].actions[0].label, "检查 SSH Agent");
  assert.deepEqual(plan.primaryActions.map((action) => action.target), ["auth-center", "agent-diagnostic", "connection-report"]);
});

test("buildServerProfileMarkdown exports a sanitized SSH server dossier", () => {
  const report = buildServerProfileMarkdown({
    generatedAt: "2026-06-26T09:00:00.000Z",
    servers: {
      "prod-web": {
        ip: "10.0.1.23",
        port: "22",
        user: "root",
        group: "prod",
        state: "online",
        latency: "18ms",
        authType: "密码",
        credentialRef: "sshcred-secret",
        password: "DoNotExport",
        privateKey: "PRIVATE KEY",
        cwd: "/var/www/app",
        timeoutSeconds: 12,
        retryCount: 2,
        keepaliveSeconds: 45,
        policy: "生产只读策略",
        tags: ["web", "nginx"],
        proxyJump: "bastion",
        localForwards: [{ localHost: "127.0.0.1", localPort: "18080", remoteHost: "127.0.0.1", remotePort: "80" }],
        remoteForwards: [{ remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" }],
        dynamicForwards: [{ bindHost: "127.0.0.1", bindPort: "1080" }],
        note: "入口服务器",
        trustedHostKey: { type: "ssh-ed25519", sha256: "SHA256:abc123", trustedAt: "2026-06-26T08:30:00.000Z" },
        files: [
          { type: "folder", name: "/var/www/app", meta: "默认目录" },
          { type: "file", name: "/var/log/nginx/error.log", meta: "错误日志" },
        ],
      },
      "dev-box": {
        ip: "10.0.2.15",
        user: "devops",
        authType: "密码",
      },
    },
    latestConnectionCheck: {
      generatedAt: "2026-06-26T08:58:00.000Z",
      results: [
        { name: "prod-web", status: "ok", latency: "17ms", message: "SSH 端口可达" },
        { name: "dev-box", status: "failed", latency: "--", message: "连接超时" },
      ],
    },
  });

  assert.match(report, /^# SSH 服务器连接档案/);
  assert.match(report, /生成时间：2026-06-26T09:00:00.000Z/);
  assert.match(report, /服务器总数 2，已绑定认证 1，未绑定认证 1/);
  assert.match(report, /## prod-web/);
  assert.match(report, /\| 主机地址 \| 10\.0\.1\.23 \|/);
  assert.match(report, /\| SSH 保活 \| 45 秒 \|/);
  assert.match(report, /\| SSH 命令 \| `ssh -J bastion -o ConnectTimeout=12 -o ConnectionAttempts=3 -o ServerAliveInterval=45 -o ServerAliveCountMax=3 -L 127\.0\.0\.1:18080:127\.0\.0\.1:80 -R 127\.0\.0\.1:22022:127\.0\.0\.1:22 -D 127\.0\.0\.1:1080 root@10\.0\.1\.23` \|/);
  assert.match(report, /\| LocalForward \| 127\.0\.0\.1:18080 -> 127\.0\.0\.1:80 \|/);
  assert.match(report, /\| RemoteForward \| 127\.0\.0\.1:22022 -> 127\.0\.0\.1:22 \|/);
  assert.match(report, /\| DynamicForward \| 127\.0\.0\.1:1080 \|/);
  assert.match(report, /\| 最近校验 \| 成功 \/ 17ms \/ SSH 端口可达 \|/);
  assert.match(report, /\| 认证恢复建议 \| 完整备份可恢复到本机加密凭据库 \|/);
  assert.match(report, /\| 排障建议 \| 连接正常。建议保留当前 OpenSSH Config、端口转发和主机指纹记录，后续变更前可先导出连接档案。 \|/);
  assert.match(report, /\| 认证恢复建议 \| 导入后需要重新录入密码或选择私钥 \|/);
  assert.match(report, /\| 排障建议 \| 最近校验失败：连接超时。请检查网络连通性、端口、防火墙、安全组和 ProxyJump 设置。 \|/);
  assert.match(report, /OpenSSH Config：/);
  assert.match(report, /```sshconfig\nHost prod-web\n  HostName 10\.0\.1\.23\n  User root\n  Port 22\n  ConnectTimeout 12\n  ConnectionAttempts 3\n  ServerAliveInterval 45\n  ServerAliveCountMax 3\n  ProxyJump bastion\n  LocalForward 127\.0\.0\.1:18080 127\.0\.0\.1:80\n  RemoteForward 127\.0\.0\.1:22022 127\.0\.0\.1:22\n  DynamicForward 127\.0\.0\.1:1080\n```/);
  assert.match(report, /- \/var\/www\/app（默认目录）/);
  assert.match(report, /- \/var\/log\/nginx\/error\.log（错误日志）/);
  assert.match(report, /SHA256:abc123/);
  assert.doesNotMatch(report, /sshcred-secret|DoNotExport|PRIVATE KEY|credentialRef|password|privateKey/i);
});
