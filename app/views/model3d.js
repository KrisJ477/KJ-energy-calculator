// 3D model (SPEC 4.9, 4.10): generated from the approved 2D data plus stacking; walls extruded with
// openings cut, slabs with display thickness, translucent room boxes with an orb as click handle.
import { h, clear, section, button, numberInput, fmt } from '../ui/dom.js';
import { t } from '../i18n/strings.js';
import { levelToBuilding } from '../state/derive.js';
import { applyTransform, dist, sub, projectOnSegment, polygonArea } from '../engine/geometry.js';
import { roomPanel, SURFACE_COLORS } from './audit.js';

let THREE = null;
let OrbitControls = null;
async function three() {
  if (!THREE) {
    THREE = await import('../../vendor/three/three.module.js');
    OrbitControls = (await import('../../vendor/three/OrbitControls.js')).OrbitControls;
  }
  return THREE;
}

export function render(root, ctx) {
  const { store } = ctx;
  const p = store.project;
  clear(root);
  const host = h('div', { class: 'canvas-host', style: { height: '70vh' } });
  const side = h('div', { class: 'audit-side' });
  const st = ctx.threeState || (ctx.threeState = { slabMm: 200 });
  root.append(h('div', { class: 'editor-layout' }, h('div', { class: 'editor-main' }, h('div', { class: 'row' }, button(t('model3d.regenerate'), () => ctx.rerender()), h('label', {}, t('model3d.slabThickness')), numberInput(st.slabMm, (v) => { st.slabMm = v; ctx.rerender(); }), h('span', { class: 'muted' }, t('model3d.legend'))), host), side));
  const sel = store.state.selection;
  if (sel.ids && sel.ids.length === 1 && p.rooms.some((r) => r.id === sel.ids[0])) side.append(roomPanel(sel.ids[0], ctx, { colorRows: true }));
  build(host, ctx).catch((e) => { console.error(e); host.append(h('p', { class: 'warn' }, String(e.message || e))); });
}

async function build(host, ctx) {
  const T = await three();
  const { store } = ctx;
  const p = store.project;
  const d = ctx.derived();
  const sel = store.state.selection;
  const selectedRoom = sel.ids && sel.ids.length === 1 && p.rooms.some((r) => r.id === sel.ids[0]) ? sel.ids[0] : null;
  const slabT = (ctx.threeState.slabMm || 200) / 1000;
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
  // colour map for the selected room's surfaces (list view colour coding)
  const rowColors = {};
  if (selectedRoom && d.results) d.results.rooms[selectedRoom].rows.forEach((row, i) => { if (row.kind === 'transmission') rowColors[row.surfaceId] = SURFACE_COLORS[i % SURFACE_COLORS.length]; });
  const orbs = [];
  const levels = [...p.levels].sort((a, b) => a.level - b.level);
  const allPts = [];
  const mm = (v) => v / 1000;
  for (const l of levels) {
    const pl = d.perLevel[l.level];
    if (!pl) continue;
    const z0 = mm(d.elevations[l.level] || 0);
    const H = mm(pl.heightMm || 3000);
    const toB = levelToBuilding(l);
    const dim = (id) => selectedRoom && !d.calcModel.surfaces.some((s) => s.id === id && (s.roomA === selectedRoom || s.roomB === selectedRoom));
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
        const box = new T.Mesh(new T.BoxGeometry(w, hgt, th * 1.2), new T.MeshLambertMaterial({ color: rowColors[`op:${o.id}`] || (o.kind === 'window' ? 0x60a0ff : 0xa06030), transparent: true, opacity: rowColors[`op:${o.id}`] ? 1 : selectedRoom && !rowColors[`op:${o.id}`] ? 0.1 : 0.85 }));
        box.userData = { openingId: o.id };
        placeWallObject(box, a, b, z0, x0 + w / 2, sill + hgt / 2, T);
        scene.add(box);
      }
      const geom = new T.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false });
      geom.translate(0, 0, -th / 2);
      const color = rowColors[`wall:${e.id}`] || rowColors[`wall:${e.id}:air`] || (e.left === 'outside' || e.right === 'outside' ? 0xd9c9a3 : 0xbfc6cf);
      const mesh = new T.Mesh(geom, new T.MeshLambertMaterial({ color, transparent: true, opacity: selectedRoom ? (rowColors[`wall:${e.id}`] || rowColors[`wall:${e.id}:air`] ? 1 : 0.1) : 0.95 }));
      mesh.userData = { wallId: e.wallId };
      placeWallObject(mesh, a, b, z0, 0, 0, T, true);
      scene.add(mesh);
      allPts.push(a, b);
    }
    // rooms: translucent box + orb
    for (const rm of pl.roomList) {
      const poly = rm.shapeB.outer;
      if (poly.length < 3) continue;
      const shape = new T.Shape(poly.map((q) => new T.Vector2(mm(q.x), mm(q.y))));
      for (const hole of rm.shapeB.holes) shape.holes.push(new T.Path(hole.map((q) => new T.Vector2(mm(q.x), mm(q.y)))));
      const isSel = selectedRoom === rm.id;
      const roomGeom = new T.ExtrudeGeometry(shape, { depth: H - slabT, bevelEnabled: false });
      const roomMesh = new T.Mesh(roomGeom, new T.MeshLambertMaterial({ color: isSel ? 0xffc000 : rm.record && rm.record.heated === false ? 0x8090c0 : 0x60c090, transparent: true, opacity: isSel ? 0.35 : selectedRoom ? 0.05 : 0.15, depthWrite: false }));
      roomMesh.rotation.x = -Math.PI / 2;
      roomMesh.position.y = z0 + slabT;
      roomMesh.userData = { roomId: rm.id, isRoom: true };
      scene.add(roomMesh);
      // floor slab with display thickness
      const pieceColor = selectedRoom ? colorForRoomFloor(rm.id, rowColors) : null;
      const slabGeom = new T.ExtrudeGeometry(shape, { depth: slabT, bevelEnabled: false });
      const slab = new T.Mesh(slabGeom, new T.MeshLambertMaterial({ color: pieceColor || 0x9aa3ad, transparent: true, opacity: selectedRoom ? (pieceColor ? 1 : 0.1) : 0.9 }));
      slab.rotation.x = -Math.PI / 2;
      slab.position.y = z0;
      scene.add(slab);
      const c = rm.face.interiorPoint || rm.face.centroid;
      const cb = toB.apply(c);
      const orb = new T.Mesh(new T.SphereGeometry(0.25, 16, 12), new T.MeshLambertMaterial({ color: isSel ? 0xff8000 : 0x2060d0 }));
      orb.position.set(mm(cb.x), z0 + H / 2, -mm(cb.y));
      orb.userData = { roomId: rm.id };
      scene.add(orb);
      orbs.push(orb);
    }
    // ceiling/roof for the top level
    if (l === levels[levels.length - 1]) {
      for (const rm of pl.roomList) {
        const shape = new T.Shape(rm.shapeB.outer.map((q) => new T.Vector2(mm(q.x), mm(q.y))));
        const pieceColor = selectedRoom ? (Object.entries(rowColors).find(([k]) => k.startsWith(`piece:${rm.id}|above`)) || [])[1] : null;
        const roofMesh = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: slabT, bevelEnabled: false }), new T.MeshLambertMaterial({ color: pieceColor || 0x7a6a5a, transparent: true, opacity: selectedRoom ? (pieceColor ? 1 : 0.1) : 0.85 }));
        roofMesh.rotation.x = -Math.PI / 2;
        roofMesh.position.y = z0 + H;
        scene.add(roofMesh);
      }
    }
  }
  // camera framing
  if (allPts.length) {
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
      for (const o of orbs) { const v = o.position.clone().project(camera); const sx = ((v.x + 1) / 2) * rect.width; const sy = ((1 - v.y) / 2) * rect.height; if (sx >= Math.min(lasso.x0, x1) && sx <= Math.max(lasso.x0, x1) && sy >= Math.min(lasso.y0, y1) && sy <= Math.max(lasso.y0, y1)) ids.push(o.userData.roomId); }
      lasso = null;
      controls.enabled = true;
      if (ids.length) store.setSelection({ ids });
      return;
    }
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(orbs);
    if (hits.length) store.setSelection({ ids: [hits[0].object.userData.roomId] });
  });
  let alive = true;
  const animate = () => { if (!alive || !renderer.domElement.isConnected) { alive = false; renderer.dispose(); return; } controls.update(); renderer.render(scene, camera); requestAnimationFrame(animate); };
  animate();
  const ro = new ResizeObserver(() => { const rr = host.getBoundingClientRect(); renderer.setSize(rr.width, rr.height); camera.aspect = rr.width / rr.height; camera.updateProjectionMatrix(); });
  ro.observe(host);
}
function colorForRoomFloor(roomId, rowColors) {
  for (const [k, v] of Object.entries(rowColors)) if (k.startsWith('piece:') && (k.includes(`${roomId}|`) || k.endsWith(`|${roomId}`)) || k.startsWith(`slab:${roomId}:`)) return v;
  return null;
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
