export function normalizeSftpPath(path) {
  const normalized = String(path || "").trim().replaceAll("\\", "/").replace(/\/+/g, "/");
  if (!normalized) return ".";
  if (normalized === "/") return "/";
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function quoteSftpPathForShell(path) {
  const normalized = normalizeSftpPath(path);
  if (!normalized || normalized === ".") return ".";
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(normalized)) return normalized;
  return `'${normalized.replaceAll("'", "'\\''")}'`;
}

export function buildSftpTerminalCommand(action, path) {
  const quotedPath = quoteSftpPathForShell(path);
  switch (action) {
    case "list":
      return `ls -lah ${quotedPath}`;
    case "cd":
      return `cd ${quotedPath}`;
    case "tail":
      return `tail -n 200 ${quotedPath}`;
    case "cat":
      return `cat ${quotedPath}`;
    default:
      return quotedPath;
  }
}

export function resolveShellWorkingDirectory(command, currentPath, homePath = ".") {
  const text = String(command || "").trim();
  const match = text.match(/^cd(?:\s+(.+))?$/);
  if (!match) return null;

  let target = String(match[1] || "").trim();
  if (!target || target === "~") return normalizeSftpPath(homePath || ".");
  if (target === "-") return null;
  if (/[;&|`$<>]/.test(target)) return null;

  target = unwrapShellPath(target);
  if (!target || target === "~") return normalizeSftpPath(homePath || ".");
  if (target === "-") return null;
  if (target.startsWith("~/")) {
    return normalizeRemotePathSegments(`${normalizeSftpPath(homePath || ".")}/${target.slice(2)}`);
  }
  if (target.startsWith("/")) return normalizeRemotePathSegments(target);

  const base = normalizeSftpPath(currentPath || homePath || ".");
  return normalizeRemotePathSegments(`${base}/${target}`);
}

export function resolveSftpChildPath(parentPath, childName) {
  const parent = normalizeSftpPath(parentPath);
  const child = normalizeSftpPath(childName).replace(/^\/+/, "");
  if (!child || child === ".") return parent;
  if (parent === "/") return `/${child}`;
  if (parent === ".") return child;
  return `${parent}/${child}`;
}

function unwrapShellPath(value) {
  const text = String(value || "").trim();
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replaceAll("'\\''", "'");
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\"/g, '"');
  }
  return text;
}

function normalizeRemotePathSegments(path) {
  const normalized = normalizeSftpPath(path);
  const absolute = normalized.startsWith("/");
  const parts = [];
  normalized.split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") {
      if (parts.length && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!absolute) {
        parts.push(part);
      }
      return;
    }
    parts.push(part);
  });
  if (absolute) return `/${parts.join("/")}`.replace(/\/$/, "") || "/";
  return parts.join("/") || ".";
}

export function getParentSftpPath(path) {
  const current = normalizeSftpPath(path);
  if (current === "/" || current === ".") return current;
  const absolute = current.startsWith("/");
  const parts = current.split("/").filter(Boolean);
  if (parts.length <= 1) return absolute ? "/" : ".";
  const parent = parts.slice(0, -1).join("/");
  return absolute ? `/${parent}` : parent;
}

export function formatSftpPreviewMeta(preview) {
  const path = String(preview?.remotePath || "").trim() || "未选择文件";
  const size = formatSftpPreviewSize(preview?.size);
  const encoding = formatSftpPreviewEncoding(preview?.encoding);
  return [path, size, encoding].filter(Boolean).join(" · ");
}

export function chooseSftpSelectionAfterRefresh(items = [], preferredPath = "") {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const target = normalizeSftpPath(preferredPath || "");
  if (target && target !== ".") {
    const matched = list.find((item) => normalizeSftpPath(item?.path || item?.name || "") === target);
    if (matched) return matched;
  }
  return list[0] || null;
}

function formatSftpPreviewEncoding(value) {
  const encoding = String(value || "").trim();
  if (!encoding) return "";
  const key = encoding.toLowerCase();
  const labels = {
    "utf-8": "UTF-8",
    utf8: "UTF-8",
    "utf-8-sig": "UTF-8 BOM",
    "utf-16": "UTF-16",
    "utf-16-le": "UTF-16 LE",
    "utf-16le": "UTF-16 LE",
    "utf-16-be": "UTF-16 BE",
    "utf-16be": "UTF-16 BE",
    gb18030: "GB18030",
    gbk: "GBK",
  };
  return `编码：${labels[key] || encoding}`;
}

function formatSftpPreviewSize(value) {
  const size = Math.max(0, Number(value) || 0);
  const units = ["B", "KB", "MB", "GB"];
  let next = size;
  for (const unit of units) {
    if (next < 1024 || unit === units[units.length - 1]) {
      return unit === "B" ? `${Math.round(next)} B` : `${next.toFixed(1)} ${unit}`;
    }
    next /= 1024;
  }
  return `${size} B`;
}
