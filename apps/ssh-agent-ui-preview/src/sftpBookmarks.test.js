import assert from "node:assert/strict";
import test from "node:test";

import { addSftpBookmark, removeSftpBookmark, normalizeSftpBookmarks } from "./sftpBookmarks.js";

test("normalizeSftpBookmarks keeps unique normalized absolute paths", () => {
  assert.deepEqual(
    normalizeSftpBookmarks(["/var/www/app", "/var/www/app/", "logs", "", null, "/etc/nginx"]),
    ["/var/www/app", "/logs", "/etc/nginx"],
  );
});

test("addSftpBookmark appends the current directory once and keeps recent entries bounded", () => {
  const existing = Array.from({ length: 16 }, (_, index) => `/opt/app-${index}`);
  const bookmarks = addSftpBookmark(existing, "/var/www/app/");

  assert.equal(bookmarks.at(-1), "/var/www/app");
  assert.equal(bookmarks.length, 16);
  assert.equal(bookmarks.includes("/opt/app-0"), false);
});

test("removeSftpBookmark removes only the selected normalized path", () => {
  assert.deepEqual(
    removeSftpBookmark(["/var/www/app", "/etc/nginx", "/data"], "/etc/nginx/"),
    ["/var/www/app", "/data"],
  );
});
