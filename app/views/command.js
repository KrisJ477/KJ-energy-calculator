// Command window (SPEC 4.11): free text → question back or proposed change list → Apply/Cancel.
import { h, clear, section, button, textInput } from '../ui/dom.js';
import { t } from '../i18n/strings.js';
import { ORIGIN } from '../state/model.js';

export function projectSummary(p) {
  return {
    config: p.config,
    levels: p.levels.map((l) => ({ level: l.level, name: l.name, heightMm: l.heightMm })),
    rooms: p.rooms.map((r) => ({ id: r.id, level: r.level, name: r.name, roomType: r.roomType, heated: r.heated, setpoint: r.setpoint, ventilationLs: r.ventilationLs, supplyTempOverride: r.supplyTempOverride, infiltrationAchOverride: r.infiltrationAchOverride })),
    walls: p.walls.filter((w) => !w.deleted).map((w) => ({ id: w.id, level: w.level, wallTypeId: w.wallTypeId, percentUnderground: w.percentUnderground, outsideSpace: w.outsideSpace })),
    openings: p.openings.filter((o) => !o.deleted).map((o) => ({ id: o.id, kind: o.kind, openingTypeId: o.openingTypeId, heightMm: o.heightMm })),
    pieceOverrides: p.pieceOverrides,
    library: { wallTypes: p.library.wallTypes.map((x) => x.id), floorTypes: p.library.floorTypes.map((x) => x.id), openingTypes: p.library.openingTypes.map((x) => x.id) },
  };
}

export function applyChanges(project, changes, readId) {
  const touched = [];
  const parse = (v) => {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null' || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isNaN(n) ? v : n;
  };
  for (const ch of changes) {
    const val = parse(ch.new_value);
    if (ch.object_type === 'config') {
      const path = ch.field.replace(/^config\./, '').split('.');
      let node = project.config;
      for (let i = 0; i < path.length - 1; i++) node = node[path[i]] = node[path[i]] || {};
      node[path[path.length - 1]] = val;
      touched.push({ type: 'config', id: ch.field, change: `${ch.old_value} → ${ch.new_value}` });
    } else if (ch.object_type === 'room') {
      const r = project.rooms.find((x) => x.id === ch.object_id);
      if (r) {
        r[ch.field.replace(/^room\./, '')] = val;
        r.origin = ORIGIN.command;
        r.commandReadId = readId;
        touched.push({ type: 'room', id: r.id, change: `${ch.field}: ${ch.old_value} → ${ch.new_value}` });
      }
    } else if (ch.object_type === 'wall') {
      const w = project.walls.find((x) => x.id === ch.object_id);
      if (w) {
        w[ch.field.replace(/^wall\./, '')] = val;
        w.origin = ORIGIN.command;
        touched.push({ type: 'wall', id: w.id, change: `${ch.field}: ${ch.old_value} → ${ch.new_value}` });
      }
    } else if (ch.object_type === 'opening') {
      const o = project.openings.find((x) => x.id === ch.object_id);
      if (o) {
        o[ch.field.replace(/^opening\./, '')] = val;
        o.origin = ORIGIN.command;
        touched.push({ type: 'opening', id: o.id, change: `${ch.field}: ${ch.old_value} → ${ch.new_value}` });
      }
    } else if (ch.object_type === 'outsideSpace') {
      const w = project.walls.find((x) => x.id === ch.object_id);
      if (w) {
        w.outsideSpace = { temp: val };
        w.origin = ORIGIN.command;
        touched.push({ type: 'wall', id: w.id, change: `outside space temp → ${ch.new_value}` });
      } else if (project.pieceOverrides[ch.object_id]) {
        project.pieceOverrides[ch.object_id].outsideSpace = { temp: val };
        touched.push({ type: 'piece', id: ch.object_id, change: `outside space temp → ${ch.new_value}` });
      }
    }
  }
  return touched;
}

export function render(root, ctx) {
  const { store } = ctx;
  clear(root);
  const state = ctx.commandState || (ctx.commandState = { history: [], pending: null, busy: false });
  let text = '';
  const histEl = h('div', { class: 'cmd-history' });
  const draw = () => {
    clear(histEl);
    for (const item of state.history) {
      histEl.append(h('div', { class: 'cmd-item' }, h('div', { class: 'cmd-user' }, '> ', item.command)));
      if (item.response && item.response.kind === 'question') {
        histEl.append(h('div', { class: 'cmd-q' }, h('b', {}, t('command.question')), ': ', item.response.question.text,
          h('div', {}, item.response.question.options.map((o) => button(o, () => send(`${item.command}\nAnswer: ${o}`)))), h('div', {}, h('em', {}, t('command.freeText')))));
      } else if (item.response && item.response.kind === 'proposal') {
        const list = h('ul', {}, item.response.changes.map((c) => h('li', {}, `${c.object_type} ${c.object_id}: ${c.field} ${c.old_value} → ${c.new_value} (${c.reasoning})`)));
        histEl.append(h('div', { class: 'cmd-p' }, h('b', {}, t('command.proposal')), ': ', item.response.summary, list,
          item.applied ? h('div', {}, h('b', {}, t('command.applied')), h('ul', {}, item.applied.map((x) => h('li', {}, `${x.type} ${x.id}: ${x.change}`)))) :
            h('div', {}, button(t('apply'), () => { store.update((p) => { item.applied = applyChanges(p, item.response.changes, item.readId); const r = p.reads.find((x) => x.id === item.readId); if (r) r.objectsTouched = item.applied; p.commandLog.push({ readId: item.readId, command: item.command, applied: item.applied, at: new Date().toISOString() }); }, { label: 'command' }); draw(); }, { class: 'btn primary' }), button(t('cancel'), () => { item.cancelled = true; draw(); }))));
      } else if (item.error) histEl.append(h('div', { class: 'cmd-err' }, item.error));
      else histEl.append(h('div', { class: 'muted' }, '…'));
    }
  };
  const send = async (cmd) => {
    const item = { command: cmd };
    state.history.push(item);
    draw();
    try {
      const { readId, data } = await ctx.runner.command(cmd, projectSummary(store.project));
      item.readId = readId;
      item.response = data;
    } catch (e) {
      item.error = String(e.message || e);
    }
    draw();
  };
  const input = h('textarea', { rows: 3, style: { width: '100%' }, placeholder: t('command.placeholder'), onInput: (e) => (text = e.target.value) });
  root.append(section(t('command.title'), h('p', { class: 'help' }, t('command.intro')), input, button(t('command.send'), () => { if (text.trim()) { send(text.trim()); input.value = ''; text = ''; } }, { class: 'btn primary' }), h('h4', {}, t('command.history')), histEl));
  draw();
}
