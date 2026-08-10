/**
 * FINAL STABLE COLOR ENGINE FILE
 *
 * This file contains the complete Color Engine pipeline:
 * - modular configuration loader
 * - Feature Extractor adapter
 * - quality gate
 * - Temperature Engine
 * - Value Engine
 * - Chroma Engine
 * - Contrast Engine
 * - season scoring for all 12 seasons
 * - cross-dimension modifiers
 * - exclusion rules
 * - confusion resolution
 * - confidence calculation
 * - final season selection
 *
 * Further calibration should be performed through JSON modules in GitHub,
 * without editing this JavaScript file in Make.
 */

/**
 * DiArt Color Engine v4.9.3
 * Stable Make Code entrypoint loaded from GitHub.
 * Input: input.extractor, input.base_url
 */

const ENGINE_RUNTIME_VERSION = "4.9.5";
const extractor = input.extractor;
const baseUrl = String(input.base_url || "https://raw.githubusercontent.com/nuuu1334-droid/diart-color-database/main").replace(/\/+$/, "");

const UNKNOWN = new Set([undefined, null, "", "unknown", "uncertain", "unclear"]);
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) ? Number(v) : min));
const round = (v, n = 3) => { const p = 10 ** n; return Math.round(Number(v) * p) / p; };
const isUnknown = v => UNKNOWN.has(v);
const assert = (ok, msg) => { if (!ok) throw new Error(`DiArt: ${msg}`); };

async function fetchJson(filename) {
  const response = await fetch(`${baseUrl}/${filename}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`DiArt: ${filename} HTTP ${response.status}`);
  return response.json();
}

async function fetchOptionalJson(filename) {
  try {
    return await fetchJson(filename);
  } catch (error) {
    return null;
  }
}

async function loadConfig() {
  const manifest = await fetchJson("manifest.json");
  assert(manifest.entrypoint && manifest.modules, "invalid manifest.json");

  const files = [...new Set([
    manifest.entrypoint,
    ...Object.values(manifest.modules)
  ].filter(Boolean))];

  const parts = await Promise.all(files.map(fetchJson));

  const optionalFiles = [
    "reliability_engine_v2.json",
    "confidence_engine_v2.json"
  ];

  const optionalParts = await Promise.all(
    optionalFiles.map(fetchOptionalJson)
  );

  const loadedOptionalFiles = optionalFiles.filter(
    (_, index) => optionalParts[index]
  );

  const config = Object.assign(
    {},
    ...parts,
    ...optionalParts.filter(Boolean)
  );

  validateConfig(config);

  return {
    config,
    files: [...files, ...loadedOptionalFiles]
  };
}

function collapseDepth(v) {
  if (["very_light", "light", "light_medium"].includes(v)) return "light";
  if (["medium"].includes(v)) return "medium";
  if (["medium_dark", "medium_deep", "dark", "very_dark", "deep", "very_deep"].includes(v)) return "deep";
  return "uncertain";
}
function mapDepthForConfig(v) {
  return ({ medium_dark: "medium_deep", dark: "deep", very_dark: "very_deep", unclear: "unknown", uncertain: "unknown" })[v] || v || "unknown";
}
function collapseContrast(v) {
  if (["very_low", "low", "low_medium"].includes(v)) return "low";
  if (["medium", "medium_high"].includes(v)) return "medium";
  if (["high", "very_high"].includes(v)) return "high";
  return "uncertain";
}
function collapseDefinition(v) {
  if (["very_low", "low", "low_medium", "soft"].includes(v)) return "soft";
  if (["medium", "medium_high", "moderate"].includes(v)) return "moderate";
  if (["high", "defined"].includes(v)) return "defined";
  if (["very_high", "striking"].includes(v)) return "striking";
  return "unknown";
}
function normalizeClarity(v) {
  return ({ muted: "muted", soft: "soft", moderate: "balanced", clear: "clear", bright: "sparkling", very_clear: "sparkling", unclear: "unknown" })[v] || v || "unknown";
}
function chromaToSkinHair(v) {
  return ({ muted: "muted", soft: "muted", moderate: "balanced", clear: "clear", bright: "clear" })[v] || "unknown";
}
function inferUndertoneFamily(ex) {
  const s = String(ex.observed_colors?.skin?.surface_tone || "").toLowerCase();
  if (s.includes("olive")) return "olive";
  if (s.includes("peach")) return "peach";
  if (s.includes("gold")) return "golden";
  if (s.includes("yellow")) return "yellow";
  if (s.includes("rosy") || s.includes("rose")) return "rosy";
  if (s.includes("pink")) return "pink";
  return "beige_neutral";
}
function normalizeEyeColor(v) {
  if (isUnknown(v)) return "unknown";
  const s = String(v || "").toLowerCase();
  const allowed = ["very_light_blue","blue","blue_gray","gray","green","gray_green","hazel","amber","light_brown","medium_brown","dark_brown","black_brown","mixed"];
  if (allowed.includes(s)) return s;
  if (s.includes("gray") && s.includes("green")) return "gray_green";
  if (s.includes("gray") && s.includes("blue")) return "blue_gray";
  if (s.includes("brown") && s.includes("dark")) return "dark_brown";
  if (s.includes("brown") && s.includes("light")) return "light_brown";
  if (s.includes("brown")) return "medium_brown";
  if (s.includes("green")) return "green";
  if (s.includes("blue")) return "blue";
  if (s.includes("gray")) return "gray";
  if (s.includes("hazel")) return "hazel";
  if (s.includes("amber")) return "amber";
  return "unknown";
}
function brightnessFromDepth(v) {
  if (["very_light", "light", "light_medium"].includes(v)) return "high";
  if (["medium"].includes(v)) return "medium";
  if (["medium_dark", "dark", "very_dark"].includes(v)) return "low";
  return "unknown";
}
function naturalness(ex) {
  return ({ likely_natural: "likely_natural", possibly_colored: "possibly_colored", likely_colored: "colored", unclear: "unknown" })[ex.image_quality?.hair_naturalness] || "unknown";
}
function majority(items, fallback = "uncertain") {
  const counts = {};
  for (const x of items.filter(x => !isUnknown(x))) counts[x] = (counts[x] || 0) + 1;
  const ordered = Object.entries(counts).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
  return ordered[0]?.[0] || fallback;
}

function orderedMedian(items, order, fallback = "uncertain") {
  const index = new Map(order.map((value, i) => [value, i]));
  const known = items
    .filter(value => index.has(value))
    .sort((a, b) => index.get(a) - index.get(b));

  if (!known.length) return fallback;
  return known[Math.floor(known.length / 2)];
}

function adaptExtractor(ex) {
  assert(ex && typeof ex === "object", "extractor missing");
  const vf = ex.visual_features || {};
  const cf = ex.contrast_features || {};
  const oc = ex.observed_colors || {};
  const skinTemp = vf.skin_temperature?.value || oc.skin?.undertone_observation || "uncertain";
  const eyeTemp = vf.eye_temperature?.value || "uncertain";
  const hairTemp = vf.hair_temperature?.value || oc.hair?.temperature_observation || "uncertain";
  const skinDepth = mapDepthForConfig(vf.skin_value?.value);
  const eyeDepth = mapDepthForConfig(vf.eye_value?.value || oc.eyes?.depth);
  const hairDepth = mapDepthForConfig(vf.hair_value?.value || oc.hair?.depth);
  const skinChroma = vf.skin_chroma?.value || "uncertain";
  const eyeChroma = vf.eye_chroma?.value || oc.eyes?.clarity || "uncertain";
  const hairChroma = vf.hair_chroma?.value || oc.hair?.clarity || "uncertain";
  const overallContrast = collapseContrast(cf.overall_contrast_observation?.level);
  const featureDefinition = collapseDefinition(cf.feature_definition?.level);
  const confidenceMean = vals => {
    const a = vals.map(Number).filter(Number.isFinite);
    return a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0;
  };
  return {
    image: {
      face_detected: ex.image_quality?.face_visible !== false,
      makeup: ex.image_quality?.heavy_makeup_detected ? "heavy" : "none",
      hair_colored: ["possibly_colored","likely_colored"].includes(ex.image_quality?.hair_naturalness) ? "yes" : "unknown"
    },
    quality: {
      overall_quality: ex.image_quality?.status || "poor",
      continue_analysis: !["poor","unusable","rejected"].includes(ex.image_quality?.status) && !["retry_photo","rejected"].includes(ex.analysis_status),
      problems: ex.limitations || [],
      limitations: ex.limitations || []
    },
    features: {
      skin: {
        visible: ex.image_quality?.face_visible !== false,
        dominant_depth: skinDepth,
        temperature: skinTemp,
        undertone_family:
          oc.skin?.undertone_family ||
          inferUndertoneFamily(ex),
        surface_redness: oc.skin?.redness_level || "unknown",
        clarity: chromaToSkinHair(skinChroma),
        translucency: "unknown",
        natural_blush: "not_visible",
        freckles: "unknown",
        observed_hex: oc.skin?.hex ?? null,
        confidence: clamp(confidenceMean([vf.skin_temperature?.confidence, vf.skin_value?.confidence, vf.skin_chroma?.confidence, oc.skin?.confidence]))
      },
      eyes: {
        visible:
          Boolean(oc.eyes?.primary_color) ||
          Boolean(oc.eyes?.hex),
        base_color: normalizeEyeColor(oc.eyes?.primary_color),
        temperature: eyeTemp,
        clarity: normalizeClarity(eyeChroma),
        brightness: brightnessFromDepth(eyeDepth),
        iris_contrast: collapseContrast(
          oc.eyes?.iris_contrast ||
          cf.iris_contrast?.level ||
          cf.skin_eye_value_difference?.level
        ),
        limbal_ring: "unknown",
        golden_flecks: "unknown",
        cool_gray_veil: String(oc.eyes?.secondary_color || "").includes("gray") ? "visible" : "unknown",
        observed_hex: oc.eyes?.hex ?? null,
        confidence: clamp(confidenceMean([vf.eye_temperature?.confidence, vf.eye_value?.confidence, vf.eye_chroma?.confidence, oc.eyes?.confidence]))
      },
      hair: {
        visible:
          Boolean(oc.hair?.primary_color) ||
          Boolean(oc.hair?.hex),
        naturalness: naturalness(ex),
        depth: hairDepth,
        temperature: hairTemp,
        undertone: hairTemp === "warm" || hairTemp === "neutral_warm" ? "golden" : hairTemp === "cool" || hairTemp === "neutral_cool" ? "ash" : "neutral",
        clarity: chromaToSkinHair(hairChroma),
        shine: "unknown",
        natural_highlights: "not_visible",
        observed_hex: oc.hair?.hex ?? null,
        confidence: clamp(confidenceMean([vf.hair_temperature?.confidence, vf.hair_value?.confidence, vf.hair_chroma?.confidence, oc.hair?.confidence]))
      },
      eyebrows: {
        visible:
          oc.eyebrows?.visible === true ||
          Boolean(oc.eyebrows?.primary_color) ||
          Boolean(oc.eyebrows?.hex) ||
          Boolean(oc.eyebrows?.depth_relative_to_hair) ||
          Boolean(oc.eyebrows?.temperature_observation),
        depth_relative_to_hair:
          oc.eyebrows?.depth_relative_to_hair || "unknown",
        temperature:
          oc.eyebrows?.temperature_observation || "uncertain",
        clarity:
          normalizeClarity(oc.eyebrows?.clarity),
        confidence:
          clamp(oc.eyebrows?.confidence || 0)
      },
      lips: {
        visible:
          oc.lips?.visible === true ||
          Boolean(oc.lips?.primary_color) ||
          Boolean(oc.lips?.natural_color) ||
          Boolean(oc.lips?.hex) ||
          Boolean(oc.lips?.temperature_observation),
        natural_color:
          oc.lips?.primary_color ||
          oc.lips?.natural_color ||
          "unknown",
        temperature:
          oc.lips?.temperature_observation || "uncertain",
        depth:
          mapDepthForConfig(oc.lips?.depth),
        clarity:
          normalizeClarity(oc.lips?.clarity),
        confidence:
          clamp(oc.lips?.confidence || 0)
      },
      contrast: {
        skin_hair_contrast: collapseContrast(cf.skin_hair_value_difference?.level),
        skin_eye_contrast: collapseContrast(cf.skin_eye_value_difference?.level),
        feature_definition: featureDefinition,
        overall_contrast: overallContrast,
        confidence: clamp(cf.overall_contrast_observation?.confidence || ex.global_reliability || 0)
      },
      overall_impression: {
        dominant_temperature: majority([skinTemp, eyeTemp, hairTemp]),
        dominant_value: orderedMedian(
          [collapseDepth(skinDepth), collapseDepth(eyeDepth), collapseDepth(hairDepth)],
          ["light", "medium", "deep"]
        ),
        dominant_chroma: majority([skinChroma, eyeChroma, hairChroma]),
        dominant_contrast: overallContrast,
        confidence: clamp(ex.global_reliability || 0)
      }
    }
  };
}


/* =========================================================
   EVIDENCE RELIABILITY ENGINE — ACTIVE STABLE MODE

   Source reliability, feature confidence and evidence coverage
   are separate signals. Reliability is configured through JSON.
========================================================= */

function validateConfig(config) {
  assert(config.engine, "engine.json missing");
  assert(config.temperature_engine, "temperature.json missing");
  assert(config.value_engine, "value.json missing");
  assert(config.chroma_engine, "chroma.json missing");
  assert(config.contrast_engine, "contrast.json missing");
  assert(config.season_scoring, "season_scoring.json missing");

  const profiles = config.season_scoring.season_profiles || {};
  assert(
    Object.keys(profiles).length === 12,
    "season_scoring must contain exactly 12 season profiles"
  );

  for (const [name, profile] of Object.entries(profiles)) {
    for (const dimension of [
      "temperature",
      "value",
      "chroma",
      "contrast"
    ]) {
      assert(
        profile?.[dimension]?.target,
        `${name}.${dimension}.target missing`
      );
    }
  }

  for (const engineName of [
    "temperature_engine",
    "value_engine",
    "chroma_engine",
    "contrast_engine"
  ]) {
    const priority = config[engineName]?.evidence_priority;
    assert(
      Array.isArray(priority),
      `${engineName}.evidence_priority missing`
    );

    const total = priority.reduce(
      (sum, item) => sum + Number(item.weight || 0),
      0
    );

    assert(
      total > 0,
      `${engineName}.evidence_priority total must be > 0`
    );
  }
}

function evidenceWeightWithoutConfidence(item) {
  const confidence = Number(item?.feature_confidence || 0);
  const used = Number(item?.weight_used || 0);
  return confidence > 0 ? used / confidence : 0;
}

function evidenceMetrics(evidence, availableWeight, quality, scores) {
  const presentWeight = evidence.reduce(
    (sum, item) =>
      sum + evidenceWeightWithoutConfidence(item),
    0
  );

  const weightedConfidence = presentWeight > 0
    ? evidence.reduce(
        (sum, item) =>
          sum +
          evidenceWeightWithoutConfidence(item) *
          clamp(Number(item.feature_confidence || 0)),
        0
      ) / presentWeight
    : 0;

  const coverage = availableWeight > 0
    ? clamp(presentWeight / availableWeight)
    : 0;

  const ordered = Object.values(scores || {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => b - a);

  const separation = ordered.length >= 2
    ? clamp(Math.max(0, ordered[0] - ordered[1]) / 20)
    : 0;

  const confidence = clamp(
    weightedConfidence *
    qualityMultiplier(quality) *
    (0.75 + 0.25 * separation)
  );

  return {
    present_weight: round(presentWeight, 4),
    feature_confidence: round(weightedConfidence, 3),
    coverage: round(coverage, 3),
    score_separation: round(separation, 3),
    confidence: round(confidence, 3)
  };
}

function meanNumbers(values, fallback = 0) {
  const numbers = values
    .map(Number)
    .filter(Number.isFinite);

  return numbers.length
    ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length
    : fallback;
}

function qualityReliabilityFactor(imageQuality) {
  const statusFactor = {
    good: 1,
    acceptable: 0.82,
    poor: 0.35,
    unusable: 0
  }[imageQuality?.status] ?? 0.5;

  const lightingFactor = {
    neutral: 1,
    mostly_neutral: 0.94,
    mixed: 0.78,
    warm: 0.72,
    cool: 0.72,
    poor: 0.4
  }[imageQuality?.lighting_quality] ?? 0.65;

  const castFactor = {
    none: 1,
    slight_warm: 0.92,
    slight_cool: 0.92,
    mixed: 0.78,
    strong_warm: 0.62,
    strong_cool: 0.62,
    green: 0.58,
    magenta: 0.58
  }[imageQuality?.color_cast] ?? 0.75;

  let conditionFactor = 1;

  if (imageQuality?.overexposure) conditionFactor *= 0.78;
  if (imageQuality?.underexposure) conditionFactor *= 0.78;
  if (imageQuality?.strong_shadows) conditionFactor *= 0.82;
  if (imageQuality?.beauty_filter_detected) conditionFactor *= 0.68;
  if (imageQuality?.heavy_makeup_detected) conditionFactor *= 0.78;
  if (imageQuality?.face_visible === false) conditionFactor = 0;

  const analysisReliability = clamp(
    imageQuality?.analysis_reliability ?? 0.65
  );

  return clamp(
    (
      statusFactor * 0.30 +
      lightingFactor * 0.20 +
      castFactor * 0.15 +
      conditionFactor * 0.15 +
      analysisReliability * 0.20
    )
  );
}

function sourceVisibilityFactor(source) {
  if (!source || typeof source !== "object") return 0;
  if ("visible" in source && source.visible === false) return 0;
  return 1;
}

function knownFieldRatio(source, fieldNames) {
  if (!source || typeof source !== "object" || !fieldNames.length) {
    return 0;
  }

  const known = fieldNames.filter(
    field => !isUnknown(source[field])
  ).length;

  return known / fieldNames.length;
}

function calculateEvidenceReliability(extractorData, adaptedData, config) {
  const imageQuality = extractorData.image_quality || {};
  const observed = extractorData.observed_colors || {};
  const visual = extractorData.visual_features || {};
  const contrastFeatures = extractorData.contrast_features || {};
  const adaptedFeatures = adaptedData.features || {};

  const qualityFactor = qualityReliabilityFactor(imageQuality);

  const sourceSpecs = {
    skin: {
      source: adaptedFeatures.skin,
      observedConfidence: observed.skin?.confidence,
      featureConfidences: [
        visual.skin_temperature?.confidence,
        visual.skin_value?.confidence,
        visual.skin_chroma?.confidence
      ],
      completenessFields: [
        "temperature",
        "undertone_family",
        "dominant_depth",
        "clarity"
      ],
      distortionFactor:
        imageQuality.heavy_makeup_detected ? 0.78 : 1
    },

    eyes: {
      source: adaptedFeatures.eyes,
      observedConfidence: observed.eyes?.confidence,
      featureConfidences: [
        visual.eye_temperature?.confidence,
        visual.eye_value?.confidence,
        visual.eye_chroma?.confidence
      ],
      completenessFields: [
        "base_color",
        "temperature",
        "clarity",
        "brightness",
        "iris_contrast"
      ],
      distortionFactor: 1
    },

    hair: {
      source: adaptedFeatures.hair,
      observedConfidence: observed.hair?.confidence,
      featureConfidences: [
        visual.hair_temperature?.confidence,
        visual.hair_value?.confidence,
        visual.hair_chroma?.confidence
      ],
      completenessFields: [
        "depth",
        "temperature",
        "undertone",
        "clarity"
      ],
      distortionFactor: (
        config.reliability_engine_v2?.hair_distortion || {
          likely_natural: 1,
          natural: 1,
          possibly_colored: 0.58,
          likely_colored: 0.25,
          colored: 0.15,
          unclear: 0.45,
          unknown: 0.45
        }
      )[
        imageQuality.hair_naturalness ??
        adaptedFeatures.hair?.naturalness
      ] ?? 0.45
    },

    lips: {
      source: adaptedFeatures.lips,
      observedConfidence: observed.lips?.confidence,
      featureConfidences: [
        observed.lips?.confidence
      ],
      completenessFields: [
        "natural_color",
        "temperature",
        "depth",
        "clarity"
      ],
      distortionFactor:
        imageQuality.heavy_makeup_detected ? 0.45 : 1
    },

    eyebrows: {
      source: adaptedFeatures.eyebrows,
      observedConfidence: observed.eyebrows?.confidence,
      featureConfidences: [
        observed.eyebrows?.confidence
      ],
      completenessFields: [
        "depth_relative_to_hair",
        "temperature",
        "clarity"
      ],
      distortionFactor: 1
    },

    contrast: {
      source: adaptedFeatures.contrast,
      observedConfidence:
        contrastFeatures.overall_contrast_observation?.confidence,
      featureConfidences: [
        contrastFeatures.overall_contrast_observation?.confidence
      ],
      completenessFields: [
        "skin_hair_contrast",
        "skin_eye_contrast",
        "feature_definition",
        "overall_contrast"
      ],
      distortionFactor: 1
    }
  };

  const sources = {};

  for (const [sourceName, spec] of Object.entries(sourceSpecs)) {
    const visibility = sourceVisibilityFactor(spec.source);

    const rawConfidence = clamp(
      meanNumbers(
        [
          spec.observedConfidence,
          ...spec.featureConfidences
        ],
        spec.source?.confidence ?? 0
      )
    );

    const completeness = knownFieldRatio(
      spec.source,
      spec.completenessFields
    );

    const distortion = clamp(spec.distortionFactor ?? 1);

    const reliabilitySettings =
      config.reliability_engine_v2 || {};

    const reliabilityWeights =
      reliabilitySettings.source_reliability_weights || {
        completeness: 0.45,
        quality: 0.55
      };

    const reliability = clamp(
      visibility *
      distortion *
      (
        completeness *
          Number(reliabilityWeights.completeness || 0.45) +
        qualityFactor *
          Number(reliabilityWeights.quality || 0.55)
      )
    );

    sources[sourceName] = {
      reliability: round(reliability, 3),
      raw_confidence: round(rawConfidence, 3),
      completeness: round(completeness, 3),
      visibility: round(visibility, 3),
      distortion_factor: round(distortion, 3),
      quality_factor: round(qualityFactor, 3)
    };
  }

  function weightedAvailableReliability(items) {
    const available = items.filter(
      item =>
        Number(item.weight) > 0 &&
        (
          item.alwaysAvailable ||
          sources[item.source]?.visibility > 0
        )
    );

    const totalWeight = available.reduce(
      (sum, item) => sum + Number(item.weight),
      0
    );

    if (totalWeight <= 0) return 0;

    return round(
      available.reduce(
        (sum, item) =>
          sum +
          Number(item.weight) *
          (
            item.source === "quality"
              ? qualityFactor
              : Number(sources[item.source]?.reliability || 0)
          ),
        0
      ) / totalWeight,
      3
    );
  }

  const dimensionWeights =
    config.reliability_engine_v2?.dimension_source_weights || {
      temperature: {
        skin: 0.50,
        eyes: 0.18,
        hair: 0.12,
        lips: 0.15,
        eyebrows: 0.05
      },
      value: {
        skin: 0.30,
        eyes: 0.25,
        hair: 0.25,
        quality: 0.20
      },
      chroma: {
        skin: 0.32,
        eyes: 0.30,
        hair: 0.13,
        contrast: 0.15,
        quality: 0.10
      },
      contrast: {
        contrast: 0.45,
        skin: 0.15,
        eyes: 0.20,
        hair: 0.10,
        quality: 0.10
      }
    };

  const dimensions = Object.fromEntries(
    Object.entries(dimensionWeights).map(
      ([dimension, sourceWeights]) => [
        dimension,
        weightedAvailableReliability(
          Object.entries(sourceWeights).map(
            ([source, weight]) => ({
              source,
              weight,
              alwaysAvailable: source === "quality"
            })
          )
        )
      ]
    )
  );

  const overall = round(
    meanNumbers(Object.values(sources).map(item => item.reliability)),
    3
  );

  return {
    mode: "all_dimensions_and_season_scoring",
    applied_to_calculations: {
      temperature: true,
      value: true,
      chroma: true,
      contrast: true,
      season_scoring: true
    },
    quality_factor: round(qualityFactor, 3),
    sources,
    dimensions,
    overall
  };
}

function addMapping(totals, mapping, weight, confidence, evidence, meta) {
  if (!mapping || weight <= 0 || confidence <= 0) return 0;
  const effective = weight * confidence;
  for (const [k,v] of Object.entries(mapping)) if (k in totals) totals[k] += Number(v) * effective;
  if (evidence) evidence.push({ ...meta, weight_used: round(effective,4), feature_confidence: round(confidence,3) });
  return effective;
}
function normalizedScores(totals, used) {
  return Object.fromEntries(Object.entries(totals).map(([k,v]) => [k, used ? round(100*v/used,2) : 0]));
}
function qualityMultiplier(q) { return ({good:1, acceptable:.8, poor:0, unusable:0})[q] ?? 0; }

function calculateTemperature(config, features, quality, reliability) {
  const cfg = config.temperature_engine;
  const totals = { warm: 0, cool: 0, neutral: 0 };
  const evidence = [];

  const sw = Object.fromEntries(
    cfg.evidence_priority.map(item => [
      item.source,
      Number(item.weight)
    ])
  );

  const sourceReliability = reliability?.sources || {};

  function reliabilityOf(sourceName) {
    const value = Number(
      sourceReliability[sourceName]?.reliability
    );

    return Number.isFinite(value)
      ? clamp(value)
      : 1;
  }

  function adjustedSourceWeight(sourceName) {
    return Number(sw[sourceName] || 0) *
      reliabilityOf(sourceName);
  }

  function addTemperatureEvidence(
    sourceName,
    mapping,
    subWeight,
    featureConfidence,
    meta,
    extraMultiplier = 1
  ) {
    const baseSourceWeight = Number(sw[sourceName] || 0);
    const sourceReliabilityValue = reliabilityOf(sourceName);

    return addMapping(
      totals,
      mapping,
      baseSourceWeight *
        sourceReliabilityValue *
        subWeight *
        extraMultiplier,
      featureConfidence,
      evidence,
      {
        ...meta,
        base_source_weight: round(baseSourceWeight, 4),
        source_reliability: round(
          sourceReliabilityValue,
          3
        ),
        reliability_applied: true
      }
    );
  }

  let used = 0;

  const skin = features.skin || {};
  const skinConfidence = clamp(skin.confidence);

  for (const [field, section, subWeight] of [
    ["temperature", "temperature", 0.55],
    ["undertone_family", "undertone_family", 0.30],
    ["natural_blush", "natural_blush", 0.10],
    ["freckles", "freckles", 0.05]
  ]) {
    used += addTemperatureEvidence(
      "skin",
      cfg.skin_rules[section]?.[skin[field]],
      subWeight,
      skinConfidence,
      {
        source: "skin",
        field,
        observed_value: skin[field]
      }
    );
  }

  const lips = features.lips || {};
  const lipsConfidence = clamp(lips.confidence);

  for (const [field, section, subWeight] of [
    ["temperature", "temperature", 0.70],
    ["natural_color", "natural_color", 0.30]
  ]) {
    used += addTemperatureEvidence(
      "lips",
      cfg.lips_rules[section]?.[lips[field]],
      subWeight,
      lipsConfidence,
      {
        source: "lips",
        field,
        observed_value: lips[field]
      }
    );
  }

  const eyes = features.eyes || {};
  const eyesConfidence = clamp(eyes.confidence);

  used += addTemperatureEvidence(
    "eyes",
    cfg.eyes_rules.temperature?.[eyes.temperature],
    0.75,
    eyesConfidence,
    {
      source: "eyes",
      field: "temperature",
      observed_value: eyes.temperature
    }
  );

  used += addTemperatureEvidence(
    "eyes",
    cfg.eyes_rules.supporting_markers?.[
      `golden_flecks_${eyes.golden_flecks}`
    ],
    0.125,
    eyesConfidence,
    {
      source: "eyes",
      field: "golden_flecks",
      observed_value: eyes.golden_flecks
    }
  );

  used += addTemperatureEvidence(
    "eyes",
    cfg.eyes_rules.supporting_markers?.[
      `cool_gray_veil_${eyes.cool_gray_veil}`
    ],
    0.125,
    eyesConfidence,
    {
      source: "eyes",
      field: "cool_gray_veil",
      observed_value: eyes.cool_gray_veil
    }
  );

  const hair = features.hair || {};
  const hairConfidence = clamp(hair.confidence);

  const hairNaturalnessMultiplier = ({
    natural: 1,
    likely_natural: 0.85,
    possibly_colored: 0.45,
    likely_colored: 0.15,
    colored: 0,
    unclear: 0.35,
    unknown: 0.35
  })[hair.naturalness] ?? 0.35;

  for (const [field, section, subWeight] of [
    ["temperature", "temperature", 0.55],
    ["undertone", "undertone", 0.30],
    ["natural_highlights", "natural_highlights", 0.15]
  ]) {
    used += addTemperatureEvidence(
      "hair",
      cfg.hair_rules[section]?.[hair[field]],
      subWeight,
      hairConfidence,
      {
        source: "hair",
        field,
        observed_value: hair[field],
        naturalness_multiplier: round(
          hairNaturalnessMultiplier,
          3
        )
      },
      1
    );
  }

  const scores = normalizedScores(totals, used);
  const gap = scores.warm - scores.cool;
  let classification = "uncertain";

  const availableReliabilityWeight =
    adjustedSourceWeight("skin") +
    adjustedSourceWeight("lips") +
    adjustedSourceWeight("eyes") +
    adjustedSourceWeight("hair");

  const minimumEvidence =
    Number(
      cfg.global_rules.minimum_total_evidence_weight
    ) || 0.35;

  const originalTemperatureWeight =
    Number(sw.skin || 0) +
    Number(sw.lips || 0) +
    Number(sw.eyes || 0) +
    Number(sw.hair || 0);

  const scaledMinimumEvidence =
    originalTemperatureWeight > 0
      ? minimumEvidence *
        (
          availableReliabilityWeight /
          originalTemperatureWeight
        )
      : minimumEvidence;

  if (used >= scaledMinimumEvidence) {
    if (scores.warm >= 65 && gap >= 20) {
      classification = "warm";
    } else if (scores.cool >= 65 && -gap >= 20) {
      classification = "cool";
    } else if (scores.warm >= 52 && gap >= 8) {
      classification = "neutral_warm";
    } else if (scores.cool >= 52 && -gap >= 8) {
      classification = "neutral_cool";
    } else if (Math.abs(gap) <= 7) {
      classification = "neutral";
    } else {
      classification =
        gap > 0 ? "neutral_warm" : "neutral_cool";
    }
  }

  const metrics = evidenceMetrics(
    evidence,
    availableReliabilityWeight,
    quality.overall_quality,
    scores
  );

  const confidence = metrics.confidence;

  return {
    classification,
    confidence,
    scores,
    evidence,
    conflicts: [],
    reliability: {
      applied: true,
      available_weight: round(
        availableReliabilityWeight,
        4
      ),
      used_weight: round(used, 4),
      coverage: metrics.coverage,
      feature_confidence: metrics.feature_confidence,
      score_separation: metrics.score_separation,
      dimension_reliability:
        reliability?.dimensions?.temperature ?? 1,
      sources: {
        skin: round(reliabilityOf("skin"), 3),
        lips: round(reliabilityOf("lips"), 3),
        eyes: round(reliabilityOf("eyes"), 3),
        hair: round(reliabilityOf("hair"), 3)
      }
    }
  };
}

function stabilizeTemperatureResult(result, extractorData) {
  if (!result || typeof result !== "object") return result;

  const vf = extractorData?.visual_features || {};
  const oc = extractorData?.observed_colors || {};
  const overall = extractorData?.overall_impression || {};

  const skin = vf.skin_temperature || {};
  const eyes = vf.eye_temperature || {};
  const hair = vf.hair_temperature || {};

  const skinValue = skin.value || oc.skin?.undertone_observation;
  const eyeValue = eyes.value || oc.eyes?.temperature_observation;
  const hairValue = hair.value || oc.hair?.temperature_observation;

  const skinScore = Number(skin.score);
  const eyeScore = Number(eyes.score);

  const neutralDirectionalSkin =
    ["neutral_warm", "neutral_cool"].includes(skinValue) &&
    Number.isFinite(skinScore) &&
    Math.abs(skinScore) <= 0.30;

  const oppositeEye =
    (skinValue === "neutral_cool" &&
      ["neutral_warm", "warm"].includes(eyeValue)) ||
    (skinValue === "neutral_warm" &&
      ["neutral_cool", "cool"].includes(eyeValue));

  const neutralHair =
    ["neutral", "uncertain", "unclear", undefined, null].includes(hairValue);

  const neutralOverall =
    ["neutral", "uncertain", "unclear", undefined, null].includes(
      overall.dominant_temperature
    );

  const neutralSkinFamily =
    ["beige_neutral", "unclear", undefined, null].includes(
      oc.skin?.undertone_family
    );

  const rednessCanDistort =
    ["moderate", "high"].includes(oc.skin?.redness_level);

  const directionalScoresConflict =
    Number.isFinite(skinScore) &&
    Number.isFinite(eyeScore) &&
    Math.sign(skinScore) !== 0 &&
    Math.sign(eyeScore) !== 0 &&
    Math.sign(skinScore) !== Math.sign(eyeScore);

  const conflicts = Array.isArray(result.conflicts)
    ? [...result.conflicts]
    : [];

  if (oppositeEye) {
    conflicts.push({
      type: "skin_eye_temperature_conflict",
      skin: skinValue,
      eyes: eyeValue
    });
  }

  if (directionalScoresConflict) {
    conflicts.push({
      type: "skin_eye_temperature_score_conflict",
      skin_score: round(skinScore, 3),
      eye_score: round(eyeScore, 3)
    });
  }

  const shouldNeutralizeSingleSkinFlip =
    neutralDirectionalSkin &&
    neutralSkinFamily &&
    neutralHair &&
    neutralOverall &&
    (oppositeEye || directionalScoresConflict || rednessCanDistort);

  if (shouldNeutralizeSingleSkinFlip) {
    conflicts.push({
      type: "single_skin_temperature_flip_guard",
      original_classification: result.classification,
      stabilized_classification: "neutral",
      reason: "Weak directional skin signal is not independently confirmed."
    });

    return {
      ...result,
      classification: "neutral",
      confidence: round(
        Math.min(Number(result.confidence || 0), 0.62),
        3
      ),
      conflicts,
      stability_guard: {
        applied: true,
        version: "4.9.5",
        reason: "single_skin_temperature_flip"
      }
    };
  }

  return {
    ...result,
    conflicts,
    stability_guard: {
      applied: false,
      version: "4.9.5"
    }
  };
}

function calculateValue(config, features, quality, reliability) {
  const cfg = config.value_engine;
  const totals = { light: 0, medium: 0, deep: 0 };
  const evidence = [];
  const sw = Object.fromEntries(
    cfg.evidence_priority.map(x => [x.source, Number(x.weight)])
  );

  const sourceReliability = reliability?.sources || {};
  const rel = sourceName => {
    const value = Number(sourceReliability[sourceName]?.reliability);
    return Number.isFinite(value) ? clamp(value) : 1;
  };

  let used = 0;

  const skin = features.skin || {};
  used += addMapping(
    totals,
    cfg.mapping.skin_depth?.[skin.dominant_depth],
    sw.skin * rel("skin"),
    clamp(skin.confidence),
    evidence,
    {
      source: "skin",
      field: "dominant_depth",
      observed_value: skin.dominant_depth,
      base_source_weight: round(sw.skin, 4),
      source_reliability: round(rel("skin"), 3),
      reliability_applied: true
    }
  );

  const hair = features.hair || {};
  const hairMultiplier =
    cfg.global_rules.hair_handling?.[hair.naturalness] ?? 0.35;

  used += addMapping(
    totals,
    cfg.mapping.hair_depth?.[hair.depth],
    sw.hair * rel("hair"),
    clamp(hair.confidence),
    evidence,
    {
      source: "hair",
      field: "depth",
      observed_value: hair.depth,
      naturalness_multiplier: round(hairMultiplier, 3),
      base_source_weight: round(sw.hair, 4),
      source_reliability: round(rel("hair"), 3),
      reliability_applied: true
    }
  );

  const eyes = features.eyes || {};
  const eyeConfidence = clamp(eyes.confidence);

  used += addMapping(
    totals,
    cfg.mapping.eye_base_color?.[eyes.base_color],
    sw.eyes * 0.85 * rel("eyes"),
    eyeConfidence,
    evidence,
    {
      source: "eyes",
      field: "base_color",
      observed_value: eyes.base_color,
      base_source_weight: round(sw.eyes, 4),
      source_reliability: round(rel("eyes"), 3),
      reliability_applied: true
    }
  );

  used += addMapping(
    totals,
    cfg.mapping.eye_brightness_modifier?.[eyes.brightness],
    sw.eyes * 0.15 * rel("eyes"),
    eyeConfidence,
    evidence,
    {
      source: "eyes",
      field: "brightness",
      observed_value: eyes.brightness,
      base_source_weight: round(sw.eyes, 4),
      source_reliability: round(rel("eyes"), 3),
      reliability_applied: true
    }
  );

  // v4.9.4: eyebrows are a small reinforcement of the facial value frame.
  // They must never outweigh skin/hair/eyes, but darker brows can confirm
  // medium-deep/deep framing that would otherwise be lost.
  const eyebrows = features.eyebrows || {};
  const eyebrowWeight = 0.06;
  const hairDepthFamily = collapseDepth(hair.depth);
  let eyebrowValueMapping = null;

  if (eyebrows.visible && !isUnknown(eyebrows.depth_relative_to_hair)) {
    if (hairDepthFamily === "deep") {
      if (["same", "darker"].includes(eyebrows.depth_relative_to_hair)) {
        eyebrowValueMapping = { deep: 1, medium: 0.25, light: 0 };
      } else if (eyebrows.depth_relative_to_hair === "lighter") {
        eyebrowValueMapping = { deep: 0.35, medium: 0.75, light: 0.10 };
      }
    } else if (hairDepthFamily === "medium") {
      if (eyebrows.depth_relative_to_hair === "darker") {
        eyebrowValueMapping = { deep: 0.70, medium: 0.65, light: 0 };
      } else if (eyebrows.depth_relative_to_hair === "same") {
        eyebrowValueMapping = { deep: 0.20, medium: 1, light: 0.10 };
      } else if (eyebrows.depth_relative_to_hair === "lighter") {
        eyebrowValueMapping = { deep: 0.05, medium: 0.75, light: 0.35 };
      }
    } else if (hairDepthFamily === "light") {
      eyebrowValueMapping = eyebrows.depth_relative_to_hair === "darker"
        ? { deep: 0.10, medium: 0.70, light: 0.50 }
        : { deep: 0, medium: 0.25, light: 1 };
    }
  }

  if (eyebrowValueMapping) {
    used += addMapping(
      totals,
      eyebrowValueMapping,
      eyebrowWeight * rel("eyebrows"),
      clamp(eyebrows.confidence),
      evidence,
      {
        source: "eyebrows",
        field: "depth_relative_to_hair",
        observed_value: eyebrows.depth_relative_to_hair,
        hair_depth_family: hairDepthFamily,
        base_source_weight: eyebrowWeight,
        source_reliability: round(rel("eyebrows"), 3),
        reliability_applied: true
      }
    );
  }

  const overall = features.overall_impression || {};
  const overallImpressionMultiplier = Math.max(
    0.50,
    Number(
      config.reliability_engine_v2?.overall_impression_multiplier ??
      0.50
    )
  );
  const overallReliability = clamp(
    meanNumbers([
      rel("skin"),
      rel("eyes"),
      rel("hair"),
      reliability?.overall
    ], 1)
  );

  used += addMapping(
    totals,
    cfg.mapping.overall_value?.[overall.dominant_value],
    sw.overall_impression * overallImpressionMultiplier * overallReliability,
    clamp(overall.confidence),
    evidence,
    {
      source: "overall_impression",
      field: "dominant_value",
      observed_value: overall.dominant_value,
      base_source_weight: round(sw.overall_impression, 4),
      source_reliability: round(overallReliability, 3),
      reliability_applied: true
    }
  );

  const scores = normalizedScores(totals, used);
  const ordered = Object.entries(scores).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );

  let classification = "uncertain";

  const mixed =
    scores.light >= 25 &&
    scores.deep >= 25 &&
    Math.abs(scores.light - scores.deep) <= 15 &&
    scores.medium >= 30;

  const originalTotalWeight = Object.values(sw).reduce(
    (sum, value) => sum + value,
    0
  );

  const adjustedAvailableWeight =
    sw.skin * rel("skin") +
    sw.hair * rel("hair") +
    sw.eyes * rel("eyes") +
    (eyebrowValueMapping ? eyebrowWeight * rel("eyebrows") : 0) +
    sw.overall_impression * overallImpressionMultiplier * overallReliability;

  const originalMinimum =
    Number(cfg.global_rules.minimum_total_evidence_weight) || 0.35;

  const adjustedMinimum =
    originalTotalWeight > 0
      ? originalMinimum *
        (adjustedAvailableWeight / originalTotalWeight)
      : originalMinimum;

  if (used >= adjustedMinimum) {
    classification = mixed
      ? "medium"
      : (
          ordered[0][1] - ordered[1][1] >= 5
            ? ordered[0][0]
            : "uncertain"
        );
  }

  const metrics = evidenceMetrics(
    evidence,
    adjustedAvailableWeight,
    quality.overall_quality,
    scores
  );

  return {
    classification,
    confidence: metrics.confidence,
    scores,
    evidence,
    conflicts: [],
    reliability: {
      applied: true,
      available_weight: round(adjustedAvailableWeight, 4),
      used_weight: round(used, 4),
      coverage: metrics.coverage,
      feature_confidence: metrics.feature_confidence,
      score_separation: metrics.score_separation,
      dimension_reliability:
        reliability?.dimensions?.value ?? 1,
      sources: {
        skin: round(rel("skin"), 3),
        eyes: round(rel("eyes"), 3),
        hair: round(rel("hair"), 3),
        eyebrows: round(rel("eyebrows"), 3),
        overall_impression: round(overallReliability, 3)
      }
    }
  };
}

function calculateChroma(config, features, quality, reliability) {
  const cfg = config.chroma_engine;
  const totals = {
    bright: 0,
    clear: 0,
    balanced: 0,
    soft: 0,
    muted: 0
  };
  const evidence = [];

  const sw = Object.fromEntries(
    cfg.evidence_priority.map(item => [
      item.source,
      Number(item.weight)
    ])
  );

  const sourceReliability = reliability?.sources || {};

  function reliabilityOf(sourceName) {
    const value = Number(
      sourceReliability[sourceName]?.reliability
    );
    return Number.isFinite(value) ? clamp(value) : 1;
  }

  function addChromaEvidence(
    sourceName,
    mapping,
    subWeight,
    featureConfidence,
    meta,
    extraMultiplier = 1
  ) {
    const baseSourceWeight = Number(sw[sourceName] || 0);
    const sourceReliabilityValue = reliabilityOf(sourceName);

    return addMapping(
      totals,
      mapping,
      baseSourceWeight *
        sourceReliabilityValue *
        subWeight *
        extraMultiplier,
      featureConfidence,
      evidence,
      {
        ...meta,
        base_source_weight: round(baseSourceWeight, 4),
        source_reliability: round(
          sourceReliabilityValue,
          3
        ),
        reliability_applied: true
      }
    );
  }

  let used = 0;

  const skin = features.skin || {};
  const skinConfidence = clamp(skin.confidence);

  for (const [field, section, subWeight] of [
    ["clarity", "skin_clarity", 0.55],
    ["surface_tone", "skin_surface_tone", 0.20],
    ["natural_blush", "skin_natural_blush", 0.15]
  ]) {
    used += addChromaEvidence(
      "skin",
      cfg.mapping?.[section]?.[skin[field]],
      subWeight,
      skinConfidence,
      {
        source: "skin",
        field,
        observed_value: skin[field]
      }
    );
  }

  const eyes = features.eyes || {};
  const eyesConfidence = clamp(eyes.confidence);

  for (const [field, section, subWeight] of [
    ["clarity", "eye_clarity", 0.60],
    ["brightness", "eye_brightness", 0.20],
    ["iris_contrast", "iris_contrast", 0.20]
  ]) {
    used += addChromaEvidence(
      "eyes",
      cfg.mapping?.[section]?.[eyes[field]],
      subWeight,
      eyesConfidence,
      {
        source: "eyes",
        field,
        observed_value: eyes[field]
      }
    );
  }

  const hair = features.hair || {};
  const hairConfidence = clamp(hair.confidence);

  const hairNaturalnessMultiplier = ({
    natural: 1,
    likely_natural: 0.85,
    possibly_colored: 0.45,
    likely_colored: 0.15,
    colored: 0,
    unclear: 0.35,
    unknown: 0.35
  })[hair.naturalness] ?? 0.35;

  for (const [field, section, subWeight] of [
    ["clarity", "hair_clarity", 0.70],
    ["shine", "hair_shine", 0.20],
    ["natural_highlights", "hair_natural_highlights", 0.10]
  ]) {
    used += addChromaEvidence(
      "hair",
      cfg.mapping?.[section]?.[hair[field]],
      subWeight,
      hairConfidence,
      {
        source: "hair",
        field,
        observed_value: hair[field],
        naturalness_multiplier: round(
          hairNaturalnessMultiplier,
          3
        )
      },
      1
    );
  }

  const contrast = features.contrast || {};
  const contrastConfidence = clamp(contrast.confidence);

  for (const [field, section, subWeight] of [
    ["feature_definition", "feature_definition", 0.45],
    ["overall_contrast", "overall_contrast", 0.35]
  ]) {
    used += addChromaEvidence(
      "contrast",
      cfg.mapping?.[section]?.[contrast[field]],
      subWeight,
      contrastConfidence,
      {
        source: "contrast",
        field,
        observed_value: contrast[field]
      }
    );
  }

  const overall = features.overall_impression || {};
  // v4.9.4: overall chroma is derivative evidence, not an independent
  // full-strength source. Cap it to prevent skin clarity / feature definition
  // from being counted again through the overall impression.
  const overallImpressionMultiplier = Math.min(
    0.18,
    Math.max(
      0.10,
      Number(
        config.reliability_engine_v2?.overall_impression_multiplier ??
        0.15
      )
    )
  );
  const overallReliability = clamp(
    meanNumbers([
      reliabilityOf("skin"),
      reliabilityOf("eyes"),
      reliabilityOf("hair"),
      reliabilityOf("contrast"),
      reliability?.overall
    ], 1)
  );

  used += addChromaEvidence(
    "overall_impression",
    cfg.mapping?.overall_chroma?.[
      overall.dominant_chroma
    ],
    1,
    clamp(overall.confidence),
    {
      source: "overall_impression",
      field: "dominant_chroma",
      observed_value: overall.dominant_chroma
    },
    overallReliability * overallImpressionMultiplier
  );

  const scores = normalizedScores(totals, used);
  const ordered = Object.entries(scores).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );

  let classification = "uncertain";

  const originalTotalWeight = Object.values(sw).reduce(
    (sum, value) => sum + value,
    0
  );

  const adjustedAvailableWeight =
    Number(sw.skin || 0) * reliabilityOf("skin") +
    Number(sw.eyes || 0) * reliabilityOf("eyes") +
    Number(sw.hair || 0) *
      reliabilityOf("hair") +
    Number(sw.contrast || 0) *
      reliabilityOf("contrast") +
    Number(sw.overall_impression || 0) *
      overallImpressionMultiplier *
      overallReliability;

  const originalMinimum =
    Number(cfg.global_rules?.minimum_total_evidence_weight) || 0.35;

  const adjustedMinimum =
    originalTotalWeight > 0
      ? originalMinimum *
        (adjustedAvailableWeight / originalTotalWeight)
      : originalMinimum;

  const chromaMetrics = evidenceMetrics(
    evidence,
    adjustedAvailableWeight,
    quality.overall_quality,
    scores
  );

  if (used >= adjustedMinimum && ordered.length >= 2) {
    const [firstName, firstScore] = ordered[0];
    const secondScore = ordered[1][1];
    const gap = firstScore - secondScore;
    const lowCoverageCloseRace =
      Number(chromaMetrics.coverage || 0) < 0.60 &&
      gap < 10;

    if (lowCoverageCloseRace) {
      classification = "uncertain";
    } else if (gap >= 6) {
      classification = firstName;
    } else if (
      ["balanced", "soft", "muted"].includes(firstName) &&
      firstScore >= 35
    ) {
      classification = firstName;
    } else {
      classification = "uncertain";
    }
  }

  const metrics = chromaMetrics;

  const confidence = metrics.confidence;

  return {
    classification,
    confidence,
    scores,
    evidence,
    conflicts: [],
    reliability: {
      applied: true,
      available_weight: round(
        adjustedAvailableWeight,
        4
      ),
      used_weight: round(used, 4),
      coverage: metrics.coverage,
      feature_confidence: metrics.feature_confidence,
      score_separation: metrics.score_separation,
      dimension_reliability:
        reliability?.dimensions?.chroma ?? 1,
      sources: {
        skin: round(reliabilityOf("skin"), 3),
        eyes: round(reliabilityOf("eyes"), 3),
        hair: round(reliabilityOf("hair"), 3),
        contrast: round(
          reliabilityOf("contrast"),
          3
        ),
        overall_impression: round(
          overallReliability,
          3
        )
      }
    }
  };
}

function calculateContrast(config, features, quality, reliability) {
  const cfg = config.contrast_engine;
  const totals = { low: 0, medium: 0, high: 0 };
  const evidence = [];

  const sw = Object.fromEntries(
    cfg.evidence_priority.map(item => [
      item.source,
      Number(item.weight)
    ])
  );

  const sourceReliability = reliability?.sources || {};

  function reliabilityOf(sourceName) {
    const value = Number(
      sourceReliability[sourceName]?.reliability
    );

    return Number.isFinite(value)
      ? clamp(value)
      : 1;
  }

  function combinedReliability(sourceNames) {
    return clamp(
      meanNumbers(
        sourceNames.map(reliabilityOf),
        1
      )
    );
  }

  function addContrastEvidence(
    sourceName,
    mapping,
    baseWeight,
    featureConfidence,
    sourceReliabilityValue,
    meta,
    extraMultiplier = 1
  ) {
    return addMapping(
      totals,
      mapping,
      baseWeight *
        sourceReliabilityValue *
        extraMultiplier,
      featureConfidence,
      evidence,
      {
        ...meta,
        base_source_weight: round(baseWeight, 4),
        source_reliability: round(
          sourceReliabilityValue,
          3
        ),
        reliability_applied: true
      }
    );
  }

  let used = 0;

  const contrast = features.contrast || {};
  const contrastConfidence = clamp(
    contrast.confidence
  );

  const hair = features.hair || {};

  const hairNaturalnessMultiplier =
    cfg.global_rules.hair_handling?.[
      hair.naturalness
    ] ?? 0.35;

  const skinHairReliability = combinedReliability([
    "skin",
    "hair",
    "contrast"
  ]);

  used += addContrastEvidence(
    "skin_hair_contrast",
    cfg.mapping.skin_hair_contrast?.[
      contrast.skin_hair_contrast
    ],
    Number(sw.skin_hair_contrast || 0),
    contrastConfidence,
    skinHairReliability,
    {
      source: "skin_hair_contrast",
      field: "skin_hair_contrast",
      observed_value: contrast.skin_hair_contrast,
      naturalness_multiplier: round(
        hairNaturalnessMultiplier,
        3
      )
    },
    1
  );

  const skinEyeReliability = combinedReliability([
    "skin",
    "eyes",
    "contrast"
  ]);

  used += addContrastEvidence(
    "skin_eye_contrast",
    cfg.mapping.skin_eye_contrast?.[
      contrast.skin_eye_contrast
    ],
    Number(sw.skin_eye_contrast || 0),
    contrastConfidence,
    skinEyeReliability,
    {
      source: "skin_eye_contrast",
      field: "skin_eye_contrast",
      observed_value: contrast.skin_eye_contrast
    }
  );

  const definitionReliability = reliabilityOf(
    "contrast"
  );

  used += addContrastEvidence(
    "feature_definition",
    cfg.mapping.feature_definition?.[
      contrast.feature_definition
    ],
    Number(sw.feature_definition || 0),
    contrastConfidence,
    definitionReliability,
    {
      source: "feature_definition",
      field: "feature_definition",
      observed_value: contrast.feature_definition
    }
  );

  const eyes = features.eyes || {};
  const eyeReliability = reliabilityOf("eyes");

  used += addContrastEvidence(
    "iris_contrast",
    cfg.mapping.iris_contrast?.[
      eyes.iris_contrast
    ],
    Number(sw.iris_contrast || 0),
    clamp(eyes.confidence),
    eyeReliability,
    {
      source: "iris_contrast",
      field: "iris_contrast",
      observed_value: eyes.iris_contrast
    }
  );

  const overall = features.overall_impression || {};
  const overallImpressionMultiplier = Math.max(
    0.50,
    Number(
      config.reliability_engine_v2?.overall_impression_multiplier ??
      0.50
    )
  );

  const overallReliability = clamp(
    meanNumbers([
      reliabilityOf("skin"),
      reliabilityOf("eyes"),
      reliabilityOf("hair"),
      reliabilityOf("contrast"),
      reliability?.overall
    ], 1)
  );

  used += addContrastEvidence(
    "overall_impression",
    cfg.mapping.overall_contrast?.[
      overall.dominant_contrast
    ],
    Number(sw.overall_impression || 0) *
      overallImpressionMultiplier,
    clamp(overall.confidence),
    overallReliability,
    {
      source: "overall_impression",
      field: "dominant_contrast",
      observed_value: overall.dominant_contrast
    }
  );

  const scores = normalizedScores(totals, used);

  const ordered = Object.entries(scores).sort(
    (a, b) => b[1] - a[1] ||
      a[0].localeCompare(b[0])
  );

  let classification = "uncertain";

  const originalTotalWeight =
    Object.values(sw).reduce(
      (sum, value) => sum + value,
      0
    );

  const adjustedAvailableWeight =
    Number(sw.skin_hair_contrast || 0) *
      skinHairReliability +
    Number(sw.skin_eye_contrast || 0) *
      skinEyeReliability +
    Number(sw.feature_definition || 0) *
      definitionReliability +
    Number(sw.iris_contrast || 0) *
      eyeReliability +
    Number(sw.overall_impression || 0) *
      overallImpressionMultiplier *
      overallReliability;

  const originalMinimum =
    Number(
      cfg.global_rules.minimum_total_evidence_weight
    ) || 0.35;

  const adjustedMinimum =
    originalTotalWeight > 0
      ? originalMinimum *
        (
          adjustedAvailableWeight /
          originalTotalWeight
        )
      : originalMinimum;

  /*
   * The original Contrast classification logic is preserved:
   * the leading class must exceed the second by at least 5 points.
   */
  if (
    used >= adjustedMinimum &&
    ordered.length >= 2
  ) {
    classification =
      ordered[0][1] - ordered[1][1] >= 5
        ? ordered[0][0]
        : "uncertain";
  }

  const metrics = evidenceMetrics(
    evidence,
    adjustedAvailableWeight,
    quality.overall_quality,
    scores
  );

  const confidence = metrics.confidence;

  return {
    classification,
    confidence,
    scores,
    evidence,
    conflicts: [],
    reliability: {
      applied: true,
      available_weight: round(
        adjustedAvailableWeight,
        4
      ),
      used_weight: round(used, 4),
      coverage: metrics.coverage,
      feature_confidence: metrics.feature_confidence,
      score_separation: metrics.score_separation,
      dimension_reliability:
        reliability?.dimensions?.contrast ?? 1,
      sources: {
        skin_hair_contrast: round(
          skinHairReliability,
          3
        ),
        skin_eye_contrast: round(
          skinEyeReliability,
          3
        ),
        feature_definition: round(
          definitionReliability,
          3
        ),
        iris_contrast: round(
          eyeReliability,
          3
        ),
        overall_impression: round(
          overallReliability,
          3
        )
      }
    }
  };
}

function getDimensionWeights(config) {
  const fromAlgorithm = config.scoring_algorithm?.dimension_weights;
  if (fromAlgorithm && typeof fromAlgorithm === "object") return fromAlgorithm;
  const dims = config.season_scoring?.dimensions || {};
  return Object.fromEntries(
    Object.entries(dims).map(([name, value]) => [name, Number(value?.weight || 0)])
  );
}

function resolveDimensionClassification(result) {
  if (!result || typeof result !== "object") return "uncertain";
  if (!isUnknown(result.classification)) return result.classification;

  const scores = result.scores;
  if (!scores || typeof scores !== "object") return "uncertain";

  const ordered = Object.entries(scores)
    .filter(([, score]) => Number.isFinite(Number(score)))
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]));

  if (!ordered.length || Number(ordered[0][1]) <= 0) return "uncertain";
  return ordered[0][0];
}

function matchValue(config, dimension, observed, profile) {
  if (isUnknown(observed) || !profile?.[dimension]) return null;

  const target = profile[dimension].target;
  const accepted = profile[dimension].accepted || [];
  const mp = config.season_scoring?.match_points ||
    config.scoring_algorithm?.dimension_match_values || {};
  const adjacency = config.season_scoring?.adjacency?.[dimension] || {};

  if (observed === target) return Number(mp.exact_target ?? 1);
  if (accepted.includes(observed)) return Number(mp.accepted_value ?? 0.75);
  if ((adjacency[target] || []).includes(observed)) {
    return Number(mp.adjacent_value ?? 0.4);
  }
  return Number(mp.opposite_value ?? 0);
}

function distributionMatchValue(config, dimension, result, profile) {
  if (!["value", "chroma", "contrast"].includes(dimension)) {
    return null;
  }

  const scores = result?.scores;
  if (!scores || typeof scores !== "object") return null;

  const entries = Object.entries(scores)
    .map(([name, score]) => [name, Math.max(0, Number(score) || 0)])
    .filter(([, score]) => score > 0);

  const total = entries.reduce((sum, [, score]) => sum + score, 0);
  if (total <= 0) return null;

  let expected = 0;
  for (const [candidate, score] of entries) {
    const candidateMatch = matchValue(
      config,
      dimension,
      candidate,
      profile
    );
    if (candidateMatch === null) continue;
    expected += (score / total) * candidateMatch;
  }

  return round(clamp(expected), 4);
}

function coreTraitRule(seasonId) {
  const rules = {
    true_spring: { dimension: "temperature", family: "warm" },
    true_autumn: { dimension: "temperature", family: "warm" },
    true_summer: { dimension: "temperature", family: "cool" },
    true_winter: { dimension: "temperature", family: "cool" },

    light_spring: { dimension: "value", target: "light" },
    light_summer: { dimension: "value", target: "light" },

    deep_autumn: { dimension: "value", target: "deep" },
    deep_winter: { dimension: "value", target: "deep" },

    soft_autumn: { dimension: "chroma", targets: ["soft", "muted"] },
    soft_summer: { dimension: "chroma", targets: ["soft", "muted"] },

    bright_spring: { dimension: "chroma", targets: ["bright", "clear"] },
    bright_winter: { dimension: "chroma", targets: ["bright", "clear"] }
  };

  return rules[seasonId] || null;
}

function normalizedMass(scores, weightedTargets) {
  const entries = Object.entries(scores || {})
    .map(([name, score]) => [name, Math.max(0, Number(score) || 0)]);
  const total = entries.reduce((sum, [, score]) => sum + score, 0);
  if (total <= 0) return null;

  const support = entries.reduce(
    (sum, [name, score]) =>
      sum + score * Number(weightedTargets[name] || 0),
    0
  ) / total;

  return clamp(support);
}

function coreTraitSupport(seasonId, dims, features = {}) {
  const rule = coreTraitRule(seasonId);
  if (!rule) return null;

  const result = dims?.[rule.dimension] || {};
  const confidence = clamp(Number(result.confidence || 0));
  const classification = result.classification;

  if (rule.family === "warm") {
    const support = {
      warm: 1,
      neutral_warm: 0.80,
      neutral: 0.35,
      neutral_cool: 0.10,
      cool: 0
    }[classification];
    return support === undefined ? null : {
      dimension: rule.dimension,
      support,
      confidence,
      mode: "temperature_family"
    };
  }

  if (rule.family === "cool") {
    const support = {
      cool: 1,
      neutral_cool: 0.80,
      neutral: 0.35,
      neutral_warm: 0.10,
      warm: 0
    }[classification];
    return support === undefined ? null : {
      dimension: rule.dimension,
      support,
      confidence,
      mode: "temperature_family"
    };
  }

  // Bright seasons require a combination of chroma AND contrast/definition.
  // "Clear" alone is not enough to call the whole appearance Bright.
  if (["bright_spring", "bright_winter"].includes(seasonId)) {
    const chroma = dims?.chroma || {};
    const contrast = dims?.contrast || {};

    const chromaSupport = normalizedMass(chroma.scores, {
      bright: 1.00,
      clear: 0.50,
      balanced: 0.15,
      soft: 0.03,
      muted: 0
    });

    const contrastSupport = normalizedMass(contrast.scores, {
      high: 1.00,
      medium: 0.25,
      low: 0
    });

    const definitionSupport = ({
      striking: 1.00,
      defined: 0.65,
      moderate: 0.30,
      soft: 0.08,
      unknown: 0.25
    })[features?.contrast?.feature_definition] ?? 0.30;

    if (chromaSupport === null || contrastSupport === null) return null;

    return {
      dimension: "chroma+contrast",
      support: clamp(
        0.60 * chromaSupport +
        0.25 * contrastSupport +
        0.15 * definitionSupport
      ),
      confidence: clamp(
        0.60 * Number(chroma.confidence || 0) +
        0.40 * Number(contrast.confidence || 0)
      ),
      mode: "bright_composite",
      components: {
        chroma: round(chromaSupport, 3),
        contrast: round(contrastSupport, 3),
        definition: round(definitionSupport, 3)
      }
    };
  }

  // Soft seasons treat Balanced as meaningful adjacent support rather than
  // an opposite state. This prevents Balanced from being scored as ~zero Soft.
  if (["soft_autumn", "soft_summer"].includes(seasonId)) {
    const support = normalizedMass(result.scores, {
      muted: 1.00,
      soft: 1.00,
      balanced: 0.45,
      clear: 0.10,
      bright: 0
    });
    return support === null ? null : {
      dimension: "chroma",
      support,
      confidence,
      mode: "soft_adjacent_balanced"
    };
  }

  const scores = result.scores || {};
  const targetSet = new Set(
    rule.targets || (rule.target ? [rule.target] : [])
  );

  const total = Object.values(scores)
    .map(Number)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + Math.max(0, value), 0);

  if (total > 0 && targetSet.size) {
    const targetMass = [...targetSet].reduce(
      (sum, target) =>
        sum + Math.max(0, Number(scores[target] || 0)),
      0
    );

    const support = clamp(targetMass / total);
    const oppositeTarget = rule.target === "light"
      ? "deep"
      : rule.target === "deep"
        ? "light"
        : null;
    const oppositeSupport = oppositeTarget
      ? clamp(Math.max(0, Number(scores[oppositeTarget] || 0)) / total)
      : null;

    return {
      dimension: rule.dimension,
      support,
      confidence,
      mode: "target_mass",
      opposite_support: oppositeSupport
    };
  }

  if (!isUnknown(classification)) {
    return {
      dimension: rule.dimension,
      support: targetSet.has(classification) ? 1 : 0,
      confidence,
      mode: "classification_fallback"
    };
  }

  return null;
}

function applyCoreTraitGuards(scores, dims, features = {}) {
  const adjusted = { ...scores };
  const applied = Object.fromEntries(
    Object.keys(scores).map(season => [season, []])
  );

  for (const season of Object.keys(adjusted)) {
    const core = coreTraitSupport(season, dims, features);
    if (!core || core.confidence < 0.40) continue;

    let penalty = 0;

    if (["bright_spring", "bright_winter"].includes(season)) {
      // Bright is a demanding dominant trait; medium/balanced evidence alone
      // should not leave Bright unpenalized.
      if (core.support < 0.28 && core.confidence >= 0.60) {
        penalty = 22;
      } else if (core.support < 0.40) {
        penalty = 15;
      } else if (core.support < 0.50) {
        penalty = 8;
      }
    } else if (["light_spring", "light_summer", "deep_autumn", "deep_winter"].includes(season)) {
      const closeOpposite = Number.isFinite(Number(core.opposite_support)) &&
        Math.abs(Number(core.support) - Number(core.opposite_support)) < 0.08;

      if (core.support < 0.12 && core.confidence >= 0.60) {
        penalty = 22;
      } else if (core.support < 0.25) {
        penalty = 15;
      } else if (core.support < 0.40) {
        penalty = closeOpposite ? 12 : 8;
      } else if (core.support < 0.45 && closeOpposite) {
        penalty = 8;
      }
    } else {
      if (core.support < 0.12 && core.confidence >= 0.60) {
        penalty = 22;
      } else if (core.support < 0.25) {
        penalty = 15;
      } else if (core.support < 0.40) {
        penalty = 8;
      }
    }

    if (penalty <= 0) continue;

    adjusted[season] = clamp(
      Number(adjusted[season] || 0) - penalty,
      0,
      100
    );

    applied[season].push({
      type: "core_trait_penalty",
      dimension: core.dimension,
      support: round(core.support, 3),
      confidence: round(core.confidence, 3),
      points: -penalty,
      mode: core.mode,
      components: core.components,
      opposite_support: core.opposite_support === null || core.opposite_support === undefined
        ? undefined
        : round(core.opposite_support, 3),
      reason: "Primary seasonal characteristic is weakly supported by the observed evidence."
    });
  }

  return { adjusted, applied };
}

function baseScore(config, profile, dims) {
  const weights = getDimensionWeights(config);

  const minConf = Number(
    config.scoring_algorithm?.minimum_dimension_confidence ??
    config.season_scoring?.dimension_confidence?.minimum_for_use ??
    0.4
  );

  const minAvailableWeight = Number(
    config.scoring_algorithm?.minimum_available_dimension_weight ??
    0
  );

  const uncertainFactor = Number(
    config.scoring_algorithm?.uncertain_dimension_factor ??
    0.45
  );

  let numerator = 0;
  let denominator = 0;
  let availableWeight = 0;
  let effectiveAvailableWeight = 0;

  const breakdown = {};

  function scoreSeparation(result) {
    const values = Object.values(result?.scores || {})
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => b - a);

    if (values.length < 2) return 0;

    return clamp(
      Math.max(0, values[0] - values[1]) / 20
    );
  }

  for (const [dimension, rawWeight] of Object.entries(weights)) {
    const baseWeight = Number(rawWeight || 0);
    const result = dims[dimension] || {};

    const rawConfidence = clamp(
      Number(result.confidence || 0)
    );

    const rawClassification = result.classification;
    const classificationWasUncertain =
      isUnknown(rawClassification);

    const observed = resolveDimensionClassification(
      result
    );

    const distributionMatch = distributionMatchValue(
      config,
      dimension,
      result,
      profile
    );

    const match =
      distributionMatch !== null
        ? distributionMatch
        : matchValue(
            config,
            dimension,
            observed,
            profile
          );

    const dimensionReliability = clamp(
      Number(
        result.reliability?.dimension_reliability ??
        1
      )
    );

    const separation = scoreSeparation(result);

    /*
     * Separation does not replace confidence.
     * It only slightly reduces influence when the dimension's
     * internal candidates are nearly tied.
     */
    const separationFactor =
      0.75 + 0.25 * separation;

    const classificationFactor =
      classificationWasUncertain
        ? uncertainFactor
        : 1;

    const confidenceEligible =
      rawConfidence >= minConf ||
      (
        classificationWasUncertain &&
        rawConfidence >= minConf * 0.75
      );

    const effectiveWeight =
      baseWeight *
      rawConfidence *
      dimensionReliability *
      separationFactor *
      classificationFactor;

    const usable =
      baseWeight > 0 &&
      confidenceEligible &&
      match !== null &&
      effectiveWeight > 0;

    breakdown[dimension] = {
      observed,
      raw_classification: rawClassification,
      classification_was_uncertain:
        classificationWasUncertain,
      confidence: round(rawConfidence, 3),
      dimension_reliability: round(
        dimensionReliability,
        3
      ),
      evidence_coverage: round(
        Number(result.reliability?.coverage ?? 0),
        3
      ),
      score_separation: round(separation, 3),
      separation_factor: round(
        separationFactor,
        3
      ),
      classification_factor: round(
        classificationFactor,
        3
      ),
      base_weight: round(baseWeight, 3),
      effective_weight: round(
        effectiveWeight,
        4
      ),
      match_value: match,
      match_mode:
        distributionMatch !== null
          ? "score_distribution"
          : "classification",
      weighted_match_contribution:
        usable
          ? round(effectiveWeight * match, 4)
          : 0,
      usable
    };

    if (!usable) continue;

    numerator += effectiveWeight * match;
    denominator += effectiveWeight;

    availableWeight += baseWeight;
    effectiveAvailableWeight += effectiveWeight;
  }

  let score =
    denominator > 0 &&
    availableWeight >= minAvailableWeight
      ? round(100 * numerator / denominator, 1)
      : 0;

  let uncertainOppositePenalty = 0;

  for (const item of Object.values(breakdown)) {
    if (
      item.classification_was_uncertain &&
      item.usable &&
      Number(item.match_value) === 0 &&
      Number(item.confidence) >= minConf &&
      Number(item.score_separation) >= 0.15
    ) {
      const penalty =
        Number(item.base_weight || 0) *
        100 *
        Number(item.confidence || 0) *
        0.70;

      uncertainOppositePenalty += penalty;
      item.uncertain_opposite_penalty = round(penalty, 1);
    }
  }

  if (uncertainOppositePenalty > 0) {
    score = round(
      clamp(score - uncertainOppositePenalty, 0, 100),
      1
    );
  }

  return {
    score,
    available_weight: round(
      availableWeight,
      3
    ),
    effective_available_weight: round(
      effectiveAvailableWeight,
      4
    ),
    weighted_denominator: round(
      denominator,
      4
    ),
    reliability_aware: true,
    breakdown
  };
}
function getConditionObservation(condition,dims,features={}) {
  const c=String(condition).trim();
  let left, options;
  if(c.includes(" in [")){
    [left,options]=c.split(" in [");
    options=new Set(options.replace(/\]$/,'').split(',').map(x=>x.trim()));
  } else if(c.includes(" == ")){
    const p=c.split(" == ");
    left=p[0];
    options=new Set([p[1].trim()]);
  } else {
    return {matched:false, observed:undefined, confidence:0, dimension:null};
  }

  left=left.trim();
  let observed;
  let confidence=0;
  let dimension=null;

  if(["temperature","value","chroma","contrast"].includes(left)) {
    dimension=left;
    observed=dims[left]?.classification;
    confidence=Number(dims[left]?.confidence||0);
  } else if(left.endsWith("_engine.classification")) {
    dimension=left.split("_engine")[0];
    observed=dims[dimension]?.classification;
    confidence=Number(dims[dimension]?.confidence||0);
  } else if(left==="feature_definition") {
    observed=features.contrast?.feature_definition;
    confidence=Number(features.contrast?.confidence||dims.contrast?.confidence||0);
  } else {
    let node=features;
    for(const part of left.split('.')) node=node&&typeof node==='object'?node[part]:undefined;
    observed=node;
    const source=left.split('.')[0];
    confidence=Number(features[source]?.confidence||0);
  }

  return {matched:options.has(observed), observed, confidence, dimension, field:left};
}
function conditionMatches(condition,dims,features={}) {
  return getConditionObservation(condition,dims,features).matched;
}
function applyCrossRules(config,scores,dims) {
  const adjusted={...scores}, applied=Object.fromEntries(Object.keys(scores).map(s=>[s,[]]));
  const scale=config.exclusion_rules?.penalty_scale||{};
  const boostValue=Math.abs(Number(scale.minor??-4))+2;
  const penaltyValue=Math.abs(Number(scale.moderate??-8));

  for(const rule of config.exclusion_rules?.cross_dimension_rules||[]){
    let ok=true;
    const evidence=[];
    for(const [d,e] of Object.entries(rule.when||{})){
      const o=dims[d]?.classification;
      const matched=Array.isArray(e)?e.includes(o):o===e;
      if(!matched){ok=false;break;}
      evidence.push({dimension:d,observed:o,confidence:Number(dims[d]?.confidence||0)});
    }
    if(!ok)continue;

    const averageConfidence=evidence.length?evidence.reduce((a,b)=>a+b.confidence,0)/evidence.length:0;
    if(averageConfidence<0.4)continue;

    for(const s of rule.effects?.boost||[]) if(s in adjusted){
      adjusted[s]=clamp(adjusted[s]+boostValue,0,100);
      applied[s].push({type:"cross_boost",rule_id:rule.id,points:boostValue,reason:rule.reason,evidence});
    }
    for(const s of rule.effects?.penalize||[]) if(s in adjusted){
      adjusted[s]=clamp(adjusted[s]-penaltyValue,0,100);
      applied[s].push({type:"cross_penalty",rule_id:rule.id,points:-penaltyValue,reason:rule.reason,evidence});
    }
  }
  return {adjusted,applied};
}
function applyExclusions(config,scores,dims,features) {
  const rulesConfig=config.exclusion_rules||{};
  const scale=rulesConfig.penalty_scale||{};
  const adjusted={...scores};
  const hard=Object.fromEntries(Object.keys(scores).map(s=>[s,false]));
  const applied=Object.fromEntries(Object.keys(scores).map(s=>[s,[]]));
  const hardReasons=Object.fromEntries(Object.keys(scores).map(s=>[s,[]]));
  const scoreBefore={...scores};
  const qualityOk=features?.quality?.continue_analysis!==false;

  if(!qualityOk) return {adjusted,hard,applied,hardReasons,scoreBefore};

  for(const [season,rules] of Object.entries(rulesConfig.season_rules||{})){
    if(!(season in adjusted)) continue;

    for(const rule of rules.strong_penalties||[]){
      const ev=getConditionObservation(rule.condition,dims,features);
      if(!ev.matched || ev.confidence<0.4) continue;
      const severity=ev.confidence>=0.6?"strong":"moderate";
      const penalty=Math.abs(Number(scale[severity]??(severity==="strong"?-15:-8)));
      adjusted[season]=clamp(adjusted[season]-penalty,0,100);
      applied[season].push({type:`${severity}_penalty`,condition:rule.condition,points:-penalty,reason:rule.reason,observed:ev.observed,confidence:round(ev.confidence,3)});
    }

    const hardEvidence=[];
    for(const rule of rules.hard_exclusions||[]){
      const ev=getConditionObservation(rule.condition,dims,features);
      if(ev.matched) hardEvidence.push({rule,ev});
    }

    const veryStrong=hardEvidence.filter(x=>x.ev.confidence>=0.75);
    const independentStrong=hardEvidence.filter(x=>x.ev.confidence>=0.60);
    const independentDimensions=new Set(independentStrong.map(x=>x.ev.dimension||x.ev.field));
    const qualifies=veryStrong.length>=1 || independentDimensions.size>=2;

    if(qualifies){
      hard[season]=true;
      adjusted[season]=0;
      for(const item of hardEvidence){
        hardReasons[season].push(item.rule.reason);
        applied[season].push({type:"hard_exclusion",condition:item.rule.condition,points:Number(scale.hard_exclusion??-30),reason:item.rule.reason,observed:item.ev.observed,confidence:round(item.ev.confidence,3)});
      }
    } else {
      for(const item of hardEvidence){
        if(item.ev.confidence<0.4) continue;
        const penalty=Math.abs(Number(scale.strong??-15));
        adjusted[season]=clamp(adjusted[season]-penalty,0,100);
        applied[season].push({type:"strong_penalty_from_unconfirmed_hard_rule",condition:item.rule.condition,points:-penalty,reason:item.rule.reason,observed:item.ev.observed,confidence:round(item.ev.confidence,3)});
      }
    }
  }
  return {adjusted,hard,applied,hardReasons,scoreBefore};
}
function resolveConfusion(config,ranking,dims,features) {
  if (ranking.length < 2) return { triggered:false, unresolved:false, winner:null };
  const [a,b] = ranking;
  const gap = Math.abs(a.score_after_modifiers - b.score_after_modifiers);
  if (gap > config.confusion_resolution.trigger.top_two_score_gap_max) {
    return { triggered:false, unresolved:false, winner:null };
  }

  const pair = new Set([a.season_id, b.season_id]);

  // Built-in generic resolver for the warm "True" pair.
  // It is deliberately season-pair based, not person-specific.
  if (pair.has("true_spring") && pair.has("true_autumn")) {
    const value = dims?.value?.scores || {};
    const chroma = dims?.chroma?.scores || {};
    const valueTotal = Object.values(value).reduce((s,v)=>s+Math.max(0,Number(v)||0),0);
    const chromaTotal = Object.values(chroma).reduce((s,v)=>s+Math.max(0,Number(v)||0),0);

    const valueSpring = valueTotal > 0
      ? (Math.max(0,Number(value.light)||0) + 0.50*Math.max(0,Number(value.medium)||0)) / valueTotal
      : 0;
    const valueAutumn = valueTotal > 0
      ? (Math.max(0,Number(value.deep)||0) + 0.60*Math.max(0,Number(value.medium)||0)) / valueTotal
      : 0;

    const chromaSpring = chromaTotal > 0
      ? (
          1.00*Math.max(0,Number(chroma.bright)||0) +
          0.80*Math.max(0,Number(chroma.clear)||0) +
          0.25*Math.max(0,Number(chroma.balanced)||0)
        ) / chromaTotal
      : 0;
    const chromaAutumn = chromaTotal > 0
      ? (
          1.00*Math.max(0,Number(chroma.muted)||0) +
          1.00*Math.max(0,Number(chroma.soft)||0) +
          0.80*Math.max(0,Number(chroma.balanced)||0) +
          0.25*Math.max(0,Number(chroma.clear)||0)
        ) / chromaTotal
      : 0;

    let springPoints = 4*valueSpring + 4*chromaSpring;
    let autumnPoints = 4*valueAutumn + 4*chromaAutumn;
    const evidence = [
      { candidate:"true_spring", type:"distribution_value", points:round(4*valueSpring,2), support:round(valueSpring,3) },
      { candidate:"true_spring", type:"distribution_chroma", points:round(4*chromaSpring,2), support:round(chromaSpring,3) },
      { candidate:"true_autumn", type:"distribution_value", points:round(4*valueAutumn,2), support:round(valueAutumn,3) },
      { candidate:"true_autumn", type:"distribution_chroma", points:round(4*chromaAutumn,2), support:round(chromaAutumn,3) }
    ];

    const hairDepth = features?.hair?.depth;
    if (["medium_deep","deep","very_deep"].includes(hairDepth)) {
      autumnPoints += 2;
      evidence.push({ candidate:"true_autumn", type:"hair_depth", points:2, observed:hairDepth });
    } else if (["very_light","light","light_medium"].includes(hairDepth)) {
      springPoints += 2;
      evidence.push({ candidate:"true_spring", type:"hair_depth", points:2, observed:hairDepth });
    }

    if (features?.eyebrows?.depth_relative_to_hair === "darker") {
      autumnPoints += 1;
      evidence.push({ candidate:"true_autumn", type:"darker_eyebrows", points:1 });
    }

    const margin = Math.abs(springPoints - autumnPoints);
    const minimum = Math.max(
      1.25,
      Number(config.confusion_resolution?.generic_neighbor_rule?.minimum_decision_margin || 0)
    );

    if (margin < minimum) {
      return {
        triggered:true,
        pair_id:"true_spring_vs_true_autumn_builtin",
        winner:null,
        decision_margin:round(margin,2),
        unresolved:true,
        applied_evidence:evidence,
        reason:"decision_margin_below_minimum"
      };
    }

    return {
      triggered:true,
      pair_id:"true_spring_vs_true_autumn_builtin",
      winner:springPoints > autumnPoints ? "true_spring" : "true_autumn",
      decision_margin:round(margin,2),
      unresolved:false,
      applied_evidence:evidence,
      points:{
        true_spring:round(springPoints,2),
        true_autumn:round(autumnPoints,2)
      }
    };
  }

  let pairId=null,rule=null;
  for(const [k,r] of Object.entries(config.confusion_resolution.rules||{})) {
    if(
      new Set([r.candidate_a,r.candidate_b]).size===new Set([a.season_id,b.season_id]).size &&
      [r.candidate_a,r.candidate_b].includes(a.season_id) &&
      [r.candidate_a,r.candidate_b].includes(b.season_id)
    ){
      pairId=k; rule=r; break;
    }
  }
  if(!rule)return{triggered:true,pair_id:null,winner:null,decision_margin:0,unresolved:true,applied_evidence:[],reason:"no_specific_confusion_rule"};
  const points={[rule.candidate_a]:0,[rule.candidate_b]:0}, evidence=[];
  for(const [side,candidate] of [["evidence_for_a",rule.candidate_a],["evidence_for_b",rule.candidate_b]]) {
    for(const item of rule[side]||[]) {
      if(conditionMatches(item.condition,dims,features)){
        points[candidate]+=Number(item.points);
        evidence.push({candidate,...item});
      }
    }
  }
  const margin=Math.abs(points[rule.candidate_a]-points[rule.candidate_b]);
  const min=config.confusion_resolution.generic_neighbor_rule.minimum_decision_margin;
  if(margin<min)return{triggered:true,pair_id:pairId,winner:null,decision_margin:margin,unresolved:true,applied_evidence:evidence,reason:"decision_margin_below_minimum"};
  const winner=points[rule.candidate_a]>points[rule.candidate_b]?rule.candidate_a:rule.candidate_b;
  return{triggered:true,pair_id:pairId,winner,decision_margin:margin,unresolved:false,applied_evidence:evidence};
}
function finalConfidence(config,dims,ranking,quality,confusion) {
  const settings = config.confidence_engine_v2 || {};
  const weights = settings.weights || {
    gap_score: 0.40,
    dimension_score: 0.25,
    coverage_score: 0.20,
    consistency_score: 0.15
  };

  const dimensionEntries = Object.entries(dims).filter(
    ([, result]) => result && typeof result === "object"
  );

  function scoreGapComponent(points) {
    const gap = Math.max(0, Number(points || 0));
    const curve = settings.gap_curve || [
      [18, 0.95],
      [14, 0.85],
      [10, 0.75],
      [8, 0.62],
      [5, 0.45],
      [3, 0.30],
      [0.01, 0.18],
      [0, 0.10]
    ];

    for (const [threshold, score] of curve) {
      if (gap >= Number(threshold)) return clamp(Number(score));
    }
    return 0.10;
  }

  function usableDimension(result) {
    return (
      !isUnknown(result?.classification) &&
      clamp(Number(result?.confidence || 0)) >=
        Number(settings.minimum_usable_confidence || 0.30)
    );
  }

  function independentConsistencyScore() {
    const usable = dimensionEntries.filter(
      ([, result]) => usableDimension(result)
    );

    if (!usable.length) return 0;

    const values = usable.map(([, result]) => {
      const scores = Object.values(result.scores || {})
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => b - a);

      const separation = scores.length >= 2
        ? clamp(Math.max(0, scores[0] - scores[1]) / 20)
        : 0;

      const conflictPenalty = Array.isArray(result.conflicts)
        ? Math.min(0.30, result.conflicts.length * 0.10)
        : 0;

      return clamp(
        0.55 +
        0.45 * separation -
        conflictPenalty
      );
    });

    const rawConsistency =
      values.reduce((a, b) => a + b, 0) /
      values.length;

    const maximumConsistency = Number(
      settings.maximum_consistency_score ?? 0.95
    );

    return Math.min(
      maximumConsistency,
      rawConsistency
    );
  }

  const gapPoints =
    ranking.length > 1
      ? Math.abs(
          Number(ranking[0].score_after_modifiers || 0) -
          Number(ranking[1].score_after_modifiers || 0)
        )
      : 0;

  const gapScore = scoreGapComponent(gapPoints);

  const usableDimensions = dimensionEntries.filter(
    ([, result]) => usableDimension(result)
  );

  const dimensionScore = usableDimensions.length
    ? usableDimensions.reduce(
        (sum, [, result]) =>
          sum + clamp(Number(result.confidence || 0)),
        0
      ) / usableDimensions.length
    : 0;

  const coverageScore = usableDimensions.length
    ? usableDimensions.reduce(
        (sum, [, result]) =>
          sum +
          clamp(Number(result.reliability?.coverage ?? 0)),
        0
      ) / usableDimensions.length
    : 0;

  const consistencyScore = independentConsistencyScore();

  let finalScore =
    Number(weights.gap_score || 0.40) * gapScore +
    Number(weights.dimension_score || 0.25) * dimensionScore +
    Number(weights.coverage_score || 0.20) * coverageScore +
    Number(weights.consistency_score || 0.15) * consistencyScore;

  const penalties = [];

  if (confusion?.triggered && confusion?.unresolved && confusion?.pair_id) {
    const penalty = Number(settings.penalties?.specific_confusion_unresolved ?? 0.08);
    finalScore -= penalty;
    penalties.push({ type: "specific_confusion_unresolved", value: -penalty });
  } else if (confusion?.triggered && confusion?.unresolved) {
    const penalty = Number(settings.penalties?.generic_close_result ?? 0.03);
    finalScore -= penalty;
    penalties.push({ type: "generic_close_result", value: -penalty });
  }

  const unknownCount = dimensionEntries.filter(
    ([, result]) => isUnknown(result?.classification)
  ).length;

  if (unknownCount === 1) {
    const penalty = Number(settings.penalties?.one_dimension_unknown ?? 0.03);
    finalScore -= penalty;
    penalties.push({ type: "one_dimension_unknown", value: -penalty });
  } else if (unknownCount >= 2) {
    const penalty = Number(settings.penalties?.multiple_dimensions_unknown ?? 0.10);
    finalScore -= penalty;
    penalties.push({ type: "multiple_dimensions_unknown", value: -penalty });
  }

  if (quality === "poor") {
    const penalty = Number(settings.penalties?.poor_photo_quality ?? 0.12);
    finalScore -= penalty;
    penalties.push({ type: "poor_photo_quality", value: -penalty });
  }

  const winnerCorePenalty = Array.isArray(ranking?.[0]?.applied_rules)
    ? ranking[0].applied_rules.find(
        rule => rule?.type === "core_trait_penalty"
      )
    : null;

  if (winnerCorePenalty) {
    const penalty =
      Math.abs(Number(winnerCorePenalty.points || 0)) >= 15
        ? 0.10
        : 0.05;

    finalScore -= penalty;
    penalties.push({
      type: "winner_core_trait_weak",
      value: -penalty,
      dimension: winnerCorePenalty.dimension,
      support: winnerCorePenalty.support
    });
  }

  const dimensions = dimensionEntries.map(
    ([name, result]) => {
      const confidence = clamp(Number(result.confidence || 0));
      const coverage = clamp(Number(result.reliability?.coverage ?? 0));
      const separation = clamp(Number(result.reliability?.score_separation ?? 0));
      const strong =
        !isUnknown(result?.classification) &&
        confidence >= Number(settings.minimum_strong_confidence || 0.65) &&
        coverage >= Number(settings.minimum_strong_coverage || 0.60) &&
        separation >= Number(settings.minimum_strong_separation || 0.30);

      return {
        dimension: name,
        classification: result.classification,
        confidence: round(confidence, 3),
        evidence_coverage: round(coverage, 3),
        score_separation: round(separation, 3),
        dimension_reliability: round(
          Number(result.reliability?.dimension_reliability ?? 1),
          3
        ),
        usable: usableDimension(result),
        strong
      };
    }
  );

  const temperatureConflictCount = Array.isArray(dims?.temperature?.conflicts)
    ? dims.temperature.conflicts.length
    : 0;

  if (temperatureConflictCount > 0) {
    const penalty = Math.min(0.06, 0.025 * temperatureConflictCount);
    finalScore -= penalty;
    penalties.push({
      type: "temperature_evidence_conflict",
      value: -round(penalty, 3),
      conflict_count: temperatureConflictCount
    });
  }

  const strongCount = dimensions.filter(x => x.strong).length;
  if (strongCount < 3 && dimensions.filter(x => x.usable).length >= 3) {
    const penalty = strongCount <= 1 ? 0.05 : 0.03;
    finalScore -= penalty;
    penalties.push({
      type: "limited_strong_dimensions",
      value: -penalty,
      strong_dimensions: strongCount
    });
  }

  finalScore = clamp(finalScore);

  const levels = settings.levels || {
    very_high: 0.86,
    high: 0.71,
    medium: 0.51,
    low: 0.36
  };

  const level =
    finalScore >= Number(levels.very_high) ? "very_high" :
    finalScore >= Number(levels.high) ? "high" :
    finalScore >= Number(levels.medium) ? "medium" :
    finalScore >= Number(levels.low) ? "low" :
    "very_low";

  return {
    version: "2.1",
    score: round(finalScore, 3),
    level,
    usable_dimensions: dimensions.filter(x => x.usable).length,
    strong_dimensions: dimensions.filter(x => x.strong).length,
    components: {
      gap_score: round(gapScore, 3),
      dimension_score: round(dimensionScore, 3),
      coverage_score: round(coverageScore, 3),
      consistency_score: round(consistencyScore, 3)
    },
    weights,
    score_gap_points: round(gapPoints, 1),
    dimensions,
    penalties
  };
}
function runScoring(config,dims,quality,features) {
  const profiles = config.season_scoring.season_profiles;
  const baseDetails = Object.fromEntries(
    Object.entries(profiles).map(([season, profile]) => [season, baseScore(config, profile, dims)])
  );
  const base = Object.fromEntries(
    Object.entries(baseDetails).map(([season, detail]) => [season, detail.score])
  );
  const core = applyCoreTraitGuards(base, dims, adapted.features);
  const cross = applyCrossRules(config, core.adjusted, dims);
  const excl = applyExclusions(config, cross.adjusted, dims, features);
  const ranking = Object.keys(profiles)
    .map(season => ({
      season_id: season,
      base_score: base[season],
      score_before_exclusions: round(cross.adjusted[season], 1),
      score_after_modifiers: round(excl.adjusted[season], 1),
      hard_excluded: excl.hard[season],
      hard_exclusion_reasons: excl.hardReasons[season],
      score_breakdown: baseDetails[season].breakdown,
      available_dimension_weight:
        baseDetails[season].available_weight,
      effective_dimension_weight:
        baseDetails[season].effective_available_weight,
      reliability_aware_scoring:
        baseDetails[season].reliability_aware,
      applied_rules: [
        ...core.applied[season],
        ...cross.applied[season],
        ...excl.applied[season]
      ]
    }))
    .sort((a,b) => b.score_after_modifiers - a.score_after_modifiers || a.season_id.localeCompare(b.season_id));
  const confusion=resolveConfusion(config,ranking,dims,features);
  if(confusion.triggered&&!confusion.unresolved&&confusion.winner){
    const i=ranking.findIndex(x=>x.season_id===confusion.winner);
    if(i>0)[ranking[0],ranking[i]]=[ranking[i],ranking[0]];
  }

  ranking.forEach((x,i)=>x.rank=i+1);

  const conf=finalConfidence(config,dims,ranking,quality,confusion);
  const best=ranking[0];
  const usableDimensions=conf.usable_dimensions;
  const strongDimensions=conf.strong_dimensions;
  const allExcluded=ranking.every(x=>x.hard_excluded);

  const noResult=
    !best ||
    allExcluded ||
    quality==="poor" ||
    best.score_after_modifiers<40 ||
    usableDimensions===0;

  const provisional=
    !noResult && (
      ["very_low","low"].includes(conf.level) ||
      confusion.unresolved ||
      usableDimensions<3
    );

  const requestBetterPhoto=
    quality==="poor" ||
    usableDimensions<2 ||
    conf.level==="very_low" ||
    confusion.unresolved;

  const scoringDiagnostics = {
    mode: "reliability_aware",
    stability_fix_version: "4.9.5",
    temperature_conflicts:
      Array.isArray(dims.temperature?.conflicts)
        ? dims.temperature.conflicts
        : [],
    formula:
      "base_weight × dimension_confidence × reliability × score_separation_factor × classification_factor × distribution_match + calibrated_core_trait_guards_v4_9_5",
    uncertain_dimension_factor: Number(
      config.scoring_algorithm?.uncertain_dimension_factor ??
      0.45
    ),
    dimensions: Object.fromEntries(
      Object.entries(dims).map(([name, result]) => [
        name,
        {
          classification: result.classification,
          confidence: round(
            Number(result.confidence || 0),
            3
          ),
          reliability_coverage: round(
            Number(
              result.reliability?.coverage ?? 1
            ),
            3
          )
        }
      ])
    )
  };

  return{
    season_ranking:ranking,
    scoring_diagnostics:scoringDiagnostics,
    confusion_resolution:confusion,
    result:{
      best_match:noResult?null:ranking[0].season_id,
      second_match:noResult?null:ranking[1]?.season_id||null,
      third_match:noResult?null:ranking[2]?.season_id||null,
      confidence:conf.score,
      confidence_percent:Math.round(conf.score*100),
      confidence_level:conf.level,
      confidence_engine:{
        version:conf.version,
        gap_score:conf.components.gap_score,
        dimension_score:conf.components.dimension_score,
        coverage_score:conf.components.coverage_score,
        consistency_score:conf.components.consistency_score,
        weights:conf.weights,
        final_confidence:conf.score
      },
      decision_status:noResult?"insufficient":provisional?"provisional":"final",
      usable_dimensions:usableDimensions,
      strong_dimensions:strongDimensions,
      confidence_diagnostics:{
        version:conf.version,
        components:conf.components,
        weights:conf.weights,
        score_gap_points:conf.score_gap_points,
        dimensions:conf.dimensions,
        penalties:conf.penalties
      },
      score_gap_to_second:noResult||!ranking[1]?null:round(
        ranking[0].score_after_modifiers-ranking[1].score_after_modifiers,1
      ),
      request_better_photo:noResult||requestBetterPhoto
    }
  };
}

const {config,files}=await loadConfig();
assert(config.engine&&config.temperature_engine&&config.value_engine&&config.chroma_engine&&config.contrast_engine&&config.season_scoring,"configuration incomplete");
const adapted=adaptExtractor(extractor);
const evidenceReliability=calculateEvidenceReliability(extractor,adapted,config);
if(!adapted.quality.continue_analysis){return{ok:true,stage:"completed",runtime_version:ENGINE_RUNTIME_VERSION,engine_version:config.engine.version,quality:adapted.quality,evidence_reliability:evidenceReliability,dimension_results:{},season_ranking:[],result:{best_match:null,second_match:null,third_match:null,confidence:0,confidence_percent:0,confidence_level:"insufficient",request_better_photo:true}};}
const dims={
  temperature:calculateTemperature(
    config,
    adapted.features,
    adapted.quality,
    evidenceReliability
  ),
  value:calculateValue(
    config,
    adapted.features,
    adapted.quality,
    evidenceReliability
  ),
  chroma:calculateChroma(
    config,
    adapted.features,
    adapted.quality,
    evidenceReliability
  ),
  contrast:calculateContrast(
    config,
    adapted.features,
    adapted.quality,
    evidenceReliability
  )
};
dims.temperature = stabilizeTemperatureResult(
  dims.temperature,
  extractor
);

const decision=runScoring(
  config,
  dims,
  adapted.quality.overall_quality,
  adapted.features
);

const localScoringDiagnostics = {
  resolved_dimensions: Object.fromEntries(
    Object.entries(dims).map(([name, result]) => [
      name,
      {
        original_classification: result.classification,
        scoring_classification:
          resolveDimensionClassification(result),
        confidence: result.confidence,
        evidence_coverage:
          result.reliability?.coverage ?? 0,
        dimension_reliability:
          result.reliability?.dimension_reliability ?? 1
      }
    ])
  ),
  dimension_weights: getDimensionWeights(config),
  minimum_dimension_confidence:
    config.scoring_algorithm?.minimum_dimension_confidence ??
    0.4
};

return {
  ok: true,
  stage: "completed",
  runtime_version: ENGINE_RUNTIME_VERSION,
  engine: {
    name: config.engine.name,
    version: config.engine.version,
    status: config.engine.status
  },
  extractor: {
    version: extractor.extractor_version,
    status: extractor.analysis_status,
    global_reliability: extractor.global_reliability
  },
  quality: adapted.quality,
  observed_colors: extractor.observed_colors,
  evidence_reliability: evidenceReliability,
  dimension_results: dims,
  ...decision,
  scoring_diagnostics: {
    ...localScoringDiagnostics,
    ...(decision.scoring_diagnostics || {})
  },
  loaded_files: files
};
