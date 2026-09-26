// Shared pan/zoom canvas for drawings: sheet layers (paper white transparent, paper/line opacity, tint)
// and a vector overlay drawn by the owner. World coordinates are the level frame (mm when scaled).
import { loadBitmap } from '../drawings/loader.js';
import { applyTransform } from '../engine/geometry.js';

export class CanvasView {
  constructor(container, { onDraw, onPointer, onKey, background = '#fff' } = {}) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'view-canvas';
    this.canvas.tabIndex = 0;
    container.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.onDraw = onDraw;
    this.onPointer = onPointer;
    this.onKey = onKey;
    this.background = background;
    this.view = { scale: 0.05, tx: 0, ty: 0 }; // world → screen
    this.layers = []; // { id, bitmap, T (bitmap px → world), paper, line, tint, visible, renderRegion?, onDemand }
    this.regionCache = new Map();
    this.dragging = null;
    this.bind();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
  }
  destroy() {
    this.ro.disconnect();
    this.canvas.remove();
  }
  resize() {
    const r = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.dpr = dpr;
    this.draw();
  }
  worldToScreen(p) {
    return { x: p.x * this.view.scale + this.view.tx, y: p.y * this.view.scale + this.view.ty };
  }
  screenToWorld(p) {
    return { x: (p.x - this.view.tx) / this.view.scale, y: (p.y - this.view.ty) / this.view.scale };
  }
  fitTo(bbox, margin = 40) {
    if (!bbox || !(bbox.width > 0) || !(bbox.height > 0)) return;
    const w = this.canvas.width / this.dpr;
    const hgt = this.canvas.height / this.dpr;
    const s = Math.min((w - 2 * margin) / bbox.width, (hgt - 2 * margin) / bbox.height);
    this.view.scale = s;
    this.view.tx = (w - bbox.width * s) / 2 - bbox.minX * s;
    this.view.ty = (hgt - bbox.height * s) / 2 - bbox.minY * s;
    this.draw();
  }
  async setLayers(layers) {
    this.layers = [];
    for (const l of layers) {
      const bitmap = l.bitmap || (l.imageKey ? await loadBitmap(l.imageKey) : null);
      this.layers.push({ paper: 0.6, line: 1, tint: null, visible: true, ...l, bitmap });
    }
    this.regionCache.clear();
    this.draw();
  }
  bind() {
    const c = this.canvas;
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      const f = Math.exp(-e.deltaY * 0.0015);
      const w = this.screenToWorld(p);
      this.view.scale *= f;
      this.view.tx = p.x - w.x * this.view.scale;
      this.view.ty = p.y - w.y * this.view.scale;
      this.draw();
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      c.focus();
      const p = pos(e);
      const world = this.screenToWorld(p);
      const handled = this.onPointer && this.onPointer({ type: 'down', screen: p, world, event: e, view: this });
      if (handled) {
        this.dragging = { custom: true };
        c.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 0 || e.button === 1 || e.button === 2) {
        this.dragging = { start: p, tx: this.view.tx, ty: this.view.ty, moved: false };
        c.setPointerCapture(e.pointerId);
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = pos(e);
      const world = this.screenToWorld(p);
      if (this.dragging && this.dragging.custom) {
        this.onPointer && this.onPointer({ type: 'drag', screen: p, world, event: e, view: this });
        return;
      }
      if (this.dragging) {
        const dx = p.x - this.dragging.start.x;
        const dy = p.y - this.dragging.start.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.dragging.moved = true;
        this.view.tx = this.dragging.tx + dx;
        this.view.ty = this.dragging.ty + dy;
        this.draw();
        return;
      }
      this.onPointer && this.onPointer({ type: 'move', screen: p, world, event: e, view: this });
    });
    const up = (e) => {
      const p = pos(e);
      const world = this.screenToWorld(p);
      if (this.dragging && this.dragging.custom) {
        this.onPointer && this.onPointer({ type: 'up', screen: p, world, event: e, view: this });
      } else if (this.dragging && !this.dragging.moved) {
        this.onPointer && this.onPointer({ type: 'click', screen: p, world, event: e, view: this });
      }
      this.dragging = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', () => (this.dragging = null));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('keydown', (e) => this.onKey && this.onKey(e, this));
  }
  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.paint();
    });
  }
  paint() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, W, H);
    const dpr = this.dpr;
    for (const l of this.layers) {
      if (!l.visible || !l.bitmap) continue;
      this.paintLayer(l, dpr);
    }
    ctx.setTransform(dpr * this.view.scale, 0, 0, dpr * this.view.scale, dpr * this.view.tx, dpr * this.view.ty);
    if (this.onDraw) this.onDraw(ctx, this);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  layerMatrix(l) {
    // bitmap px → world: T = {sx, sy, rot, tx, ty} (applyTransform semantics)
    const T = l.T;
    const c = Math.cos(T.rot || 0);
    const s = Math.sin(T.rot || 0);
    const sx = T.sx ?? T.s ?? 1;
    const sy = T.sy ?? T.s ?? 1;
    return [c * sx, s * sx, -s * sy, c * sy, T.tx || 0, T.ty || 0];
  }
  paintLayer(l, dpr) {
    const ctx = this.ctx;
    const m = this.layerMatrix(l);
    const v = this.view;
    // composite: screen = view ∘ layer
    const a = v.scale * m[0];
    const b = v.scale * m[1];
    const c = v.scale * m[2];
    const d = v.scale * m[3];
    const e = v.scale * m[4] + v.tx;
    const f = v.scale * m[5] + v.ty;
    const bmp = l.bitmap;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (l.paper > 0) {
      ctx.setTransform(dpr * a, dpr * b, dpr * c, dpr * d, dpr * e, dpr * f);
      ctx.globalAlpha = l.paper;
      ctx.fillStyle = l.paperColor || '#f4f1ea';
      ctx.fillRect(0, 0, bmp.width, bmp.height);
      ctx.globalAlpha = 1;
    }
    const off = this.getOffscreen(W, H);
    const octx = off.getContext('2d');
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.globalCompositeOperation = 'source-over';
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, W, H);
    octx.setTransform(dpr * a, dpr * b, dpr * c, dpr * d, dpr * e, dpr * f);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    const src = this.bestSource(l, a, dpr);
    if (src) {
      octx.drawImage(src.canvas, src.x, src.y, src.w, src.h);
    } else octx.drawImage(bmp, 0, 0, bmp.width, bmp.height);
    if (l.tint) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'screen';
      octx.fillStyle = l.tint;
      octx.fillRect(0, 0, W, H);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = l.line;
    ctx.drawImage(off, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  getOffscreen(W, H) {
    if (!this.off || this.off.width !== W || this.off.height !== H) {
      this.off = document.createElement('canvas');
      this.off.width = W;
      this.off.height = H;
    }
    return this.off;
  }
  // On-demand higher-resolution region when zoomed beyond the display bitmap (vector PDFs / large rasters).
  bestSource(l, screenPerBitmapPx, dpr) {
    if (!l.renderRegion) return null;
    const need = screenPerBitmapPx * dpr; // screen px per display-bitmap px
    if (need <= 1.05) return null;
    // visible region in bitmap px
    const inv = this.invertLayer(l);
    const corners = [{ x: 0, y: 0 }, { x: this.canvas.width / dpr, y: 0 }, { x: 0, y: this.canvas.height / dpr }, { x: this.canvas.width / dpr, y: this.canvas.height / dpr }].map((p) => inv(this.screenToWorld(p)));
    const minX = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))));
    const minY = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))));
    const maxX = Math.min(l.bitmap.width, Math.ceil(Math.max(...corners.map((c) => c.x))));
    const maxY = Math.min(l.bitmap.height, Math.ceil(Math.max(...corners.map((c) => c.y))));
    if (maxX <= minX || maxY <= minY) return null;
    const factor = Math.min(need, l.maxFactor || 8);
    const bucket = Math.pow(2, Math.round(Math.log2(factor)));
    const key = `${l.id}|${bucket}|${Math.floor(minX / 512)}|${Math.floor(minY / 512)}|${Math.ceil(maxX / 512)}|${Math.ceil(maxY / 512)}`;
    const hit = this.regionCache.get(key);
    if (hit && hit.canvas) return hit;
    if (!hit) {
      const region = { x: Math.floor(minX / 512) * 512, y: Math.floor(minY / 512) * 512, w: Math.ceil(maxX / 512) * 512 - Math.floor(minX / 512) * 512, h: Math.ceil(maxY / 512) * 512 - Math.floor(minY / 512) * 512 };
      const entry = { pending: true };
      this.regionCache.set(key, entry);
      l.renderRegion(region, bucket).then((canvas) => {
        entry.canvas = canvas;
        entry.x = region.x;
        entry.y = region.y;
        entry.w = region.w;
        entry.h = region.h;
        entry.pending = false;
        if (this.regionCache.size > 12) {
          const first = this.regionCache.keys().next().value;
          if (first !== key) this.regionCache.delete(first);
        }
        this.draw();
      }).catch((e) => {
        console.warn('region render failed', e);
        this.regionCache.delete(key);
      });
    }
    return null;
  }
  invertLayer(l) {
    const T = l.T;
    const sx = T.sx ?? T.s ?? 1;
    const sy = T.sy ?? T.s ?? 1;
    const c = Math.cos(-(T.rot || 0));
    const s = Math.sin(-(T.rot || 0));
    return (p) => {
      const x = p.x - (T.tx || 0);
      const y = p.y - (T.ty || 0);
      return { x: (c * x - s * y) / sx, y: (s * x + c * y) / sy };
    };
  }
  // helpers for overlay drawing in world units with constant screen-size strokes
  px(n) {
    return n / this.view.scale;
  }
}
export { applyTransform };
