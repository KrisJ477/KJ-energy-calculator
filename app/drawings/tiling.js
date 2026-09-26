// Rendering resolution and tiling (SPEC 4.2). All values come from the settings page.

// dpi that gives the target mm per pixel for a drawing at 1:denominator.
export function dpiForTarget(targetMmPerPx, denominator) {
  const paperMmPerPx = targetMmPerPx / denominator;
  return 25.4 / paperMmPerPx;
}

// Tile size in px from the model's image limit: as large as accepted without downscaling, square.
export function tileSizePx({ tileMaxLongEdgePx = 2576, tileMaxMegapixels = 3.75 } = {}) {
  const side = Math.floor(Math.sqrt(tileMaxMegapixels * 1e6));
  return Math.min(side, tileMaxLongEdgePx);
}

// Tile grid over a crop rectangle (sheet px). overlapPx between tiles. Returns [{ x, y, w, h, col, row }].
export function tileGrid(crop, tilePx, overlapPx) {
  const step = Math.max(1, tilePx - overlapPx);
  const tiles = [];
  const cols = Math.max(1, Math.ceil((crop.w - overlapPx) / step));
  const rows = Math.max(1, Math.ceil((crop.h - overlapPx) / step));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let x = crop.x + c * step;
      let y = crop.y + r * step;
      let w = Math.min(tilePx, crop.x + crop.w - x);
      let h = Math.min(tilePx, crop.y + crop.h - y);
      // pull the last tiles back so they keep full size where the crop allows
      if (w < tilePx && crop.w >= tilePx) {
        x = crop.x + crop.w - tilePx;
        w = tilePx;
      }
      if (h < tilePx && crop.h >= tilePx) {
        y = crop.y + crop.h - tilePx;
        h = tilePx;
      }
      tiles.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), col: c, row: r });
    }
  }
  // dedupe (pull-back can create identical tiles)
  const seen = new Set();
  return tiles.filter((t) => {
    const k = `${t.x},${t.y}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Does a tile rectangle intersect a polygon (building outline) or rectangle? Used to skip empty tiles.
export function rectIntersectsPolygon(rect, poly) {
  if (!poly || poly.length < 3) return true;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  const inRect = (p) => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
  if (poly.some(inRect)) return true;
  const inPoly = (p) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const pi = poly[i];
      const pj = poly[j];
      if (pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside;
    }
    return inside;
  };
  if (corners.some(inPoly)) return true;
  // edge crossings
  const segs = corners.map((c, i) => [c, corners[(i + 1) % 4]]);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    for (const [c, d] of segs) if (segmentsCross(a, b, c, d)) return true;
  }
  return false;
}
function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

// Overview image size: whole crop scaled to the model limit.
export function overviewScale(crop, { tileMaxLongEdgePx = 2576, tileMaxMegapixels = 3.75 } = {}) {
  const fLong = tileMaxLongEdgePx / Math.max(crop.w, crop.h);
  const fArea = Math.sqrt((tileMaxMegapixels * 1e6) / (crop.w * crop.h));
  return Math.min(1, fLong, fArea);
}
