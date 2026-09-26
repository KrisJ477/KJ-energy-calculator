// Derivation pipeline: project → per-level geometry → floor/ceiling pieces → calculation model → results.
// Pure with respect to the project (never mutates it). Views and the calculation read from here.
import { cleanupWalls, buildRooms, snapToleranceMm, floorPieces, slabZones, roomSlabSplit, polygonArea, shapeArea, unionShapes, offsetPolygonInward, applyTransform, transformShape, dist, sub, cross, projectOnSegment, multiArea, bbox, minWidth } from '../engine/geometry.js';
import { typeU, constructionU } from '../engine/uvalue.js';
import { calculate } from '../engine/calc.js';
import { sortedLevels } from './model.js';

// ---------- transforms ----------
export function sheetToLevel(sheet) {
  const mmPerPx = sheet.scale ? sheet.scale.mmPerPx : null;
  const pl = sheet.placement || { rot: 0, tx: 0, ty: 0, sx: 1, sy: 1 };
  const unit = mmPerPx || 1; // without scale the level frame is in sheet px
  const T = { sx: (pl.sx || 1) * unit, sy: (pl.sy || 1) * unit, rot: pl.rot || 0, tx: pl.tx || 0, ty: pl.ty || 0 };
  return { T, mmPerPx, apply: (p) => applyTransform(T, p) };
}
export function levelToBuilding(level) {
  const T = level.transform || { s: 1, rot: 0, tx: 0, ty: 0 };
  return { T, apply: (p) => applyTransform(T, p) };
}

export function wallTypeClusters(walls, bandMm) {
  const items = walls.filter((w) => w.thicknessMm != null).map((w) => ({ id: w.id, t: w.thicknessMm })).sort((a, b) => a.t - b.t);
  const clusters = [];
  for (const it of items) {
    const c = clusters[clusters.length - 1];
    if (c && Math.abs(it.t - c.mean) <= bandMm) {
      c.ids.push(it.id);
      c.sum += it.t;
      c.mean = c.sum / c.ids.length;
      c.min = Math.min(c.min, it.t);
      c.max = Math.max(c.max, it.t);
    } else clusters.push({ ids: [it.id], sum: it.t, mean: it.t, min: it.t, max: it.t });
  }
  clusters.forEach((c, i) => (c.index = i));
  return clusters;
}
export function openingClusters(openings, bandMm) {
  const items = openings.filter((o) => o.widthMm != null).map((o) => ({ id: o.id, kind: o.kind, w: o.widthMm, h: o.heightMm ?? -1 })).sort((a, b) => a.kind.localeCompare(b.kind) || a.w - b.w || a.h - b.h);
  const clusters = [];
  for (const it of items) {
    const c = clusters.find((x) => x.kind === it.kind && Math.abs(it.w - x.w) <= bandMm && (it.h < 0 ? x.h < 0 : x.h >= 0 && Math.abs(it.h - x.h) <= bandMm));
    if (c) {
      c.ids.push(it.id);
      c.w = (c.w * (c.ids.length - 1) + it.w) / c.ids.length;
      if (it.h >= 0) c.h = (c.h * (c.ids.length - 1) + it.h) / c.ids.length;
    } else clusters.push({ kind: it.kind, ids: [it.id], w: it.w, h: it.h });
  }
  clusters.forEach((c, i) => (c.index = i));
  return clusters;
}

// Walls of a level in level units (mm when scaled).
export function levelWalls(project, level) {
  const out = [];
  for (const w of project.walls) {
    if (w.level !== level || w.deleted) continue;
    const sheet = project.sheets.find((s) => s.id === w.sheetId);
    if (!sheet) continue;
    const tr = sheetToLevel(sheet);
    const mmPerPx = tr.mmPerPx || 1;
    const thicknessMm = w.thicknessMm != null ? w.thicknessMm : w.thicknessPx != null ? w.thicknessPx * mmPerPx : null;
    out.push({ id: w.id, a: tr.apply(w.aPx), b: tr.apply(w.bPx), thicknessMm: thicknessMm ?? 0, wallTypeId: w.wallTypeId, percentUnderground: w.percentUnderground || 0, outsideSpace: w.outsideSpace || null, origin: w.origin, scaled: !!tr.mmPerPx, raw: w });
  }
  return out;
}
export function levelSeparators(project, level) {
  return project.separators.filter((s) => s.level === level).map((s) => ({ id: s.id, a: s.a, b: s.b }));
}
export function roomAnchor(project, room) {
  if (room.anchor) return room.anchor;
  if (room.anchorPx) {
    const sheet = project.sheets.find((s) => s.id === room.sheetId);
    if (sheet) return sheetToLevel(sheet).apply(room.anchorPx);
  }
  return null;
}

// Geometry of one level: cleaned walls, faces, rooms matched to records, edges with sides.
export function levelGeometry(project, level) {
  const lvlRec = project.levels.find((l) => l.level === level);
  const walls = levelWalls(project, level);
  const scaled = walls.length ? walls.every((w) => w.scaled) : !!(project.sheets.find((s) => s.level === level && s.type === 'plan' && s.scale));
  const baseSheet = project.sheets.find((s) => s.level === level && s.type === 'plan' && s.role === 'base') || project.sheets.find((s) => s.level === level && s.type === 'plan');
  const mmPerPx = baseSheet && baseSheet.scale ? baseSheet.scale.mmPerPx : null;
  const thicknesses = walls.map((w) => w.thicknessMm).filter((t) => t > 0);
  const thinnest = thicknesses.length ? Math.min(...thicknesses) : 0;
  const tolMm = scaled ? snapToleranceMm({ mmPerPx: mmPerPx || 8, thinnestWallMm: thinnest, overrideMm: project.config.snapToleranceOverrideMm }) : 3;
  const bandMm = project.config.wallTypeBandMm ?? 15;
  const { walls: cleaned, log } = cleanupWalls(walls, tolMm, { bandMm });
  const separators = levelSeparators(project, level);
  const built = buildRooms(cleaned, separators, { tol: tolMm });
  // a face narrower than the sliver width or smaller than the sliver area is a gap between double-drawn walls, not a room (SPEC 3.4)
  const sliverWidthMm = project.config.sliverWidthMm ?? 150;
  const sliverAreaM2 = project.config.sliverAreaM2 ?? 0.1;
  const faceRooms = built.rooms.map((face) => ({ face, record: null, sliver: scaled && (face.areaM2 < sliverAreaM2 || minWidth(face.centerline) < sliverWidthMm) }));
  // building outline from the overview read, in the level frame: tells exterior walls from walls facing an unread interior region
  const outlineMm = baseSheet && baseSheet.buildingOutline && baseSheet.buildingOutline.length >= 3 ? baseSheet.buildingOutline.map((p) => sheetToLevel(baseSheet).apply(p)) : null;
  // match faces to room records by anchor
  const records = project.rooms.filter((r) => r.level === level);
  const usedRecords = new Set();
  for (const rec of records) {
    const anchor = roomAnchor(project, rec);
    if (!anchor) continue;
    const hit = faceRooms.find((fr) => !fr.record && !fr.sliver && pointIn(anchor, fr.face.centerline));
    if (hit) {
      hit.record = rec;
      usedRecords.add(rec.id);
    }
  }
  const orphanRecords = records.filter((r) => !usedRecords.has(r.id));
  return { level, lvlRec, walls: cleaned, rawWalls: walls, separators, tolMm, cleanupLog: log, faces: built.rooms, edges: built.edges, dangling: built.dangling, faceRooms, orphanRecords, scaled, mmPerPx, baseSheet, outlineMm };
}
function pointIn(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    if (pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside;
  }
  return inside;
}

// Create room records for faces that have none (called inside store updates that change geometry).
export function syncRooms(project, level, newRoomFactory, geometry = null) {
  const g = geometry || levelGeometry(project, level);
  const records = project.rooms.filter((r) => r.level === level);
  let maxIndex = records.reduce((m, r) => Math.max(m, r.index), 0);
  for (const fr of g.faceRooms) {
    if (fr.record || fr.sliver) continue;
    // anchor at a point that is inside the face even when it is concave, so the record matches on the next derive
    const c = fr.face.interiorPoint || fr.face.centroid;
    if (!pointIn(c, fr.face.centerline)) continue; // degenerate face (sliver): no record rather than one that never matches
    const rec = newRoomFactory(level, ++maxIndex, { anchor: c, origin: 'user' });
    project.rooms.push(rec);
    fr.record = rec;
  }
  for (const rec of g.orphanRecords) rec.orphan = true;
  for (const fr of g.faceRooms) if (fr.record) fr.record.orphan = false;
  return g;
}

// ---------- surfaces ----------
function materialsById(project, libraryMaterials) {
  const m = {};
  for (const mat of libraryMaterials || []) m[mat.id] = mat;
  for (const mat of project.library.materialsExtra || []) m[mat.id] = mat;
  return m;
}
function constructionsById(project) {
  const c = {};
  for (const x of project.library.constructions) c[x.id] = x;
  return c;
}

function uFor(type, project, ctx, direction, options) {
  const r = typeU(type, ctx.constructions, ctx.materials, direction, options);
  return { U: r.U, chain: r };
}

// Outside length of an exterior edge: centerline length plus half the adjoining exterior wall thickness at
// convex corners, minus at concave corners (SPEC 3.15 outside dimensions).
function outsideLength(face, i) {
  const n = face.centerline.length;
  const e = face.edges[i];
  let L = dist(e.from, e.to);
  for (const [nbIdx, vertexIdx] of [
    [(i - 1 + n) % n, i],
    [(i + 1) % n, (i + 1) % n],
  ]) {
    const nb = face.edges[nbIdx];
    if (!nb || nb.separator || !nb.exterior) continue;
    const p0 = face.centerline[(vertexIdx - 1 + n) % n];
    const p1 = face.centerline[vertexIdx];
    const p2 = face.centerline[(vertexIdx + 1) % n];
    const turn = cross(sub(p1, p0), sub(p2, p1));
    const convexRoom = polygonArea(face.centerline) > 0 ? turn > 0 : turn < 0;
    L += (convexRoom ? 1 : -1) * (nb.thicknessMm / 2);
  }
  return Math.max(L, 0);
}

export function derive(project, libraryMaterials) {
  const ctx = { materials: materialsById(project, libraryMaterials), constructions: constructionsById(project) };
  const lib = project.library;
  const levels = sortedLevels(project);
  const perLevel = {};
  const rooms = [];
  const surfaces = [];
  const warnings = [];
  const types = { walls: {}, floors: {}, roofs: {}, openings: {}, slab: null };
  for (const wt of lib.wallTypes) types.walls[wt.id] = uFor(wt, project, ctx, 'horizontal');
  for (const ft of lib.floorTypes) types.floors[ft.id] = { up: uFor(ft, project, ctx, 'up'), down: uFor(ft, project, ctx, 'down') };
  for (const rt of lib.roofTypes) types.roofs[rt.id] = uFor(rt, project, ctx, 'up');
  for (const ot of lib.openingTypes) types.openings[ot.id] = uFor(ot, project, ctx, 'horizontal');
  if (lib.slabType) types.slab = uFor(lib.slabType, project, ctx, 'down', { rse: 0 });
  const defaultFloorType = lib.floorTypes.find((f) => f.kind === 'between') || lib.floorTypes[0] || null;
  const topColdType = lib.floorTypes.find((f) => f.kind === 'top-cold-attic') || null;
  const defaultRoof = lib.roofTypes[0] || null;
  const extDoor = lib.openingTypes.find((o) => o.defaultFor === 'exterior-door');
  const intDoor = lib.openingTypes.find((o) => o.defaultFor === 'interior-door');
  const defWindow = lib.openingTypes.find((o) => o.kind === 'window');

  // elevations: cumulative floor heights from the bottom level
  let elev = 0;
  const elevations = {};
  for (const l of levels) {
    elevations[l.level] = elev;
    elev += l.heightMm || 0;
  }
  const bottom = levels[0];
  const top = levels[levels.length - 1];

  for (const l of levels) {
    const g = levelGeometry(project, l.level);
    const toB = levelToBuilding(l);
    const heightMm = l.heightMm || 0;
    const roomList = [];
    for (const fr of g.faceRooms) {
      const rec = fr.record;
      const face = fr.face;
      face.edges.forEach((e) => {
        const edge = g.edges.find((x) => x.id === e.edgeId);
        e.exterior = edge ? edge.left === 'outside' || edge.right === 'outside' : false;
      });
      const shape = { outer: face.inside, holes: face.holes.map((h) => h.inside) };
      const shapeB = transformShape(toB.T, shape);
      const areaM2 = shapeArea(shape) / 1e6;
      roomList.push({ id: rec ? rec.id : `?${l.level}-${face.faceIndex}`, record: rec, face, shape, shapeB, areaM2, level: l.level, sliver: !!fr.sliver, exteriorWalls: new Set(), exteriorWallsWithOpenings: new Set() });
    }
    perLevel[l.level] = { ...g, roomList, heightMm, elevationMm: elevations[l.level] };
  }

  // ground elevation: from the bottom level's percent underground (or vertical drawing datum when stored)
  let groundElevationMm = 0;
  if (bottom) {
    const bw = perLevel[bottom.level].walls.filter((w) => w.percentUnderground > 0);
    if (bw.length) {
      const avg = bw.reduce((s, w) => s + w.percentUnderground, 0) / bw.length;
      groundElevationMm = elevations[bottom.level] + (avg / 100) * (bottom.heightMm || 0);
    }
    if (bottom.groundElevationMm != null) groundElevationMm = bottom.groundElevationMm;
  }

  // wall surfaces
  const unreadByLevel = new Map(); // wall metres per level whose far side is an unread interior region (assumed heated, SPEC 3.2)
  const openingsWithoutSize = new Set();
  // An edge on the unbounded face is an exterior wall when the read says so, or (no opinion) when it lies on the building
  // outline or is thick; otherwise the unbounded face is an unread part of the interior, not outdoors.
  const looksExterior = (wrec, wall, e, pl) => {
    if (!wrec) return true;
    if (wrec.exteriorGuess === true) return true;
    if (wrec.exteriorGuess === false) return false;
    if (pl.outlineMm) {
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      let dmin = Infinity;
      for (let i = 0; i < pl.outlineMm.length; i++) dmin = Math.min(dmin, projectOnSegment(mid, { a: pl.outlineMm[i], b: pl.outlineMm[(i + 1) % pl.outlineMm.length] }).distance);
      return dmin < 1500;
    }
    return (wall.thicknessMm || 0) >= 250;
  };
  for (const l of levels) {
    const pl = perLevel[l.level];
    const H = pl.heightMm / 1000;
    const wallById = new Map(pl.walls.map((w) => [w.id, w]));
    const openingsByWall = new Map();
    for (const o of project.openings) {
      if (o.deleted || o.level !== l.level) continue;
      if (!openingsByWall.has(o.wallId)) openingsByWall.set(o.wallId, []);
      openingsByWall.get(o.wallId).push(o);
    }
    const sheetTr = new Map();
    const openingMm = (o) => {
      if (!sheetTr.has(o.sheetId)) {
        const sh = project.sheets.find((s) => s.id === o.sheetId);
        sheetTr.set(o.sheetId, sh ? sheetToLevel(sh) : null);
      }
      const tr = sheetTr.get(o.sheetId);
      const mmPerPx = tr && tr.mmPerPx ? tr.mmPerPx : null;
      const widthMm = o.widthMm != null ? o.widthMm : o.widthPx != null && mmPerPx ? o.widthPx * mmPerPx : null;
      const mid = o.aPx && o.bPx && tr ? tr.apply({ x: (o.aPx.x + o.bPx.x) / 2, y: (o.aPx.y + o.bPx.y) / 2 }) : null;
      return { widthMm, heightMm: o.heightMm, mid };
    };
    // assign every opening of this level to one edge of its wall: the edge its midpoint projects onto with the smallest
    // distance (ties at a junction go to the first edge), so a window is never counted on two edge segments
    const openingEdge = new Map();
    for (const [wallId, list] of openingsByWall) {
      const edgesOfWall = pl.edges.filter((e) => e.wallId === wallId && !e.separator);
      for (const o of list) {
        const m = openingMm(o);
        if (!m.mid) { if (edgesOfWall[0]) openingEdge.set(o.id, edgesOfWall[0].id); continue; }
        let best = null;
        for (const e of edgesOfWall) {
          const pr = projectOnSegment(m.mid, { a: e.a, b: e.b });
          const inside = pr.t >= 0 && pr.t <= 1;
          const score = pr.distance + (inside ? 0 : 1e6);
          if (!best || score < best.score) best = { e, score };
        }
        if (best && best.score < 500) openingEdge.set(o.id, best.e.id);
      }
    }
    for (const e of pl.edges) {
      const wall = wallById.get(e.wallId) || (e.separator ? null : null);
      if (e.separator) continue;
      const wrec = wall ? wall.raw : null;
      const faceL = typeof e.left === 'number' ? pl.roomList[e.left] : null;
      const faceR = typeof e.right === 'number' ? pl.roomList[e.right] : null;
      const roomL = faceL && !faceL.sliver ? faceL : null;
      const roomR = faceR && !faceR.sliver ? faceR : null;
      const rooms2 = [roomL, roomR].filter(Boolean);
      if (!rooms2.length) continue;
      const outsideSide = e.left === 'outside' || e.right === 'outside';
      const sliverSide = (faceL && faceL.sliver) || (faceR && faceR.sliver);
      const exterior = outsideSide && looksExterior(wrec, wall, e, pl);
      const unread = rooms2.length === 1 && !exterior && (outsideSide || sliverSide);
      if (unread) unreadByLevel.set(l.level, (unreadByLevel.get(l.level) || 0) + dist(e.a, e.b));
      let lengthMm = dist(e.a, e.b);
      if (exterior && rooms2.length === 1) {
        const face = rooms2[0].face;
        const idx = face.edges.findIndex((x) => x.edgeId === e.id);
        if (idx >= 0) lengthMm = outsideLength(face, idx);
      }
      const wallU = wall && wall.wallTypeId && types.walls[wall.wallTypeId] ? types.walls[wall.wallTypeId] : { U: null, chain: null };
      if (wall && !wall.wallTypeId) warnings.push({ level: l.level, type: 'wall-no-type', id: wall.id });
      // openings on this edge: each opening belongs to exactly one edge of its wall (the one its midpoint projects onto best)
      const ops = (openingsByWall.get(e.wallId) || []).map((o) => ({ o, ...openingMm(o) })).filter((x) => openingEdge.get(x.o.id) === e.id);
      let openingAreaM2 = 0;
      const surfaceBase = { wallId: e.wallId, edgeId: e.id, level: l.level };
      for (const x of ops) {
        if (x.widthMm == null || x.heightMm == null) {
          warnings.push({ level: l.level, type: 'opening-no-size', id: x.o.id });
          openingsWithoutSize.add(x.o.id);
          continue;
        }
        const a = (x.widthMm / 1000) * (x.heightMm / 1000);
        openingAreaM2 += a;
        const otype = x.o.openingTypeId ? lib.openingTypes.find((t) => t.id === x.o.openingTypeId) : x.o.kind === 'door' ? (exterior ? extDoor : intDoor) : defWindow;
        const ou = otype && types.openings[otype.id] ? types.openings[otype.id] : { U: null, chain: null };
        const other = exterior ? (wall && wall.outsideSpace ? { type: 'outside_space', temp: wall.outsideSpace.temp } : { type: 'outside' }) : unread ? { type: 'unread' } : null;
        surfaces.push({ id: `op:${x.o.id}`, kind: x.o.kind, ...surfaceBase, openingId: x.o.id, roomA: rooms2[0].id, roomB: rooms2[1] ? rooms2[1].id : undefined, other: rooms2[1] ? undefined : other, areaM2: a, U: ou.U, envelope: exterior, label: `${x.o.kind} ${x.widthMm}×${x.heightMm}`, refs: { openingType: otype ? otype.id : null, chain: ou.chain } });
        if (exterior) for (const r of rooms2) r.exteriorWallsWithOpenings.add(e.wallId);
      }
      if (exterior) for (const r of rooms2) r.exteriorWalls.add(e.wallId);
      const grossM2 = (lengthMm / 1000) * H;
      const netM2 = Math.max(0, grossM2 - openingAreaM2);
      if (rooms2.length === 2) {
        surfaces.push({ id: `wall:${e.id}`, kind: 'wall', ...surfaceBase, roomA: rooms2[0].id, roomB: rooms2[1].id, areaM2: netM2, U: wallU.U, envelope: false, label: 'wall', refs: { wallType: wall ? wall.wallTypeId : null, chain: wallU.chain, lengthMm, heightMm: pl.heightMm } });
      } else if (unread) {
        surfaces.push({ id: `wall:${e.id}`, kind: 'wall', ...surfaceBase, roomA: rooms2[0].id, other: { type: 'unread' }, areaM2: netM2, U: wallU.U, envelope: false, label: 'wall to unread space', refs: { wallType: wall ? wall.wallTypeId : null, chain: wallU.chain, lengthMm, heightMm: pl.heightMm } });
      } else if (exterior) {
        const room = rooms2[0];
        if (wall && wall.outsideSpace) {
          surfaces.push({ id: `wall:${e.id}`, kind: 'wall', ...surfaceBase, roomA: room.id, other: { type: 'outside_space', temp: wall.outsideSpace.temp }, areaM2: netM2, U: wallU.U, envelope: true, label: 'wall to space outside project', refs: { wallType: wall ? wall.wallTypeId : null, chain: wallU.chain, lengthMm, heightMm: pl.heightMm } });
        } else {
          const pct = wall ? wall.percentUnderground : 0;
          if (pct > 0) {
            const soilM2 = grossM2 * (pct / 100);
            const airM2 = Math.max(0, grossM2 - soilM2 - openingAreaM2);
            surfaces.push({ id: `wall:${e.id}:soil`, kind: 'wall', ...surfaceBase, roomA: room.id, other: { type: 'soil' }, areaM2: Math.min(soilM2, netM2), U: wallU.U, envelope: true, label: 'wall to soil', refs: { wallType: wall.wallTypeId, chain: wallU.chain, lengthMm, percentUnderground: pct } });
            surfaces.push({ id: `wall:${e.id}:air`, kind: 'wall', ...surfaceBase, roomA: room.id, other: { type: 'outside' }, areaM2: airM2, U: wallU.U, envelope: true, label: 'exterior wall', refs: { wallType: wall.wallTypeId, chain: wallU.chain, lengthMm, percentUnderground: pct } });
          } else {
            surfaces.push({ id: `wall:${e.id}`, kind: 'wall', ...surfaceBase, roomA: room.id, other: { type: 'outside' }, areaM2: netM2, U: wallU.U, envelope: true, label: 'exterior wall', refs: { wallType: wall ? wall.wallTypeId : null, chain: wallU.chain, lengthMm, heightMm: pl.heightMm } });
          }
        }
      }
    }
  }

  for (const [level, mm] of unreadByLevel) warnings.push({ level, type: 'walls-to-unread-space', message: `${(mm / 1000).toFixed(0)} m of wall face an unread part of the floor, assumed heated (SPEC 3.2)` });
  // openings that sit on a wall outside the room graph never become a surface: say so (SPEC 4.7 gap list)
  const openingIdsWithSurface = new Set(surfaces.filter((s) => s.openingId).map((s) => s.openingId));
  for (const l of levels) {
    const lost = project.openings.filter((o) => !o.deleted && o.level === l.level && !openingIdsWithSurface.has(o.id) && !openingsWithoutSize.has(o.id));
    if (lost.length) warnings.push({ level: l.level, type: 'opening-not-on-room-wall', message: `${lost.length} (${lost.map((o) => o.id).slice(0, 6).join(', ')}${lost.length > 6 ? ', …' : ''})` });
  }

  // floor / ceiling pieces between adjacent levels (building frame)
  const pieces = [];
  const sliverInfo = {};
  for (let i = 0; i < levels.length; i++) {
    const lower = levels[i];
    const upper = levels[i + 1] || null;
    const lowerRooms = perLevel[lower.level].roomList.filter((r) => !r.sliver).map((r) => ({ id: r.id, shape: r.shapeB, room: r }));
    const upperRooms = upper ? perLevel[upper.level].roomList.filter((r) => !r.sliver).map((r) => ({ id: r.id, shape: r.shapeB, room: r })) : [];
    const res = floorPieces(lowerRooms, upperRooms, { sliverWidthMm: project.config.sliverWidthMm, sliverAreaM2: project.config.sliverAreaM2 });
    sliverInfo[lower.level] = { absorbed: res.absorbed, absorbedList: res.absorbedList };
    const lowerById = new Map(lowerRooms.map((r) => [r.id, r.room]));
    const upperById = new Map(upperRooms.map((r) => [r.id, r.room]));
    for (const p of res.pieces) {
      const rl = lowerById.get(p.lowerRoomId);
      const ru = upperById.get(p.upperRoomId);
      const ov = project.pieceOverrides[p.id] || {};
      const bothUnheated = rl.record && ru.record && !rl.record.heated && !ru.record.heated;
      let U;
      let kind;
      let refs;
      if (bothUnheated) {
        U = project.config.fakeFloorU;
        kind = 'fake_floor';
        refs = { fakeFloor: true };
      } else {
        const ft = ov.floorTypeId ? lib.floorTypes.find((f) => f.id === ov.floorTypeId) : defaultFloorType;
        const tu = ft && types.floors[ft.id] ? types.floors[ft.id] : null;
        U = tu ? tu.up.U : null;
        kind = 'floor';
        refs = { floorType: ft ? ft.id : null, chain: tu ? tu.up.chain : null };
        if (!ft) warnings.push({ level: lower.level, type: 'piece-no-type', id: p.id });
      }
      pieces.push({ ...p, lowerLevel: lower.level, upperLevel: upper.level, kind, U, override: ov });
      surfaces.push({ id: `piece:${p.id}`, kind, level: lower.level, pieceId: p.id, roomA: p.lowerRoomId, roomB: p.upperRoomId, areaM2: p.areaM2, U, envelope: false, label: kind === 'fake_floor' ? 'fake floor' : 'floor/ceiling', refs });
    }
    // ceiling with nothing above
    const westFirst = (a, b) => (a.roomId === b.roomId ? bbox(a.shape.outer).minX - bbox(b.shape.outer).minX || bbox(a.shape.outer).minY - bbox(b.shape.outer).minY : 0);
    const seenAbove = {};
    for (const u of [...res.uncoveredLower].sort(westFirst)) {
      const room = lowerById.get(u.roomId);
      // several separate uncovered parts of one room get distinct piece ids
      const nAbove = (seenAbove[u.roomId] = (seenAbove[u.roomId] || 0) + 1);
      const pid = `${u.roomId}|above${nAbove > 1 ? `#${nAbove}` : ''}`;
      const ov = project.pieceOverrides[pid] || {};
      const cold = lower.coldAttic === true;
      // a level above exists but has no room here: the ceiling faces an unread part of that level, assumed heated (SPEC 3.2), unless the user overrides it
      const unreadAbove = !cold && !!upper && !ov.outsideSpace && !ov.floorTypeId;
      let type = null;
      let U = null;
      let chain = null;
      if (ov.floorTypeId) type = lib.floorTypes.find((f) => f.id === ov.floorTypeId) || lib.roofTypes.find((f) => f.id === ov.floorTypeId);
      else if (cold || unreadAbove) type = (unreadAbove ? defaultFloorType : topColdType) || defaultFloorType;
      else type = defaultRoof;
      if (type) {
        const tu = types.floors[type.id] ? types.floors[type.id].up : types.roofs[type.id];
        U = tu ? tu.U : null;
        chain = tu ? tu.chain : null;
      } else warnings.push({ level: lower.level, type: cold ? 'top-ceiling-no-type' : 'roof-no-type', id: pid });
      const other = ov.outsideSpace ? { type: 'outside_space', temp: ov.outsideSpace.temp } : unreadAbove ? { type: 'unread' } : { type: 'outside' };
      const kind = cold ? 'ceiling_cold_attic' : unreadAbove ? 'ceiling_to_unread' : 'roof';
      pieces.push({ id: pid, lowerRoomId: u.roomId, upperRoomId: null, lowerLevel: lower.level, upperLevel: null, shape: u.shape, areaM2: u.areaM2, kind, U, override: ov });
      surfaces.push({ id: `piece:${pid}`, kind, level: lower.level, pieceId: pid, roomA: u.roomId, other, areaM2: u.areaM2, U, envelope: !unreadAbove, label: cold ? 'ceiling to cold attic' : unreadAbove ? 'ceiling to unread space' : 'roof', refs: { type: type ? type.id : null, chain } });
    }
    // floor with nothing below (upper rooms of this pair whose area is not over a lower room)
    if (upper) {
      const seenBelow = {};
      for (const u of [...res.uncoveredUpper].sort(westFirst)) {
        const nBelow = (seenBelow[u.roomId] = (seenBelow[u.roomId] || 0) + 1);
        const pid = `${u.roomId}|below${nBelow > 1 ? `#${nBelow}` : ''}`;
        const ov = project.pieceOverrides[pid] || {};
        const ft = ov.floorTypeId ? lib.floorTypes.find((f) => f.id === ov.floorTypeId) : defaultFloorType;
        const tu = ft && types.floors[ft.id] ? types.floors[ft.id].down : null;
        // the level below exists but has no room here: an unread part of it, assumed heated (SPEC 3.2); the user marks a real overhang as outside space
        const unreadBelow = !ov.outsideSpace;
        const other = ov.outsideSpace ? { type: 'outside_space', temp: ov.outsideSpace.temp } : { type: 'unread' };
        pieces.push({ id: pid, lowerRoomId: null, upperRoomId: u.roomId, lowerLevel: null, upperLevel: upper.level, shape: u.shape, areaM2: u.areaM2, kind: unreadBelow ? 'floor_to_unread' : 'floor_to_outside', U: tu ? tu.U : null, override: ov });
        surfaces.push({ id: `piece:${pid}`, kind: 'floor', level: upper.level, pieceId: pid, roomA: u.roomId, other, areaM2: u.areaM2, U: tu ? tu.U : null, envelope: !unreadBelow, label: unreadBelow ? 'floor to unread space' : 'floor to outside space', refs: { floorType: ft ? ft.id : null, chain: tu ? tu.chain : null } });
      }
    }
  }

  // coverage: floor area with nothing below (upper level) or nothing above (a level with a level above it) is unread area, not envelope
  for (let i = 0; i < levels.length; i++) {
    const l = levels[i];
    const noBelow = i > 0 ? pieces.filter((pc) => (pc.kind === 'floor_to_unread' || pc.kind === 'floor_to_outside') && pc.upperLevel === l.level).reduce((s, pc) => s + pc.areaM2, 0) : 0;
    const noAbove = i < levels.length - 1 ? pieces.filter((pc) => (pc.kind === 'roof' || pc.kind === 'ceiling_cold_attic' || pc.kind === 'ceiling_to_unread') && pc.lowerLevel === l.level).reduce((s, pc) => s + pc.areaM2, 0) : 0;
    if (noBelow > 1) warnings.push({ level: l.level, type: 'floor-with-nothing-below', message: `${Math.round(noBelow)} m² has no room below on the level below: assumed heated unless marked as outside space` });
    if (noAbove > 1) warnings.push({ level: l.level, type: 'ceiling-with-nothing-above', message: `${Math.round(noAbove)} m² has no room above: ${l.coldAttic === true ? 'ceiling to cold attic' : 'assumed heated unless marked as outside space'}` });
  }

  // ground slab for the bottom level (SPEC 3.5)
  let slab = null;
  if (bottom && perLevel[bottom.level].roomList.some((r) => !r.sliver)) {
    const pl = perLevel[bottom.level];
    const shapes = pl.roomList.filter((r) => !r.sliver).map((r) => ({ outer: r.face.centerline.map((p) => levelToBuilding(bottom).apply(p)), holes: [] }));
    const union = unionShapes(shapes);
    const ext = pl.walls.filter((w) => pl.edges.some((e) => e.wallId === w.id && (e.left === 'outside' || e.right === 'outside')));
    const avgT = ext.length ? ext.reduce((s, w) => s + w.thicknessMm, 0) / ext.length : 0;
    const footprints = union.map((u) => ({ outer: offsetPolygonInward(u.outer, -avgT / 2), holes: u.holes }));
    const fp = footprints.sort((a, b) => shapeArea(b) - shapeArea(a))[0];
    if (fp && fp.outer.length >= 3) {
      const zones = slabZones(fp, project.config.slabBandWidthM * 1000);
      const slabU = types.slab ? types.slab.U : null;
      if (!types.slab) warnings.push({ level: bottom.level, type: 'slab-no-type' });
      for (const r of pl.roomList) {
        if (r.sliver) continue;
        const pid = `${r.id}|below`;
        const ov = project.pieceOverrides[pid] || {};
        if (ov.outsideSpace) {
          const ft = ov.floorTypeId ? lib.floorTypes.find((f) => f.id === ov.floorTypeId) : defaultFloorType;
          const tu = ft && types.floors[ft.id] ? types.floors[ft.id].down : null;
          surfaces.push({ id: `piece:${pid}`, kind: 'floor', level: bottom.level, pieceId: pid, roomA: r.id, other: { type: 'outside_space', temp: ov.outsideSpace.temp }, areaM2: r.areaM2, U: tu ? tu.U : null, envelope: true, label: 'floor to space outside project', refs: { floorType: ft ? ft.id : null, chain: tu ? tu.chain : null } });
          pieces.push({ id: pid, lowerRoomId: null, upperRoomId: r.id, upperLevel: bottom.level, shape: r.shapeB, areaM2: r.areaM2, kind: 'floor_to_outside_space', U: tu ? tu.U : null, override: ov });
          continue;
        }
        const split = roomSlabSplit(r.shapeB, zones);
        if (split.bandM2 > 1e-6) surfaces.push({ id: `slab:${r.id}:band`, kind: 'slab_band', level: bottom.level, roomA: r.id, other: { type: 'slab_band' }, areaM2: split.bandM2, U: slabU, envelope: true, label: 'slab, perimeter band', refs: { chain: types.slab ? types.slab.chain : null } });
        if (split.innerM2 > 1e-6) surfaces.push({ id: `slab:${r.id}:inner`, kind: 'slab_inner', level: bottom.level, roomA: r.id, other: { type: 'slab_inner' }, areaM2: split.innerM2, U: slabU, envelope: true, label: 'slab, inner zone', refs: { chain: types.slab ? types.slab.chain : null } });
      }
      const slabConstruction = lib.slabType ? ctx.constructions[lib.slabType.constructionId] : null;
      const slabR = slabConstruction ? constructionU(slabConstruction, ctx.materials, 'down').rLayers ?? (slabConstruction.uValueDirect ? 1 / slabConstruction.uValueDirect - 0.17 : 0) : 0;
      slab = { footprint: fp, zones, areaM2: zones.areaM2, perimeterM: zones.perimeterM, check: { footprintAreaM2: zones.areaM2, perimeterM: zones.perimeterM, wallThicknessM: avgT / 1000, slabRf: Math.max(0, slabR || 0), lambda: project.config.soilConductivity } };
    }
  }

  // rooms for the calc model
  for (const l of levels) {
    const pl = perLevel[l.level];
    for (const r of pl.roomList) {
      if (r.sliver) continue;
      const rec = r.record || {};
      const H = pl.heightMm / 1000;
      rooms.push({
        id: r.id,
        level: l.level,
        areaM2: r.areaM2,
        heightM: H,
        volumeM3: r.areaM2 * H,
        heated: rec.heated !== false,
        setpoint: rec.setpoint ?? project.config.indoorSetpoint,
        ventilationLs: rec.ventilationLs,
        supplyTempOverride: rec.supplyTempOverride,
        infiltrationAchOverride: rec.infiltrationAchOverride,
        roomType: rec.roomType || 'other',
        exteriorWallCount: r.exteriorWalls.size,
        exteriorWallsWithOpenings: r.exteriorWallsWithOpenings.size,
        heightAboveGroundM: Math.max(0, (pl.elevationMm - groundElevationMm) / 1000),
      });
    }
  }
  const calcModel = { config: project.config, rooms, surfaces, slabCheck: slab ? slab.check : null };
  let results = null;
  try {
    results = calculate(calcModel);
  } catch (e) {
    warnings.push({ type: 'calc-error', message: String(e.message || e) });
  }
  return { perLevel, pieces, sliverInfo, slab, calcModel, results, warnings, types, elevations, groundElevationMm };
}
