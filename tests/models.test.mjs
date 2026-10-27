import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  piN, piT, piAlpha, lambda3, byId, normaliseProfile, profileProblems,
  MODELS, computeComponent, computeBoard, mtbfHours, reliability,
} from '../assets/models.js';
import { IC_PACKAGES, MISSION_PROFILES, ALL_TABLES, STATUS, SOURCES } from '../assets/tables.js';

const close = (actual, expected, rel = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected),
    `expected ${expected}, got ${actual}`);

const preset = (id) => ({ phases: byId(MISSION_PROFILES, id).phases, tauOff: null });

test('π_t is 1 at the reference temperature', () => {
  assert.equal(piT(55, 3480, 328), 1);
  assert.equal(piT(40, 4640, 313), 1);
});

test('π_n switches law above 8760 cycles a year', () => {
  assert.equal(piN(0), 0);
  close(piN(365), 365 ** 0.76);
  close(piN(8760), 8760 ** 0.76);
  close(piN(10000), 1.7 * 10000 ** 0.6);
});

test('π_α for FR4 under a plastic package', () => {
  close(piAlpha(16, 21.5), 1.0518663664953403);
  assert.equal(piAlpha(16, 16), 0);
});

test('fixed QFP/BGA λ3 values agree with the diagonal formulas', () => {
  const fourSides = byId(IC_PACKAGES, 'diag-four-sides');
  const matrix = byId(IC_PACKAGES, 'diag-matrix');
  for (const row of IC_PACKAGES.rows.filter((r) => r.kind === 'fixed')) {
    const formula = row.id.startsWith('pqfp') ? fourSides : matrix;
    const fromDiagonal = lambda3(formula, { diagonal: Math.hypot(...row.body) });
    const err = Math.abs(fromDiagonal - row.value) / row.value;
    assert.ok(err < 0.12, `${row.label}: table ${row.value}, diagonal formula ${fromDiagonal.toFixed(2)}`);
  }
});

test('IC worked example: MOS digital, PQFP 10×10, GEO permanent profile', () => {
  const prof = normaliseProfile(preset('geo-permanent'));
  const r = MODELS.ic.compute({
    ...MODELS.ic.defaults,
    family: 'mos-digital', count: 10000, year: 2020, power: 0.5, rja: 40,
    package: 'pqfp-10', substrate: 'fr4', pkgMaterial: 'plastic', eos: 'none',
  }, prof);
  // Die: (3.4e-6 × 40 000 × e^(−0.35 × 22) + 1.7) × exp{3480 × [1/328 − 1/333]}
  close(r.parts[0][1], 1.993655969271882);
  // Package: 2.75e-3 × π_α(16, 21.5) × 365^0.76 × 8^0.68 × 4.1
  close(r.parts[1][1], 4.320369459675254);
  assert.equal(r.parts[2][1], 0);
  close(r.fit, 6.314025428947136);
  assert.deepEqual(r.errors, []);
});

test('interface IC adds λ_EOS', () => {
  const prof = normaliseProfile(preset('geo-permanent'));
  const base = { ...MODELS.ic.defaults, year: 2020 };
  const plain = MODELS.ic.compute(base, prof).fit;
  const iface = MODELS.ic.compute({ ...base, eos: 'telecom-transmitting' }, prof).fit;
  close(iface - plain, 40);
});

test('dormant phases add cycling but no operating stress; ΔT_j/3 applies only where flagged', () => {
  const prof = normaliseProfile(preset('military-radio'));
  close(prof.tauOn, 0.01);
  close(prof.tauOff, 0.99);
  const r = MODELS.diode.compute({ ...MODELS.diode.defaults, type: 'signal', power: 0.05, rja: 300, package: 'sod123' }, prof);
  assert.equal(r.operating.length, 1, 'only the working phase contributes to the die term');
  close(r.cycling[0].dT, 15 + 15 / 3);
  close(r.cycling[1].dT, 8);
  close(r.parts[0][1], 0.0007338402937617);
  close(r.parts[1][1], 1.3230245680253292);
});

test('profile checks catch working ratios above 1', () => {
  assert.deepEqual(profileProblems(preset('leo-onoff')), []);
  const bad = { phases: [{ tac: 25, tau: 0.7, n: 1, dT: 1 }, { tac: 25, tau: 0.6, n: 1, dT: 1 }] };
  assert.equal(profileProblems(bad).length, 1);
});

const COMPLETE = {
  ic: { count: 1000, power: 0.1, rja: 50, package: 'so', pins: 8 },
  diode: { power: 0.01, rja: 300 },
  transistor: { stress: 0.5, power: 0.05, rja: 300 },
  capacitor: {},
  resistor: { power: 0.01, rated: 0.1 },
  inductor: { l0: 1, ploss: 0.1, area: 0.04 },
  fixed: { fit: 5 },
  'mil-relay': { application: 'f6', stress: 0.5, cycles: 5 },
  'mil-ssr': {},
  'mil-switch': { type: 'toggle', stress: 0.3 },
  'mil-connector': { type: 'rectangular', current: 1, cycles: 0 },
  'mil-socket': { type: 'dip', pins: 16 },
  'mil-pwb': { n1: 100, planes: 4 },
  'mil-crystal': { freq: 8 },
  'mil-fuse': {},
  'mil-lamp': { voltage: 5, utilization: 0.5, application: 'dc' },
  'mil-opto': { type: 'led', power: 0.02, rja: 500 },
  'mil-capacitor': { style: 'CSR', capacitance: 10, stress: 0.5, cr: 0.5 },
  'mil-resistor': { style: 'RW', power: 1, rated: 5 },
  'mil-inductive': { kind: 'coil-fixed', dT: 20 },
  vendor: { fit: 10, tref: 55, ea: 0.7, power: 0.1, rja: 50 },
};

test('every model gives a finite, non-negative rate for every preset', () => {
  for (const mp of MISSION_PROFILES.rows) {
    const prof = normaliseProfile({ phases: mp.phases });
    for (const [id, model] of Object.entries(MODELS)) {
      const r = computeComponent({ model: id, qty: 1, params: COMPLETE[id] }, prof);
      assert.ok(Number.isFinite(r.fit) && r.fit >= 0, `${id} under ${mp.id}: ${r.fit}`);
      assert.deepEqual(r.errors, [], `${id} under ${mp.id}`);
      assert.equal(r.complete, true);
      for (const f of model.fields) assert.ok(f.key in model.defaults, `${id}.${f.key} has a default`);
    }
  }
});

test('a new part starts with its operating values missing, not invented', () => {
  const prof = normaliseProfile(preset('geo-permanent'));
  const missing = (model, params = {}) => computeComponent({ model, qty: 1, params }, prof).missing;
  assert.deepEqual(missing('ic'), ['count', 'power', 'rja']);
  assert.deepEqual(missing('transistor'), ['stress', 'power', 'rja']);
  assert.deepEqual(missing('resistor'), ['power', 'rated']);
  assert.deepEqual(missing('inductor'), ['l0', 'ploss', 'area']);
  assert.deepEqual(missing('fixed'), ['fit']);
  assert.deepEqual(missing('capacitor'), []);
  // An unknown select is missing too, and hidden fields never are.
  assert.deepEqual(missing('ic', { ...COMPLETE.ic, family: null }), ['family']);
  assert.deepEqual(missing('ic', { ...COMPLETE.ic, package: 'diag-matrix' }), ['bodyW', 'bodyL']);
  // Overriding λ3 makes the package geometry unnecessary.
  assert.deepEqual(missing('ic', { ...COMPLETE.ic, package: 'diag-matrix', l3Override: 5 }), []);
});

test('incomplete parts are left out of the board total', () => {
  const board = computeBoard({
    profile: preset('geo-permanent'),
    components: [
      { model: 'fixed', qty: 1, params: { fit: 10 } },
      { model: 'ic', qty: 1, params: { power: 1, rja: 50 } }, // count missing
    ],
  });
  close(board.total, 10);
  assert.equal(board.incomplete, 1);
  assert.equal(board.items[1].result.total, 0);
  assert.match(board.items[1].result.errors[0], /^Missing: Size, in gates\.$/);
});

test('board total is the quantity-weighted sum', () => {
  const project = {
    profile: preset('geo-permanent'),
    components: [
      { model: 'fixed', qty: 3, params: { fit: 10 } },
      { model: 'fixed', qty: 2, params: { fit: 5 } },
    ],
  };
  close(computeBoard(project).total, 40);
  close(mtbfHours(40), 25e6);
  close(reliability(1e9 / 8760, 1), Math.exp(-1));
});

test('every table names its sources and how well they support it', () => {
  for (const t of ALL_TABLES) {
    assert.ok(t.ref && t.title, t.id);
    assert.ok(t.status in STATUS, t.id);
    assert.ok(t.sources.length > 0 && t.sources.every((s) => s in SOURCES), t.id);
    if (t.status === 'corroborated') assert.ok(t.sources.length >= 2, t.id);
  }
});

test('automotive motor-control profile (TI SLOA294A Table 6-1)', () => {
  const prof = normaliseProfile(preset('auto-motor'));
  close(prof.tauOn, 0.058);
  close(prof.tauOff, 0.942);
  assert.deepEqual(profileProblems(preset('auto-motor')), []);
  // TI's worked example: with ΔTj = 15 °C, the start cycles are 15/3 + 55 = 60 °C and 15/3 + 45 = 50 °C.
  const r = MODELS.ic.compute({ ...COMPLETE.ic, power: 0.3, rja: 50 }, prof);
  assert.deepEqual(r.cycling.map((c) => [c.n, +c.dT.toFixed(6)]), [[0, 0], [0, 0], [0, 0], [670, 60], [1340, 50], [30, 10]]);
  assert.deepEqual(r.operating.map((o) => o.t), [32 + 15, 60 + 15, 85 + 15]);
});

test('a working phase without a temperature is a profile problem', () => {
  assert.match(profileProblems({ phases: [{ tac: null, tau: 1, n: 0, dT: 0 }] })[0], /Phase 1 is a working phase but has no t_ac/);
  assert.deepEqual(profileProblems({ phases: [{ tac: 25, tau: 1, n: 0, dT: 0 }, { tac: null, tau: 0, n: 30, dT: 10 }] }), []);
});

test('vendor rate at one temperature, rescaled by Arrhenius', () => {
  const prof = normaliseProfile({ phases: [{ tac: 40, tau: 1, n: 0, dT: 0 }] });
  // 10 FIT at 55 °C, Ea 0.7 eV, used at T_j = 40 + 45 = 85 °C.
  const r = computeComponent({ model: 'vendor', qty: 1, params: { method: 'arrhenius', fit: 10, tref: 55, ea: 0.7, power: 1, rja: 45 } }, prof);
  assert.deepEqual(r.errors, []);
  close(r.fit, 79.67904984765495, 1e-4);
  // Half the time switched off halves it.
  const half = normaliseProfile({ phases: [{ tac: 40, tau: 0.5, n: 0, dT: 0 }] });
  close(computeComponent({ model: 'vendor', qty: 1, params: { method: 'arrhenius', fit: 10, tref: 55, ea: 0.7, power: 1, rja: 45 } }, half).fit, 79.67904984765495 / 2, 1e-4);
});

test('vendor IEC 62380 report rescaled to another profile matches the IC model run there', () => {
  const motor = normaliseProfile(preset('auto-motor'));
  const geo = normaliseProfile(preset('geo-permanent'));
  const ic = { ...MODELS.ic.defaults, family: 'mos-digital', count: 1e5, year: 2020, power: 0.3, rja: 50, package: 'so', pins: 8 };
  const atMotor = MODELS.ic.compute(ic, motor);
  const atGeo = MODELS.ic.compute(ic, geo);
  const report = { method: 'report62380', dieFit: atMotor.parts[0][1], pkgFit: atMotor.parts[1][1], eosFit: 0, refProfile: 'auto-motor', refRise: 15, tech: 'mos', power: 0.3, rja: 50 };
  // Same profile and rise: the report's numbers come back unchanged.
  const same = computeComponent({ model: 'vendor', qty: 1, params: report }, motor);
  assert.deepEqual(same.errors, []);
  close(same.parts[0][1], atMotor.parts[0][1]);
  close(same.parts[1][1], atMotor.parts[1][1]);
  // Rescaled to the GEO profile: equal to the 62380 IC model evaluated there.
  const moved = computeComponent({ model: 'vendor', qty: 1, params: report }, geo);
  close(moved.parts[0][1], atGeo.parts[0][1]);
  close(moved.parts[1][1], atGeo.parts[1][1]);
});
