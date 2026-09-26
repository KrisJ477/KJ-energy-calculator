// Audit mode (SPEC 4.10): room panel, list view, bulk edit, slab check, totals.
import { h, clear, numberInput, textInput, select, section, button, table, checkbox, fmt } from '../ui/dom.js';
import { t, ROOM_TYPES } from '../i18n/strings.js';

export const SURFACE_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990', '#dcbeff', '#9A6324', '#800000', '#aaffc3', '#808000', '#000075'];

export function otherSideLabel(row, ctx) {
  const s = row.otherSide;
  if (!s) return '';
  if (s.room != null) return `${t('audit.room')} ${s.room}`;
  const map = { outside: 'audit.outside', soil: 'audit.soil', slab_band: 'audit.slabBand', slab_inner: 'audit.slabInner', outside_space: 'audit.outsideSpace' };
  return t(map[s.type] || 'audit.outside') + (s.type === 'outside_space' ? ` (${s.temp ?? ctx.store.project.config.indoorSetpoint} °C)` : '');
}

export function roomPanel(roomId, ctx, { colorRows = false } = {}) {
  const { store } = ctx;
  const p = store.project;
  const d = ctx.derived();
  const rec = p.rooms.find((r) => r.id === roomId);
  const res = d.results && d.results.rooms[roomId];
  if (!rec || !res) return h('div', {}, '–');
  const set = (fn) => store.update((pr) => fn(pr.rooms.find((r) => r.id === roomId), pr), { label: 'room' });
  const rows = res.rows.map((row, i) => ({
    attrs: { style: colorRows && row.kind === 'transmission' ? { borderLeft: `6px solid ${SURFACE_COLORS[i % SURFACE_COLORS.length]}` } : {} },
    cells: [
      row.kind === 'transmission' ? `${t(`audit.${row.surfaceKind}`) !== `audit.${row.surfaceKind}` ? t(`audit.${row.surfaceKind}`) : row.label} → ${otherSideLabel(row, ctx)}` : t(`audit.${row.kind}`),
      row.areaM2 != null ? fmt(row.areaM2, 2) : row.flowLs != null ? `${fmt(row.flowLs, 1)} l/s` : row.pct != null ? `${row.pct} %` : '',
      row.U != null ? fmt(row.U, 2) : row.ach != null ? `${fmt(row.ach, 3)} /h` : '',
      row.dT != null ? fmt(row.dT, 1) : '',
      h('b', {}, fmt(row.watts, 0)),
      row.refs && row.refs.chain ? chainText(row.refs.chain) : row.rule ? `${row.rule}${row.governs === false ? '' : ''}` : '',
    ],
  }));
  const calcRoom = d.calcModel.rooms.find((r) => r.id === roomId);
  return h('div', { class: 'room-panel' },
    h('h3', {}, `${t('audit.room')} ${rec.id} ${rec.name || ''} — ${fmt(res.total, 0)} W`),
    h('div', { class: 'muted small' }, `${fmt(calcRoom.areaM2, 2)} m² · ${fmt(calcRoom.volumeM3, 1)} m³ · ${rec.heated ? `${fmt(res.temp, 1)} °C` : `${t('audit.unheatedTemp')}: ${fmt(res.temp, 1)} °C`}${rec.flaggedReview ? ` · ${t('audit.overrideFlag')}` : ''}`),
    h('div', { class: 'grid2' },
      h('label', {}, t('editor.name')), textInput(rec.name, (v) => set((r) => { r.name = v; r.userEdited = true; })),
      h('label', {}, t('editor.roomType')), select(ROOM_TYPES.map((r) => [r, t(`roomTypes.${r}`)]), rec.roomType, (v) => set((r) => { r.roomType = v; r.userEdited = true; })),
      h('label', {}, t('editor.heated')), checkbox(rec.heated, (v) => set((r) => { r.heated = v; r.userEdited = true; })),
      h('label', {}, t('audit.setpoint')), numberInput(rec.setpoint, (v) => set((r) => (r.setpoint = v)), { placeholder: String(p.config.indoorSetpoint) }),
      h('label', {}, t('audit.flow')), numberInput(rec.ventilationLs, (v) => set((r) => (r.ventilationLs = v)), { placeholder: fmt(p.config.baseVentilationLsPerM2 * calcRoom.areaM2, 1), step: 0.1 }),
      h('label', {}, t('audit.supplyTemp')), numberInput(rec.supplyTempOverride, (v) => set((r) => (r.supplyTempOverride = v)), { placeholder: 'auto' }),
      h('label', {}, t('audit.ach')), numberInput(rec.infiltrationAchOverride, (v) => set((r) => (r.infiltrationAchOverride = v)), { placeholder: fmt(res.rows.find((x) => x.kind === 'infiltration').ach, 3), step: 0.01 }),
      h('label', {}, t('audit.comment')), textInput(rec.comment, (v) => set((r) => (r.comment = v)), { width: '16em' })
    ),
    h('p', { class: 'muted small' }, t('audit.notEditable')),
    table([t('audit.element'), t('audit.area'), 'U', t('audit.dT'), t('audit.watts'), t('audit.trace')], rows)
  );
}
export function chainText(chain) {
  if (!chain) return '';
  if (chain.direct) return `${chain.typeName || ''} ← ${chain.constructionName || ''} (U direct${chain.chain && chain.chain[0] && chain.chain[0].source ? `, ${chain.chain[0].source}` : ''})`;
  const layers = (chain.layers || []).map((l) => `${l.label} ${l.thicknessMm ?? ''}mm λ${l.lambda ?? ''}${l.verified === false ? '*' : ''}`).join(' + ');
  return `${chain.typeName || ''} ← ${chain.constructionName || ''} ← ${layers} (Rsi ${chain.rsi} Rse ${chain.rse})`;
}

export function render(root, ctx) {
  const { store } = ctx;
  const p = store.project;
  const d = ctx.derived();
  clear(root);
  const res = d.results;
  const sel = store.state.selection;
  const roomRows = d.calcModel.rooms.map((r) => {
    const rr = res.rooms[r.id];
    const rec = p.rooms.find((x) => x.id === r.id) || {};
    return { attrs: { class: sel.ids.includes(r.id) ? 'selected' : '', onClick: () => store.setSelection({ ids: [r.id], level: r.level }) }, cells: [r.id, rec.name || '', t(`roomTypes.${r.roomType}`), r.heated ? '' : t('audit.unheatedTemp').split(' ')[0], fmt(r.areaM2, 1), fmt(rr.temp, 1), fmt(rr.transmission + rr.surcharge, 0), fmt(rr.ventilation, 0), fmt(rr.infiltration, 0), h('b', {}, fmt(rr.total, 0))] };
  });
  const levelRows = Object.entries(res.levels).sort((a, b) => Number(a[0]) - Number(b[0])).map(([l, w]) => ({ cells: [l, h('b', {}, fmt(w, 0))] }));
  // bulk edit
  const bulk = { type: 'kitchen', field: 'ventilationLs', value: null };
  const selectedIds = () => (sel.ids || []).filter((id) => p.rooms.some((r) => r.id === id));
  root.append(
    h('div', { class: 'audit-layout' },
      h('div', {},
        section(t('audit.list'), table([t('audit.room'), t('editor.name'), t('editor.roomType'), '', t('audit.area'), '°C', t('audit.transmission'), t('audit.ventilation'), t('audit.infiltration'), t('audit.total')], roomRows),
          h('div', { class: 'row' }, h('b', {}, `${t('audit.building')}: ${fmt(res.building, 0)} W`), h('span', { class: 'muted' }, t('audit.heatedOnly'))),
          h('h4', {}, t('audit.perLevel')), table([t('floors.level'), t('audit.watts')], levelRows)),
        res.slabCheck ? section(t('audit.slabCheck'), table(['', 'W'], [{ cells: [t('audit.perRoomSlab'), fmt(res.slabCheck.perRoomSlabWatts, 0)] }, { cells: [`${t('audit.isoTotal')} (B' ${fmt(res.slabCheck.Bp, 2)} m, dt ${fmt(res.slabCheck.dt, 2)} m, U0 ${fmt(res.slabCheck.U0, 3)}, A ${fmt(res.slabCheck.A, 1)} m², P ${fmt(res.slabCheck.P, 1)} m, ΔT ${fmt(res.slabCheck.dT, 1)})`, fmt(res.slabCheck.isoWatts, 0)] }]), h('p', { class: 'help' }, t('audit.noWarning')), h('p', { class: 'muted small' }, `${res.slabCheck.formula}; ${res.slabCheck.source}; ${res.slabCheck.note}`)) : null,
        section(t('audit.bulk'),
          h('div', { class: 'row' }, h('label', {}, t('audit.selectByType')), select(ROOM_TYPES.map((r) => [r, t(`roomTypes.${r}`)]), bulk.type, (v) => (bulk.type = v)), button(t('editor.select'), () => store.setSelection({ ids: p.rooms.filter((r) => r.roomType === bulk.type).map((r) => r.id) }))),
          h('div', { class: 'row' }, h('span', {}, `${selectedIds().length} ${t('audit.selected')}`), select([['ventilationLs', t('audit.flow')], ['setpoint', t('audit.setpoint')], ['supplyTempOverride', t('audit.supplyTemp')], ['infiltrationAchOverride', t('audit.ach')], ['heated', t('editor.heated')], ['roomType', t('editor.roomType')]], bulk.field, (v) => (bulk.field = v)), textInput('', (v) => (bulk.value = v), { width: '8em' }),
            button(t('audit.applyToSelected'), () => { const ids = selectedIds(); store.update((pr) => { for (const r of pr.rooms) if (ids.includes(r.id)) { let v = bulk.value; if (bulk.field === 'heated') v = /^(true|ja|yes|1)$/i.test(v); else if (bulk.field !== 'roomType') v = v === '' ? null : Number(String(v).replace(',', '.')); r[bulk.field] = v; r.userEdited = true; } }, { label: 'bulk edit' }); }))
        ),
        d.warnings.length ? section('⚠', h('ul', {}, d.warnings.slice(0, 30).map((w) => h('li', {}, `${w.type} ${w.id || ''} ${w.level != null ? `(${t('floors.level')} ${w.level})` : ''} ${w.message || ''}`)))) : null
      ),
      h('div', { class: 'audit-side' }, sel.ids && sel.ids.length === 1 && p.rooms.some((r) => r.id === sel.ids[0]) ? roomPanel(sel.ids[0], ctx, { colorRows: true }) : h('p', { class: 'muted' }, t('model3d.legend')))
    )
  );
}
