const LOCALHOST_ALIASES = new Set(["127.0.0.1", "localhost"]);

export function normalizePortForwardConfig(input = {}) {
  const name = String(input?.name || "").trim();
  const localHost = String(input?.localHost || "127.0.0.1").trim() || "127.0.0.1";
  const remoteHost = String(input?.remoteHost || "").trim();
  const localPort = parsePort(input?.localPort);
  const remotePort = parsePort(input?.remotePort);
  const errors = [];

  if (!remoteHost) errors.push("远程地址不能为空");
  if (!isValidPort(localPort)) errors.push("本地端口必须在 1-65535 之间");
  if (!isValidPort(remotePort)) errors.push("远程端口必须在 1-65535 之间");
  if (!LOCALHOST_ALIASES.has(localHost)) errors.push("监听地址只允许 127.0.0.1，避免端口暴露到局域网");

  if (errors.length) throw new Error(errors.join("；"));
  return {
    name,
    localHost: "127.0.0.1",
    localPort,
    remoteHost,
    remotePort,
  };
}

export function buildPortForwardCommandPreview(config, server = {}) {
  const normalized = normalizePortForwardConfig(config);
  const user = String(server?.user || "root").trim() || "root";
  const host = String(server?.ip || server?.host || "").trim();
  const port = String(server?.port || "22").trim() || "22";
  const target = host ? `${user}@${host}` : `${user}@<host>`;
  const spec = `${normalized.localHost}:${normalized.localPort}:${normalized.remoteHost}:${normalized.remotePort}`;
  return ["ssh", "-N", "-L", quoteArg(spec), quoteArg(target), "-p", quoteArg(port)].join(" ");
}

export function buildPortForwardLocalUrl(config = {}) {
  const port = parsePort(config?.localPort);
  if (!isValidPort(port)) return "";
  return `http://127.0.0.1:${port}/`;
}

export function buildAutoStartLocalForwardConfigs(server = {}) {
  const forwards = Array.isArray(server?.localForwards) ? server.localForwards : [];
  return forwards
    .map((forward) => {
      try {
        const config = normalizePortForwardConfig({
          name: forward?.name,
          localHost: forward?.localHost || "127.0.0.1",
          localPort: forward?.localPort,
          remoteHost: forward?.remoteHost,
          remotePort: forward?.remotePort,
        });
        return {
          ...config,
          name: config.name || `自动转发 ${config.localPort} -> ${config.remoteHost}:${config.remotePort}`,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function upsertPortForwardPreset(currentPresets = [], input = {}, serverName = "") {
  const config = normalizePortForwardConfig(input);
  const id = String(input?.id || makePresetId(serverName, config)).trim();
  const preset = {
    id,
    serverName: String(serverName || input?.serverName || "").trim(),
    name: config.name || `${config.localPort} -> ${config.remoteHost}:${config.remotePort}`,
    localHost: config.localHost,
    localPort: config.localPort,
    remoteHost: config.remoteHost,
    remotePort: config.remotePort,
    updatedAt: String(input?.updatedAt || new Date().toISOString()),
  };

  const next = (Array.isArray(currentPresets) ? currentPresets : []).filter((item) => item?.id !== id);
  return [preset, ...next].slice(0, 30);
}

export function removePortForwardPreset(currentPresets = [], presetId = "") {
  const id = String(presetId || "").trim();
  return (Array.isArray(currentPresets) ? currentPresets : []).filter((item) => item?.id !== id);
}

export function getPortForwardPresetsForServer(currentPresets = [], serverName = "") {
  const target = String(serverName || "").trim();
  return (Array.isArray(currentPresets) ? currentPresets : []).filter((item) => String(item?.serverName || "").trim() === target);
}

function parsePort(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isValidPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function makePresetId(serverName, config) {
  return `pfpreset-${sanitizeIdPart(serverName)}-${config.localPort}-${sanitizeIdPart(config.remoteHost)}-${config.remotePort}`;
}

function sanitizeIdPart(value) {
  return String(value || "server")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "server";
}

function quoteArg(value) {
  const text = String(value || "");
  if (/^[A-Za-z0-9._:@/%+-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}
