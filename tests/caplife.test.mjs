import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  lifeHours, ruleFor, ratedLifeOf, aluminiumKindOf, lifeGuess, lifeInputs, isListed, typeTech,
  evaluateLine, evaluateCapLife, lifeConditions, withLife, erfc, wearRate,
} from '../assets/caplife.js';
import { computeBoard } from '../assets/models.js';

const close = (actual, expected, rel = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected), `expected ${expected}, got ${actual}`);
const at = (tech, hours, temp, ambient, extra = {}) => lifeHours({ rule: ruleFor(tech, extra.polymerRule), hours, temp, ambient, ...extra });
const floorTo = (x, step) => Math.floor(x / step) * step;

// The makers' printed tables and worked examples, each checked through lifeHours.
test('polymer: ×10 per 20 °C, as printed by Vishay, KEMET and Panasonic', () => {
  // Vishay OS-CON reliability (doc. 90017, p. 1): 2000 h at 105 °C; the printed hours are truncated.
  assert.deepEqual([95, 85, 75].map((t) => Math.floor(at('polymer', 2000, 105, t))), [6324, 20000, 63245]);
  // Vishay 180 CPS (doc. 28415, p. 7) prints 6000, 20,000 and 63,000 h: rounded down to the thousand.
  assert.deepEqual([95, 85, 75].map((t) => floorTo(at('polymer', 2000, 105, t), 1000)), [6000, 20000, 63000]);
  // KEMET A758 (p. 9): 2000 h at 105 °C, 20,000 h at 85 °C, 200,000 h at 65 °C.
  assert.deepEqual([85, 65].map((t) => Math.round(at('polymer', 2000, 105, t))), [20000, 200000]);
  // Panasonic polymer brochure (p. 2), OS-CON 1000 h at 125 °C: 10,000 h (1.1 years) at 105 °C, 100,000 h (11.4 years) at 85 °C.
  assert.deepEqual([105, 85].map((t) => Math.round(at('polymer', 1000, 125, t))), [10000, 100000]);
  assert.deepEqual([105, 85].map((t) => +(at('polymer', 1000, 125, t) / 8760).toFixed(1)), [1.1, 11.4]);
  // The slower rule (Chemi-Con): ×2 per 10 °C, so 20 °C cooler gives 4 × instead of 10 ×.
  close(at('polymer', 2000, 105, 85, { polymerRule: 'slow' }), 8000);
});

test('hybrid and wet: ×2 per 10 °C, as printed by Panasonic, Vishay and Rubycon', () => {
  // Panasonic polymer brochure (p. 2), hybrid 4000 h at 125 °C, hours and years to one decimal.
  const temps = [115, 105, 95, 85, 75];
  assert.deepEqual(temps.map((t) => at('hybrid', 4000, 125, t)), [8000, 16000, 32000, 64000, 128000]);
  assert.deepEqual(temps.map((t) => +(at('hybrid', 4000, 125, t) / 8760).toFixed(1)), [0.9, 1.8, 3.7, 7.3, 14.6]);
  // Vishay 182 CPHZ (p. 5): 10,000 h at 105 °C to 160,000 h at 65 °C.
  assert.deepEqual([95, 85, 75, 65].map((t) => at('hybrid', 10000, 105, t)), [20000, 40000, 80000, 160000]);
  // Vishay's 10 K rule (doc. 28356, Fig. 13), wet: 2000 h at 85 °C → 4000 h at 75 °C → 8000 h at 65 °C.
  assert.deepEqual([75, 65].map((t) => at('wet', 2000, 85, t)), [4000, 8000]);
  // Panasonic OS-CON brochure (p. 1): "AL-Cap 125 C x 3,000 hrs / 5.5 years (at 85°C)".
  assert.equal(+(at('wet', 3000, 125, 85) / 8760).toFixed(1), 5.5);
});

test('ripple heating: Rubycon\'s hybrid worked example and the wet penalty', () => {
  // Rubycon PZ-CAP catalogue p. 34: PFV 50 V 100 µF, 4000 h at 125 °C with rated ripple, ΔT0 = 10 °C.
  // At rated ripple and 125 °C: 4000 h.
  close(at('hybrid', 4000, 125, 125, { rise: 10, ratedRise: 10 }), 4000);
  // 2650 mA against 2070 mA rated: "ΔTj 16.39℃ Life 2500hours" (printed to the 100 h below).
  const rise = 10 * (2650 / 2070) ** 2;
  assert.equal(+rise.toFixed(2), 16.39);
  assert.equal(floorTo(at('hybrid', 4000, 125, 125, { rise, ratedRise: 10 }), 100), 2500);
  // At 100 °C with ×1.82 ripple: "ΔTj = 10×1.82² = 33.12", "L = 4000 × 2^((125+10−133.12)/10) = 4500".
  assert.equal(+(10 * 1.82 ** 2).toFixed(2), 33.12);
  assert.equal(floorTo(at('hybrid', 4000, 125, 100, { rise: 10 * 1.82 ** 2, ratedRise: 10 }), 100), 4500);
  // Wet (Chemi-Con equations 17 and 18): ripple heating halves life every 5 °C. 2000 h at 105 °C, used at 65 °C
  // with a 5 °C rise: rated at voltage only, 2000·2⁴·2⁻¹; rated with that ripple, no penalty.
  close(at('wet', 2000, 105, 65, { rise: 5 }), 16000);
  close(at('wet', 2000, 105, 65, { rise: 5, ratedRise: 5 }), 32000);
  // For polymer and hybrid parts the rise counts like ambient.
  close(at('polymer', 2000, 105, 65, { rise: 20 }), at('polymer', 2000, 105, 85));
});

test('the 40 °C floor and the 15-year cap', () => {
  // Below 40 °C the life is worked out at 40 °C.
  assert.equal(at('wet', 2000, 105, 25), at('wet', 2000, 105, 40));
  close(at('wet', 2000, 105, 40), 2000 * 2 ** 6.5);
  // One phase, always working: the calendar life is the life, capped at 15 years.
  const one = (ambient) => lifeConditions({ phases: [{ name: 'Use', tac: ambient, tau: 1 }] }, 20);
  const part = { id: 'c', ref: 'C1', qty: 1, model: 'fixed', params: {}, life: { listed: true, tech: 'wet', hours: 2000, temp: 105, ripple: 'none', role: 'drift' } };
  const hot = evaluateLine(part, {}, one(85));
  close(hot.alphaHours, 8000);
  assert.equal(hot.capped, false);
  const cool = evaluateLine(part, {}, one(40));
  assert.equal(cool.alphaHours, 15 * 8760);
  assert.equal(cool.capped, true);
});

test('from a life to a rate: Cornell Dubilier\'s normal wear-out spread', () => {
  // The normal distribution's tails, against tabulated values.
  const phi = (z) => 0.5 * erfc(-z / Math.SQRT2);
  close(phi(-2), 0.0227501319, 1e-6);
  close(phi(-3), 0.0013498980, 1e-6);
  close(phi(1), 0.8413447461, 1e-6);
  close(phi(-6), 9.8658765e-10, 1e-6);
  close(erfc(0), 1, 1e-7);
  // Mean 1.2 L, deviation 0.1 L: at the calculated life 2.3 % have worn out, at 0.9 L 0.13 %.
  const L = 50000;
  close(wearRate(L, L).fraction, phi(-2), 1e-6);
  close(wearRate(L, 0.9 * L).fraction, phi(-3), 1e-6);
  close(wearRate(L, 1.3 * L).fraction, phi(1), 1e-6);
  // The average rate keeps the mission survival: exp(−λT) = 1 − F, even deep in either tail.
  for (const T of [0.5 * L, L, 1.2 * L, 1.5 * L]) {
    const { perHour } = wearRate(L, T);
    close(Math.exp(-perHour * T), 1 - phi((T - 1.2 * L) / (0.1 * L)), 1e-6);
  }
  close(wearRate(L, 0.5 * L).perHour * 0.5 * L, phi(-7), 1e-6);
  close(Math.exp(-wearRate(L, 2 * L).perHour * 2 * L), phi(-8), 1e-6);
  // Certain to wear out within the mission: the survival underflows, and the smallest double stands in, so the rate stays finite.
  close(wearRate(L, 20 * L).perHour * 20 * L, -Math.log(Number.MIN_VALUE));
  // Far beyond the life, nearly everything has worn out and the rate is still finite.
  const late = wearRate(L, 3 * L);
  assert.ok(late.fraction > 0.999999 && Number.isFinite(late.perHour) && late.perHour > 0);
  // A life well beyond the mission adds almost nothing: 15 years against 10 is under 0.001 FIT.
  assert.ok(wearRate(15 * 8760, 10 * 8760).perHour * 1e9 < 0.001);
});

test('a line over the mission profile: Miner\'s rule over working time, then the wear-out spread', () => {
  const profile = { phases: [{ name: 'Day', tac: 45, tau: 0.5 }, { name: 'Peak', tac: 85, tau: 0.25 }, { name: 'Off', tac: 20, tau: 0, n: 365, dT: 20 }] };
  const conditions = lifeConditions(profile, 10);
  assert.deepEqual(conditions.phases.map((p) => p.label), ['Day', 'Peak']);
  const part = { id: 'c', ref: 'C1', qty: 2, model: 'fixed', params: {}, life: { listed: true, tech: 'polymer', hours: 2000, temp: 105, ripple: 'none', role: 'drift' } };
  const r = evaluateLine(part, {}, conditions);
  const alpha = 1 / (0.5 / at('polymer', 2000, 105, 45) + 0.25 / at('polymer', 2000, 105, 85));
  close(r.alphaHours, alpha);
  const rate = wearRate(alpha, 10 * 8760);
  close(r.fitEach, rate.perHour * 1e9);
  close(r.fraction, rate.fraction);
  assert.equal(r.wornOut, alpha < 10 * 8760);
  // Above the rated temperature the rules do not apply; the line says so.
  const hot = evaluateLine(part, {}, lifeConditions({ phases: [{ tac: 110, tau: 1 }] }, 10));
  assert.equal(hot.hot, true);
});

test('what is missing, and when drift counts', () => {
  const conditions = lifeConditions({ phases: [{ tac: 60, tau: 1 }] }, 10);
  const line = (life, settings = {}) => evaluateLine({ id: 'c', ref: 'C1', qty: 1, model: 'fixed', params: {}, life: { listed: true, ...life } }, settings, conditions);
  assert.deepEqual(line({}).missing, ['tech', 'hours', 'temp', 'ripple', 'role']);
  // A current ratio needs the rise at rated ripple and what the rated life includes.
  assert.deepEqual(line({ tech: 'wet', hours: 2000, temp: 105, ripple: 'ratio', role: 'drift' }).missing, ['ratio', 'rated', 'rise0']);
  // A measured rise needs ΔT0 only when the rated life already includes rated ripple.
  assert.deepEqual(line({ tech: 'wet', hours: 2000, temp: 105, ripple: 'rise', rise: 4, rated: 'dc', role: 'drift' }).missing, []);
  assert.deepEqual(line({ tech: 'wet', hours: 2000, temp: 105, ripple: 'rise', rise: 4, rated: 'ripple', role: 'drift' }).missing, ['rise0']);
  // No ripple, rated with ripple, ΔT0 unknown: no credit is taken for running below the rated ripple.
  const noCredit = line({ tech: 'wet', hours: 2000, temp: 105, ripple: 'none', rated: 'ripple', role: 'drift' });
  assert.deepEqual(noCredit.missing, []);
  close(noCredit.alphaHours, 2000 * 2 ** 4.5);
  close(line({ tech: 'wet', hours: 2000, temp: 105, ripple: 'none', rated: 'ripple', rise0: 5, role: 'drift' }).alphaHours, 2000 * 2 ** 5.5);
  // The role: the line's own, or the board's default; unset is missing, but the life is still worked out.
  const full = { tech: 'wet', hours: 2000, temp: 105, ripple: 'none' };
  const unset = line({ ...full, role: 'default' });
  assert.deepEqual([unset.missing, unset.complete, unset.lifeComplete], [['role'], false, true]);
  assert.equal(line({ ...full, role: 'default' }, { defaultRole: 'hard' }).role, 'hard');
  assert.equal(line({ ...full, role: 'drift' }, { defaultRole: 'hard' }).role, 'drift');
});

test('the board: counted lines add their wear-out to their own rate', () => {
  const profile = { phases: [{ name: 'Use', tac: 70, tau: 1 }] };
  const part = (id, life, extra = {}) => ({ id, ref: id, qty: 2, model: 'fixed', params: { fit: 1 }, life: { listed: true, tech: 'wet', hours: 2000, temp: 105, ripple: 'none', ...life }, ...extra });
  const parts = [
    part('C1', { role: 'drift' }),
    part('C2', { role: 'hard' }),
    part('C3', { role: 'default' }),
    part('C4', { role: 'hard', hours: null }),
    part('C5', { role: 'drift', hours: null }),
    { id: 'U1', ref: 'U1', qty: 1, model: 'fixed', params: { fit: 5 } },
  ];
  const life = evaluateCapLife(parts, { defaultRole: null }, profile, 10);
  assert.deepEqual(life.rows.map((r) => r.part.ref), ['C1', 'C2', 'C3', 'C4', 'C5']);
  assert.deepEqual([...life.byPart.keys()], ['C1']);
  // C3 has no role yet and C5 no rated life: both could count, so both are pending; C4 never counts.
  assert.equal(life.pending, 2);
  const board = withLife(computeBoard({ profile, components: parts }), life);
  const w = life.byPart.get('C1');
  close(w, life.rows[0].fitEach);
  close(board.items[0].result.fit, 1 + w);
  close(board.items[0].result.total, 2 * (1 + w));
  assert.deepEqual(board.items[0].result.parts.at(-1), ['Wear-out', w]);
  assert.equal(board.items[1].result.fit, 1);
  close(board.total, 2 * (1 + w) + 4 * 2 + 5);
  // With the default set to "yes", C3 counts too.
  assert.deepEqual([...evaluateCapLife(parts, { defaultRole: 'drift' }, profile, 10).byPart.keys()], ['C1', 'C3']);
  // A line whose own rate is incomplete stays out, wear-out and all.
  const blank = { ...parts[0], params: { fit: null } };
  const b2 = withLife(computeBoard({ profile, components: [blank] }), evaluateCapLife([blank], {}, profile, 10));
  assert.equal(b2.total, 0);
  // No working phase, or no mission length: nothing can be worked out.
  assert.match(evaluateCapLife(parts, {}, { phases: [{ tac: 20, tau: 0 }] }, 10).problems.join(' '), /no working phase/);
  assert.match(evaluateCapLife(parts, {}, profile, 0).problems.join(' '), /mission length/);
});

test('which lines are checked, and what their text says', () => {
  // Rated life in the forms makers and distributors write it.
  assert.deepEqual(['CAP ALUM 100UF 20% 25V RADIAL 2000H 105C', '10000 Hrs @ 105°C', '105°C 5000h', 'CAP 47uF 25V 2,000H/105C', 'LIFE 85C 1000 HOURS'].map(ratedLifeOf),
    [{ hours: 2000, temp: 105 }, { hours: 10000, temp: 105 }, { hours: 5000, temp: 105 }, { hours: 2000, temp: 105 }, { hours: 1000, temp: 85 }]);
  assert.deepEqual(['X7R 0603 50V', '100H 25C', '2000H 105'].map(ratedLifeOf), [null, null, null]);
  // Aluminium kinds; polymer tantalum is not aluminium.
  assert.deepEqual(['CAP ALUM POLY 100UF', 'CAP HYBRID ALUM 47UF', 'OS-CON 16SVPF', 'CAP ALUM 10UF', 'CAP TANT POLYMER 100UF', 'POSCAP 6TPE', 'CAP CER 1UF'].map(aluminiumKindOf),
    ['polymer', 'hybrid', 'polymer', 'wet', null, null, null]);
  // Wet aluminium lines are always checked, their kind from the part type.
  const wet62380 = { id: 'a', ref: 'C1', qty: 1, model: 'capacitor', params: { type: 'aluminium-wet' }, source: { description: 'CAP ALUM 100UF 25V 105C 5000H' } };
  const wet217f = { id: 'b', ref: 'C2', qty: 1, model: 'mil-capacitor', params: { style: 'CU' } };
  assert.deepEqual([typeTech(wet62380), typeTech(wet217f), isListed(wet62380), isListed({ ...wet217f, life: { listed: false } })], ['wet', 'wet', true, true]);
  const inputs = lifeInputs(wet62380);
  assert.deepEqual([inputs.values.tech, inputs.values.hours, inputs.values.temp, inputs.inferred.tech], ['wet', 5000, 105, undefined]);
  assert.match(inputs.inferred.hours, /from “CAP ALUM 100UF 25V 105C 5000H”/);
  // A rate entered for a polymer part: listed from its text, kind guessed; the user can stop checking it.
  const poly = { id: 'c', ref: 'C3', qty: 1, model: 'fixed', params: { fit: null }, source: { value: '100uF', description: 'CAP ALUM POLY 100UF 16V' } };
  assert.equal(isListed(poly), true);
  assert.deepEqual(lifeGuess(poly).values, { tech: 'polymer' });
  assert.equal(isListed({ ...poly, life: { listed: false } }), false);
  // Ceramic and tantalum lines are not checked unless listed; entered values beat guesses.
  assert.equal(isListed({ id: 'd', ref: 'C4', qty: 1, model: 'capacitor', params: { type: 'tantalum-solid' }, source: { description: 'CAP TANT 10UF' } }), false);
  const typed = lifeInputs({ ...wet62380, life: { hours: 3000 } });
  assert.deepEqual([typed.values.hours, typed.inferred.hours, typed.inferred.temp !== undefined], [3000, undefined, true]);
});

// Examples from the documents read in the 2026-10-28 cross-check.
test('Würth, Panasonic and Cornell Dubilier examples from the cross-check', () => {
  // Würth SN008a Table 1, 105 °C/2000 h at 95, 85, 75 and 65 °C: polymer printed to two figures, wet exact.
  [6300, 20000, 63000, 200000].forEach((h, i) => close(at('polymer', 2000, 105, [95, 85, 75, 65][i]), h, 0.005));
  assert.deepEqual([95, 85, 75, 65].map((t) => at('wet', 2000, 105, t)), [4000, 8000, 16000, 32000]);
  // Panasonic Technical Guide p. 14: 105 °C/2000 h at 65 °C is 32,000 h.
  assert.equal(at('wet', 2000, 105, 65), 32000);
  // Panasonic's hybrid lifetime-tool manual, pp. 5–7: ZC 25 V 100 µF, 4000 h at 125 °C, 1400 mA rated ripple;
  // 2000 h at 120 °C with 1200 mA then 2000 h at 100 °C with 1400 mA uses "41.088 %" of the life. The rise at
  // rated ripple is not published: 5 °C, a round number, reproduces it; none, or 10 °C, miss by about 7 %.
  const used = (rise0) => {
    const life = (ambient, mA) => lifeHours({ rule: ruleFor('hybrid'), hours: 4000, temp: 125, ambient, rise: rise0 * (mA / 1400) ** 2, ratedRise: rise0 });
    return 2000 / life(120, 1200) + 2000 / life(100, 1400);
  };
  close(used(5), 0.41088, 1e-4);
  for (const rise0 of [0, 10]) assert.ok(Math.abs(used(rise0) / 0.41088 - 1) > 0.05, String(rise0));
  // Cornell Dubilier, APEC 2015 slides 17–18: 5000 h at 105 °C × a 1.5 voltage multiplier, core at 55 °C: 240,000 h.
  const part = { id: 'c', ref: 'C1', qty: 1, model: 'fixed', params: {}, life: { listed: true, tech: 'wet', hours: 7500, temp: 105, ripple: 'none', role: 'hard' } };
  close(at('wet', 7500, 105, 55), 240000);
  const line = (phases) => evaluateLine(part, {}, lifeConditions({ phases }, 30));
  assert.deepEqual([line([{ tac: 55, tau: 1 }]).alphaHours, line([{ tac: 55, tau: 1 }]).capped], [131400, true], 'CDE applies no 15-year cap');
  // 12 h at 25 °C and 12 h at 85 °C average harmonically to CDE's 59,077 h; the 40 °C floor makes it 57,461 h here.
  close(line([{ tac: 25, tau: 0.5 }, { tac: 85, tau: 0.5 }]).alphaHours, 57461, 1e-4);
  // A 65 °C mean with daily and yearly swings of 20 °C peak to peak each: CDE's "95 kh" (constant 65 °C gives 120 kh).
  const n = 240;
  const swings = [];
  for (let d = 0; d < n; d++) for (let y = 0; y < n; y++) swings.push({ tac: 65 + 10 * Math.sin((2 * Math.PI * (d + 0.5)) / n) + 10 * Math.sin((2 * Math.PI * (y + 0.5)) / n), tau: 1 / (n * n) });
  close(line(swings).alphaHours, 95000, 0.006);
});
