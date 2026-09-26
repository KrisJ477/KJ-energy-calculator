// Floor list (SPEC 3.2, 3.13): level numbers, names, aliases, heights, sheet mapping, roles, reference floor.
import { h, clear, numberInput, textInput, select, section, button, checkbox, table, toast, modal } from '../ui/dom.js';
import { t } from '../i18n/strings.js';
import { newLevel } from '../state/model.js';
import { sheetLabel } from '../ai/jobs.js';

const ROLES = ['base', 'scale-reference', 'change-patch', 'cross-check', 'ignore'];

export function render(root, ctx) {
  const { store } = ctx;
  const p = store.project;
  clear(root);
  const set = (fn, label = 'floors') => store.update(fn, { label });
  const levels = [...p.levels].sort((a, b) => a.level - b.level);
  const rows = levels.map((l) => ({
    cells: [
      numberInput(l.level, (v) => set((pr) => renumber(pr, l.level, v)), { width: '4em', step: 1 }),
      textInput(l.name, (v) => set((pr) => (pr.levels.find((x) => x.level === l.level).name = v))),
      textInput((l.aliases || []).join(', '), (v) => set((pr) => (pr.levels.find((x) => x.level === l.level).aliases = v.split(',').map((s) => s.trim()).filter(Boolean))), { width: '18em' }),
      numberInput(l.heightMm, (v) => set((pr) => (pr.levels.find((x) => x.level === l.level).heightMm = v)), { width: '6em' }),
      checkbox(l.referenceFloor, (v) => set((pr) => pr.levels.forEach((x) => (x.referenceFloor = x.level === l.level ? v : false)))),
      select([[null, '?'], [true, t('yes')], [false, t('no')]], l.coldAttic, (v) => set((pr) => (pr.levels.find((x) => x.level === l.level).coldAttic = v === 'true' ? true : v === 'false' ? false : null))),
      h('span', {}, l.approved ? '✓' : '–'),
      button('×', () => set((pr) => { pr.levels = pr.levels.filter((x) => x.level !== l.level); pr.sheets.forEach((s) => { if (s.level === l.level) s.level = null; }); })),
    ],
  }));
  const sheetRows = p.sheets.map((s) => ({
    cells: [
      sheetLabel(p, s),
      select([['plan', t('drawings.plan')], ['vertical', t('drawings.vertical')], ['other', 'other']], s.type, (v) => set((pr) => (pr.sheets.find((x) => x.id === s.id).type = v))),
      select([[null, '–'], ...levels.map((l) => [l.level, `${l.level}: ${l.name}`])], s.level, (v) => set((pr) => (pr.sheets.find((x) => x.id === s.id).level = v == null ? null : Number(v)))),
      textInput(s.partOfFloor || '', (v) => set((pr) => (pr.sheets.find((x) => x.id === s.id).partOfFloor = v)), { width: '8em' }),
      select(ROLES.map((r) => [r, t(`drawings.roles.${r}`)]), s.role, (v) => set((pr) => (pr.sheets.find((x) => x.id === s.id).role = v))),
      h('span', { class: 'muted' }, s.proposedFloors ? s.proposedFloors.map((f) => `${f.name}${f.level_number != null ? ` → ${f.level_number}` : ''}`).join('; ') : ''),
    ],
  }));
  root.append(
    section(
      t('floors.title'),
      h('p', { class: 'help' }, t('floors.aliasHelp')),
      table([t('floors.level'), t('floors.name'), t('floors.aliases'), t('floors.height'), t('floors.reference'), t('floors.coldAttic'), t('floors.approved'), ''], rows),
      h('div', { class: 'row' },
        button(t('floors.addLevel'), () => set((pr) => { const max = pr.levels.length ? Math.max(...pr.levels.map((l) => l.level)) : 0; pr.levels.push(newLevel(max + 1)); })),
        button(t('floors.addProposed'), () => set((pr) => {
          // SPEC 3.2: pre-fill the level list from the readers' floor proposals (sheet level numbers); the user confirms
          for (const s of pr.sheets) {
            if (s.level == null || pr.levels.some((l) => l.level === s.level)) continue;
            const prop = (s.proposedFloors || []).find((f) => f.level_number === s.level);
            const nl = newLevel(s.level, prop ? prop.name : '');
            if (prop) nl.aliases = [prop.name];
            pr.levels.push(nl);
          }
        })),
        button(t('floors.confirm'), () => { set((pr) => (pr.ui.floorsConfirmed = true)); toast(t('floors.confirm')); }, { class: 'btn primary' }),
        button(t('floors.copyTo'), () => copyDialog(ctx))
      )
    ),
    section(t('floors.sheets'), table([t('drawings.files'), t('drawings.classification'), t('floors.level'), t('drawings.partOfFloor'), t('drawings.role'), 'AI'], sheetRows))
  );
}

function renumber(pr, oldLevel, newLevel) {
  if (newLevel == null || pr.levels.some((l) => l.level === newLevel && l.level !== oldLevel)) return;
  const l = pr.levels.find((x) => x.level === oldLevel);
  l.level = newLevel;
  for (const s of pr.sheets) if (s.level === oldLevel) s.level = newLevel;
  for (const w of pr.walls) if (w.level === oldLevel) w.level = newLevel;
  for (const o of pr.openings) if (o.level === oldLevel) o.level = newLevel;
  for (const g of pr.gaps) if (g.level === oldLevel) g.level = newLevel;
  for (const s of pr.separators) if (s.level === oldLevel) s.level = newLevel;
  for (const a of pr.annotations) if (a.level === oldLevel) a.level = newLevel;
  for (const r of pr.rooms) {
    if (r.level === oldLevel) {
      r.level = newLevel;
      r.id = `${newLevel < 0 ? `(${newLevel})` : newLevel}-${r.index}`;
    }
  }
}

// Copying floors (SPEC 4.4): apply an approved floor to a range, diff against each target's own read.
export function copyDialog(ctx) {
  const { store } = ctx;
  const p = store.project;
  const approved = p.levels.filter((l) => l.approved);
  let src = approved[0] ? approved[0].level : null;
  let range = '';
  const body = h('div', {},
    h('div', { class: 'row' }, h('label', {}, t('floors.level')), select(approved.map((l) => [l.level, `${l.level}: ${l.name}`]), src, (v) => (src = Number(v)))),
    h('div', { class: 'row' }, h('label', {}, t('floors.copyTo')), textInput(range, (v) => (range = v), { placeholder: t('floors.copyRange') }))
  );
  modal(t('floors.copyTo'), body, {
    buttons: [{ label: t('cancel') }, { label: t('apply'), primary: true, onClick: () => { if (src == null) return false; const targets = parseRange(range); ctx.copyFloor(src, targets); return true; } }],
  });
}
function parseRange(s) {
  const out = [];
  for (const part of s.split(/[,;]/)) {
    const m = /^\s*(-?\d+)\s*[–-]\s*(-?\d+)\s*$/.exec(part);
    if (m) for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
    else if (/^\s*-?\d+\s*$/.test(part)) out.push(Number(part));
  }
  return out;
}
