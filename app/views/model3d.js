// 3D model (SPEC 4.9, 4.10): generated from the approved 2D data plus stacking; walls extruded with
// openings cut, floor/ceiling pieces and slab zones with display thickness, translucent room boxes with an
// orb as click handle. Every drawn element carries the ids of the calculation surfaces it represents, and the
// selected room's colour coding uses exactly those ids (the same ids as the rows in the room panel).
import { h, clear, button, numberInput, checkbox } from '../ui/dom.js';
import { t } from '../i18n/strings.js';
import { levelToBuilding } from '../state/derive.js';
import { dist, sub, projectOnSegment, roomSlabShapes } from '../engine/geometry.js';
import { roomPanel, SURFACE_COLORS } from './audit.js';

let threePromise = null;
let OrbitControls = null;
function three() {
  // one shared import: a second build while the first import is still pending must not see a half-loaded module
  if (!threePromise) {
    threePromise = (async () => {
      const T = await import('../../vendor/three/three.module.js');
      OrbitControls = (await import('../../vendor/three/OrbitControls.js')).OrbitControls;
      return T;
    })();
  }
  return threePromise;
}

function normalizeState(ctx) {
  const st = ctx.threeState || (ctx.threeState = {});
  if (st.slabMm == null) st.slabMm = 200;
  if (st.levelFilter === undefined) st.levelFilter = null; // null = all floors, else an array of level numbers
  if (typeof st.levelFilter === 'number') st.levelFilter = [st.levelFilter];
  if (st.camera === undefined) st.camera = null;
  return st;
}

// Floor filter: a dropdown with one checkbox per floor. It only toggles visibility in the existing scene.
function floorFilter(ctx, levels) {
  const st = ctx.threeState;
  const summary = h('summary', {});
  const shown = () => (st.levelFilter == null ? levels.map((l) => l.level) : st.levelFilter);
  const label = () => {
    const s = shown();
    const txt = st.levelFilter == null ? t('model3d.allFloors') : s.length === 0 ? t('model3d.noFloors') : [...s].sort((a, b) => a - b).join(', ');
    summary.textContent = `${t('model3d.floorFilter')}: ${txt} ▾`;
  };
  const apply = () => { label(); if (st.applyFilter) st.applyFilter(); };
  const setLevels = (arr) => { st.levelFilter = arr.length === levels.length ? null : arr; apply(); };
  const boxes = [];
  const all = checkbox(st.levelFilter == null, (v) => { setLevels(v ? levels.map((l) => l.level) : []); for (const b of boxes) b.input.checked = v; }, t('model3d.allFloors'));
  for (const l of levels) {
    const cb = checkbox(shown().includes(l.level), (v) => {
      const cur = new Set(shown());
      if (v) cur.add(l.level); else cur.delete(l.level);
      setLevels([...cur]);
      all.querySelector('input').checked = st.levelFilter == null;
    }, `${l.level}: ${l.name}`);
    boxes.push({ level: l.level, input: cb.querySelector('input') });
  }
  const menu = h('div', { class: 'menu' }, all, ...boxes.map((b) => b.input.closest('label')));
  const details = h('details', { class: 'dropdown' }, summary, menu);
  label();
  // close when clicking elsewhere
  const onDoc = (e) => { if (!details.isConnected) { document.removeEventListener('pointerdown', onDoc); return; } if (!details.contains(e.target)) details.open = false; };
  document.addEventListener('pointerdown', onDoc);
  return details;
}

export function render(root, ctx) {
  const { store } = ctx;
  const p = store.project;
  clear(root);
  const host = h('div', { class: 'canvas-host', style: { height: '70vh' } });
  const side = h('div', { class: 'audit-side' });
  const st = normalizeState(ctx);
  const levels = [...p.levels].sort((a, b) => a.level - b.level);
  root.append(h('div', { class: 'editor-layout' }, h('div', { class: 'editor-main' }, h('div', { class: 'row' }, button(t('model3d.regenerate'), () => { st.camera = null; ctx.rerender(); }), floorFilter(ctx, levels), h('label', {}, t('model3d.slabThickness')), numberInput(st.slabMm, (v) => { st.slabMm = v; ctx.rerender(); }), h('span', { class: 'muted' }, t('model3d.legend'))), host), side));
  const sel = store.state.selection;
  if (sel.ids && sel.ids.length === 1 && p.rooms.some((r) => r.id === sel.ids[0])) side.append(roomPanel(sel.ids[0], ctx, { colorRows: true }));
  build(host, ctx).catch((e) => { console.error(e); host.append(h('p', { class: 'warn' }, String(e.message || e))); });
}

async function build(host, ctx) {
  const T = await three();
  const { store } = ctx;
  const p = store.project;
  const d = ctx.derived();
  const st = normalizeState(ctx);
  const sel = store.state.selection;
  const selectedRoom = sel.ids && sel.ids.length === 1 && p.rooms.some((r) => r.id === sel.ids[0]) ? sel.ids[0] : null;
  const slabT = (st.slabMm || 200) / 1000;
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  const r = host.getBoundingClientRect();
  renderer.setSize(r.width, r.height);
  host.append(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0xf3f4f6);
  const camera = new T.PerspectiveCamera(50, r.width / r.height, 0.1, 2000);
  scene.add(new T.AmbientLight(0xffffff, 0.7));
  const sun = new T.DirectionalLight(0xffffff, 0.8);
  sun.position.set(50, 80, 30);
  scene.add(sun);
  const controls = new OrbitControls(camera, renderer.domElement);
  // colour per surface id of the selected room: the same ids, in the same order, as the rows of the room panel
  const rowColors = {};
  if (selectedRoom && d.results && d.results.rooms[selectedRoom]) d.results.rooms[selectedRoom].rows.forEach((row, i) => { if (row.kind === 'transmission') rowColors[row.surfaceId] = SURFACE_COLORS[i % SURFACE_COLORS.length]; });
  const colorFor = (ids) => { for (const id of ids) if (rowColors[id] != null) return rowColors[id]; return null; };
  const orbs = [];
  const levels = [...p.levels].sort((a, b) => a.level - b.level);
  const allPts = [];
  const mm = (v) => v / 1000;
  const levelObjects = []; // [{ levels: [level…], object }] for the floor filter
  const addToLevels = (lvls, obj, surfaceIds = []) => { obj.userData.levels = lvls; obj.userData.surfaceIds = surfaceIds; levelObjects.push({ levels: lvls, object: obj }); scene.add(obj); };
  const shapeOf = (shape) => {
    const s = new T.Shape(shape.outer.map((q) => new T.Vector2(mm(q.x), mm(q.y))));
    for (const hole of shape.holes || []) s.holes.push(new T.Path(hole.map((q) => new T.Vector2(mm(q.x), mm(q.y)))));
    return s;
  };
  // a horizontal piece (floor, ceiling, roof, slab zone) at elevation y, with display thickness, keyed by its surface ids
  const addHorizontal = (shape, y, lvls, ids, baseColor) => {
    if (!shape.outer || shape.outer.length < 3) return;
    const color = colorFor(ids);
    const mesh = new T.Mesh(new T.ExtrudeGeometry(shapeOf(shape), { depth: slabT, bevelEnabled: false }), new T.MeshLambertMaterial({ color: color || baseColor, transparent: true, opacity: selectedRoom ? (color ? 1 : 0.1) : 0.9 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    addToLevels(lvls, mesh, ids);
  };
  const z0Of = (level) => mm(d.elevations[level] || 0);
  const heightOf = (level) => mm((d.perLevel[level] && d.perLevel[level].heightMm) || 3000);
  for (const l of levels) {
    const pl = d.perLevel[l.level];
    if (!pl) continue;
    const z0 = z0Of(l.level);
    const H = heightOf(l.level);
    const toB = levelToBuilding(l);
    // walls with openings cut
    for (const e of pl.edges) {
      if (e.separator) continue;
      const a = toB.apply(e.a);
      const b = toB.apply(e.b);
      const L = mm(dist(a, b));
      if (L < 0.01) continue;
      const wall = pl.walls.find((w) => w.id === e.wallId);
      const th = Math.max(0.05, mm(wall ? wall.thicknessMm : 100));
      const shape = new T.Shape([new T.Vector2(0, 0), new T.Vector2(L, 0), new T.Vector2(L, H), new T.Vector2(0, H)]);
      // openings on this edge
      for (const o of p.openings) {
        if (o.deleted || o.level !== l.level || o.wallId !== e.wallId || !o.aPx) continue;
        const sh = p.sheets.find((s) => s.id === o.sheetId);
        if (!sh) continue;
        const surf = d.calcModel.surfaces.find((s) => s.openingId === o.id);
        if (!surf) continue;
        const ow = Math.sqrt(surf.areaM2 * ((surf.refs && surf.refs.w) || 1));
        const w = surf.label ? parseFloat(surf.label.split(' ')[1]) / 1000 : ow;
        const hgt = surf.areaM2 / (w || 1);
        const tr = ctx.sheetToLevel(sh);
        const mid = toB.apply(tr.apply({ x: (o.aPx.x + o.bPx.x) / 2, y: (o.aPx.y + o.bPx.y) / 2 }));
        const pr = projectOnSegment(mid, { a, b });
        if (pr.distance > 600) continue;
        const x0 = Math.max(0.01, Math.min(L - w - 0.01, pr.t * L - w / 2));
        let sill = o.sillMm != null ? mm(o.sillMm) : o.kind === 'door' ? 0 : 0.9;
        if (sill + hgt > H - 0.05) sill = Math.max(0, H - 0.05 - hgt);
        const hole = new T.Path([new T.Vector2(x0, sill), new T.Vector2(x0 + w, sill), new T.Vector2(x0 + w, sill + hgt), new T.Vector2(x0, sill + hgt)]);
        shape.holes.push(hole);
        const ids = [surf.id];
        const color = colorFor(ids);
        const box = new T.Mesh(new T.BoxGeometry(w, hgt, th * 1.2), new T.MeshLambertMaterial({ color: color || (o.kind === 'window' ? 0x60a0ff : 0xa06030), transparent: true, opacity: color ? 1 : selectedRoom ? 0.1 : 0.85 }));
        box.userData = { openingId: o.id };
        placeWallObject(box, a, b, z0, x0 + w / 2, sill + hgt / 2, T);
        addToLevels([l.level], box, ids);
      }
      const geom = new T.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false });
      geom.translate(0, 0, -th / 2);
      // one edge can be one surface (wall:<level>:<edge>) or two (…:soil and …:air below/above ground)
      const base = `wall:${l.level}:${e.id}`;
      const ids = [base, `${base}:air`, `${base}:soil`];
      const color = colorFor(ids);
      const mesh = new T.Mesh(geom, new T.MeshLambertMaterial({ color: color || (e.left === 'outside' || e.right === 'outside' ? 0xd9c9a3 : 0xbfc6cf), transparent: true, opacity: selectedRoom ? (color ? 1 : 0.1) : 0.95 }));
      mesh.userData = { wallId: e.wallId };
      placeWallObject(mesh, a, b, z0, 0, 0, T, true);
      addToLevels([l.level], mesh, ids);
      allPts.push(a, b);
    }
    // walls that bound no room (loose ends, unclosed regions): drawn too, in red, so the gaps in the read are visible in 3D
    for (const e of pl.dangling || []) {
      const a = toB.apply(e.a);
      const b = toB.apply(e.b);
      const L = mm(dist(a, b));
      if (L < 0.01) continue;
      const wall = pl.walls.find((w) => w.id === e.wallId);
      const th = Math.max(0.05, mm(wall ? wall.thicknessMm : 100));
      const shape = new T.Shape([new T.Vector2(0, 0), new T.Vector2(L, 0), new T.Vector2(L, H), new T.Vector2(0, H)]);
      const geom = new T.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false });
      geom.translate(0, 0, -th / 2);
      const mesh = new T.Mesh(geom, new T.MeshLambertMaterial({ color: 0xd06060, transparent: true, opacity: selectedRoom ? 0.08 : 0.45 }));
      mesh.userData = { wallId: e.wallId, dangling: true };
      placeWallObject(mesh, a, b, z0, 0, 0, T, true);
      addToLevels([l.level], mesh);
      allPts.push(a, b);
    }
    // rooms: translucent box + orb
    for (const rm of pl.roomList) {
      if (rm.sliver) continue;
      const poly = rm.shapeB.outer;
      if (poly.length < 3) continue;
      const isSel = selectedRoom === rm.id;
      const roomGeom = new T.ExtrudeGeometry(shapeOf(rm.shapeB), { depth: H - slabT, bevelEnabled: false });
      const roomMesh = new T.Mesh(roomGeom, new T.MeshLambertMaterial({ color: isSel ? 0xffc000 : rm.record && rm.record.heated === false ? 0x8090c0 : 0x60c090, transparent: true, opacity: isSel ? 0.35 : selectedRoom ? 0.05 : 0.15, depthWrite: false }));
      roomMesh.rotation.x = -Math.PI / 2;
      roomMesh.position.y = z0 + slabT;
      roomMesh.userData = { roomId: rm.id, isRoom: true };
      addToLevels([l.level], roomMesh);
      const c = rm.face.interiorPoint || rm.face.centroid;
      const cb = toB.apply(c);
      const orb = new T.Mesh(new T.SphereGeometry(0.25, 16, 12), new T.MeshLambertMaterial({ color: isSel ? 0xff8000 : 0x2060d0 }));
      orb.position.set(mm(cb.x), z0 + H / 2, -mm(cb.y));
      orb.userData = { roomId: rm.id };
      addToLevels([l.level], orb);
      orbs.push(orb);
    }
  }
  // floor / ceiling pieces: exactly the pieces the calculation uses (one mesh per piece, keyed by piece:<id>).
  // A piece between two levels sits at the upper level's floor; a ceiling/roof piece on top of its level; a floor
  // piece with nothing below at its own level's floor.
  for (const pc of d.pieces) {
    const between = pc.lowerLevel != null && pc.upperLevel != null;
    const y = pc.upperLevel != null ? z0Of(pc.upperLevel) : z0Of(pc.lowerLevel) + heightOf(pc.lowerLevel);
    const lvls = between ? [pc.lowerLevel, pc.upperLevel] : [pc.upperLevel != null ? pc.upperLevel : pc.lowerLevel];
    const roofish = pc.kind === 'roof' || pc.kind === 'ceiling_cold_attic';
    addHorizontal(pc.shape, y, lvls, [`piece:${pc.id}`], roofish ? 0x7a6a5a : 0x9aa3ad);
  }
  // ground slab of the bottom level: the perimeter band and the inner zone of each room, as calculated (slab:<room>:band / :inner)
  if (d.slab && levels.length) {
    const bottom = levels[0];
    const pl = d.perLevel[bottom.level];
    const z0 = z0Of(bottom.level);
    for (const rm of pl.roomList) {
      if (rm.sliver) continue;
      if (d.pieces.some((pc) => pc.id === `${rm.id}|below`)) continue; // marked as floor to outside space: drawn as a piece above
      const zones = roomSlabShapes(rm.shapeB, d.slab.zones);
      for (const s of zones.band) addHorizontal(s, z0, [bottom.level], [`slab:${rm.id}:band`], 0x8f98a3);
      for (const s of zones.inner) addHorizontal(s, z0, [bottom.level], [`slab:${rm.id}:inner`], 0x9aa3ad);
    }
  }
  // floor filter: visibility only, never a rebuild. A piece between two floors is shown when either floor is.
  st.applyFilter = () => {
    const f = st.levelFilter;
    for (const { levels: lv, object } of levelObjects) object.visible = f == null || lv.some((x) => f.includes(x));
  };
  st.applyFilter();
  // camera framing: a saved view (from the previous build or the last frame) wins over the default framing
  const saved = st.camera;
  if (saved) {
    camera.position.set(saved.px, saved.py, saved.pz);
    controls.target.set(saved.tx, saved.ty, saved.tz);
  } else if (allPts.length) {
    const xs = allPts.map((q) => mm(q.x));
    const ys = allPts.map((q) => -mm(q.y));
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 10);
    const zTop = mm(Object.values(d.elevations).reduce((m, v) => Math.max(m, v), 0)) + 5;
    camera.position.set(cx + span * 0.9, zTop + span * 0.7, cz + span * 0.9);
    controls.target.set(cx, zTop / 2, cz);
  } else {
    camera.position.set(20, 20, 20);
  }
  controls.update();
  const grid = new T.GridHelper(200, 40, 0xcccccc, 0xe6e6e6);
  scene.add(grid);
  // picking orbs (and freehand selection with shift-drag rectangle)
  const ray = new T.Raycaster();
  const mouse = new T.Vector2();
  let lasso = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { if (e.shiftKey) { lasso = { x0: e.offsetX, y0: e.offsetY }; controls.enabled = false; } });
  renderer.domElement.addEventListener('pointerup', (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (lasso) {
      const x1 = e.offsetX; const y1 = e.offsetY;
      const ids = [];
      for (const o of orbs) { if (!o.visible) continue; const v = o.position.clone().project(camera); const sx = ((v.x + 1) / 2) * rect.width; const sy = ((1 - v.y) / 2) * rect.height; if (sx >= Math.min(lasso.x0, x1) && sx <= Math.max(lasso.x0, x1) && sy >= Math.min(lasso.y0, y1) && sy <= Math.max(lasso.y0, y1)) ids.push(o.userData.roomId); }
      lasso = null;
      controls.enabled = true;
      if (ids.length) store.setSelection({ ids });
      return;
    }
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(orbs.filter((o) => o.visible));
    if (hits.length) store.setSelection({ ids: [hits[0].object.userData.roomId] });
  });
  let alive = true;
  const saveView = () => { st.camera = { px: camera.position.x, py: camera.position.y, pz: camera.position.z, tx: controls.target.x, ty: controls.target.y, tz: controls.target.z }; };
  controls.addEventListener('change', saveView);
  const animate = () => { if (!alive || !renderer.domElement.isConnected) { alive = false; renderer.dispose(); return; } controls.update(); renderer.render(scene, camera); requestAnimationFrame(animate); };
  animate();
  const ro = new ResizeObserver(() => { const rr = host.getBoundingClientRect(); renderer.setSize(rr.width, rr.height); camera.aspect = rr.width / rr.height; camera.updateProjectionMatrix(); });
  ro.observe(host);
}
function placeWallObject(mesh, a, b, z0, along, up, T, isExtrude = false) {
  const mm = (v) => v / 1000;
  const dir = sub(b, a);
  // world: x = plan x, z = -plan y (y up). A rotation about Y by θ maps local +x to (cos θ, 0, -sin θ), so θ = atan2(dir.y, dir.x).
  const ang = Math.atan2(mm(dir.y), mm(dir.x));
  const L = mm(dist(a, b));
  const ax = mm(a.x);
  const az = -mm(a.y);
  if (isExtrude) {
    // extruded shape: x along wall, y up, z thickness; rotate around Y by ang
    mesh.rotation.y = ang;
    mesh.position.set(ax, z0, az);
  } else {
    const ox = ax + Math.cos(ang) * along;
    const oz = az - Math.sin(ang) * along;
    mesh.rotation.y = ang;
    mesh.position.set(ox, z0 + up, oz);
  }
}
