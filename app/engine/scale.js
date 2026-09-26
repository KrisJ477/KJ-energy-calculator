// Scale logic (SPEC 4.4): scale from a known measurement, reference walls, per-floor correction
// with the 1 % / 2 % thresholds, similarity transform from point pairs (manual alignment),
// vertical-drawing sanity checks. Pure functions.
import { dist, sub, add, scale as vscale, norm, angleBetweenDeg, bbox, angleOf, cross, dot } from './geometry.js';

// Scale from a known real length between two image points. Returns mm per px and the record (SPEC 7).
export function scaleFromMeasurement({ pxA, pxB, realMm, source, label }) {
  const px = dist(pxA, pxB);
  if (!(px > 0) || !(realMm > 0)) return null;
  return { mmPerPx: realMm / px, pxPerM: (1000 * px) / realMm, method: source || 'measurement', label: label || `${(realMm / 1000).toFixed(2)} m`, pxA, pxB, realMm };
}

// Sanity check of a scale against a printed scale stamp (e.g. "1:100") and the drawing's dpi, never used to set scale.
export function scaleStampCheck(mmPerPx, stampDenominator, dpi) {
  if (!stampDenominator || !dpi) return null;
  const expectedMmPerPx = (25.4 / dpi) * stampDenominator;
  const deviationPct = ((mmPerPx - expectedMmPerPx) / expectedMmPerPx) * 100;
  return { expectedMmPerPx, deviationPct, flagged: Math.abs(deviationPct) > 5 };
}

function wallLength(w) {
  return dist(w.a, w.b);
}
function wallDir(w) {
  return norm(sub(w.b, w.a));
}
function wallMid(w) {
  return vscale(add(w.a, w.b), 0.5);
}

// Choose two reference walls (SPEC 4.4): at an angle to each other (>= minAngleDeg), long, present on other floors,
// preferably dimensioned. Each wall may carry { dimensioned: bool, presentOnFloors: n, clarity: 0..1 }.
export function pickReferenceWalls(walls, { minAngleDeg = 30, floorCount = 1 } = {}) {
  const scored = walls
    .filter((w) => wallLength(w) > 0)
    .map((w) => {
      const L = wallLength(w);
      const presence = floorCount > 1 ? (w.presentOnFloors ?? 1) / floorCount : 1;
      const score = L * (0.5 + 0.5 * presence) * (w.dimensioned ? 1.5 : 1) * (0.5 + 0.5 * (w.clarity ?? 1));
      return { w, L, score };
    })
    .sort((a, b) => b.score - a.score);
  if (scored.length < 2) return null;
  const first = scored[0];
  let second = null;
  for (const c of scored.slice(1)) {
    if (angleBetweenDeg(wallDir(first.w), wallDir(c.w)) >= minAngleDeg) {
      second = c;
      break;
    }
  }
  if (!second) return null;
  const why = (c) => {
    const parts = [`length ${(c.L / 1000).toFixed(2)} m`];
    if (c.w.dimensioned) parts.push('carries a written dimension');
    if (floorCount > 1) parts.push(`found on ${c.w.presentOnFloors ?? 1} of ${floorCount} floors`);
    if (c.w.clarity != null) parts.push(`clarity ${Math.round(c.w.clarity * 100)} %`);
    return parts.join(', ');
  };
  return {
    walls: [first.w, second.w],
    lengths: [first.L, second.L],
    angleDeg: angleBetweenDeg(wallDir(first.w), wallDir(second.w)),
    reasons: [why(first), why(second)],
  };
}

// Coarse translation that brings the bounding box centre of a floor onto the reference floor.
export function coarseAlign(refWalls, walls) {
  const pts = (ws) => ws.flatMap((w) => [w.a, w.b]);
  const br = bbox(pts(refWalls));
  const bw = bbox(pts(walls));
  return { tx: (br.minX + br.maxX) / 2 - (bw.minX + bw.maxX) / 2, ty: (br.minY + br.maxY) / 2 - (bw.minY + bw.maxY) / 2 };
}

// Find the wall on another floor that corresponds to a reference wall: similar direction (< maxAngleDeg),
// nearby midpoint after coarse alignment, similar length. Returns { wall, score } or null.
export function matchWall(refWall, walls, { offset = { tx: 0, ty: 0 }, maxAngleDeg = 10, maxMidDistMm = 3000, lengthRatioMax = 1.3 } = {}) {
  const rd = wallDir(refWall);
  const rm = wallMid(refWall);
  const rl = wallLength(refWall);
  let best = null;
  for (const w of walls) {
    const L = wallLength(w);
    if (!(L > 0)) continue;
    const ang = angleBetweenDeg(rd, wallDir(w));
    if (ang > maxAngleDeg) continue;
    const ratio = Math.max(L / rl, rl / L);
    if (ratio > lengthRatioMax) continue;
    const m = wallMid(w);
    const md = dist({ x: m.x + offset.tx, y: m.y + offset.ty }, rm);
    if (md > maxMidDistMm) continue;
    const score = md / maxMidDistMm + ang / maxAngleDeg + (ratio - 1);
    if (!best || score < best.score) best = { wall: w, score, midDistMm: md, angleDeg: ang, lengthRatio: ratio };
  }
  return best;
}

// Per-floor scale correction against the reference floor (SPEC 4.4).
// refLengths: [L1, L2] on the reference floor; measured: [l1, l2] on this floor (same units).
export function floorCorrection({ refLengths, measured, noCorrectionPct = 1, agreementPct = 2 }) {
  const corrections = refLengths.map((L, i) => (measured[i] > 0 ? (L / measured[i] - 1) * 100 : null));
  if (corrections.some((c) => c == null)) return { status: 'flagged', reason: 'reference wall not found', corrections, factor: 1 };
  const [c1, c2] = corrections;
  if (Math.abs(c1) <= noCorrectionPct && Math.abs(c2) <= noCorrectionPct) return { status: 'none', corrections, factor: 1 };
  if (Math.abs(c1 - c2) <= agreementPct) {
    const avg = (c1 + c2) / 2;
    return { status: 'applied', corrections, factor: 1 + avg / 100, appliedPct: avg };
  }
  return { status: 'flagged', reason: 'corrections disagree', corrections, factor: 1 };
}

// Exact similarity transform (uniform scale, rotation, translation) mapping moving-layer points onto reference points
// from two point pairs: pairs = [{ ref, mov }, { ref, mov }]. Returns { s, rot, tx, ty } such that
// applyTransform(T, mov) = ref (see geometry.applyTransform).
export function similarityFromPairs(pairs) {
  const [p1, p2] = pairs;
  const dm = sub(p2.mov, p1.mov);
  const dr = sub(p2.ref, p1.ref);
  const lm = Math.hypot(dm.x, dm.y);
  const lr = Math.hypot(dr.x, dr.y);
  if (!(lm > 0) || !(lr > 0)) return null;
  const s = lr / lm;
  const rot = angleOf(dr) - angleOf(dm);
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  const mx = p1.mov.x * s;
  const my = p1.mov.y * s;
  const tx = p1.ref.x - (c * mx - sn * my);
  const ty = p1.ref.y - (sn * mx + c * my);
  return { s, rot, tx, ty };
}

// Live feedback for manual alignment: lengths of the two reference walls as currently placed vs the reference floor.
export function referenceDeviation(refLengths, movingWalls, T) {
  const { applyTransform } = transformFns();
  return movingWalls.map((w, i) => {
    const a = applyTransform(T, w.a);
    const b = applyTransform(T, w.b);
    const L = dist(a, b);
    return { lengthMm: L, refMm: refLengths[i], deviationPct: refLengths[i] ? ((L - refLengths[i]) / refLengths[i]) * 100 : null };
  });
}
function transformFns() {
  return {
    applyTransform(T, p) {
      const sx = T.sx ?? T.s ?? 1;
      const sy = T.sy ?? T.s ?? 1;
      const c = Math.cos(T.rot || 0);
      const s = Math.sin(T.rot || 0);
      const x = p.x * sx;
      const y = p.y * sy;
      return { x: c * x - s * y + (T.tx || 0), y: s * x + c * y + (T.ty || 0) };
    },
  };
}

// Vertical drawing sanity checks (SPEC 4.4): door heights within the configured range, printed scale bar must agree.
export function verticalSanity({ doorHeightsM = [], doorMinM = 2.0, doorMaxM = 2.2, scaleBarMmPerPx = null, mmPerPx = null, agreementPct = 2 }) {
  const flags = [];
  for (const h of doorHeightsM) if (h < doorMinM || h > doorMaxM) flags.push({ type: 'door-height', valueM: h, range: [doorMinM, doorMaxM] });
  if (scaleBarMmPerPx && mmPerPx) {
    const dev = ((mmPerPx - scaleBarMmPerPx) / scaleBarMmPerPx) * 100;
    if (Math.abs(dev) > agreementPct) flags.push({ type: 'scale-bar', deviationPct: dev });
  }
  return { ok: flags.length === 0, flags };
}

// Propose the reference floor (SPEC 4.4): the floor with the best drawing for the job.
// levels: [{ level, hasWrittenDimensions, hasScaleBar, clarity (0..1), completeness (0..1) }]
export function proposeReferenceFloor(levels) {
  let best = null;
  for (const l of levels) {
    const score = (l.hasWrittenDimensions ? 3 : 0) + (l.hasScaleBar ? 2 : 0) + (l.clarity ?? 0.5) + (l.completeness ?? 0.5);
    if (!best || score > best.score) best = { level: l.level, score, why: [l.hasWrittenDimensions ? 'written dimensions' : null, l.hasScaleBar ? 'scale bar' : null, `clarity ${Math.round((l.clarity ?? 0.5) * 100)} %`, `completeness ${Math.round((l.completeness ?? 0.5) * 100)} %`].filter(Boolean).join(', ') };
  }
  return best;
}

// Match line between two sheets of the same floor: proposal from a shared wall in the overlap strip.
// Returns the translation that places sheet B on sheet A (both already scaled to mm), from one shared wall pair.
export function sheetOffsetFromSharedWall(wallA, wallB) {
  const ma = wallMid(wallA);
  const mb = wallMid(wallB);
  const ang = angleBetweenDeg(wallDir(wallA), wallDir(wallB));
  return { tx: ma.x - mb.x, ty: ma.y - mb.y, angleDeg: ang, ok: ang < 5 };
}

export { cross, dot };
