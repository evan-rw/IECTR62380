// Validation of the MIL-HDBK-217F models against the handbook's printed tables.
//
// Every expected value here was read a second time from the scanned pages
// (Notice 2 pages 13-1, 13-2, 13-3, 14-1, 14-2, 15-1, 15-2, 15-3, 16-1; 1991
// pages 6-19, 19-1, 20-1, 22-1), independently of assets/tables217f.js. Each
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

// A printed value such as '.021' or '10' covers ± half a unit in its last digit.
function matchesPrinted(actual, printed, what) {
  const decimals = printed.includes('.') ? printed.split('.')[1].length : 0;
  const half = 0.5 * 10 ** -decimals;
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
    matchesPrinted(run('mil-connector', p, profile(T)).operating[0].piT, printed.replace(/\.$/, ''), `connector π_T(${T} °C)`);
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
