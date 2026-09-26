// Geometry processing (SPEC 3.4, 3.15, 4.5). Pure functions over plain objects.
// Coordinates are millimetres in the floor frame unless stated otherwise.
// Walls: { id, a:{x,y}, b:{x,y}, thicknessMm }. Separators: { id, a, b } (thickness 0).
import polygonClipping from '../../vendor/polygon-clipping/polygon-clipping.esm.js';

export const EPS = 1e-6;

export function dist(p, q) {
  return Math.hypot(p.x - q.x, p.y - q.y);
}
export function sub(p, q) {
  return { x: p.x - q.x, y: p.y - q.y };
}
export function add(p, q) {
  return { x: p.x + q.x, y: p.y + q.y };
}
export function scale(p, s) {
  return { x: p.x * s, y: p.y * s };
}
export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}
export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}
export function len(v) {
  return Math.hypot(v.x, v.y);
}
export function norm(v) {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
}
export function segLength(s) {
  return dist(s.a, s.b);
}
export function angleOf(v) {
  return Math.atan2(v.y, v.x);
}
// Smallest angle between two directions (0..90 degrees), ignoring orientation.
export function angleBetweenDeg(u, v) {
  const a = Math.abs(dot(norm(u), norm(v)));
  return (Math.acos(Math.min(1, a)) * 180) / Math.PI;
}

// Project point p onto segment s. Returns { t, point, distance } with t clamped to [0,1].
export function projectOnSegment(p, s) {
  const d = sub(s.b, s.a);
  const l2 = dot(d, d);
  if (l2 < EPS) return { t: 0, point: { ...s.a }, distance: dist(p, s.a) };
  let t = dot(sub(p, s.a), d) / l2;
  t = Math.max(0, Math.min(1, t));
  const point = add(s.a, scale(d, t));
  return { t, point, distance: dist(p, point) };
}

// Intersection of two segments (with endpoints included). Returns null or { point, t, u }.
export function segIntersect(s1, s2, tol = EPS) {
  const r = sub(s1.b, s1.a);
  const q = sub(s2.b, s2.a);
  const den = cross(r, q);
  const w = sub(s2.a, s1.a);
  if (Math.abs(den) < EPS) return null; // parallel or collinear handled elsewhere
  const t = cross(w, q) / den;
  const u = cross(w, r) / den;
  const tolT = tol / (len(r) || 1);
  const tolU = tol / (len(q) || 1);
  if (t < -tolT || t > 1 + tolT || u < -tolU || u > 1 + tolU) return null;
  return { point: add(s1.a, scale(r, Math.max(0, Math.min(1, t)))), t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)) };
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
export function polygonPerimeter(poly) {
  let l = 0;
  for (let i = 0, n = poly.length; i < n; i++) l += dist(poly[i], poly[(i + 1) % n]);
  return l;
}
export function polygonCentroid(poly) {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
    a += f;
  }
  if (Math.abs(a) < EPS) {
    const s = poly.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: s.x / poly.length, y: s.y / poly.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    if (pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside;
  }
  return inside;
}
export function bbox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// ---------- polygon-clipping adapters (MultiPolygon <-> arrays of rings) ----------
export function toClip(poly) {
  // poly: array of {x,y} (one ring) → polygon-clipping Polygon [[ [x,y],... ]]
  const ring = poly.map((p) => [p.x, p.y]);
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([...ring[0]]);
  return [ring];
}
export function fromClip(multi) {
  // MultiPolygon → array of { outer: [{x,y}], holes: [[{x,y}]] }
  const out = [];
  for (const poly of multi || []) {
    const rings = poly.map((ring) => {
      const pts = ring.map(([x, y]) => ({ x, y }));
      if (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) pts.pop();
      return pts;
    });
    out.push({ outer: rings[0], holes: rings.slice(1) });
  }
  return out;
}
export function multiArea(multi) {
  let a = 0;
  for (const { outer, holes } of fromClip(multi)) {
    a += Math.abs(polygonArea(outer));
    for (const h of holes) a -= Math.abs(polygonArea(h));
  }
  return a;
}
export function shapeToClip(shape) {
  // shape: { outer, holes }
  const rings = [shape.outer.map((p) => [p.x, p.y])];
  for (const h of shape.holes || []) rings.push(h.map((p) => [p.x, p.y]));
  for (const r of rings) if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push([...r[0]]);
  return [rings];
}
export function shapeArea(shape) {
  let a = Math.abs(polygonArea(shape.outer));
  for (const h of shape.holes || []) a -= Math.abs(polygonArea(h));
  return a;
}
export const clip = polygonClipping;

// ---------- Snap tolerance (SPEC 4.5) ----------
// 3 pixels' worth at the drawing's scale, clamped to 20–50 mm, never more than half the thinnest wall type.
export function snapToleranceMm({ mmPerPx, thinnestWallMm, overrideMm = null }) {
  if (overrideMm != null) return overrideMm;
  let t = 3 * (mmPerPx || 8);
  t = Math.max(20, Math.min(50, t));
  if (thinnestWallMm > 0) t = Math.min(t, thinnestWallMm / 2);
  return t;
}

// ---------- Geometry cleanup (SPEC 4.5) ----------
// 1. endpoints within tol of another wall are snapped onto it (endpoint or T-junction);
// 2. overshoots shorter than tol are trimmed;
// 3. near-collinear consecutive segments of the same thickness cluster are merged (angle within 2°).
export function cleanupWalls(wallsIn, tol, options = {}) {
  const sameCluster = options.sameCluster || ((t1, t2) => Math.abs(t1 - t2) <= (options.bandMm ?? 15));
  const log = [];
  let walls = wallsIn.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }));

  // Trim overshoots: an endpoint that crosses another wall within tol of the crossing.
  for (const w of walls) {
    for (const o of walls) {
      if (o === w) continue;
      const x = segIntersect(w, o, 0);
      if (!x) continue;
      const dA = dist(x.point, w.a);
      const dB = dist(x.point, w.b);
      if (dA > 0 && dA <= tol && x.t > 0) {
        w.a = { ...x.point };
        log.push({ type: 'trim', wall: w.id, end: 'a', at: o.id, length: dA });
      } else if (dB > 0 && dB <= tol && x.t < 1) {
        w.b = { ...x.point };
        log.push({ type: 'trim', wall: w.id, end: 'b', at: o.id, length: dB });
      }
    }
  }
  // Snap endpoints: cluster endpoints within tol (union-find) and move each cluster to its centroid,
  // then snap remaining endpoints that lie within tol of another wall's body onto it (T-junction).
  const ends = [];
  walls.forEach((w, wi) => {
    ends.push({ wi, end: 'a', p: w.a });
    ends.push({ wi, end: 'b', p: w.b });
  });
  const parent = ends.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      if (ends[i].wi === ends[j].wi) continue;
      if (dist(ends[i].p, ends[j].p) <= tol) parent[find(i)] = find(j);
    }
  }
  const clusters = new Map();
  ends.forEach((e, i) => {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(e);
  });
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const c = { x: members.reduce((s, m) => s + m.p.x, 0) / members.length, y: members.reduce((s, m) => s + m.p.y, 0) / members.length };
    for (const m of members) {
      const d = dist(m.p, c);
      walls[m.wi][m.end] = { x: c.x, y: c.y };
      if (d > 0) log.push({ type: 'snap', wall: walls[m.wi].id, end: m.end, kind: 'endpoint', distance: d });
    }
  }
  for (const w of walls) {
    for (const end of ['a', 'b']) {
      let best = null;
      for (const o of walls) {
        if (o === w) continue;
        const pr = projectOnSegment(w[end], o);
        if (pr.distance <= tol && pr.distance > 0 && pr.t > 0 && pr.t < 1 && (!best || pr.distance < best.d)) best = { d: pr.distance, point: pr.point, to: o.id };
      }
      if (best) {
        w[end] = { ...best.point };
        log.push({ type: 'snap', wall: w.id, end, kind: 'junction', to: best.to, distance: best.d });
      }
    }
  }

  walls = walls.filter((w) => segLength(w) > tol);

  // Merge near-collinear consecutive segments of the same thickness cluster.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const w1 = walls[i];
        const w2 = walls[j];
        if (!sameCluster(w1.thicknessMm, w2.thicknessMm)) continue;
        if ((w1.separator || false) !== (w2.separator || false)) continue;
        const ang = angleBetweenDeg(sub(w1.b, w1.a), sub(w2.b, w2.a));
        if (ang > 2) continue;
        // shared endpoint?
        const pairs = [
          ['b', 'a'],
          ['b', 'b'],
          ['a', 'a'],
          ['a', 'b'],
        ];
        for (const [e1, e2] of pairs) {
          if (dist(w1[e1], w2[e2]) <= tol) {
            const shared = w1[e1];
            // a third wall at the shared point means a junction: do not merge
            const junction = walls.some((o) => o !== w1 && o !== w2 && (dist(o.a, shared) <= tol || dist(o.b, shared) <= tol || (projectOnSegment(shared, o).distance <= tol && projectOnSegment(shared, o).t > 0 && projectOnSegment(shared, o).t < 1)));
            if (junction) continue;
            const farA = e1 === 'a' ? w1.b : w1.a;
            const farB = e2 === 'a' ? w2.b : w2.a;
            const m = { ...w1, a: { ...farA }, b: { ...farB }, mergedFrom: [...(w1.mergedFrom || [w1.id]), ...(w2.mergedFrom || [w2.id])] };
            m.thicknessMm = (w1.thicknessMm * segLength(w1) + w2.thicknessMm * segLength(w2)) / (segLength(w1) + segLength(w2));
            walls.splice(j, 1);
            walls.splice(i, 1, m);
            log.push({ type: 'merge', walls: [w1.id, w2.id], into: m.id });
            merged = true;
            break outer;
          }
        }
      }
    }
  }
  return { walls, log };
}

// ---------- Room formation from the wall graph ----------
// Builds a planar arrangement of all wall centerlines and separators, traces its faces and
// returns bounded faces as rooms. Each room has the centerline polygon, the inside-face polygon
// (offset by half the thickness of each bounding wall, SPEC 3.15) and its bounding edges.
export function buildRooms(walls, separators = [], options = {}) {
  const tol = options.tol ?? 20;
  const segs = [];
  for (const w of walls) segs.push({ id: w.id, a: w.a, b: w.b, thicknessMm: w.thicknessMm || 0, separator: false });
  for (const s of separators) segs.push({ id: s.id, a: s.a, b: s.b, thicknessMm: 0, separator: true });

  // Split at intersections.
  const cuts = segs.map(() => [0, 1]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const x = segIntersect(segs[i], segs[j], tol);
      if (x) {
        cuts[i].push(x.t);
        cuts[j].push(x.u);
        continue;
      }
      // collinear overlaps / touching endpoints on the body of the other
      for (const [p, q, ci] of [
        [segs[i], segs[j], j],
        [segs[j], segs[i], i],
      ]) {
        for (const end of ['a', 'b']) {
          const pr = projectOnSegment(p[end], q);
          if (pr.distance <= tol && pr.t > 0 && pr.t < 1) cuts[ci].push(pr.t);
        }
      }
    }
  }
  const key = (p) => `${Math.round(p.x / (tol / 2))}:${Math.round(p.y / (tol / 2))}`;
  const vertices = [];
  const vIndex = new Map();
  const vid = (p) => {
    const k = key(p);
    if (vIndex.has(k)) return vIndex.get(k);
    // also merge with any existing vertex within tol (handles grid boundary cases)
    for (let i = 0; i < vertices.length; i++) if (dist(vertices[i], p) <= tol) return i;
    vertices.push({ x: p.x, y: p.y });
    vIndex.set(k, vertices.length - 1);
    return vertices.length - 1;
  };
  const edges = [];
  const edgeKey = new Set();
  segs.forEach((s, si) => {
    const ts = [...new Set(cuts[si].map((t) => Math.max(0, Math.min(1, t))))].sort((a, b) => a - b);
    const d = sub(s.b, s.a);
    for (let k = 0; k + 1 < ts.length; k++) {
      const p = add(s.a, scale(d, ts[k]));
      const q = add(s.a, scale(d, ts[k + 1]));
      const u = vid(p);
      const v = vid(q);
      if (u === v) continue;
      const ek = u < v ? `${u}-${v}` : `${v}-${u}`;
      if (edgeKey.has(ek)) continue;
      edgeKey.add(ek);
      edges.push({ id: edges.length, u, v, wallId: s.id, thicknessMm: s.thicknessMm, separator: s.separator, t0: ts[k], t1: ts[k + 1] });
    }
  });

  // Prune dangling edges (degree-1 vertices) iteratively; they bound no room.
  const alive = edges.map(() => true);
  let changed = true;
  while (changed) {
    changed = false;
    const deg = new Array(vertices.length).fill(0);
    edges.forEach((e, i) => {
      if (!alive[i]) return;
      deg[e.u]++;
      deg[e.v]++;
    });
    edges.forEach((e, i) => {
      if (alive[i] && (deg[e.u] <= 1 || deg[e.v] <= 1)) {
        alive[i] = false;
        changed = true;
      }
    });
  }
  const dangling = edges.filter((e, i) => !alive[i]);
  const live = edges.filter((e, i) => alive[i]);

  // Half-edges and angular ordering.
  const out = new Map(); // vertex → [{he}]
  const halfEdges = [];
  for (const e of live) {
    const h1 = { id: halfEdges.length, from: e.u, to: e.v, edge: e, side: 'left' };
    const h2 = { id: halfEdges.length + 1, from: e.v, to: e.u, edge: e, side: 'right' };
    h1.twin = h2;
    h2.twin = h1;
    halfEdges.push(h1, h2);
    if (!out.has(e.u)) out.set(e.u, []);
    if (!out.has(e.v)) out.set(e.v, []);
    out.get(e.u).push(h1);
    out.get(e.v).push(h2);
  }
  for (const [v, list] of out) {
    list.sort((h1, h2) => angleOf(sub(vertices[h1.to], vertices[h1.from])) - angleOf(sub(vertices[h2.to], vertices[h2.from])));
    list.forEach((h, i) => (h.orderAt = i));
  }
  // next half-edge: at vertex h.to, take the edge just clockwise of the twin (previous in CCW order).
  for (const h of halfEdges) {
    const list = out.get(h.to);
    const i = h.twin.orderAt;
    h.next = list[(i - 1 + list.length) % list.length];
  }
  const faces = [];
  const visited = new Set();
  for (const h of halfEdges) {
    if (visited.has(h.id)) continue;
    const loop = [];
    let cur = h;
    let guard = 0;
    while (!visited.has(cur.id) && guard++ < 100000) {
      visited.add(cur.id);
      loop.push(cur);
      cur = cur.next;
    }
    const poly = loop.map((he) => vertices[he.from]);
    const area = polygonArea(poly);
    faces.push({ loop, poly, area });
  }
  // With the "next = clockwise neighbour of the twin" (sharpest left turn) rule every face keeps its interior
  // on the left: bounded faces have positive signed area, the outer face and the outside of islands negative.
  // The global outer face is the negative face with the largest |area|; other negative faces are islands.
  const bounded = faces.filter((f) => f.area > EPS);
  const negative = faces.filter((f) => f.area < -EPS).sort((f1, f2) => f1.area - f2.area);
  const outerFace = negative[0] || null;
  const holesCandidates = negative.slice(1);

  // Rooms from bounded faces.
  const rooms = bounded.map((f, i) => {
    let poly = f.poly;
    if (polygonArea(poly) < 0) poly = [...poly].reverse();
    const orientationFlip = polygonArea(f.poly) < 0;
    let edgesInfo = f.loop.map((he) => ({ wallId: he.edge.wallId, edgeId: he.edge.id, separator: he.edge.separator, thicknessMm: he.edge.thicknessMm, side: he.side, from: vertices[he.from], to: vertices[he.to] }));
    if (orientationFlip) {
      // keep edges[i] aligned with the polygon edge poly[i] → poly[i+1]
      edgesInfo = [...edgesInfo].reverse().map(flipEdge);
      const first = edgesInfo.pop();
      edgesInfo.unshift(first);
    }
    const inside = insidePolygon(poly, edgesInfo);
    return { faceIndex: i, centerline: poly, edges: edgesInfo, inside, holes: [] };
  });
  // Assign holes (islands) to the smallest room containing them.
  for (const h of holesCandidates) {
    const c = polygonCentroid(h.poly);
    let best = null;
    for (const r of rooms) {
      if (pointInPolygon(c, r.centerline)) {
        const a = Math.abs(polygonArea(r.centerline));
        // the island's own interior face has the same loop area: it is not the containing room
        if (a > Math.abs(h.area) + 1e-3 && (!best || a < best.a)) best = { r, a };
      }
    }
    if (best) {
      const hp = polygonArea(h.poly) < 0 ? [...h.poly].reverse() : h.poly;
      // hole outer boundary is the outside face of the island walls: offset outward by half thickness
      const info = h.loop.map((he) => ({ wallId: he.edge.wallId, thicknessMm: he.edge.thicknessMm, separator: he.edge.separator, from: vertices[he.from], to: vertices[he.to] }));
      best.r.holes.push({ centerline: hp, inside: insidePolygon(hp, polygonArea(h.poly) < 0 ? [...info].reverse().map(flipEdge) : info, -1) });
    }
  }
  for (const r of rooms) {
    let area = Math.abs(polygonArea(r.inside));
    for (const h of r.holes) area -= Math.abs(polygonArea(h.inside));
    r.areaM2 = area / 1e6;
    r.centroid = polygonCentroid(r.inside);
  }

  // Wall sides: for each live edge, which room (or outside) lies on each side.
  const edgeSides = new Map();
  for (const f of faces) {
    const isOuter = f === outerFace;
    const roomIdx = bounded.indexOf(f);
    for (const he of f.loop) {
      const rec = edgeSides.get(he.edge.id) || {};
      rec[he.side] = isOuter ? 'outside' : roomIdx >= 0 ? roomIdx : 'hole';
      edgeSides.set(he.edge.id, rec);
    }
  }
  const edgeList = live.map((e) => {
    const sides = edgeSides.get(e.id) || {};
    return { id: e.id, wallId: e.wallId, separator: e.separator, thicknessMm: e.thicknessMm, a: vertices[e.u], b: vertices[e.v], t0: e.t0, t1: e.t1, left: sides.left ?? null, right: sides.right ?? null };
  });
  return { rooms, edges: edgeList, dangling: dangling.map((e) => ({ id: e.id, wallId: e.wallId, a: vertices[e.u], b: vertices[e.v] })), vertices };
}

function flipEdge(e) {
  return { ...e, from: e.to, to: e.from, side: e.side === 'left' ? 'right' : 'left' };
}

// Offset a CCW polygon inward by half the thickness of each edge's wall (sign=+1) or outward (sign=-1).
export function insidePolygon(poly, edgesInfo, sign = 1) {
  const n = poly.length;
  if (n < 3) return poly.map((p) => ({ ...p }));
  const ccw = polygonArea(poly) > 0;
  // With y-down screen coordinates a positive signed area means clockwise on screen; the inward normal
  // is computed from the orientation so both conventions work.
  const lines = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const d = norm(sub(q, p));
    // left normal of the direction; for a CCW polygon (positive area) the interior is on the left.
    let nrm = ccw ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
    const off = ((edgesInfo[i] && edgesInfo[i].thicknessMm) || 0) / 2;
    const shift = scale(nrm, off * sign);
    lines.push({ p: add(p, shift), d });
  }
  const outPts = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const den = cross(l1.d, l2.d);
    if (Math.abs(den) < 1e-9) {
      outPts.push({ ...l2.p });
      continue;
    }
    const t = cross(sub(l2.p, l1.p), l2.d) / den;
    const pt = add(l1.p, scale(l1.d, t));
    // clamp absurd miter spikes at very acute angles
    if (dist(pt, poly[i]) > 10 * Math.max(1, Math.max(lines[i].p ? 0 : 0, 0) + Math.max(...edgesInfo.map((e) => (e && e.thicknessMm) || 0)))) outPts.push({ ...l2.p });
    else outPts.push(pt);
  }
  return outPts;
}

// ---------- Minimum width of a polygon (rotating calipers on the convex hull) ----------
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(p, lower[lower.length - 2])) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(p, upper[upper.length - 2])) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
export function minWidth(poly) {
  const hull = convexHull(poly);
  if (hull.length < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i];
    const q = hull[(i + 1) % hull.length];
    const d = norm(sub(q, p));
    let maxD = 0;
    for (const r of hull) {
      const dd = Math.abs(cross(d, sub(r, p)));
      if (dd > maxD) maxD = dd;
    }
    if (maxD < best) best = maxD;
  }
  return best;
}

// Length of boundary shared between two shapes (collinear overlapping edges within tol).
export function sharedEdgeLength(polyA, polyB, tol = 5) {
  let total = 0;
  const ringsA = [polyA.outer, ...(polyA.holes || [])];
  const ringsB = [polyB.outer, ...(polyB.holes || [])];
  for (const ra of ringsA) {
    for (let i = 0; i < ra.length; i++) {
      const a1 = ra[i];
      const a2 = ra[(i + 1) % ra.length];
      const da = norm(sub(a2, a1));
      const la = dist(a1, a2);
      if (la < EPS) continue;
      for (const rb of ringsB) {
        for (let j = 0; j < rb.length; j++) {
          const b1 = rb[j];
          const b2 = rb[(j + 1) % rb.length];
          if (angleBetweenDeg(da, sub(b2, b1)) > 1) continue;
          // distance of b1 from line a
          if (Math.abs(cross(da, sub(b1, a1))) > tol) continue;
          const t1 = dot(sub(b1, a1), da);
          const t2 = dot(sub(b2, a1), da);
          const lo = Math.max(0, Math.min(t1, t2));
          const hi = Math.min(la, Math.max(t1, t2));
          if (hi > lo) total += hi - lo;
        }
      }
    }
  }
  return total;
}

// ---------- Floor / ceiling pieces between two floors (SPEC 3.4) ----------
// lowerRooms/upperRooms: [{ id, shape: {outer, holes} }] in the building frame (mm).
// Returns { pieces: [{ id, lowerRoomId, upperRoomId, shape, areaM2 }], absorbed: n, uncoveredLower: [...], uncoveredUpper: [...] }
export function floorPieces(lowerRooms, upperRooms, { sliverWidthMm = 150, sliverAreaM2 = 0.1 } = {}) {
  let pieces = [];
  for (const lr of lowerRooms) {
    for (const ur of upperRooms) {
      const inter = polygonClipping.intersection(shapeToClip(lr.shape), shapeToClip(ur.shape));
      for (const shape of fromClip(inter)) {
        const area = shapeArea(shape);
        if (area <= EPS) continue;
        pieces.push({ id: `${lr.id}|${ur.id}`, lowerRoomId: lr.id, upperRoomId: ur.id, shape, areaM2: area / 1e6 });
      }
    }
  }
  // Absorb slivers into the neighbouring piece they share the longest edge with.
  let absorbed = 0;
  const absorbedList = [];
  let progress = true;
  while (progress) {
    progress = false;
    const idx = pieces.findIndex((p) => !p.isolatedSliver && isSliver(p, sliverWidthMm, sliverAreaM2));
    if (idx < 0) break;
    const sliver = pieces[idx];
    let best = null;
    for (let j = 0; j < pieces.length; j++) {
      if (j === idx) continue;
      const other = pieces[j];
      if (isSliver(other, sliverWidthMm, sliverAreaM2) && pieces.length > 2) continue;
      const shared = sharedEdgeLength(sliver.shape, other.shape, 5);
      if (shared > 0 && (!best || shared > best.shared)) best = { j, shared };
    }
    if (!best) {
      // no neighbour: keep it (rare: isolated tiny overlap) but mark it
      sliver.isolatedSliver = true;
      progress = true;
      continue;
    }
    const target = pieces[best.j];
    const union = polygonClipping.union(shapeToClip(target.shape), shapeToClip(sliver.shape));
    const shapes = fromClip(union);
    const shape = shapes.length === 1 ? shapes[0] : shapes.sort((a, b) => shapeArea(b) - shapeArea(a))[0];
    target.shape = shape;
    target.areaM2 = shapeArea(shape) / 1e6;
    target.absorbed = [...(target.absorbed || []), { id: sliver.id, areaM2: sliver.areaM2 }];
    absorbedList.push({ sliver: sliver.id, into: target.id, shape: sliver.shape });
    pieces.splice(idx, 1);
    absorbed++;
    progress = true;
  }
  // Uncovered areas: parts of rooms with nothing on the other side.
  const uncoveredLower = [];
  for (const lr of lowerRooms) {
    let rest = shapeToClip(lr.shape);
    for (const p of pieces) if (p.lowerRoomId === lr.id) rest = polygonClipping.difference(rest, shapeToClip(p.shape));
    for (const shape of fromClip(rest)) {
      const a = shapeArea(shape);
      if (a / 1e6 > sliverAreaM2 && minWidth(shape.outer) >= sliverWidthMm) uncoveredLower.push({ roomId: lr.id, shape, areaM2: a / 1e6 });
    }
  }
  const uncoveredUpper = [];
  for (const ur of upperRooms) {
    let rest = shapeToClip(ur.shape);
    for (const p of pieces) if (p.upperRoomId === ur.id) rest = polygonClipping.difference(rest, shapeToClip(p.shape));
    for (const shape of fromClip(rest)) {
      const a = shapeArea(shape);
      if (a / 1e6 > sliverAreaM2 && minWidth(shape.outer) >= sliverWidthMm) uncoveredUpper.push({ roomId: ur.id, shape, areaM2: a / 1e6 });
    }
  }
  return { pieces, absorbed, absorbedList, uncoveredLower, uncoveredUpper };
}

export function isSliver(piece, sliverWidthMm, sliverAreaM2) {
  if (piece.areaM2 < sliverAreaM2) return true;
  return minWidth(piece.shape.outer) < sliverWidthMm;
}

// ---------- Ground slab zones (SPEC 3.5) ----------
// footprint: { outer, holes } of the ground floor (building frame, mm). bandWidthMm: perimeter band width.
// Returns { band: MultiPolygon, inner: MultiPolygon, areaM2, perimeterM }
export function slabZones(footprint, bandWidthMm) {
  const fp = shapeToClip(footprint);
  const innerPoly = offsetPolygonInward(footprint.outer, bandWidthMm);
  let inner = innerPoly.length >= 3 ? polygonClipping.intersection(fp, toClip(innerPoly)) : [];
  // holes (courtyards) also have a band around them
  for (const h of footprint.holes || []) {
    const grown = offsetPolygonInward([...h].reverse(), -bandWidthMm);
    if (grown.length >= 3) inner = polygonClipping.difference(inner, toClip(grown));
  }
  const band = polygonClipping.difference(fp, inner);
  return { band, inner, areaM2: shapeArea(footprint) / 1e6, perimeterM: polygonPerimeter(footprint.outer) / 1000 };
}

// Simple miter offset of a simple polygon; positive d shrinks (inward). Self-intersections are cleaned by union.
export function offsetPolygonInward(poly, d) {
  const n = poly.length;
  if (n < 3) return [];
  const ccw = polygonArea(poly) > 0;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const dir = norm(sub(q, p));
    const nrm = ccw ? { x: -dir.y, y: dir.x } : { x: dir.y, y: -dir.x };
    lines.push({ p: add(p, scale(nrm, d)), d: dir });
  }
  const pts = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const den = cross(l1.d, l2.d);
    if (Math.abs(den) < 1e-9) {
      pts.push({ ...l2.p });
      continue;
    }
    const t = cross(sub(l2.p, l1.p), l2.d) / den;
    pts.push(add(l1.p, scale(l1.d, t)));
  }
  // Clean self-intersections: keep the largest resulting polygon that still has the same orientation.
  try {
    const cleaned = fromClip(polygonClipping.union(toClip(pts)));
    if (!cleaned.length) return [];
    const largest = cleaned.sort((a, b) => shapeArea(b) - shapeArea(a))[0];
    // reject offsets that inverted (area larger than original when shrinking)
    if (d > 0 && shapeArea(largest) > Math.abs(polygonArea(poly))) return [];
    return largest.outer;
  } catch {
    return pts;
  }
}

// Split a room polygon by the slab zones: returns { bandM2, innerM2 }.
export function roomSlabSplit(shape, zones) {
  const s = shapeToClip(shape);
  const band = multiArea(polygonClipping.intersection(s, zones.band));
  const inner = multiArea(polygonClipping.intersection(s, zones.inner));
  return { bandM2: band / 1e6, innerM2: inner / 1e6 };
}

// Union of a set of shapes (building footprint from the rooms of a floor, grown by wall thickness).
export function unionShapes(shapes) {
  let acc = null;
  for (const s of shapes) {
    const c = shapeToClip(s);
    acc = acc ? polygonClipping.union(acc, c) : c;
  }
  return acc ? fromClip(acc) : [];
}

// Similarity transform helpers (used by scale and alignment): {s, sx, sy, rot, tx, ty}
export function applyTransform(T, p) {
  const sx = T.sx ?? T.s ?? 1;
  const sy = T.sy ?? T.s ?? 1;
  const c = Math.cos(T.rot || 0);
  const s = Math.sin(T.rot || 0);
  const x = p.x * sx;
  const y = p.y * sy;
  return { x: c * x - s * y + (T.tx || 0), y: s * x + c * y + (T.ty || 0) };
}
export function invertTransform(T) {
  const sx = T.sx ?? T.s ?? 1;
  const sy = T.sy ?? T.s ?? 1;
  const rot = -(T.rot || 0);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const tx = -(T.tx || 0);
  const ty = -(T.ty || 0);
  // inverse: first untranslate, then unrotate, then unscale
  return {
    apply(p) {
      const x = p.x + tx;
      const y = p.y + ty;
      const rx = c * x - s * y;
      const ry = s * x + c * y;
      return { x: rx / sx, y: ry / sy };
    },
  };
}
export function transformShape(T, shape) {
  return { outer: shape.outer.map((p) => applyTransform(T, p)), holes: (shape.holes || []).map((h) => h.map((p) => applyTransform(T, p))) };
}
