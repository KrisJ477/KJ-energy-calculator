// U-value calculation from construction layers (EN ISO 6946 layer method, SPEC 3.8).
// A construction is { id, name, layers: [{ materialId, thicknessMm } | { resistance, label }], uValueDirect?: number }.
// Materials are { id, name, lambda, source, verified }.
import { SURFACE_RESISTANCES } from './constants.js';

export function surfaceResistances(direction, options = {}) {
  const base = SURFACE_RESISTANCES[direction] || SURFACE_RESISTANCES.horizontal;
  return {
    rsi: options.rsi ?? base.rsi,
    rse: options.rse ?? base.rse,
  };
}

// Returns the full traceability chain for a construction: layers with lambda and R,
// surface resistances, total resistance and U. direction: 'up' | 'horizontal' | 'down'.
// options.rse may be set to 0 for surfaces to ground (practice noted in data/materialbibliotek-TEMP.md §2a).
export function constructionU(construction, materialsById, direction = 'horizontal', options = {}) {
  if (!construction) return { U: null, error: 'missing construction' };
  if (construction.uValueDirect != null) {
    return {
      U: construction.uValueDirect,
      direct: true,
      chain: [{ label: construction.name, U: construction.uValueDirect, source: construction.source || 'entered directly' }],
      rLayers: null,
    };
  }
  const { rsi, rse } = surfaceResistances(direction, options);
  const layers = [];
  let rLayers = 0;
  let error = null;
  for (const layer of construction.layers || []) {
    if (layer.resistance != null) {
      layers.push({ label: layer.label || 'R', R: layer.resistance, thicknessMm: layer.thicknessMm ?? null, lambda: null });
      rLayers += layer.resistance;
      continue;
    }
    const m = materialsById[layer.materialId];
    if (!m) {
      error = `unknown material ${layer.materialId}`;
      layers.push({ label: layer.materialId, R: 0, thicknessMm: layer.thicknessMm, lambda: null, error });
      continue;
    }
    const d = (layer.thicknessMm || 0) / 1000;
    const R = m.lambda > 0 ? d / m.lambda : 0;
    layers.push({ label: m.name, materialId: m.id, thicknessMm: layer.thicknessMm, lambda: m.lambda, R, source: m.source, verified: m.verified });
    rLayers += R;
  }
  const rTotal = rsi + rLayers + rse;
  return {
    U: rTotal > 0 ? 1 / rTotal : null,
    direct: false,
    rsi,
    rse,
    rLayers,
    rTotal,
    layers,
    error,
  };
}

// Resolve U for a type (wall/floor/roof/slab/opening type) through its construction.
export function typeU(type, constructionsById, materialsById, direction, options) {
  if (!type) return { U: null, error: 'missing type' };
  const c = constructionsById[type.constructionId];
  const r = constructionU(c, materialsById, direction, options);
  return { ...r, typeId: type.id, typeName: type.name, constructionId: type.constructionId, constructionName: c ? c.name : null };
}
