import { test } from 'node:test';
import assert from 'node:assert/strict';

import { zExpansion, barrelStrain, effectiveStrain, fatigueResidual, cyclesToFailure, evaluateBoard } from '../assets/pth.js';
import { LAMINATES, COPPER } from '../assets/tablesboard.js';

const close = (actual, expected, rel = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected), `expected ${expected}, got ${actual}`);
const lam = (id) => LAMINATES.rows.find((r) => r.id === id);
const fr4 = lam('fr4');

test('z-axis expansion is integrated across the glass transition', () => {
  assert.equal(zExpansion(fr4, 25, 125), 70 * 100);
  assert.equal(zExpansion(fr4, 25, 245), 70 * (140 - 25) + 300 * (245 - 140));
  assert.equal(zExpansion(fr4, 150, 200), 300 * 50);
  assert.equal(zExpansion(fr4, 125, 25), 7000, 'order does not matter');
});

test('barrel stress and strain (IPC-TR-579 equations 8 and 9)', () => {
  // 1.6 mm board, 0.3 mm drill, 25 µm plating.
  const h = 1.6; const d = 0.3; const t = 0.025;
  const AE = (Math.PI / 4) * ((h + d) ** 2 - d ** 2);
  const ACu = (Math.PI / 4) * (d ** 2 - (d - 2 * t) ** 2);
  const { modulus: ECu, tangent: Et, yield: Sy, alpha: aCu } = COPPER;
  // Elastic: RO4350B from 25 to 125 °C.
  const ro = lam('ro4350b');
  const m1 = (32 - aCu) * 100 * 1e-6;
  const s1 = (m1 * AE * ro.modulus * ECu) / (AE * ro.modulus + ACu * ECu);
  const g1 = barrelStrain({ thickness: h, drill: d, platingUm: 25, lam: ro, tLow: 25, tHigh: 125 });
  assert.equal(g1.plastic, false);
  close(g1.areaE, AE); close(g1.areaCu, ACu); close(g1.stress, s1); close(g1.strain, s1 / ECu);
  // Above yield: FR-4 from 25 to 125 °C.
  const m2 = (70 - aCu) * 100 * 1e-6;
  const s2 = ((m2 + (Sy * (ECu - Et)) / (ECu * Et)) * AE * fr4.modulus * Et) / (AE * fr4.modulus + ACu * Et);
  const g2 = barrelStrain({ thickness: h, drill: d, platingUm: 25, lam: fr4, tLow: 25, tHigh: 125 });
  assert.equal(g2.plastic, true);
  close(g2.stress, s2); close(g2.strain, Sy / ECu + (s2 - Sy) / Et);
  // The two branches meet at yield: just above it the stress is the yield stress.
  const mYield = (Sy * (AE * fr4.modulus + ACu * ECu)) / (AE * fr4.modulus * ECu);
  const custom = { tg: 1000, alpha1: aCu + (mYield * 1e6) / 100 + 1e-9, alpha2: 0, modulus: fr4.modulus };
  close(barrelStrain({ thickness: h, drill: d, platingUm: 25, lam: custom, tLow: 25, tHigh: 125 }).stress, Sy, 1e-6);
});

test('cycles to failure solve the Engelmaier equation (IPC-TR-579 equations 10 and 11)', () => {
  close(effectiveStrain(0.004, 2.5, 7.5), 0.004 * 2.5 * 10 / 7.5);
  for (const strain of [0.002, 0.006, 0.02, 0.05]) {
    const n = cyclesToFailure(strain, 0.2, 300);
    assert.ok(Math.abs(fatigueResidual(n, strain, 0.2, 300)) < 1e-12, `residual at Δε ${strain}`);
  }
  assert.ok(cyclesToFailure(0.006, 0.2, 300) > cyclesToFailure(0.02, 0.2, 300), 'more strain, fewer cycles');
  assert.ok(cyclesToFailure(0.01, 0.3, 300) > cyclesToFailure(0.01, 0.1, 300), 'more ductility, more cycles');
  assert.equal(cyclesToFailure(0, 0.2, 300), Infinity);
});

test('laminates rank as expected through a lead-free reflow', () => {
  const nf = (id) => {
    const g = barrelStrain({ thickness: 1.6, drill: 0.3, platingUm: 25, lam: lam(id), tLow: 25, tHigh: 245 });
    return cyclesToFailure(effectiveStrain(g.strain, 2.5, 7.5), 0.2, 300);
  };
  const order = ['fr4', 'isola-370hr', 'arlon-85n', 'ro4350b'].map(nf);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], order.join(' < '));
  // A thicker board is harder on the barrel; a bigger drill is easier.
  const at = (thickness, drill) => barrelStrain({ thickness, drill, platingUm: 25, lam: fr4, tLow: 0, tHigh: 60 }).strain;
  assert.ok(at(2.4, 0.3) > at(1.0, 0.3));
  assert.ok(at(1.6, 1.0) < at(1.6, 0.3));
});

test('the board: assembly uses part of the life, field cycles the rest, the weakest size counts', () => {
  const settings = { laminate: 'isola-370hr', thickness: 1.6, ductility: 20, strength: 300, kq: 7.5, kd: 2.5, reflows: 2, reflowPeak: 245,
    holes: [{ label: '0.3 mm', drill: 0.3, plating: 25 }, { label: '1.0 mm', drill: 1.0, plating: 25 }] };
  const profile = { phases: [{ name: 'Use', tac: 40, n: 365, dT: 30 }] };
  const ev = evaluateBoard(settings, profile, 10);
  assert.deepEqual(ev.problems, []);
  const small = ev.holes[0];
  // Miner's rule: life left after assembly, spent at 365 cycles a year.
  close(small.used, 2 / small.assembly.nf);
  close(small.alphaHours, (1 - small.used) * small.field[0].nf * 8760 / 365);
  assert.deepEqual([small.field[0].tLow, small.field[0].tHigh], [25, 55]);
  assert.equal(ev.worst, small, 'the smaller hole wears out first');
  close(ev.fit, small.fit);
  // Ten lead-free reflows at 260 °C crack standard FR-4 vias before service.
  const harsh = evaluateBoard({ ...settings, laminate: 'fr4', reflows: 10, reflowPeak: 260 }, profile, 10);
  assert.equal(harsh.cracked, 2);
  assert.equal(harsh.worst, null);
  assert.match(harsh.problems.join(' '), /0.3 mm is predicted to crack during assembly/);
  // What is missing.
  const empty = evaluateBoard({ laminate: null, holes: [{ label: 'x', drill: null, plating: 25 }] }, profile, 10);
  assert.match(empty.problems.join(' '), /Missing: laminate/);
  assert.match(empty.problems.join(' '), /board thickness, plating ductility, plating tensile strength, plating quality K_Q, strain distribution K_d, number of reflows, reflow peak temperature/);
  assert.deepEqual(empty.holes[0].missing, ['drill']);
  const custom = evaluateBoard({ ...settings, laminate: 'custom', custom: { tg: 170, alpha1: 50, alpha2: null, modulus: 8 } }, profile, 10);
  assert.match(custom.problems.join(' '), /Missing for the custom laminate: z-axis expansion above Tg/);
});
