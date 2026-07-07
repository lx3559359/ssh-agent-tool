import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function modelSettingsSource() {
  return app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));
}

test("model settings offers one action to save API settings and fetch model list", () => {
  const modalSource = modelSettingsSource();
  const actionSource = modalSource.slice(
    modalSource.indexOf("async function saveAndFetchModels"),
    modalSource.indexOf("return ("),
  );

  assert.match(modalSource, /async function saveAndFetchModels\(\)/);
  assert.match(actionSource, /await onSaveProfile\?\./);
  assert.match(actionSource, /await onListModels\?\./);
  assert.match(actionSource, /await onCacheModelOptions\?\./);
  assert.ok(actionSource.indexOf("onSaveProfile") < actionSource.indexOf("onListModels"));
  assert.match(modalSource, />\{"保存并获取模型"\}</);
  assert.match(modalSource, /disabled=\{busy \|\| fetchingModels/);
});

test("save and fetch models selects the first fetched model when no valid default is set", () => {
  const modalSource = modelSettingsSource();
  const actionSource = modalSource.slice(
    modalSource.indexOf("async function saveAndFetchModels"),
    modalSource.indexOf("async function saveAndTestConfig"),
  );

  assert.match(actionSource, /const shouldPickFirstModel = models\.length > 0 && !models\.includes\(config\.model\)/);
  assert.match(actionSource, /const selectedModel = shouldPickFirstModel \? models\[0\] : config\.model/);
  assert.match(actionSource, /setConfig\(\(current\) => \(\{ \.\.\.current,\s*model:\s*selectedModel \}\)\)/);
  assert.match(actionSource, /model:\s*selectedModel/);
  assert.ok(actionSource.indexOf("const selectedModel") < actionSource.indexOf("onCacheModelOptions"));
});

test("save and fetch models records diagnostics when model listing throws", () => {
  const modalSource = modelSettingsSource();
  const actionSource = modalSource.slice(
    modalSource.indexOf("async function saveAndFetchModels"),
    modalSource.indexOf("async function saveAndTestConfig"),
  );
  const catchSource = actionSource.slice(actionSource.indexOf("catch (error)"));

  assert.match(catchSource, /setModelListFetched\(true\)/);
  assert.match(catchSource, /setModelListDiagnostics\(\{/);
  assert.match(catchSource, /attemptedEndpoints:\s*\[\]/);
  assert.match(catchSource, /lastError:\s*errorText/);
});

test("save and fetch models keeps the encrypted API key reference returned by save", () => {
  const modalSource = modelSettingsSource();
  const actionSource = modalSource.slice(
    modalSource.indexOf("async function saveAndFetchModels"),
    modalSource.indexOf("async function saveAndTestConfig"),
  );

  assert.match(actionSource, /const savedProfile = await onSaveProfile\?\./);
  assert.match(actionSource, /const cacheProfile = \{/);
  assert.match(actionSource, /id:\s*savedProfile\?\.id \|\| draftProfileId/);
  assert.match(actionSource, /name:\s*savedProfile\?\.name \|\| profileName/);
  assert.match(actionSource, /config:\s*\{ \.\.\.\(savedProfile\?\.config \|\| draft\),\s*model:\s*selectedModel \}/);
  assert.match(actionSource, /await onCacheModelOptions\?\.\(cacheProfile,\s*models\)/);
});

test("save and test stops when saving the API key or profile fails", () => {
  const modalSource = modelSettingsSource();
  const actionSource = modalSource.slice(
    modalSource.indexOf("async function saveAndTestConfig"),
    modalSource.indexOf("async function clearModelOptions"),
  );

  assert.match(actionSource, /const saved = await onSave\(/);
  assert.match(actionSource, /if \(saved === false\) \{/);
  assert.match(actionSource, /setStatus\("保存失败，请检查 API Key、Base URL 或工具日志。"\)/);
  assert.match(actionSource, /return/);
  assert.ok(actionSource.indexOf("if (saved === false)") < actionSource.indexOf("await testConnection"));
});
