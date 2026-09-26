// Constructions, materials and ventilation assignment (SPEC 3.8, 4.8).
import { h, clear, numberInput, textInput, select, section, button, table, checkbox, toast, download, pickFiles, fmt } from '../ui/dom.js';
import { t, ROOM_TYPES } from '../i18n/strings.js';
import { uid } from '../state/model.js';
import { constructionU } from '../engine/uvalue.js';
import { saveLibraryExtras } from '../persist/autosave.js';

function allMaterials(ctx) {
  return [...ctx.materials.materials, ...(ctx.store.project.library.materialsExtra || [])];
}
function matsById(ctx) {
  const m = {};
  for (const x of allMaterials(ctx)) m[x.id] = x;
  return m;
}
function inUse(p, kind, id) {
  if (kind === 'material') return p.library.constructions.some((c) => (c.layers || []).some((l) => l.materialId === id));
  if (kind === 'construction') return [...p.library.wallTypes, ...p.library.floorTypes, ...p.library.roofTypes, ...p.library.openingTypes, ...(p.library.slabType ? [p.library.slabType] : [])].some((x) => x.constructionId === id);
  if (kind === 'wallType') return p.walls.some((w) => w.wallTypeId === id);
  if (kind === 'openingType') return p.openings.some((o) => o.openingTypeId === id);
  if (kind === 'floorType') return Object.values(p.pieceOverrides).some((o) => o.floorTypeId === id);
  return false;
}

export function render(root, ctx) {
  const { store } = ctx;
  const p = store.project;
  clear(root);
  const set = (fn) => store.update(fn, { label: 'constructions' });
  const mats = matsById(ctx);
  const lib = p.library;
  const derived = ctx.derived();

  // ---- materials ----
  const matRows = allMaterials(ctx).map((m) => ({
    cells: [m.name, m.category || '', h('span', {}, m.lambda != null ? m.lambda : m.lambdaText || '–'), h('span', { class: 'muted small' }, m.source || ''), h('span', { class: m.verified ? 'ok' : 'warn' }, m.verified ? t('constructions.verified') : `${t('constructions.unverified')}${m.certainty ? ` [${m.certainty}]` : ''}`), inUse(p, 'material', m.id) ? t('constructions.inUse') : ''],
  }));
  const addMat = () => {
    const m = { id: uid('mat'), name: '', lambda: null, source: '', verified: false, userAdded: true };
    set((pr) => pr.library.materialsExtra.push(m));
    persistExtras(store);
  };
  const extraRows = (lib.materialsExtra || []).map((m) => ({
    cells: [
      textInput(m.name, (v) => { set((pr) => (pr.library.materialsExtra.find((x) => x.id === m.id).name = v)); persistExtras(store); }),
      numberInput(m.lambda, (v) => { set((pr) => (pr.library.materialsExtra.find((x) => x.id === m.id).lambda = v)); persistExtras(store); }, { step: 0.001 }),
      textInput(m.source, (v) => { set((pr) => (pr.library.materialsExtra.find((x) => x.id === m.id).source = v)); persistExtras(store); }, { width: '24em' }),
      checkbox(m.verified, (v) => { set((pr) => (pr.library.materialsExtra.find((x) => x.id === m.id).verified = v)); persistExtras(store); }, t('constructions.verified')),
      inUse(p, 'material', m.id) ? h('span', { title: t('constructions.cannotDelete') }, t('constructions.inUse')) : button('×', () => { set((pr) => (pr.library.materialsExtra = pr.library.materialsExtra.filter((x) => x.id !== m.id))); persistExtras(store); }),
    ],
  }));

  // ---- constructions ----
  const conRows = lib.constructions.map((c) => {
    const u = constructionU(c, mats, c.direction || 'horizontal');
    const layerRows = (c.layers || []).map((l, li) => ({
      cells: [
        l.resistance != null ? textInput(l.label || 'R', (v) => set((pr) => (pr.library.constructions.find((x) => x.id === c.id).layers[li].label = v))) : select([[null, '–'], ...allMaterials(ctx).map((m) => [m.id, `${m.name} (λ ${m.lambda ?? '?'})`])], l.materialId, (v) => set((pr) => (pr.library.constructions.find((x) => x.id === c.id).layers[li].materialId = v))),
        l.resistance != null ? numberInput(l.resistance, (v) => set((pr) => (pr.library.constructions.find((x) => x.id === c.id).layers[li].resistance = v)), { step: 0.01 }) : numberInput(l.thicknessMm, (v) => set((pr) => (pr.library.constructions.find((x) => x.id === c.id).layers[li].thicknessMm = v))),
        h('span', {}, u.layers && u.layers[li] ? `R = ${fmt(u.layers[li].R, 3)}` : ''),
        button('×', () => set((pr) => pr.library.constructions.find((x) => x.id === c.id).layers.splice(li, 1))),
      ],
    }));
    return h('div', { class: 'construction' },
      h('div', { class: 'row' },
        textInput(c.name, (v) => set((pr) => (pr.library.constructions.find((x) => x.id === c.id).name = v))),
        h('label', {}, t('constructions.direction')), select([['horizontal', t('constructions.horizontal')], ['up', t('constructions.up')], ['down', t('constructions.down')]], c.direction || 'horizontal', (v) => set((pr) => (pr.library.constructions.find((x) => x.id === c.id).direction = v))),
        h('label', {}, t('constructions.uDirect')), numberInput(c.uValueDirect, (v) => set((pr) => (pr.library.constructions.find((x) => x.id === c.id).uValueDirect = v)), { step: 0.01 }),
        h('b', {}, `${t('constructions.uValue')}: ${u.U != null ? fmt(u.U, 3) : '–'} W/m²K`),
        inUse(p, 'construction', c.id) ? h('span', { class: 'muted', title: t('constructions.cannotDelete') }, t('constructions.inUse')) : button('×', () => set((pr) => (pr.library.constructions = pr.library.constructions.filter((x) => x.id !== c.id))))
      ),
      c.uValueDirect == null ? h('div', {}, table([t('constructions.material'), t('constructions.thickness'), 'R', ''], layerRows), h('div', { class: 'row' }, button(`+ ${t('constructions.layers')}`, () => set((pr) => pr.library.constructions.find((x) => x.id === c.id).layers.push({ materialId: null, thicknessMm: 100 }))), button('+ R', () => set((pr) => pr.library.constructions.find((x) => x.id === c.id).layers.push({ resistance: 0.18, label: 'luftspalt' })))), h('div', { class: 'muted small' }, `${t('constructions.chain')}: Rsi ${u.rsi} + ΣR ${fmt(u.rLayers, 3)} + Rse ${u.rse} = ${fmt(u.rTotal, 3)} m²K/W`)) : null
    );
  });

  // ---- types ----
  const conOptions = [[null, '–'], ...lib.constructions.map((c) => [c.id, `${c.name} (U ${fmt(constructionU(c, mats, c.direction || 'horizontal').U, 2)})`])];
  const typeTable = (list, key, extraCols = () => [], kindLabel) => table(
    [t('editor.name'), t('constructions.assign'), t('constructions.uValue'), ...(extraCols.headers || []), ''],
    list.map((x) => {
      const u = derived.types[key] && derived.types[key][x.id];
      const U = u ? (u.up ? u.up.U : u.U) : null;
      return {
        cells: [
          textInput(x.name, (v) => set((pr) => (findType(pr, key, x.id).name = v)), { width: '8em' }),
          select(conOptions, x.constructionId, (v) => set((pr) => (findType(pr, key, x.id).constructionId = v))),
          h('span', {}, U != null ? fmt(U, 3) : '–'),
          ...extraCols(x),
          inUse(p, kindFor(key), x.id) ? h('span', { class: 'muted', title: t('constructions.cannotDelete') }, t('constructions.inUse')) : button('×', () => set((pr) => removeType(pr, key, x.id))),
        ],
      };
    })
  );
  const floorCols = (x) => [select([['between', 'mellan våningar'], ['top-cold-attic', 'översta mot kall vind']], x.kind || 'between', (v) => set((pr) => (findType(pr, 'floors', x.id).kind = v)))];
  floorCols.headers = ['kind'];
  const openCols = (x) => [select([['window', t('audit.window')], ['door', t('audit.door')]], x.kind, (v) => set((pr) => (findType(pr, 'openings', x.id).kind = v))), select([[null, '–'], ['exterior-door', 'default exterior door'], ['interior-door', 'default interior door']], x.defaultFor || null, (v) => set((pr) => (findType(pr, 'openings', x.id).defaultFor = v)))];
  openCols.headers = ['kind', 'default'];

  // ---- pieces ----
  const pieceRows = derived.pieces.filter((pc) => pc.kind !== 'fake_floor').map((pc) => ({
    cells: [pc.id, pc.kind, fmt(pc.areaM2, 2), select([[null, '(default)'], ...lib.floorTypes.map((f) => [f.id, f.name]), ...lib.roofTypes.map((f) => [f.id, `${f.name} (roof)`])], pc.override.floorTypeId || null, (v) => set((pr) => { pr.pieceOverrides[pc.id] = { ...(pr.pieceOverrides[pc.id] || {}), floorTypeId: v }; })),
      checkbox(!!pc.override.outsideSpace, (v) => set((pr) => { pr.pieceOverrides[pc.id] = { ...(pr.pieceOverrides[pc.id] || {}), outsideSpace: v ? { temp: pr.config.indoorSetpoint } : null }; }), t('editor.outsideSpace')),
      pc.override.outsideSpace ? numberInput(pc.override.outsideSpace.temp, (v) => set((pr) => (pr.pieceOverrides[pc.id].outsideSpace.temp = v))) : '', pc.U != null ? fmt(pc.U, 3) : '–'],
  }));

  // ---- ventilation ----
  let bulkType = 'kitchen';
  let bulkFlow = null;
  root.append(
    section(t('constructions.materials'), h('p', { class: 'warn' }, `${t('constructions.libraryStatus')}: ${ctx.materials.status}`), table([t('editor.name'), '', t('constructions.lambda'), t('constructions.source'), '', ''], matRows),
      h('h4', {}, t('constructions.addMaterial')), table([t('editor.name'), t('constructions.lambda'), t('constructions.source'), '', ''], extraRows), h('div', { class: 'row' }, button(t('add'), addMat), button(t('constructions.exportLibrary'), () => download(new Blob([JSON.stringify({ materialsExtra: lib.materialsExtra }, null, 1)], { type: 'application/json' }), 'materialbibliotek-extra.json')), button(t('constructions.importLibrary'), async () => { const [f] = await pickFiles({ accept: '.json' }); if (!f) return; const j = JSON.parse(await f.text()); set((pr) => { for (const m of j.materialsExtra || []) if (!pr.library.materialsExtra.some((x) => x.id === m.id)) pr.library.materialsExtra.push(m); }); persistExtras(store); }))),
    section(t('constructions.constructions'), ...conRows, button(t('constructions.addConstruction'), () => set((pr) => pr.library.constructions.push({ id: uid('con'), name: `K${pr.library.constructions.length + 1}`, layers: [], uValueDirect: null, direction: 'horizontal' })))),
    section(t('constructions.wallTypes'), typeTable(lib.wallTypes, 'walls'), button(t('constructions.addType'), () => set((pr) => pr.library.wallTypes.push({ id: uid('wt'), name: `W${pr.library.wallTypes.length + 1}`, constructionId: null })))),
    section(t('constructions.floorTypes'), h('p', { class: 'help' }, t('constructions.defaultFloorNote')), typeTable(lib.floorTypes, 'floors', floorCols), button(t('constructions.addType'), () => set((pr) => pr.library.floorTypes.push({ id: uid('ft'), name: `F${pr.library.floorTypes.length + 1}`, constructionId: null, kind: pr.library.floorTypes.length ? 'top-cold-attic' : 'between' })))),
    section(t('constructions.roofTypes'), typeTable(lib.roofTypes, 'roofs'), button(t('constructions.addType'), () => set((pr) => pr.library.roofTypes.push({ id: uid('rt'), name: `R${pr.library.roofTypes.length + 1}`, constructionId: null })))),
    section(t('constructions.slabType'), h('div', { class: 'row' }, select(conOptions, lib.slabType ? lib.slabType.constructionId : null, (v) => set((pr) => (pr.library.slabType = v ? { id: 'slab', name: 'Platta', constructionId: v } : null))), h('span', {}, derived.types.slab && derived.types.slab.U != null ? `U ${fmt(derived.types.slab.U, 3)} (Rse = 0 ${t('constructions.toGround')})` : ''))),
    section(t('constructions.openingTypes'), typeTable(lib.openingTypes, 'openings', openCols), button(t('constructions.addType'), () => set((pr) => pr.library.openingTypes.push({ id: uid('ot'), name: `O${pr.library.openingTypes.length + 1}`, kind: 'window', constructionId: null }))),
      h('p', { class: 'muted small' }, `${t('constructions.libraryStatus')}: ${ctx.materials.openingDefaults.length} default window/door U-values in the library (Källa: data/materials.json)`),
      h('details', {}, h('summary', {}, 'default U-values (library)'), table([t('editor.name'), 'U', t('constructions.source'), ''], ctx.materials.openingDefaults.map((o) => ({ cells: [o.name, o.U, h('span', { class: 'muted small' }, o.source), button(t('add'), () => set((pr) => { const cid = uid('con'); pr.library.constructions.push({ id: cid, name: o.name, layers: [], uValueDirect: o.U, source: o.source, verified: false }); pr.library.openingTypes.push({ id: uid('ot'), name: o.name.slice(0, 30), kind: o.kind, constructionId: cid }); }))] }))))),
    section(t('constructions.pieces'), table(['id', 'kind', t('audit.area'), t('constructions.assignPiece'), '', '°C', 'U'], pieceRows)),
    section(t('constructions.ventilation'),
      h('div', { class: 'row' }, h('label', {}, t('constructions.baseFlow')), numberInput(p.config.baseVentilationLsPerM2, (v) => set((pr) => (pr.config.baseVentilationLsPerM2 = v)), { step: 0.01 })),
      h('div', { class: 'row' }, h('label', {}, t('constructions.bulkByType')), select(ROOM_TYPES.map((r) => [r, t(`roomTypes.${r}`)]), bulkType, (v) => (bulkType = v)), numberInput(null, (v) => (bulkFlow = v), { placeholder: 'l/s' }), button(t('constructions.apply'), () => set((pr) => pr.rooms.forEach((r) => { if (r.roomType === bulkType) r.ventilationLs = bulkFlow; })))),
      h('p', { class: 'help' }, `${t('constructions.infiltration')}: n50 ${derived.calcModel.rooms.length ? '' : ''}${p.config.n50Override ?? ''} (${p.config.ageCategory})`),
      button(t('constructions.proceed3d'), () => ctx.navigate('model3d'), { class: 'btn primary' })
    )
  );
}
function findType(pr, key, id) {
  const list = { walls: pr.library.wallTypes, floors: pr.library.floorTypes, roofs: pr.library.roofTypes, openings: pr.library.openingTypes }[key];
  return list.find((x) => x.id === id);
}
function removeType(pr, key, id) {
  const k = { walls: 'wallTypes', floors: 'floorTypes', roofs: 'roofTypes', openings: 'openingTypes' }[key];
  pr.library[k] = pr.library[k].filter((x) => x.id !== id);
}
function kindFor(key) {
  return { walls: 'wallType', floors: 'floorType', roofs: 'floorType', openings: 'openingType' }[key];
}
function persistExtras(store) {
  saveLibraryExtras(store.project.library.materialsExtra).catch((e) => console.warn(e));
}
