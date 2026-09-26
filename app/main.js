// App bootstrap: store, language, views/tabs, pop-outs, autosave, project file, providers, password gate.
import { Store } from './state/store.js';
import { t, setLanguage, initLanguage, getLanguage } from './i18n/strings.js';
import { h, clear, button, select, modal, toast, pickFiles } from './ui/dom.js';
import { attachAutosave, loadProject, saveProject, loadLibraryExtras, clearProject } from './persist/autosave.js';
import { exportProject, importProject } from './persist/projectfile.js';
import { derive, sheetToLevel, syncRooms } from './state/derive.js';
import { invertTransform } from './engine/geometry.js';
import { ReadRunner } from './ai/jobs.js';
import { ApiProvider, ManualProvider } from './ai/provider.js';
import { newProject, newLevel, newRoom, uid, ORIGIN } from './state/model.js';
import { openPopout, listScreens } from './windows/popout.js';
import { importFiles } from './views/drawings.js';
import * as wizard from './views/wizard.js';
import * as drawings from './views/drawings.js';
import * as floors from './views/floors.js';
import * as scale from './views/scale.js';
import * as align from './views/align.js';
import * as editor from './views/editor2d.js';
import * as gaps from './views/gaps.js';
import * as constructions from './views/constructions.js';
import * as model3d from './views/model3d.js';
import * as audit from './views/audit.js';
import * as settings from './views/settings.js';
import * as command from './views/command.js';

const VIEWS = { wizard, drawings, floors, scale, align, editor, gaps, constructions, model3d, audit, settings, command };
const TAB_ORDER = ['wizard', 'drawings', 'floors', 'scale', 'editor', 'gaps', 'constructions', 'model3d', 'audit', 'settings', 'command'];

const params = new URLSearchParams(location.search);
const isPopout = params.get('popout') === '1';
const store = new Store({ isMain: !isPopout });
initLanguage();
document.documentElement.lang = getLanguage();

const ctx = {
  store,
  get lang() { return getLanguage(); },
  view: params.get('view') || 'wizard',
  materials: { materials: [], openingDefaults: [], constructionExamples: [], status: '' },
  canvases: [],
  registerCanvas(v) { this.canvases.push(v); },
  navigate(view) { this.view = view; renderAll(); },
  rerender() { renderAll(); },
  derived() { return getDerived(); },
  sheetToLevel,
  setBusy(msg) { busy.textContent = msg || ''; busy.style.display = msg ? '' : 'none'; },
  getWorkerUrl() { return localStorage.getItem('kj.workerUrl') || `${location.origin}/api`; },
  setWorkerUrl(v) { localStorage.setItem('kj.workerUrl', v); },
  clearPassword() { localStorage.removeItem('kj.password'); toast(t('settings.clearPassword')); },
  refreshMode() { updateBadge(); },
  async copyFloor(src, targets) { copyFloor(src, targets); },
  async swapUnderlay(level, file, swapOnly) { await swapUnderlay(level, file, swapOnly); },
};

// ---- derived cache ----
let derivedCache = { version: -1, value: null };
function getDerived() {
  if (derivedCache.version !== store.version || !derivedCache.value) {
    derivedCache = { version: store.version, value: derive(store.project, ctx.materials.materials) };
  }
  return derivedCache.value;
}

// ---- every enclosed face gets a room record (SPEC 3.2): runs after any change that alters the room graph ----
let syncing = false;
let syncedVersion = -1;
const SYNC_REASON = 'sluten yta utan rumstext i läsningen; namn och rumstyp sätts av användaren';
function syncAllRooms() {
  if (syncing || !store.isMain || store.version === syncedVersion) return;
  syncedVersion = store.version;
  const d = getDerived();
  const levels = Object.values(d.perLevel).filter((pl) => pl.faceRooms.some((fr) => !fr.record) || pl.orphanRecords.some((r) => r.origin === ORIGIN.machine && r.reasoning === SYNC_REASON && !r.name)).map((pl) => pl.level);
  if (!levels.length) return;
  syncing = true;
  try {
    store.update((pr) => {
      for (const level of levels) {
        // records this sync created earlier whose face no longer exists (or never matched) are dropped, not kept forever
        const orphanIds = new Set(d.perLevel[level].orphanRecords.filter((r) => r.origin === ORIGIN.machine && r.reasoning === SYNC_REASON && !r.name).map((r) => r.id));
        if (orphanIds.size) pr.rooms = pr.rooms.filter((r) => !orphanIds.has(r.id));
        const base = pr.sheets.find((s) => s.level === level && s.type === 'plan' && s.role === 'base') || pr.sheets.find((s) => s.level === level && s.type === 'plan');
        const inv = base ? invertTransform(sheetToLevel(base).T) : null;
        syncRooms(pr, level, (lv, index, extra) => {
          const anchorPx = inv && extra.anchor ? inv.apply(extra.anchor) : null;
          return newRoom(lv, index, { ...extra, anchor: anchorPx ? null : extra.anchor, anchorPx, sheetId: base ? base.id : null, origin: ORIGIN.machine, reasoning: SYNC_REASON });
        }, d.perLevel[level]);
      }
    }, { undoable: false, label: 'sync rooms' });
    syncedVersion = store.version;
  } finally {
    syncing = false;
  }
}
store.subscribe(() => { try { syncAllRooms(); } catch (e) { console.error('room sync failed', e); } });

// ---- providers ----
const manualProvider = new ManualProvider({ onStatus: () => scheduleRender() });
ctx.manualProvider = manualProvider;
const apiProvider = new ApiProvider({ workerUrl: ctx.getWorkerUrl(), getPassword: () => localStorage.getItem('kj.password') || '' });
ctx.runner = new ReadRunner(store, () => {
  apiProvider.workerUrl = ctx.getWorkerUrl();
  if (store.project.config.ai.manualMode) return manualProvider;
  if (!localStorage.getItem('kj.password')) askPassword();
  return apiProvider;
});
ctx.runner.onProgress(() => scheduleRender());

function askPassword() {
  let pw = '';
  modal(t('password'), h('div', {}, h('p', {}, t('passwordPrompt')), h('input', { type: 'password', onInput: (e) => (pw = e.target.value), style: { width: '20em' } })), { buttons: [{ label: t('ok'), primary: true, onClick: () => { localStorage.setItem('kj.password', pw); } }] });
}

// ---- layout ----
const header = h('header', { class: 'topbar' });
const tabs = h('nav', { class: 'tabs' });
const badge = h('span', { class: 'badge manual', style: { display: 'none' } }, t('manualMode'));
const busy = h('span', { class: 'busy', style: { display: 'none' } });
const main = h('main', { class: 'main' });
const footer = h('footer', { class: 'statusbar' });
document.body.append(header, main, footer);

function updateBadge() {
  badge.style.display = store.project.config.ai.manualMode ? '' : 'none';
}

function renderHeader() {
  clear(header);
  clear(tabs);
  for (const v of TAB_ORDER) tabs.append(button(t(`tabs.${v}`), () => ctx.navigate(v), { class: `tab ${ctx.view === v ? 'active' : ''}` }));
  const langSel = select([['sv', 'Svenska'], ['en', 'English']], getLanguage(), (v) => { setLanguage(v); document.documentElement.lang = v; renderAll(); });
  const popBtn = button(t('popout'), async () => {
    const screens = await listScreens();
    if (screens && screens.length > 1) {
      const body = h('div', {}, screens.map((s) => button(`${s.label} (${s.width}×${s.height})`, () => { openPopout(ctx.view, { screenIndex: s.index }); m.close(); })));
      const m = modal(t('popoutScreen'), body, { buttons: [{ label: t('cancel') }] });
    } else openPopout(ctx.view);
  });
  header.append(
    h('div', { class: 'brand' }, t('appTitle'), ' ', badge, ' ', busy),
    tabs,
    h('div', { class: 'actions' },
      isPopout ? null : button(t('newProject'), () => { if (confirm(t('newProject') + '?')) { store.replaceProject(newProject('')); clearProject().catch(() => {}); ctx.navigate('wizard'); } }),
      isPopout ? null : button(t('save'), () => exportProject(store.project)),
      isPopout ? null : button(t('open'), async () => { const [f] = await pickFiles({ accept: '.json' }); if (!f) return; try { const p = await importProject(f); store.replaceProject(p); toast(t('status.restored')); ctx.navigate('drawings'); } catch (e) { toast(String(e.message || e), 'error'); } }),
      button(t('undo'), () => store.undo(), { title: 'Ctrl+Z' }), button(t('redo'), () => store.redo(), { title: 'Ctrl+Y' }),
      h('span', {}, popBtn), langSel
    )
  );
  updateBadge();
}

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderAll, 50);
}
function renderAll() {
  for (const c of ctx.canvases) try { c.destroy(); } catch {}
  ctx.canvases = [];
  renderHeader();
  clear(main);
  const container = h('div', { class: `view view-${ctx.view}` });
  main.append(container);
  const v = VIEWS[ctx.view] || VIEWS.wizard;
  try {
    v.render(container, ctx);
  } catch (e) {
    console.error(e);
    container.append(h('p', { class: 'warn' }, `${t('status.error')}: ${e.message}`));
  }
  const p = store.project;
  const d = getDerived();
  footer.textContent = `${p.meta.name || '–'} · ${p.sheets.length} sheets · ${p.rooms.length} rooms · ${d.results ? `${Math.round(d.results.building)} W` : ''} · ${store.isMain ? '' : 'pop-out'}`;
}

store.subscribe((state, meta) => {
  if (meta.session) return;
  scheduleRender();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { if (!isEditable(e.target)) { e.preventDefault(); store.undo(); } }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { if (!isEditable(e.target)) { e.preventDefault(); store.redo(); } }
});
function isEditable(el) { return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable); }

// ---- floor copying (SPEC 4.4) ----
function copyFloor(src, targets) {
  store.update((p) => {
    const srcWalls = p.walls.filter((w) => w.level === src && !w.deleted);
    const srcRooms = p.rooms.filter((r) => r.level === src);
    const srcOpenings = p.openings.filter((o) => o.level === src && !o.deleted);
    const srcSheet = p.sheets.find((s) => s.type === 'plan' && s.level === src && s.role === 'base');
    for (const lv of targets) {
      if (lv === src || !p.levels.some((l) => l.level === lv)) continue;
      const tgtSheet = p.sheets.find((s) => s.type === 'plan' && s.level === lv && s.role === 'base') || srcSheet;
      const own = { walls: p.walls.filter((w) => w.level === lv && !w.deleted), rooms: p.rooms.filter((r) => r.level === lv) };
      const diff = [];
      // keep the target's own read for diffing, then replace
      const near = (a, b, tol) => a && b && Math.hypot(a.x - b.x, a.y - b.y) <= tol;
      for (const w of srcWalls) if (!own.walls.some((o) => (near(o.aPx, w.aPx, 60) && near(o.bPx, w.bPx, 60)) || (near(o.aPx, w.bPx, 60) && near(o.bPx, w.aPx, 60)))) diff.push(`wall ${w.id}: not in floor ${lv}'s own read`);
      for (const o of own.walls) if (!srcWalls.some((w) => (near(o.aPx, w.aPx, 60) && near(o.bPx, w.bPx, 60)) || (near(o.aPx, w.bPx, 60) && near(o.bPx, w.aPx, 60)))) diff.push(`wall ${o.id}: only in floor ${lv}'s own read`);
      for (const r of srcRooms) { const m = own.rooms.find((o) => near(o.anchorPx, r.anchorPx, 300)); if (!m) diff.push(`room ${r.id}: not in floor ${lv}'s own read`); else if (m.name !== r.name) diff.push(`room ${r.id}: name "${r.name}" vs own "${m.name}"`); }
      p.walls = p.walls.filter((w) => w.level !== lv);
      p.openings = p.openings.filter((o) => o.level !== lv);
      p.rooms = p.rooms.filter((r) => r.level !== lv);
      p.gaps = p.gaps.filter((g) => g.level !== lv);
      const idMap = {};
      for (const w of srcWalls) { const nw = { ...structuredClone(w), id: uid('w'), level: lv, sheetId: tgtSheet ? tgtSheet.id : w.sheetId, copiedFrom: w.id, origin: 'user', flaggedReview: true }; idMap[w.id] = nw.id; p.walls.push(nw); }
      for (const o of srcOpenings) p.openings.push({ ...structuredClone(o), id: uid('op'), level: lv, wallId: idMap[o.wallId] || null, sheetId: tgtSheet ? tgtSheet.id : o.sheetId, copiedFrom: o.id, origin: 'user', flaggedReview: true });
      for (const r of srcRooms) p.rooms.push({ ...structuredClone(r), id: `${lv < 0 ? `(${lv})` : lv}-${r.index}`, level: lv, sheetId: tgtSheet ? tgtSheet.id : r.sheetId, copiedFrom: r.id, origin: 'user', flaggedReview: true });
      const l = p.levels.find((x) => x.level === lv);
      l.copyDiff = diff;
      l.copiedFrom = src;
      const srcLevel = p.levels.find((x) => x.level === src);
      if (srcLevel && tgtSheet && srcSheet && !tgtSheet.scale && srcSheet.scale) tgtSheet.scale = { ...srcSheet.scale, method: `copied from floor ${src}` };
    }
  }, { label: 'copy floor' });
  toast(t('floors.copyTo'));
}

// ---- swap underlay (SPEC 4.5): new image replaces the backdrop, auto-rescaled to the existing geometry ----
async function swapUnderlay(level, file, swapOnly) {
  const before = new Set(store.project.sheets.map((s) => s.id));
  await importFiles(ctx, [file]);
  const p = store.project;
  const added = p.sheets.filter((s) => !before.has(s.id));
  const old = p.sheets.find((s) => s.type === 'plan' && s.level === level && s.role === 'base');
  store.update((pr) => {
    for (const s of added) {
      const ns = pr.sheets.find((x) => x.id === s.id);
      ns.level = level;
      ns.type = 'plan';
      ns.role = 'base';
      if (old && old.scale) {
        // rescale so the new image covers the same extent as the old (reference features assumed at the same relative positions)
        const f = old.widthPx / ns.widthPx;
        ns.scale = { ...old.scale, mmPerPx: old.scale.mmPerPx * f, pxPerM: old.scale.pxPerM / f, method: `swap underlay (auto-rescaled from ${old.scale.method})` };
        ns.placement = { ...old.placement };
      }
      if (old) {
        old.role = 'ignore';
        if (swapOnly) for (const w of pr.walls) if (w.sheetId === old.id) { w.sheetId = ns.id; w.aPx = { x: w.aPx.x * (ns.widthPx / old.widthPx), y: w.aPx.y * (ns.heightPx / old.heightPx) }; w.bPx = { x: w.bPx.x * (ns.widthPx / old.widthPx), y: w.bPx.y * (ns.heightPx / old.heightPx) }; }
        if (swapOnly) for (const o of pr.openings) if (o.sheetId === old.id) { o.sheetId = ns.id; if (o.aPx) { o.aPx = { x: o.aPx.x * (ns.widthPx / old.widthPx), y: o.aPx.y * (ns.heightPx / old.heightPx) }; o.bPx = { x: o.bPx.x * (ns.widthPx / old.widthPx), y: o.bPx.y * (ns.heightPx / old.heightPx) }; } }
        if (swapOnly) for (const r of pr.rooms) if (r.sheetId === old.id) { r.sheetId = ns.id; if (r.anchorPx) r.anchorPx = { x: r.anchorPx.x * (ns.widthPx / old.widthPx), y: r.anchorPx.y * (ns.heightPx / old.heightPx) }; }
        if (swapOnly) for (const g of pr.gaps) if (g.sheetId === old.id) g.sheetId = ns.id;
      }
    }
  }, { label: 'swap underlay' });
}

// ---- start ----
async function start() {
  try {
    const res = await fetch(new URL('../data/materials.json', import.meta.url));
    const lib = await res.json();
    ctx.materials = { materials: lib.materials, openingDefaults: lib.openingDefaults, constructionExamples: lib.constructionExamples, status: lib.status, raw: lib };
  } catch (e) {
    console.error('material library failed to load', e);
    ctx.materials.status = 'material library missing';
  }
  if (store.isMain) {
    try {
      const saved = await loadProject();
      if (saved) {
        const extras = await loadLibraryExtras();
        saved.library = saved.library || {};
        saved.library.materialsExtra = mergeExtras(saved.library.materialsExtra || [], extras);
        store.replaceProject(saved);
        toast(t('status.restored'));
      } else {
        const extras = await loadLibraryExtras();
        store.project.library.materialsExtra = extras;
      }
    } catch (e) {
      console.error('restore failed', e);
    }
    attachAutosave(store, { onSaved: () => {} });
    window.addEventListener('beforeunload', () => { store.send({ type: 'close' }); saveProject(store.project).catch(() => {}); });
  } else {
    store.hello();
  }
  renderAll();
}
function mergeExtras(a, b) {
  const out = [...a];
  for (const m of b) if (!out.some((x) => x.id === m.id)) out.push(m);
  return out;
}
start();
window.__kj = { ctx, store };
export { ctx, store };
