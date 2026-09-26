// Physical constants and standard tables used by the calculation engine.
// Every value carries its source (SPEC section 0). Values that could not be
// checked against the standard text itself are marked verified: false.
// Sources marked "search excerpt" were read from web search result excerpts
// only (the source pages could not be opened from the build environment).

export const AIR = {
  // Product of air density and specific heat capacity used by EN 12831:2003
  // for ventilation and infiltration heat loss: 0.34 Wh/(m³·K) = 1224 J/(m³·K).
  rhoCp_Wh_per_m3K: 0.34,
  rhoCp_J_per_m3K: 0.34 * 3600,
  source:
    'EN 12831:2003 (ventilation heat loss coefficient H_V = 0.34 · V̇), as quoted in ' +
    'search excerpts from idm-energie.at (Heat loss calculation: EN 12831 guide), ' +
    'h2xengineering.com (BS EN 12831-1:2017 blog) and squote.app (room heat loss calculator)',
  verified: false,
};

export const SURFACE_RESISTANCES = {
  // EN ISO 6946:2017 Table 7 (as reproduced by open sources, see data/materialbibliotek-TEMP.md §2a).
  // m²·K/W. Direction of heat flow: 'up' (roof/ceiling), 'horizontal' (walls, windows), 'down' (floors).
  up: { rsi: 0.1, rse: 0.04 },
  horizontal: { rsi: 0.13, rse: 0.04 },
  down: { rsi: 0.17, rse: 0.04 },
  source:
    'EN ISO 6946 surface resistances as reproduced by u-value.com (How to calculate U-values) and ' +
    'ISOVER U-värdesberäknaren user manual (isover.se); see data/materialbibliotek-TEMP.md section 2a',
  verified: false,
};

export const GROUND = {
  // EN ISO 13370 Table 1: thermal conductivity of the ground, W/(m·K).
  // Default when the ground is unknown: 2.0 (sand/gravel).
  conductivity: { claySilt: 1.5, sandGravel: 2.0, rock: 3.5 },
  defaultConductivity: 2.0,
  source:
    'ISO 13370:2007 Table 1 (clay/silt 1.5, sand/gravel 2.0, homogeneous rock 3.5; use 2.0 when unknown), ' +
    'as quoted in search excerpts of the ISO 13370:2007 sample pages (cdn.standards.iteh.ai) and scribd.com/document/203413576',
  verified: false,
  // Slab-on-ground method (ISO 13370:2007 clause 9.1, "characteristic dimension" B' = A/(0.5 P);
  // total equivalent thickness d_t = w + λ (R_si + R_f + R_se); U_0 for d_t < B' and d_t >= B').
  // The two U_0 formulas are written from memory of the standard and could not be checked
  // against the text: marked unverified (SPEC 0).
  formulaSource:
    "ISO 13370:2007 clause 9.1: B' = A/(0.5·P) and d_t = w + λ(R_si + R_f + R_se) quoted in search excerpts " +
    "(scribd.com/document/203413576, htflux.com documentation); U_0 = 2λ/(π·B' + d_t)·ln(π·B'/d_t + 1) for d_t < B' and " +
    "U_0 = λ/(0.457·B' + d_t) for d_t ≥ B' from memory of the standard, unverified",
  formulaVerified: false,
};

// EN 12831:2003 infiltration: V_inf = 2 · V · n50 · e · ε (Annex D.5).
// Table values below are the starting values stated in SPEC 5.1 / 3.14; they are to be
// verified against EN 12831:2003 Annex D (SPEC 9.6).
export const INFILTRATION = {
  formula: 'ach_inf = 2 · n50 · e · ε (EN 12831:2003, Annex D.5, as stated in SPEC 5.1)',
  // Shielding coefficient e: by number of exterior walls of the room that contain openings.
  shielding: {
    none: { zero: 0, one: 0.03, more: 0.05 },
    moderate: { zero: 0, one: 0.02, more: 0.03 },
    heavy: { zero: 0, one: 0.01, more: 0.02 },
  },
  // Height correction ε by height of the room above ground level.
  heightCorrection: [
    { maxHeightM: 10, epsilon: 1.0 },
    { maxHeightM: 30, epsilon: 1.2 },
    { maxHeightM: Infinity, epsilon: 1.5 },
  ],
  source: 'SPEC 5.1 (starting values; to be verified against EN 12831:2003 Annex D, SPEC 9.6)',
  verified: false,
};

// Age categories with default n50 (SPEC 3.14). Starting values, engineering estimates.
export const AGE_CATEGORIES = [
  { id: 'pre1941', label: { sv: 'före 1941', en: 'before 1941' }, n50: 4.0 },
  { id: '1941-1960', label: { sv: '1941–1960', en: '1941–1960' }, n50: 3.0 },
  { id: '1961-1975', label: { sv: '1961–1975', en: '1961–1975' }, n50: 2.0 },
  { id: '1976-1990', label: { sv: '1976–1990', en: '1976–1990' }, n50: 1.5 },
  { id: '1991-2005', label: { sv: '1991–2005', en: '1991–2005' }, n50: 1.2 },
  { id: '2006plus', label: { sv: '2006 och senare', en: '2006 and later' }, n50: 0.8 },
];
export const AGE_CATEGORY_SOURCE =
  'SPEC 3.14: user starting values (engineering estimates bounded by Swedish/Nordic measurements and code requirements), to be verified against EN 12831:2003 Table D.5 and SBN 1980 section 33:3 (SPEC 9.6)';

export function n50ForAgeCategory(id) {
  const c = AGE_CATEGORIES.find((a) => a.id === id);
  return c ? c.n50 : null;
}

export function shieldingCoefficient(shieldingClass, exteriorWallsWithOpenings) {
  const row = INFILTRATION.shielding[shieldingClass] || INFILTRATION.shielding.moderate;
  if (exteriorWallsWithOpenings <= 0) return row.zero;
  if (exteriorWallsWithOpenings === 1) return row.one;
  return row.more;
}

export function heightCorrection(heightAboveGroundM) {
  const h = Math.max(0, heightAboveGroundM || 0);
  for (const row of INFILTRATION.heightCorrection) if (h <= row.maxHeightM) return row.epsilon;
  return 1.5;
}

// Default project configuration (SPEC 3.14). Starting values are marked in SPEC.
export const DEFAULT_CONFIG = {
  ageCategory: 'pre1941',
  n50Override: null,
  shieldingClass: 'moderate',
  fakeFloorU: 100,
  sliverWidthMm: 150,
  sliverAreaM2: 0.1,
  baseVentilationLsPerM2: 0.35,
  outdoorTemp: -16,
  indoorSetpoint: 21,
  soilWallTemp: 8,
  slabBandTemp: 5,
  slabInnerTemp: 12,
  slabBandWidthM: 3,
  soilConductivity: GROUND.defaultConductivity,
  ventilationSystem: 'ftx',
  supplyAirTemp: 18,
  thermalBridgePct: 15,
  snapToleranceOverrideMm: null,
  doorHeightMinM: 2.0,
  doorHeightMaxM: 2.2,
  scaleNoCorrectionPct: 1,
  scaleAgreementPct: 2,
  wallTypeBandMm: 15,
  openingBandMm: 50,
  ai: {
    models: {
      read: 'claude-opus-5',
      combined: 'claude-opus-5',
      fullFloorReread: 'claude-opus-5',
      regional: 'claude-haiku-4-5',
      annotation: 'claude-haiku-4-5',
      command: 'claude-opus-5',
    },
    targetMmPerPx: 8,
    tileOverlapM: 2,
    tileMaxLongEdgePx: 2576,
    tileMaxMegapixels: 4784 * 28 * 28 / 1e6, // visual-token limit of current Opus models (Anthropic vision docs, 2026-09)
    manualMode: false,
  },
};
