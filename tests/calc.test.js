import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, airTerms, infiltrationAch, solveLinear, W_PER_K_PER_LS, isoSlabTotal } from '../app/engine/calc.js';
import { DEFAULT_CONFIG } from '../app/engine/constants.js';
import { constructionU } from '../app/engine/uvalue.js';

const cfg = (o = {}) => ({ ...DEFAULT_CONFIG, outdoorTemp: -16, indoorSetpoint: 21, ...o });

function room(id, o = {}) {
  return { id, level: 1, areaM2: 20, heightM: 3, volumeM3: 60, heated: true, setpoint: 21, roomType: 'living', exteriorWallCount: 1, exteriorWallsWithOpenings: 1, heightAboveGroundM: 0, ...o };
}

test('air constant: 0.34 Wh/m3K gives 1.224 W/K per l/s', () => {
  assert.ok(Math.abs(W_PER_K_PER_LS - 1.224) < 1e-9);
});

test('U-value from layers uses ISO 6946 surface resistances', () => {
  const mats = { brick: { id: 'brick', name: 'Tegel', lambda: 0.6 }, render: { id: 'render', name: 'Puts', lambda: 1.0 } };
  const c = { id: 'c1', name: 'test', layers: [{ materialId: 'render', thicknessMm: 15 }, { materialId: 'brick', thicknessMm: 250 }, { materialId: 'render', thicknessMm: 15 }] };
  const r = constructionU(c, mats, 'horizontal');
  const expectedR = 0.13 + 0.015 + 0.25 / 0.6 + 0.015 + 0.04;
  assert.ok(Math.abs(r.rTotal - expectedR) < 1e-9);
  assert.ok(Math.abs(r.U - 1 / expectedR) < 1e-9);
  assert.equal(r.layers.length, 3);
  const d = constructionU({ id: 'w', name: 'window', uValueDirect: 2.8 }, mats);
  assert.equal(d.U, 2.8);
});

test('transmission through an exterior wall with surcharge', () => {
  const model = {
    config: cfg({ thermalBridgePct: 15, ventilationSystem: 'ftx', supplyAirTemp: 18 }),
    rooms: [room('1-1', { ventilationLs: 0, infiltrationAchOverride: 0 })],
    surfaces: [{ id: 's1', kind: 'wall', roomA: '1-1', other: { type: 'outside' }, areaM2: 10, U: 1.0, envelope: true }],
  };
  const res = calculate(model);
  const r = res.rooms['1-1'];
  assert.ok(Math.abs(r.transmission - 10 * 37) < 1e-9);
  assert.ok(Math.abs(r.surcharge - 10 * 37 * 0.15) < 1e-9);
  assert.ok(Math.abs(r.total - 370 * 1.15) < 1e-9);
  assert.ok(Math.abs(res.building - r.total) < 1e-9);
});

test('interior wall between two rooms gets no surcharge', () => {
  const model = {
    config: cfg({ thermalBridgePct: 15 }),
    rooms: [room('1-1', { ventilationLs: 0, infiltrationAchOverride: 0 }), room('1-2', { setpoint: 18, ventilationLs: 0, infiltrationAchOverride: 0 })],
    surfaces: [{ id: 's1', kind: 'wall', roomA: '1-1', roomB: '1-2', areaM2: 10, U: 2.0, envelope: false }],
  };
  const res = calculate(model);
  assert.ok(Math.abs(res.rooms['1-1'].total - 10 * 2 * 3) < 1e-9);
  assert.ok(Math.abs(res.rooms['1-2'].total + 60) < 1e-9, 'colder room gets an equal negative contribution');
  assert.ok(Math.abs(res.building) < 1e-9, 'flows between heated rooms cancel at building level');
});

test('FTX ventilation: supply temperature, extract rooms get no ventilation loss, infiltration added', () => {
  const c = cfg({ ventilationSystem: 'ftx', supplyAirTemp: 18, ageCategory: 'pre1941', shieldingClass: 'moderate' });
  const living = room('1-1');
  const kitchen = room('1-2', { roomType: 'kitchen' });
  const a = airTerms(living, c, 21);
  assert.equal(a.combination, 'sum');
  assert.ok(Math.abs(a.ventilation.flowLs - 7) < 1e-9, '0.35 l/s per m2 × 20 m2');
  assert.equal(a.ventilation.supply, 18);
  const inf = infiltrationAch(living, c);
  assert.ok(Math.abs(inf.ach - 2 * 4.0 * 0.02 * 1.0) < 1e-12);
  assert.ok(Math.abs(a.infiltration.flowLs - (60 * inf.ach * 1000) / 3600) < 1e-9);
  const k = airTerms(kitchen, c, 21);
  assert.equal(k.ventilation.supply, 21);
  assert.equal(k.ventilation.rule, 'ftx-extract-room');
});

test('exhaust ventilation: larger of infiltration and ventilation against outdoor; interior rooms zero', () => {
  const c = cfg({ ventilationSystem: 'exhaust', ageCategory: 'pre1941' });
  const r = room('1-1');
  const a = airTerms(r, c, 21);
  assert.equal(a.combination, 'larger-of');
  const infFlow = (60 * 2 * 4.0 * 0.02 * 1.0 * 1000) / 3600; // 2.67 l/s
  assert.ok(a.ventilation.governs, 'ventilation 7 l/s > infiltration 2.67 l/s');
  assert.ok(Math.abs(a.ventilation.G - 7 * W_PER_K_PER_LS) < 1e-9);
  assert.equal(a.infiltration.G, 0);
  assert.equal(a.ventilation.tOther, -16);
  const inner = room('1-2', { exteriorWallCount: 0, exteriorWallsWithOpenings: 0 });
  const b = airTerms(inner, c, 21);
  assert.equal(b.ventilation.G, 0);
  assert.equal(b.infiltration.G, 0);
  assert.ok(infFlow > 0);
});

test('shielding and height correction table', () => {
  const c = cfg({ ageCategory: '1961-1975', shieldingClass: 'none' });
  assert.ok(Math.abs(infiltrationAch(room('a', { exteriorWallsWithOpenings: 0 }), c).ach) < 1e-12);
  assert.ok(Math.abs(infiltrationAch(room('a', { exteriorWallsWithOpenings: 2 }), c).ach - 2 * 2.0 * 0.05 * 1.0) < 1e-12);
  assert.ok(Math.abs(infiltrationAch(room('a', { exteriorWallsWithOpenings: 1, heightAboveGroundM: 12 }), c).ach - 2 * 2.0 * 0.03 * 1.2) < 1e-12);
  assert.ok(Math.abs(infiltrationAch(room('a', { exteriorWallsWithOpenings: 1, heightAboveGroundM: 31 }), c).ach - 2 * 2.0 * 0.03 * 1.5) < 1e-12);
  assert.equal(infiltrationAch(room('a', { infiltrationAchOverride: 0.5 }), c).ach, 0.5);
});

test('unheated room temperature is the UA-weighted average and chains through fake floors', () => {
  const c = cfg({ thermalBridgePct: 0 });
  const stair1 = room('1-9', { heated: false, ventilationLs: 0, infiltrationAchOverride: 0, roomType: 'stairwell' });
  const stair2 = room('2-9', { heated: false, ventilationLs: 0, infiltrationAchOverride: 0, roomType: 'stairwell', level: 2 });
  const flat = room('1-1', { ventilationLs: 0, infiltrationAchOverride: 0 });
  const model = {
    config: c,
    rooms: [flat, stair1, stair2],
    surfaces: [
      { id: 'w1', kind: 'wall', roomA: '1-1', roomB: '1-9', areaM2: 10, U: 1.0 },
      { id: 'w2', kind: 'wall', roomA: '1-9', other: { type: 'outside' }, areaM2: 10, U: 1.0, envelope: true },
      { id: 'f', kind: 'fake_floor', roomA: '1-9', roomB: '2-9', areaM2: 10, U: 100 },
      { id: 'w3', kind: 'wall', roomA: '2-9', other: { type: 'outside' }, areaM2: 10, U: 1.0, envelope: true },
    ],
  };
  const res = calculate(model);
  // Two stairwells strongly coupled: together they see 10 W/K to the flat (21) and 20 W/K to outside (-16)
  const expected = (10 * 21 + 20 * -16) / 30;
  assert.ok(Math.abs(res.temps['1-9'] - expected) < 0.1, `got ${res.temps['1-9']} expected ${expected}`);
  assert.ok(Math.abs(res.temps['2-9'] - expected) < 0.1);
  assert.equal(res.rooms['1-9'].total, 0, 'unheated rooms have no demand');
  assert.ok(Math.abs(res.building - 10 * (21 - res.temps['1-9'])) < 1e-6);
});

test('single unheated room with infiltration path to outdoor', () => {
  const c = cfg({ thermalBridgePct: 0, ventilationSystem: 'exhaust', ageCategory: 'pre1941' });
  const flat = room('1-1', { ventilationLs: 0, infiltrationAchOverride: 0 });
  const stair = room('1-9', { heated: false, ventilationLs: 0, infiltrationAchOverride: 1.0, volumeM3: 36 });
  const model = {
    config: c,
    rooms: [flat, stair],
    surfaces: [{ id: 'w1', kind: 'wall', roomA: '1-1', roomB: '1-9', areaM2: 10, U: 1.0 }],
  };
  const res = calculate(model);
  const G = (36 * 1.0 * 1000) / 3600 * W_PER_K_PER_LS; // 10 l/s → 12.24 W/K
  const expected = (10 * 21 + G * -16) / (10 + G);
  assert.ok(Math.abs(res.temps['1-9'] - expected) < 1e-6);
});

test('solveLinear solves a 3x3 system', () => {
  const x = solveLinear([[2, 1, 0], [1, 3, 1], [0, 1, 4]], [3, 9, 21]);
  assert.ok(Math.abs(x[0] - 1) < 1e-9 && Math.abs(x[1] - 1) < 1e-9 && Math.abs(x[2] - 5) < 1e-9);
});

test('slab: band and inner zones with separate temperatures, plus ISO 13370 total', () => {
  const c = cfg({ thermalBridgePct: 0, slabBandTemp: 5, slabInnerTemp: 12 });
  const model = {
    config: c,
    rooms: [room('0-1', { ventilationLs: 0, infiltrationAchOverride: 0 })],
    surfaces: [
      { id: 'b', kind: 'slab_band', roomA: '0-1', other: { type: 'slab_band' }, areaM2: 12, U: 0.5, envelope: true },
      { id: 'i', kind: 'slab_inner', roomA: '0-1', other: { type: 'slab_inner' }, areaM2: 8, U: 0.5, envelope: true },
    ],
    slabCheck: { footprintAreaM2: 100, perimeterM: 40, wallThicknessM: 0.4, slabRf: 1.0, lambda: 2.0 },
  };
  const res = calculate(model);
  assert.ok(Math.abs(res.rooms['0-1'].total - (12 * 0.5 * 16 + 8 * 0.5 * 9)) < 1e-9);
  const s = res.slabCheck;
  assert.ok(Math.abs(s.Bp - 5) < 1e-9);
  const dt = 0.4 + 2.0 * (0.17 + 1.0 + 0.04);
  assert.ok(Math.abs(s.dt - dt) < 1e-9);
  assert.ok(dt < 5);
  const U0 = ((2 * 2.0) / (Math.PI * 5 + dt)) * Math.log((Math.PI * 5) / dt + 1);
  assert.ok(Math.abs(s.U0 - U0) < 1e-9);
  assert.ok(Math.abs(s.isoWatts - U0 * 100 * 37) < 1e-6);
  assert.ok(Math.abs(s.perRoomSlabWatts - res.rooms['0-1'].total) < 1e-9);
  const thick = isoSlabTotal({ footprintAreaM2: 10, perimeterM: 40, wallThicknessM: 0.4, slabRf: 5, lambda: 2.0 }, c, {}, null);
  assert.ok(thick.dt >= thick.Bp);
  assert.ok(Math.abs(thick.U0 - 2.0 / (0.457 * thick.Bp + thick.dt)) < 1e-12);
});

test('space outside the project: fixed temperature, envelope surcharge, not in totals', () => {
  const c = cfg({ thermalBridgePct: 10 });
  const model = {
    config: c,
    rooms: [room('13-1', { ventilationLs: 0, infiltrationAchOverride: 0 })],
    surfaces: [{ id: 'f', kind: 'floor', roomA: '13-1', other: { type: 'outside_space', temp: 0 }, areaM2: 20, U: 0.3, envelope: true }],
  };
  const res = calculate(model);
  assert.ok(Math.abs(res.rooms['13-1'].total - 20 * 0.3 * 21 * 1.1) < 1e-9);
  const def = calculate({ ...model, surfaces: [{ ...model.surfaces[0], other: { type: 'outside_space' } }] });
  assert.equal(def.rooms['13-1'].total, 0, 'default temperature is the project setpoint: zero loss');
});
