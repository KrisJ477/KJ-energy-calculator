// Manual alignment mode (SPEC 4.4): one tool for floor vs reference floor, sheet vs neighbouring sheet,
// vertical drawing vs plans. Places whole layers only; no re-read.
import { h, clear, numberInput, select, section, button, fmt, toast, checkbox } from '../ui/dom.js';
import { t } from '../i18n/strings.js';
import { CanvasView } from '../ui/canvasview.js';
import { similarityFromPairs, referenceDeviation } from '../engine/scale.js';
import { levelWalls, sheetToLevel, levelToBuilding } from '../state/derive.js';
import { applyTransform, bbox, dist } from '../engine/geometry.js';
import { sheetLabel } from '../ai/jobs.js';
import { sheetLayer } from './scale.js';

export function render(root, ctx) {
  const { store } = ctx;
  const p = store.project;
  clear(root);
  const target = ctx.alignTarget || { kind: 'level', level: p.levels.find((l) => !l.referenceFloor) ? p.levels.find((l) => !l.referenceFloor).level : null };
  const refLevel = p.levels.find((l) => l.referenceFloor) || p.levels[0];
  const st = { pairs: [], pending: null, T: null, nonUniform: false, refOpacity: 0.8, movOpacity: 0.8 };
  // moving layer and reference layer definitions
  let moving; // { label, layers (bitmap layers in world), walls (world), initialT, commit(T) }
  let reference;
  const world = 'building';
  if (target.kind === 'level' && target.level != null) {
    const lvl = p.levels.find((l) => l.level === target.level);
    const refSheets = p.sheets.filter((s) => s.type === 'plan' && s.level === refLevel.level && s.role !== 'ignore');
    const movSheets = p.sheets.filter((s) => s.type === 'plan' && s.level === lvl.level && s.role !== 'ignore');
    const refT = levelToBuilding(refLevel).T;
    reference = { label: `${refLevel.level}: ${refLevel.name}`, layers: refSheets.map((s) => composeLayer(ctx, s, refT, '#3060ff')), walls: levelWalls(p, refLevel.level).map((w) => ({ ...w, a: applyTransform(refT, w.a), b: applyTransform(refT, w.b) })) };
    st.T = { ...(lvl.transform || { s: 1, rot: 0, tx: 0, ty: 0 }) };
    moving = { label: `${lvl.level}: ${lvl.name}`, sheets: movSheets, wallsLocal: levelWalls(p, lvl.level), commit: (T) => store.update((pr) => { const l = pr.levels.find((x) => x.level === lvl.level); l.transform = T; l.scaleCorrection = { status: 'manual', method: t('align.method'), pairs: st.pairs, appliedPct: ((T.sx ?? T.s ?? 1) - 1) * 100, nonUniform: T.sx !== undefined && T.sx !== T.sy, at: new Date().toISOString() }; }, { label: 'manual alignment' }) };
  } else if (target.kind === 'sheet' && target.sheetId) {
    const sheet = p.sheets.find((s) => s.id === target.sheetId);
    const lvl = p.levels.find((l) => l.level === sheet.level) || refLevel;
    const others = p.sheets.filter((s) => s.id !== sheet.id && s.type === 'plan' && s.level === lvl.level && s.role !== 'ignore');
    const refT = { s: 1, rot: 0, tx: 0, ty: 0 };
    reference = { label: others.map((s) => sheetLabel(p, s)).join(', ') || `${lvl.level}: ${lvl.name}`, layers: others.map((s) => composeLayer(ctx, s, refT, '#3060ff')), walls: levelWalls(p, lvl.level).filter((w) => w.raw.sheetId !== sheet.id) };
    const pl = sheet.placement || { rot: 0, tx: 0, ty: 0, sx: 1, sy: 1 };
    const mmPerPx = sheet.scale ? sheet.scale.mmPerPx : 1;
    st.T = { sx: (pl.sx || 1) * mmPerPx, sy: (pl.sy || 1) * mmPerPx, rot: pl.rot || 0, tx: pl.tx || 0, ty: pl.ty || 0 };
    st.sheetMmPerPx = mmPerPx;
    moving = { label: sheetLabel(p, sheet), sheets: [sheet], sheetMode: true, sheet, wallsLocal: p.walls.filter((w) => w.sheetId === sheet.id && !w.deleted).map((w) => ({ id: w.id, a: w.aPx, b: w.bPx, thicknessMm: 0 })), commit: (T) => store.update((pr) => { const s = pr.sheets.find((x) => x.id === sheet.id); const m = s.scale ? s.scale.mmPerPx : 1; s.placement = { sx: (T.sx ?? T.s) / m, sy: (T.sy ?? T.s) / m, rot: T.rot, tx: T.tx, ty: T.ty, method: t('align.method'), pairs: st.pairs, at: new Date().toISOString() }; }, { label: 'manual alignment' }) };
  } else {
    root.append(section(t('align.title'), h('p', {}, '–')));
    return;
  }
  const refWallsForDeviation = refLevel.referenceWalls || [];
  const host = h('div', { class: 'canvas-host', style: { height: '600px' } });
  const status = h('div', { class: 'muted' });
  const fields = {};
  const upd = () => {
    const T = st.T;
    fields.rot.value = fmt(((T.rot || 0) * 180) / Math.PI, 3);
    fields.s.value = fmt(T.sx ?? T.s ?? 1, 5);
    fields.sy.value = fmt(T.sy ?? T.s ?? 1, 5);
    fields.tx.value = fmt(T.tx, 0);
    fields.ty.value = fmt(T.ty, 0);
    view.layers.forEach((l) => { if (l.moving) l.T = movingLayerT(l.base, T); });
    view.regionCache.clear();
    view.draw();
    // live deviation
    if (refWallsForDeviation.length && !moving.sheetMode) {
      const rw = refWallsForDeviation.map((r) => reference.walls.find((w) => w.id === r.wallId)).filter(Boolean);
      const mw = rw.map((w) => nearestWall(w, moving.wallsLocal.map((x) => ({ ...x, a: applyTransform(T, x.a), b: applyTransform(T, x.b) })))).filter(Boolean);
      status.textContent = `${t('align.deviation')}: ` + mw.map((w, i) => `${fmt(dist(w.a, w.b))} mm vs ${fmt(refWallsForDeviation[i].lengthMm)} mm (${fmt(((dist(w.a, w.b) - refWallsForDeviation[i].lengthMm) / refWallsForDeviation[i].lengthMm) * 100, 2)} %)`).join(' · ');
    }
    warn.style.display = st.T.sx != null && st.T.sy != null && Math.abs(st.T.sx - st.T.sy) > 1e-9 ? '' : 'none';
  };
  const setField = (k, v) => { if (k === 'rot') st.T.rot = (v * Math.PI) / 180; else if (k === 's') { st.T.sx = v; if (!st.nonUniform) st.T.sy = v; delete st.T.s; } else if (k === 'sy') { st.T.sy = v; } else st.T[k] = v; upd(); };
  const warn = h('p', { class: 'warn' }, t('align.nonUniformWarning'));
  fields.rot = numberInput(0, (v) => setField('rot', v), { step: 0.01 });
  fields.s = numberInput(1, (v) => setField('s', v), { step: 0.0001 });
  fields.sy = numberInput(1, (v) => setField('sy', v), { step: 0.0001 });
  fields.tx = numberInput(0, (v) => setField('tx', v));
  fields.ty = numberInput(0, (v) => setField('ty', v));
  const pairsLabel = h('span', {});
  root.append(section(t('align.title'),
    h('div', { class: 'row' }, h('b', {}, `${t('align.reference')}: ${reference.label}`), h('b', { style: { color: '#c00' } }, `${t('align.moving')}: ${moving.label}`)),
    h('p', { class: 'help' }, t('align.pointPairs'), ' ', pairsLabel, ' ', t('align.nudge')),
    host,
    h('div', { class: 'row' },
      h('label', {}, `${t('align.reference')} ${t('align.opacity')}`), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: st.refOpacity, onInput: (e) => { st.refOpacity = Number(e.target.value); view.layers.forEach((l) => { if (!l.moving) l.line = st.refOpacity; }); view.draw(); } }),
      h('label', {}, `${t('align.moving')} ${t('align.opacity')}`), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: st.movOpacity, onInput: (e) => { st.movOpacity = Number(e.target.value); view.layers.forEach((l) => { if (l.moving) l.line = st.movOpacity; }); view.draw(); } })),
    h('div', { class: 'row' }, h('label', {}, t('align.rotate')), fields.rot, h('label', {}, t('align.scale')), fields.s, checkbox(false, (v) => { st.nonUniform = v; fields.sy.disabled = !v; if (!v) setField('s', st.T.sx ?? st.T.s ?? 1); }, t('align.scaleY')), fields.sy, h('label', {}, `${t('align.move')} X`), fields.tx, h('label', {}, 'Y'), fields.ty),
    warn,
    status,
    h('div', { class: 'row' }, button(t('align.reset'), () => { st.pairs = []; st.pending = null; st.T = moving.sheetMode ? { sx: st.sheetMmPerPx, sy: st.sheetMmPerPx, rot: 0, tx: 0, ty: 0 } : { s: 1, rot: 0, tx: 0, ty: 0 }; upd(); }), button(t('align.accept'), () => { moving.commit({ ...st.T }); toast(t('align.accept')); ctx.navigate('scale'); }, { class: 'btn primary' }))
  ));
  fields.sy.disabled = true;
  const view = new CanvasView(host, {
    onDraw: (g, v) => {
      // reference walls blue, moving walls red, point pairs
      g.lineWidth = v.px(2);
      g.strokeStyle = 'rgba(48,96,255,0.8)';
      for (const w of reference.walls) { g.beginPath(); g.moveTo(w.a.x, w.a.y); g.lineTo(w.b.x, w.b.y); g.stroke(); }
      g.strokeStyle = 'rgba(220,0,0,0.8)';
      for (const w of moving.wallsLocal) { const a = applyTransform(st.T, w.a); const b = applyTransform(st.T, w.b); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      for (const pr of st.pairs) {
        g.fillStyle = '#3060ff'; g.beginPath(); g.arc(pr.ref.x, pr.ref.y, v.px(6), 0, 7); g.fill();
        const m = applyTransform(st.T, pr.movLocal); g.fillStyle = '#d00'; g.beginPath(); g.arc(m.x, m.y, v.px(6), 0, 7); g.fill();
        g.strokeStyle = '#999'; g.beginPath(); g.moveTo(pr.ref.x, pr.ref.y); g.lineTo(m.x, m.y); g.stroke();
      }
      if (st.pending) { g.fillStyle = '#3060ff'; g.beginPath(); g.arc(st.pending.x, st.pending.y, v.px(6), 0, 7); g.fill(); }
    },
    onPointer: (ev) => {
      if (ev.type !== 'click') return false;
      if (!st.pending) { st.pending = { ...ev.world }; pairsLabel.textContent = `${st.pairs.length} ${t('align.pairsDone')} (+1)`; view.draw(); return false; }
      // second click: same point on the moving layer → store in moving-local coordinates
      const inv = invert(st.T);
      st.pairs.push({ ref: st.pending, movLocal: inv(ev.world) });
      st.pending = null;
      if (st.pairs.length >= 2) {
        const last = st.pairs.slice(-2);
        const T = similarityFromPairs(last.map((x) => ({ ref: x.ref, mov: x.movLocal })));
        if (T) { st.T = { sx: T.s, sy: T.s, rot: T.rot, tx: T.tx, ty: T.ty }; }
      }
      pairsLabel.textContent = `${st.pairs.length} ${t('align.pairsDone')}`;
      upd();
      return false;
    },
    onKey: (e) => {
      const step = e.shiftKey ? 100 : 10;
      if (e.key === 'ArrowLeft') st.T.tx -= step; else if (e.key === 'ArrowRight') st.T.tx += step; else if (e.key === 'ArrowUp') st.T.ty -= step; else if (e.key === 'ArrowDown') st.T.ty += step; else return;
      e.preventDefault();
      upd();
    },
  });
  ctx.registerCanvas(view);
  const layers = [...reference.layers.map((l) => ({ ...l, line: st.refOpacity }))];
  for (const s of moving.sheets) {
    const base = moving.sheetMode ? { f: s.overviewFactor || 1, sheetT: null } : { f: s.overviewFactor || 1, sheetT: sheetToLevel(s).T };
    layers.push({ ...sheetLayer(ctx, s, { tint: '#ff4040', line: st.movOpacity, paper: 0 }), moving: true, base, T: movingLayerT(base, st.T) });
  }
  view.setLayers(layers).then(() => {
    const pts = [...reference.walls.flatMap((w) => [w.a, w.b]), ...moving.wallsLocal.flatMap((w) => [applyTransform(st.T, w.a), applyTransform(st.T, w.b)])];
    if (pts.length) view.fitTo(bbox(pts));
    else view.fitTo({ minX: 0, minY: 0, width: 50000, height: 30000 });
    upd();
  });
}

function composeLayer(ctx, sheet, levelT, tint) {
  // bitmap → level (sheetLayer) → building (levelT)
  const base = sheetLayer(ctx, sheet, { tint, paper: 0 });
  return { ...base, T: compose(levelT, base.T) };
}
// bitmap px → level via A (sheet layer T), then level → world via B (level transform). Result as T object.
function compose(B, A) {
  const bs = B.sx ?? B.s ?? 1;
  const bsy = B.sy ?? B.s ?? 1;
  const c = Math.cos(B.rot || 0);
  const s = Math.sin(B.rot || 0);
  // only uniform scale B supported for composition (level transforms are similarities)
  const tx = c * bs * (A.tx || 0) - s * bsy * (A.ty || 0) + (B.tx || 0);
  const ty = s * bs * (A.tx || 0) + c * bsy * (A.ty || 0) + (B.ty || 0);
  return { sx: (A.sx ?? A.s ?? 1) * bs, sy: (A.sy ?? A.s ?? 1) * bsy, rot: (A.rot || 0) + (B.rot || 0), tx, ty };
}
function movingLayerT(base, T) {
  if (base.sheetT) return compose(T, compose(base.sheetT, { sx: 1 / base.f, sy: 1 / base.f, rot: 0, tx: 0, ty: 0 }));
  // sheet mode: T maps sheet px → level mm; bitmap px = sheet px × f
  return compose(T, { sx: 1 / base.f, sy: 1 / base.f, rot: 0, tx: 0, ty: 0 });
}
function invert(T) {
  const sx = T.sx ?? T.s ?? 1;
  const sy = T.sy ?? T.s ?? 1;
  const c = Math.cos(-(T.rot || 0));
  const s = Math.sin(-(T.rot || 0));
  return (p) => { const x = p.x - (T.tx || 0); const y = p.y - (T.ty || 0); return { x: (c * x - s * y) / sx, y: (s * x + c * y) / sy }; };
}
function nearestWall(ref, walls) {
  const mid = (w) => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
  let best = null;
  for (const w of walls) { const d = dist(mid(w), mid(ref)); if (!best || d < best.d) best = { d, w }; }
  return best ? best.w : null;
}
