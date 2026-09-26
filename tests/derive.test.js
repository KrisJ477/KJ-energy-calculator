import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, newLevel, newSheet, newWall, newRoom, newOpening } from '../app/state/model.js';
import { derive, syncRooms } from '../app/state/derive.js';

// Two stacked floors, each a 10 × 6 m box split into two rooms, on a 1:1 mm sheet (scale 1 mm/px).
function project() {
  const p = newProject('t');
  p.levels = [newLevel(0, 'BV'), newLevel(1, '1 TR')];
  p.levels.forEach((l) => (l.heightMm = 3000));
  for (const lvl of [0, 1]) {
    const sh = newSheet('d' + lvl, 0, { level: lvl, type: 'plan', role: 'base', widthPx: 20000, heightPx: 20000, scale: { mmPerPx: 1, pxPerM: 1000, method: 'typed', label: 't' } });
    p.sheets.push(sh);
    const W = (ax, ay, bx, by, t = 300, ext = true) => p.walls.push(newWall(sh.id, lvl, { x: ax, y: ay }, { x: bx, y: by }, null, { thicknessPx: t, exteriorGuess: ext }));
    W(0, 0, 10000, 0); W(10000, 0, 10000, 6000); W(10000, 6000, 0, 6000); W(0, 6000, 0, 0);
    W(4000, 0, 4000, 6000, 150, false);
    p.rooms.push(newRoom(lvl, 1, { name: 'A', anchorPx: { x: 2000, y: 3000 }, sheetId: sh.id }));
    // room B (x 4–10 m) has no record: it must be synced
  }
  return p;
}

test('derive: every enclosed face gets a room record via syncRooms, and the records stay matched', () => {
  const p = project();
  let d = derive(p, []);
  assert.equal(d.perLevel[0].faceRooms.filter((f) => !f.record).length, 1);
  for (const lvl of [0, 1]) syncRooms(p, lvl, (l, i, extra) => newRoom(l, i, { ...extra }), d.perLevel[lvl]);
  d = derive(p, []);
  assert.equal(d.perLevel[0].faceRooms.filter((f) => !f.record).length, 0);
  assert.equal(p.rooms.length, 4);
  // a second sync adds nothing
  for (const lvl of [0, 1]) syncRooms(p, lvl, (l, i, extra) => newRoom(l, i, { ...extra }), d.perLevel[lvl]);
  assert.equal(p.rooms.length, 4);
});

test('derive: stacked floors give floor pieces between rooms and no floor-to-outside; piece ids are unique', () => {
  const p = project();
  for (const lvl of [0, 1]) syncRooms(p, lvl, (l, i, extra) => newRoom(l, i, { ...extra }));
  const d = derive(p, []);
  const between = d.pieces.filter((pc) => pc.kind === 'floor');
  assert.ok(between.length >= 2);
  assert.equal(d.pieces.filter((pc) => pc.kind === 'floor_to_outside').length, 0);
  const ids = d.pieces.map((pc) => pc.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(d.results.building > 0);
  assert.ok(!d.warnings.some((w) => w.type === 'floor-with-nothing-below'));
});

test('derive: a wall facing an unread part of the floor is not an exterior wall, and a sliver face is not a room', () => {
  const p = newProject('t');
  p.levels = [newLevel(0, 'BV')];
  p.levels[0].heightMm = 3000;
  const sh = newSheet('d', 0, { level: 0, type: 'plan', role: 'base', widthPx: 20000, heightPx: 20000, scale: { mmPerPx: 1, pxPerM: 1000, method: 'typed', label: 't' } });
  sh.buildingOutline = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 6000 }, { x: 0, y: 6000 }];
  p.sheets.push(sh);
  const W = (ax, ay, bx, by, t, ext) => p.walls.push(newWall(sh.id, 0, { x: ax, y: ay }, { x: bx, y: by }, null, { thicknessPx: t, exteriorGuess: ext }));
  // room A (0–4 m) closed; its east wall (x = 4 m) is a thin interior wall; the rest of the floor (4–10 m) is unread (open)
  W(0, 0, 4000, 0, 300, true); W(0, 6000, 0, 0, 300, true); W(0, 6000, 4000, 6000, 300, true); W(4000, 0, 4000, 6000, 120, false);
  W(4000, 6000, 10000, 6000, 300, true); // south wall continues, north and east walls missing
  // a 60 mm sliver between two parallel readings of the west wall
  W(-60, 0, -60, 6000, 300, true); W(-60, 0, 0, 0, 300, true); W(-60, 6000, 0, 6000, 300, true);
  p.rooms.push(newRoom(0, 1, { name: 'A', anchorPx: { x: 2000, y: 3000 }, sheetId: sh.id }));
  const d = derive(p, []);
  const pl = d.perLevel[0];
  assert.ok(pl.roomList.some((r) => r.sliver), 'the 60 mm gap is a sliver');
  assert.equal(d.calcModel.rooms.length, 1, 'the sliver is not a calculated room');
  const east = d.calcModel.surfaces.find((s) => s.kind === 'wall' && s.other && s.other.type === 'unread');
  assert.ok(east, 'the thin wall facing the open region faces an unread space');
  assert.ok(Math.abs(east.areaM2 - 18) < 0.2);
  assert.ok(!d.calcModel.surfaces.some((s) => s.kind === 'wall' && s.other && s.other.type === 'outside' && s.wallId === p.walls[3].id));
  const w = d.results.rooms['0-1'].rows.find((r) => r.surfaceId === east.id);
  assert.equal(w.watts, 0, 'no loss to a space assumed heated');
});

test('derive: a window at a wall junction is counted on one edge only', () => {
  const p = newProject('t');
  p.levels = [newLevel(0, 'BV')];
  p.levels[0].heightMm = 3000;
  const sh = newSheet('d', 0, { level: 0, type: 'plan', role: 'base', widthPx: 20000, heightPx: 20000, scale: { mmPerPx: 1, pxPerM: 1000, method: 'typed', label: 't' } });
  p.sheets.push(sh);
  const W = (ax, ay, bx, by, t, ext) => { const w = newWall(sh.id, 0, { x: ax, y: ay }, { x: bx, y: by }, null, { thicknessPx: t, exteriorGuess: ext }); p.walls.push(w); return w; };
  const north = W(0, 0, 10000, 0, 300, true); W(10000, 0, 10000, 6000, 300, true); W(10000, 6000, 0, 6000, 300, true); W(0, 6000, 0, 0, 300, true);
  W(5000, 0, 5000, 6000, 150, false); // splits the north wall into two edges at x = 5 m
  p.rooms.push(newRoom(0, 1, { name: 'A', anchorPx: { x: 2500, y: 3000 }, sheetId: sh.id }), newRoom(0, 2, { name: 'B', anchorPx: { x: 7500, y: 3000 }, sheetId: sh.id }));
  // window centred exactly on the junction
  p.openings.push(newOpening(north.id, 'window', { aPx: { x: 4400, y: 0 }, bPx: { x: 5600, y: 0 }, widthPx: 1200, heightMm: 1400, sheetId: sh.id, level: 0 }));
  const d = derive(p, []);
  const win = d.calcModel.surfaces.filter((s) => s.kind === 'window');
  assert.equal(win.length, 1);
  assert.ok(Math.abs(win[0].areaM2 - 1.68) < 0.01);
});
