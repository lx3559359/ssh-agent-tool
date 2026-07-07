import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(projectRoot, "src", "App.jsx");
const stylesPath = join(projectRoot, "src", "styles.css");

test("model settings can fetch provider model options", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));
  const mainSource = app.slice(app.indexOf("async function listModelOptions"), app.indexOf("async function saveModelConfig"));

  assert.match(modalSource, /onListModels/);
  assert.match(modalSource, /fetchingModels/);
  assert.match(modalSource, /modelOptions/);
  assert.match(modalSource, /<select/);
  assert.match(modalSource, /获取模型/);
  assert.match(modalSource, /model-list-panel/);
  assert.match(modalSource, /模型列表/);
  assert.match(modalSource, /modelOptions\.length/);
  assert.match(modalSource, /未获取到模型/);
  assert.match(modalSource, /可以继续手动填写默认模型/);
  assert.match(modalSource, /const shouldPickFirstModel = nextModels\.length > 0 && !nextModels\.includes\(config\.model\)/);
  assert.match(modalSource, /if \(shouldPickFirstModel\) \{/);
  assert.match(modalSource, /updateField\("model", selectedModel\)/);
  assert.match(mainSource, /list_model_options/);
});

test("model settings places model fetch and selection beside the default model field", () => {
  const app = readFileSync(appPath, "utf8");
  const styles = readFileSync(stylesPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));
  const fieldSource = modalSource.slice(modalSource.indexOf('className="model-field-row"'), modalSource.indexOf('className={`model-list-panel'));

  assert.match(fieldSource, /默认模型/);
  assert.match(fieldSource, /className="model-field-input"/);
  assert.match(fieldSource, /className="model-field-actions"/);
  assert.match(fieldSource, /onClick=\{fetchModelOptions\}/);
  assert.match(fieldSource, /fetchingModels \? "获取中\.\.\." : "获取模型"/);
  assert.match(fieldSource, /filteredModelOptions\.length > 0/);
  assert.match(fieldSource, /className="model-inline-select"/);
  assert.match(fieldSource, /onChange=\{\(event\) => updateField\("model", event\.target\.value\)\}/);
  assert.match(styles, /\.model-field-row\s*\{[\s\S]*display:\s*grid/);
  assert.match(styles, /\.model-field-actions\s*\{[\s\S]*display:\s*flex/);
  assert.match(styles, /\.model-inline-select\s*\{[\s\S]*min-width:\s*0/);
});

test("model settings confirms selected fetched model from list controls", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));

  assert.match(modalSource, /function selectFetchedModel\(modelName\)/);
  assert.match(modalSource, /setConfig\(\(current\) => \(\{ \.\.\.current,\s*model:\s*selectedModel \}\)\)/);
  assert.match(modalSource, /setStatus\(`已选择模型：\$\{selectedModel\}`\)/);
  assert.match(modalSource, /onChange=\{\(event\) => selectFetchedModel\(event\.target\.value\)\}/);
  assert.match(modalSource, /onClick=\{\(\) => selectFetchedModel\(modelName\)\}/);
});

test("model settings caches fetched model options in the active profile", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));
  const renderSource = app.slice(app.indexOf("<ModelSettingsModal"), app.indexOf("{releaseInfoOpen"));
  const cacheSource = app.slice(app.indexOf("async function cacheModelOptions"), app.indexOf("async function prepareStoredModelConfig"));

  assert.match(modalSource, /onCacheModelOptions/);
  assert.match(modalSource, /profile\.config\.modelOptions/);
  assert.match(modalSource, /initialConfig\.modelOptions/);
  assert.match(modalSource, /await onCacheModelOptions\?\.\(/);
  assert.match(renderSource, /onCacheModelOptions=\{cacheModelOptions\}/);
  assert.match(cacheSource, /modelOptions:\s*models/);
  assert.match(cacheSource, /buildModelProfile/);
  assert.match(cacheSource, /persistAppConfig\(customServers,\s*storedConfig,\s*customAgentCapabilities,\s*nextProfiles,\s*nextProfile\.id\)/);
});

test("model settings caches the auto selected model after fetching model options", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));
  const fetchSource = modalSource.slice(modalSource.indexOf("async function fetchModelOptions"), modalSource.indexOf("async function saveAndFetchModels"));

  assert.match(fetchSource, /const selectedModel = shouldPickFirstModel \? nextModels\[0\] : config\.model/);
  assert.match(fetchSource, /await onCacheModelOptions\?\.\(\{ \.\.\.buildSubmitConfig\(\), model: selectedModel \}, nextModels\)/);
});

test("model settings explains saving and fetching models are separate actions", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));

  assert.match(modalSource, /测试失败也可以先保存配置/);
  assert.match(modalSource, /获取模型列表/);
  assert.match(modalSource, /中转站/);
});

test("model settings exposes multiple model API profiles", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));
  const stateSource = app.slice(app.indexOf("export function App()"), app.indexOf("async function persistAppConfig"));
  const renderSource = app.slice(app.indexOf("<ModelSettingsModal"), app.indexOf("{releaseInfoOpen"));

  assert.match(modalSource, /profileOptions/);
  assert.match(modalSource, /activeProfileId/);
  assert.match(modalSource, /onSelectProfile/);
  assert.match(modalSource, /onDeleteProfile/);
  assert.match(modalSource, /保存为档案/);
  assert.match(stateSource, /modelProfiles/);
  assert.match(stateSource, /activeModelProfileId/);
  assert.match(app, /sshAgentModelProfiles/);
  assert.match(renderSource, /profileOptions=\{modelProfiles\}/);
});

test("model settings can prepare a clean unsaved API profile draft", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));
  const prepareSource = modalSource.slice(modalSource.indexOf("function prepareNewModelProfileDraft"), modalSource.indexOf("async function saveConfig"));
  const saveSource = modalSource.slice(modalSource.indexOf("async function saveProfile"), modalSource.indexOf("async function createProfile"));
  const saveFetchSource = modalSource.slice(modalSource.indexOf("async function saveAndFetchModels"), modalSource.indexOf("async function saveAndTestConfig"));
  const parentSaveSource = app.slice(app.indexOf("async function saveModelProfile"), app.indexOf("async function createModelProfile"));

  assert.match(modalSource, /draftProfileId,\s*setDraftProfileId/);
  assert.match(modalSource, /function prepareNewModelProfileDraft\(\)/);
  assert.match(prepareSource, /apiKey:\s*""/);
  assert.match(prepareSource, /apiKeyRef:\s*""/);
  assert.match(prepareSource, /hasApiKey:\s*false/);
  assert.match(prepareSource, /modelOptions:\s*\[\]/);
  assert.match(prepareSource, /setDraftProfileId\(""\)/);
  assert.match(modalSource, /onClick=\{prepareNewModelProfileDraft\}/);
  assert.match(saveSource, /id:\s*draftProfileId/);
  assert.match(saveFetchSource, /id:\s*draftProfileId/);
  assert.match(parentSaveSource, /profileDraft\.id === "" \? "" : profileDraft\.id \|\| activeModelProfileId/);
});

test("model settings status keeps long API diagnostics readable", () => {
  const styles = readFileSync(stylesPath, "utf8");

  assert.match(styles, /\.settings-status\s*\{[\s\S]*align-items:\s*flex-start/);
  assert.match(styles, /\.settings-status\s*\{[\s\S]*white-space:\s*pre-wrap/);
  assert.match(styles, /\.settings-status\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(styles, /\.settings-status\s*\{[\s\S]*line-height:\s*1\.45/);
  assert.match(styles, /\.settings-status\s*\{[\s\S]*user-select:\s*text/);
});

test("model settings can copy the current API diagnostic status", () => {
  const app = readFileSync(appPath, "utf8");
  const styles = readFileSync(stylesPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));

  assert.match(modalSource, /statusCopied,\s*setStatusCopied/);
  assert.match(modalSource, /async function copyModelStatus\(\)/);
  assert.match(modalSource, /navigator\.clipboard\?\.writeText/);
  assert.match(modalSource, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(modalSource, /document\.execCommand\("copy"\)/);
  assert.match(modalSource, /className="settings-status-text"/);
  assert.match(modalSource, /className="settings-status-copy"/);
  assert.match(modalSource, /statusCopied \? "已复制" : "复制状态"/);
  assert.match(styles, /\.settings-status-text\s*\{[\s\S]*flex:\s*1 1 auto/);
  assert.match(styles, /\.settings-status-copy\s*\{[\s\S]*white-space:\s*nowrap/);
});

test("model settings can copy redacted API troubleshooting details", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));
  const diagnosticCopySource = modalSource.slice(modalSource.indexOf("async function copyModelDiagnosticInfo"), modalSource.indexOf("return ("));

  assert.match(modalSource, /async function copyModelDiagnosticInfo\(\)/);
  assert.match(modalSource, /模型 API 排障信息/);
  assert.match(modalSource, /Base URL：\$\{config\.baseUrl \|\| "--"\}/);
  assert.match(modalSource, /默认模型：\$\{config\.model \|\| "--"\}/);
  assert.match(modalSource, /API Key：\$\{hasModelApiSecret \? "已配置或已加密保存" : "未配置"\}/);
  assert.match(modalSource, /当前状态：\$\{testStatus \|\| "--"\}/);
  assert.match(modalSource, /navigator\.clipboard\.writeText\(diagnostic\)/);
  assert.match(modalSource, /模型 API 排障信息已复制，不包含 API Key。/);
  assert.match(modalSource, />\s*复制排障信息\s*</);
  assert.match(diagnosticCopySource, /modelListDiagnostics\?\.attemptedEndpoints\?\.join\?\.\(", "\)/);
  assert.match(diagnosticCopySource, /modelListDiagnostics\?\.lastError/);
  assert.match(diagnosticCopySource, /模型列表尝试接口/);
  assert.match(diagnosticCopySource, /模型列表最后错误/);
  assert.doesNotMatch(diagnosticCopySource, /config\.apiKey/);
});

test("model settings can clear a saved model API key reference before saving", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));

  assert.match(modalSource, /function clearSavedModelApiKey\(\)/);
  assert.match(modalSource, /apiKey:\s*""/);
  assert.match(modalSource, /apiKeyRef:\s*""/);
  assert.match(modalSource, /hasApiKey:\s*false/);
  assert.match(modalSource, /已清除已保存的模型 API Key，保存配置后生效。/);
  assert.match(modalSource, /config\.hasApiKey \|\| config\.apiKeyRef/);
  assert.match(modalSource, /onClick=\{clearSavedModelApiKey\}/);
  assert.match(modalSource, />\s*清除 Key\s*</);
});

test("model settings can open filtered model API logs", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));
  const openLogSource = app.slice(app.indexOf("async function openToolLogs"), app.indexOf("async function refreshToolLogs"));
  const renderSource = app.slice(app.indexOf("<ModelSettingsModal"), app.indexOf("{releaseInfoOpen"));

  assert.match(modalSource, /onOpenModelLogs/);
  assert.match(modalSource, /className="settings-status-log"/);
  assert.match(modalSource, /onClick=\{onOpenModelLogs\}/);
  assert.match(renderSource, /onOpenModelLogs=\{\(\) => openToolLogs\(\{ component:\s*"model-api",\s*level:\s*"",\s*query:\s*"" \}\)\}/);
  assert.match(openLogSource, /async function openToolLogs\(nextFilters = null\)/);
  assert.match(openLogSource, /const filters = nextFilters \? \{ \.\.\.toolLogFilters,\s*\.\.\.nextFilters \} : \{ \.\.\.toolLogFilters \}/);
  assert.match(openLogSource, /setToolLogFilters\(filters\)/);
});

test("model list fetch failures are written to model API tool logs", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("async function listModelOptions"), app.indexOf("async function cacheModelOptions"));

  assert.match(source, /writeToolLogEvent\(\{/);
  assert.match(source, /component:\s*"model-api"/);
  assert.match(source, /action:\s*"list_models_failed"/);
  assert.match(source, /action:\s*"list_models_error"/);
  assert.match(source, /context:\s*\{ provider:\s*config\.provider,\s*baseUrl:\s*config\.baseUrl \}/);
});

test("model settings shows structured model list diagnostics after fetch failures", () => {
  const app = readFileSync(appPath, "utf8");
  const styles = readFileSync(stylesPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));
  const diagnosticPanelSource = modalSource.slice(modalSource.indexOf("model-diagnostics-panel"), modalSource.indexOf("settings-textarea"));

  assert.match(modalSource, /modelListDiagnostics,\s*setModelListDiagnostics/);
  assert.match(modalSource, /attemptedEndpoints:\s*result\?\.attemptedEndpoints/);
  assert.match(modalSource, /lastError:\s*result\?\.lastError/);
  assert.match(modalSource, /模型接口诊断/);
  assert.match(modalSource, /model-diagnostics-panel/);
  assert.match(modalSource, /modelListDiagnostics\?\.attemptedEndpoints/);
  assert.match(modalSource, /modelListDiagnostics\?\.lastError/);
  assert.match(modalSource, /尝试接口：\$\{modelListDiagnostics\?\.attemptedEndpoints/);
  assert.match(modalSource, /最后错误：\$\{modelListDiagnostics\?\.lastError/);
  assert.match(diagnosticPanelSource, /onClick=\{copyModelDiagnosticInfo\}/);
  assert.match(diagnosticPanelSource, />\s*复制诊断\s*</);
  assert.match(styles, /\.model-diagnostics-panel\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(styles, /\.model-diagnostics-head\s*\{[\s\S]*display:\s*flex/);
  assert.match(styles, /\.model-diagnostics-head\s*\{[\s\S]*justify-content:\s*space-between/);
  assert.match(styles, /\.model-diagnostics-head button\s*\{[\s\S]*height:\s*26px/);
  assert.match(styles, /\.model-diagnostics-head button\s*\{[\s\S]*font-size:\s*11px/);
});

test("model settings can clear a model list filter quickly", () => {
  const app = readFileSync(appPath, "utf8");
  const styles = readFileSync(stylesPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));

  assert.match(modalSource, /className="model-filter-row"/);
  assert.match(modalSource, /className="model-filter-clear"/);
  assert.match(modalSource, /modelFilter && \(/);
  assert.match(modalSource, /onClick=\{\(\) => setModelFilter\(""\)\}/);
  assert.match(modalSource, />\s*清空\s*</);
  assert.match(styles, /\.model-filter-row\s*\{[\s\S]*display:\s*flex/);
  assert.match(styles, /\.model-filter-clear,\s*[\s\S]*\.model-list-clear\s*\{[\s\S]*white-space:\s*nowrap/);
});

test("model settings can clear cached model options for the active profile", () => {
  const app = readFileSync(appPath, "utf8");
  const styles = readFileSync(stylesPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));

  assert.match(modalSource, /async function clearModelOptions\(\)/);
  assert.match(modalSource, /setModelOptions\(\[\]\)/);
  assert.match(modalSource, /setModelFilter\(""\)/);
  assert.match(modalSource, /setModelListFetched\(true\)/);
  assert.match(modalSource, /modelOptions:\s*\[\]/);
  assert.match(modalSource, /await onCacheModelOptions\?\.\(/);
  assert.match(modalSource, /className="model-list-head"/);
  assert.match(modalSource, /className="model-list-clear"/);
  assert.match(modalSource, />\s*清空列表\s*</);
  assert.match(styles, /\.model-list-head\s*\{[\s\S]*display:\s*flex/);
  assert.match(styles, /\.model-list-clear\s*\{[\s\S]*white-space:\s*nowrap/);
});

test("model settings shows model list count and last fetch time", () => {
  const app = readFileSync(appPath, "utf8");
  const styles = readFileSync(stylesPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));

  assert.match(modalSource, /modelListFetchedAt,\s*setModelListFetchedAt/);
  assert.match(modalSource, /function markModelListFetched\(\)/);
  assert.match(modalSource, /setModelListFetchedAt\(new Date\(\)\.toLocaleString\("zh-CN"\)\)/);
  assert.match(modalSource, /setModelListFetchedAt\(""\)/);
  assert.match(modalSource, /className="model-list-meta"/);
  assert.match(modalSource, /模型数量：\$\{modelOptions\.length\}/);
  assert.match(modalSource, /最近获取：\$\{modelListFetchedAt \|\| "尚未获取"\}/);
  assert.match(styles, /\.model-list-meta\s*\{[\s\S]*font-size:\s*11px/);
});

test("model settings clears stale fetched model options when API identity changes", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));
  const updateFieldSource = modalSource.slice(modalSource.indexOf("function updateField"), modalSource.indexOf("function clearSavedModelApiKey"));
  const clearKeySource = modalSource.slice(modalSource.indexOf("function clearSavedModelApiKey"), modalSource.indexOf("function selectProfile"));
  const headersSource = modalSource.slice(modalSource.indexOf("value={headersText}"), modalSource.indexOf("每行一个"));

  assert.match(modalSource, /function resetModelListState\(\)/);
  assert.match(updateFieldSource, /modelListInvalidatingFields/);
  assert.match(updateFieldSource, /"baseUrl"/);
  assert.match(updateFieldSource, /"apiKey"/);
  assert.match(updateFieldSource, /"provider"/);
  assert.match(updateFieldSource, /modelListInvalidatingFields\.has\(field\)/);
  assert.match(clearKeySource, /resetModelListState\(\)/);
  assert.match(headersSource, /resetModelListState\(\)/);
});

test("model settings validates API draft before testing or fetching models", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));
  const fetchSource = modalSource.slice(modalSource.indexOf("async function fetchModelOptions"), modalSource.indexOf("async function saveAndFetchModels"));
  const saveFetchSource = modalSource.slice(modalSource.indexOf("async function saveAndFetchModels"), modalSource.indexOf("async function saveAndTestConfig"));
  const testSource = modalSource.slice(modalSource.indexOf("async function testConnection"), modalSource.indexOf("async function fetchModelOptions"));

  assert.match(modalSource, /validateModelApiDraft/);
  assert.match(fetchSource, /requireModel:\s*false/);
  assert.match(saveFetchSource, /requireModel:\s*false/);
  assert.match(testSource, /requireModel:\s*true/);
  assert.match(modalSource, /setStatus\(validation\.message\)/);
});

test("model settings can save and test a profile in one action", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));

  assert.match(modalSource, /async function saveAndTestConfig\(\)/);
  assert.match(modalSource, /const nextConfig = buildModelConfigForSave\(config,\s*modelOptions\)/);
  assert.match(modalSource, /await onSave\(\{ \.\.\.nextConfig,\s*extraHeaders:\s*parseModelHeaderLines\(headersText\) \}\)/);
  assert.match(modalSource, /await testConnection\(nextConfig\)/);
  assert.match(modalSource, />\s*保存并测试\s*</);
});

test("model settings confirms which profile and model were saved", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));

  assert.match(modalSource, /function buildSavedModelStatus\(savedConfig = config\)/);
  assert.match(modalSource, /模型 API 配置已保存/);
  assert.match(modalSource, /档案：\$\{profileName \|\| savedConfig\.provider \|\| "默认档案"\}/);
  assert.match(modalSource, /模型：\$\{savedConfig\.model \|\| "未填写"\}/);
  assert.match(modalSource, /setTestStatus\(buildSavedModelStatus\(nextConfig\)\)/);
  assert.match(modalSource, /await onSave\(\{ \.\.\.nextConfig,\s*extraHeaders:\s*parseModelHeaderLines\(headersText\) \}\);\s*setTestStatus\(buildSavedModelStatus\(nextConfig\)\)/);
});

test("model settings visible copy stays plain Chinese", () => {
  const app = readFileSync(appPath, "utf8");
  const modalSource = app.slice(app.indexOf("function ModelSettingsModal"), app.indexOf("function ReleaseInfoModal"));

  for (const label of [
    "模型 API 配置",
    "模型列表",
    "清空列表",
    "获取模型列表",
    "模型接口诊断",
    "复制状态",
    "复制排障信息",
    "保存并测试",
    "保存并获取模型",
    "保存为档案",
  ]) {
    assert.match(modalSource, new RegExp(label));
  }

  assert.doesNotMatch(modalSource, /妯|閰|鑾|淇濆瓨|澶辫触|骞惰幏|鎺掗殰|鐘舶|鐘舵|榛樿|鏈|娓呯┖/);
});
