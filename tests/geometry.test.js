import test from 'node:test';
import assert from 'node:assert/strict';
import { snapToleranceMm, cleanupWalls, buildRooms, floorPieces, slabZones, roomSlabSplit, minWidth, polygonArea, shapeArea, multiArea, sharedEdgeLength } from '../app/engine/geometry.js';

const W = (id, ax, ay, bx, by, t = 300) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thicknessMm: t });
const rect = (x0, y0, x1, y1) => ({ outer: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], holes: [] });

test('snap tolerance rule: 3 px worth, clamped 20–50 mm, at most half the thinnest wall', () => {
  assert.equal(snapToleranceMm({ mmPerPx: 6.4, thinnestWallMm: 100 }), 20); // 19.2 → 20
  assert.equal(snapToleranceMm({ mmPerPx: 8.5, thinnestWallMm: 100 }), 25.5);
  assert.equal(snapToleranceMm({ mmPerPx: 17, thinnestWallMm: 100 }), 50); // 51 → 50
  assert.equal(snapToleranceMm({ mmPerPx: 17, thinnestWallMm: 70 }), 35);
  assert.equal(snapToleranceMm({ mmPerPx: 17, thinnestWallMm: 70, overrideMm: 40 }), 40);
});

test('cleanup: snaps endpoints, trims overshoots, merges collinear segments but not at junctions', () => {
  const walls = [
    W('w1', 0, 0, 5000, 10), // slightly off
    W('w2', 5000, 0, 10000, 0), // collinear continuation
    W('w3', 10000, 0, 10000, 6000),
    W('w4', 10000, 6000, 0, 6000),
    W('w5', 0, 6000, 0, -30), // overshoots past w1 by 30
    W('w6', 5000, 15, 5000, 3000, 150), // T-junction onto w1/w2 joint, endpoint 15 away
  ];
  const { walls: out, log } = cleanupWalls(walls, 40);
  const w5 = out.find((w) => w.id === 'w5');
  assert.ok(Math.abs(w5.b.y) < 1e-6, 'overshoot trimmed');
  const w6 = out.find((w) => w.id === 'w6');
  const w1 = out.find((w) => w.id === 'w1');
  const w2 = out.find((w) => w.id === 'w2');
  assert.ok(Math.abs(w6.a.x - w1.b.x) < 1e-6 && Math.abs(w6.a.y - w1.b.y) < 1e-6 && Math.abs(w2.a.y - w1.b.y) < 1e-6, 'endpoints within tolerance snapped to one point');
  const tj = cleanupWalls([W('base', 0, 0, 8000, 0), W('t', 4000, 25, 4000, 3000, 150)], 40).walls;
  assert.ok(Math.abs(tj[1].a.y) < 1e-6, 'endpoint snapped onto a wall body (T-junction)');
  // w1 and w2 are collinear and meet at a junction with w6 → must NOT be merged
  assert.ok(out.find((w) => w.id === 'w1') && out.find((w) => w.id === 'w2'));
  const merged = cleanupWalls([W('a', 0, 0, 3000, 0), W('b', 3000, 0, 6000, 5)], 40).walls;
  assert.equal(merged.length, 1, 'collinear segments without junction merged');
  assert.ok(Math.abs(merged[0].a.x - 0) < 1e-6 && Math.abs(merged[0].b.x - 6000) < 1e-6);
  const notMerged = cleanupWalls([W('a', 0, 0, 3000, 0, 300), W('b', 3000, 0, 6000, 0, 150)], 40).walls;
  assert.equal(notMerged.length, 2, 'different thickness clusters not merged');
  assert.ok(log.length > 0);
});

test('rooms from walls: two rooms, inside-face areas, wall sides', () => {
  // 10 m × 6 m shell (300 mm) with a 150 mm partition at x = 4 m (centerlines)
  const walls = [W('n', 0, 0, 10000, 0), W('e', 10000, 0, 10000, 6000), W('s', 10000, 6000, 0, 6000), W('w', 0, 6000, 0, 0), W('p', 4000, 0, 4000, 6000, 150)];
  const res = buildRooms(walls, [], { tol: 20 });
  assert.equal(res.rooms.length, 2);
  const areas = res.rooms.map((r) => r.areaM2).sort((a, b) => a - b);
  // left room: (4000-150-75) × (6000-300) = 3775 × 5700; right room: (6000-150-75) × 5700
  assert.ok(Math.abs(areas[0] - (3.775 * 5.7)) < 1e-6, `left ${areas[0]}`);
  assert.ok(Math.abs(areas[1] - (5.775 * 5.7)) < 1e-6, `right ${areas[1]}`);
  // the partition edge has rooms on both sides, exterior edges have 'outside' on one side
  const part = res.edges.find((e) => e.wallId === 'p');
  assert.ok(typeof part.left === 'number' && typeof part.right === 'number');
  const north = res.edges.filter((e) => e.wallId === 'n');
  assert.equal(north.length, 2, 'north wall split at the partition junction (golden rule)');
  for (const e of north) assert.ok((e.left === 'outside') !== (e.right === 'outside'));
  assert.equal(res.dangling.length, 0);
});

test('virtual separator splits an open space into two rooms with no thickness', () => {
  const walls = [W('n', 0, 0, 8000, 0), W('e', 8000, 0, 8000, 5000), W('s', 8000, 5000, 0, 5000), W('w', 0, 5000, 0, 0)];
  const one = buildRooms(walls, [], { tol: 20 });
  assert.equal(one.rooms.length, 1);
  const two = buildRooms(walls, [{ id: 'sep', a: { x: 3000, y: 0 }, b: { x: 3000, y: 5000 } }], { tol: 20 });
  assert.equal(two.rooms.length, 2);
  const total = two.rooms.reduce((s, r) => s + r.areaM2, 0);
  assert.ok(Math.abs(total - one.rooms[0].areaM2) < 1e-9, 'separator takes no area');
  const sepEdge = two.edges.find((e) => e.wallId === 'sep');
  assert.ok(sepEdge.separator);
});

test('dangling wall (gap candidate) does not form a room and is reported', () => {
  const walls = [W('n', 0, 0, 8000, 0), W('e', 8000, 0, 8000, 5000), W('s', 8000, 5000, 0, 5000), W('w', 0, 5000, 0, 0), W('stub', 3000, 0, 3000, 2000, 150)];
  const res = buildRooms(walls, [], { tol: 20 });
  assert.equal(res.rooms.length, 1);
  assert.equal(res.dangling.length, 1);
  assert.equal(res.dangling[0].wallId, 'stub');
});

test('island (chimney block) inside a room becomes a hole and reduces the area', () => {
  const walls = [W('n', 0, 0, 8000, 0), W('e', 8000, 0, 8000, 5000), W('s', 8000, 5000, 0, 5000), W('w', 0, 5000, 0, 0), W('c1', 3000, 2000, 4000, 2000, 200), W('c2', 4000, 2000, 4000, 3000, 200), W('c3', 4000, 3000, 3000, 3000, 200), W('c4', 3000, 3000, 3000, 2000, 200)];
  const res = buildRooms(walls, [], { tol: 20 });
  // one bounded face is the inside of the chimney (1 m²), the other the room
  const big = res.rooms.sort((a, b) => b.areaM2 - a.areaM2)[0];
  assert.equal(big.holes.length, 1);
  const full = 7.7 * 4.7;
  const holeOuter = 1.2 * 1.2; // 1 m centerline + 200 mm walls
  assert.ok(Math.abs(big.areaM2 - (full - holeOuter)) < 1e-6, `${big.areaM2}`);
});

test('floor pieces: overlap split, slivers absorbed, uncovered areas reported', () => {
  const lower = [{ id: '1-1', shape: rect(0, 0, 4000, 6000) }, { id: '1-2', shape: rect(4000, 0, 10000, 6000) }];
  // upper floor misaligned by 100 mm in x → a 100 mm sliver over 1-1 and 1-2 boundaries
  const upper = [{ id: '2-1', shape: rect(100, 0, 10100, 6000) }];
  const res = floorPieces(lower, upper, { sliverWidthMm: 150, sliverAreaM2: 0.1 });
  assert.equal(res.pieces.length, 2);
  assert.equal(res.absorbed, 0);
  const total = res.pieces.reduce((s, p) => s + p.areaM2, 0);
  assert.ok(Math.abs(total - 9.9 * 6) < 1e-6);
  assert.equal(res.uncoveredUpper.length, 0, '100 mm strip of the upper room with nothing below is below the sliver width');
  // a thin overlap piece: upper room 2-2 covers a 120 mm strip of 1-1 and most of 1-2
  const upper2 = [{ id: '2-1', shape: rect(0, 0, 3880, 6000) }, { id: '2-2', shape: rect(3880, 0, 10000, 6000) }];
  const res2 = floorPieces(lower, upper2, { sliverWidthMm: 150, sliverAreaM2: 0.1 });
  assert.equal(res2.absorbed, 1, 'the 120 mm × 6 m piece (0.72 m²) is a sliver by width');
  assert.equal(res2.pieces.length, 2);
  const grown = res2.pieces.find((p) => p.absorbed);
  assert.ok(grown, 'sliver merged into a neighbour');
  const total2 = res2.pieces.reduce((s, p) => s + p.areaM2, 0);
  assert.ok(Math.abs(total2 - 60) < 1e-6);
  // uncovered: lower room 1-2 extends beyond the upper floor
  const res3 = floorPieces(lower, [{ id: '2-1', shape: rect(0, 0, 7000, 6000) }], {});
  assert.equal(res3.uncoveredLower.length, 1);
  assert.ok(Math.abs(res3.uncoveredLower[0].areaM2 - 18) < 1e-6);
  assert.equal(res3.uncoveredLower[0].roomId, '1-2');
});

test('tiny-area sliver absorbed by area rule', () => {
  const lower = [{ id: '1-1', shape: rect(0, 0, 5000, 5000) }];
  const upper = [{ id: '2-1', shape: rect(0, 0, 4800, 5000) }, { id: '2-2', shape: rect(4800, 0, 5000, 300) }, { id: '2-3', shape: rect(4800, 300, 5000, 5000) }];
  const res = floorPieces(lower, upper, { sliverWidthMm: 150, sliverAreaM2: 0.1 });
  assert.equal(res.absorbed, 1, '0.06 m² piece absorbed');
});

test('minWidth and sharedEdgeLength', () => {
  assert.ok(Math.abs(minWidth(rect(0, 0, 10000, 120).outer) - 120) < 1e-6);
  assert.ok(Math.abs(sharedEdgeLength(rect(0, 0, 4000, 6000), rect(4000, 1000, 8000, 6000)) - 5000) < 1e-6);
});

test('slab zones: 3 m band and inner area', () => {
  const zones = slabZones(rect(0, 0, 20000, 10000), 3000);
  assert.ok(Math.abs(zones.areaM2 - 200) < 1e-9);
  assert.ok(Math.abs(zones.perimeterM - 60) < 1e-9);
  assert.ok(Math.abs(multiArea(zones.inner) / 1e6 - 14 * 4) < 1e-6);
  assert.ok(Math.abs(multiArea(zones.band) / 1e6 - (200 - 56)) < 1e-6);
  const split = roomSlabSplit(rect(0, 0, 5000, 10000), zones);
  assert.ok(Math.abs(split.bandM2 - (50 - 2 * 4)) < 1e-6);
  assert.ok(Math.abs(split.innerM2 - 8) < 1e-6);
  const narrow = slabZones(rect(0, 0, 10000, 6000), 3000);
  assert.ok(multiArea(narrow.inner) < 1e-6, 'no inner zone when the building is only 6 m deep');
  assert.ok(Math.abs(multiArea(narrow.band) / 1e6 - 60) < 1e-6);
});

test('polygon helpers', () => {
  assert.equal(polygonArea(rect(0, 0, 2, 3).outer), 6);
  assert.equal(shapeArea({ outer: rect(0, 0, 4, 4).outer, holes: [rect(1, 1, 2, 2).outer] }), 15);
});

test('floorPieces terminates when a sliver has no neighbour and another sliver exists', () => {
  // Two isolated tiny overlaps (no shared edges) must not loop forever (regression).
  const sq = (x, y, w, h) => ({ outer: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], holes: [] });
  const lower = [{ id: 'a', shape: sq(0, 0, 4000, 4000) }, { id: 'b', shape: sq(10000, 0, 4000, 4000) }];
  const upper = [{ id: 'c', shape: sq(3950, 0, 4000, 100) }, { id: 'd', shape: sq(13950, 0, 4000, 100) }];
  const res = floorPieces(lower, upper, { sliverWidthMm: 150, sliverAreaM2: 0.1 });
  assert.equal(res.pieces.length, 2);
  assert.ok(res.pieces.every((p) => p.isolatedSliver));
});

test('floorPieces survives near-degenerate input (clipping fallback)', () => {
  // two rooms whose overlap is a hair-thin, non-axis-aligned strip: polygon-clipping can throw here
  const a = { outer: [{ x: 0, y: 0 }, { x: 18309.613222215146, y: 0 }, { x: 18318.488700078145, y: 28698.85477253357 }, { x: 0, y: 28698.85477253357 }], holes: [] };
  const b = { outer: [{ x: 18309.613222215146, y: 28698.85477253357 }, { x: 18318.488700078145, y: 28698.85477253357 }, { x: 18318.4887, y: 28700.0000001 }, { x: 18309.6132, y: 28700.0000001 }], holes: [] };
  const res = floorPieces([{ id: 'a', shape: a }, { id: 'b', shape: b }], [{ id: 'c', shape: a }, { id: 'd', shape: b }], { sliverWidthMm: 150, sliverAreaM2: 0.1 });
  assert.ok(res.pieces.length >= 1);
});
