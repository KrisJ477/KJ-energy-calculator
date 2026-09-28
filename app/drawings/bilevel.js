// Bilevel (1-bit) scan handling: archive drawings arrive as CCITT G4 scans inside PDFs or as 1-bit TIFFs.
// PDF.js cannot deliver an 80-megapixel decoded image in the browser, so the scan is decoded here with
// UTIF's CCITT decoder into packed 1-bit rows (about 10 MB for an A0 sheet at 200 dpi) and rendered into
// canvases per region on demand (SPEC 2, 4.2: scans are read at native resolution, never enlarged).

let utifPromise = null;
async function utif() {
  if (!utifPromise) utifPromise = import('../../vendor/utif/utif.esm.js').then((m) => m.default);
  return utifPromise;
}

const latin1 = new TextDecoder('latin1');

// Find the largest image XObject in the PDF bytes whose dictionary is stored in plain text.
// Returns { width, height, filter, params, data } or null.
export function extractPdfImage(bytes) {
  const text = latin1.decode(bytes);
  const re = /\/Subtype\s*\/Image/g;
  let m;
  let best = null;
  while ((m = re.exec(text))) {
    const dictStart = text.lastIndexOf('obj', m.index);
    const streamPos = text.indexOf('stream', m.index);
    if (dictStart < 0 || streamPos < 0) continue;
    const dict = text.slice(dictStart, streamPos);
    const w = /\/Width\s+(\d+)/.exec(dict);
    const h = /\/Height\s+(\d+)/.exec(dict);
    if (!w || !h) continue;
    const width = parseInt(w[1], 10);
    const height = parseInt(h[1], 10);
    if (best && width * height <= best.width * best.height) continue;
    const bpc = /\/BitsPerComponent\s+(\d+)/.exec(dict);
    const filter = /\/Filter\s*\[?\s*\/(\w+)/.exec(dict);
    const K = /\/K\s+(-?\d+)/.exec(dict);
    const cols = /\/Columns\s+(\d+)/.exec(dict);
    const rows = /\/Rows\s+(\d+)/.exec(dict);
    const blackIs1 = /\/BlackIs1\s+true/.test(dict);
    const decodeInv = /\/Decode\s*\[\s*1\s+0\s*\]/.test(dict);
    const lengthDirect = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let dataStart = streamPos + 6;
    if (text[dataStart] === '\r') dataStart++;
    if (text[dataStart] === '\n') dataStart++;
    let dataEnd;
    if (lengthDirect) dataEnd = dataStart + parseInt(lengthDirect[1], 10);
    else {
      dataEnd = text.indexOf('endstream', dataStart);
      while (dataEnd > dataStart && (text[dataEnd - 1] === '\n' || text[dataEnd - 1] === '\r')) dataEnd--;
    }
    best = { width, height, bpc: bpc ? parseInt(bpc[1], 10) : 8, filter: filter ? filter[1] : null, params: { K: K ? parseInt(K[1], 10) : 0, columns: cols ? parseInt(cols[1], 10) : width, rows: rows ? parseInt(rows[1], 10) : height, blackIs1, decodeInv }, data: bytes.subarray(dataStart, dataEnd) };
  }
  return best;
}

export function canDecodeBilevel(img) {
  return !!img && img.bpc === 1 && (img.filter === 'CCITTFaxDecode' || img.filter === 'FlateDecode' || img.filter === null);
}

// Decode to packed 1-bit rows (1 = black), stride = ceil(width/8).
export async function decodePdfImageToBilevel(img) {
  const { width, height } = img;
  const stride = Math.ceil(width / 8);
  let bits;
  if (img.filter === 'CCITTFaxDecode') {
    const U = await utif();
    bits = new Uint8Array(stride * height);
    if (img.params.K < 0) U.decode._decodeG4(img.data, 0, img.data.length, bits, 0, width, 1);
    else U.decode._decodeG3(img.data, 0, img.data.length, bits, 0, width, 1);
  } else if (img.filter === 'FlateDecode') {
    const ds = new DecompressionStream('deflate');
    const buf = await new Response(new Blob([img.data]).stream().pipeThrough(ds)).arrayBuffer();
    bits = new Uint8Array(buf).subarray(0, stride * height);
    // Flate 1-bit DeviceGray: 0 = black unless Decode [1 0]; normalise to 1 = black
    if (!img.params.decodeInv) for (let i = 0; i < bits.length; i++) bits[i] = ~bits[i] & 0xff;
  } else {
    bits = img.data.subarray(0, stride * height);
  }
  return normalise(new Bilevel(width, height, bits));
}

// A 1-bit TIFF page from UTIF (ifd with decoded data) → Bilevel. Photometric 0 = WhiteIsZero (0 = white).
export function tiffToBilevel(ifd) {
  const width = ifd.width;
  const height = ifd.height;
  const stride = Math.ceil(width / 8);
  const bits = new Uint8Array(ifd.data.buffer, ifd.data.byteOffset, Math.min(ifd.data.byteLength, stride * height));
  const photometric = ifd.t262 ? ifd.t262[0] : 0;
  const copy = new Uint8Array(bits);
  if (photometric === 1) for (let i = 0; i < copy.length; i++) copy[i] = ~copy[i] & 0xff;
  return normalise(new Bilevel(width, height, copy));
}

const POP = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let c = 0;
  for (let b = i; b; b >>= 1) c += b & 1;
  POP[i] = c;
}

// A scan is mostly white: make sure 1 bits are the minority (black).
function normalise(b) {
  let ones = 0;
  const step = Math.max(1, Math.floor(b.bits.length / 200000));
  let n = 0;
  for (let i = 0; i < b.bits.length; i += step) {
    ones += POP[b.bits[i]];
    n++;
  }
  if (ones / (n * 8) > 0.5) for (let i = 0; i < b.bits.length; i++) b.bits[i] = ~b.bits[i] & 0xff;
  return b;
}

export class Bilevel {
  constructor(width, height, bits) {
    this.width = width;
    this.height = height;
    this.stride = Math.ceil(width / 8);
    this.bits = bits;
  }
  isBlack(x, y) {
    return (this.bits[y * this.stride + (x >> 3)] >> (7 - (x & 7))) & 1;
  }
  // Render a region (source px) scaled by factor (≤ 1) into a canvas; 1 = black → dark pixels, white paper.
  toCanvas(region, factor = 1) {
    const x0 = Math.max(0, Math.floor(region.x));
    const y0 = Math.max(0, Math.floor(region.y));
    const x1 = Math.min(this.width, Math.ceil(region.x + region.w));
    const y1 = Math.min(this.height, Math.ceil(region.y + region.h));
    const outW = Math.max(1, Math.round(region.w * factor));
    const outH = Math.max(1, Math.round(region.h * factor));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(outW, outH);
    const d = img.data;
    if (factor >= 1) {
      for (let y = y0; y < y1; y++) {
        const oy = y - y0;
        if (oy >= outH) break;
        const rowOff = y * this.stride;
        for (let x = x0; x < x1; x++) {
          const ox = x - x0;
          if (ox >= outW) break;
          const black = (this.bits[rowOff + (x >> 3)] >> (7 - (x & 7))) & 1;
          const i = (oy * outW + ox) * 4;
          const v = black ? 0 : 255;
          d[i] = v;
          d[i + 1] = v;
          d[i + 2] = v;
          d[i + 3] = 255;
        }
      }
    } else {
      // box filter: accumulate black counts per output cell
      const counts = new Float32Array(outW * outH);
      const totals = new Float32Array(outW * outH);
      const sx = outW / region.w;
      const sy = outH / region.h;
      for (let y = y0; y < y1; y++) {
        const oy = Math.min(outH - 1, Math.floor((y - region.y) * sy));
        const rowOff = y * this.stride;
        const base = oy * outW;
        for (let x = x0; x < x1; x++) {
          const ox = Math.min(outW - 1, Math.floor((x - region.x) * sx));
          const byte = this.bits[rowOff + (x >> 3)];
          totals[base + ox]++;
          if ((byte >> (7 - (x & 7))) & 1) counts[base + ox]++;
        }
      }
      for (let i = 0; i < outW * outH; i++) {
        // lines stay visible when downscaled: darken with a gamma that favours ink
        const f = totals[i] ? counts[i] / totals[i] : 0;
        const v = Math.round(255 * Math.pow(1 - f, 0.6));
        d[i * 4] = v;
        d[i * 4 + 1] = v;
        d[i * 4 + 2] = v;
        d[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
}

// Cache of decoded bilevel sheets (bits blobs come from IndexedDB).
const cache = new Map();
export async function loadBilevel(sheet, getBlob) {
  if (cache.has(sheet.id)) return cache.get(sheet.id);
  const blob = await getBlob(sheet.bitsKey);
  if (!blob) return null;
  const b = new Bilevel(sheet.widthPx, sheet.heightPx, new Uint8Array(await blob.arrayBuffer()));
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  cache.set(sheet.id, b);
  return b;
}
