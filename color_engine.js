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
 * DiArt Color Engine v4.0.0
 * Stable Make Code entrypoint loaded from GitHub.
 * Input: input.extractor, input.base_url
 */

const ENGINE_RUNTIME_VERSION = "4.0.0";
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

async function loadConfig() {
  const manifest = await fetchJson("manifest.json");
  assert(manifest.entrypoint && manifest.modules, "invalid manifest.json");
  const files = [...new Set([manifest.entrypoint, ...Object.values(manifest.modules)].filter(Boolean))];
  const parts = await Promise.all(files.map(fetchJson));
  return { config: Object.assign({}, ...parts), files };
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
  return "mixed";
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
        undertone_family: inferUndertoneFamily(ex),
        surface_redness: oc.skin?.redness_level || "unknown",
        clarity: chromaToSkinHair(skinChroma),
        translucency: "unknown",
        natural_blush: "not_visible",
        freckles: "unknown",
        observed_hex: oc.skin?.hex ?? null,
        confidence: clamp(confidenceMean([vf.skin_temperature?.confidence, vf.skin_value?.confidence, vf.skin_chroma?.confidence, oc.skin?.confidence]))
      },
      eyes: {
        visible: Boolean(oc.eyes),
        base_color: normalizeEyeColor(oc.eyes?.primary_color),
        temperature: eyeTemp,
        clarity: normalizeClarity(eyeChroma),
        brightness: brightnessFromDepth(eyeDepth),
        iris_contrast: collapseContrast(cf.skin_eye_value_difference?.level),
        limbal_ring: "unknown",
        golden_flecks: "unknown",
        cool_gray_veil: String(oc.eyes?.secondary_color || "").includes("gray") ? "visible" : "unknown",
        observed_hex: oc.eyes?.hex ?? null,
        confidence: clamp(confidenceMean([vf.eye_temperature?.confidence, vf.eye_value?.confidence, vf.eye_chroma?.confidence, oc.eyes?.confidence]))
      },
      hair: {
        visible: Boolean(oc.hair),
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
      eyebrows: { visible: false, depth_relative_to_hair: "unknown", temperature: "uncertain", clarity: "unknown", confidence: 0 },
      lips: { visible: false, natural_color: "unknown", temperature: "uncertain", depth: "unknown", clarity: "unknown", confidence: 0 },
      contrast: {
        skin_hair_contrast: collapseContrast(cf.skin_hair_value_difference?.level),
        skin_eye_contrast: collapseContrast(cf.skin_eye_value_difference?.level),
        feature_definition: featureDefinition,
        overall_contrast: overallContrast,
        confidence: clamp(cf.overall_contrast_observation?.confidence || ex.global_reliability || 0)
      },
      overall_impression: {
        dominant_temperature: majority([skinTemp, eyeTemp, hairTemp]),
        dominant_value: majority([collapseDepth(skinDepth), collapseDepth(eyeDepth), collapseDepth(hairDepth)]),
        dominant_chroma: majority([skinChroma, eyeChroma, hairChroma]),
        dominant_contrast: overallContrast,
        confidence: clamp(ex.global_reliability || 0)
      }
    }
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

function calculateTemperature(config, features, quality) {
  const cfg = config.temperature_engine, totals={warm:0,cool:0,neutral:0}, evidence=[];
  const sw=Object.fromEntries(cfg.evidence_priority.map(x=>[x.source,Number(x.weight)])); let used=0;
  const skin=features.skin||{}, sc=clamp(skin.confidence);
  for (const [field,section,w] of [["temperature","temperature",.55],["undertone_family","undertone_family",.3],["natural_blush","natural_blush",.1],["freckles","freckles",.05]]) used += addMapping(totals,cfg.skin_rules[section]?.[skin[field]],sw.skin*w,sc,evidence,{source:"skin",field,observed_value:skin[field]});
  const lips=features.lips||{}, lc=clamp(lips.confidence);
  for (const [field,section,w] of [["temperature","temperature",.7],["natural_color","natural_color",.3]]) used += addMapping(totals,cfg.lips_rules[section]?.[lips[field]],sw.lips*w,lc,evidence,{source:"lips",field,observed_value:lips[field]});
  const eyes=features.eyes||{}, ec=clamp(eyes.confidence);
  used += addMapping(totals,cfg.eyes_rules.temperature?.[eyes.temperature],sw.eyes*.75,ec,evidence,{source:"eyes",field:"temperature",observed_value:eyes.temperature});
  used += addMapping(totals,cfg.eyes_rules.supporting_markers?.[`golden_flecks_${eyes.golden_flecks}`],sw.eyes*.125,ec,evidence,{source:"eyes",field:"golden_flecks",observed_value:eyes.golden_flecks});
  used += addMapping(totals,cfg.eyes_rules.supporting_markers?.[`cool_gray_veil_${eyes.cool_gray_veil}`],sw.eyes*.125,ec,evidence,{source:"eyes",field:"cool_gray_veil",observed_value:eyes.cool_gray_veil});
  const hair=features.hair||{}, hc=clamp(hair.confidence), hm=({natural:1,likely_natural:.85,possibly_colored:.45,colored:0,unknown:.35})[hair.naturalness]??.35;
  for (const [field,section,w] of [["temperature","temperature",.55],["undertone","undertone",.3],["natural_highlights","natural_highlights",.15]]) used += addMapping(totals,cfg.hair_rules[section]?.[hair[field]],sw.hair*w*hm,hc,evidence,{source:"hair",field,observed_value:hair[field]});
  const scores=normalizedScores(totals,used), gap=scores.warm-scores.cool; let classification="uncertain";
  if (used>=cfg.global_rules.minimum_total_evidence_weight) {
    if(scores.warm>=65&&gap>=20) classification="warm"; else if(scores.cool>=65&&-gap>=20) classification="cool"; else if(scores.warm>=52&&gap>=8) classification="neutral_warm"; else if(scores.cool>=52&&-gap>=8) classification="neutral_cool"; else if(Math.abs(gap)<=7) classification="neutral"; else classification=gap>0?"neutral_warm":"neutral_cool";
  }
  const confidence=round(Math.min(1,used/Object.values(sw).reduce((a,b)=>a+b,0))*qualityMultiplier(quality.overall_quality),3);
  return {classification,confidence,scores,evidence,conflicts:[]};
}

function calculateValue(config, features, quality) {
  const cfg=config.value_engine, totals={light:0,medium:0,deep:0}, evidence=[]; const sw=Object.fromEntries(cfg.evidence_priority.map(x=>[x.source,Number(x.weight)])); let used=0;
  const skin=features.skin||{}; used+=addMapping(totals,cfg.mapping.skin_depth?.[skin.dominant_depth],sw.skin,clamp(skin.confidence),evidence,{source:"skin",field:"dominant_depth",observed_value:skin.dominant_depth});
  const hair=features.hair||{}, hm=cfg.global_rules.hair_handling?.[hair.naturalness]??.35; used+=addMapping(totals,cfg.mapping.hair_depth?.[hair.depth],sw.hair*hm,clamp(hair.confidence),evidence,{source:"hair",field:"depth",observed_value:hair.depth});
  const eyes=features.eyes||{}, ec=clamp(eyes.confidence); used+=addMapping(totals,cfg.mapping.eye_base_color?.[eyes.base_color],sw.eyes*.85,ec,evidence,{source:"eyes",field:"base_color",observed_value:eyes.base_color}); used+=addMapping(totals,cfg.mapping.eye_brightness_modifier?.[eyes.brightness],sw.eyes*.15,ec,evidence,{source:"eyes",field:"brightness",observed_value:eyes.brightness});
  const overall=features.overall_impression||{}; used+=addMapping(totals,cfg.mapping.overall_value?.[overall.dominant_value],sw.overall_impression,clamp(overall.confidence),evidence,{source:"overall_impression",field:"dominant_value",observed_value:overall.dominant_value});
  const scores=normalizedScores(totals,used), ordered=Object.entries(scores).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])); let classification="uncertain";
  const mixed=scores.light>=25&&scores.deep>=25&&Math.abs(scores.light-scores.deep)<=15&&scores.medium>=30;
  if(used>=cfg.global_rules.minimum_total_evidence_weight) classification=mixed?"medium":((ordered[0][1]-ordered[1][1]>=5)?ordered[0][0]:"uncertain");
  return {classification,confidence:round(Math.min(1,used/Object.values(sw).reduce((a,b)=>a+b,0))*qualityMultiplier(quality.overall_quality),3),scores,evidence,conflicts:[]};
}

function calculateChroma(config, features, quality) {
  const cfg=config.chroma_engine, totals={bright:0,clear:0,balanced:0,soft:0,muted:0}, evidence=[]; const sw=Object.fromEntries(cfg.evidence_priority.map(x=>[x.source,Number(x.weight)])); let used=0;
  const skin=features.skin||{}, sc=clamp(skin.confidence); used+=addMapping(totals,cfg.mapping.skin_clarity?.[skin.clarity],sw.skin*.8,sc,evidence,{source:"skin",field:"clarity",observed_value:skin.clarity}); used+=addMapping(totals,cfg.mapping.skin_translucency?.[skin.translucency],sw.skin*.2,sc,evidence,{source:"skin",field:"translucency",observed_value:skin.translucency});
  const eyes=features.eyes||{}, ec=clamp(eyes.confidence); for(const [f,m,w] of [["clarity","eyes_clarity",.5],["brightness","eyes_brightness",.2],["iris_contrast","iris_contrast",.2],["limbal_ring","limbal_ring",.1]]) used+=addMapping(totals,cfg.mapping[m]?.[eyes[f]],sw.eyes*w,ec,evidence,{source:"eyes",field:f,observed_value:eyes[f]});
  const hair=features.hair||{}, hc=clamp(hair.confidence), hm=cfg.global_rules.hair_handling?.[hair.naturalness]??.35; used+=addMapping(totals,cfg.mapping.hair_clarity?.[hair.clarity],sw.hair*.75*hm,hc,evidence,{source:"hair",field:"clarity",observed_value:hair.clarity}); used+=addMapping(totals,cfg.mapping.hair_shine?.[hair.shine],sw.hair*.25*hm,hc,evidence,{source:"hair",field:"shine",observed_value:hair.shine});
  const contrast=features.contrast||{}; used+=addMapping(totals,cfg.mapping.feature_definition?.[contrast.feature_definition],sw.contrast,clamp(contrast.confidence),evidence,{source:"contrast",field:"feature_definition",observed_value:contrast.feature_definition});
  const overall=features.overall_impression||{}; used+=addMapping(totals,cfg.mapping.overall_chroma?.[overall.dominant_chroma],sw.overall_impression,clamp(overall.confidence),evidence,{source:"overall_impression",field:"dominant_chroma",observed_value:overall.dominant_chroma});
  const scores=normalizedScores(totals,used), ordered=Object.entries(scores).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])); let classification="uncertain";
  let markers=(overall.dominant_chroma==="bright"?2:0)+(contrast.feature_definition==="striking"?2:0)+(eyes.clarity==="sparkling"?1:0)+(eyes.brightness==="high"?1:0)+(eyes.iris_contrast==="high"?1:0)+(contrast.overall_contrast==="high"?1:0);
  const brightOverride=scores.bright>=55&&(scores.clear-scores.bright)<=18&&markers>=3;
  if(used>=cfg.global_rules.minimum_total_evidence_weight) classification=brightOverride?"bright":((ordered[0][1]-ordered[1][1]>=5)?ordered[0][0]:"uncertain");
  return {classification,confidence:round(Math.min(1,used/Object.values(sw).reduce((a,b)=>a+b,0))*qualityMultiplier(quality.overall_quality),3),scores,evidence,conflicts:[]};
}

function calculateContrast(config, features, quality) {
  const cfg=config.contrast_engine, totals={low:0,medium:0,high:0}, evidence=[]; const sw=Object.fromEntries(cfg.evidence_priority.map(x=>[x.source,Number(x.weight)])); let used=0;
  const c=features.contrast||{}, cc=clamp(c.confidence), hair=features.hair||{}, hm=cfg.global_rules.hair_handling?.[hair.naturalness]??.35;
  used+=addMapping(totals,cfg.mapping.skin_hair_contrast?.[c.skin_hair_contrast],sw.skin_hair_contrast*hm,cc,evidence,{source:"skin_hair_contrast",field:"skin_hair_contrast",observed_value:c.skin_hair_contrast});
  used+=addMapping(totals,cfg.mapping.skin_eye_contrast?.[c.skin_eye_contrast],sw.skin_eye_contrast,cc,evidence,{source:"skin_eye_contrast",field:"skin_eye_contrast",observed_value:c.skin_eye_contrast});
  used+=addMapping(totals,cfg.mapping.feature_definition?.[c.feature_definition],sw.feature_definition,cc,evidence,{source:"feature_definition",field:"feature_definition",observed_value:c.feature_definition});
  const eyes=features.eyes||{}; used+=addMapping(totals,cfg.mapping.iris_contrast?.[eyes.iris_contrast],sw.iris_contrast,clamp(eyes.confidence),evidence,{source:"iris_contrast",field:"iris_contrast",observed_value:eyes.iris_contrast});
  const overall=features.overall_impression||{}; used+=addMapping(totals,cfg.mapping.overall_contrast?.[overall.dominant_contrast],sw.overall_impression,clamp(overall.confidence),evidence,{source:"overall_impression",field:"dominant_contrast",observed_value:overall.dominant_contrast});
  const scores=normalizedScores(totals,used), ordered=Object.entries(scores).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])); let classification="uncertain";
  if(used>=cfg.global_rules.minimum_total_evidence_weight) classification=(ordered[0][1]-ordered[1][1]>=5)?ordered[0][0]:"uncertain";
  return {classification,confidence:round(Math.min(1,used/Object.values(sw).reduce((a,b)=>a+b,0))*qualityMultiplier(quality.overall_quality),3),scores,evidence,conflicts:[]};
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

function baseScore(config, profile, dims) {
  const weights = getDimensionWeights(config);
  const minConf = Number(
    config.scoring_algorithm?.minimum_dimension_confidence ??
    config.season_scoring?.dimension_confidence?.minimum_for_use ??
    0.4
  );
  const minAvailableWeight = Number(
    config.scoring_algorithm?.minimum_available_dimension_weight ?? 0
  );

  let numerator = 0;
  let denominator = 0;
  let availableWeight = 0;
  const breakdown = {};

  for (const [dimension, rawWeight] of Object.entries(weights)) {
    const weight = Number(rawWeight || 0);
    const result = dims[dimension] || {};
    const confidence = Number(result.confidence || 0);
    const observed = resolveDimensionClassification(result);
    const match = matchValue(config, dimension, observed, profile);

    const usable = weight > 0 && confidence >= minConf && match !== null;
    breakdown[dimension] = {
      observed,
      confidence: round(confidence, 3),
      weight: round(weight, 3),
      match_value: match,
      usable
    };

    if (!usable) continue;

    numerator += weight * match * confidence;
    denominator += weight * confidence;
    availableWeight += weight;
  }

  const score = denominator > 0 && availableWeight >= minAvailableWeight
    ? round(100 * numerator / denominator, 1)
    : 0;

  return {
    score,
    available_weight: round(availableWeight, 3),
    weighted_denominator: round(denominator, 4),
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
  if(ranking.length<2)return{triggered:false,unresolved:false,winner:null}; const [a,b]=ranking, gap=Math.abs(a.score_after_modifiers-b.score_after_modifiers); if(gap>config.confusion_resolution.trigger.top_two_score_gap_max)return{triggered:false,unresolved:false,winner:null};
  let pairId=null,rule=null; for(const [k,r] of Object.entries(config.confusion_resolution.rules||{})) if(new Set([r.candidate_a,r.candidate_b]).size===new Set([a.season_id,b.season_id]).size&&[r.candidate_a,r.candidate_b].includes(a.season_id)&&[r.candidate_a,r.candidate_b].includes(b.season_id)){pairId=k;rule=r;break;}
  if(!rule)return{triggered:true,pair_id:null,winner:a.season_id,decision_margin:0,unresolved:true,applied_evidence:[]}; const points={[rule.candidate_a]:0,[rule.candidate_b]:0}, evidence=[];
  for(const [side,candidate] of [["evidence_for_a",rule.candidate_a],["evidence_for_b",rule.candidate_b]]) for(const item of rule[side]||[]) if(conditionMatches(item.condition,dims,features)){points[candidate]+=Number(item.points);evidence.push({candidate,...item});}
  const margin=Math.abs(points[rule.candidate_a]-points[rule.candidate_b]), min=config.confusion_resolution.generic_neighbor_rule.minimum_decision_margin; if(margin<min)return{triggered:true,pair_id:pairId,winner:a.season_id,decision_margin:margin,unresolved:true,applied_evidence:evidence};
  const winner=points[rule.candidate_a]>points[rule.candidate_b]?rule.candidate_a:rule.candidate_b; return{triggered:true,pair_id:pairId,winner,decision_margin:margin,unresolved:false,applied_evidence:evidence};
}
function finalConfidence(config,dims,ranking,quality,confusion) {
  const confs=Object.values(dims).filter(x=>!isUnknown(x.classification)).map(x=>Number(x.confidence||0)); const dim=confs.length?confs.reduce((a,b)=>a+b,0)/confs.length:0; const gap=ranking.length>1?Math.max(0,ranking[0].score_after_modifiers-ranking[1].score_after_modifiers):0;
  const gapComp=gap>=12?1:gap>=8?.75:gap>=5?.55:gap>=3?.4:.2; const q=(config.confidence_engine?.quality_values||{good:1,acceptable:.75,poor:0})[quality]??0; let score=.55*dim+.25*gapComp+.20*q;
  if(confusion.triggered&&confusion.unresolved)score-=.12; else if(confusion.triggered)score-=.03; const unknown=Object.values(dims).filter(x=>isUnknown(x.classification)).length; if(unknown===1)score-=.05; else if(unknown>=2)score-=.15; score=clamp(score);
  const level=score>=.8?"high":score>=.6?"medium":score>=.4?"low":"insufficient"; return{score:round(score,3),level};
}
function runScoring(config,dims,quality,features) {
  const profiles = config.season_scoring.season_profiles;
  const baseDetails = Object.fromEntries(
    Object.entries(profiles).map(([season, profile]) => [season, baseScore(config, profile, dims)])
  );
  const base = Object.fromEntries(
    Object.entries(baseDetails).map(([season, detail]) => [season, detail.score])
  );
  const cross = applyCrossRules(config, base, dims);
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
      available_dimension_weight: baseDetails[season].available_weight,
      applied_rules: [...cross.applied[season], ...excl.applied[season]]
    }))
    .sort((a,b) => b.score_after_modifiers - a.score_after_modifiers || a.season_id.localeCompare(b.season_id));
  const confusion=resolveConfusion(config,ranking,dims,features); if(confusion.triggered&&!confusion.unresolved&&confusion.winner){const i=ranking.findIndex(x=>x.season_id===confusion.winner); if(i>0)[ranking[0],ranking[i]]=[ranking[i],ranking[0]];}
  ranking.forEach((x,i)=>x.rank=i+1); const conf=finalConfidence(config,dims,ranking,quality,confusion); const best=ranking[0]; const insufficient=!best||best.score_after_modifiers<40||conf.level==="insufficient"||ranking.every(x=>x.hard_excluded);
  return{season_ranking:ranking,confusion_resolution:confusion,result:{best_match:insufficient?null:ranking[0].season_id,second_match:insufficient?null:ranking[1]?.season_id||null,third_match:insufficient?null:ranking[2]?.season_id||null,confidence:conf.score,confidence_percent:Math.round(conf.score*100),confidence_level:conf.level,request_better_photo:insufficient||quality==="poor"}};
}

const {config,files}=await loadConfig();
assert(config.engine&&config.temperature_engine&&config.value_engine&&config.chroma_engine&&config.contrast_engine&&config.season_scoring,"configuration incomplete");
const adapted=adaptExtractor(extractor);
if(!adapted.quality.continue_analysis){return{ok:true,stage:"completed",runtime_version:ENGINE_RUNTIME_VERSION,engine_version:config.engine.version,quality:adapted.quality,dimension_results:{},season_ranking:[],result:{best_match:null,second_match:null,third_match:null,confidence:0,confidence_percent:0,confidence_level:"insufficient",request_better_photo:true}};}
const dims={temperature:calculateTemperature(config,adapted.features,adapted.quality),value:calculateValue(config,adapted.features,adapted.quality),chroma:calculateChroma(config,adapted.features,adapted.quality),contrast:calculateContrast(config,adapted.features,adapted.quality)};
const decision=runScoring(config,dims,adapted.quality.overall_quality,adapted.features);
return {
  ok: true,
  stage: "completed",
  runtime_version: ENGINE_RUNTIME_VERSION,
  engine: { name: config.engine.name, version: config.engine.version, status: config.engine.status },
  extractor: { version: extractor.extractor_version, status: extractor.analysis_status, global_reliability: extractor.global_reliability },
  quality: adapted.quality,
  observed_colors: extractor.observed_colors,
  dimension_results: dims,
  scoring_diagnostics: {
    resolved_dimensions: Object.fromEntries(
      Object.entries(dims).map(([name, result]) => [name, {
        original_classification: result.classification,
        scoring_classification: resolveDimensionClassification(result),
        confidence: result.confidence
      }])
    ),
    dimension_weights: getDimensionWeights(config),
    minimum_dimension_confidence: config.scoring_algorithm?.minimum_dimension_confidence ?? 0.4
  },
  ...decision,
  loaded_files: files
};
