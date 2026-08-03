/**
 * DiArt Color Engine
 * Framework v3.1.0
 * Temperature Engine v1
 */

const FRAMEWORK_VERSION = "3.1.0";

const extractor = input.extractor;
const baseUrl =
  input.base_url ||
  "https://raw.githubusercontent.com/nuuu1334-droid/diart-color-database/main";

/* =========================================================
   UTILITIES
========================================================= */

function assert(condition, message) {
  if (!condition) {
    throw new Error(`DiArt: ${message}`);
  }
}

function clamp(value, min = 0, max = 1) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(max, Math.max(min, number));
}

function round(value, digits = 3) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function normalizeBaseUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function isUnknown(value) {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    value === "unknown" ||
    value === "uncertain" ||
    value === "unclear"
  );
}

/* =========================================================
   CONFIGURATION LOADER
========================================================= */

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
    if (moduleData && typeof moduleData === "object") {
      Object.assign(result, moduleData);
    }
  }

  return result;
}

/* =========================================================
   VALIDATION
========================================================= */

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
}

/* =========================================================
   CONTEXT
========================================================= */

function createContext(extractorData, config) {
  return {
    framework_version: FRAMEWORK_VERSION,

    extractor: extractorData,
    config,

    quality: {
      status: extractorData.image_quality?.status ?? "poor",
      reliability:
        extractorData.image_quality?.analysis_reliability ?? 0
    },

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

/* =========================================================
   TEMPERATURE ENGINE
========================================================= */

function getSourceWeight(config, sourceName) {
  const source = config.temperature_engine.evidence_priority.find(
    item => item.source === sourceName
  );

  return source ? Number(source.weight) : 0;
}

function getTemperatureMapping(config, sourceName, value) {
  const rulesSection =
    config.temperature_engine[`${sourceName}_rules`];

  if (!rulesSection?.temperature || isUnknown(value)) {
    return null;
  }

  return rulesSection.temperature[value] ?? null;
}

function getHairMultiplier(extractorData) {
  const naturalness =
    extractorData.image_quality?.hair_naturalness ?? "unclear";

  const multipliers = {
    likely_natural: 1,
    possibly_colored: 0.45,
    likely_colored: 0,
    unclear: 0.35,

    natural: 1,
    colored: 0,
    unknown: 0.35
  };

  return multipliers[naturalness] ?? 0.35;
}

function getQualityMultiplier(config, qualityStatus) {
  const multipliers =
    config.temperature_engine.confidence_rules
      ?.quality_multipliers ?? {};

  return Number(multipliers[qualityStatus] ?? 0);
}

function buildTemperatureSources(extractorData) {
  return [
    {
      source: "skin",
      field: "skin_temperature",
      value:
        extractorData.visual_features?.skin_temperature?.value,
      score:
        extractorData.visual_features?.skin_temperature?.score,
      confidence:
        extractorData.visual_features?.skin_temperature?.confidence,
      sourceMultiplier: 1
    },
    {
      source: "eyes",
      field: "eye_temperature",
      value:
        extractorData.visual_features?.eye_temperature?.value,
      score:
        extractorData.visual_features?.eye_temperature?.score,
      confidence:
        extractorData.visual_features?.eye_temperature?.confidence,
      sourceMultiplier: 1
    },
    {
      source: "hair",
      field: "hair_temperature",
      value:
        extractorData.visual_features?.hair_temperature?.value,
      score:
        extractorData.visual_features?.hair_temperature?.score,
      confidence:
        extractorData.visual_features?.hair_temperature?.confidence,
      sourceMultiplier: getHairMultiplier(extractorData)
    }
  ];
}

function calculateConflictLevel(evidence) {
  const warmSources = evidence.filter(
    item =>
      item.observed_value === "warm" ||
      item.observed_value === "neutral_warm"
  ).length;

  const coolSources = evidence.filter(
    item =>
      item.observed_value === "cool" ||
      item.observed_value === "neutral_cool"
  ).length;

  if (warmSources > 0 && coolSources > 0) {
    if (warmSources >= 2 || coolSources >= 2) {
      return "strong";
    }

    return "moderate";
  }

  return "none";
}

function classifyTemperature(
  config,
  warmScore,
  coolScore,
  confidence,
  evidenceWeight
) {
  const engine = config.temperature_engine;
  const thresholds = engine.classification_thresholds;
  const minimumWeight =
    engine.global_rules.minimum_total_evidence_weight ?? 0.35;

  if (evidenceWeight < minimumWeight || confidence < 0.4) {
    return "uncertain";
  }

  const gap = warmScore - coolScore;
  const absoluteGap = Math.abs(gap);

  if (
    warmScore >= thresholds.warm.minimum_warm_score &&
    gap >= thresholds.warm.minimum_gap_over_cool
  ) {
    return "warm";
  }

  if (
    coolScore >= thresholds.cool.minimum_cool_score &&
    -gap >= thresholds.cool.minimum_gap_over_warm
  ) {
    return "cool";
  }

  if (
    warmScore >= thresholds.neutral_warm.minimum_warm_score &&
    gap >= thresholds.neutral_warm.minimum_gap_over_cool
  ) {
    return "neutral_warm";
  }

  if (
    coolScore >= thresholds.neutral_cool.minimum_cool_score &&
    -gap >= thresholds.neutral_cool.minimum_gap_over_warm
  ) {
    return "neutral_cool";
  }

  if (
    absoluteGap <=
      thresholds.neutral.maximum_gap_between_warm_and_cool &&
    confidence >=
      thresholds.neutral.minimum_total_confidence
  ) {
    return "neutral";
  }

  if (gap > 0) {
    return "neutral_warm";
  }

  if (gap < 0) {
    return "neutral_cool";
  }

  return "neutral";
}

function calculateTemperature(context) {
  const config = context.config;
  const extractorData = context.extractor;

  const sources = buildTemperatureSources(extractorData);

  let warmTotal = 0;
  let coolTotal = 0;
  let neutralTotal = 0;

  let totalWeight = 0;
  let confidenceWeightedTotal = 0;

  const evidence = [];

  for (const sourceData of sources) {
    if (
      isUnknown(sourceData.value) ||
      Number(sourceData.sourceMultiplier) <= 0
    ) {
      continue;
    }

    const mapping = getTemperatureMapping(
      config,
      sourceData.source,
      sourceData.value
    );

    if (!mapping) {
      continue;
    }

    const sourceWeight = getSourceWeight(
      config,
      sourceData.source
    );

    const featureConfidence = clamp(
      sourceData.confidence ?? 0
    );

    if (sourceWeight <= 0 || featureConfidence <= 0) {
      continue;
    }

    const weightUsed =
      sourceWeight *
      featureConfidence *
      sourceData.sourceMultiplier;

    const warmContribution =
      Number(mapping.warm ?? 0) * weightUsed;

    const coolContribution =
      Number(mapping.cool ?? 0) * weightUsed;

    const neutralContribution =
      Number(mapping.neutral ?? 0) * weightUsed;

    warmTotal += warmContribution;
    coolTotal += coolContribution;
    neutralTotal += neutralContribution;

    totalWeight += weightUsed;

    confidenceWeightedTotal +=
      featureConfidence * weightUsed;

    evidence.push({
      source: sourceData.source,
      field: sourceData.field,
      observed_value: sourceData.value,

      warm_contribution: round(warmContribution, 4),
      cool_contribution: round(coolContribution, 4),
      neutral_contribution: round(neutralContribution, 4),

      weight_used: round(weightUsed, 4),
      feature_confidence: round(featureConfidence, 3),

      note:
        sourceData.source === "hair"
          ? `hair multiplier: ${sourceData.sourceMultiplier}`
          : ""
    });
  }

  if (totalWeight === 0) {
    return {
      warm_score: 0,
      cool_score: 0,
      neutral_score: 0,
      classification: "uncertain",
      confidence: 0,
      evidence: [],
      conflicts: ["no_usable_temperature_evidence"]
    };
  }

  const totalContribution =
    warmTotal + coolTotal + neutralTotal;

  let warmScore = 0;
  let coolScore = 0;
  let neutralScore = 0;

  if (totalContribution > 0) {
    warmScore = (warmTotal / totalContribution) * 100;
    coolScore = (coolTotal / totalContribution) * 100;
    neutralScore =
      (neutralTotal / totalContribution) * 100;
  }

  const conflictLevel =
    calculateConflictLevel(evidence);

  const conflictPenalty =
    config.temperature_engine.confidence_rules
      ?.conflict_penalty?.[conflictLevel] ?? 0;

  const qualityMultiplier = getQualityMultiplier(
    config,
    context.quality.status
  );

  let confidence =
    confidenceWeightedTotal / totalWeight;

  confidence *= qualityMultiplier;
  confidence -= conflictPenalty;

  const globalReliability = clamp(
    extractorData.global_reliability ?? 1
  );

  confidence = Math.min(
    clamp(confidence),
    globalReliability
  );

  const classification = classifyTemperature(
    config,
    warmScore,
    coolScore,
    confidence,
    totalWeight
  );

  const conflicts = [];

  if (conflictLevel !== "none") {
    conflicts.push(
      `${conflictLevel}_warm_cool_source_conflict`
    );
  }

  return {
    warm_score: round(warmScore, 1),
    cool_score: round(coolScore, 1),
    neutral_score: round(neutralScore, 1),

    classification,
    confidence: round(confidence, 3),

    total_evidence_weight: round(totalWeight, 3),
    conflict_level: conflictLevel,

    evidence,
    conflicts
  };
}

/* =========================================================
   EXECUTION
========================================================= */

validateExtractor(extractor);

const manifest = await fetchJson("manifest.json");

assert(manifest.entrypoint, "в manifest нет entrypoint");
assert(manifest.modules, "в manifest нет modules");

const moduleFiles = [
  manifest.entrypoint,
  ...Object.values(manifest.modules)
];

const uniqueFiles = [
  ...new Set(moduleFiles.filter(Boolean))
];

const loadedModules = [];

for (const filename of uniqueFiles) {
  loadedModules.push({
    filename,
    data: await fetchJson(filename)
  });
}

const config = mergeModules(
  loadedModules.map(item => item.data)
);

validateConfig(config);

const context = createContext(extractor, config);

context.dimensions.temperature =
  calculateTemperature(context);

context.logs.push({
  module: "temperature_engine",
  classification:
    context.dimensions.temperature.classification,
  confidence:
    context.dimensions.temperature.confidence
});

/* =========================================================
   OUTPUT
========================================================= */

return {
  ok: true,
  stage: "temperature_ready",

  framework_version: FRAMEWORK_VERSION,

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

  dimensions: {
    temperature: context.dimensions.temperature
  },

  loaded_file_count: uniqueFiles.length,
  context_ready: true,
  config_ready: true
};
