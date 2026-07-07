import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("frontend render crashes show a Chinese recovery screen instead of a blank window", () => {
  assert.match(main, /class AppErrorBoundary extends React\.Component/);
  assert.match(main, /componentDidCatch\(error,\s*info\)/);
  assert.match(main, /action:\s*"react_error_boundary"/);
  assert.match(main, /window\.pywebview\?\.api\?\.write_tool_log_event/);
  assert.match(main, /buildCrashDetailsText/);
  assert.match(main, /copyCrashDetails/);
  assert.match(main, /navigator\.clipboard\.writeText/);
  assert.match(main, /<AppErrorBoundary>/);
  assert.match(main, /<App \/>/);
  assert.match(main, /界面发生错误/);
  assert.match(main, /重新加载/);
  assert.match(main, /打开工具日志/);
  assert.doesNotMatch(main, /�|鐣|閲|鎵|璇婃柇|鍙戠敓|妫€|鏃х増/);
  assert.match(main, /window\.location\.reload\(\)/);
  assert.match(styles, /\.app-crash-screen/);
  assert.match(styles, /\.app-crash-actions/);
});

test("topbar connection check report export handler is defined before render", () => {
  const renderIndex = app.indexOf("onExportConnectionCheckReport={exportConnectionCheckReport}");
  const handlerIndex = app.indexOf("async function exportConnectionCheckReport");

  assert.ok(renderIndex > -1);
  assert.ok(handlerIndex > -1);
  assert.ok(handlerIndex < renderIndex);
  assert.match(app, /buildConnectionCheckReport/);
  assert.match(app, /latestConnectionCheck/);
});

test("App render does not pass undefined bare handler references", () => {
  const renderStart = app.indexOf("<DesktopTopBar");
  const beforeRender = app.slice(0, renderStart);
  const renderSource = app.slice(renderStart);
  const handlerNames = [...new Set(
    [...renderSource.matchAll(/\bon[A-Z][A-Za-z0-9_]*=\{([A-Za-z_$][\w$]*)\}/g)].map((match) => match[1]),
  )].sort();
  const missing = handlerNames.filter((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`(?:async\\s+function|function)\\s+${escaped}\\s*\\(`).test(beforeRender)
      && !new RegExp(`(?:const|let|var)\\s+${escaped}\\b`).test(beforeRender)
      && !new RegExp(`[,\\[]\\s*${escaped}\\s*[,\\]]`).test(beforeRender);
  });

  assert.deepEqual(missing, []);
});

test("App JSX components are declared or imported before runtime render", () => {
  const importNames = new Set(
    [...app.matchAll(/import\s+(?:\{([^}]+)\}|([A-Za-z_$][\w$]*))\s+from\s+["'][^"']+["']/g)]
      .flatMap((match) => (match[1] || match[2] || "").split(","))
      .map((item) => item.trim().split(/\s+as\s+/).pop().trim())
      .filter(Boolean),
  );
  const localNames = new Set(
    [
      ...[...app.matchAll(/\bfunction\s+([A-Z][A-Za-z0-9_]*)\s*\(/g)].map((match) => match[1]),
      ...[...app.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=/g)].map((match) => match[1]),
      ...[...app.matchAll(/\bclass\s+([A-Z][A-Za-z0-9_]*)\b/g)].map((match) => match[1]),
    ],
  );
  const jsxNames = [...new Set(
    [...app.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)].map((match) => match[1]),
  )].sort();
  const missing = jsxNames.filter((name) => !importNames.has(name) && !localNames.has(name));

  assert.deepEqual(missing, []);
});

test("terminal disconnect button avoids known Power icon runtime crash signature", () => {
  assert.doesNotMatch(app, /\bPower,\s*/);
  assert.doesNotMatch(app, /<Power\b/);
});
