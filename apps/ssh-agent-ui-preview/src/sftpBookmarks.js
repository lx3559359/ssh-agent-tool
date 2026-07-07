import { normalizeSftpPath } from "./sftpNavigation.js";

export const MAX_SFTP_BOOKMARKS = 16;

export function normalizeSftpBookmarks(bookmarks = [], maxCount = MAX_SFTP_BOOKMARKS) {
  const seen = new Set();
  const paths = [];

  for (const value of Array.isArray(bookmarks) ? bookmarks : []) {
    const rawPath = String(value || "").trim();
    if (!rawPath) continue;
    const normalized = normalizeSftpPath(rawPath);
    if (!normalized || normalized === ".") continue;
    const path = normalized.startsWith("/") ? normalized : `/${normalized.replace(/^\/+/, "")}`;
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }

  return paths.slice(-Math.max(1, Number(maxCount) || MAX_SFTP_BOOKMARKS));
}

export function addSftpBookmark(bookmarks = [], path = "", maxCount = MAX_SFTP_BOOKMARKS) {
  const nextPath = normalizeSftpPath(path);
  if (!nextPath) return normalizeSftpBookmarks(bookmarks, maxCount);
  return normalizeSftpBookmarks([...normalizeSftpBookmarks(bookmarks, maxCount), nextPath], maxCount);
}

export function removeSftpBookmark(bookmarks = [], path = "") {
  const targetPath = normalizeSftpPath(path);
  return normalizeSftpBookmarks(bookmarks).filter((item) => item !== targetPath);
}
