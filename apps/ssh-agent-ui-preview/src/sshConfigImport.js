import { normalizePortForwardConfig } from "./portForwardSettings.js";
import { hasUsableServerAuth, normalizeConnectionRetries, normalizeConnectionTimeout, normalizeKeepaliveCountMax, normalizeKeepaliveSeconds } from "./serverManagement.js";

export function mergeSshConfigHosts(currentServers, importedHosts, occupiedServers = currentServers) {
  const servers = { ...(currentServers || {}) };
  const occupied = { ...(occupiedServers || {}), ...servers };
  const importedNames = [];
  let skipped = 0;

  (Array.isArray(importedHosts) ? importedHosts : []).forEach((host) => {
    const server = buildServerFromSshConfigHost(host);
    if (!server) {
      skipped += 1;
      return;
    }

    const name = uniqueImportedName(server.name, { ...occupied, ...servers });
    servers[name] = server.data;
    importedNames.push(name);
  });

  return { servers, importedNames, skipped };
}

export function buildSshConfigImportPreview(currentServers, importedHosts, occupiedServers = currentServers, parserResult = {}) {
  const merged = mergeSshConfigHosts(currentServers, importedHosts, occupiedServers);
  const portForwardImport = mergeSshConfigPortForwardPresets([], merged.importedNames, merged.servers);
  const importableCount = merged.importedNames.length;
  const invalidSkipped = Number(parserResult?.skipped || 0) + Number(merged.skipped || 0);
  const readiness = buildSshConfigReadiness(merged.importedNames, merged.servers);
  const needsCredentialCount = readiness.missingAuth;
  const previewNames = merged.importedNames.slice(0, 5);
  const nameText = previewNames.length > 0 ? `\n将导入：${previewNames.join("、")}${importableCount > previewNames.length ? " 等" : ""}` : "";
  const credentialText = needsCredentialCount > 0 ? `\n其中 ${needsCredentialCount} 台需要导入后绑定密码或私钥。` : "";
  const skippedText = invalidSkipped > 0 ? `\n将跳过 ${invalidSkipped} 项无效或通配符 Host。` : "";
  const readinessText = importableCount > 0
    ? `\n预检：可直接测试 ${readiness.ready} 台，缺少认证 ${readiness.missingAuth} 台。${readiness.proxyJump ? `\n包含 ProxyJump ${readiness.proxyJump} 台。` : ""}${readiness.identityFile ? `\n包含私钥路径 ${readiness.identityFile} 台。` : ""}`
    : "";
  const advancedForwardText = readiness.remoteForward || readiness.dynamicForward
    ? `\n包含 RemoteForward ${readiness.remoteForward} 台，DynamicForward ${readiness.dynamicForward} 台。`
    : "";
  const portForwardText = portForwardImport.importedNames.length > 0 ? `\n将导入端口转发预设 ${portForwardImport.importedNames.length} 个。` : "";

  return {
    ...merged,
    importableCount,
    skippedCount: invalidSkipped,
    needsCredentialCount,
    readiness,
    portForwardPresetCount: portForwardImport.importedNames.length,
    portForwardPresetNames: portForwardImport.importedNames,
    skippedPortForwards: portForwardImport.skipped,
    message: `SSH config 导入预览：将新增 ${importableCount} 台服务器。${nameText}${readinessText}${advancedForwardText}${credentialText}${portForwardText}${skippedText}\n\n是否确认导入？`,
  };
}

export function mergeSshConfigPortForwardPresets(currentPresets, importedNames, servers) {
  const presets = [...(Array.isArray(currentPresets) ? currentPresets : [])];
  const importedNamesList = [];
  let skipped = 0;
  const existing = new Set(
    presets.map((preset) => [
      String(preset?.serverName || "").trim().toLowerCase(),
      String(preset?.localHost || "127.0.0.1").trim().toLowerCase(),
      String(preset?.localPort || "").trim(),
      String(preset?.remoteHost || "").trim().toLowerCase(),
      String(preset?.remotePort || "").trim(),
    ].join("|")),
  );
  const existingLocalBinds = new Set(
    presets.map((preset) => [
      String(preset?.serverName || "").trim().toLowerCase(),
      String(preset?.localHost || "127.0.0.1").trim().toLowerCase(),
      String(preset?.localPort || "").trim(),
    ].join("|")),
  );

  (Array.isArray(importedNames) ? importedNames : []).forEach((serverName) => {
    const name = String(serverName || "").trim();
    const server = servers?.[name];
    const forwards = Array.isArray(server?.localForwards) ? server.localForwards : [];
    forwards.forEach((forward) => {
      const preset = buildSshConfigPortForwardPreset(name, forward);
      if (!preset) {
        skipped += 1;
        return;
      }
      const key = [
        preset.serverName.toLowerCase(),
        preset.localHost.toLowerCase(),
        String(preset.localPort),
        preset.remoteHost.toLowerCase(),
        String(preset.remotePort),
      ].join("|");
      if (existing.has(key)) {
        skipped += 1;
        return;
      }
      const bindKey = [
        preset.serverName.toLowerCase(),
        preset.localHost.toLowerCase(),
        String(preset.localPort),
      ].join("|");
      if (existingLocalBinds.has(bindKey)) {
        skipped += 1;
        return;
      }
      existing.add(key);
      existingLocalBinds.add(bindKey);
      presets.push(preset);
      importedNamesList.push(preset.name);
    });
  });

  return { presets, importedNames: importedNamesList, skipped };
}

function buildSshConfigPortForwardPreset(serverName, forward) {
  try {
    const config = normalizePortForwardConfig({
      localHost: String(forward?.localHost || "127.0.0.1").trim() || "127.0.0.1",
      localPort: forward?.localPort,
      remoteHost: forward?.remoteHost,
      remotePort: forward?.remotePort,
    });
    const name = `${serverName} ${config.localPort} -> ${config.remoteHost}:${config.remotePort}`;
    return {
      id: `sshconfig-${sanitizePresetId(serverName)}-${config.localPort}-${sanitizePresetId(config.remoteHost)}-${config.remotePort}`,
      serverName,
      name,
      localHost: config.localHost,
      localPort: config.localPort,
      remoteHost: config.remoteHost,
      remotePort: config.remotePort,
    };
  } catch {
    return null;
  }
}

function sanitizePresetId(value) {
  return String(value || "server")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "server";
}

function buildSshConfigReadiness(importedNames, servers) {
  const readiness = {
    ready: 0,
    missingAuth: 0,
    proxyJump: 0,
    identityFile: 0,
    forwardAgent: 0,
    remoteForward: 0,
    dynamicForward: 0,
  };

  (Array.isArray(importedNames) ? importedNames : []).forEach((name) => {
    const server = servers?.[name];
    if (!server) return;
    if (hasUsableServerAuth(server)) readiness.ready += 1;
    else readiness.missingAuth += 1;
    if (String(server.proxyJump || "").trim()) readiness.proxyJump += 1;
    if (String(server.identityFile || "").trim()) readiness.identityFile += 1;
    if (server.forwardAgent) readiness.forwardAgent += 1;
    if (Array.isArray(server.remoteForwards) && server.remoteForwards.length > 0) readiness.remoteForward += 1;
    if (Array.isArray(server.dynamicForwards) && server.dynamicForwards.length > 0) readiness.dynamicForward += 1;
  });

  return readiness;
}

function buildServerFromSshConfigHost(host) {
  const name = String(host?.name || "").trim();
  const address = String(host?.host || host?.hostname || "").trim();
  if (!name || !address) return null;

  const user = String(host.user || "root").trim() || "root";
  const port = String(host.port || "22").trim() || "22";
  const timeoutSeconds = normalizeConnectionTimeout(host.connectTimeout, 10);
  const retryCount = normalizeConnectionRetries(openSshAttemptsToRetryCount(host.connectionAttempts), 0);
  const keepaliveSeconds = normalizeKeepaliveSeconds(host.serverAliveInterval, 30);
  const keepaliveCountMax = normalizeKeepaliveCountMax(host.serverAliveCountMax, 3);
  const identityFile = String(host.identityFile || "").trim();
  const identitiesOnly = normalizeOpenSshBoolean(host.identitiesOnly);
  const forwardAgent = normalizeOpenSshBoolean(host.forwardAgent);
  const proxyJump = String(host.proxyJump || "").trim();
  const hostKeyAlias = String(host.hostKeyAlias || "").trim();
  const localForwards = normalizeLocalForwards(host.localForwards);
  const remoteForwards = normalizeRemoteForwards(host.remoteForwards);
  const dynamicForwards = normalizeDynamicForwards(host.dynamicForwards);
  const cwd = `/home/${user}`;
  const authType = identityFile ? "私钥" : "未绑定凭据";
  const noteParts = ["从 SSH config 导入"];
  if (identityFile) noteParts.push(`私钥路径：${identityFile}`);
  if (proxyJump) noteParts.push(`跳板机：${proxyJump}`);
  if (!identityFile) noteParts.push("未包含密码或私钥内容。");
  const note = noteParts.join("；");

  return {
    name,
    data: {
      ip: address,
      port,
      group: "SSH 配置导入",
      state: "未测试",
      tone: "amber",
      user,
      cwd,
      latency: "--",
      timeoutSeconds,
      retryCount,
      keepaliveSeconds,
      keepaliveCountMax,
      policy: "默认确认策略",
      authType,
      identityFile,
      identitiesOnly,
      forwardAgent,
      proxyJump,
      hostKeyAlias,
      localForwards,
      remoteForwards,
      dynamicForwards,
      credentialRef: "",
      hasCredential: false,
      note,
      terminal: [
        `[${user}@${name} ~]# ssh ${user}@${address} -p ${port}`,
        "该服务器来自 SSH config 导入，未导入密码或私钥内容；请在凭据库中绑定认证信息后连接。",
      ],
      files: [
        { type: "folder", name: cwd, meta: "默认目录" },
        { type: "file", name: "导入说明.txt", meta: "本地配置" },
      ],
      plan: ["测试 SSH 端口连通性", "绑定密码、私钥或 SSH Agent", "读取系统基础信息", "生成首次巡检建议"],
      evidence: [
        { label: "host", value: `${address}:${port}` },
        { label: "source", value: "ssh-config-import" },
        ...(proxyJump ? [{ label: "proxyJump", value: proxyJump }] : []),
        ...(hostKeyAlias ? [{ label: "hostKeyAlias", value: hostKeyAlias }] : []),
        ...(forwardAgent ? [{ label: "forwardAgent", value: "yes" }] : []),
        ...(localForwards.length ? [{ label: "localForward", value: `${localForwards.length} 个` }] : []),
        ...(remoteForwards.length ? [{ label: "remoteForward", value: `${remoteForwards.length} 个` }] : []),
        ...(dynamicForwards.length ? [{ label: "dynamicForward", value: `${dynamicForwards.length} 个` }] : []),
      ],
    },
  };
}

function normalizeOpenSshBoolean(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return ["yes", "true", "on", "1"].includes(text);
}

function normalizeLocalForwards(forwards = []) {
  return (Array.isArray(forwards) ? forwards : [])
    .map((forward) => ({
      localHost: String(forward?.localHost || "127.0.0.1").trim() || "127.0.0.1",
      localPort: String(forward?.localPort || "").trim(),
      remoteHost: String(forward?.remoteHost || "").trim(),
      remotePort: String(forward?.remotePort || "").trim(),
    }))
    .filter((forward) => forward.localPort && forward.remoteHost && forward.remotePort);
}

function normalizeRemoteForwards(forwards = []) {
  return (Array.isArray(forwards) ? forwards : [])
    .map((forward) => ({
      remoteHost: String(forward?.remoteHost || "127.0.0.1").trim() || "127.0.0.1",
      remotePort: String(forward?.remotePort || "").trim(),
      localHost: String(forward?.localHost || "").trim(),
      localPort: String(forward?.localPort || "").trim(),
    }))
    .filter((forward) => forward.remotePort && forward.localHost && forward.localPort);
}

function normalizeDynamicForwards(forwards = []) {
  return (Array.isArray(forwards) ? forwards : [])
    .map((forward) => ({
      bindHost: String(forward?.bindHost || "127.0.0.1").trim() || "127.0.0.1",
      bindPort: String(forward?.bindPort || "").trim(),
    }))
    .filter((forward) => forward.bindPort);
}

function openSshAttemptsToRetryCount(value) {
  const attempts = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(attempts)) return 0;
  return attempts - 1;
}

function uniqueImportedName(name, servers) {
  if (!servers[name]) return name;

  const importedName = `${name}-导入`;
  if (!servers[importedName]) return importedName;

  let index = 2;
  while (servers[`${importedName}-${index}`]) {
    index += 1;
  }
  return `${importedName}-${index}`;
}
