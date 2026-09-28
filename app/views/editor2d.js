// 2D approve and adjust, floor by floor (SPEC 4.5): sheet layers, vector overlay, wall type mapping,
// opening mapping, room mapping, gaps, comments → regional re-read, delete tool, separators, annotations,
// re-read dialog, floor copying.
import { h, clear, numberInput, textInput, select, section, button, table, checkbox, fmt, toast, modal, pickFiles } from '../ui/dom.js';
import { t, ROOM_TYPES } from '../i18n/strings.js';
import { CanvasView } from '../ui/canvasview.js';
import { levelGeometry, sheetToLevel, wallTypeClusters, openingClusters, roomAnchor } from '../state/derive.js';
import { bbox, dist, projectOnSegment, polygonArea, pointInPolygon } from '../engine/geometry.js';
import { ORIGIN, uid, newRoom } from '../state/model.js';
import { sheetLabel } from '../ai/jobs.js';
import { sheetLayer } from './scale.js';
import { copyDialog } from './floors.js';
import { tileSizePx } from '../drawings/tiling.js';

const CLUSTER_COLORS = ['#d62728', '#1f77b4', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2', '#17becf', '#bcbd22', '#7f7f7f'];

export function render(root, ctx) {
  const { store } = ctx;
  const p = store.project;
  clear(root);
  const defaults = { level: null, tool: 'select', panel: 'object', showSlivers: false, layers: { walls: true, rooms: true, openings: true, gaps: true, separators: true, annotations: true }, pending: null, hover: null };
  const st = (ctx.editorState = { ...defaults, ...(ctx.editorState || {}) });
  st.layers = { ...defaults.layers, ...(st.layers || {}) };
  const levels = [...p.levels].sort((a, b) => a.level - b.level);
  if (st.level == null || !levels.some((l) => l.level === st.level)) st.level = levels[0] ? levels[0].level : null;
  const level = st.level;
  const lvl = levels.find((l) => l.level === level);
  if (!lvl) {
    root.append(section(t('editor.title'), h('p', {}, t('drawings.noSheets'))));
    return;
  }
  const g = levelGeometry(p, level);
  const derived = ctx.derived();
  const sheets = p.sheets.filter((s) => s.type === 'plan' && s.level === level && s.role !== 'ignore');
  const unitsLabel = g.scaled ? 'mm' : 'px';
  const set = (fn, label = 'edit') => store.update(fn, { label, meta: { level } });
  const sel = store.state.selection;
  const selectedId = sel.ids && sel.ids.length === 1 ? sel.ids[0] : null;

  // wall thickness clusters across all floors (colour-coded on every plan)
  const allWalls = p.levels.flatMap((l) => (l.level === level ? g.rawWalls : levelGeometryCached(ctx, p, l.level).rawWalls));
  const clusters = wallTypeClusters(allWalls, p.config.wallTypeBandMm ?? 15);
  const clusterOf = new Map();
  clusters.forEach((c) => c.ids.forEach((id) => clusterOf.set(id, c.index)));
  const openingsL = p.openings.filter((o) => !o.deleted && o.level === level);
  const openingMm = (o) => {
    const sh = p.sheets.find((s) => s.id === o.sheetId);
    const tr = sh ? sheetToLevel(sh) : null;
    const mmPerPx = tr && tr.mmPerPx ? tr.mmPerPx : null;
    return { widthMm: o.widthMm != null ? o.widthMm : o.widthPx != null && mmPerPx ? o.widthPx * mmPerPx : null, a: tr && o.aPx ? tr.apply(o.aPx) : null, b: tr && o.bPx ? tr.apply(o.bPx) : null, recessMm: o.recessWidthPx != null && mmPerPx ? o.recessWidthPx * mmPerPx : null };
  };
  const allOpenings = p.openings.filter((o) => !o.deleted).map((o) => ({ ...o, widthMm: openingMm(o).widthMm }));
  const oClusters = openingClusters(allOpenings, p.config.openingBandMm ?? 50);
  const gapsL = p.gaps.filter((x) => x.level === level);
  const gapMm = (gp) => { const sh = p.sheets.find((s) => s.id === gp.sheetId); const tr = sh ? sheetToLevel(sh) : null; return tr ? { a: tr.apply(gp.aPx), b: tr.apply(gp.bPx) } : null; };
  const sepL = p.separators.filter((s) => s.level === level);
  const annL = p.annotations.filter((a) => a.level === level);
  const commentsL = p.comments.filter((c) => c.level === level && !c.sentInReadId);
  const roomOf = (id) => g.faceRooms.find((fr) => fr.record && fr.record.id === id);

  // ---------- layout ----------
  const host = h('div', { class: 'canvas-host editor-canvas' });
  const side = h('div', { class: 'editor-side' });
  const toolbar = h('div', { class: 'editor-toolbar row' });
  root.append(h('div', { class: 'editor-layout' }, h('div', { class: 'editor-main' }, toolbar, host), side));

  const toolBtn = (id, label) => button(label, () => { st.tool = id; st.pending = null; renderToolbar(); view.draw(); }, { class: `btn ${st.tool === id ? 'active' : ''}` });
  function renderToolbar() {
    clear(toolbar);
    toolbar.append(
      h('label', {}, t('editor.level')), select(levels.map((l) => [l.level, `${l.level}: ${l.name}${l.approved ? ' ✓' : ''}`]), level, (v) => { st.level = Number(v); ctx.rerender(); }),
      toolBtn('select', t('editor.select')), toolBtn('delete', t('editor.deleteTool')), toolBtn('separator', t('editor.separatorTool')), toolBtn('annotate-line', t('editor.annotateLine')), toolBtn('annotate-free', t('editor.annotateFree')), toolBtn('annotate-note', t('editor.annotateNote')),
      button(t('undo'), () => store.undo()), button(t('redo'), () => store.redo()),
      button(t('editor.reread'), () => rereadDialog(ctx, level)),
      button(t('floors.copyTo'), () => copyDialog(ctx)),
      button(lvl.approved ? `✓ ${t('floors.approved')}` : t('editor.approve'), () => set((pr) => (pr.levels.find((l) => l.level === level).approved = !lvl.approved), 'approve'), { class: `btn ${lvl.approved ? '' : 'primary'}` }),
      h('span', { class: 'muted small' }, `${t('editor.snapTol')} ${fmt(g.tolMm, 1)} ${unitsLabel} · ${g.dangling.length} ${t('editor.dangling')} · ${derived.sliverInfo[level] ? `${derived.sliverInfo[level].absorbed} slivers` : ''}`)
    );
  }
  renderToolbar();

  // ---------- canvas ----------
  const view = new CanvasView(host, {
    onDraw: (gc, v) => drawOverlay(gc, v),
    onPointer: (ev) => pointer(ev),
    onKey: (e) => { if (e.key === 'Delete' && selectedId) deleteObject(selectedId); if (e.key === 'Escape') { st.pending = null; view.draw(); } },
  });
  ctx.registerCanvas(view);
  // a scale-reference / change-patch / cross-check sheet is drawn only once it has been aligned to the base sheet (placement set) or switched on in the layer panel
  const layers = sheets.map((s) => sheetLayer(ctx, s, { visible: s.visible != null ? s.visible : s.role === 'base' || !!(s.placement && s.placement.at), paper: s.opacity ? s.opacity.paper : 0.6, line: s.opacity ? s.opacity.line : 1, tint: s.role === 'scale-reference' ? '#4070ff' : s.role === 'change-patch' ? '#00a050' : s.role === 'cross-check' ? '#a040a0' : null }));
  const savedView = ctx.editorViews && ctx.editorViews[level];
  view.setLayers(layers).then(() => {
    if (savedView) { view.view = { ...savedView }; view.draw(); }
    else if (g.walls.length) view.fitTo(bbox(g.walls.flatMap((w) => [w.a, w.b])));
    else if (sheets[0]) { const tr = sheetToLevel(sheets[0]); view.fitTo(bbox([tr.apply({ x: 0, y: 0 }), tr.apply({ x: sheets[0].widthPx, y: sheets[0].heightPx })])); }
  });
  const saveView = () => { ctx.editorViews = ctx.editorViews || {}; ctx.editorViews[level] = { ...view.view }; };
  host.addEventListener('pointerup', saveView);
  host.addEventListener('wheel', saveView);

  function drawOverlay(gc, v) {
    const px = (n) => v.px(n);
    // rooms
    if (st.layers.rooms) {
      for (const fr of g.faceRooms) {
        const poly = fr.face.inside;
        const rec = fr.record;
        const isSel = rec && selectedId === rec.id;
        gc.beginPath();
        poly.forEach((pt, i) => (i ? gc.lineTo(pt.x, pt.y) : gc.moveTo(pt.x, pt.y)));
        gc.closePath();
        for (const hole of fr.face.holes) { hole.inside.forEach((pt, i) => (i ? gc.lineTo(pt.x, pt.y) : gc.moveTo(pt.x, pt.y))); gc.closePath(); }
        gc.fillStyle = isSel ? 'rgba(255,200,0,0.35)' : rec && rec.heated === false ? 'rgba(120,120,200,0.18)' : 'rgba(80,200,120,0.12)';
        gc.fill('evenodd');
        if (rec) {
          const c = fr.face.centroid;
          gc.fillStyle = rec.roomTypeConfidence != null && rec.roomTypeConfidence < 0.6 ? '#b00' : '#123';
          gc.font = `${px(13)}px sans-serif`;
          gc.textAlign = 'center';
          gc.fillText(`${rec.id} ${rec.name || ''}`, c.x, c.y);
          gc.fillText(`${t(`roomTypes.${rec.roomType}`)} ${g.scaled ? `${fmt(fr.face.areaM2, 1)} m²` : ''}${rec.heated === false ? ' ✱' : ''}`, c.x, c.y + px(15));
          gc.textAlign = 'left';
        }
      }
    }
    // absorbed slivers
    if (st.showSlivers && derived.sliverInfo[level]) {
      gc.fillStyle = 'rgba(255,0,255,0.5)';
      for (const s of derived.sliverInfo[level].absorbedList) { const poly = s.shape.outer; gc.beginPath(); poly.forEach((pt, i) => (i ? gc.lineTo(pt.x, pt.y) : gc.moveTo(pt.x, pt.y))); gc.closePath(); gc.fill(); }
    }
    // walls
    if (st.layers.walls) {
      for (const w of g.walls) {
        const ci = clusterOf.get(w.id);
        const isSel = selectedId === w.id || (w.mergedFrom && w.mergedFrom.includes(selectedId));
        const isRef = lvl.referenceWalls && lvl.referenceWalls.some((r) => r.wallId === w.id);
        gc.strokeStyle = isSel ? '#ffc000' : ci != null ? CLUSTER_COLORS[ci % CLUSTER_COLORS.length] : '#333';
        gc.globalAlpha = 0.55;
        gc.lineWidth = Math.max(w.thicknessMm || 0, px(2));
        gc.beginPath(); gc.moveTo(w.a.x, w.a.y); gc.lineTo(w.b.x, w.b.y); gc.stroke();
        gc.globalAlpha = 1;
        if (isRef) { gc.strokeStyle = '#e00'; gc.lineWidth = px(2); gc.setLineDash([px(6), px(4)]); gc.beginPath(); gc.moveTo(w.a.x, w.a.y); gc.lineTo(w.b.x, w.b.y); gc.stroke(); gc.setLineDash([]); }
        if (w.raw && w.raw.origin && w.raw.origin !== ORIGIN.machine) { gc.fillStyle = '#e0a000'; gc.beginPath(); gc.arc((w.a.x + w.b.x) / 2, (w.a.y + w.b.y) / 2, px(4), 0, 7); gc.fill(); }
        if (w.raw && w.raw.outsideSpace) { gc.fillStyle = '#0a0'; gc.font = `${px(11)}px sans-serif`; gc.fillText(`${w.raw.outsideSpace.temp} °C`, (w.a.x + w.b.x) / 2, (w.a.y + w.b.y) / 2); }
        if (w.percentUnderground > 0) { gc.fillStyle = '#640'; gc.font = `${px(11)}px sans-serif`; gc.fillText(`${w.percentUnderground} %`, (w.a.x + w.b.x) / 2, (w.a.y + w.b.y) / 2 + px(12)); }
      }
      gc.fillStyle = 'rgba(255,0,0,0.7)';
      for (const d of g.dangling) for (const pt of [d.a, d.b]) { gc.beginPath(); gc.arc(pt.x, pt.y, px(5), 0, 7); gc.fill(); }
    }
    // openings
    if (st.layers.openings) {
      for (const o of openingsL) {
        const m = openingMm(o);
        if (!m.a || !m.b) continue;
        gc.strokeStyle = selectedId === o.id ? '#ffc000' : o.kind === 'window' ? '#1060ff' : '#a05020';
        gc.lineWidth = px(5);
        gc.beginPath(); gc.moveTo(m.a.x, m.a.y); gc.lineTo(m.b.x, m.b.y); gc.stroke();
        if (o.widthIsRecess || o.recessWidthPx) { gc.fillStyle = '#a00'; gc.font = `${px(10)}px sans-serif`; gc.fillText('recess', m.a.x, m.a.y - px(6)); }
      }
    }
    // gaps
    if (st.layers.gaps) {
      for (const gp of gapsL) {
        const m = gapMm(gp);
        if (!m) continue;
        gc.strokeStyle = gp.classification === 'uncertain' ? '#ff8800' : gp.classification === 'opening' ? '#20a020' : '#888';
        gc.lineWidth = px(selectedId === gp.id ? 6 : 3);
        gc.setLineDash([px(4), px(4)]);
        gc.beginPath(); gc.moveTo(m.a.x, m.a.y); gc.lineTo(m.b.x, m.b.y); gc.stroke();
        gc.setLineDash([]);
        if (gp.classification === 'uncertain' && !gp.resolved) { gc.fillStyle = '#ff8800'; gc.font = `${px(12)}px sans-serif`; gc.fillText('?', (m.a.x + m.b.x) / 2, (m.a.y + m.b.y) / 2); }
      }
    }
    // separators
    if (st.layers.separators) {
      gc.strokeStyle = '#d020d0';
      gc.lineWidth = px(2);
      gc.setLineDash([px(8), px(4)]);
      for (const s of sepL) { gc.beginPath(); gc.moveTo(s.a.x, s.a.y); gc.lineTo(s.b.x, s.b.y); gc.stroke(); }
      gc.setLineDash([]);
    }
    // annotations
    if (st.layers.annotations) {
      gc.strokeStyle = '#e00';
      gc.lineWidth = px(2);
      for (const a of annL) {
        if (a.kind === 'note') { gc.fillStyle = '#e00'; gc.font = `${px(13)}px sans-serif`; gc.fillText(`✎ ${a.text}`, a.points[0].x, a.points[0].y); continue; }
        gc.beginPath(); a.points.forEach((pt, i) => (i ? gc.lineTo(pt.x, pt.y) : gc.moveTo(pt.x, pt.y))); gc.stroke();
      }
    }
    // pending tool geometry
    if (st.pending && st.pending.points) { gc.strokeStyle = '#d020d0'; gc.lineWidth = px(2); gc.beginPath(); st.pending.points.forEach((pt, i) => (i ? gc.lineTo(pt.x, pt.y) : gc.moveTo(pt.x, pt.y))); if (st.hover) gc.lineTo(st.hover.x, st.hover.y); gc.stroke(); }
    // comment markers
    for (const c of commentsL) { if (!c.at) continue; gc.fillStyle = '#ff5050'; gc.font = `${px(14)}px sans-serif`; gc.fillText('💬', c.at.x, c.at.y); }
  }

  function hitTest(world, v) {
    const tol = v.px(8);
    for (const o of openingsL) { const m = openingMm(o); if (m.a && m.b && projectOnSegment(world, { a: m.a, b: m.b }).distance < tol) return { type: 'opening', id: o.id }; }
    for (const gp of gapsL) { const m = gapMm(gp); if (m && projectOnSegment(world, m).distance < tol) return { type: 'gap', id: gp.id }; }
    for (const s of sepL) if (projectOnSegment(world, s).distance < tol) return { type: 'separator', id: s.id };
    for (const a of annL) { if (a.kind === 'note') { if (dist(a.points[0], world) < tol * 3) return { type: 'annotation', id: a.id }; continue; } for (let i = 0; i + 1 < a.points.length; i++) if (projectOnSegment(world, { a: a.points[i], b: a.points[i + 1] }).distance < tol) return { type: 'annotation', id: a.id }; }
    let best = null;
    for (const w of g.walls) { const d = projectOnSegment(world, w).distance; const lim = Math.max(tol, (w.thicknessMm || 0) / 2); if (d < lim && (!best || d < best.d)) best = { d, w }; }
    if (best) return { type: 'wall', id: best.w.mergedFrom ? best.w.mergedFrom[0] : best.w.id, wall: best.w };
    for (const fr of g.faceRooms) if (fr.record && pointInPolygon(world, fr.face.inside)) return { type: 'room', id: fr.record.id };
    return null;
  }

  function pointer(ev) {
    if (ev.type === 'move') { st.hover = ev.world; if (st.pending) view.draw(); return false; }
    if (st.tool === 'annotate-free') {
      if (ev.type === 'down') { st.pending = { points: [ev.world] }; return true; }
      if (ev.type === 'drag') { st.pending.points.push(ev.world); view.draw(); return true; }
      if (ev.type === 'up') { if (st.pending && st.pending.points.length > 2) set((pr) => pr.annotations.push({ id: uid('an'), level, kind: 'free', points: st.pending.points }), 'annotation'); st.pending = null; return true; }
      return false;
    }
    if (ev.type !== 'click') return false;
    if (st.tool === 'select') {
      const hit = hitTest(ev.world, ev.view);
      if (st.pickReference && hit && hit.type === 'wall') { pickReferenceWall(hit); return false; }
      store.setSelection({ ids: hit ? [hit.id] : [], level });
      return false;
    }
    if (st.tool === 'delete') { const hit = hitTest(ev.world, ev.view); if (hit) deleteObject(hit.id, hit.type); return false; }
    if (st.tool === 'separator' || st.tool === 'annotate-line') {
      if (!st.pending) { st.pending = { points: [ev.world] }; view.draw(); return false; }
      const a = st.pending.points[0];
      const b = ev.world;
      st.pending = null;
      if (st.tool === 'separator') set((pr) => { pr.separators.push({ id: uid('sep'), level, a, b }); syncRoomsAfterSplit(pr, level); }, 'separator');
      else set((pr) => pr.annotations.push({ id: uid('an'), level, kind: 'line', points: [a, b] }), 'annotation');
      return false;
    }
    if (st.tool === 'annotate-note') {
      const text = prompt(t('editor.annotateNote'));
      if (text) set((pr) => pr.annotations.push({ id: uid('an'), level, kind: 'note', points: [ev.world], text }), 'annotation');
      return false;
    }
    return false;
  }
  function pickReferenceWall(hit) {
    set((pr) => { const l = pr.levels.find((x) => x.level === level); l.referenceWalls = l.referenceWalls || []; if (l.referenceWalls.length >= 2) l.referenceWalls = []; const w = hit.wall; l.referenceWalls.push({ wallId: hit.id, lengthMm: dist(w.a, w.b), reason: t('editor.origins.user') }); if (l.referenceWalls.length === 2) st.pickReference = false; }, 'reference walls');
  }
  function deleteObject(id, type) {
    set((pr) => {
      const w = pr.walls.find((x) => x.id === id);
      if (w) { w.deleted = true; w.origin = ORIGIN.user; }
      const o = pr.openings.find((x) => x.id === id);
      if (o) { o.deleted = true; o.origin = ORIGIN.user; }
      pr.separators = pr.separators.filter((x) => x.id !== id);
      pr.annotations = pr.annotations.filter((x) => x.id !== id);
      pr.gaps = pr.gaps.filter((x) => x.id !== id);
      syncRoomsAfterSplit(pr, level);
    }, 'delete');
    store.setSelection({ ids: [] });
  }
  function syncRoomsAfterSplit(pr, lv) {
    // rooms for new faces (SPEC 3.2: the largest resulting room keeps the number)
    const before = pr.rooms.filter((r) => r.level === lv).map((r) => ({ id: r.id, anchor: roomAnchor(pr, r) }));
    const gg = levelGeometry(pr, lv);
    let maxIndex = pr.rooms.filter((r) => r.level === lv).reduce((m, r) => Math.max(m, r.index), 0);
    for (const fr of gg.faceRooms) {
      if (fr.record) continue;
      // descendants of a split room: the previous room whose old polygon contained this face's centroid
      const parent = pr.rooms.find((r) => r.level === lv && r.lastPolygon && pointInPolygon(fr.face.centroid, r.lastPolygon));
      const rec = newRoom(lv, ++maxIndex, { anchor: fr.face.centroid, origin: ORIGIN.user, name: parent ? parent.name : '', roomType: parent ? parent.roomType : 'other', heated: parent ? parent.heated : true, ventilationLs: parent ? parent.ventilationLs : null, flaggedReview: !!parent, splitFrom: parent ? parent.id : null });
      pr.rooms.push(rec);
      fr.record = rec;
      if (parent) {
        parent.flaggedReview = true;
        const parentFace = gg.faceRooms.find((x) => x.record === parent);
        if (parentFace && parentFace.face.areaM2 < fr.face.areaM2) {
          // swap identities so the largest keeps the number
          const pid = parent.id; const pidx = parent.index; const panchor = parent.anchor; const panchorPx = parent.anchorPx;
          parent.id = rec.id; parent.index = rec.index; parent.anchor = rec.anchor; parent.anchorPx = null;
          rec.id = pid; rec.index = pidx; rec.anchor = panchor; rec.anchorPx = panchorPx;
        }
      }
    }
    for (const fr of gg.faceRooms) if (fr.record) fr.record.lastPolygon = fr.face.centerline;
  }
  // remember polygons for future split detection
  for (const fr of g.faceRooms) if (fr.record && !fr.record.lastPolygon) fr.record.lastPolygon = fr.face.centerline;

  // ---------- side panels ----------
  const panelBtn = (id, label) => button(label, () => { st.panel = id; renderSide(); }, { class: `btn small ${st.panel === id ? 'active' : ''}` });
  function renderSide() {
    clear(side);
    side.append(h('div', { class: 'row wrap' }, panelBtn('object', t('editor.select')), panelBtn('walls', t('editor.wallTypes')), panelBtn('openings', t('editor.openingTypes')), panelBtn('rooms', t('editor.rooms')), panelBtn('gaps', t('editor.gaps')), panelBtn('comments', t('editor.comments')), panelBtn('layers', t('editor.layers')), panelBtn('info', 'ℹ')));
    const body = h('div', { class: 'panel-body' });
    side.append(body);
    if (st.panel === 'object') body.append(objectPanel());
    else if (st.panel === 'walls') body.append(wallsPanel());
    else if (st.panel === 'openings') body.append(openingsPanel());
    else if (st.panel === 'rooms') body.append(roomsPanel());
    else if (st.panel === 'gaps') body.append(gapsPanel());
    else if (st.panel === 'comments') body.append(commentsPanel());
    else if (st.panel === 'layers') body.append(layersPanel());
    else body.append(infoPanel());
  }
  function originLabel(o) { return t(`editor.origins.${o || 'machine'}`); }
  function commentBox(targetId, at) {
    let text = '';
    return h('div', { class: 'comment-box' }, h('label', {}, t('editor.comment')), h('textarea', { rows: 2, placeholder: t('editor.commentPlaceholder'), onInput: (e) => (text = e.target.value) }), button(t('add'), () => { if (!text.trim()) return; set((pr) => pr.comments.push({ id: uid('c'), level, targetId, at, text: text.trim(), createdAt: new Date().toISOString() }), 'comment'); }));
  }
  function objectPanel() {
    if (!selectedId) return h('p', { class: 'muted' }, t('editor.select'));
    const w = p.walls.find((x) => x.id === selectedId);
    if (w) {
      const gw = g.walls.find((x) => x.id === w.id || (x.mergedFrom && x.mergedFrom.includes(w.id)));
      const wt = p.library.wallTypes;
      return h('div', {}, h('h4', {}, `${t('audit.wall')} ${w.id}`),
        h('div', {}, `${t('editor.measured')}: ${w.thicknessPx != null ? `${fmt(w.thicknessPx, 1)} px` : ''} ${gw ? `= ${fmt(gw.thicknessMm)} ${unitsLabel}` : ''} · ${t('editor.origin')}: ${originLabel(w.origin)} · ${t('editor.confidence')}: ${w.confidence != null ? fmt(w.confidence, 2) : '–'}`),
        h('div', { class: 'muted small' }, w.reasoning || ''),
        h('div', { class: 'row' }, h('label', {}, t('editor.wallTypes')), select([[null, '–'], ...wt.map((x) => [x.id, x.name])], w.wallTypeId, (v) => set((pr) => (pr.walls.find((x) => x.id === w.id).wallTypeId = v), 'wall type'))),
        h('div', { class: 'row' }, h('label', {}, t('editor.underground')), numberInput(w.percentUnderground, (v) => set((pr) => { const x = pr.walls.find((y) => y.id === w.id); x.percentUnderground = v || 0; x.origin = ORIGIN.user; }, 'underground'), { min: 0, max: 100 })),
        h('div', { class: 'row' }, checkbox(!!w.outsideSpace, (v) => set((pr) => { const x = pr.walls.find((y) => y.id === w.id); x.outsideSpace = v ? { temp: pr.config.indoorSetpoint } : null; x.origin = ORIGIN.user; }, 'outside space'), t('editor.outsideSpace')), w.outsideSpace ? numberInput(w.outsideSpace.temp, (v) => set((pr) => (pr.walls.find((y) => y.id === w.id).outsideSpace.temp = v), 'outside space')) : null),
        button(t('delete'), () => deleteObject(w.id)),
        commentBox(w.id, gw ? { x: (gw.a.x + gw.b.x) / 2, y: (gw.a.y + gw.b.y) / 2 } : null));
    }
    const o = p.openings.find((x) => x.id === selectedId);
    if (o) {
      const m = openingMm(o);
      return h('div', {}, h('h4', {}, `${t(`audit.${o.kind}`)} ${o.id}`),
        h('div', {}, `${t('editor.width')}: ${m.widthMm != null ? fmt(m.widthMm) : '–'} ${unitsLabel}${m.recessMm ? ` (recess ${fmt(m.recessMm)}, upper bound)` : ''} · ${t('editor.height')}: ${o.heightMm != null ? fmt(o.heightMm) : '–'} mm (${o.heightConfidence || '–'}) · ${t('editor.sill')}: ${o.sillMm != null ? fmt(o.sillMm) : '900 (default)'}`),
        h('div', { class: 'muted small' }, `${t('editor.source')}: ${o.source || '–'} · ${t('editor.origin')}: ${originLabel(o.origin)} · ${o.reasoning || ''}`),
        h('div', { class: 'row' }, h('label', {}, t('editor.width')), numberInput(o.widthMm, (v) => set((pr) => { const x = pr.openings.find((y) => y.id === o.id); x.widthMm = v; x.origin = ORIGIN.user; }, 'opening'), { placeholder: m.widthMm != null ? fmt(m.widthMm) : '' }), h('label', {}, t('editor.height')), numberInput(o.heightMm, (v) => set((pr) => { const x = pr.openings.find((y) => y.id === o.id); x.heightMm = v; x.heightConfidence = 'HIGH'; x.source = t('editor.origins.user'); x.origin = ORIGIN.user; }, 'opening'))),
        h('div', { class: 'row' }, h('label', {}, t('editor.openingTypes')), select([[null, '(default)'], ...p.library.openingTypes.filter((x) => x.kind === o.kind).map((x) => [x.id, x.name])], o.openingTypeId, (v) => set((pr) => (pr.openings.find((x) => x.id === o.id).openingTypeId = v), 'opening type'))),
        o.verticalLink ? button(t('editor.jumpVertical'), () => showVertical(ctx, o.verticalLink)) : null, ' ', button(t('delete'), () => deleteObject(o.id)),
        commentBox(o.id, m.a));
    }
    const r = p.rooms.find((x) => x.id === selectedId);
    if (r) {
      const fr = roomOf(r.id);
      return h('div', {}, h('h4', {}, `${t('audit.room')} ${r.id}`),
        h('div', { class: 'muted small' }, `${t('editor.origin')}: ${originLabel(r.origin)} · ${t('editor.confidence')}: ${r.roomTypeConfidence != null ? fmt(r.roomTypeConfidence, 2) : '–'} · ${r.reasoning || ''}${r.flaggedReview ? ` · ${t('editor.flaggedReview')}` : ''}${r.apartment ? ` · ${r.apartment}` : ''}${r.printedAreaM2 ? ` · ${t('editor.printed')} ${r.printedAreaM2} m²` : ''}`),
        h('div', { class: 'row' }, h('label', {}, t('editor.name')), textInput(r.name, (v) => set((pr) => { const x = pr.rooms.find((y) => y.id === r.id); x.name = v; x.userEdited = true; x.origin = ORIGIN.user; }, 'room'))),
        h('div', { class: 'row' }, h('label', {}, t('editor.roomType')), select(ROOM_TYPES.map((x) => [x, t(`roomTypes.${x}`)]), r.roomType, (v) => set((pr) => { const x = pr.rooms.find((y) => y.id === r.id); x.roomType = v; x.userEdited = true; x.origin = ORIGIN.user; }, 'room'))),
        h('div', { class: 'row' }, checkbox(r.heated, (v) => set((pr) => { const x = pr.rooms.find((y) => y.id === r.id); x.heated = v; x.userEdited = true; }, 'room'), t('editor.heated'))),
        fr ? h('div', {}, `${fmt(fr.face.areaM2, 2)} m²`) : null,
        commentBox(r.id, fr ? fr.face.centroid : null));
    }
    const gp = p.gaps.find((x) => x.id === selectedId);
    if (gp) return h('div', {}, h('h4', {}, `${t('editor.resolveGap')} ${gp.id}`), h('div', { class: 'muted small' }, gp.reasoning), h('div', { class: 'row' }, select([['opening', t('editor.gapOpening')], ['artifact', t('editor.gapArtifact')], ['uncertain', t('editor.gapUncertain')]], gp.classification, (v) => set((pr) => { const x = pr.gaps.find((y) => y.id === gp.id); x.classification = v; x.resolved = v !== 'uncertain'; x.origin = ORIGIN.user; }, 'gap'))), commentBox(gp.id, gapMm(gp) ? gapMm(gp).a : null));
    const sp = p.separators.find((x) => x.id === selectedId);
    if (sp) return h('div', {}, h('h4', {}, t('editor.separators')), button(t('delete'), () => deleteObject(sp.id)));
    const an = p.annotations.find((x) => x.id === selectedId);
    if (an) return h('div', {}, h('h4', {}, t('editor.annotations')), h('div', {}, an.text || an.kind), button(t('delete'), () => deleteObject(an.id)));
    return h('p', { class: 'muted' }, selectedId);
  }
  function wallsPanel() {
    const band = p.config.wallTypeBandMm ?? 15;
    const rows = clusters.map((c) => ({ cells: [h('span', { style: { background: CLUSTER_COLORS[c.index % CLUSTER_COLORS.length], display: 'inline-block', width: '14px', height: '14px' } }), `${fmt(c.min)}–${fmt(c.max)} (${fmt(c.mean)}) ${unitsLabel}`, c.ids.length, select([[null, '–'], ...p.library.wallTypes.map((x) => [x.id, x.name])], commonType(c.ids.map((id) => p.walls.find((w) => w.id === id)).filter(Boolean).map((w) => w.wallTypeId)), (v) => set((pr) => pr.walls.forEach((w) => { if (c.ids.includes(w.id)) w.wallTypeId = v; }), 'wall types'))] }));
    return h('div', {}, h('div', { class: 'row' }, h('label', {}, t('editor.thicknessBand')), h('input', { type: 'range', min: 0, max: 50, step: 1, value: band, onInput: (e) => { st.bandPreview = Number(e.target.value); }, onChange: (e) => set((pr) => (pr.config.wallTypeBandMm = Number(e.target.value)), 'band') }), h('span', {}, `±${band} mm`)), table(['', t('editor.measured'), '#', t('editor.assignTo')], rows));
  }
  function openingsPanel() {
    const band = p.config.openingBandMm ?? 50;
    const rows = oClusters.map((c) => {
      const ops = c.ids.map((id) => p.openings.find((o) => o.id === id)).filter(Boolean);
      const conf = ops.map((o) => o.heightConfidence).filter(Boolean);
      return { cells: [t(`audit.${c.kind}`), `${fmt(c.w)} × ${c.h >= 0 ? fmt(c.h) : '?'} mm`, `${c.ids.length} (${conf.join(',').slice(0, 30) || '–'})`, select([[null, '(default)'], ...p.library.openingTypes.filter((x) => x.kind === c.kind).map((x) => [x.id, x.name])], commonType(ops.map((o) => o.openingTypeId)), (v) => set((pr) => pr.openings.forEach((o) => { if (c.ids.includes(o.id)) o.openingTypeId = v; }), 'opening types')), numberInput(c.h >= 0 ? c.h : null, (v) => set((pr) => pr.openings.forEach((o) => { if (c.ids.includes(o.id)) { o.heightMm = v; o.heightConfidence = o.heightConfidence || 'LOW'; o.source = o.source || t('editor.origins.user'); } }), 'opening heights'), { width: '5em', placeholder: 'mm' })] };
    });
    return h('div', {}, h('div', { class: 'row' }, h('label', {}, t('editor.thicknessBand')), h('input', { type: 'range', min: 0, max: 200, step: 5, value: band, onChange: (e) => set((pr) => (pr.config.openingBandMm = Number(e.target.value)), 'band') }), h('span', {}, `±${band} mm`)), table(['', t('editor.width') + ' × ' + t('editor.height'), '#', t('editor.assignTo'), t('editor.doorHeightGroup')], rows));
  }
  function roomsPanel() {
    const rows = g.faceRooms.filter((fr) => fr.record).map((fr) => { const r = fr.record; return { attrs: { class: selectedId === r.id ? 'selected' : '', onClick: () => store.setSelection({ ids: [r.id], level }) }, cells: [r.id, r.name, t(`roomTypes.${r.roomType}`), r.roomTypeConfidence != null ? fmt(r.roomTypeConfidence, 2) : '', fmt(fr.face.areaM2, 1), r.heated ? '' : '✱'] }; });
    // apartment check (SPEC 4.5)
    const apts = {};
    for (const fr of g.faceRooms) if (fr.record && fr.record.apartment) { const a = apts[fr.record.apartment] = apts[fr.record.apartment] || { sum: 0, printed: null }; a.sum += fr.face.areaM2; if (fr.record.printedAreaM2) a.printed = fr.record.printedAreaM2; }
    const aptRows = Object.entries(apts).map(([k, v]) => ({ cells: [k, fmt(v.sum, 1), v.printed != null ? fmt(v.printed, 1) : '–'] }));
    return h('div', {}, table([t('audit.room'), t('editor.name'), t('editor.roomType'), t('editor.confidence'), t('audit.area'), ''], rows), g.orphanRecords.length ? h('p', { class: 'warn' }, `orphan records: ${g.orphanRecords.map((r) => r.id).join(', ')}`) : null, aptRows.length ? h('div', {}, h('h4', {}, t('editor.apartmentCheck')), table(['', t('editor.areaSum'), t('editor.printed')], aptRows)) : null);
  }
  function gapsPanel() {
    const rows = gapsL.map((gp) => ({ attrs: { class: selectedId === gp.id ? 'selected' : '', onClick: () => store.setSelection({ ids: [gp.id], level }) }, cells: [gp.id, gp.classification, gp.resolved ? '✓' : '?', h('span', { class: 'small' }, gp.reasoning)] }));
    return table(['id', '', '', t('editor.reasoning')], rows);
  }
  function commentsPanel() {
    const rows = commentsL.map((c) => ({ cells: [c.targetId || '(region)', c.text, button('×', () => set((pr) => (pr.comments = pr.comments.filter((x) => x.id !== c.id)), 'comment'))] }));
    return h('div', {}, table(['', t('editor.comment'), ''], rows), h('p', { class: 'muted small' }, `${annL.length} ${t('editor.annotations')}`), button(t('editor.sendComments'), () => sendComments(ctx, level, commentsL, annL), { class: 'btn primary', disabled: !commentsL.length && !annL.length }));
  }
  function layersPanel() {
    return h('div', {}, ...sheets.map((s) => h('div', { class: 'layer-row' }, checkbox(s.visible != null ? s.visible : s.role === 'base' || !!(s.placement && s.placement.at), (v) => { set((pr) => (pr.sheets.find((x) => x.id === s.id).visible = v), 'layer'); const l = view.layers.find((x) => x.id === s.id); if (l) { l.visible = v; view.draw(); } }, ''), h('b', {}, `${sheetLabel(p, s)} (${t(`drawings.roles.${s.role}`)})`), h('div', { class: 'row' }, h('label', {}, t('editor.paper')), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.opacity.paper, onInput: (e) => { const l = view.layers.find((x) => x.id === s.id); if (l) { l.paper = Number(e.target.value); view.draw(); } }, onChange: (e) => store.update((pr) => (pr.sheets.find((x) => x.id === s.id).opacity.paper = Number(e.target.value)), { undoable: false }) }), h('label', {}, t('editor.lines')), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.opacity.line, onInput: (e) => { const l = view.layers.find((x) => x.id === s.id); if (l) { l.line = Number(e.target.value); view.draw(); } }, onChange: (e) => store.update((pr) => (pr.sheets.find((x) => x.id === s.id).opacity.line = Number(e.target.value)), { undoable: false }) })))),
      h('h4', {}, t('editor.overlay')), ...Object.keys(st.layers).map((k) => checkbox(st.layers[k], (v) => { st.layers[k] = v; view.draw(); }, t(`editor.${k}`))), checkbox(st.showSlivers, (v) => { st.showSlivers = v; view.draw(); }, t('editor.highlightSlivers')));
  }
  function infoPanel() {
    return h('div', {}, h('div', {}, `${t('editor.snapTol')}: ${fmt(g.tolMm, 1)} ${unitsLabel}`), h('h4', {}, t('editor.cleanupLog')), h('ul', { class: 'small' }, g.cleanupLog.slice(0, 200).map((l) => h('li', {}, `${l.type} ${l.wall || (l.walls && l.walls.join('+')) || ''} ${l.end || ''} ${l.kind || ''} ${l.distance != null ? fmt(l.distance, 1) : l.length != null ? fmt(l.length, 1) : ''}`))), lvl.rereadUnmatched && lvl.rereadUnmatched.length ? h('div', {}, h('h4', {}, t('editor.rereadDialog.unmatched')), h('ul', {}, lvl.rereadUnmatched.map((u) => h('li', {}, `${u.type} ${u.id}`)))) : null, lvl.copyDiff ? h('div', {}, h('h4', {}, t('floors.copyDiff')), h('ul', {}, lvl.copyDiff.map((d) => h('li', {}, d)))) : null);
  }
  renderSide();
}
function commonType(ids) {
  const s = new Set(ids);
  return s.size === 1 ? [...s][0] : null;
}
const geomCache = new WeakMap();
function levelGeometryCached(ctx, p, level) {
  let m = geomCache.get(p);
  if (!m) { m = new Map(); geomCache.set(p, m); }
  const key = `${level}:${ctx.store.version}`;
  if (!m.has(key)) m.set(key, levelGeometry(p, level));
  return m.get(key);
}

// Comments and annotations → regional re-read (Haiku by default), batched per floor.
async function sendComments(ctx, level, comments, annotations) {
  const { store } = ctx;
  const p = store.project;
  const sheet = p.sheets.find((s) => s.type === 'plan' && s.level === level && s.role === 'base') || p.sheets.find((s) => s.type === 'plan' && s.level === level);
  if (!sheet) return;
  const tr = sheetToLevel(sheet);
  const inv = invertTr(tr.T);
  const pts = [];
  for (const c of comments) if (c.at) pts.push(inv(c.at));
  for (const a of annotations) for (const q of a.points) pts.push(inv(q));
  const g = levelGeometry(p, level);
  for (const c of comments) { const w = g.walls.find((x) => x.id === c.targetId || (x.mergedFrom && x.mergedFrom.includes(c.targetId))); if (w) { pts.push(inv(w.a)); pts.push(inv(w.b)); } }
  if (!pts.length) { for (const w of g.walls.slice(0, 50)) { pts.push(inv(w.a)); pts.push(inv(w.b)); } }
  const bb = bbox(pts);
  const marginPx = tr.mmPerPx ? 2000 / tr.mmPerPx : 200;
  const maxPx = tileSizePx(p.config.ai);
  let region = { x: Math.max(0, bb.minX - marginPx), y: Math.max(0, bb.minY - marginPx), w: bb.width + 2 * marginPx, h: bb.height + 2 * marginPx };
  if (region.w > maxPx || region.h > maxPx) {
    const cx = region.x + region.w / 2;
    const cy = region.y + region.h / 2;
    region = { x: Math.max(0, cx - maxPx / 2), y: Math.max(0, cy - maxPx / 2), w: Math.min(maxPx, region.w), h: Math.min(maxPx, region.h) };
  }
  region = { x: Math.round(region.x), y: Math.round(region.y), w: Math.round(Math.min(region.w, sheet.widthPx - region.x)), h: Math.round(Math.min(region.h, sheet.heightPx - region.y)) };
  const inRegion = (pt) => pt && pt.x >= region.x && pt.x <= region.x + region.w && pt.y >= region.y && pt.y <= region.y + region.h;
  const current = {
    walls: p.walls.filter((w) => w.level === level && !w.deleted && (inRegion(w.aPx) || inRegion(w.bPx))),
    rooms: p.rooms.filter((r) => r.level === level && inRegion(r.anchorPx)),
    openings: p.openings.filter((o) => o.level === level && !o.deleted && inRegion(o.aPx)),
    gaps: p.gaps.filter((x) => x.level === level && inRegion(x.aPx)),
    annotations: annotations.map((a) => ({ kind: a.kind, text: a.text || '', points: a.points.map((q) => { const s = inv(q); return { x: s.x - region.x, y: s.y - region.y }; }) })),
  };
  const texts = [...comments.map((c) => `${c.targetId ? `[${c.targetId}] ` : ''}${c.text}`), ...annotations.filter((a) => a.kind === 'note').map((a) => `[annotation] ${a.text}`)];
  try {
    ctx.setBusy(t('drawings.reading'));
    const { readId, data } = await ctx.runner.regionalReread(level, region, sheet, texts, current);
    const touched = ctx.runner.applyRegionalResult(level, sheet, region, data, readId);
    store.update((pr) => { for (const c of comments) { const x = pr.comments.find((y) => y.id === c.id); if (x) x.sentInReadId = readId; } }, { undoable: false });
    toast(`${touched.length} ${t('editor.changed')}`);
  } catch (e) {
    toast(String(e.message || e), 'error');
  } finally {
    ctx.setBusy(null);
    ctx.rerender();
  }
}
function invertTr(T) {
  const sx = T.sx ?? T.s ?? 1;
  const sy = T.sy ?? T.s ?? 1;
  const c = Math.cos(-(T.rot || 0));
  const s = Math.sin(-(T.rot || 0));
  return (p) => { const x = p.x - (T.tx || 0); const y = p.y - (T.ty || 0); return { x: (c * x - s * y) / sx, y: (s * x + c * y) / sy }; };
}

// Re-read / new underlay dialog (SPEC 4.5).
function rereadDialog(ctx, level) {
  const { store } = ctx;
  let choice = 'keep';
  let file = null;
  const body = h('div', {},
    h('label', { class: 'cb' }, h('input', { type: 'radio', name: 'rr', value: 'swap', onChange: () => (choice = 'swap') }), ' ', t('editor.rereadDialog.swap')),
    h('label', { class: 'cb' }, h('input', { type: 'radio', name: 'rr', value: 'keep', checked: true, onChange: () => (choice = 'keep') }), ' ', t('editor.rereadDialog.keep')),
    h('label', { class: 'cb' }, h('input', { type: 'radio', name: 'rr', value: 'discard', onChange: () => (choice = 'discard') }), ' ', t('editor.rereadDialog.discard')),
    h('div', { class: 'row' }, h('label', {}, t('editor.rereadDialog.file')), h('input', { type: 'file', accept: '.pdf,.tif,.tiff,.png,.jpg', onChange: (e) => (file = e.target.files[0]) }))
  );
  modal(t('editor.rereadDialog.title'), body, {
    buttons: [{ label: t('cancel') }, { label: t('ok'), primary: true, onClick: async () => {
      try {
        ctx.setBusy(t('drawings.reading'));
        if (file) await ctx.swapUnderlay(level, file, choice === 'swap');
        if (choice !== 'swap') await ctx.runner.fullFloorReread(level, { keepEdits: choice === 'keep' });
      } catch (e) { toast(String(e.message || e), 'error'); } finally { ctx.setBusy(null); ctx.rerender(); }
    } }],
  });
}

export function showVertical(ctx, link) {
  const p = ctx.store.project;
  const sheet = p.sheets.find((s) => s.id === link.sheet_id);
  if (!sheet) return;
  const host = h('div', { class: 'canvas-host', style: { height: '500px', width: '80vw' } });
  const m = modal(t('editor.jumpVertical'), host, { buttons: [{ label: t('close') }] });
  const f = sheet.overviewFactor || 1;
  const view = new CanvasView(host, { onDraw: (g, v) => { g.strokeStyle = '#e00'; g.lineWidth = v.px(3); g.strokeRect(link.x, link.y, link.w, link.h); } });
  view.setLayers([{ id: sheet.id, imageKey: sheet.overviewKey || sheet.imageKey, T: { sx: 1 / f, sy: 1 / f, rot: 0, tx: 0, ty: 0 }, paper: 0.3, line: 1, maxFactor: 1 / f, renderRegion: async (rd, bucket) => ctx.runner.renderSheetRegion(sheet, { x: rd.x / f, y: rd.y / f, w: rd.w / f, h: rd.h / f }, Math.min(1, f * bucket)) }]).then(() => view.fitTo({ minX: link.x - link.w, minY: link.y - link.h, width: link.w * 3, height: link.h * 3 }));
}
