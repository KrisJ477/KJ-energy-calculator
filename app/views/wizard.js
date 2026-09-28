// Setup wizard (SPEC 4.1).
import { h, clear, numberInput, textInput, select, section, button } from '../ui/dom.js';
import { t } from '../i18n/strings.js';
import { AGE_CATEGORIES, AGE_CATEGORY_SOURCE } from '../engine/constants.js';

export function render(root, ctx) {
  const { store } = ctx;
  const p = store.project;
  const c = p.config;
  clear(root);
  const set = (fn) => store.update(fn, { label: 'wizard' });
  const ageRows = AGE_CATEGORIES.map((a) => [a.id, `${a.label[ctx.lang] || a.label.sv} — n50 = ${a.n50} /h`]);
  const supplyRow = h('div', { class: 'row', style: { display: c.ventilationSystem === 'ftx' ? '' : 'none' } }, h('label', {}, t('wizard.supplyTemp')), numberInput(c.supplyAirTemp, (v) => set((pr) => (pr.config.supplyAirTemp = v))));
  root.append(
    section(
      t('wizard.title'),
      h('div', { class: 'row' }, h('label', {}, t('wizard.name')), textInput(p.meta.name, (v) => set((pr) => (pr.meta.name = v)), { width: '24em' })),
      h('div', { class: 'row' }, h('label', {}, t('wizard.ageCategory')), select(ageRows, c.ageCategory, (v) => set((pr) => (pr.config.ageCategory = v)))),
      h('p', { class: 'help' }, t('wizard.ageHelp'), ' ', h('span', { class: 'muted' }, AGE_CATEGORY_SOURCE)),
      h('div', { class: 'row' }, h('label', {}, t('wizard.outdoorTemp')), numberInput(c.outdoorTemp, (v) => set((pr) => (pr.config.outdoorTemp = v)))),
      h('div', { class: 'row' }, h('label', {}, t('wizard.indoorSetpoint')), numberInput(c.indoorSetpoint, (v) => set((pr) => (pr.config.indoorSetpoint = v)))),
      h('div', { class: 'row' }, h('label', {}, t('wizard.ventilationSystem')), select([['ftx', t('wizard.ftx')], ['exhaust', t('wizard.exhaust')], ['natural', t('wizard.natural')]], c.ventilationSystem, (v) => { set((pr) => (pr.config.ventilationSystem = v)); supplyRow.style.display = v === 'ftx' ? '' : 'none'; })),
      supplyRow,
      h('div', { class: 'row col' }, h('label', {}, t('wizard.brief')), h('p', { class: 'help' }, t('wizard.briefHelp')), h('textarea', { rows: 14, style: { width: '100%' }, onChange: (e) => set((pr) => (pr.brief = e.target.value)) }, p.brief)),
      button(t('wizard.start'), () => ctx.navigate('drawings'), { class: 'btn primary' })
    )
  );
}
