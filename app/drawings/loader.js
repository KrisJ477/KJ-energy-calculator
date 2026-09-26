// Drawing input (SPEC 2, 4.2): PDF pages rendered with PDF.js, TIFF via UTIF, PNG/JPG via the browser.
// Rasters are stored as PNG blobs in IndexedDB; large vector PDFs are rendered per region on demand.
import { putBlob, getBlob } from '../persist/autosave.js';

let pdfjsPromise = null;
export function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../../vendor/pdfjs/pdf.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

export const MAX_STORED_RASTER_PX = 110e6; // above this a vector PDF is rendered per region on demand
export const MAX_DISPLAY_LONG_EDGE = 6000;

const pdfCache = new Map(); // drawingId → PDFDocumentProxy

export async function openPdf(drawingId) {
  if (pdfCache.has(drawingId)) return pdfCache.get(drawingId);
  const blob = await getBlob(`src:${drawingId}`);
  if (!blob) throw new Error('source PDF missing from browser storage');
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  pdfCache.set(drawingId, doc);
  return doc;
}

// Inspect a PDF page: size in points, embedded image dimensions (scans), text presence, scale stamp text.
export async function inspectPdfPage(doc, pageIndex) {
  const page = await doc.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale: 1 });
  const text = await page.getTextContent();
  const items = text.items.filter((it) => it.str && it.str.trim());
  let biggestImage = null;
  try {
    const ops = await page.getOperatorList();
    const lib = await pdfjs();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === lib.OPS.paintImageXObject) {
        const name = ops.argsArray[i][0];
        let img = null;
        try {
          img = page.objs.get(name);
        } catch {
          img = null;
        }
        if (!img) {
          await new Promise((resolve) => page.objs.get(name, (o) => { img = o; resolve(); }));
        }
        if (img && img.width && (!biggestImage || img.width * img.height > biggestImage.width * biggestImage.height)) biggestImage = { width: img.width, height: img.height };
      }
    }
  } catch (e) {
    console.warn('operator list failed', e);
  }
  const widthIn = vp.width / 72;
  const heightIn = vp.height / 72;
  const isScan = !!biggestImage && biggestImage.width >= vp.width * 2 && items.length < 20;
  const nativeDpi = isScan ? Math.round(biggestImage.width / widthIn) : null;
  const stamp = findScaleStamp(items.map((i) => i.str));
  return { page, widthPt: vp.width, heightPt: vp.height, widthIn, heightIn, isScan, nativeDpi, biggestImage, textCount: items.length, scaleStamp: stamp };
}

export function findScaleStamp(strings) {
  for (const s of strings) {
    const m = /\b1\s*:\s*(\d{2,4})\b/.exec(s);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

// Render a region of a PDF page at a given dpi into a canvas. region in full-page px at that dpi (optional).
export async function renderPdfRegion(page, dpi, region = null) {
  const scale = dpi / 72;
  const vp = page.getViewport({ scale });
  const x = region ? region.x : 0;
  const y = region ? region.y : 0;
  const w = region ? region.w : Math.ceil(vp.width);
  const h = region ? region.h : Math.ceil(vp.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const viewport = page.getViewport({ scale, offsetX: -x, offsetY: -y });
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

// Text items in full-page px at the given dpi: { str, x, y, w, h } with y measured downwards.
export async function pdfTextItems(page, dpi) {
  const scale = dpi / 72;
  const vp = page.getViewport({ scale });
  const content = await page.getTextContent();
  const out = [];
  for (const it of content.items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    // transform in PDF user space; convert with the viewport transform
    const [x, y] = applyMatrix(vp.transform, e, f);
    const fontH = Math.hypot(b, d) * scale;
    out.push({ str: it.str, x, y: y - fontH, w: it.width * scale, h: fontH, angle: Math.atan2(b, a) });
  }
  return out;
}
function applyMatrix(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve) => canvas.toBlob(resolve, type));
}

export async function decodeImageFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.tif') || name.endsWith('.tiff') || file.type === 'image/tiff') {
    const { default: UTIF } = await import('../../vendor/utif/utif.esm.js');
    const buf = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    const pages = [];
    for (const ifd of ifds) {
      UTIF.decodeImage(buf, ifd, ifds);
      const rgba = UTIF.toRGBA8(ifd);
      const canvas = document.createElement('canvas');
      canvas.width = ifd.width;
      canvas.height = ifd.height;
      const ctx = canvas.getContext('2d');
      const img = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), ifd.width, ifd.height);
      ctx.putImageData(img, 0, 0);
      const xres = ifd.t282 ? ifd.t282[0] : null;
      pages.push({ canvas, width: ifd.width, height: ifd.height, dpi: xres ? Math.round(xres) : null });
    }
    return { kind: 'image', pages };
  }
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return { kind: 'image', pages: [{ canvas, width: canvas.width, height: canvas.height, dpi: null }] };
}

// Downscale a canvas so its long edge is at most maxLong (returns a new canvas and the scale factor).
export function downscale(canvas, maxLong) {
  const f = Math.min(1, maxLong / Math.max(canvas.width, canvas.height));
  if (f === 1) return { canvas, factor: 1 };
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width * f));
  out.height = Math.max(1, Math.round(canvas.height * f));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return { canvas: out, factor: f };
}

// Load a sheet raster (display or source) as an ImageBitmap.
const bitmapCache = new Map();
export async function loadBitmap(key) {
  if (!key) return null;
  if (bitmapCache.has(key)) return bitmapCache.get(key);
  const blob = await getBlob(key);
  if (!blob) return null;
  const bmp = await createImageBitmap(blob);
  bitmapCache.set(key, bmp);
  return bmp;
}
export function dropBitmap(key) {
  const b = bitmapCache.get(key);
  if (b) b.close();
  bitmapCache.delete(key);
}

// Fraction of dark pixels in a canvas region (used to skip empty tiles).
export function inkFraction(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const step = Math.max(1, Math.floor(Math.max(canvas.width, canvas.height) / 400));
  let dark = 0;
  let total = 0;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const i = (y * canvas.width + x) * 4;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum < 128) dark++;
      total++;
    }
  }
  return total ? dark / total : 0;
}

export { putBlob, getBlob };
