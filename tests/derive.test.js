import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, newLevel, newSheet, newWall, newRoom } from '../app/state/model.js';
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
