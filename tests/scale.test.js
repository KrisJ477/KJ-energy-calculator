import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleFromMeasurement, floorCorrection, similarityFromPairs, pickReferenceWalls, matchWall, coarseAlign, verticalSanity, proposeReferenceFloor, scaleStampCheck, referenceDeviation } from '../app/engine/scale.js';
import { applyTransform } from '../app/engine/geometry.js';

const W = (id, ax, ay, bx, by, extra = {}) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thicknessMm: 300, ...extra });

test('scale from a written dimension', () => {
  const s = scaleFromMeasurement({ pxA: { x: 100, y: 100 }, pxB: { x: 731.25, y: 100 }, realMm: 4050, source: 'dimension', label: 'dimension 4.05 m' });
  assert.ok(Math.abs(s.pxPerM - 155.86) < 0.01);
  assert.ok(Math.abs(s.mmPerPx - 6.416) < 0.001);
  assert.equal(s.method, 'dimension');
  assert.equal(scaleFromMeasurement({ pxA: { x: 0, y: 0 }, pxB: { x: 0, y: 0 }, realMm: 1000 }), null);
});

test('scale stamp is a sanity check only', () => {
  const c = scaleStampCheck(6.35, 100, 200); // 1:100 at 200 dpi → 12.7 mm/px expected
  assert.ok(c.flagged);
  assert.ok(Math.abs(c.deviationPct + 50) < 0.1);
  assert.equal(scaleStampCheck(6.35, null, 200), null);
});

test('floor correction thresholds: none within 1 %, average within 2 % agreement, flagged otherwise', () => {
  assert.equal(floorCorrection({ refLengths: [31600, 10150], measured: [31500, 10100] }).status, 'none');
  const applied = floorCorrection({ refLengths: [31600, 10150], measured: [31000, 10000] });
  assert.equal(applied.status, 'applied');
  // corrections: +1.935 % and +1.5 % → average 1.718 %
  assert.ok(Math.abs(applied.appliedPct - ((31600 / 31000 - 1) * 100 + (10150 / 10000 - 1) * 100) / 2) < 1e-9);
  assert.ok(Math.abs(applied.factor - (1 + applied.appliedPct / 100)) < 1e-12);
  const flagged = floorCorrection({ refLengths: [31600, 10150], measured: [31000, 8500] });
  assert.equal(flagged.status, 'flagged');
  assert.equal(flagged.factor, 1);
  assert.equal(floorCorrection({ refLengths: [31600, 10150], measured: [31000, 0] }).status, 'flagged');
  // one wall within 1 % but the other at +1.8 %: both within 2 % of each other → applied
  const mixed = floorCorrection({ refLengths: [10000, 10000], measured: [9950, 9823] });
  assert.equal(mixed.status, 'applied');
});

test('similarity transform from two point pairs recovers move, rotation and uniform scale exactly', () => {
  const T = { s: 1.02, rot: 0.03, tx: 1234, ty: -567 };
  const m1 = { x: 100, y: 200 };
  const m2 = { x: 9000, y: 4000 };
  const est = similarityFromPairs([
    { ref: applyTransform(T, m1), mov: m1 },
    { ref: applyTransform(T, m2), mov: m2 },
  ]);
  assert.ok(Math.abs(est.s - T.s) < 1e-9 && Math.abs(est.rot - T.rot) < 1e-9 && Math.abs(est.tx - T.tx) < 1e-6 && Math.abs(est.ty - T.ty) < 1e-6);
  const m3 = { x: 5000, y: 1000 };
  const p = applyTransform(est, m3);
  const q = applyTransform(T, m3);
  assert.ok(Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6);
  const dev = referenceDeviation([10000], [W('r', 0, 0, 10000 / 1.02, 0)], est);
  assert.ok(Math.abs(dev[0].deviationPct) < 1e-6);
});

test('reference walls: two long walls at an angle, dimensioned preferred', () => {
  const walls = [W('facade', 0, 0, 31600, 0, { dimensioned: true, presentOnFloors: 4 }), W('facade2', 0, 200, 31000, 200, { presentOnFloors: 4 }), W('gable', 0, 0, 0, 10150, { presentOnFloors: 4 }), W('short', 5000, 0, 5000, 3000)];
  const r = pickReferenceWalls(walls, { floorCount: 4 });
  assert.equal(r.walls[0].id, 'facade');
  assert.equal(r.walls[1].id, 'gable', 'second wall must be at an angle, not the parallel facade2');
  assert.ok(Math.abs(r.angleDeg - 90) < 1e-9);
  assert.ok(r.reasons[0].includes('written dimension'));
  assert.equal(pickReferenceWalls([walls[0], walls[1]]), null, 'no pair at an angle');
});

test('matching reference walls on another floor after coarse alignment', () => {
  const ref = [W('f', 0, 0, 31600, 0), W('g', 0, 0, 0, 10150)];
  // other floor: shifted by (500, 300), slightly shorter (scan 1 % smaller), with extra walls
  const other = [W('x1', 500, 300, 500 + 31284, 300), W('x2', 500, 300, 500, 300 + 10050), W('x3', 5000, 300, 5000, 4000), W('x4', 500, 5000, 20000, 5000)];
  const off = coarseAlign(ref, other);
  const m1 = matchWall(ref[0], other, { offset: off });
  const m2 = matchWall(ref[1], other, { offset: off });
  assert.equal(m1.wall.id, 'x1');
  assert.equal(m2.wall.id, 'x2');
  const corr = floorCorrection({ refLengths: [31600, 10150], measured: [31284, 10050] });
  assert.equal(corr.status, 'applied');
  assert.equal(matchWall(W('r', 0, 0, 100, 0), [W('a', 0, 0, 0, 100)]), null, 'no wall in the right direction');
});

test('vertical sanity: door height range and scale bar agreement', () => {
  assert.ok(verticalSanity({ doorHeightsM: [2.05, 2.1] }).ok);
  const bad = verticalSanity({ doorHeightsM: [2.05, 2.6], scaleBarMmPerPx: 10, mmPerPx: 10.5 });
  assert.equal(bad.ok, false);
  assert.equal(bad.flags.length, 2);
});

test('reference floor proposal prefers written dimensions and scale bar', () => {
  const p = proposeReferenceFloor([{ level: 1, clarity: 0.9 }, { level: 2, hasWrittenDimensions: true, clarity: 0.6 }, { level: 3, hasScaleBar: true, clarity: 0.9 }]);
  assert.equal(p.level, 2);
});
