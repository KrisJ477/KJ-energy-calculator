// Gap dialog (SPEC 4.7): asked once after all reads, only what blocks 3D or the calculation.
import { h, clear, numberInput, section, button, select, table } from '../ui/dom.js';
import { t } from '../i18n/strings.js';
import { openingClusters } from '../state/derive.js';

export function computeGaps(project, derived) {
  const items = [];
  const levels = [...project.levels].sort((a, b) => a.level - b.level);
  for (const l of levels) if (!l.heightMm) items.push({ kind: 'floorHeight', level: l.level });
  if (levels.length > 1 && !project.ui.floorsConfirmed) items.push({ kind: 'floorOrder' });
  const bottom = levels[0];
  if (bottom) {
    const ext = project.walls.filter((w) => w.level === bottom.level && !w.deleted);
    const hasDatum = project.sheets.some((s) => s.type === 'vertical' && s.groundLine && s.groundLine.y != null);
    if (!hasDatum && ext.length && !(bottom.undergroundAnswered)) items.push({ kind: 'underground', level: bottom.level });
  }
  const top = levels[levels.length - 1];
  if (top && top.coldAttic == null) {
    const fromVertical = project.sheets.find((s) => s.type === 'vertical' && s.coldAttic != null);
    if (!fromVertical) items.push({ kind: 'attic', level: top.level });
  }
  const ops = project.openings.filter((o) => !o.deleted).map((o) => ({ ...o, widthMm: widthOf(project, o) }));
  const clusters = openingClusters(ops, project.config.openingBandMm ?? 50).filter((c) => c.h < 0);
  for (const c of clusters) items.push({ kind: 'openingHeight', cluster: c });
  for (const s of project.sheets) if (s.type === 'plan' && s.level != null && s.coverageGaps && s.coverageGaps.length) items.push({ kind: 'coverage', level: s.level, notes: s.coverageGaps });
  for (const l of levels) if (l.readNotes && l.readNotes.some((n) => /cover|täck/i.test(n))) items.push({ kind: 'coverage', level: l.level, notes: l.readNotes.filter((n) => /cover|täck/i.test(n)) });
  return items;
}
function widthOf(project, o) {
  if (o.widthMm != null) return o.widthMm;
  const sh = project.sheets.find((s) => s.id === o.sheetId);
  return sh && sh.scale && o.widthPx != null ? o.widthPx * sh.scale.mmPerPx : null;
}

export function render(root, ctx) {
  const { store } = ctx;
  const p = store.project;
  clear(root);
  const items = computeGaps(p, ctx.derived());
  const set = (fn) => store.update(fn, { label: 'gaps' });
  const parts = [h('p', { class: 'help' }, t('gaps.intro'))];
  if (!items.length) parts.push(h('p', {}, t('gaps.nothing')));
  for (const it of items) {
    if (it.kind === 'floorHeight') parts.push(h('div', { class: 'row' }, h('label', {}, `${t('gaps.floorHeights')}: ${it.level}`), numberInput(null, (v) => set((pr) => (pr.levels.find((l) => l.level === it.level).heightMm = v)), { placeholder: 'mm' })));
    else if (it.kind === 'floorOrder') parts.push(h('div', { class: 'row' }, h('label', {}, t('gaps.floorOrder')), button(t('floors.confirm'), () => ctx.navigate('floors'))));
    else if (it.kind === 'underground') parts.push(h('div', { class: 'row' }, h('label', {}, `${t('gaps.underground')} (${t('floors.level')} ${it.level})`), numberInput(0, (v) => set((pr) => { pr.walls.forEach((w) => { if (w.level === it.level && !w.deleted && w.exteriorGuess !== false) w.percentUnderground = v; }); pr.levels.find((l) => l.level === it.level).undergroundAnswered = true; }), { placeholder: '%' })));
    else if (it.kind === 'attic') parts.push(h('div', { class: 'row' }, h('label', {}, t('gaps.attic')), select([[null, '?'], ['true', t('yes')], ['false', t('no')]], null, (v) => set((pr) => (pr.levels.find((l) => l.level === it.level).coldAttic = v === 'true')))));
    else if (it.kind === 'openingHeight') parts.push(h('div', { class: 'row' }, h('label', {}, `${t('gaps.openingHeights')}: ${it.cluster.kind} ${Math.round(it.cluster.w)} mm × ${it.cluster.ids.length}`), numberInput(null, (v) => set((pr) => pr.openings.forEach((o) => { if (it.cluster.ids.includes(o.id)) { o.heightMm = v; o.heightConfidence = o.heightConfidence || 'LOW'; o.source = o.source || 'gap dialog'; } })), { placeholder: 'mm' })));
    else if (it.kind === 'coverage') parts.push(h('div', { class: 'row' }, h('label', {}, `${t('gaps.coverage')} (${it.level})`), h('span', {}, it.notes.join('; '))));
  }
  parts.push(button(t('gaps.continue'), () => ctx.navigate('constructions'), { class: 'btn primary' }));
  root.append(section(t('gaps.title'), ...parts));
}
