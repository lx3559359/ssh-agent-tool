import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelProfile,
  buildModelConfigForSave,
  formatModelProfileTestStatus,
  buildStoredModelConfig,
  extractModelOptions,
  filterModelOptions,
  normalizeModelProfiles,
  removeModelProfile,
  updateModelProfileTestResult,
  upsertModelProfile,
  hasNewModelApiKey,
  maskModelApiKey,
  parseModelHeaderLines,
  validateModelApiDraft,
  normalizeModelBaseUrl,
} from "./modelSettings.js";

test("hasNewModelApiKey ignores empty and masked values", () => {
  assert.equal(hasNewModelApiKey(""), false);
  assert.equal(hasNewModelApiKey("sk-************************"), false);
  assert.equal(hasNewModelApiKey("已加密保存"), false);
  assert.equal(hasNewModelApiKey("sk-real-secret"), true);
});

test("buildStoredModelConfig removes plaintext api key but preserves encrypted reference", () => {
  const config = buildStoredModelConfig({
    provider: "OpenAI 兼容",
    baseUrl: "https://api.example.com/v1",
    model: "test-model",
    apiKey: "sk-real-secret",
    apiKeyRef: "sshcred-model",
    hasApiKey: true,
    extraHeaders: [
      { name: "HTTP-Referer", value: "https://ops.example.com", enabled: true },
      { name: "Authorization", value: "Bearer should-not-persist", enabled: true },
    ],
  });

  assert.equal(config.apiKey, "");
  assert.equal(config.apiKeyRef, "sshcred-model");
  assert.equal(config.hasApiKey, true);
  assert.deepEqual(config.extraHeaders, [
    { name: "HTTP-Referer", value: "https://ops.example.com", enabled: true },
  ]);
});

test("buildStoredModelConfig preserves supported API format for non OpenAI providers", () => {
  const config = buildStoredModelConfig({
    provider: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com",
    model: "claude-3-5-sonnet-latest",
    apiFormat: "anthropic",
    api_format: "openai",
  });

  assert.equal(config.apiFormat, "anthropic");
});

test("buildModelConfigForSave fills an empty default model from fetched options", () => {
  const config = buildModelConfigForSave(
    {
      provider: "Relay",
      baseUrl: "https://relay.example/v1",
      model: "",
      modelOptions: ["", "relay-a"],
    },
    ["relay-a", "relay-b", "relay-a"],
  );

  assert.equal(config.model, "relay-a");
  assert.deepEqual(config.modelOptions, ["relay-a", "relay-b"]);
});

test("buildStoredModelConfig preserves fetched model options without secrets", () => {
  const config = buildStoredModelConfig({
    provider: "OpenAI compatible",
    baseUrl: "https://api.example.com/v1",
    model: "gpt-4.1-mini",
    apiKey: "sk-real-secret",
    modelOptions: [
      "gpt-4.1-mini",
      " deepseek-chat ",
      "",
      "gpt-4.1-mini",
    ],
  });

  assert.deepEqual(config.modelOptions, ["gpt-4.1-mini", "deepseek-chat"]);
  assert.equal(config.apiKey, "");
  assert.equal(JSON.stringify(config).includes("sk-real-secret"), false);
});

test("buildStoredModelConfig normalizes pasted model endpoint urls", () => {
  const config = buildStoredModelConfig({
    provider: "Relay",
    baseUrl: " https://relay.example/openai/v1/chat/completions/ ",
    model: "gpt-compatible",
  });

  assert.equal(config.baseUrl, "https://relay.example/openai/v1");
});

test("buildStoredModelConfig normalizes pasted model list endpoint urls", () => {
  const config = buildStoredModelConfig({
    provider: "Relay",
    baseUrl: " https://relay.example/openai/v1/models/ ",
    model: "gpt-compatible",
  });

  assert.equal(config.baseUrl, "https://relay.example/openai/v1");
});

test("buildStoredModelConfig normalizes pasted Ollama native tags endpoint urls", () => {
  const config = buildStoredModelConfig({
    provider: "Ollama 本地",
    baseUrl: " http://127.0.0.1:11434/api/tags/ ",
    model: "qwen2.5-coder:7b",
  });

  assert.equal(config.baseUrl, "http://127.0.0.1:11434");
});

test("buildStoredModelConfig normalizes pasted responses endpoint urls", () => {
  assert.equal(
    normalizeModelBaseUrl(" https://relay.example/openai/v1/responses/ "),
    "https://relay.example/openai/v1",
  );

  const config = buildStoredModelConfig({
    provider: "Relay",
    baseUrl: "https://relay.example/openai/v1/responses",
    model: "gpt-compatible",
  });

  assert.equal(config.baseUrl, "https://relay.example/openai/v1");
});

test("maskModelApiKey shows saved key state without exposing the secret", () => {
  assert.equal(maskModelApiKey({ hasApiKey: true, apiKeyRef: "sshcred-model" }), "已加密保存");
  assert.equal(maskModelApiKey({ hasApiKey: false }), "");
});

test("parseModelHeaderLines keeps relay metadata headers and rejects sensitive headers", () => {
  const headers = parseModelHeaderLines([
    "HTTP-Referer: https://ops.example.com",
    "X-Title: SSH Agent Tool",
    "Authorization: Bearer secret",
    "X-API-Key: secret",
    "broken",
  ].join("\n"));

  assert.deepEqual(headers, [
    { name: "HTTP-Referer", value: "https://ops.example.com", enabled: true },
    { name: "X-Title", value: "SSH Agent Tool", enabled: true },
  ]);
});

test("validateModelApiDraft blocks missing base url before model API actions", () => {
  const result = validateModelApiDraft({ provider: "中转站 API", baseUrl: "", model: "gpt-4.1-mini" });

  assert.equal(result.ok, false);
  assert.match(result.message, /Base URL/);
  assert.match(result.message, /模型 API/);
});

test("validateModelApiDraft requires a default model only for chat or connection tests", () => {
  const listResult = validateModelApiDraft({ baseUrl: "https://relay.example/v1", model: "" }, { requireModel: false });
  const testResult = validateModelApiDraft({ baseUrl: "https://relay.example/v1", model: "" }, { requireModel: true });

  assert.equal(listResult.ok, true);
  assert.equal(testResult.ok, false);
  assert.match(testResult.message, /默认模型/);
  assert.match(testResult.message, /获取模型列表/);
});

test("filterModelOptions dedupes and searches large relay model lists", () => {
  const models = filterModelOptions([
    "gpt-4.1-mini",
    " deepseek-chat ",
    "",
    "gpt-4.1-mini",
    "Qwen-Plus",
    null,
  ], "GPT");

  assert.deepEqual(models, ["gpt-4.1-mini"]);
  assert.deepEqual(filterModelOptions(["deepseek-chat", "qwen-plus"], "plus"), ["qwen-plus"]);
  assert.deepEqual(filterModelOptions(["deepseek-chat", "qwen-plus"], ""), ["deepseek-chat", "qwen-plus"]);
});

test("filterModelOptions accepts object model entries returned by API bridges", () => {
  const models = filterModelOptions([
    { id: "gpt-4.1-mini", name: "GPT 4.1 Mini" },
    { name: "deepseek-chat" },
    { model: "qwen-plus" },
    { value: "moonshot-v1-8k" },
    { id: "gpt-4.1-mini", name: "duplicate" },
    { id: "" },
    null,
  ], "gpt");

  assert.deepEqual(models, ["gpt-4.1-mini"]);
  assert.deepEqual(filterModelOptions([{ id: "gpt-4.1-mini" }, { name: "deepseek-chat" }, { model: "qwen-plus" }]), [
    "gpt-4.1-mini",
    "deepseek-chat",
    "qwen-plus",
  ]);
});

test("filterModelOptions accepts relay aliases without using display labels as ids first", () => {
  const models = filterModelOptions([
    { model_id: "anthropic/claude-sonnet-4", display_name: "Claude Sonnet 4" },
    { slug: "openrouter/horizon-beta", label: "OpenRouter Horizon Beta" },
    { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
    { display_name: "Display Only Model" },
    { displayName: "Camel Display Only Model" },
    { label: "Label Only Model" },
  ]);

  assert.deepEqual(models, [
    "anthropic/claude-sonnet-4",
    "openrouter/horizon-beta",
    "models/gemini-2.5-pro",
    "Display Only Model",
    "Camel Display Only Model",
    "Label Only Model",
  ]);
});

test("extractModelOptions reads common provider and bridge model list payloads", () => {
  assert.deepEqual(extractModelOptions({
    data: [
      { id: "gpt-4.1-mini" },
      { id: "deepseek-chat" },
    ],
  }), ["gpt-4.1-mini", "deepseek-chat"]);

  assert.deepEqual(extractModelOptions({
    models: [
      { name: "qwen2.5-coder:7b" },
      { model: "llama3.1:8b" },
    ],
  }), ["qwen2.5-coder:7b", "llama3.1:8b"]);

  assert.deepEqual(extractModelOptions({
    result: {
      models: [
        { model_id: "anthropic/claude-sonnet-4" },
        { slug: "openrouter/horizon-beta" },
      ],
    },
  }), ["anthropic/claude-sonnet-4", "openrouter/horizon-beta"]);
});

test("extractModelOptions reads nonstandard relay model list fields", () => {
  assert.deepEqual(extractModelOptions({
    model_list: [
      { id: "relay-model-list-a" },
      { model: "relay-model-list-b" },
    ],
  }), ["relay-model-list-a", "relay-model-list-b"]);

  assert.deepEqual(extractModelOptions({
    result: {
      choices: [
        { value: "choice-gpt", label: "Choice GPT" },
        { displayName: "Display Name Only" },
      ],
    },
  }), ["choice-gpt", "Display Name Only"]);
});

test("extractModelOptions reads additional relay collection fields", () => {
  assert.deepEqual(extractModelOptions({
    available_models: [
      { id: "relay-available-a" },
      { modelId: "relay-model-id-b", displayName: "Relay Model Id B" },
    ],
  }), ["relay-available-a", "relay-model-id-b"]);

  assert.deepEqual(extractModelOptions({
    response: {
      records: [
        { uid: "relay-record-a", title: "Relay Record A" },
        { key: "relay-record-b" },
      ],
    },
  }), ["relay-record-a", "relay-record-b"]);
});

test("buildModelProfile stores a named redacted model API profile", () => {
  const profile = buildModelProfile({
    provider: "中转站 API",
    baseUrl: "https://api.aigh.store",
    model: "gpt-5.5",
    apiKey: "sk-real-secret",
    apiKeyRef: "sshcred-model",
    hasApiKey: true,
  }, { id: "aigh", name: "AIGH 中转站" });

  assert.equal(profile.id, "aigh");
  assert.equal(profile.name, "AIGH 中转站");
  assert.equal(profile.config.apiKey, "");
  assert.equal(profile.config.apiKeyRef, "sshcred-model");
  assert.equal(profile.config.baseUrl, "https://api.aigh.store");
});

test("buildModelProfile preserves safe connection test status", () => {
  const profile = buildModelProfile({
    provider: "中转站 API",
    baseUrl: "https://api.aigh.store",
    model: "gpt-5.5",
    lastTest: {
      ok: true,
      message: "模型 API 连接测试通过。",
      latencyMs: 128,
      testedAt: "2026-06-29 13:50:00",
      apiKey: "sk-must-not-store",
    },
  }, { id: "relay", name: "Relay" });

  assert.deepEqual(profile.lastTest, {
    ok: true,
    message: "模型 API 连接测试通过。",
    latencyMs: 128,
    testedAt: "2026-06-29 13:50:00",
  });
  assert.equal(JSON.stringify(profile).includes("sk-must-not-store"), false);
});

test("buildModelProfile normalizes invalid connection test latency", () => {
  const profile = buildModelProfile({
    provider: "OpenAI",
    lastTest: {
      ok: false,
      message: "failed",
      latencyMs: "bad",
      testedAt: "2026-06-29 14:10:00",
    },
  });

  assert.equal(profile.lastTest.latencyMs, 0);
});

test("normalizeModelProfiles dedupes profiles and falls back to the active config", () => {
  const profiles = normalizeModelProfiles(
    [
      { id: "relay", name: "Relay A", config: { provider: "中转站 API", baseUrl: "https://a.example/v1", model: "gpt-a" } },
      { id: "relay", name: "Relay Duplicate", config: { provider: "中转站 API", baseUrl: "https://b.example/v1", model: "gpt-b" } },
    ],
    { provider: "OpenAI 兼容", baseUrl: "https://api.example.com/v1", model: "gpt-4.1-mini" },
  );

  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name, "Relay A");

  const fallback = normalizeModelProfiles([], { provider: "OpenAI 兼容", baseUrl: "https://api.example.com/v1", model: "gpt-4.1-mini" });
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].config.model, "gpt-4.1-mini");
});

test("upsertModelProfile updates profiles and removeModelProfile keeps a usable fallback", () => {
  const original = normalizeModelProfiles([], { provider: "OpenAI 兼容", baseUrl: "https://api.example.com/v1", model: "gpt-4.1-mini" });
  const added = upsertModelProfile(original, buildModelProfile(
    { provider: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
    { id: "deepseek", name: "DeepSeek" },
  ));

  assert.equal(added.length, 2);
  assert.equal(added[1].id, "deepseek");

  const updated = upsertModelProfile(added, buildModelProfile(
    { provider: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    { id: "deepseek", name: "DeepSeek 新地址" },
  ));
  assert.equal(updated.length, 2);
  assert.equal(updated[1].name, "DeepSeek 新地址");
  assert.equal(updated[1].config.baseUrl, "https://api.deepseek.com/v1");

  const removed = removeModelProfile(updated, "deepseek", { provider: "OpenAI 兼容", baseUrl: "https://api.example.com/v1", model: "gpt-4.1-mini" });
  assert.equal(removed.length, 1);
  assert.notEqual(removed[0].id, "deepseek");
});

test("updateModelProfileTestResult stores safe connection status for a profile", () => {
  const profiles = normalizeModelProfiles([], { provider: "OpenAI 兼容", baseUrl: "https://api.example.com/v1", model: "gpt-4.1-mini" });
  const updated = updateModelProfileTestResult(profiles, "default", {
    ok: true,
    message: "连接测试通过",
    apiKey: "sk-must-not-store",
  }, {
    latencyMs: 238,
    testedAt: "2026-06-26 11:30:00",
  });

  assert.equal(updated[0].lastTest.ok, true);
  assert.equal(updated[0].lastTest.message, "连接测试通过");
  assert.equal(updated[0].lastTest.latencyMs, 238);
  assert.equal(updated[0].lastTest.testedAt, "2026-06-26 11:30:00");
  assert.equal(JSON.stringify(updated).includes("sk-must-not-store"), false);
});

test("formatModelProfileTestStatus summarizes untested success and failed profiles", () => {
  assert.equal(formatModelProfileTestStatus({}), "未测试");
  assert.equal(formatModelProfileTestStatus({ lastTest: { ok: true, latencyMs: 120 } }), "可用 120ms");
  assert.equal(formatModelProfileTestStatus({ lastTest: { ok: false, message: "bad key" } }), "失败 bad key");
});
