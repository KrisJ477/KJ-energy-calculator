// Scale (SPEC 4.4): reference floor, reference bar, reference walls, per-floor corrections, vertical checks,
// multi-sheet assembly (SPEC 4.3).
import { h, clear, numberInput, select, section, button, table, fmt, toast } from '../ui/dom.js';
import { t } from '../i18n/strings.js';
import { CanvasView } from '../ui/canvasview.js';
import { scaleFromMeasurement, pickReferenceWalls, matchWall, coarseAlign, floorCorrection, verticalSanity, proposeReferenceFloor, scaleStampCheck } from '../engine/scale.js';
import { levelWalls, sheetToLevel } from '../state/derive.js';
import { bbox, dist } from '../engine/geometry.js';
import { sheetLabel } from '../ai/jobs.js';

export function sheetLayer(ctx, sheet, extra = {}) {
  const tr = sheetToLevel(sheet);
  const f = sheet.overviewFactor || 1;
  const T = { sx: tr.T.sx / f, sy: tr.T.sy / f, rot: tr.T.rot, tx: tr.T.tx, ty: tr.T.ty };
  return {
    id: sheet.id,
    imageKey: sheet.overviewKey || sheet.imageKey,
    T,
    paper: sheet.opacity ? sheet.opacity.paper : 0.6,
    line: sheet.opacity ? sheet.opacity.line : 1,
    maxFactor: Math.max(1, 1 / f),
    renderRegion: async (regionDisp, bucket) => {
      const regionSheet = { x: regionDisp.x / f, y: regionDisp.y / f, w: regionDisp.w / f, h: regionDisp.h / f };
      const factor = Math.min(1, f * bucket);
      return ctx.runner.renderSheetRegion(sheet, regionSheet, factor);
    },
    ...extra,
  };
}

export function render(root, ctx) {
  const { store } = ctx;
  const p = store.project;
  clear(root);
  const set = (fn, label = 'scale') => store.update(fn, { label });
  const st = ctx.scaleState || (ctx.scaleState = { sheetId: null, bar: null, realMm: null, method: 'dimension', label: '' });
  const levels = [...p.levels].sort((a, b) => a.level - b.level);
  const proposal = proposeReferenceFloor(levels.map((l) => {
    const sh = p.sheets.find((s) => s.level === l.level && s.type === 'plan' && s.role === 'base');
    const c = sh && sh.classification;
    return { level: l.level, hasWrittenDimensions: c ? c.has_written_dimensions : false, hasScaleBar: c ? c.has_scale_bar : false, clarity: c ? c.clarity : 0.5, completeness: c ? c.completeness : 0.5 };
  }));
  const refLevel = levels.find((l) => l.referenceFloor) || null;
  const sheets = p.sheets.filter((s) => s.role !== 'ignore');
  if (!st.sheetId || !sheets.some((s) => s.id === st.sheetId)) {
    const refSheet = refLevel ? sheets.find((s) => s.level === refLevel.level && s.type === 'plan' && s.role === 'base') : null;
    st.sheetId = refSheet ? refSheet.id : sheets[0] ? sheets[0].id : null;
  }
  const sheet = sheets.find((s) => s.id === st.sheetId);

  // ----- reference floor -----
  const refSection = section(t('scale.referenceFloor'),
    h('div', { class: 'row' },
      h('span', {}, `${t('scale.propose')}: ${proposal ? `${proposal.level} (${proposal.why})` : '–'}`),
      select([[null, '–'], ...levels.map((l) => [l.level, `${l.level}: ${l.name}`])], refLevel ? refLevel.level : null, (v) => set((pr) => { pr.levels.forEach((l) => (l.referenceFloor = v != null && l.level === Number(v))); pr.ui.referenceFloorConfirmed = v != null; })),
      button(t('confirm'), () => { const lv = refLevel ? refLevel.level : proposal ? proposal.level : null; if (lv == null) return; set((pr) => { pr.levels.forEach((l) => (l.referenceFloor = l.level === lv)); pr.ui.referenceFloorConfirmed = true; }); })
    )
  );

  // ----- reference bar on a sheet -----
  const canvasHost = h('div', { class: 'canvas-host', style: { height: '520px' } });
  const info = h('div', {});
  const measurements = sheet ? (sheet.referenceMeasurements || []) : [];
  const propRows = measurements.map((m, i) => ({ cells: [m.kind, m.value_text, m.value_mm != null ? fmt(m.value_mm) : '–', m.reasoning, button(t('scale.propose'), () => { st.bar = { a: { ...m.a }, b: { ...m.b } }; st.realMm = m.value_mm; st.method = m.kind === 'scale_bar' ? 'scale-bar' : 'dimension'; st.label = `${m.kind === 'scale_bar' ? t('scale.scaleBar') : t('scale.dimension')} ${m.value_text}`; view.draw(); syncInputs(); })] }));
  const realInput = numberInput(st.realMm, (v) => (st.realMm = v), { width: '8em' });
  const labelInput = h('input', { type: 'text', value: st.label, style: { width: '16em' }, onChange: (e) => (st.label = e.target.value) });
  const methodSel = select([['dimension', t('scale.dimension')], ['scale-bar', t('scale.scaleBar')], ['typed', t('scale.typed')]], st.method, (v) => (st.method = v));
  const syncInputs = () => { realInput.value = st.realMm ?? ''; labelInput.value = st.label; methodSel.value = st.method; };
  const barSection = section(`${t('scale.title')} — ${sheet ? sheetLabel(p, sheet) : ''}`,
    h('div', { class: 'row' }, select(sheets.map((s) => [s.id, `${sheetLabel(p, s)} (${s.type}, ${s.level ?? '–'})`]), st.sheetId, (v) => { st.sheetId = v; st.bar = null; ctx.rerender(); }),
      sheet && sheet.scale ? h('b', {}, `${fmt(sheet.scale.mmPerPx, 3)} mm/px = ${fmt(sheet.scale.pxPerM, 1)} px/m (${sheet.scale.method}: ${sheet.scale.label})`) : h('span', { class: 'warn' }, '—'),
      sheet && sheet.scale && sheet.scaleStamp && sheet.renderDpi ? (() => { const c = scaleStampCheck(sheet.scale.mmPerPx, sheet.scaleStamp, sheet.renderDpi); return h('span', { class: c && c.flagged ? 'warn' : 'muted' }, `${t('scale.stampCheck')} 1:${sheet.scaleStamp}: ${c ? `${fmt(c.deviationPct, 1)} %` : ''}`); })() : null),
    h('p', { class: 'help' }, t('scale.referenceBar')),
    canvasHost,
    h('div', { class: 'row' }, h('label', {}, t('scale.method')), methodSel, h('label', {}, t('scale.realLength')), realInput, h('label', {}, t('scale.label')), labelInput,
      button(t('scale.setScale'), () => {
        if (!sheet || !st.bar || !st.realMm) return;
        const s = scaleFromMeasurement({ pxA: st.bar.a, pxB: st.bar.b, realMm: st.realMm, source: st.method, label: st.label || `${fmt(st.realMm)} mm` });
        if (!s) return;
        set((pr) => { const sh = pr.sheets.find((x) => x.id === sheet.id); sh.scale = s; sh.scaleSetAt = new Date().toISOString(); });
        toast(t('scale.setScale'));
        ctx.rerender();
      }, { class: 'btn primary' })),
    measurements.length ? table([t('scale.method'), 'text', 'mm', t('editor.reasoning'), ''], propRows) : null,
    info
  );
  root.append(refSection, barSection);

  // canvas: sheet in its own px frame (world = sheet px)
  const view = new CanvasView(canvasHost, {
    onDraw: (g, v) => {
      if (!st.bar) return;
      const { a, b } = st.bar;
      g.lineWidth = v.px(3);
      g.strokeStyle = '#e00';
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      for (const pt of [a, b]) {
        g.beginPath();
        g.arc(pt.x, pt.y, v.px(7), 0, Math.PI * 2);
        g.fillStyle = '#e00';
        g.fill();
      }
      g.fillStyle = '#e00';
      g.font = `${v.px(14)}px sans-serif`;
      g.fillText(`${st.label || ''} ${st.realMm ? `${fmt(st.realMm)} mm` : ''} (${fmt(dist(a, b), 0)} px)`, (a.x + b.x) / 2, (a.y + b.y) / 2 - v.px(10));
    },
    onPointer: (ev) => {
      if (ev.type === 'down') {
        if (!st.bar) return false;
        const r = ev.view.px(12);
        for (const k of ['a', 'b']) if (dist(st.bar[k], ev.world) < r) { st.drag = k; return true; }
        return false;
      }
      if (ev.type === 'drag' && st.drag) { st.bar[st.drag] = { x: ev.world.x, y: ev.world.y }; ev.view.draw(); return true; }
      if (ev.type === 'up') { st.drag = null; return true; }
      if (ev.type === 'click' && ev.event.shiftKey) {
        if (!st.bar) st.bar = { a: { ...ev.world }, b: { x: ev.world.x + 500, y: ev.world.y } };
        else st.bar.b = { ...ev.world };
        ev.view.draw();
      }
      return false;
    },
  });
  ctx.registerCanvas(view);
  if (sheet) {
    const f = sheet.overviewFactor || 1;
    view.setLayers([{ id: sheet.id, imageKey: sheet.overviewKey || sheet.imageKey, T: { sx: 1 / f, sy: 1 / f, rot: 0, tx: 0, ty: 0 }, paper: 0.3, line: 1, maxFactor: 1 / f, renderRegion: async (rd, bucket) => ctx.runner.renderSheetRegion(sheet, { x: rd.x / f, y: rd.y / f, w: rd.w / f, h: rd.h / f }, Math.min(1, f * bucket)) }]).then(() => {
      view.fitTo({ minX: 0, minY: 0, width: sheet.widthPx, height: sheet.heightPx });
      if (!st.bar && sheet.scale && sheet.scale.pxA) { st.bar = { a: sheet.scale.pxA, b: sheet.scale.pxB }; st.realMm = sheet.scale.realMm; st.label = sheet.scale.label; st.method = sheet.scale.method; syncInputs(); view.draw(); }
      else if (!st.bar && measurements.length) { const m = measurements[0]; st.bar = { a: { ...m.a }, b: { ...m.b } }; st.realMm = m.value_mm; st.method = m.kind === 'scale_bar' ? 'scale-bar' : 'dimension'; st.label = `${m.kind} ${m.value_text}`; syncInputs(); view.draw(); }
    });
  }

  // ----- reference walls and corrections -----
  if (refLevel) {
    const refWalls = levelWalls(p, refLevel.level);
    const scaled = refWalls.length && refWalls.every((w) => w.scaled);
    let pick = refLevel.referenceWalls;
    if (!pick && scaled) {
      const cand = refWalls.map((w) => ({ ...w, presentOnFloors: levels.filter((l) => matchWall(w, levelWalls(p, l.level), { offset: coarseAlign(refWalls, levelWalls(p, l.level)) })).length, dimensioned: false }));
      const r = pickReferenceWalls(cand, { floorCount: levels.length });
      if (r) pick = r.walls.map((w, i) => ({ wallId: w.id, lengthMm: r.lengths[i], reason: r.reasons[i] }));
      if (pick) set((pr) => (pr.levels.find((l) => l.level === refLevel.level).referenceWalls = pick), 'reference walls');
    }
    const corrRows = [];
    if (pick && scaled) {
      for (const l of levels) {
        if (l.level === refLevel.level) continue;
        const walls = levelWalls(p, l.level);
        if (!walls.length || !walls.every((w) => w.scaled)) { corrRows.push({ cells: [l.level, '—', '—', t('scale.notFound'), ''] }); continue; }
        const off = coarseAlign(refWalls, walls);
        const matched = pick.map((pw) => { const rw = refWalls.find((w) => w.id === pw.wallId); return rw ? matchWall(rw, walls, { offset: off }) : null; });
        const measured = matched.map((m) => (m ? dist(m.wall.a, m.wall.b) : 0));
        const corr = floorCorrection({ refLengths: pick.map((x) => x.lengthMm), measured, noCorrectionPct: p.config.scaleNoCorrectionPct, agreementPct: p.config.scaleAgreementPct });
        const applied = l.scaleCorrection;
        corrRows.push({
          cells: [
            l.level,
            matched.map((m, i) => (m ? `${fmt(measured[i])} mm (${fmt(corr.corrections[i], 2)} %)` : t('scale.notFound'))).join(' · '),
            corr.status === 'applied' ? `${fmt(corr.appliedPct, 2)} % (${t('scale.applied')})` : corr.status === 'none' ? t('scale.noneNeeded') : `${t('scale.flagged')}: ${corr.reason}`,
            applied ? `${applied.status} ${applied.appliedPct != null ? `${fmt(applied.appliedPct, 2)} %` : ''} ${applied.method || ''}` : '–',
            h('span', {}, corr.status !== 'flagged' ? button(t('apply'), () => applyCorrection(ctx, l, corr, matched, refWalls, pick, off)) : null, ' ', button(t('scale.manualAlign'), () => { ctx.alignTarget = { kind: 'level', level: l.level }; ctx.navigate('align'); })),
          ],
        });
      }
    }
    root.append(section(t('scale.referenceWalls'),
      pick ? h('ul', {}, pick.map((w) => h('li', {}, `${w.wallId}: ${fmt(w.lengthMm)} mm — ${w.reason || ''}`))) : h('p', { class: 'muted' }, scaled ? '–' : t('scale.setScale')),
      h('div', { class: 'row' }, button(t('scale.pickOther'), () => { ctx.editorState = { ...(ctx.editorState || {}), level: refLevel.level, pickReference: true }; ctx.navigate('editor'); }), button('↻', () => set((pr) => (pr.levels.find((l) => l.level === refLevel.level).referenceWalls = null)))),
      h('h4', {}, t('scale.correction')),
      table([t('floors.level'), t('scale.lengths'), t('scale.correction'), t('scale.applied'), ''], corrRows)
    ));
  }

  // ----- vertical drawings -----
  const vertRows = p.sheets.filter((s) => s.type === 'vertical').map((s) => {
    const heights = (s.verticalOpenings || []).filter((o) => o.kind === 'door' && s.scale).map((o) => (o.h_px * s.scale.mmPerPx) / 1000);
    const bar = (s.referenceMeasurements || []).find((m) => m.kind === 'scale_bar' && m.value_mm);
    const check = s.scale ? verticalSanity({ doorHeightsM: heights, doorMinM: p.config.doorHeightMinM, doorMaxM: p.config.doorHeightMaxM, scaleBarMmPerPx: bar ? bar.value_mm / dist(bar.a, bar.b) : null, mmPerPx: s.scale.mmPerPx, agreementPct: p.config.scaleAgreementPct }) : null;
    return { cells: [sheetLabel(p, s), s.scale ? `${fmt(s.scale.mmPerPx, 3)} mm/px (${s.scale.label})` : '–', check ? (check.ok ? '✓' : check.flags.map((f) => `${f.type} ${f.valueM ? fmt(f.valueM, 2) : fmt(f.deviationPct, 1)}`).join('; ')) : '–', button(t('scale.manualAlign'), () => { ctx.alignTarget = { kind: 'sheet', sheetId: s.id }; ctx.navigate('align'); })] };
  });
  if (vertRows.length) root.append(section(t('scale.verticalCheck'), table([t('drawings.files'), t('scale.title'), t('scale.verticalCheck'), ''], vertRows)));

  // ----- multi-sheet floors -----
  const multi = levels.map((l) => ({ l, sheets: p.sheets.filter((s) => s.type === 'plan' && s.level === l.level && s.role !== 'ignore') })).filter((x) => x.sheets.length > 1);
  if (multi.length) root.append(section(t('scale.sheetAssembly'), ...multi.map((m) => h('div', {}, h('b', {}, `${m.l.level}: ${m.l.name}`), h('ul', {}, m.sheets.map((s) => h('li', {}, `${sheetLabel(p, s)} (${t(`drawings.roles.${s.role}`)}) `, s.proposedOffset ? `proposed offset ${fmt(s.proposedOffset.dx)}, ${fmt(s.proposedOffset.dy)} px` : '', ' ', button(t('scale.manualAlign'), () => { ctx.alignTarget = { kind: 'sheet', sheetId: s.id }; ctx.navigate('align'); }))))))));
}

function applyCorrection(ctx, level, corr, matched, refWalls, pick, off) {
  const { store } = ctx;
  store.update((pr) => {
    const l = pr.levels.find((x) => x.level === level.level);
    const f = corr.factor;
    // align the matched walls' midpoint centroid to the reference walls' centroid after scaling
    const mids = (ws) => ws.map((w) => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }));
    const mm = mids(matched.map((m) => m.wall));
    const rm = mids(pick.map((pw) => refWalls.find((w) => w.id === pw.wallId)));
    const cm = { x: mm.reduce((s, q) => s + q.x, 0) / mm.length, y: mm.reduce((s, q) => s + q.y, 0) / mm.length };
    const cr = { x: rm.reduce((s, q) => s + q.x, 0) / rm.length, y: rm.reduce((s, q) => s + q.y, 0) / rm.length };
    l.transform = { s: f, rot: 0, tx: cr.x - cm.x * f, ty: cr.y - cm.y * f };
    l.scaleCorrection = { status: corr.status, appliedPct: corr.appliedPct ?? 0, corrections: corr.corrections, method: 'auto', matched: matched.map((m) => (m ? m.wall.id : null)), at: new Date().toISOString() };
  }, { label: 'scale correction' });
  ctx.rerender();
}
