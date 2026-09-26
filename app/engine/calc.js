// Room-by-room heat loss calculation (SPEC 5). Steady state, EN 12831:2003 style.
// Input: a normalized calculation model (see docs in buildCalcModel, app/state/calcmodel.js).
// Pure function, no DOM.
import { AIR, GROUND, SURFACE_RESISTANCES, n50ForAgeCategory, shieldingCoefficient, heightCorrection } from './constants.js';

// W/K per (l/s) of air flow: 0.34 Wh/(m³K) · 3600 s/h / 1000 l/m³ = 1.224 W/(K·l/s)
export const W_PER_K_PER_LS = (AIR.rhoCp_Wh_per_m3K * 3600) / 1000;

export const EXTRACT_ROOM_TYPES = new Set(['kitchen', 'bathroom', 'wc']);

export function resolveN50(config) {
  if (config.n50Override != null) return config.n50Override;
  return n50ForAgeCategory(config.ageCategory) ?? 0;
}

// Infiltration air change rate for a room (EN 12831:2003 method, SPEC 5.1).
export function infiltrationAch(room, config) {
  if (room.infiltrationAchOverride != null) return { ach: room.infiltrationAchOverride, overridden: true };
  const n50 = resolveN50(config);
  const e = shieldingCoefficient(config.shieldingClass, room.exteriorWallsWithOpenings || 0);
  const eps = heightCorrection(room.heightAboveGroundM || 0);
  return { ach: 2 * n50 * e * eps, n50, e, eps, overridden: false };
}

// Supply air temperature and ventilation rule for a room (SPEC 5.1).
export function ventilationTerms(room, config, roomTemp) {
  const system = config.ventilationSystem || 'ftx';
  const flowLs = room.ventilationLs ?? (config.baseVentilationLsPerM2 * (room.areaM2 || 0));
  let supply;
  let rule;
  if (room.supplyTempOverride != null) {
    supply = room.supplyTempOverride;
    rule = 'override';
  } else if (system === 'ftx') {
    if (EXTRACT_ROOM_TYPES.has(room.roomType)) {
      supply = roomTemp;
      rule = 'ftx-extract-room';
    } else {
      supply = config.supplyAirTemp;
      rule = 'ftx-supply';
    }
  } else {
    if ((room.exteriorWallCount || 0) === 0) {
      supply = roomTemp;
      rule = 'no-exterior-walls';
    } else {
      supply = config.outdoorTemp;
      rule = 'outdoor';
    }
  }
  return { system, flowLs, supply, rule };
}

// Combined ventilation + infiltration conductances (W/K) for a room, per SPEC 5.1.
// Returns { ventilation: {flowLs, supply, G}, infiltration: {ach, flowLs, G}, combination }
export function airTerms(room, config, roomTemp) {
  const vent = ventilationTerms(room, config, roomTemp);
  const inf = infiltrationAch(room, config);
  const infFlowLs = ((room.volumeM3 || 0) * inf.ach * 1000) / 3600;
  if (vent.system === 'ftx') {
    return {
      ventilation: { ...vent, G: vent.flowLs * W_PER_K_PER_LS, tOther: vent.supply },
      infiltration: { ...inf, flowLs: infFlowLs, G: infFlowLs * W_PER_K_PER_LS, tOther: config.outdoorTemp },
      combination: 'sum',
    };
  }
  // Exhaust or natural: the larger of the two flows, against outdoor temperature.
  const noExterior = (room.exteriorWallCount || 0) === 0;
  if (noExterior) {
    return {
      ventilation: { ...vent, G: 0, tOther: roomTemp, note: 'no exterior walls' },
      infiltration: { ...inf, flowLs: 0, G: 0, tOther: config.outdoorTemp, note: 'e = 0' },
      combination: 'larger-of',
    };
  }
  const larger = Math.max(vent.flowLs, infFlowLs);
  const useInf = infFlowLs >= vent.flowLs;
  return {
    ventilation: { ...vent, G: useInf ? 0 : larger * W_PER_K_PER_LS, tOther: config.outdoorTemp, governs: !useInf },
    infiltration: { ...inf, flowLs: infFlowLs, G: useInf ? larger * W_PER_K_PER_LS : 0, tOther: config.outdoorTemp, governs: useInf },
    combination: 'larger-of',
  };
}

function otherSideOf(surface, roomId) {
  if (surface.roomA === roomId) return surface.roomB != null ? { room: surface.roomB } : surface.other;
  return surface.roomA != null ? { room: surface.roomA } : surface.other;
}

function otherTemp(side, temps, config) {
  if (!side) return config.outdoorTemp;
  if (side.room != null) return temps[side.room];
  switch (side.type) {
    case 'outside':
      return config.outdoorTemp;
    case 'soil':
      return config.soilWallTemp;
    case 'slab_band':
      return config.slabBandTemp;
    case 'slab_inner':
      return config.slabInnerTemp;
    case 'outside_space':
      return side.temp ?? config.indoorSetpoint;
    default:
      return side.temp ?? config.outdoorTemp;
  }
}

// Solve a dense linear system A x = b by Gaussian elimination with partial pivoting.
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) continue;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

// Solve the temperatures of unheated rooms (SPEC 5.2): U·A-weighted average of the
// surrounding temperatures, with the room's own infiltration and ventilation as paths
// to outdoor / supply air. One linear system for all unheated rooms, solved once.
export function solveUnheated(model, heatedTemps) {
  const config = model.config;
  const unheated = model.rooms.filter((r) => !r.heated);
  const idx = new Map(unheated.map((r, i) => [r.id, i]));
  const n = unheated.length;
  const temps = { ...heatedTemps };
  if (n === 0) return { temps, iterations: 0 };
  const tb = 1 + (config.thermalBridgePct || 0) / 100;
  // Iterate a few times because the air terms of exhaust systems depend on the room temperature only
  // through T_supply = room temperature (no-exterior case), which cancels; one solve is exact otherwise.
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (const room of unheated) {
    const i = idx.get(room.id);
    for (const s of model.surfaces) {
      if (s.roomA !== room.id && s.roomB !== room.id) continue;
      const UA = (s.U || 0) * (s.areaM2 || 0) * (s.envelope ? tb : 1);
      if (UA === 0) continue;
      const side = otherSideOf(s, room.id);
      A[i][i] += UA;
      if (side && side.room != null && idx.has(side.room)) {
        A[i][idx.get(side.room)] -= UA;
      } else {
        b[i] += UA * otherTemp(side, temps, config);
      }
    }
    // Air paths: ventilation (to supply temp per rules) and infiltration (to outdoor).
    const air = airTerms(room, config, null);
    if (air.ventilation.G > 0) {
      if (air.ventilation.rule === 'ftx-extract-room' || air.ventilation.rule === 'no-exterior-walls') {
        // supply = room temperature: no net path
      } else {
        A[i][i] += air.ventilation.G;
        b[i] += air.ventilation.G * air.ventilation.tOther;
      }
    }
    if (air.infiltration.G > 0) {
      A[i][i] += air.infiltration.G;
      b[i] += air.infiltration.G * air.infiltration.tOther;
    }
    if (A[i][i] === 0) {
      // Isolated room: no surfaces at all; keep at outdoor temperature.
      A[i][i] = 1;
      b[i] = config.outdoorTemp;
    }
  }
  const x = solveLinear(A, b);
  unheated.forEach((r, i) => (temps[r.id] = x[i]));
  return { temps, system: { A, b, ids: unheated.map((r) => r.id) } };
}

// Main entry point. Returns per-room, per-level and building results plus the slab check.
export function calculate(model) {
  const config = model.config;
  const tb = (config.thermalBridgePct || 0) / 100;
  const heatedTemps = {};
  for (const r of model.rooms) if (r.heated) heatedTemps[r.id] = r.setpoint ?? config.indoorSetpoint;
  const { temps } = solveUnheated(model, heatedTemps);

  const rooms = {};
  const levels = {};
  let building = 0;
  for (const room of model.rooms) {
    const tRoom = temps[room.id];
    const rows = [];
    let transmission = 0;
    let surcharge = 0;
    for (const s of model.surfaces) {
      if (s.roomA !== room.id && s.roomB !== room.id) continue;
      const side = otherSideOf(s, room.id);
      const tOther = otherTemp(side, temps, config);
      const dT = tRoom - tOther;
      const base = (s.U || 0) * (s.areaM2 || 0) * dT;
      const extra = s.envelope ? base * tb : 0;
      transmission += base;
      surcharge += extra;
      rows.push({
        kind: 'transmission',
        surfaceId: s.id,
        surfaceKind: s.kind,
        label: s.label,
        otherSide: side,
        tOther,
        areaM2: s.areaM2,
        U: s.U,
        dT,
        watts: base,
        surchargeWatts: extra,
        envelope: !!s.envelope,
        refs: s.refs || null,
      });
    }
    const air = airTerms(room, config, tRoom);
    const ventW = air.ventilation.G * (tRoom - air.ventilation.tOther);
    const infW = air.infiltration.G * (tRoom - air.infiltration.tOther);
    rows.push({ kind: 'ventilation', label: 'ventilation', flowLs: air.ventilation.flowLs, tOther: air.ventilation.tOther, dT: tRoom - air.ventilation.tOther, watts: ventW, rule: air.ventilation.rule, combination: air.combination, governs: air.ventilation.governs });
    rows.push({ kind: 'infiltration', label: 'infiltration', ach: air.infiltration.ach, flowLs: air.infiltration.flowLs, tOther: air.infiltration.tOther, dT: tRoom - air.infiltration.tOther, watts: infW, n50: air.infiltration.n50, e: air.infiltration.e, eps: air.infiltration.eps, overridden: air.infiltration.overridden, combination: air.combination, governs: air.infiltration.governs });
    rows.push({ kind: 'surcharge', label: 'thermal bridge surcharge', pct: config.thermalBridgePct, watts: surcharge });
    const total = room.heated ? transmission + surcharge + ventW + infW : 0;
    rooms[room.id] = {
      id: room.id,
      level: room.level,
      heated: room.heated,
      temp: tRoom,
      transmission,
      surcharge,
      ventilation: ventW,
      infiltration: infW,
      total,
      rows,
    };
    if (room.heated) {
      levels[room.level] = (levels[room.level] || 0) + total;
      building += total;
    }
  }
  const slabCheck = model.slabCheck ? isoSlabTotal(model.slabCheck, config, rooms, model) : null;
  return { rooms, levels, building, temps, slabCheck };
}

// EN ISO 13370 building-level slab-on-ground total (SPEC 3.5, 5.3), shown next to the summed
// per-room slab loss. No automatic adjustment.
export function isoSlabTotal(slab, config, roomResults, model) {
  const lambda = slab.lambda ?? config.soilConductivity ?? GROUND.defaultConductivity;
  const A = slab.footprintAreaM2;
  const P = slab.perimeterM;
  if (!A || !P) return null;
  const Bp = A / (0.5 * P);
  const rsi = SURFACE_RESISTANCES.down.rsi;
  const rse = SURFACE_RESISTANCES.down.rse;
  const dt = (slab.wallThicknessM || 0) + lambda * (rsi + (slab.slabRf || 0) + rse);
  let U0;
  let formula;
  if (dt < Bp) {
    U0 = ((2 * lambda) / (Math.PI * Bp + dt)) * Math.log((Math.PI * Bp) / dt + 1);
    formula = "U0 = 2λ/(πB' + dt) · ln(πB'/dt + 1)";
  } else {
    U0 = lambda / (0.457 * Bp + dt);
    formula = "U0 = λ/(0.457B' + dt)";
  }
  const tIn = config.indoorSetpoint;
  const dT = tIn - config.outdoorTemp;
  const isoWatts = U0 * A * dT;
  let perRoomSlabWatts = 0;
  for (const r of Object.values(roomResults)) {
    if (!r.heated) continue;
    for (const row of r.rows) if (row.surfaceKind === 'slab_band' || row.surfaceKind === 'slab_inner') perRoomSlabWatts += row.watts + row.surchargeWatts;
  }
  return {
    A,
    P,
    Bp,
    dt,
    lambda,
    U0,
    formula,
    dT,
    isoWatts,
    perRoomSlabWatts,
    source: GROUND.formulaSource,
    verified: GROUND.formulaVerified,
    note: 'ISO total evaluated with ΔT = default indoor setpoint − outdoor design temperature (interim choice, see open questions)',
  };
}
