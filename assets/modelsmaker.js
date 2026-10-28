// Makers' failure-rate models for tantalum, niobium oxide and ceramic capacitors. Same model
// interface as models.js (fields, defaults, describe, compute(p, prof) ->
// { fit, parts, values, operating, cycling, errors }).
//
// Each rate is per operating hour at a working phase's temperature, weighted
// by working time like the vendor model: Σ λ(T_i)·τ_i / (τ_on + τ_off).
// Dormant phases add nothing.

import { TANT_KEMET, TANT_VISHAY, TANT_AVX, TANT_NASA, MLCC_BOUND, MLCC_PME } from './tablesmaker.js';
import { CAPACITORS_217F, ENVIRONMENTS } from './tables217f.js';

const BOLTZMANN_EV = 8.617e-5;
// 1 %/1000 h = 10⁻⁵ per hour = 10,000 FIT.
const FIT_PER_PCT = 1e4;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmtE = (x) => (x === 0 ? '0' : Math.abs(x) >= 0.01 && Math.abs(x) < 1e5 ? String(+x.toPrecision(4)) : x.toExponential(3));
const arrhenius = (ea, t, tRef, zero) => Math.exp((ea / BOLTZMANN_EV) * (1 / (zero + t) - 1 / (zero + tRef)));

// Σ λ(T_i)·τ_i / (τ_on + τ_off) in FIT; rateAt(t) returns { fit, factor }.
function weighted(prof, rateAt, tempOf) {
  const denom = prof.tauOn + prof.tauOff;
  let total = 0;
  const rows = [];
  prof.phases.forEach((ph, i) => {
    if (!(ph.tau > 0)) return;
    const t = tempOf(ph);
    const { fit, factor } = rateAt(t);
    total += fit * ph.tau;
    rows.push({ phase: i, t, piT: factor, tau: ph.tau });
  });
  return { fit: denom > 0 ? total / denom : 0, rows };
}

// ---------------------------------------------------------------------------
// Tantalum

// KEMET's polymer FIT, failures per 10⁹ h at T °C: the 217F CWR row with KEMET's
// π_V and π_Q; piE is the environment factor.
const CWR = CAPACITORS_217F.styles.find((r) => r.id === 'CWR');
export function kemetPolymerFit({ capacitance, s, rs, t, piE = 1 }) {
  const t217 = CAPACITORS_217F;
  const piT = Math.exp((-t217.ea[CWR.t] / BOLTZMANN_EV) * (1 / (Math.max(t, TANT_KEMET.tRoom) + 273) - 1 / 298));
  const piC = capacitance ** t217.capExponent[CWR.c];
  const piV = (s / TANT_KEMET.vRef) ** t217.voltage[CWR.v][1] + 1;
  const piSR = t217.seriesResistance.find(([upTo]) => rs <= upTo)[1];
  return { fit: CWR.lb * piT * piC * piV * piSR * TANT_KEMET.piQ * piE * 1000, piT, piC, piV, piSR };
}

// Vishay's nomograph correction factor at T °C and u = V/V_R, read inside the chart.
export function vishayFactor(t, u) {
  const { a, b, c, tMin, uMin } = TANT_VISHAY;
  return 10 ** (a + b * Math.max(t, tMin) + c * Math.max(u, uMin));
}

// Tantalum rating: full V_R up to 85 °C, falling linearly to 2/3 V_R at 125 °C (Vishay, KEMET).
export const tantalumLimit = (t) => (t <= 85 ? 1 : 1 - (t - 85) / 120);

// Piecewise-linear interpolation through [x, y] points, held at the end values.
const interp = (x, pts) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
};
const AVX_FR_LOG = TANT_AVX.fr.map(([r, f]) => [Math.log10(r), Math.log10(f)]);

// KYOCERA AVX's catalogue factors at T °C, u = V/V_R and r Ω/V, as drawn and
// read inside its charts and table; family is 'tantalum', 'NOJ' or 'NOS'.
export function avxFactors({ t, u, r, family = 'tantalum' }) {
  const { fv, ft } = TANT_AVX;
  return {
    v: 10 ** (fv.a + fv.b * Math.max(u, fv.uMin)),
    t: 10 ** interp(t, ft[family]),
    r: 10 ** interp(Math.log10(Math.max(r, 1e-9)), AVX_FR_LOG),
  };
}

// NASA's exponential voltage law and Arrhenius, from the maker's stated condition.
export function expFactor({ b, ea, u, uRef, t, tRef }) {
  return Math.exp(b * (uRef - u)) * arrhenius(ea, t, tRef, 273);
}

// Choice label, one-line description, and what the chosen curve does.
const TANT_CURVES = {
  'kemet-polymer': {
    label: 'Polymer: KEMET\'s FIT method',
    describe: 'Polymer tantalum, KEMET FIT method',
    help: 'Rate = MIL-HDBK-217F\'s chip-tantalum (CWR) model as KEMET applies it to its polymer parts: π_V = (S/0.8)¹⁷ + 1 and π_Q = 0.707, with the board\'s 217F environment. For KEMET\'s own polymer parts.',
  },
  'nasa-polymer': {
    label: 'Polymer: NASA conservative values on the maker\'s rate',
    describe: 'Polymer tantalum, NASA conservative values',
    help: 'Rate = the maker\'s rate at its stated voltage and temperature, divided by exp[7·(u_ref − u)] with u = V/V_R and Arrhenius with 0.7 eV. NASA\'s own limits for chip parts are 0.6 V_R and 85 °C case.',
  },
  'vishay-mno2': {
    label: 'MnO₂: Vishay nomograph (read from a chart)',
    describe: 'MnO₂ tantalum, Vishay nomograph',
    help: 'Rate = 1 %/1000 h (85 °C, V_R, at least 1 Ω per volt of series resistance) × the chart\'s factor for T and V/V_R. Vishay gives no factor for less series resistance.',
  },
  'avx-tantalum': {
    label: 'MnO₂ or AVX polymer: KYOCERA AVX catalogue (read from charts)',
    describe: 'Tantalum, KYOCERA AVX catalogue model',
    help: 'Rate = F_B × F_V × F_T × F_R from AVX\'s catalogue: voltage and temperature from its charts, series resistance from its table, as drawn. Not for TLJ, TLN, TLC or NLJ, whose rate is stated at half the rated voltage.',
  },
  'avx-nbo': {
    label: 'Niobium oxide (not tantalum): KYOCERA AVX catalogue',
    describe: 'Niobium oxide capacitor, KYOCERA AVX catalogue model',
    help: 'Rate = F_B × F_V × F_T × F_R from AVX\'s catalogue, with the NOJ or NOS temperature curve, which rises much faster than tantalum\'s above 85 °C.',
    notTantalum: true,
  },
};
const TANT_HELP = 'The models disagree by up to 1000 × at derated voltage. For the MIL-HDBK-217F tantalum model, use "Capacitor, any dielectric (MIL-HDBK-217F)", style CWR.';
const isCurve = (...curves) => (p) => curves.includes(p.curve);
const RATE_HELP = {
  'nasa-polymer': 'As printed: for example 0.5 %/1000 h (KEMET, at its category voltage and temperature), 0.5 %/1000 h (Panasonic POSCAP, 1.0 % for some small cases, at rated voltage and 105 °C, 85 °C for some series) or 1 %/1000 h (Vishay T55, at 105 °C and rated voltage).',
  'avx-tantalum': 'From AVX\'s catalogue, at 85 °C, V_R and 0.1 Ω/V: 1.0 %/1000 h for TAJ, TPS, TPM, TCJ, TCO, TCQ, TCM, TCN, J-CAP and TAC; 0.5 %/1000 h for TMJ, TRJ, TRM and THJ.',
};

// ---------------------------------------------------------------------------
// Ceramic life test

// Upper bound, at confidence `conf`, on the expected number of failures when r
// were seen: the m with P(N ≤ r) = 1 − conf for N ~ Poisson(m), which is
// χ²(conf, 2r + 2)/2. Summed in logs so that large r does not underflow.
export function failureBound(r, conf = MLCC_BOUND.confidence) {
  const cdf = (m) => {
    let logTerm = -m;
    let sum = Math.exp(logTerm);
    for (let k = 1; k <= r; k++) {
      logTerm += Math.log(m / k);
      sum += Math.exp(logTerm);
    }
    return sum;
  };
  let lo = 0;
  let hi = r + 10;
  while (cdf(hi) > 1 - conf) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) > 1 - conf) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Acceleration from use to test conditions; kelvin = °C + 273.15, which
// reproduces Knowles' printed tables.
export function mlccFactor({ vTest, v, tTest, t, n, ea }) {
  return (vTest / v) ** n * Math.exp((ea / BOLTZMANN_EV) * (1 / (t + 273.15) - 1 / (tTest + 273.15)));
}

const riseField = { key: 'rise', label: 'Temperature rise above board ambient', unit: '°C', type: 'number', min: 0, step: 'any', required: true, help: 'Self-heating from ripple current, or a nearby hot part. 0 if unknown.' };

export const MODELS_MAKER = {
  'tantalum-maker': {
    label: 'Tantalum or niobium oxide capacitor, maker\'s model',
    group: 'Vendor data',
    clause: 'Makers\' models',
    status: 'One published model per choice: KEMET\'s FIT method for its polymer parts, NASA\'s conservative polymer values applied to the maker\'s rate, Vishay\'s MnO₂ chart, or KYOCERA AVX\'s catalogue model for its tantalum and niobium oxide parts. They disagree by up to 1000 × at derated voltage. Rates per operating hour, weighted by working time. Failures from surge current at power-on are not in any of them.',
    defaults: { curve: null, capacitance: null, v: null, vr: null, rate: null, refV: null, refT: null, rs: 0.1, series: null, rise: 0 },
    fields: [
      {
        key: 'curve', label: 'Maker\'s model', type: 'select', required: true, wide: true,
        options: Object.entries(TANT_CURVES).map(([value, c]) => ({ value, label: c.label })),
        help: (p) => {
          const c = TANT_CURVES[p.curve];
          return !c ? TANT_HELP : c.notTantalum ? c.help : `${c.help} ${TANT_HELP}`;
        },
      },
      {
        key: 'series', label: 'Series', type: 'select', required: true, show: isCurve('avx-nbo'),
        options: Object.entries(TANT_AVX.nbo).map(([value, x]) => ({ value, label: `${value}: ${x.base} %/1000 h, rated to ${x.tMax} °C` })),
      },
      { key: 'capacitance', label: 'Capacitance', unit: 'µF', type: 'number', min: 0, step: 'any', required: true, show: isCurve('kemet-polymer') },
      { key: 'v', label: 'Applied voltage', unit: 'V', type: 'number', min: 0, step: 'any', required: true, help: 'DC plus peak ripple.' },
      { key: 'vr', label: 'Rated voltage V_R', unit: 'V', type: 'number', min: 0, step: 'any', required: true, show: isCurve('kemet-polymer', 'nasa-polymer', 'vishay-mno2', 'avx-tantalum', 'avx-nbo') },
      {
        key: 'rate', label: 'Maker\'s failure rate', unit: '%/1000 h', type: 'number', min: 0, step: 'any', required: true, show: isCurve('nasa-polymer', 'avx-tantalum'),
        help: (p) => RATE_HELP[p.curve] ?? '',
      },
      { key: 'refV', label: 'Rate stated at voltage', unit: 'V', type: 'number', min: 0, step: 'any', required: true, show: isCurve('nasa-polymer'), help: 'Usually the rated voltage; KEMET states its rate at the category voltage.' },
      { key: 'refT', label: 'Rate stated at temperature', unit: '°C', type: 'number', step: 'any', required: true, show: isCurve('nasa-polymer') },
      {
        key: 'rs', label: 'Series resistance per volt', unit: 'Ω/V', type: 'number', min: 0, step: 'any', required: true, show: isCurve('kemet-polymer', 'avx-tantalum', 'avx-nbo'),
        help: (p) => (p.curve === 'kemet-polymer'
          ? 'Resistance in series with the capacitor, divided by the applied voltage. MIL-HDBK-217F\'s bands give π_SR 3.3 up to 0.1 Ω/V, falling to 0.66 above 0.8 Ω/V. 0.1 if unknown.'
          : 'Resistance in series with the capacitor, divided by the applied voltage. AVX recommends 1 Ω/V; its table runs from 0.1 to 3 Ω/V, and outside it the nearer end is used. 0.1 if unknown.'),
      },
      riseField,
    ],
    describe: (p) => TANT_CURVES[p.curve]?.describe ?? 'Tantalum capacitor, maker\'s model',
    compute(p, prof) {
      const rise = p.rise || 0;
      const v = p.v || 0;
      const tempOf = (ph) => ph.tac + rise;
      const errors = [];
      const ready = (...keys) => keys.every((k) => isNum(p[k]));
      if (p.curve === 'kemet-polymer') {
        const { capacitance, vr, rs } = p;
        const ok = ready('capacitance', 'v', 'vr', 'rs') && vr > 0 && capacitance > 0;
        if (ready('v', 'vr') && v > vr) errors.push('The applied voltage is above the rated voltage.');
        const i = Math.max(0, ENVIRONMENTS.findIndex((e) => e.id === prof.env217f));
        const env = { id: ENVIRONMENTS[i].id, piE: CAPACITORS_217F.piE[i] };
        const s = ok ? v / vr : 0;
        const at = (t) => kemetPolymerFit({ capacitance, s, rs, t, piE: env.piE });
        const w = weighted(prof, (t) => {
          if (!ok) return { fit: 0, factor: 0 };
          const r = at(t);
          return { fit: r.fit, factor: r.piT };
        }, tempOf);
        const f = ok ? at(25) : null;
        const t217 = CAPACITORS_217F;
        return {
          fit: w.fit,
          parts: [['Operating', w.fit]],
          values: [
            ['λ_b', fmtE(CWR.lb), 'MIL-HDBK-217F style CWR, failures per 10⁶ h'],
            ['π_T', `exp{−${t217.ea[CWR.t]}/k × [1/(T + 273) − 1/298]}`, `per phase, below; T read as ${TANT_KEMET.tRoom} °C when cooler`],
            ['π_C', ok ? fmtE(f.piC) : '—', `C^${t217.capExponent[CWR.c]}, C = ${ok ? fmtE(capacitance) : '—'} µF`],
            ['π_V', ok ? fmtE(f.piV) : '—', `(S/${TANT_KEMET.vRef})^${t217.voltage[CWR.v][1]} + 1, S = V/V_R = ${ok ? fmtE(s) : '—'} (KEMET; 217F uses 0.6)`],
            ['π_SR', ok ? fmtE(f.piSR) : '—', `R = ${ok ? fmtE(rs) : '—'} Ω/V`],
            ['π_Q', fmtE(TANT_KEMET.piQ), '√0.5, for KEMET\'s 0.5 %/1000 h'],
            ['π_E', fmtE(env.piE), `environment ${env.id}`],
            ['Σ λ·τ_i / (τ_on + τ_off)', fmtE(w.fit), 'FIT'],
          ],
          operating: w.rows,
          cycling: [],
          tempLabel: 'T',
          operatingLabel: 'π_T',
          errors,
        };
      }
      if (p.curve === 'vishay-mno2') {
        const vr = p.vr;
        const ok = ready('v', 'vr') && vr > 0;
        const u = ok ? v / vr : 0;
        const base = TANT_VISHAY.base * FIT_PER_PCT;
        const w = weighted(prof, (t) => {
          const f = ok ? vishayFactor(t, u) : 0;
          return { fit: base * f, factor: f };
        }, tempOf);
        if (ok) {
          const over = w.rows.filter((r) => r.t <= TANT_VISHAY.tMax && u > tantalumLimit(r.t) + 1e-9).map((r) => r.phase + 1);
          if (over.length) errors.push(`In working phase ${over.join(', ')} the voltage is above the rating (V_R up to 85 °C, falling to 2/3 V_R at 125 °C).`);
        }
        const tooHot = w.rows.filter((r) => r.t > TANT_VISHAY.tMax).map((r) => r.phase + 1);
        if (tooHot.length) errors.push(`Working phase ${tooHot.join(', ')} runs above 125 °C, beyond Vishay's chart.`);
        return {
          fit: w.fit,
          parts: [['Operating', w.fit]],
          values: [
            ['Base rate', `${TANT_VISHAY.base} %/1000 h = ${fmtE(base)} FIT`, 'at 85 °C, V_R and 1 Ω/V of series resistance'],
            ['V/V_R', ok ? fmtE(u) : '—', u > 0 && u < TANT_VISHAY.uMin ? `read as ${TANT_VISHAY.uMin}, the chart's lowest` : ''],
            ['F', `10^(${TANT_VISHAY.a} + ${TANT_VISHAY.b}·T + ${TANT_VISHAY.c}·V/V_R)`, `per phase, below; T read as ${TANT_VISHAY.tMin} °C when cooler`],
            ['Σ λ·τ_i / (τ_on + τ_off)', fmtE(w.fit), 'FIT; λ = base rate × F'],
          ],
          operating: w.rows,
          cycling: [],
          tempLabel: 'T',
          operatingLabel: 'F',
          errors,
        };
      }
      if (p.curve === 'avx-tantalum' || p.curve === 'avx-nbo') {
        const nbo = p.curve === 'avx-nbo';
        const series = nbo ? TANT_AVX.nbo[p.series] : null;
        const family = nbo ? p.series : 'tantalum';
        const { vr, rs } = p;
        const ok = ready('v', 'vr', 'rs') && vr > 0 && (nbo ? !!series : ready('rate'));
        const u = ok ? v / vr : 0;
        const fb = nbo ? series?.base : p.rate;
        const base = (fb || 0) * FIT_PER_PCT;
        const f = ok ? avxFactors({ t: 85, u, r: rs, family }) : null;
        const w = weighted(prof, (t) => {
          if (!ok) return { fit: 0, factor: 0 };
          const factor = f.v * f.r * avxFactors({ t, u, r: rs, family }).t;
          return { fit: base * factor, factor };
        }, tempOf);
        const tMax = nbo ? series?.tMax : TANT_AVX.tMax;
        if (ok) {
          const limit = (t) => (nbo ? interp(t, series.limit) : tantalumLimit(t));
          const rating = nbo ? `V_R up to 85 °C, about 2/3 V_R at 105 °C${p.series === 'NOS' ? ' and 1/2 V_R at 125 °C' : ''}` : 'V_R up to 85 °C, falling to 2/3 V_R at 125 °C';
          const over = w.rows.filter((r) => r.t <= tMax && u > limit(r.t) + 1e-9).map((r) => r.phase + 1);
          if (over.length) errors.push(`In working phase ${over.join(', ')} the voltage is above the rating (${rating}).`);
        }
        if (isNum(tMax)) {
          const tooHot = w.rows.filter((r) => r.t > tMax).map((r) => r.phase + 1);
          if (tooHot.length) errors.push(`Working phase ${tooHot.join(', ')} runs above ${tMax} °C, ${nbo ? `the top of ${p.series}'s rating` : 'the standard tantalum rating'}.`);
        }
        const { fv, fr } = TANT_AVX;
        const rNote = !ok ? '' : rs < fr[0][0] ? `, read as ${fr[0][0]}: AVX gives no factor below it` : rs > fr[fr.length - 1][0] ? `, read as ${fr[fr.length - 1][0]}, the table's end` : '';
        return {
          fit: w.fit,
          parts: [['Operating', w.fit]],
          values: [
            ['Base rate F_B', `${fmtE(fb ?? 0)} %/1000 h = ${fmtE(base)} FIT`, `at 85 °C, V_R and 0.1 Ω/V of series resistance${nbo && series ? ` (${p.series})` : ''}`],
            ['F_V', ok ? fmtE(f.v) : '—', `10^(${fv.a} + ${fv.b}·V/V_R), V/V_R = ${ok ? fmtE(u) : '—'}${ok && u < fv.uMin ? `, read as ${fv.uMin}, the chart's start` : ''}`],
            ['F_R', ok ? fmtE(f.r) : '—', `AVX's table, R = ${ok ? fmtE(rs) : '—'} Ω/V${rNote}`],
            ['F_T', `AVX's ${nbo ? (p.series ?? '—') : 'tantalum'} curve`, 'per phase, below; read as 20 °C when cooler'],
            ['Σ λ·τ_i / (τ_on + τ_off)', fmtE(w.fit), 'FIT; λ = F_B × F, F = F_V × F_R × F_T'],
          ],
          operating: w.rows,
          cycling: [],
          tempLabel: 'T',
          operatingLabel: 'F',
          errors,
        };
      }
      if (p.curve === 'nasa-polymer') {
        const { vr, refV, refT } = p;
        const ok = ready('v', 'vr', 'rate', 'refV', 'refT') && vr > 0;
        const base = (p.rate || 0) * FIT_PER_PCT;
        if (ready('v', 'vr') && v > vr) errors.push('The applied voltage is above the rated voltage.');
        const w = weighted(prof, (t) => {
          if (!ok) return { fit: 0, factor: 0 };
          const af = expFactor({ b: TANT_NASA.b, ea: TANT_NASA.ea, u: v / vr, uRef: refV / vr, t, tRef: refT });
          return { fit: base / af, factor: 1 / af };
        }, tempOf);
        return {
          fit: w.fit,
          parts: [['Operating', w.fit]],
          values: [
            ['Maker\'s rate', `${fmtE(p.rate ?? 0)} %/1000 h = ${fmtE(base)} FIT`, `at ${fmtE(refV ?? 0)} V and ${fmtE(refT ?? 0)} °C`],
            ['Voltage factor', ok ? fmtE(Math.exp(TANT_NASA.b * (refV - v) / vr)) : '—', `exp[${TANT_NASA.b}·(u_ref − u)], u = V/V_R = ${ok ? fmtE(v / vr) : '—'}; NASA's limit for chip parts is 0.6`],
            ['Temperature factor', `exp{${TANT_NASA.ea}/k × [1/(273 + T) − 1/(273 + T_ref)]}`, 'per phase, below; NASA\'s limit is 85 °C case'],
            ['Σ λ·τ_i / (τ_on + τ_off)', fmtE(w.fit), 'FIT; λ = maker\'s rate ÷ (voltage factor × temperature factor)'],
          ],
          operating: w.rows,
          cycling: [],
          tempLabel: 'T',
          operatingLabel: 'λ/λ_maker',
          errors,
        };
      }
      return { fit: 0, parts: [['Operating', 0]], values: [], operating: [], cycling: [], errors };
    },
  },

  'ceramic-test': {
    label: 'Ceramic capacitor, maker\'s life test',
    group: 'Vendor data',
    clause: 'Maker\'s qualification life test',
    status: `Turns a maker's qualification life test into a rate: the ${MLCC_BOUND.confidence * 100} % upper bound on the failures seen, divided by the device-hours and by the acceleration from use to test conditions, (V_test/V)^n and Arrhenius. The method is published by Murata, Samsung, Knowles, AVX and NASA. Flex cracking is not included; large chips are flagged under Surface-mount solder joints.`,
    defaults: { note: '', electrode: null, n: null, ea: null, hours: null, failures: null, vTest: null, tTest: null, v: null, rise: 0 },
    fields: [
      { key: 'note', label: 'Part and source', type: 'text', wide: true },
      {
        key: 'electrode', label: 'Electrodes', type: 'select', required: true, wide: true,
        options: [
          { value: 'pme', label: `Precious metal (PME): n = ${MLCC_PME.n}, E_a = ${MLCC_PME.ea.toFixed(1)} eV` },
          { value: 'entered', label: 'Base metal (nickel, BME), or the maker\'s own n and E_a' },
        ],
        help: 'Most ceramic capacitors made today have base-metal electrodes; their constants vary too much between studies for a default.',
      },
      {
        key: 'n', label: 'Voltage exponent n', type: 'number', min: 0, step: 'any', required: true, show: (p) => p.electrode === 'entered',
        help: 'Published for base-metal parts: 2.1–2.5 (six makers testing one part, NIMS), 4–9 (NASA). A smaller value gives a higher, more cautious rate.',
      },
      {
        key: 'ea', label: 'Activation energy E_a', unit: 'eV', type: 'number', min: 0, step: 'any', required: true, show: (p) => p.electrode === 'entered',
        help: 'Published for base-metal parts: 1.2–1.3 eV (NIMS), 1.0–1.8 eV (NASA). A smaller value gives a higher, more cautious rate.',
      },
      { key: 'hours', label: 'Device-hours on test', unit: 'h', type: 'number', min: 0, step: 'any', required: true, help: 'Parts tested × hours each: 77 parts for 1000 h is 77,000.' },
      { key: 'failures', label: 'Failures in the test', type: 'number', min: 0, step: 1, required: true },
      { key: 'vTest', label: 'Test voltage', unit: 'V', type: 'number', min: 0, step: 'any', required: true, help: 'Often 1.5 or 2 × the rated voltage.' },
      { key: 'tTest', label: 'Test temperature', unit: '°C', type: 'number', step: 'any', required: true, help: 'Often 125 °C; 85 °C for X5R.' },
      { key: 'v', label: 'Applied voltage', unit: 'V', type: 'number', min: 0, step: 'any', required: true, help: 'DC plus peak AC.' },
      riseField,
    ],
    describe: (p) => p.note || 'Ceramic capacitor, maker\'s life test',
    compute(p, prof) {
      const errors = [];
      const pme = p.electrode === 'pme';
      const n = pme ? MLCC_PME.n : p.n;
      const ea = pme ? MLCC_PME.ea : p.ea;
      const { hours, failures, vTest, tTest, v } = p;
      if (isNum(hours) && !(hours > 0)) errors.push('The device-hours must be above 0.');
      if (isNum(failures) && (failures < 0 || !Number.isInteger(failures))) errors.push('The failure count must be a whole number.');
      if (isNum(v) && !(v > 0)) errors.push('The applied voltage must be above 0 V.');
      const ok = !errors.length && [n, ea, hours, failures, vTest, tTest, v].every(isNum);
      const m = ok ? failureBound(failures) : 0;
      const testFit = ok ? (m / hours) * 1e9 : 0;
      const rise = p.rise || 0;
      const w = weighted(prof, (t) => {
        if (!ok) return { fit: 0, factor: 0 };
        const af = mlccFactor({ vTest, v, tTest, t, n, ea });
        return { fit: testFit / af, factor: af };
      }, (ph) => ph.tac + rise);
      return {
        fit: w.fit,
        parts: [['Operating', w.fit]],
        values: [
          ['Failures counted', ok ? fmtE(m) : '—', ok ? `χ²(${MLCC_BOUND.confidence}, ${2 * failures + 2})/2 for ${failures} seen` : ''],
          ['Rate at test conditions', ok ? `${fmtE(testFit)} FIT` : '—', ok ? `at ${fmtE(vTest)} V and ${fmtE(tTest)} °C` : ''],
          ['Voltage factor', ok ? fmtE((vTest / v) ** n) : '—', `(V_test/V)^n, n = ${isNum(n) ? fmtE(n) : '—'}`],
          ['AF', `voltage factor × exp{E_a/k × [1/(T + 273.15) − 1/(T_test + 273.15)]}`, `E_a = ${isNum(ea) ? fmtE(ea) : '—'} eV; per phase, below`],
          ['Σ λ·τ_i / (τ_on + τ_off)', fmtE(w.fit), 'FIT; λ = rate at test conditions ÷ AF'],
        ],
        operating: w.rows,
        cycling: [],
        tempLabel: 'T',
        operatingLabel: 'AF',
        errors,
      };
    },
  },
};
