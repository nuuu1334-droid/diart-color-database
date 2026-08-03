/**
 * DiArt Color Engine
 * Framework v3.0.0
 */

const ENGINE_VERSION = "3.0.0";

const extractor = input.extractor;
const baseUrl =
  input.base_url ||
  "https://raw.githubusercontent.com/nuuu1334-droid/DiArt_engine/main";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`DiArt: ${message}`);
  }
}

function normalizeBaseUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

async function fetchJson(filename) {
  const url = `${normalizeBaseUrl(baseUrl)}/${filename}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(
      `DiArt: не удалось загрузить ${filename}. HTTP ${response.status}`
    );
  }

  return response.json();
}

function mergeModules(modules) {
  const result = {};

  for (const moduleData of modules) {
    if (!moduleData || typeof moduleData !== "object") {
      continue;
    }

    Object.assign(result, moduleData);
  }

  return result;
}

function validateExtractor(data) {
  assert(data, "не передан extractor");
  assert(typeof data === "object", "extractor должен быть объектом");
  assert(data.extractor_version, "нет extractor_version");
  assert(data.analysis_status, "нет analysis_status");
  assert(data.image_quality, "нет image_quality");
  assert(data.observed_colors, "нет observed_colors");
  assert(data.visual_features, "нет visual_features");
  assert(data.contrast_features, "нет contrast_features");
}

function validateConfig(config) {
  const requiredSections = [
    "engine",
    "quality_analysis",
    "feature_extraction",
    "temperature_engine",
    "value_engine",
    "chroma_engine",
    "contrast_engine",
    "season_scoring",
    "confusion_resolution",
    "season_selection"
  ];

  const missingSections = requiredSections.filter(
    section => !config[section]
  );

  assert(
    missingSections.length === 0,
    `отсутствуют разделы: ${missingSections.join(", ")}`
  );

  return missingSections;
}

function createContext(extractorData, config) {
  return {
    framework_version: ENGINE_VERSION,

    extractor: extractorData,
    config,

    quality: null,

    dimensions: {
      temperature: null,
      value: null,
      chroma: null,
      contrast: null
    },

    ranking: [],
    excluded: [],
    confusion_resolution: null,

    result: {
      best_match: null,
      second_match: null,
      third_match: null,
      confidence: 0,
      request_better_photo: false
    },

    logs: []
  };
}

validateExtractor(extractor);

const manifest = await fetchJson("manifest.json");

assert(manifest.entrypoint, "в manifest нет entrypoint");
assert(manifest.modules, "в manifest нет modules");

const moduleFiles = [
  manifest.entrypoint,
  ...Object.values(manifest.modules)
];

const uniqueFiles = [...new Set(moduleFiles.filter(Boolean))];

const loadedModules = [];

for (const filename of uniqueFiles) {
  const moduleData = await fetchJson(filename);

  loadedModules.push({
    filename,
    data: moduleData
  });
}

const config = mergeModules(
  loadedModules.map(item => item.data)
);

validateConfig(config);

const context = createContext(extractor, config);

return {
  ok: true,
  stage: "framework_ready",

  framework_version: ENGINE_VERSION,

  engine: {
    name: config.engine.name,
    version: config.engine.version,
    status: config.engine.status
  },

  extractor: {
    version: extractor.extractor_version,
    analysis_status: extractor.analysis_status,
    image_quality: extractor.image_quality.status,
    global_reliability: extractor.global_reliability
  },

  loaded_files: uniqueFiles,
  loaded_file_count: uniqueFiles.length,

  context_ready: Boolean(context),
  config_ready: true
};
