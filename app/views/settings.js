// Settings page (SPEC 3.14, 6): all configuration values live here.
import { h, clear, numberInput, select, section, checkbox, button, textInput, table } from '../ui/dom.js';
import { t } from '../i18n/strings.js';
import { AGE_CATEGORIES, AGE_CATEGORY_SOURCE, AIR, SURFACE_RESISTANCES, GROUND, INFILTRATION } from '../engine/constants.js';
import { PROMPT_VERSION } from '../ai/prompts.js';

const MODELS = ['claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5'];

export function render(root, ctx) {
  const { store } = ctx;
  const p = store.project;
  const c = p.config;
  clear(root);
  const set = (fn) => store.update(fn, { label: 'settings' });
  const row = (label, input) => h('div', { class: 'row' }, h('label', {}, label), input);
  const num = (key, opts) => numberInput(c[key], (v) => set((pr) => (pr.config[key] = v)), opts);
  root.append(
    section(
      t('settings.building'),
      row(t('wizard.ageCategory'), select(AGE_CATEGORIES.map((a) => [a.id, `${a.label[ctx.lang] || a.label.sv} (n50 ${a.n50})`]), c.ageCategory, (v) => set((pr) => (pr.config.ageCategory = v)))),
      row(`${t('wizard.n50')} (override)`, num('n50Override')),
      row(t('settings.shielding'), select([['none', t('settings.shieldingNone')], ['moderate', t('settings.shieldingModerate')], ['heavy', t('settings.shieldingHeavy')]], c.shieldingClass, (v) => set((pr) => (pr.config.shieldingClass = v)))),
      row(t('settings.fakeFloorU'), num('fakeFloorU')),
      row(t('settings.sliverWidth'), num('sliverWidthMm')),
      row(t('settings.sliverArea'), num('sliverAreaM2')),
      row(t('settings.baseFlow'), num('baseVentilationLsPerM2')),
      row(t('wizard.outdoorTemp'), num('outdoorTemp')),
      row(t('wizard.indoorSetpoint'), num('indoorSetpoint')),
      row(t('settings.soilTemp'), num('soilWallTemp')),
      row(t('settings.bandTemp'), num('slabBandTemp')),
      row(t('settings.innerTemp'), num('slabInnerTemp')),
      row(t('settings.bandWidth'), num('slabBandWidthM')),
      row(t('settings.soilLambda'), num('soilConductivity')),
      row(t('wizard.ventilationSystem'), select([['ftx', t('wizard.ftx')], ['exhaust', t('wizard.exhaust')], ['natural', t('wizard.natural')]], c.ventilationSystem, (v) => set((pr) => (pr.config.ventilationSystem = v)))),
      row(t('wizard.supplyTemp'), num('supplyAirTemp')),
      row(t('settings.tb'), num('thermalBridgePct')),
      row(t('settings.snap'), num('snapToleranceOverrideMm')),
      row(t('settings.doorRange'), h('span', {}, num('doorHeightMinM', { width: '4em' }), ' – ', num('doorHeightMaxM', { width: '4em' }))),
      row(t('settings.scaleNo'), num('scaleNoCorrectionPct')),
      row(t('settings.scaleAgree'), num('scaleAgreementPct')),
      row(t('settings.wallBand'), num('wallTypeBandMm')),
      row(t('settings.openingBand'), num('openingBandMm')),
      h('h4', {}, t('settings.scaleTruth')),
      h('div', {}, p.levels.filter((l) => l.referenceFloor).map((l) => h('div', {}, `${l.name}: `, l.referenceWalls ? l.referenceWalls.map((w) => `${w.wallId} = ${Math.round(w.lengthMm)} mm`).join(', ') : '–')))
    ),
    section(
      t('settings.ai'),
      ...Object.entries(c.ai.models).map(([job, model]) => row(`${t('settings.modelFor')} ${t(`settings.jobs.${job}`)}`, select(MODELS.map((m) => [m, m]), model, (v) => set((pr) => (pr.config.ai.models[job] = v))))),
      row(t('settings.targetRes'), numberInput(c.ai.targetMmPerPx, (v) => set((pr) => (pr.config.ai.targetMmPerPx = v)))),
      row(t('settings.overlap'), numberInput(c.ai.tileOverlapM, (v) => set((pr) => (pr.config.ai.tileOverlapM = v)))),
      row(t('settings.tileMax'), numberInput(c.ai.tileMaxLongEdgePx, (v) => set((pr) => (pr.config.ai.tileMaxLongEdgePx = v)))),
      h('p', { class: 'help' }, t('settings.imageLimitNote')),
      row(t('settings.manual'), checkbox(c.ai.manualMode, (v) => { set((pr) => (pr.config.ai.manualMode = v)); ctx.refreshMode(); })),
      row(t('settings.workerUrl'), textInput(ctx.getWorkerUrl(), (v) => ctx.setWorkerUrl(v), { width: '28em' })),
      row(t('settings.promptVersions'), h('span', {}, PROMPT_VERSION)),
      button(t('settings.clearPassword'), () => ctx.clearPassword())
    ),
    section(
      t('settings.sources'),
      table(['', ''], [
        { cells: ['ρ·cp air', `${AIR.rhoCp_Wh_per_m3K} Wh/(m³K) — ${AIR.source} — ${AIR.verified ? t('constructions.verified') : t('constructions.unverified')}`] },
        { cells: ['Rsi/Rse', `${JSON.stringify({ up: SURFACE_RESISTANCES.up, horizontal: SURFACE_RESISTANCES.horizontal, down: SURFACE_RESISTANCES.down })} — ${SURFACE_RESISTANCES.source} — ${t('constructions.unverified')}`] },
        { cells: ['ISO 13370', `${GROUND.formulaSource}; λ ${JSON.stringify(GROUND.conductivity)} — ${GROUND.source} — ${t('constructions.unverified')}`] },
        { cells: ['EN 12831 infiltration', `${INFILTRATION.formula}; e ${JSON.stringify(INFILTRATION.shielding)}; ε ${JSON.stringify(INFILTRATION.heightCorrection)} — ${INFILTRATION.source}`] },
        { cells: [t('settings.ageDefaults'), `${AGE_CATEGORIES.map((a) => `${a.id}: ${a.n50}`).join(', ')} — ${AGE_CATEGORY_SOURCE}`] },
      ])
    )
  );
}
