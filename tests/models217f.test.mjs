// MIL-HDBK-217F models: each expected value was worked out by hand from the
// handbook's formulas and agrees with its printed tables where they overlap.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MODELS, computeComponent, normaliseProfile } from '../assets/models.js';
import { TABLES_217F, ENVIRONMENTS } from '../assets/tables217f.js';

const close = (actual, expected, rel = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected), `expected ${expected}, got ${actual}`);

// One working phase at 40 °C, always on, in the given environment.
const profile = (env217f = 'GB', phases = [{ tac: 40, tau: 1, n: 0, dT: 0 }]) => normaliseProfile({ phases, env217f });
const fit = (model, params, prof = profile()) => {
  const r = computeComponent({ model, qty: 1, params }, prof);
  assert.deepEqual(r.errors, [], `${model}: ${r.errors.join(' ')}`);
  return r.fit;
};

test('every 217F table lists 14 environment factors, real sources and a status', () => {
  assert.equal(ENVIRONMENTS.length, 14);
  for (const t of TABLES_217F) {
    assert.equal(t.piE.length, 14, t.id);
    assert.ok(t.sources.length > 0, t.id);
    assert.ok(['handbook', 'corroborated'].includes(t.status), `${t.id}: ${t.status}`);
    if (t.status === 'corroborated') assert.ok(t.sources.includes('ramstk'), t.id);
  }
});

test('mechanical relay', () => {
  const p = { application: 'f6', rating: '85', contact: 'SPDT', load: 'resistive', stress: 0.5, cycles: 5, quality: 'commercial', rise: 0 };
  assert.match(MODELS['mil-relay'].fields.find((f) => f.key === 'application').options[6].label, /^Armature \(long\) \(π_F 3\)$/);
  // λ_b(40 °C) = 0.0059·exp(−0.19/k·[1/313 − 1/298]) = 0.00841 (table: .0084)
  close(fit('mil-relay', p), 189.2573137708407);
  // MIL-SPEC quality M at 20 cycles/hour: π_CYC = 20/10, π_Q = 1.0
  close(fit('mil-relay', { ...p, quality: 'M', cycles: 20 }), 130.52228535920048);
  // Commercial above 1000 cycles/hour: π_CYC = (2000/100)² = 400
  close(fit('mil-relay', { ...p, cycles: 2000 }) / fit('mil-relay', p), 400);
  // No environment factor for cannon launch.
  const cl = computeComponent({ model: 'mil-relay', qty: 1, params: p }, profile('CL'));
  assert.match(cl.errors.join(' '), /no environment factor for CL/);
  assert.equal(cl.total, 0);
});

test('switch', () => {
  // Toggle, DPDT (4 contacts), S = 0.3 resistive, lower quality, ground mobile.
  close(fit('mil-switch', { type: 'toggle', load: 'resistive', stress: 0.3, contact: 'DPDT', quality: 'lower' }, profile('GM')), 6547.190226979023);
  // The contact factor applies to toggles and pushbuttons only.
  const reed = { type: 'reed', load: 'resistive', stress: 0.3, contact: 'DPDT', quality: 'lower' };
  close(fit('mil-switch', reed), fit('mil-switch', { ...reed, contact: 'SPST' }));
});

test('connector', () => {
  // Rectangular, 22 AWG at 2 A: ΔT = 0.989·2^1.85 = 3.57 °C; 1 mating cycle per 1000 h: π_K = 2.0.
  const p = { type: 'rectangular', half: 'pair', current: 2, gauge: '22', cycles: 1, quality: 'lower' };
  close(fit('mil-connector', p), 253.32533744296387);
  close(fit('mil-connector', { ...p, half: 'single' }), 126.66266872148194);
  // RF coaxial uses a fixed 5 °C rise, so current and gauge are not asked for.
  const rf = computeComponent({ model: 'mil-connector', qty: 1, params: { type: 'rf-coax', half: 'pair', cycles: 0, quality: 'lower' } }, profile('GF'));
  assert.deepEqual(rf.missing, []);
  close(rf.fit, 1.1553946916767213);
});

test('IC socket, plated-through-hole board, crystal, fuse, lamp', () => {
  // π_P(16 pins) = 3.23 (table: 3.2)
  close(fit('mil-socket', { type: 'dip', pins: 16, quality: 'lower' }), 2.064799204691791);
  // π_C(4 planes) = 0.65·4^0.63 = 1.56 (table: 1.6); 500 machine- and 10 hand-soldered holes.
  close(fit('mil-pwb', { technology: 'pcb', n1: 500, n2: 10, planes: 4, quality: 'lower' }), 31.413564959519892);
  // λ_b(10 MHz) = 0.0221 (table: .022)
  close(fit('mil-crystal', { freq: 10, quality: 'milspec' }), 22.077167482002675);
  close(fit('mil-crystal', { freq: 10, quality: 'lower' }, profile('NU')), 741.7928273952899);
  close(fit('mil-fuse', {}, profile('GF')), 20);
  close(fit('mil-lamp', { voltage: 5, utilization: 0.5, application: 'dc' }), 1402.0046744861238);
});

test('optoelectronics', () => {
  // LED at 20 mW with R_JA 500 °C/W: T_j = 50 °C, π_T = 2.06 (table: 2.1); plastic π_Q = 8.
  close(fit('mil-opto', { type: 'led', power: 0.02, rja: 500, quality: 'plastic' }), 3.7977575767656298);
});

test('217F rates are weighted by working time; dormant phases add nothing', () => {
  const phases = [{ tac: 40, tau: 0.25, n: 0, dT: 0 }, { tac: 20, tau: 0, n: 365, dT: 10 }];
  close(fit('mil-crystal', { freq: 10, quality: 'milspec' }, profile('GB', phases)), 22.077167482002675 * 0.25);
  // Temperature-dependent models use each working phase's own temperature.
  const two = [{ tac: 25, tau: 0.5, n: 0, dT: 0 }, { tac: 75, tau: 0.5, n: 0, dT: 0 }];
  const r = computeComponent({ model: 'mil-opto', qty: 1, params: { type: 'led', power: 0, rja: 0, quality: 'plastic' } }, profile('GB', two));
  assert.deepEqual(r.operating.map((o) => +o.piT.toFixed(2)), [1.0, 3.84]);
});

test('new parts of every 217F type start with their unknowns missing', () => {
  const missing = (model) => computeComponent({ model, qty: 1, params: {} }, profile()).missing;
  assert.deepEqual(missing('mil-relay'), ['application', 'stress', 'cycles']);
  assert.deepEqual(missing('mil-switch'), ['type', 'stress']);
  assert.deepEqual(missing('mil-connector'), ['type', 'current', 'cycles']);
  assert.deepEqual(missing('mil-pwb'), ['n1', 'planes']);
  assert.deepEqual(missing('mil-crystal'), ['freq']);
  assert.deepEqual(missing('mil-fuse'), []);
  assert.deepEqual(missing('mil-opto'), ['type', 'power', 'rja']);
});
