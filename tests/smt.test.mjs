import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cyclesToFailure, lifeRate, ecfFor, evaluateSmt, chipCandidates, chipCodeOf } from '../assets/smt.js';

const close = (actual, expected, rel = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected), `expected ${expected}, got ${actual}`);
const MIL = 0.0254;

// The handbook's example (page 16-4), as board settings and one device.
const example = {
  substrate: 'epoxy-glass', cycling: 'handbook', equipment: 'military-ground',
  devices: [{ label: 'LCC', lead: 'leadless', body: 'plastic', d: 740 * MIL, h: 5 * MIL, rise: 10 }],
};

test('cycles to failure, characteristic life and the rate over the design life', () => {
  const nf = cyclesToFailure({ dMils: 740, hMils: 5, alphaS: 15, alphaCC: 7, dT: 21, tRise: 10, piLC: 1 });
  assert.equal(Math.round(nf), 18893);
  // Leads soften the strain: J lead ×150, gull wing ×5000.
  close(cyclesToFailure({ dMils: 740, hMils: 5, alphaS: 15, alphaCC: 7, dT: 21, tRise: 10, piLC: 5000 }) / nf, 5000);
  // No expansion mismatch, no wear.
  assert.equal(cyclesToFailure({ dMils: 100, hMils: 5, alphaS: 7, alphaCC: 7, dT: 20, tRise: 0, piLC: 1 }), Infinity);
  const r = lifeRate(nf / 0.03, 20 * 8760);
  assert.equal(r.ecf, 0.23);
  close(r.perHour, 0.23 / (nf / 0.03));
  assert.deepEqual([ecfFor(0.05), ecfFor(0.1), ecfFor(0.15), ecfFor(0.95), ecfFor(12)], [0.13, 0.13, 0.15, 1.0, 1.0]);
});

test('the board takes its weakest device, from the handbook tables or the mission profile', () => {
  const ev = evaluateSmt(example, { env217f: 'GF', phases: [] }, 20);
  assert.deepEqual(ev.problems, []);
  close(ev.fit, 0.23 / (cyclesToFailure({ dMils: 740, hMils: 5, alphaS: 15, alphaCC: 7, dT: 21, tRise: 10, piLC: 1 }) / 0.03) * 1e9);
  // A smaller device in the list does not change the board rate.
  const two = evaluateSmt({ ...example, devices: [...example.devices, { label: 'small', lead: 'gull', body: 'plastic', d: 3, rise: 0 }] }, { env217f: 'GF', phases: [] }, 20);
  assert.equal(two.worst.device.label, 'LCC');
  close(two.fit, ev.fit);
  // From the mission profile: one phase of 0.03 × 8760 cycles a year at ΔT 21 is the same thing.
  const fromProfile = evaluateSmt({ ...example, cycling: 'profile' }, { phases: [{ name: 'Use', n: 0.03 * 8760, dT: 21 }] }, 20);
  close(fromProfile.fit, ev.fit, 1e-12);
  // Two phases: damage adds (Miner's rule), so the life is shorter than either alone.
  const both = evaluateSmt({ ...example, cycling: 'profile' }, { phases: [{ n: 100, dT: 21 }, { n: 300, dT: 40 }] }, 20);
  const only = (n, dT) => evaluateSmt({ ...example, cycling: 'profile' }, { phases: [{ n, dT }] }, 20).devices[0].alphaHours;
  close(1 / both.devices[0].alphaHours, 1 / only(100, 21) + 1 / only(300, 40));
});

test('what is missing, and what stops the check', () => {
  const ev = evaluateSmt({ substrate: null, cycling: 'profile', devices: [{ label: 'x', lead: 'leadless', body: null, d: null, h: null, rise: null }] }, { phases: [] }, 10);
  assert.deepEqual(ev.devices[0].missing, ['body', 'd', 'h', 'rise']);
  assert.match(ev.problems.join(' '), /Missing: board substrate/);
  assert.match(ev.problems.join(' '), /no thermal cycles/);
  assert.equal(ev.worst, null);
  assert.equal(ev.fit, 0);
  // Leaded parts use the handbook's 8-mil joint height, so h is not asked for.
  const leaded = evaluateSmt({ ...example, devices: [{ label: 'SO-8', lead: 'gull', body: 'plastic', d: 2.5, rise: 0 }] }, { env217f: 'GF', phases: [] }, 10);
  assert.deepEqual(leaded.devices[0].missing, []);
  assert.equal(leaded.devices[0].hMils, 8);
  // The handbook gives no ΔT for missile and cannon environments.
  assert.match(evaluateSmt(example, { env217f: 'CL', phases: [] }, 10).problems.join(' '), /no temperature difference for CL/);
  assert.match(evaluateSmt(example, { env217f: 'GF', phases: [] }, 0).problems.join(' '), /mission length/);
});

test('chip capacitors and resistors become candidate devices', () => {
  assert.deepEqual(['C_0603_1608Metric', 'R_0402_1005Metric', 'Capacitor_SMD:C_1206_3216Metric', 'CAP CER 10UF 2220', 'CP_EIA-7343-31_Kemet-D', 'SOT-23'].map(chipCodeOf),
    ['0603', '0402', '1206', '2220', '7343', null]);
  const found = chipCandidates([
    { ref: 'C1–C4', model: 'capacitor', params: { type: 'ceramic-2' }, source: { footprint: 'C_0603_1608Metric' } },
    { ref: 'C5', model: 'mil-capacitor', params: { style: 'CDR' }, source: { footprint: 'C_0603_1608Metric' } },
    { ref: 'C9', model: 'capacitor', params: { type: 'tantalum-solid' }, source: { footprint: 'CP_EIA-3216-18_Kemet-A' } },
    { ref: 'R1, R2', model: 'resistor', params: {}, source: { description: 'RES SMD 10K 0603' } },
    { ref: 'U1', model: 'ic', params: {}, source: { footprint: 'LQFP-48' } },
    { ref: 'C20', model: 'capacitor', params: {}, source: null },
  ]);
  assert.deepEqual(found.map((c) => [c.label, c.lead, c.body, c.d, c.h, c.rise]), [
    ['C1–C4, C5 (0603 ceramic chip capacitor)', 'leadless', 'ceramic', 0.8, null, 0],
    ['C9 (3216 tantalum chip)', 'leadless', 'plastic', 1.6, null, 0],
    ['R1, R2 (0603 chip resistor)', 'leadless', 'ceramic', 0.8, null, 0],
  ]);
  assert.match(found[0].inferred.d, /half the 0603 body length \(1.6 mm\)/);
  assert.equal(found[0].inferred.h, undefined, 'the joint height is never guessed');
});
