// Validation of the MIL-HDBK-217F models against the handbook's printed tables.
//
// Every expected value here was read a second time from the scanned pages
// (Notice 2 pages 9-1 to 9-3, 10-1 to 10-6, 13-1, 13-2, 13-3, 14-1, 14-2, 15-1, 15-2, 15-3,
// 16-1; 1991 pages 6-19, 19-1, 20-1, 22-1), independently of assets/tables217f.js. Each
// check runs the full model (computeComponent), so it covers the table, the
// formula and the FIT conversion together.
//
// Where the handbook prints a formula and a table of its values, the model must
// reproduce every printed value to the printed precision (half a unit in the
// last printed digit). Plain table data must match exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeComponent, normaliseProfile } from '../assets/models.js';

const ENV = ['GB', 'GF', 'GM', 'NS', 'NU', 'AIC', 'AIF', 'AUC', 'AUF', 'ARW', 'SF', 'MF', 'ML', 'CL'];
const profile = (tac = 40, env217f = 'GB') => normaliseProfile({ phases: [{ tac, tau: 1, n: 0, dT: 0 }], env217f });
const run = (model, params, prof = profile()) => {
  const r = computeComponent({ model, qty: 1, params }, prof);
  assert.deepEqual(r.errors, [], `${model} ${JSON.stringify(params)}: ${r.errors.join(' ')}`);
  return r;
};
const fit = (model, params, prof) => run(model, params, prof).fit;

// A printed value such as '.021' or '14' covers ± half a unit in its last digit;
// '10.' is exact to the unit. A whole number ending in zeros, such as '130' or
// '5900', is rounded to its last non-zero digit.
function matchesPrinted(actual, printed, what) {
  let half;
  if (printed.includes('.')) half = 0.5 * 10 ** -printed.split('.')[1].length;
  else half = 0.5 * 10 ** (printed.length - printed.replace(/0+$/, '').length);
  assert.ok(Math.abs(actual - Number(printed)) <= half * (1 + 1e-9),
    `${what}: model ${actual.toPrecision(5)}, handbook prints ${printed}`);
}
const exactly = (actual, expected, what) =>
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.abs(expected), `${what}: model ${actual}, handbook ${expected}`);

// π_E: the rate in each environment over the rate in G_B (π_E = 1.0 there on every page).
function checkEnvironments(model, params, printed) {
  const base = fit(model, params, profile(40, 'GB'));
  ENV.forEach((env, i) => {
    const r = computeComponent({ model, qty: 1, params }, profile(40, env));
    if (printed[i] == null) {
      assert.match(r.errors.join(' '), /no environment factor/, `${model} ${env}`);
    } else {
      exactly(r.fit / base, printed[i], `${model} π_E(${env})`);
    }
  });
}

// Load stress factor π_L (pages 13-1 and 14-1 print the same table).
const PI_L = {
  S: ['.05', '.10', '.20', '.30', '.40', '.50', '.60', '.70', '.80', '.90', '1.00'],
  resistive: ['1.00', '1.02', '1.06', '1.15', '1.28', '1.48', '1.76', '2.15', '2.72', '3.55', '4.77'],
  inductive: ['1.02', '1.06', '1.28', '1.76', '2.72', '4.77', '9.49', '21.4'],
  lamp: ['1.06', '1.28', '2.72', '9.49', '54.6'],
};
function checkLoadStress(model, params) {
  for (const load of ['resistive', 'inductive', 'lamp']) {
    const base = fit(model, { ...params, load, stress: 0 });
    PI_L[load].forEach((printed, i) => {
      const S = Number(PI_L.S[i]);
      matchesPrinted(fit(model, { ...params, load, stress: S }) / base, printed, `${model} π_L(${load}, S = ${S})`);
    });
  }
}

test('13.1 mechanical relays (Notice 2, pages 13-1 and 13-2)', () => {
  const p = { application: 'f6', rating: '85', contact: 'SPST', load: 'resistive', stress: 0, cycles: 5, quality: 'commercial', rise: 0 };
  // Base failure rate λ_b against ambient temperature, for each temperature rating.
  const lb = {
    85: ['.0059', '.0067', '.0075', '.0084', '.0094', '.010', '.012', '.013', '.014', '.016', '.017', '.019', '.021'],
    125: ['.0059', '.0066', '.0073', '.0081', '.0089', '.0098', '.011', '.012', '.013', '.014', '.015', '.017', '.018',
      '.019', '.021', '.022', '.024', '.026', '.027', '.029', '.031'],
  };
  const lbAt = (rating, T) => run('mil-relay', { ...p, rating }, profile(T)).operating[0].piT;
  for (const [rating, column] of Object.entries(lb)) {
    column.forEach((printed, i) => {
      const T = 25 + 5 * i;
      // The 85 °C column's last entry is printed .021; its own formula gives 0.0204.
      if (rating === '85' && T === 85) {
        assert.ok(Math.abs(lbAt(rating, T) - 0.0204) < 5e-5);
        return;
      }
      matchesPrinted(lbAt(rating, T), printed, `relay λ_b(${rating} °C rating, T_A = ${T})`);
    });
  }
  checkLoadStress('mil-relay', p);
  // Contact form π_C.
  const forms = { SPST: 1.0, DPST: 1.5, SPDT: 1.75, '3PST': 2.0, '4PST': 2.5, DPDT: 3.0, '3PDT': 4.25, '4PDT': 5.5, '6PDT': 8.0 };
  for (const [contact, piC] of Object.entries(forms)) exactly(fit('mil-relay', { ...p, contact }) / fit('mil-relay', p), piC, `relay π_C(${contact})`);
  // Cycling factor π_CYC: MIL-SPEC (quality M) and commercial rules, relative to a point where π_CYC = 1.
  const cyc = (quality, cycles, ref) => fit('mil-relay', { ...p, quality, cycles }) / fit('mil-relay', { ...p, quality, cycles: ref });
  for (const [c, v] of [[0.5, 0.1], [1, 0.1], [20, 2], [100, 10]]) exactly(cyc('M', c, 10), v, `relay π_CYC(MIL-SPEC, ${c}/h)`);
  for (const [c, v] of [[5, 1], [10, 1], [500, 50], [1000, 100], [2000, 400]]) exactly(cyc('commercial', c, 5), v, `relay π_CYC(commercial, ${c}/h)`);
  // Application and construction π_F, in the page's order (top to bottom).
  const piF = [4, 6, 1, 4, 7, 7, 3, 5, 6, 5, 2, 6, 100, 10, 10, 100, 6, 1, 25, 6, 10, 9, 10, 5, 5, 20, 5, 3, 1, 2, 3, 2, 2, 7, 12, 10, 5];
  piF.forEach((v, i) => exactly(fit('mil-relay', { ...p, application: `f${i}` }) / fit('mil-relay', { ...p, application: 'f6' }), v / 3, `relay π_F row ${i + 1}`));
  // Quality π_Q, relative to M = 1.0, at a cycle rate where both rules give π_CYC = 1.
  const quality = { R: 0.10, P: 0.30, X: 0.45, U: 0.60, M: 1.0, L: 1.5, milspec: 1.5, commercial: 2.9 };
  for (const [q, v] of Object.entries(quality)) exactly(fit('mil-relay', { ...p, quality: q, cycles: 10 }) / fit('mil-relay', { ...p, quality: 'M', cycles: 10 }), v, `relay π_Q(${q})`);
  checkEnvironments('mil-relay', p, [1.0, 2.0, 15, 8.0, 27, 7.0, 9.0, 11, 12, 46, 0.50, 25, 66, null]);
});

test('13.2 solid-state and time-delay relays (Notice 2, page 13-3)', () => {
  for (const type of ['ss', 'ss-delay', 'hybrid']) exactly(fit('mil-ssr', { type, quality: 'milspec' }), 0.029 * 1000, `SSR λ_b(${type})`);
  exactly(fit('mil-ssr', { type: 'ss', quality: 'commercial' }) / fit('mil-ssr', { type: 'ss', quality: 'milspec' }), 1.9, 'SSR π_Q');
  checkEnvironments('mil-ssr', { type: 'ss', quality: 'milspec' }, [1.0, 3.0, 12, 6.0, 17, 12, 19, 21, 32, 23, 0.40, 12, 33, 590]);
});

test('14.1 switches (Notice 2, pages 14-1 and 14-2)', () => {
  const p = { type: 'toggle', load: 'resistive', stress: 0, contact: 'SPST', quality: 'milspec' };
  const lb = {
    centrifugal: 3.4, dip: 0.00012, limit: 4.3, 'liquid-level': 2.3, microwave: 1.7, pressure: 2.8, pushbutton: 0.10,
    reed: 0.0010, rocker: 0.023, rotary: 0.11, sensitive: 0.49, thermal: 0.031, thumbwheel: 0.18, toggle: 0.10,
  };
  for (const [type, v] of Object.entries(lb)) exactly(fit('mil-switch', { ...p, type }), v * 1000, `switch λ_b(${type})`);
  checkLoadStress('mil-switch', p);
  // Contact configuration π_C = NC^0.33, for toggles and pushbuttons only.
  const forms = { SPST: '1.0', DPST: '1.3', SPDT: '1.3', '3PST': '1.4', '4PST': '1.6', DPDT: '1.6', '3PDT': '1.8', '4PDT': '2.0', '6PDT': '2.3' };
  for (const type of ['toggle', 'pushbutton']) {
    for (const [contact, printed] of Object.entries(forms)) {
      matchesPrinted(fit('mil-switch', { ...p, type, contact }) / fit('mil-switch', { ...p, type }), printed, `${type} switch π_C(${contact})`);
    }
  }
  exactly(fit('mil-switch', { ...p, type: 'rotary', contact: '6PDT' }) / fit('mil-switch', { ...p, type: 'rotary' }), 1, 'rotary switch π_C');
  exactly(fit('mil-switch', { ...p, quality: 'lower' }) / fit('mil-switch', p), 2, 'switch π_Q');
  checkEnvironments('mil-switch', p, [1.0, 3.0, 18, 8.0, 29, 10, 18, 13, 22, 46, 0.50, 25, 67, 1200]);
});

test('15.1 connectors (Notice 2, pages 15-1 and 15-2)', () => {
  const p = { type: 'rectangular', half: 'pair', current: 0, gauge: '22', cycles: 0, quality: 'milspec' };
  // Base failure rate, with π_T taken from the model's own operating temperature.
  const lb = { circular: 0.0010, 'card-edge': 0.040, hexagonal: 0.15, 'rack-panel': 0.021, rectangular: 0.046, 'rf-coax': 0.00041, telephone: 0.0075, power: 0.0070, triaxial: 0.0036 };
  for (const [type, v] of Object.entries(lb)) {
    const r = run('mil-connector', { ...p, type });
    exactly(r.fit / (1000 * r.operating[0].piT), v, `connector λ_b(${type})`);
  }
  // Temperature factor π_T against connector temperature T_o.
  const piT = ['.91', '1.1', '1.3', '1.5', '1.8', '2.0', '2.3', '2.7', '3.0', '3.4', '3.7', '4.1', '4.6', '5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.1', '8.6', '9.2', '9.8', '10.'];
  piT.forEach((printed, i) => {
    const T = 20 + 10 * i;
    matchesPrinted(run('mil-connector', p, profile(T)).operating[0].piT, printed, `connector π_T(${T} °C)`);
  });
  // Default insert temperature rise ΔT (°C) by amperes per contact, for each printed gauge column.
  const amps = [2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 35, 40];
  const rise = {
    30: [10, 22, 37, 56, 79],
    22: [4, 8, 13, 19, 27, 36, 46, 57, 70],
    20: [2, 5, 8, 13, 18, 23, 30, 37, 45, 96],
    16: [1, 2, 4, 5, 8, 10, 13, 16, 19, 41, 70, 106],
    12: [0, 1, 1, 2, 3, 4, 5, 6, 7, 15, 26, 39, 54, 72, 92],
  };
  for (const [gauge, column] of Object.entries(rise)) {
    column.forEach((printed, i) => {
      const dT = run('mil-connector', { ...p, gauge, current: amps[i] }).operating[0].t - 40;
      // The page rounds its formula everywhere except here: 0.989·9^1.85 = 57.6 is printed 57.
      if (gauge === '22' && amps[i] === 9) {
        assert.ok(Math.abs(dT - 57.616) < 1e-3);
        return;
      }
      matchesPrinted(dT, String(printed), `connector ΔT(${gauge} AWG, ${amps[i]} A)`);
    });
  }
  // RF coaxial: fixed rise of 5 °C, 50 °C for high power.
  assert.equal(run('mil-connector', { ...p, type: 'rf-coax' }).operating[0].t, 45);
  assert.equal(run('mil-connector', { ...p, type: 'rf-coax-power' }).operating[0].t, 90);
  // Mating/unmating factor π_K by cycles per 1000 hours (each band includes its upper limit).
  for (const [c, v] of [[0, 1.0], [0.05, 1.0], [0.06, 1.5], [0.5, 1.5], [0.6, 2.0], [5, 2.0], [6, 3.0], [50, 3.0], [51, 4.0]]) {
    exactly(fit('mil-connector', { ...p, cycles: c }) / fit('mil-connector', p), v, `connector π_K(${c})`);
  }
  exactly(fit('mil-connector', { ...p, quality: 'lower' }) / fit('mil-connector', p), 2, 'connector π_Q');
  checkEnvironments('mil-connector', p, [1.0, 1.0, 8.0, 5.0, 13, 3.0, 5.0, 8.0, 12, 19, 0.50, 10, 27, 490]);
});

test('15.2 IC sockets (Notice 2, page 15-3)', () => {
  const p = { type: 'dip', pins: 1, quality: 'lower' };
  const lb = { dip: 0.00064, sip: 0.00064, 'chip-carrier': 0.00064, pga: 0.00064, relay: 0.037, transistor: 0.0051, tube: 0.011 };
  for (const [type, v] of Object.entries(lb)) exactly(fit('mil-socket', { ...p, type }), v * 1000, `socket λ_b(${type})`);
  // Active pins factor π_P = exp(((N − 1)/10)^0.39).
  const piP = [
    [1, '1.0'], [2, '1.5'], [3, '1.7'], [4, '1.9'], [5, '2.0'], [6, '2.1'], [7, '2.3'], [8, '2.4'], [9, '2.5'], [10, '2.6'],
    [11, '2.7'], [12, '2.8'], [13, '2.9'], [14, '3.0'], [15, '3.1'], [16, '3.2'], [17, '3.3'], [18, '3.4'], [19, '3.5'], [20, '3.6'],
    [25, '4.1'], [30, '4.5'], [35, '5.0'], [40, '5.5'], [45, '5.9'], [50, '6.4'], [55, '6.9'], [60, '7.4'], [65, '7.9'], [70, '8.4'],
    [75, '8.9'], [80, '9.4'], [85, '9.9'], [90, '10'], [95, '11'], [100, '12'], [105, '12'], [110, '13'], [115, '13'], [120, '14'],
    [125, '14'], [130, '15'], [135, '16'], [140, '16'], [145, '17'], [150, '18'], [155, '18'], [160, '19'], [165, '20'], [170, '20'],
    [175, '21'], [180, '22'],
  ];
  for (const [pins, printed] of piP) matchesPrinted(fit('mil-socket', { ...p, pins }) / fit('mil-socket', p), printed, `socket π_P(${pins} pins)`);
  exactly(fit('mil-socket', { ...p, quality: 'milspec' }) / fit('mil-socket', p), 0.3, 'socket π_Q');
  checkEnvironments('mil-socket', p, [1.0, 3.0, 14, 6.0, 18, 8.0, 12, 11, 13, 25, 0.50, 14, 36, 650]);
});

test('16.1 boards with plated through holes (Notice 2, page 16-1)', () => {
  const p = { technology: 'pcb', n1: 1, n2: 0, planes: 2, quality: 'milspec' };
  exactly(fit('mil-pwb', p), 0.000017 * 1000, 'PWB λ_b');
  exactly(fit('mil-pwb', { ...p, technology: 'discrete' }), 0.00011 * 1000, 'discrete wiring λ_b (π_C = 1)');
  // Complexity factor π_C = 0.65·P^0.63 for 2 ≤ P ≤ 18; 1.0 at P ≤ 2.
  const piC = ['1.0', '1.3', '1.6', '1.8', '2.0', '2.2', '2.4', '2.6', '2.8', '2.9', '3.1', '3.3', '3.4', '3.6', '3.7', '3.9', '4.0'];
  piC.forEach((printed, i) => matchesPrinted(fit('mil-pwb', { ...p, planes: i + 2 }) / fit('mil-pwb', p), printed, `PWB π_C(${i + 2} planes)`));
  // Hand-soldered holes count (π_C + 13) each.
  exactly(fit('mil-pwb', { ...p, n1: 0, n2: 1 }) / fit('mil-pwb', p), 14, 'hand-soldered PTH');
  exactly(fit('mil-pwb', { ...p, quality: 'lower' }) / fit('mil-pwb', p), 2, 'PWB π_Q');
  checkEnvironments('mil-pwb', p, [1.0, 2.0, 7.0, 5.0, 13, 5.0, 8.0, 16, 28, 19, 0.50, 10, 27, 500]);
});

test('19.1 quartz crystals (page 19-1)', () => {
  const lb = [
    [0.5, '.011'], [1.0, '.013'], [5.0, '.019'], [10, '.022'], [15, '.024'], [20, '.026'], [25, '.027'], [30, '.028'],
    [35, '.029'], [40, '.030'], [45, '.031'], [50, '.032'], [55, '.033'], [60, '.033'], [65, '.034'], [70, '.035'],
    [75, '.035'], [80, '.036'], [85, '.036'], [90, '.037'], [95, '.037'], [100, '.037'], [105, '.038'],
  ];
  for (const [freq, printed] of lb) matchesPrinted(fit('mil-crystal', { freq, quality: 'milspec' }) / 1000, printed, `crystal λ_b(${freq} MHz)`);
  exactly(fit('mil-crystal', { freq: 10, quality: 'lower' }) / fit('mil-crystal', { freq: 10, quality: 'milspec' }), 2.1, 'crystal π_Q');
  checkEnvironments('mil-crystal', { freq: 10, quality: 'milspec' }, [1.0, 3.0, 10, 6.0, 16, 12, 17, 22, 28, 23, 0.50, 13, 32, 500]);
});

test('20.1 incandescent lamps (page 20-1)', () => {
  const p = { voltage: 5, utilization: 1, application: 'ac' };
  const lb = [[5, '.59'], [6, '.75'], [12, '1.8'], [14, '2.2'], [24, '4.5'], [28, '5.4'], [37.5, '7.9']];
  for (const [voltage, printed] of lb) matchesPrinted(fit('mil-lamp', { ...p, voltage }) / 1000, printed, `lamp λ_b(${voltage} V)`);
  // Utilisation factor π_U by band.
  for (const [u, v] of [[0.05, 0.10], [0.10, 0.72], [0.5, 0.72], [0.90, 0.72], [0.95, 1.0]]) exactly(fit('mil-lamp', { ...p, utilization: u }) / fit('mil-lamp', p), v, `lamp π_U(${u})`);
  exactly(fit('mil-lamp', { ...p, application: 'dc' }) / fit('mil-lamp', p), 3.3, 'lamp π_A');
  checkEnvironments('mil-lamp', p, [1.0, 2.0, 3.0, 3.0, 4.0, 4.0, 4.0, 5.0, 6.0, 5.0, 0.70, 4.0, 6.0, 27]);
});

test('22.1 fuses (page 22-1)', () => {
  exactly(fit('mil-fuse', {}), 0.010 * 1000, 'fuse λ_b');
  checkEnvironments('mil-fuse', {}, [1.0, 2.0, 8.0, 5.0, 11, 9.0, 12, 15, 18, 16, 0.90, 10, 21, 230]);
});

test('6.11 optoelectronics (page 6-19)', () => {
  const p = { type: 'led', power: 0, rja: 0, quality: 'jantx' };
  const lb = {
    phototransistor: 0.0055, photodiode: 0.0040, 'iso-diode': 0.0025, 'iso-transistor': 0.013, 'iso-darlington': 0.013,
    'iso-lsr': 0.0064, 'iso-diode-dual': 0.0033, 'iso-transistor-dual': 0.017, 'iso-darlington-dual': 0.017,
    'iso-lsr-dual': 0.0086, irled: 0.0013, led: 0.00023,
  };
  // At T_j = 25 °C, π_T = 1.
  for (const [type, v] of Object.entries(lb)) exactly(fit('mil-opto', { ...p, type }, profile(25)), v * 1000, `opto λ_b(${type})`);
  // Temperature factor π_T against junction temperature.
  const piT = ['1.0', '1.2', '1.4', '1.6', '1.8', '2.1', '2.4', '2.7', '3.0', '3.4', '3.8', '4.3', '4.8', '5.3', '5.9', '6.6', '7.3', '8.0', '8.8'];
  piT.forEach((printed, i) => {
    const Tj = 25 + 5 * i;
    matchesPrinted(run('mil-opto', p, profile(Tj)).operating[0].piT, printed, `opto π_T(${Tj} °C)`);
  });
  const quality = { jantxv: 0.70, jantx: 1.0, jan: 2.4, lower: 5.5, plastic: 8.0 };
  for (const [q, v] of Object.entries(quality)) exactly(fit('mil-opto', { ...p, quality: q }) / fit('mil-opto', p), v, `opto π_Q(${q})`);
  checkEnvironments('mil-opto', p, [1.0, 2.0, 8.0, 5.0, 12, 4.0, 6.0, 6.0, 8.0, 17, 0.50, 9.0, 24, 450]);
});

test('10.1 capacitors (Notice 2, pages 10-1 to 10-6)', () => {
  // At 25 °C, 1 µF, no voltage stress, quality M, G_B: λ_p = λ_b (× π_SR for CSR and CWR, here 1.0 at CR = 0.7).
  const p = { capacitance: 1, stress: 0, cr: 0.7, quality: 'M', rise: 0 };
  const cap = (style, extra = {}, prof = profile(25)) => fit('mil-capacitor', { ...p, style, ...extra }, prof);
  // Style, λ_b, and the π_T, π_C and π_V columns it uses, as printed on pages 10-1 and 10-2.
  const styles = [
    ['CP', 0.00037, 1, 1, 1], ['CA', 0.00037, 1, 1, 1], ['CZ', 0.00037, 1, 1, 1], ['CQ', 0.00051, 1, 1, 1],
    ['CH', 0.00037, 1, 1, 1], ['CHR', 0.00051, 1, 1, 1], ['CFR', 0.00051, 1, 1, 1], ['CRH', 0.00051, 1, 1, 1],
    ['CM', 0.00076, 2, 1, 2], ['CMR', 0.00076, 2, 1, 2], ['CB', 0.00076, 2, 1, 2], ['CY', 0.00076, 2, 1, 2], ['CYR', 0.00076, 2, 1, 2],
    ['CK', 0.00099, 2, 1, 3], ['CKR', 0.00099, 2, 1, 3], ['CC', 0.00099, 2, 1, 3], ['CDR', 0.0020, 2, 1, 3],
    ['CSR', 0.00040, 1, 2, 4], ['CWR', 0.00005, 1, 2, 4], ['CL', 0.00040, 1, 2, 4], ['CLR', 0.00040, 1, 2, 4], ['CRL', 0.00040, 1, 2, 4],
    ['CU', 0.00012, 2, 2, 1], ['CE', 0.00012, 2, 2, 1],
    ['CV', 0.0079, 1, 1, 5], ['PC', 0.0060, 2, 1, 5], ['CT', 0.0000072, 2, 1, 5], ['CG', 0.0060, 1, 1, 5],
  ];
  // Temperature factor π_T (page 10-3), T = 20 … 150 °C.
  const piT = {
    1: ['.91', '1.1', '1.3', '1.6', '1.8', '2.2', '2.5', '2.8', '3.2', '3.7', '4.1', '4.6', '5.1', '5.6'],
    2: ['.79', '1.3', '1.9', '2.9', '4.2', '6.0', '8.4', '11', '15', '21', '27', '35', '44', '56'],
  };
  // Capacitance factor π_C (page 10-3).
  const capacitance = [0.000001, 0.00001, 0.0001, 0.001, 0.01, 0.05, 0.1, 0.5, 1, 3, 8, 18, 40, 200, 1000, 3000, 10000, 30000, 60000, 120000];
  const piC = {
    1: ['.29', '.35', '.44', '.54', '.66', '.76', '.81', '.94', '1.0', '1.1', '1.2', '1.3', '1.4', '1.6', '1.9', '2.1', '2.3', '2.5', '2.7', '2.9'],
    2: ['.04', '.07', '.12', '.20', '.35', '.50', '.59', '.85', '1.0', '1.3', '1.6', '1.9', '2.3', '3.4', '4.9', '6.3', '8.3', '11', '13', '15'],
  };
  // Voltage stress factor π_V (page 10-4), S = 0.1 … 1.
  const piV = {
    1: ['1.0', '1.0', '1.0', '1.1', '1.4', '2.0', '3.2', '5.2', '8.6', '14'],
    2: ['1.0', '1.0', '1.0', '1.0', '1.2', '2.0', '5.7', '19', '59', '166'],
    3: ['1.0', '1.0', '1.1', '1.3', '1.6', '2.0', '2.6', '3.4', '4.4', '5.6'],
    4: ['1.0', '1.0', '1.0', '1.0', '1.0', '2.0', '15', '130', '990', '5900'],
    5: ['1.0', '1.1', '1.2', '1.5', '2.0', '2.7', '3.7', '5.1', '6.8', '9.0'],
  };
  for (const [style, lb, t, c, v] of styles) {
    exactly(cap(style), lb * 1000, `capacitor λ_b(${style})`);
    // The style's π_T column, checked at every printed temperature.
    piT[t].forEach((printed, i) => {
      const T = 20 + 10 * i;
      matchesPrinted(run('mil-capacitor', { ...p, style }, profile(T)).operating[0].piT, printed, `capacitor π_T(${style}, column ${t}, ${T} °C)`);
    });
    capacitance.forEach((C, i) => matchesPrinted(cap(style, { capacitance: C }) / cap(style), piC[c][i], `capacitor π_C(${style}, column ${c}, ${C} µF)`));
    piV[v].forEach((printed, i) => {
      const S = (i + 1) / 10;
      matchesPrinted(cap(style, { stress: S }) / cap(style), printed, `capacitor π_V(${style}, column ${v}, S = ${S})`);
    });
  }
  // Series resistance factor π_SR (page 10-4), CSR and CWR only; bands include their upper limit.
  for (const style of ['CSR', 'CWR']) {
    for (const [cr, v] of [[0, 3.3], [0.1, 3.3], [0.15, 2.7], [0.2, 2.7], [0.3, 2.0], [0.4, 2.0], [0.5, 1.3], [0.6, 1.3], [0.7, 1.0], [0.8, 1.0], [0.9, 0.66], [5, 0.66]]) {
      exactly(cap(style, { cr }) / cap(style), v, `capacitor π_SR(${style}, CR = ${cr})`);
    }
  }
  exactly(cap('CL', { cr: 0 }) / cap('CL'), 1, 'π_SR is 1 for other styles');
  // Quality factor π_Q (page 10-5), relative to M = 1.0.
  const quality = { D: 0.001, C: 0.01, S: 0.03, R: 0.1, P: 0.3, M: 1.0, L: 1.5, 'non-er': 3.0, commercial: 10 };
  for (const [q, v] of Object.entries(quality)) exactly(cap('CFR', { quality: q }) / cap('CFR'), v, `capacitor π_Q(${q})`);
  checkEnvironments('mil-capacitor', { ...p, style: 'CFR' }, [1.0, 10, 20, 7.0, 15, 12, 15, 25, 30, 40, 0.50, 20, 50, 570]);

  // Worked example (page 10-6): CQ09A1KE153K3, 0.015 µF, 400 V rated, 200 V DC + 50 V rms,
  // 50 °C, ground fixed, non-established reliability. The page rounds S to .68 and
  // each factor to two digits: π_T 1.6, π_C .69, π_V 2.9, giving λ_p = .049.
  const ex = run('mil-capacitor', { style: 'CQ', capacitance: 0.015, stress: 0.68, quality: 'non-er', rise: 0 }, profile(50, 'GF'));
  matchesPrinted(ex.operating[0].piT, '1.6', 'example π_T');
  matchesPrinted(0.015 ** 0.09, '.69', 'example π_C');
  matchesPrinted((0.68 / 0.6) ** 5 + 1, '2.9', 'example π_V');
  matchesPrinted(0.00051 * 1.6 * 0.69 * 2.9 * 1 * 3.0 * 10, '.049', 'example λ_p from the printed factors');
  // Unrounded, the same inputs give 0.0473 per 10⁶ h: 3.5 % below the page's .049.
  assert.ok(Math.abs(ex.fit / 1000 - 0.049) / 0.049 < 0.05, `example λ_p ${ex.fit / 1000}`);
  assert.equal((200 + Math.SQRT2 * 50) / 400 > 0.67 && (200 + Math.SQRT2 * 50) / 400 < 0.68, true, 'S as the page computes it');
});

test('9.1 resistors (Notice 2, pages 9-1 to 9-3)', () => {
  // At 25 °C, 1 W dissipated, quality M, G_B: λ_p = λ_b × π_S(S).
  const p = { power: 1, rated: Infinity, quality: 'M', rise: 0 };
  const res = (style, extra = {}, prof = profile(25)) => fit('mil-resistor', { ...p, style, ...extra }, prof);
  // Style, λ_b, and its π_T and π_S columns as printed on page 9-1 (null: "N/A, π = 1").
  const styles = [
    ['RC', 0.0017, 1, 2], ['RCR', 0.0017, 1, 2], ['RL', 0.0037, 2, 1], ['RLR', 0.0037, 2, 1], ['RNR', 0.0037, 2, 1],
    ['RM', 0.0037, 2, 1], ['RN', 0.0037, 2, 1], ['RD', 0.0037, null, 1], ['RZ', 0.0019, 1, null],
    ['RB', 0.0024, 2, 1], ['RBR', 0.0024, 2, 1], ['RW', 0.0024, 2, 2], ['RWR', 0.0024, 2, 2], ['RE', 0.0024, 2, 2], ['RER', 0.0024, 2, 2],
    ['RTH', 0.0019, null, null], ['RT', 0.0024, 2, 1], ['RTR', 0.0024, 2, 1], ['RR', 0.0024, 2, 1], ['RA', 0.0024, 1, 1],
    ['RK', 0.0024, 1, 1], ['RP', 0.0024, 2, 1], ['RJ', 0.0037, 2, 1], ['RJR', 0.0037, 2, 1], ['RV', 0.0037, 2, 1],
    ['RQ', 0.0037, 1, 1], ['RVC', 0.0037, 1, 1],
  ];
  // Temperature factor π_T (page 9-2), T = 20 … 150 °C.
  const piT = {
    1: ['.88', '1.1', '1.5', '1.8', '2.3', '2.8', '3.4', '4.0', '4.8', '5.6', '6.6', '7.6', '8.7', '10'],
    2: ['.95', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.9', '2.0', '2.1', '2.3', '2.4', '2.5'],
  };
  // Power stress factor π_S (page 9-3), S = 0.1 … 0.9.
  const piS = {
    1: ['.79', '.88', '.99', '1.1', '1.2', '1.4', '1.5', '1.7', '1.9'],
    2: ['.66', '.81', '1.0', '1.2', '1.5', '1.8', '2.3', '2.8', '3.4'],
  };
  for (const [style, lb, t, sCol] of styles) {
    // With an unlimited rating S = 0, and π_S is the column's constant (or 1).
    const piS0 = sCol ? { 1: 0.71, 2: 0.54 }[sCol] : 1;
    exactly(res(style) / piS0, lb * 1000, `resistor λ_b(${style})`);
    piT[t ?? 1].forEach((printed, i) => {
      const T = 20 + 10 * i;
      const got = run('mil-resistor', { ...p, style }, profile(T)).operating[0].piT;
      if (t) matchesPrinted(got, printed, `resistor π_T(${style}, column ${t}, ${T} °C)`);
      else exactly(got, 1, `resistor π_T(${style}) is 1`);
    });
    piS[sCol ?? 1].forEach((printed, i) => {
      const S = (i + 1) / 10;
      const got = res(style, { rated: 1 / S }) / (res(style) / piS0);
      if (sCol) matchesPrinted(got, printed, `resistor π_S(${style}, column ${sCol}, S = ${S})`);
      else exactly(got, 1, `resistor π_S(${style}) is 1`);
    });
  }
  // Power factor π_P = P^0.39 (page 9-2).
  const piP = [
    [0.001, '.068'], [0.01, '.17'], [0.25, '.58'], [0.5, '.76'], [0.75, '.89'], [1.0, '1.0'], [2.0, '1.3'], [3.0, '1.5'],
    [4.0, '1.7'], [5.0, '1.9'], [10, '2.5'], [25, '3.5'], [50, '4.6'], [100, '6.0'], [150, '7.1'],
  ];
  const pi = (P) => res('RZ', { power: P }) / res('RZ');
  for (const [P, printed] of piP) matchesPrinted(pi(P), printed, `resistor π_P(${P} W)`);
  // The row printed ".13" W with π_P ".44" is 1/8 W: 0.125^0.39 = 0.444, while 0.13^0.39 = 0.451.
  matchesPrinted(pi(0.125), '.44', 'resistor π_P(1/8 W)');
  // Below the table's 0.001 W the power is taken as 0.001 W.
  exactly(pi(0) / pi(0.001), 1, 'resistor π_P below 0.001 W');
  const quality = { S: 0.03, R: 0.1, P: 0.3, M: 1.0, 'non-er': 3.0, commercial: 10 };
  for (const [q, v] of Object.entries(quality)) exactly(res('RM', { quality: q }) / res('RM'), v, `resistor π_Q(${q})`);
  checkEnvironments('mil-resistor', { ...p, style: 'RM' }, [1.0, 4.0, 16, 12, 42, 18, 23, 31, 43, 63, 0.50, 37, 87, 1728]);
});
