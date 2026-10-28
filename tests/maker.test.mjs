// Makers' tantalum and ceramic capacitor models, checked against the makers'
// printed tables and examples (see assets/tablesmaker.js for the sources).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeComponent, normaliseProfile } from '../assets/models.js';
import { failureBound, mlccFactor, kemetPolymerFit, vishayFactor, tantalumLimit, avxFactors, expFactor } from '../assets/modelsmaker.js';
import { TANT_VISHAY, TANT_AVX } from '../assets/tablesmaker.js';
import { failureModesFor } from '../assets/failuremodes.js';
import { classifyComponent } from '../assets/netlist.js';
import { flexRisks, chipCandidates } from '../assets/smt.js';

const BOLTZMANN_EV = 8.617e-5;
// One working phase at t °C, all the time.
const at = (t) => normaliseProfile({ phases: [{ tac: t, tau: 1 }], tauOff: 0 });
const rate = (model, params, prof) => computeComponent({ model, qty: 1, params }, prof);
// A printed value matches to its last printed digit: '0.439' means ±0.0005.
const matchesPrinted = (x, printed) => Math.abs(x - Number(printed)) <= 0.5 * 10 ** -(printed.split('.')[1]?.length ?? 0) + 1e-12;
const near = (x, y, rel) => Math.abs(x - y) <= rel * Math.abs(y);

test('the 60 % failure bound is χ²(0.60, 2r + 2)/2', () => {
  // Knowles prints χ² = 1.833 (r = 0) and 20.951 (r = 9). Samsung's 0.917 for no failures is 1.833/2
  // rounded up; the exact value is −ln 0.4 = 0.9163.
  assert.ok(Math.abs(failureBound(0) - -Math.log(0.4)) < 1e-9);
  assert.ok(matchesPrinted(2 * failureBound(0), '1.833'));
  assert.ok(matchesPrinted(2 * failureBound(9), '20.951'));
  // A large count does not underflow: the bound sits just above the count.
  const big = failureBound(2000);
  assert.ok(big > 2000 && big < 2020, String(big));
});

test('Knowles AN0004: every cell of the C0G and X7R FIT tables', () => {
  // 1000 h at 1.5 × rated voltage and 125 °C; n = 2.7, E_a = 1.0 eV; 60 % confidence.
  const temps = [25, 50, 75, 100, 125];
  const tables = [
    {
      name: 'C0G', hours: 15935800, failures: 9,
      rows: {
        0.1: ['0.000', '0.001', '0.007', '0.062', '0.439'],
        0.25: ['0.000', '0.006', '0.079', '0.739', '5.210'],
        0.5: ['0.002', '0.039', '0.515', '4.803', '33.852'],
        1: ['0.012', '0.254', '3.345', '31.209', '219.969'],
      },
    },
    {
      name: 'X7R', hours: 44380400, failures: 0,
      rows: {
        0.1: ['0.000', '0.000', '0.000', '0.002', '0.014'],
        0.25: ['0.000', '0.000', '0.002', '0.023', '0.164'],
        0.5: ['0.000', '0.001', '0.016', '0.151', '1.063'],
        1: ['0.000', '0.008', '0.105', '0.980', '6.909'],
      },
    },
  ];
  for (const { name, hours, failures, rows } of tables) {
    for (const [share, printed] of Object.entries(rows)) {
      temps.forEach((t, i) => {
        const params = { electrode: 'entered', n: 2.7, ea: 1.0, hours, failures, vTest: 1.5, tTest: 125, v: Number(share), rise: 0 };
        const r = rate('ceramic-test', params, at(t));
        assert.deepEqual(r.errors, []);
        assert.ok(matchesPrinted(r.fit, printed[i]), `${name} at ${share} V_R, ${t} °C: ${r.fit} vs ${printed[i]}`);
      });
    }
  }
});

test('Samsung FAQ example: AF 2,374.16 and 9.656 FIT', () => {
  // 40 parts × 1000 h at 358 K and 16 V, used at 333 K and 4 V; n = 3.5, E_a = 1.2 eV.
  // Samsung uses whole kelvins: fed exactly those, the factor matches; in °C + 273.15 it is 0.25 % lower.
  const wholeKelvin = mlccFactor({ vTest: 16, v: 4, tTest: 358 - 273.15, t: 333 - 273.15, n: 3.5, ea: 1.2 });
  assert.ok(matchesPrinted(wholeKelvin, '2374.16'), String(wholeKelvin));
  const r = rate('ceramic-test', { electrode: 'entered', n: 3.5, ea: 1.2, hours: 40000, failures: 0, vTest: 16, tTest: 85, v: 4, rise: 0 }, at(60));
  assert.ok(near(r.fit, 9.656, 0.003), `${r.fit} vs 9.656`);
});

test('precious-metal parts use n = 3 and 1.0 eV', () => {
  const params = { hours: 1e6, failures: 0, vTest: 100, tTest: 125, v: 25, rise: 0 };
  const pme = rate('ceramic-test', { ...params, electrode: 'pme' }, at(55));
  const entered = rate('ceramic-test', { ...params, electrode: 'entered', n: 3, ea: 1.0 }, at(55));
  assert.equal(pme.fit, entered.fit);
  const expected = (failureBound(0) / 1e6) * 1e9 / (4 ** 3 * Math.exp((1.0 / BOLTZMANN_EV) * (1 / 328.15 - 1 / 398.15)));
  assert.ok(near(pme.fit, expected, 1e-12));
});

test('KEMET polymer FIT method: KEMET\'s printed mission-profile tables', () => {
  // T599 web page: a 150 µF 6.3 V part at 3.3 V, below 0.1 Ω/V, ground benign. [°C, hours, printed FIT]
  const newer = [[-40, 3942, 0.353345], [-20, 3942, 0.353345], [20, 13140, 0.353345], [40, 55845, 0.489013], [60, 42701, 0.682944],
    [75, 5256, 0.855374], [85, 657, 0.983596], [90, 5256, 1.051794], [105, 657, 1.272064]];
  const part = { capacitance: 150, s: 3.3 / 6.3, rs: 0.1 };
  // Rows from 40 °C within 0.1 %; the colder rows, read at room temperature, print 0.55 % less than 23 °C gives
  // (KEMET's room-temperature factor works out to about 22.7 °C).
  for (const [t, , fit] of newer) assert.ok(near(kemetPolymerFit({ ...part, t }).fit, fit, t < 23 ? 0.006 : 0.001), `${t} °C`);
  const profile = (rows, env217f) => normaliseProfile({ phases: rows.map(([tac, tau]) => ({ tac, tau })), tauOff: 0, env217f });
  const params = { curve: 'kemet-polymer', capacitance: 150, v: 3.3, vr: 6.3, rs: 0.1, rise: 0 };
  const r = rate('tantalum-maker', params, profile(newer));
  assert.deepEqual(r.errors, []);
  assert.ok(near(r.fit, 0.5742, 0.001), String(r.fit));
  // The older table took 20 °C as room temperature where KEMET's note says 23 °C, so it prints 0.6 % less.
  const older = [[-40, 400], [20, 1600], [85, 5200], [130, 560], [140, 160], [150, 80]];
  assert.ok(near(rate('tantalum-maker', params, profile(older)).fit, 0.8998, 0.007));
  // KEMET's two changes from 217F CWR: π_V is 2 at S = 0.8 (217F: at 0.6), and π_Q is 0.707.
  assert.ok(near(kemetPolymerFit({ ...part, s: 0.8, t: 25 }).piV, 2, 1e-12));
  // Near the rating π_V dominates: S = 0.9 gives (0.9/0.8)^17 + 1 = 8.4.
  const hot = rate('tantalum-maker', { ...params, v: 0.9 * 6.3 }, at(40));
  assert.ok(near(hot.fit, kemetPolymerFit({ ...part, s: 0.9, t: 40 }).fit, 1e-12));
  assert.ok(near(kemetPolymerFit({ ...part, s: 0.9, t: 40 }).piV, 8.406, 0.001));
  // The environment factor follows the board's 217F environment (G_F: 10).
  assert.ok(near(rate('tantalum-maker', params, profile([[40, 1]], 'GF')).fit, 10 * rate('tantalum-maker', params, at(40)).fit, 1e-12));
});

test('Vishay nomograph: the white paper\'s own readings, and its slopes', () => {
  // "about 0.00001" at 40 °C and 60 % of V_R (40292 p. 1).
  const f40 = vishayFactor(40, 0.6);
  assert.ok(f40 > 0.8e-5 && f40 < 1.6e-5, String(f40));
  // F = 1 at the reference (85 °C, V_R) and on the printed 125 °C line at 2/3 V_R, within the chart's ±5 %.
  assert.ok(near(vishayFactor(85, 1), 1, 0.05));
  assert.ok(near(vishayFactor(125, 2 / 3), 1, 0.05));
  // Close to NASA's fit of KEMET's MnO₂ curve: B = 14.7 per unit of V/V_R, 1.17 eV.
  const b = TANT_VISHAY.c * Math.LN10;
  assert.ok(near(b, 14.7, 0.01), String(b));
  const ea = (TANT_VISHAY.b * 60 * Math.LN10 * BOLTZMANN_EV) / (1 / 298.15 - 1 / 358.15);
  assert.ok(ea > 1.05 && ea < 1.2, String(ea));
  // Read only inside the chart.
  assert.equal(vishayFactor(10, 0.6), vishayFactor(25, 0.6));
  assert.equal(vishayFactor(40, 0.05), vishayFactor(40, 0.1));
  assert.equal(tantalumLimit(85), 1);
  assert.ok(Math.abs(tantalumLimit(125) - 2 / 3) < 1e-12);
  // On a part: 1 %/1000 h × F.
  const r = rate('tantalum-maker', { curve: 'vishay-mno2', v: 6, vr: 10, rise: 0 }, at(40));
  assert.ok(near(r.fit, 1e4 * f40, 1e-12));
});

test('KYOCERA AVX catalogue: its worked example, its printed factors, and the chart ranges', () => {
  const f = (t, u, r, family) => avxFactors({ t, u, r, family });
  // Catalogue p. 251: 0.167 Ω/V at 85 °C and 75 % of V_R is F_T 1.0 × F_R 0.85 × F_V 0.08 × 1 %/1000 h = 0.068 %/1000 h;
  // a 20 V part, F_V 0.018 at 60 %, gives 0.0153. The drawn line reads 0.084 and 0.020 (F_V printed to one or two figures).
  assert.ok(matchesPrinted(f(85, 0.75, 0.167).t, '1.0'));
  assert.ok(matchesPrinted(f(85, 0.75, 0.167).r, '0.85'));
  assert.ok(near(f(85, 0.75, 0.167).v, 0.08, 0.05));
  assert.ok(near(f(85, 0.6, 0.167).v, 0.018, 0.12));
  const example = (u) => {
    const x = f(85, u, 0.167);
    return x.t * x.r * x.v;
  };
  assert.ok(near(example(0.75), 0.068, 0.05), String(example(0.75)));
  assert.ok(near(example(0.6), 0.0153, 0.11), String(example(0.6)));
  // AVX's 2003 paper, citing the catalogue: F_V 0.12 at 79.4 % and 0.007 at 50 %.
  assert.ok(near(f(85, 5 / 6.3, 0.1).v, 0.12, 0.07));
  assert.ok(near(f(85, 0.5, 0.1).v, 0.007, 0.12));
  // The printed F_R table (Fig. 4), written out again here, is reproduced; read only between 0.1 and 3 Ω/V.
  const printedFr = [[3.0, 0.07], [2.0, 0.1], [1.0, 0.2], [0.8, 0.3], [0.6, 0.4], [0.4, 0.6], [0.2, 0.8], [0.1, 1.0]];
  for (const [r, fr] of printedFr) assert.ok(Math.abs(f(85, 1, r).r - fr) < 1e-12, String(r));
  assert.equal(f(85, 1, 0.01).r, 1);
  assert.ok(Math.abs(f(85, 1, 10).r - 0.07) < 1e-12);
  // As drawn, for a typical component: 0.91 × F_B at V_R, 85 °C and 0.1 Ω/V.
  assert.ok(near(f(85, 1, 0.1).v * f(85, 1, 0.1).t, 0.91, 0.01));
  // The tantalum F_T curve as read from Fig. 3: 0.055 at 25 °C, 0.097 at 40 °C, 22 at 125 °C.
  assert.ok(near(f(25, 1, 0.1).t, 0.055, 0.02));
  // The catalogue's second example (6.3 V part on 5 V, 40 °C) prints F_T 0.1: the curve reads 0.097. Its F_V values
  // there (0.15 at 79 %, 0.006 at 50 %) do not match AVX's own chart (0.13, 0.0077), as in its older papers.
  assert.ok(near(f(40, 1, 0.1).t, 0.1, 0.03));
  assert.ok(near(f(40, 1, 0.1).t, 0.097, 0.02));
  assert.ok(near(f(125, 1, 0.1).t, 22.2, 0.02));
  // Below the charts: the first temperature point (about 20 °C), and the voltage line's start (12 % of V_R).
  assert.equal(f(0, 1, 0.1).t, 10 ** TANT_AVX.ft.tantalum[0][1]);
  assert.equal(f(85, 0.05, 0.1).v, f(85, 0.12, 0.1).v);
  assert.ok(f(85, 0.13, 0.1).v > f(85, 0.12, 0.1).v);
  // On a part: F_B × F_V × F_R × F_T.
  const r = rate('tantalum-maker', { curve: 'avx-tantalum', v: 5, vr: 10, rate: 1, rs: 1, rise: 0 }, at(55));
  const x = f(55, 0.5, 1);
  assert.ok(near(r.fit, 1e4 * x.v * x.t * x.r, 1e-12));
  assert.deepEqual(r.errors, []);
});

test('niobium oxide: AVX\'s NOJ and NOS curves, their ratings, and the import', () => {
  const ft = (t, family) => avxFactors({ t, u: 1, r: 0.1, family }).t;
  // Catalogue Fig. 3: NOJ and NOS share one curve to about 91 °C, then NOS rises faster; both rise far faster than tantalum above 85 °C.
  assert.ok(near(ft(85, 'NOJ'), 1.05, 0.02));
  assert.ok(near(ft(105, 'NOJ'), 22.5, 0.02));
  assert.ok(near(ft(105, 'NOS'), 10.5, 0.02));
  assert.ok(near(ft(120, 'NOS'), 65, 0.02));
  assert.ok(near(ft(125, 'NOS'), 122, 0.02));
  assert.ok(near(ft(105, 'tantalum'), 4.57, 0.02));
  assert.equal(ft(60, 'NOJ'), ft(60, 'NOS'));
  // On a part: F_B from the series, 0.5 %/1000 h for NOJ and 0.2 for NOS.
  const nbo = (series, v, t) => rate('tantalum-maker', { curve: 'avx-nbo', series, v, vr: 4, rs: 0.1, rise: 0 }, at(t));
  const x = avxFactors({ t: 40, u: 3.3 / 4, r: 0.1, family: 'NOJ' });
  assert.ok(near(nbo('NOJ', 3.3, 40).fit, 5000 * x.v * x.t * x.r, 1e-12));
  assert.ok(near(nbo('NOS', 3.3, 40).fit, 2000 * x.v * x.t * x.r, 1e-12));
  // Ratings: NOJ to 105 °C, NOS to 125 °C, the voltage falling to about 2/3 V_R at 105 °C and 1/2 V_R at 125 °C.
  assert.deepEqual(nbo('NOJ', 2.6, 105).errors, []);
  assert.match(nbo('NOJ', 2.8, 105).errors.join(' '), /above the rating/);
  assert.match(nbo('NOJ', 2, 110).errors.join(' '), /above 105 °C, the top of NOJ's rating/);
  assert.deepEqual(nbo('NOS', 2, 125).errors, []);
  assert.match(nbo('NOS', 2.1, 125).errors.join(' '), /above the rating/);
  // Not the tantalum failure modes: a failed part goes to a high resistance.
  assert.equal(failureModesFor('tantalum-maker', { curve: 'avx-nbo' }), null);
  assert.equal(failureModesFor('tantalum-maker', { curve: 'avx-tantalum' }).device, 'Capacitor, Tantalum');
  // Imports: the series comes from the part number.
  const cls = (description) => classifyComponent({ designator: 'C7', value: '100uF', footprint: 'CASE-D_7343', description });
  const noj = cls('KYOCERA AVX NOJD107M006RWJ');
  assert.deepEqual([noj.model, noj.params.curve, noj.params.series], ['tantalum-maker', 'avx-nbo', 'NOJ']);
  assert.match(noj.inferred.series, /NOJD107M006RWJ/);
  assert.equal(cls('NOSC157M004R0100').params.series, 'NOS');
  const named = cls('CAP NIOBIUM OXIDE 100UF 6.3V');
  assert.deepEqual([named.model, named.params.curve, named.params.series], ['tantalum-maker', 'avx-nbo', null]);
});

test('NASA\'s exponential law reproduces the printed acceleration ranges', () => {
  // PCNS 2021 p. 7: 20 % less voltage gives "5 to 11 times" for B = 8 to 12;
  // 85 → 65 °C gives "4 to 18 times" for E_a = 0.7 to 1.5 eV.
  const volt = (b) => expFactor({ b, ea: 0, u: 0.8, uRef: 1, t: 85, tRef: 85 });
  assert.equal(Math.round(volt(8)), 5);
  assert.equal(Math.round(volt(12)), 11);
  const temp = (ea) => expFactor({ b: 0, ea, u: 1, uRef: 1, t: 65, tRef: 85 });
  assert.equal(Math.round(temp(0.7)), 4);
  assert.equal(Math.round(temp(1.5)), 18);
  // On a part: B = 7, 0.7 eV from the maker's 0.5 %/1000 h at 10 V and 105 °C.
  const r = rate('tantalum-maker', { curve: 'nasa-polymer', v: 6, vr: 10, rate: 0.5, refV: 10, refT: 105, rise: 0 }, at(55));
  const af = Math.exp(7 * 0.4) * Math.exp((0.7 / BOLTZMANN_EV) * (1 / 328 - 1 / 378));
  assert.ok(near(r.fit, 5000 / af, 1e-12), `${r.fit} vs ${5000 / af}`);
});

test('rates are weighted by working time and include the rise', () => {
  const prof = normaliseProfile({ phases: [{ tac: 40, tau: 0.3 }, { tac: 70, tau: 0.2 }], tauOff: 0.5 });
  const params = { curve: 'kemet-polymer', capacitance: 100, v: 8, vr: 16, rs: 0.1, rise: 5 };
  const r = rate('tantalum-maker', params, prof);
  const f = (t) => kemetPolymerFit({ capacitance: 100, s: 0.5, rs: 0.1, t }).fit;
  assert.ok(near(r.fit, 0.3 * f(45) + 0.2 * f(75), 1e-12));
  assert.deepEqual(r.operating.map((o) => o.t), [45, 75]);
});

test('use outside a model\'s range is an error, not a number', () => {
  const kemet = { curve: 'kemet-polymer', capacitance: 100, v: 17, vr: 16, rs: 0.1, rise: 0 };
  assert.match(rate('tantalum-maker', kemet, at(85)).errors.join(' '), /above the rated voltage/);
  const vishay = { curve: 'vishay-mno2', v: 9, vr: 10, rise: 0 };
  assert.deepEqual(rate('tantalum-maker', vishay, at(85)).errors, []);
  assert.match(rate('tantalum-maker', vishay, at(105)).errors.join(' '), /above the rating/);
  assert.match(rate('tantalum-maker', { ...vishay, v: 5 }, at(130)).errors.join(' '), /beyond Vishay's chart/);
  const avx = { curve: 'avx-tantalum', v: 9, vr: 10, rate: 1, rs: 0.1, rise: 0 };
  assert.deepEqual(rate('tantalum-maker', avx, at(85)).errors, []);
  assert.match(rate('tantalum-maker', avx, at(105)).errors.join(' '), /above the rating/);
  assert.match(rate('tantalum-maker', { ...avx, v: 5 }, at(130)).errors.join(' '), /above 125 °C, the standard tantalum rating/);
  // A niobium oxide part with no series is Missing, not an error.
  const noSeries = rate('tantalum-maker', { curve: 'avx-nbo', v: 3.3, vr: 4, rs: 0.1, rise: 0 }, at(40));
  assert.deepEqual(noSeries.missing, ['series']);
  assert.match(rate('tantalum-maker', { curve: 'nasa-polymer', v: 12, vr: 10, rate: 0.5, refV: 10, refT: 105, rise: 0 }, at(40)).errors.join(' '), /above the rated voltage/);
  const ceramic = { electrode: 'pme', hours: 1e5, failures: 1.5, vTest: 100, tTest: 125, v: 25, rise: 0 };
  assert.match(rate('ceramic-test', ceramic, at(40)).errors.join(' '), /whole number/);
  // Blank inputs are Missing, with no errors invented from them.
  const blank = rate('tantalum-maker', { curve: 'kemet-polymer', rise: 0 }, at(40));
  assert.deepEqual(blank.missing, ['capacitance', 'v', 'vr']);
  assert.deepEqual(blank.errors, ['Missing: Capacitance, Applied voltage, Rated voltage V_R.']);
});

test('large ceramic chips are flagged for flex cracking, unless soft-terminated', () => {
  const part = (ref, model, params, source) => ({ ref, model, params, source });
  const parts = [
    part('C1', 'capacitor', { type: 'ceramic-2' }, { footprint: 'Capacitor_SMD:C_1210_3225Metric' }),
    part('C2', 'capacitor', { type: 'ceramic-2' }, { footprint: 'C_0805_2012Metric' }),
    part('C3', 'capacitor', { type: 'ceramic-2' }, { footprint: 'C_1812', description: 'CAP CER 10UF 50V X7R 1812 SOFT TERMINATION' }),
    part('C4', 'capacitor', { type: 'tantalum-solid' }, { footprint: 'C_2220' }),
    part('C5', 'mil-capacitor', { style: 'CDR' }, { description: 'CAP CER 1UF 100V X7R 2220' }),
    part('C6', 'ceramic-test', {}, { footprint: 'C_1210' }),
    part('C7', 'tantalum-maker', {}, { footprint: 'CP_Tantalum_Case-B_EIA-3528-21' }),
  ];
  assert.deepEqual(flexRisks(parts), [{ ref: 'C1', code: '1210' }, { ref: 'C5', code: '2220' }, { ref: 'C6', code: '1210' }]);
  // The makers' models join the chip-joint candidates: tantalum chips moulded in plastic, ceramic chips with ceramic bodies.
  const kinds = chipCandidates(parts).map((c) => [c.label, c.body]);
  assert.ok(kinds.some(([label, body]) => /C7 \(3528 tantalum chip\)/.test(label) && body === 'plastic'), JSON.stringify(kinds));
  assert.ok(kinds.some(([label, body]) => /C1, C6 \(1210 ceramic chip capacitor\)/.test(label) && body === 'ceramic'), JSON.stringify(kinds));
});

test('TDK FAQ 0107 Table 1: its k values are the 60 % and 90 % failure bounds', () => {
  // k for no failures is the bound itself; for r failures it is the bound ÷ r. TDK, like Samsung, prints 0.917 for 0.9163.
  const printed = { 0.6: ['0.917', '2.02', '1.55', '1.39', '1.31', '1.26'], 0.9: ['2.30', '3.89', '2.66', '2.23', '2.00', '1.85'] };
  for (const [conf, ks] of Object.entries(printed)) {
    ks.forEach((k, r) => {
      const ours = failureBound(r, Number(conf)) / Math.max(r, 1);
      assert.ok(r === 0 && conf === '0.6' ? near(ours, 0.917, 0.001) : matchesPrinted(ours, k), `${conf} r=${r}: ${ours} vs ${k}`);
    });
  }
});
