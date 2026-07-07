import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findSuspiciousLocalizationText } from "./localizationQuality.js";

test("findSuspiciousLocalizationText flags common mojibake and replacement characters", () => {
  const result = findSuspiciousLocalizationText("服务器正常\n澶囦唤瀵煎嚭\n锟斤拷\nOpenSSH Config");

  assert.deepEqual(result.map((item) => item.line), [2, 3]);
  assert.match(result[0].text, /澶囦唤/);
  assert.match(result[1].text, /锟斤拷/);
});

test("findSuspiciousLocalizationText flags common UTF8 Chinese mojibake sequences", () => {
  const remoteProgramMojibake = "\u6769\u6EDE\u7A0B\u7A0B\u5E8F";
  const terminalMojibake = "\u7F01\u5802\u27EC\u01EC";
  const exportMojibake = "\u7025\u714E\u568C";
  const result = findSuspiciousLocalizationText([
    "正常中文：终端输出",
    `提示：${remoteProgramMojibake}`,
    `标题：SSH ${terminalMojibake}`,
    `按钮：${exportMojibake}`,
  ].join("\n"));

  assert.deepEqual(result.map((item) => item.line), [2, 3, 4]);
});

test("findSuspiciousLocalizationText flags unknown error mojibake", () => {
  const unknownErrorMojibake = "\u93C8\uE046\u7161\u95BF\u6B12\uE1E4";
  const result = findSuspiciousLocalizationText(`error: ${unknownErrorMojibake}`);

  assert.deepEqual(result.map((item) => item.line), [1]);
});

test("findSuspiciousLocalizationText flags update-related Chinese mojibake", () => {
  const result = findSuspiciousLocalizationText([
    "当前版本 20260702",
    "褰撳墠鐗堟湰 20260701",
    "鍙戠幇鏂扮増鏈 20260702",
    "涓嬭浇骞舵牎楠屾洿鏂板寘",
  ].join("\n"));

  assert.deepEqual(result.map((item) => item.line), [2, 3, 4]);
});

test("findSuspiciousLocalizationText flags port forward mojibake labels", () => {
  const result = findSuspiciousLocalizationText([
    "杩滅▼鍦板潃涓嶈兘涓虹┖",
    "鏈湴绔彛蹇呴』鍦?1-65535 涔嬮棿",
    "鑷姩杞彂 18080 -> 127.0.0.1:80",
  ].join("\n"));

  assert.deepEqual(result.map((item) => item.line), [1, 2, 3]);
});

test("findSuspiciousLocalizationText flags Agent panel mojibake labels", () => {
  const result = findSuspiciousLocalizationText([
    "妯″瀷 API",
    "鐗堟湰淇℃伅",
    "璁″垝 3 姝",
    "宸叉壒鍑?",
    "寰呯‘璁?",
    "鍙",
  ].join("\n"));

  assert.deepEqual(result.map((item) => item.line), [1, 2, 3, 4, 5, 6]);
});

test("findSuspiciousLocalizationText flags model provider mojibake labels", () => {
  const result = findSuspiciousLocalizationText([
    "OpenAI 鍏煎",
    "閫氫箟鍗冮棶",
    "鏅鸿氨 GLM",
    "纭呭熀娴佸姩",
  ].join("\n"));

  assert.deepEqual(result.map((item) => item.line), [1, 2, 3, 4]);
});

test("findSuspiciousLocalizationText flags SSH auth type mojibake labels", () => {
  const result = findSuspiciousLocalizationText([
    "authType: form.authType || \"瀵嗙爜\"",
    "restoreMode: \"鍔犲瘑鎭㈠\"",
    "normal: 密码",
  ].join("\n"));

  assert.deepEqual(result.map((item) => item.line), [1, 2]);
});

test("findSuspiciousLocalizationText flags context menu mojibake labels", () => {
  const result = findSuspiciousLocalizationText([
    "澶嶅埗缁堢杈撳嚭",
    "鍙戦€?Ctrl+C / 涓柇",
    "閲嶈繛 SSH 浼氳瘽",
    "涓嬭浇鏂囦欢/鐩綍",
  ].join("\n"));

  assert.deepEqual(result.map((item) => item.line), [1, 2, 3, 4]);
});

test("source localization strings do not contain mojibake markers", () => {
  const files = collectSourceFiles(dirname(fileURLToPath(import.meta.url)));
  const findings = files.flatMap((file) => {
    const content = readFileSync(file, "utf8");
    return findSuspiciousLocalizationText(content).map((item) => ({ ...item, file }));
  });

  assert.deepEqual(findings, []);
});

function collectSourceFiles(root) {
  return readdirSync(root)
    .flatMap((name) => {
      const path = join(root, name);
      const stat = statSync(path);
      if (stat.isDirectory()) return collectSourceFiles(path);
      if (!/\.(js|jsx|css)$/.test(name)) return [];
      return [path];
    })
    .filter((path) => !path.endsWith(".test.js"))
    .filter((path) => !path.endsWith("localizationQuality.test.js"))
    .filter((path) => !path.endsWith("localizationQuality.js"));
}
