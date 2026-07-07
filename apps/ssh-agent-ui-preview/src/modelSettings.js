export const MASKED_MODEL_API_KEY = "sk-************************";
export const MODEL_API_KEY_SAVED_LABEL = "已加密保存";

export function hasNewModelApiKey(value) {
  const key = String(value || "").trim();
  if (!key) return false;
  if (key === MASKED_MODEL_API_KEY || key === MODEL_API_KEY_SAVED_LABEL) return false;
  return !(key.startsWith("sk-") && new Set(key.slice(3)).size === 1 && key.slice(3).includes("*"));
}

export function buildStoredModelConfig(config) {
  const rawApiFormat = String(config?.apiFormat || config?.api_format || "openai").trim().toLowerCase();
  const apiFormat = rawApiFormat === "anthropic" ? "anthropic" : "openai";
  return {
    provider: String(config?.provider || "").trim(),
    baseUrl: normalizeModelBaseUrl(config?.baseUrl),
    model: String(config?.model || "").trim(),
    apiFormat,
    apiKey: "",
    apiKeyRef: String(config?.apiKeyRef || "").trim(),
    hasApiKey: Boolean(config?.hasApiKey || config?.apiKeyRef),
    extraHeaders: normalizeModelHeaders(config?.extraHeaders),
    modelOptions: filterModelOptions(config?.modelOptions),
  };
}

export function buildModelConfigForSave(config = {}, fetchedModelOptions = []) {
  const modelOptions = filterModelOptions(
    Array.isArray(fetchedModelOptions) && fetchedModelOptions.length > 0
      ? fetchedModelOptions
      : config?.modelOptions,
  );
  const model = String(config?.model || "").trim() || modelOptions[0] || "";
  return {
    ...config,
    model,
    modelOptions,
  };
}

export function validateModelApiDraft(config = {}, options = {}) {
  const requireModel = options.requireModel !== false;
  const baseUrl = normalizeModelBaseUrl(config?.baseUrl);
  const model = String(config?.model || "").trim();
  const modelOptions = filterModelOptions(config?.modelOptions);
  if (!baseUrl) {
    return {
      ok: false,
      message: "请先填写模型 API 的 Base URL，例如 https://你的中转站/v1；填写后再保存、测试或获取模型列表。",
    };
  }
  if (requireModel && !model && modelOptions.length === 0) {
    return {
      ok: false,
      message: "请先填写默认模型，或先获取模型列表后选择模型；没有默认模型时无法测试模型 API 对话。",
    };
  }
  return { ok: true, message: "" };
}

export function normalizeModelBaseUrl(value = "") {
  let text = String(value || "").trim().replace(/\/+$/g, "");
  for (const suffix of ["/chat/completions", "/responses", "/models", "/api/tags"]) {
    if (text.toLowerCase().endsWith(suffix)) {
      text = text.slice(0, -suffix.length).replace(/\/+$/g, "");
      break;
    }
  }
  return text;
}

export function buildModelProfile(config, options = {}) {
  const storedConfig = buildStoredModelConfig(config);
  const id = String(options.id || config?.id || createModelProfileId(storedConfig)).trim();
  const name = String(options.name || config?.name || buildModelProfileName(storedConfig)).trim();
  return {
    id,
    name: name || "默认模型 API",
    config: storedConfig,
    ...(normalizeModelProfileTestResult(config?.lastTest) ? { lastTest: normalizeModelProfileTestResult(config.lastTest) } : {}),
  };
}

export function normalizeModelProfiles(profiles = [], activeConfig = {}) {
  const normalized = [];
  const seen = new Set();

  for (const item of Array.isArray(profiles) ? profiles : []) {
    const profile = buildModelProfile(item?.config || item, { id: item?.id, name: item?.name });
    if (!profile.id || seen.has(profile.id)) continue;
    seen.add(profile.id);
    normalized.push(profile);
  }

  if (normalized.length === 0) {
    normalized.push(buildModelProfile(activeConfig, { id: "default", name: buildModelProfileName(activeConfig) }));
  }

  return normalized;
}

export function upsertModelProfile(profiles = [], profile) {
  const nextProfile = buildModelProfile(profile?.config || profile, { id: profile?.id, name: profile?.name });
  const normalized = normalizeModelProfiles(profiles, nextProfile.config);
  const existingIndex = normalized.findIndex((item) => item.id === nextProfile.id);
  if (existingIndex >= 0) {
    return normalized.map((item, index) => (index === existingIndex ? nextProfile : item));
  }
  return [...normalized, nextProfile];
}

export function removeModelProfile(profiles = [], profileId, fallbackConfig = {}) {
  const normalized = normalizeModelProfiles(profiles, fallbackConfig);
  const remaining = normalized.filter((item) => item.id !== profileId);
  return remaining.length > 0 ? remaining : normalizeModelProfiles([], fallbackConfig);
}

export function updateModelProfileTestResult(profiles = [], profileId, result = {}, meta = {}) {
  const normalized = normalizeModelProfiles(profiles, {});
  return normalized.map((profile) => {
    if (profile.id !== profileId) return profile;
    return {
      ...profile,
      lastTest: {
        ok: Boolean(result?.ok),
        message: String(result?.message || ""),
        latencyMs: Number(meta?.latencyMs || result?.latencyMs || 0),
        testedAt: String(meta?.testedAt || result?.testedAt || new Date().toLocaleString("zh-CN")),
      },
    };
  });
}

export function normalizeModelProfileTestResult(result = {}) {
  if (!result || typeof result !== "object") return null;
  const message = String(result.message || "").trim();
  const testedAt = String(result.testedAt || "").trim();
  const rawLatencyMs = Number(result.latencyMs || 0);
  const latencyMs = Number.isFinite(rawLatencyMs) ? Math.max(0, Math.round(rawLatencyMs)) : 0;
  return {
    ok: Boolean(result.ok),
    message,
    latencyMs,
    testedAt,
  };
}

export function formatModelProfileTestStatus(profile = {}) {
  const lastTest = profile?.lastTest;
  if (!lastTest) return "未测试";
  if (lastTest.ok) {
    const latency = Number(lastTest.latencyMs || 0);
    return latency > 0 ? `可用 ${latency}ms` : "可用";
  }
  const message = String(lastTest.message || "").trim();
  return message ? `失败 ${message}` : "失败";
}

export function maskModelApiKey(config) {
  return config?.hasApiKey || config?.apiKeyRef ? MODEL_API_KEY_SAVED_LABEL : "";
}

export function parseModelHeaderLines(text = "") {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) return null;
      return normalizeModelHeader({
        name: line.slice(0, separatorIndex),
        value: line.slice(separatorIndex + 1),
        enabled: true,
      });
    })
    .filter(Boolean);
}

export function filterModelOptions(options = [], query = "") {
  const seen = new Set();
  const models = [];
  for (const option of Array.isArray(options) ? options : []) {
    const model = normalizeModelOptionValue(option);
    if (!model || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
  }

  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return models;
  return models.filter((model) => model.toLowerCase().includes(needle));
}

export function extractModelOptions(payload = {}) {
  if (Array.isArray(payload)) return filterModelOptions(payload);
  if (!payload || typeof payload !== "object") return [];

  const candidates = [
    payload.models,
    payload.data,
    payload.items,
    payload.model_list,
    payload.modelList,
    payload.available_models,
    payload.availableModels,
    payload.modelIds,
    payload.records,
    payload.choices,
    payload.result?.models,
    payload.result?.data,
    payload.result?.items,
    payload.result?.model_list,
    payload.result?.modelList,
    payload.result?.available_models,
    payload.result?.availableModels,
    payload.result?.modelIds,
    payload.result?.records,
    payload.result?.choices,
    payload.response?.models,
    payload.response?.data,
    payload.response?.items,
    payload.response?.model_list,
    payload.response?.modelList,
    payload.response?.available_models,
    payload.response?.availableModels,
    payload.response?.modelIds,
    payload.response?.records,
    payload.response?.choices,
  ];

  for (const candidate of candidates) {
    const models = filterModelOptions(candidate);
    if (models.length > 0) return models;
  }
  return [];
}

function normalizeModelOptionValue(option) {
  if (typeof option === "string" || typeof option === "number") {
    return String(option || "").trim();
  }
  if (!option || typeof option !== "object") return "";
  return String(
    option.id
      || option.model
      || option.model_id
      || option.modelId
      || option.slug
      || option.uid
      || option.key
      || option.name
      || option.value
      || option.display_name
      || option.displayName
      || option.label
      || option.title
      || "",
  ).trim();
}

export function formatModelHeaderLines(headers = []) {
  return normalizeModelHeaders(headers)
    .map((item) => `${item.name}: ${item.value}`)
    .join("\n");
}

export function normalizeModelHeaders(headers = []) {
  return (Array.isArray(headers) ? headers : [])
    .map(normalizeModelHeader)
    .filter(Boolean);
}

function normalizeModelHeader(header) {
  const name = String(header?.name || "").trim();
  const value = String(header?.value || "").trim();
  if (!name || !value || isSensitiveModelHeaderName(name)) return null;
  if (!/^[A-Za-z0-9-]+$/.test(name)) return null;
  return { name, value, enabled: header?.enabled !== false };
}

function isSensitiveModelHeaderName(name) {
  return /(^authorization$|api[-_]?key|token|secret|cookie)/i.test(String(name || "").trim());
}

function buildModelProfileName(config) {
  const provider = String(config?.provider || "").trim();
  const model = String(config?.model || "").trim();
  const baseUrl = String(config?.baseUrl || "").trim();
  if (provider && model) return `${provider} / ${model}`;
  if (provider) return provider;
  if (model) return model;
  if (baseUrl) return baseUrl;
  return "默认模型 API";
}

function createModelProfileId(config) {
  const source = [config?.provider || "", config?.baseUrl || "", config?.model || ""].join("|") || "default";
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash) + source.charCodeAt(index);
    hash >>>= 0;
  }
  return `model-${hash.toString(36)}`;
}
