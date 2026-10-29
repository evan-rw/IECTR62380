// IEC TR 62380:2004 failure-rate models. Pure functions, no DOM access, so
// the same code runs in the page and under `node --test`.
//
// All failure rates are in FIT (failures per 10^9 hours of calendar time:
// dormant phases are part of the mission profile, not excluded from it).

import {
  EA, IC_FAMILIES, IC_PACKAGES, CTE_SUBSTRATES, CTE_PACKAGES, EOS,
  DISCRETE_PACKAGES, DIODES, TRANSISTORS, CAPACITORS, RESISTORS, INDUCTORS, MISSION_PROFILES,
} from './tables.js';
import { ENVIRONMENTS } from './tables217f.js';
import { VENDOR_MTBF } from './tablesmaker.js';
import { MODELS_217F } from './models217f.js';
import { MODELS_MAKER } from './modelsmaker.js';

// Coefficient of the solder-joint / package thermal-cycling term.
export const PACKAGE_K = 2.75e-3;

// Influence of the annual number of thermal cycles.
export function piN(n) {
  if (!(n > 0)) return 0;
  return n <= 8760 ? n ** 0.76 : 1.7 * n ** 0.6;
}

// Arrhenius temperature factor; ea is Ea/k in kelvin, tRef in kelvin.
export function piT(tC, ea, tRef) {
  return Math.exp(ea * (1 / tRef - 1 / (273 + tC)));
}

// Influence of the expansion mismatch between board and package (ppm/°C).
export function piAlpha(alphaS, alphaC) {
  return 0.06 * Math.abs(alphaS - alphaC) ** 1.68;
}

export function lambda3(row, { pins, diagonal }) {
  switch (row.kind) {
    case 'linear': return row.offset + row.coef * pins;
    case 'pins': return row.coef * pins ** row.exp;
    case 'fixed': return row.value;
    case 'diagonal': return row.coef * diagonal ** row.exp;
    default: throw new Error(`unknown package kind ${row.kind}`);
  }
}

export function byId(table, id) {
  return table.rows.find((r) => r.id === id) ?? table.rows[0];
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const orTable = (override, tableValue) => (isNum(override) ? override : tableValue);

// ---------------------------------------------------------------------------
// Mission profile

export function normaliseProfile(profile) {
  const phases = profile.phases.map((p) => ({
    name: p.name ?? '',
    tac: Number(p.tac) || 0,
    tau: Number(p.tau) || 0,
    n: Number(p.n) || 0,
    dT: Number(p.dT) || 0,
    addRise: Boolean(p.addRise),
  }));
  const tauOn = phases.reduce((s, p) => s + p.tau, 0);
  const tauOff = isNum(profile.tauOff) ? profile.tauOff : Math.max(0, 1 - tauOn);
  // Operating environment for the MIL-HDBK-217F models (ground, benign by default).
  return { phases, tauOn, tauOff, env217f: profile.env217f ?? 'GB' };
}

// Each problem with the phase-table cells it concerns ([phase index, key]), so the
// page can mark those cells and take the user to them.
export function profileIssues(profile) {
  const prof = normaliseProfile(profile);
  const out = [];
  if (prof.phases.length === 0) out.push({ text: 'Add at least one phase.', cells: [] });
  prof.phases.forEach((p, i) => {
    if (p.tau < 0) out.push({ text: `Phase ${i + 1}: the working time ratio τ is negative.`, cells: [[i, 'tau']] });
  });
  // t_ac only matters in working phases; a blank one there would silently read as 0 °C.
  profile.phases.forEach((p, i) => {
    if (Number(p.tau) > 0 && (p.tac == null || p.tac === '')) out.push({ text: `Phase ${i + 1} is a working phase but has no t_ac.`, cells: [[i, 'tac']] });
  });
  prof.phases.forEach((p, i) => {
    const bad = ['n', 'dT'].filter((k) => p[k] < 0);
    if (bad.length) out.push({ text: `Phase ${i + 1}: ${bad.map((k) => (k === 'n' ? 'the cycle count n' : 'the amplitude ΔT')).join(' and ')} cannot be negative.`, cells: bad.map((k) => [i, k]) });
  });
  if (prof.tauOn > 1 + 1e-9) {
    out.push({ text: `The working time ratios add up to ${prof.tauOn.toFixed(3)}, more than 1.`, cells: prof.phases.flatMap((p, i) => (p.tau > 0 ? [[i, 'tau']] : [])) });
  }
  if (prof.tauOn + prof.tauOff <= 0) out.push({ text: 'τ_on + τ_off is zero.', cells: prof.phases.map((p, i) => [i, 'tau']) });
  return out;
}

export const profileProblems = (profile) => profileIssues(profile).map((x) => x.text);

// Σ π_t(t_i)·τ_i / (τ_on + τ_off) over the working phases.
function operatingSum(prof, tempOf, ea, tRef) {
  const denom = prof.tauOn + prof.tauOff;
  let total = 0;
  const rows = [];
  prof.phases.forEach((ph, i) => {
    if (!(ph.tau > 0)) return;
    const t = tempOf(ph);
    const pt = piT(t, ea, tRef);
    total += pt * ph.tau;
    rows.push({ phase: i, t, piT: pt, tau: ph.tau });
  });
  return { value: denom > 0 ? total / denom : 0, rows };
}

// Σ π_n(n_i)·ΔT_i^0.68 over every phase. ΔT_i adds a third of the part's own
// temperature rise on phases flagged addRise (the "ΔTj/3 +" table entries).
function cyclingSum(prof, rise) {
  let total = 0;
  const rows = [];
  prof.phases.forEach((ph, i) => {
    const dT = ph.dT + (ph.addRise ? rise / 3 : 0);
    const pn = piN(ph.n);
    const term = dT > 0 ? pn * dT ** 0.68 : 0;
    total += term;
    rows.push({ phase: i, n: ph.n, piN: pn, dT, term });
  });
  return { value: total, rows };
}

// ---------------------------------------------------------------------------
// Field helpers shared by the model definitions

const options = (table, labelOf = (r) => r.label) =>
  table.rows.map((r) => ({ value: r.id, label: labelOf(r), group: r.group }));

const eosField = {
  key: 'eos', label: 'Interface (electrical overstress)', type: 'select', options: options(EOS, (r) => (r.fit ? `${r.label}: ${r.fit} FIT` : r.label)),
  help: 'Choose an application only for a part connected to lines that leave the equipment.',
};

const thermalFields = [
  { key: 'power', label: 'Dissipated power P', unit: 'W', type: 'number', min: 0, step: 'any', required: true },
  { key: 'rja', label: 'Thermal resistance R_JA', unit: '°C/W', type: 'number', min: 0, step: 'any', required: true, help: 'Junction to ambient, mounted. ΔT_j = R_JA × P.' },
];

// A field is required when `required` is true, or a function of the
// parameters that returns true; hidden fields are never required.
export function fieldLabel(f, p) {
  return typeof f.label === 'function' ? f.label(p) : f.label;
}

export function missingFields(model, p) {
  return model.fields.filter((f) => {
    if (f.show && !f.show(p)) return false;
    const required = typeof f.required === 'function' ? f.required(p) : f.required;
    return required && (p[f.key] == null || p[f.key] === '');
  });
}

const fmtE = (x) => (x === 0 ? '0' : Math.abs(x) >= 0.01 && Math.abs(x) < 1e5 ? String(+x.toPrecision(4)) : x.toExponential(3));

// ---------------------------------------------------------------------------
// A maker's MTBF (or FIT) for a module or power supply, kept with its method, environment
// and temperature. Never converted between methods or environments (VENDOR_MTBF).

const MTBF_STATISTICS = [
  { value: 'mean', label: 'One predicted figure (a mean)' },
  { value: 'bound', label: 'An upper bound at a stated confidence' },
  { value: 'demonstrated', label: 'Demonstrated in a test, or from field data' },
];
const MTBF_POINTS = [
  { value: 'ambient', label: 'Ambient air' },
  { value: 'case', label: 'Case or baseplate' },
  { value: 'board', label: 'Circuit board (T_pcb)' },
  { value: 'unstated', label: 'No temperature stated' },
];
const envLabel = (id) => ENVIRONMENTS.find((e) => e.id === id)?.label ?? id;
const isMtbf = (p) => p.method === 'mtbf';
const mtbfScaled = (p) => isMtbf(p) && p.refPoint != null && p.refPoint !== 'unstated';
const mtbfSecond = (p) => (p.rateUnit === 'fit' ? p.statedFit2 : p.mtbfHours2);

function vendorMtbf(p, prof) {
  const k = 8.617e-5;
  const errors = [];
  const notices = [];
  const perFit = p.rateUnit === 'fit';
  const toFit = (x) => (perFit ? x : 1e9 / x);
  const stated = perFit ? p.statedFit : p.mtbfHours;
  const second = mtbfSecond(p);
  const scaled = mtbfScaled(p);
  if (isNum(stated) && !(stated > 0)) errors.push('The stated figure must be above 0.');
  // The temperature law: fitted from a second figure on the same data sheet, or the entered E_a.
  let ea = p.moduleEa;
  let fitted = false;
  if (scaled && isNum(second) && isNum(stated) && stated > 0 && isNum(p.tStated) && isNum(p.tStated2)) {
    if (!(second > 0)) errors.push('The second figure must be above 0.');
    else if (p.tStated2 === p.tStated) errors.push('The two figures need different temperatures.');
    else {
      ea = (k * Math.log(toFit(second) / toFit(stated))) / (1 / (p.tStated + 273.15) - 1 / (p.tStated2 + 273.15));
      fitted = true;
      if (!(ea >= 0)) errors.push('The two figures do not get worse with temperature; check them.');
    }
  }
  const ok = !errors.length && isNum(stated) && (!scaled || (isNum(p.tStated) && isNum(ea)));
  const base = ok ? toFit(stated) : 0;
  const rise = p.refPoint === 'case' || p.refPoint === 'board' ? p.pointRise || 0 : 0;
  const denom = prof.tauOn + prof.tauOff;
  let total = 0;
  const rows = [];
  prof.phases.forEach((ph, i) => {
    if (!(ph.tau > 0)) return;
    const t = ph.tac + rise;
    const factor = ok && scaled ? Math.exp((ea / k) * (1 / (p.tStated + 273.15) - 1 / (t + 273.15))) : 1;
    total += factor * ph.tau;
    rows.push({ phase: i, t, piT: factor, tau: ph.tau });
  });
  const weight = denom > 0 ? total / denom : 0;
  if (p.statedEnv && p.statedEnv !== 'unstated' && p.statedEnv !== prof.env217f) {
    notices.push(`Stated for ${envLabel(p.statedEnv)}; this board is ${envLabel(prof.env217f)}. The figure is not converted: makers' own figures put ground, fixed at 1.7–2× and ground, mobile at 3–9× the ground, benign rate.`);
  }
  const method = VENDOR_MTBF.methods.find((m) => m.id === p.predMethod)?.label ?? '—';
  const env = p.statedEnv === 'unstated' ? 'environment not stated' : p.statedEnv ? envLabel(p.statedEnv) : '—';
  const statistic = p.statistic === 'bound' ? `an upper bound at ${isNum(p.confidence) ? fmtE(p.confidence) : '—'} % confidence, used as stated`
    : p.statistic === 'demonstrated' ? 'demonstrated' : 'one predicted figure';
  const point = MTBF_POINTS.find((o) => o.value === p.refPoint)?.label.toLowerCase() ?? '—';
  return {
    fit: base * weight,
    parts: [['Rescaled', base * weight]],
    values: [
      ['Stated', !ok ? '—' : perFit ? `${fmtE(stated)} FIT` : `MTBF ${fmtE(stated)} h = ${fmtE(base)} FIT`, `${method}; ${env}; ${statistic}`],
      ['Temperature law', !scaled ? 'none: no temperature stated, so the figure is used as it is'
        : `E_a = ${isNum(ea) ? fmtE(ea) : '—'} eV${fitted ? ', fitted from the two figures' : ''}`,
      scaled ? `at ${point} ${isNum(p.tStated) ? fmtE(p.tStated) : '—'} °C${rise ? `; that point runs ${fmtE(rise)} °C above board ambient here` : ''}` : ''],
      ['Σ AF·τ_i / (τ_on + τ_off)', fmtE(weight), 'AF = exp{E_a/k × [1/(T_ref + 273.15) − 1/(T + 273.15)]}'],
    ],
    operating: rows,
    cycling: [],
    tempLabel: 'T',
    operatingLabel: 'AF',
    errors,
    notices,
  };
}

// ---------------------------------------------------------------------------
// Models. Each has a field list the UI renders, defaults, and compute(p, prof)
// returning { fit, parts, values, operating, cycling, errors }.

export const MODELS = {
  ic: {
    label: 'Integrated circuit',
    clause: '7',
    status: 'The formula matches the one published in TI SLOA294A. Coefficients are from Kicad-Space-Reliability and have not been checked against the standard.',
    defaults: {
      family: 'mos-digital', count: null, year: new Date().getFullYear(),
      power: null, rja: null, package: 'pqfp-10', pins: null, bodyW: null, bodyL: null,
      substrate: 'fr4', alphaS: null, pkgMaterial: 'plastic', alphaC: null, eos: 'none',
      l1Override: null, l2Override: null, l3Override: null,
    },
    fields: [
      { key: 'family', label: 'Family', type: 'select', options: options(IC_FAMILIES), wide: true, required: true },
      {
        key: 'count', type: 'number', min: 0, step: 'any', required: true,
        label: (p) => (p.family ? `Size, in ${byId(IC_FAMILIES, p.family).unit}` : 'Size (choose a family first)'),
        help: (p) => {
          if (!p.family) return 'The unit depends on the family.';
          const f = byId(IC_FAMILIES, p.family);
          return isNum(p.count)
            ? `N = ${f.nPer} × ${f.unit} = ${fmtE(p.count * f.nPer)} transistors.`
            : `N = ${f.nPer} × ${f.unit}. An estimate is fine: for recent parts the per-transistor term is small next to λ2.`;
        },
      },
      { key: 'year', label: 'Year of manufacture', type: 'number', step: 1, required: true, help: 'a = year − 1998; the per-transistor term falls as e^(−0.35a).' },
      ...thermalFields,
      { key: 'package', label: 'Package', type: 'select', options: options(IC_PACKAGES), wide: true, required: true },
      { key: 'pins', label: 'Pin count S', type: 'number', min: 1, step: 1, required: (p) => !isNum(p.l3Override), show: (p) => p.package && ['pins', 'linear'].includes(byId(IC_PACKAGES, p.package).kind) },
      { key: 'bodyW', label: 'Body width', unit: 'mm', type: 'number', min: 0, step: 'any', required: (p) => !isNum(p.l3Override), show: (p) => p.package && byId(IC_PACKAGES, p.package).kind === 'diagonal' },
      { key: 'bodyL', label: 'Body length', unit: 'mm', type: 'number', min: 0, step: 'any', required: (p) => !isNum(p.l3Override), show: (p) => p.package && byId(IC_PACKAGES, p.package).kind === 'diagonal' },
      { key: 'substrate', label: 'Board substrate α_S', unit: 'ppm/°C', type: 'select', required: true, options: [...options(CTE_SUBSTRATES, (r) => `${r.label} (${r.alpha})`), { value: 'custom', label: 'Other (enter α_S)' }] },
      { key: 'alphaS', label: 'α_S', unit: 'ppm/°C', type: 'number', step: 'any', required: true, show: (p) => p.substrate === 'custom' },
      { key: 'pkgMaterial', label: 'Package material α_C', unit: 'ppm/°C', type: 'select', required: true, options: [...options(CTE_PACKAGES, (r) => `${r.label} (${r.alpha})`), { value: 'custom', label: 'Other (enter α_C)' }] },
      { key: 'alphaC', label: 'α_C', unit: 'ppm/°C', type: 'number', step: 'any', required: true, show: (p) => p.pkgMaterial === 'custom' },
      { ...eosField, wide: true },
      { key: 'l1Override', label: 'λ1 override', unit: 'FIT', type: 'number', step: 'any', optional: true, advanced: true },
      { key: 'l2Override', label: 'λ2 override', unit: 'FIT', type: 'number', step: 'any', optional: true, advanced: true },
      { key: 'l3Override', label: 'λ3 override', unit: 'FIT', type: 'number', step: 'any', optional: true, advanced: true },
    ],
    describe: (p) => [p.family && byId(IC_FAMILIES, p.family).label, p.package && byId(IC_PACKAGES, p.package).label].filter(Boolean).join(', ') || 'Integrated circuit',
    compute(p, prof) {
      const fam = byId(IC_FAMILIES, p.family);
      const pkg = byId(IC_PACKAGES, p.package);
      const l1 = orTable(p.l1Override, fam.l1);
      const l2 = orTable(p.l2Override, fam.l2);
      const N = (p.count || 0) * fam.nPer;
      const a = Math.max(0, (p.year || 1998) - 1998);
      const dieBase = l1 * N * Math.exp(-0.35 * a) + l2;
      const dTj = (p.rja || 0) * (p.power || 0);
      const op = operatingSum(prof, (ph) => ph.tac + dTj, fam.ea, fam.tRef);
      const die = dieBase * op.value;

      // Missing inputs are reported by missingFields(); compute what we can.
      let l3 = p.l3Override;
      let diagonal = null;
      if (!isNum(l3)) {
        if (pkg.kind === 'diagonal' && p.bodyW > 0 && p.bodyL > 0) diagonal = Math.hypot(p.bodyW, p.bodyL);
        const ready = pkg.kind === 'fixed' || (pkg.kind === 'diagonal' ? diagonal != null : p.pins > 0);
        l3 = ready ? lambda3(pkg, { pins: p.pins, diagonal }) : 0;
      }
      const alphaS = p.substrate === 'custom' ? p.alphaS : byId(CTE_SUBSTRATES, p.substrate).alpha;
      const alphaC = p.pkgMaterial === 'custom' ? p.alphaC : byId(CTE_PACKAGES, p.pkgMaterial).alpha;
      const pa = isNum(alphaS) && isNum(alphaC) ? piAlpha(alphaS, alphaC) : 0;
      const cyc = cyclingSum(prof, dTj);
      const pkgFit = PACKAGE_K * pa * cyc.value * l3;
      const eos = byId(EOS, p.eos).fit;

      return {
        fit: die + pkgFit + eos,
        parts: [['Die', die], ['Package', pkgFit], ['Overstress', eos]],
        values: [
          ['λ1', fmtE(l1), isNum(p.l1Override) ? 'override' : 'Kicad-Space-Reliability'],
          ['λ2', fmtE(l2), isNum(p.l2Override) ? 'override' : 'Kicad-Space-Reliability'],
          ['N', fmtE(N), `${fam.nPer} per ${fam.unit.replace(/s$/, '')}`],
          ['a', String(a), 'year − 1998'],
          ['λ1·N·e^(−0.35a) + λ2', fmtE(dieBase), 'FIT'],
          ['ΔT_j', fmtE(dTj), '°C = R_JA × P'],
          ['π_t reference', `${fam.tRef} K, A = ${fam.ea}`, 'π_t = exp{A × [1/T_ref − 1/(273 + t_j)]}'],
          ['Σ π_t·τ_i / (τ_on + τ_off)', fmtE(op.value), ''],
          ...(diagonal ? [['D', fmtE(diagonal), 'mm']] : []),
          ['λ3', fmtE(l3), isNum(p.l3Override) ? 'override' : 'Kicad-Space-Reliability'],
          ['π_α', fmtE(pa), `0.06 × |${alphaS} − ${alphaC}|^1.68`],
          ['Σ π_n·ΔT_i^0.68', fmtE(cyc.value), ''],
          ['Package', fmtE(pkgFit), 'FIT = 2.75×10⁻³ × π_α × Σ × λ3'],
          ['λ_EOS', fmtE(eos), 'FIT'],
        ],
        operating: op.rows,
        cycling: cyc.rows,
        tempLabel: 't_j',
        errors: [],
      };
    },
  },

  diode: {
    label: 'Diode',
    clause: '8.2–8.3',
    status: 'Model structure (π_U·λ0·Σπ_t + 2.75×10⁻³·Σπ_n·ΔT^0.68·λ_B + λ_EOS) and coefficients are from Kicad-Space-Reliability and have not been checked against the standard.',
    defaults: { type: 'signal', piU: 1, power: null, rja: null, package: 'sod123', eos: 'none', l0Override: null, lbOverride: null },
    fields: [
      { key: 'type', label: 'Type', type: 'select', options: options(DIODES), wide: true, required: true },
      { key: 'piU', label: 'Use factor π_U', type: 'number', min: 0, step: 'any', required: true, help: '1 unless the standard gives another value for this use.' },
      ...thermalFields,
      { key: 'package', label: 'Package', type: 'select', required: (p) => !isNum(p.lbOverride), options: options(DISCRETE_PACKAGES, (r) => `${r.label}: λ_B ${r.lb}`) },
      eosField,
      { key: 'l0Override', label: 'λ0 override', unit: 'FIT', type: 'number', step: 'any', optional: true, advanced: true },
      { key: 'lbOverride', label: 'λ_B override', unit: 'FIT', type: 'number', step: 'any', optional: true, advanced: true },
    ],
    describe: (p) => [p.type && byId(DIODES, p.type).label, p.package && byId(DISCRETE_PACKAGES, p.package).label].filter(Boolean).join(', ') || 'Diode',
    compute(p, prof) {
      const row = byId(DIODES, p.type);
      const l0 = orTable(p.l0Override, row.l0);
      const lb = orTable(p.lbOverride, byId(DISCRETE_PACKAGES, p.package).lb);
      const piU = isNum(p.piU) ? p.piU : 1;
      const dTj = (p.rja || 0) * (p.power || 0);
      const op = operatingSum(prof, (ph) => ph.tac + dTj, EA.BIPOLAR, 313);
      const die = piU * l0 * op.value;
      const cyc = cyclingSum(prof, dTj);
      const pkgFit = PACKAGE_K * cyc.value * lb;
      const eos = byId(EOS, p.eos).fit;
      return {
        fit: die + pkgFit + eos,
        parts: [['Die', die], ['Package', pkgFit], ['Overstress', eos]],
        values: [
          ['λ0', fmtE(l0), isNum(p.l0Override) ? 'override' : row.group],
          ['π_U', fmtE(piU), ''],
          ['ΔT_j', fmtE(dTj), '°C = R_JA × P'],
          ['π_t reference', '313 K, A = 4640', 'π_t = exp{4640 × [1/313 − 1/(273 + t_j)]}'],
          ['Σ π_t·τ_i / (τ_on + τ_off)', fmtE(op.value), ''],
          ['λ_B', fmtE(lb), isNum(p.lbOverride) ? 'override' : 'Kicad-Space-Reliability'],
          ['Σ π_n·ΔT_i^0.68', fmtE(cyc.value), ''],
          ['λ_EOS', fmtE(eos), 'FIT'],
        ],
        operating: op.rows,
        cycling: cyc.rows,
        tempLabel: 't_j',
        errors: [],
      };
    },
  },

  transistor: {
    label: 'Transistor',
    clause: '8.4–8.5',
    status: 'The structure (voltage factor × λ0 × Arrhenius at 0.3 eV and 100 °C for MOS, plus package and overstress terms) agrees with Thurlbeck & Cao 2022. π_S = 0.22·e^(1.7·S) and the λ0 values are from Kicad-Space-Reliability and have not been checked against the standard.',
    defaults: { type: 'mos-lp', stress: null, power: null, rja: null, package: 'sot23', eos: 'none', l0Override: null, lbOverride: null },
    fields: [
      { key: 'type', label: 'Type', type: 'select', options: options(TRANSISTORS), wide: true, required: true },
      { key: 'stress', label: 'Voltage stress S', type: 'number', min: 0, max: 1, step: 'any', required: true, help: 'V_CE / V_CEO for bipolar, V_DS / V_DS(max) for MOS.' },
      ...thermalFields,
      { key: 'package', label: 'Package', type: 'select', required: (p) => !isNum(p.lbOverride), options: options(DISCRETE_PACKAGES, (r) => `${r.label}: λ_B ${r.lb}`) },
      eosField,
      { key: 'l0Override', label: 'λ0 override', unit: 'FIT', type: 'number', step: 'any', optional: true, advanced: true },
      { key: 'lbOverride', label: 'λ_B override', unit: 'FIT', type: 'number', step: 'any', optional: true, advanced: true },
    ],
    describe: (p) => [p.type && byId(TRANSISTORS, p.type).label, p.package && byId(DISCRETE_PACKAGES, p.package).label].filter(Boolean).join(', ') || 'Transistor',
    compute(p, prof) {
      const row = byId(TRANSISTORS, p.type);
      const l0 = orTable(p.l0Override, row.l0);
      const lb = orTable(p.lbOverride, byId(DISCRETE_PACKAGES, p.package).lb);
      const S = Math.min(1, Math.max(0, p.stress || 0));
      const piS = 0.22 * Math.exp(1.7 * S);
      const dTj = (p.rja || 0) * (p.power || 0);
      const op = operatingSum(prof, (ph) => ph.tac + dTj, row.ea, 373);
      const die = piS * l0 * op.value;
      const cyc = cyclingSum(prof, dTj);
      const pkgFit = PACKAGE_K * cyc.value * lb;
      const eos = byId(EOS, p.eos).fit;
      return {
        fit: die + pkgFit + eos,
        parts: [['Die', die], ['Package', pkgFit], ['Overstress', eos]],
        values: [
          ['λ0', fmtE(l0), isNum(p.l0Override) ? 'override' : row.group],
          ['π_S', fmtE(piS), `0.22 × e^(1.7 × ${fmtE(S)})`],
          ['ΔT_j', fmtE(dTj), '°C = R_JA × P'],
          ['π_t reference', `373 K, A = ${row.ea}`, 'π_t = exp{A × [1/373 − 1/(273 + t_j)]}'],
          ['Σ π_t·τ_i / (τ_on + τ_off)', fmtE(op.value), ''],
          ['λ_B', fmtE(lb), isNum(p.lbOverride) ? 'override' : 'Kicad-Space-Reliability'],
          ['Σ π_n·ΔT_i^0.68', fmtE(cyc.value), ''],
          ['λ_EOS', fmtE(eos), 'FIT'],
        ],
        operating: op.rows,
        cycling: cyc.rows,
        tempLabel: 't_j',
        errors: [],
      };
    },
  },

  capacitor: {
    label: 'Capacitor',
    clause: '10',
    status: 'Model structure λ0·[Σπ_t·τ_i/(τ_on+τ_off) + k·Σπ_n·ΔT^0.68] matches the tantalum equation in Micromachines 2023. Coefficients are from Kicad-Space-Reliability and have not been checked against the standard.',
    defaults: { type: 'ceramic-2', rise: 0, l0Override: null },
    fields: [
      { key: 'type', label: 'Type', type: 'select', options: options(CAPACITORS, (r) => `${r.label} (${r.clause})`), wide: true, required: true },
      { key: 'rise', label: 'Temperature rise above board ambient', unit: '°C', type: 'number', min: 0, step: 'any', required: true, help: 'Self-heating from ripple current, or a nearby hot part. 0 if unknown.' },
      { key: 'l0Override', label: 'λ0 override', unit: 'FIT', type: 'number', step: 'any', optional: true, advanced: true },
    ],
    describe: (p) => (p.type ? byId(CAPACITORS, p.type).label : 'Capacitor'),
    compute(p, prof) {
      const row = byId(CAPACITORS, p.type);
      const l0 = orTable(p.l0Override, row.l0);
      const rise = p.rise || 0;
      const op = operatingSum(prof, (ph) => ph.tac + rise, row.ea, row.tRef);
      const cyc = cyclingSum(prof, rise);
      const temp = l0 * op.value;
      const cycling = l0 * row.k * cyc.value;
      return {
        fit: temp + cycling,
        parts: [['Operating', temp], ['Thermal cycling', cycling]],
        values: [
          ['λ0', fmtE(l0), isNum(p.l0Override) ? 'override' : `clause ${row.clause}`],
          ['π_t reference', `${row.tRef} K, A = ${row.ea}`, 'π_t = exp{A × [1/T_ref − 1/(273 + t)]}'],
          ['Σ π_t·τ_i / (τ_on + τ_off)', fmtE(op.value), ''],
          ['k', fmtE(row.k), ''],
          ['Σ π_n·ΔT_i^0.68', fmtE(cyc.value), ''],
        ],
        operating: op.rows,
        cycling: cyc.rows,
        tempLabel: 't',
        errors: [],
      };
    },
  },

  resistor: {
    label: 'Resistor',
    clause: '11',
    status: 'Model structure as for capacitors, with t_R = t_ac + rise × P/P_rated. Structure and coefficients are from Kicad-Space-Reliability and have not been checked against the standard.',
    defaults: { type: 'smd', power: null, rated: null, elements: 1, l0Override: null },
    fields: [
      { key: 'type', label: 'Type', type: 'select', options: options(RESISTORS, (r) => `${r.label} (${r.clause})`), wide: true, required: true },
      { key: 'power', label: 'Dissipated power P', unit: 'W', type: 'number', min: 0, step: 'any', required: true },
      { key: 'rated', label: 'Rated power P_rated', unit: 'W', type: 'number', min: 0, step: 'any', required: true },
      { key: 'elements', label: 'Resistive elements', type: 'number', min: 1, step: 1, required: true, help: 'More than 1 for a resistor array; λ0 is per element.' },
      { key: 'l0Override', label: 'λ0 override (per element)', unit: 'FIT', type: 'number', step: 'any', optional: true, advanced: true },
    ],
    describe: (p) => (p.type ? byId(RESISTORS, p.type).label : 'Resistor'),
    compute(p, prof) {
      const errors = [];
      const row = byId(RESISTORS, p.type);
      if (p.rated === 0) errors.push('The rated power cannot be 0.');
      const ratio = p.rated > 0 ? (p.power || 0) / p.rated : 0;
      if (ratio > 1) errors.push('Dissipated power is above the rating.');
      const rise = row.rise * ratio;
      const elements = Math.max(1, Math.round(p.elements || 1));
      const l0 = orTable(p.l0Override, row.l0) * elements;
      const op = operatingSum(prof, (ph) => ph.tac + rise, EA.RESISTOR, 303);
      const cyc = cyclingSum(prof, rise);
      const temp = l0 * op.value;
      const cycling = l0 * row.k * cyc.value;
      return {
        fit: temp + cycling,
        parts: [['Operating', temp], ['Thermal cycling', cycling]],
        values: [
          ['λ0 × elements', fmtE(l0), isNum(p.l0Override) ? 'override' : `clause ${row.clause}`],
          ['Temperature rise', fmtE(rise), `°C = ${row.rise} × P/P_rated`],
          ['π_t reference', `303 K, A = ${EA.RESISTOR}`, 'π_t = exp{1740 × [1/303 − 1/(273 + t_R)]}'],
          ['Σ π_t·τ_i / (τ_on + τ_off)', fmtE(op.value), ''],
          ['k', fmtE(row.k), ''],
          ['Σ π_n·ΔT_i^0.68', fmtE(cyc.value), ''],
        ],
        operating: op.rows,
        cycling: cyc.rows,
        tempLabel: 't_R',
        errors,
      };
    },
  },

  inductor: {
    label: 'Inductor or transformer',
    clause: '12',
    status: 'Model structure and t_R = t_ac + 8.2 × P_loss/S are from Kicad-Space-Reliability and have not been checked against the standard. Enter λ0 from a datasheet or vendor data.',
    defaults: { l0: null, ploss: null, area: null },
    fields: [
      { key: 'l0', label: 'λ0', unit: 'FIT', type: 'number', min: 0, step: 'any', wide: true, required: true },
      { key: 'ploss', label: 'Power loss P_loss', unit: 'W', type: 'number', min: 0, step: 'any', required: true },
      { key: 'area', label: 'Radiating surface S', unit: 'dm²', type: 'number', min: 0, step: 'any', required: true, help: '1 dm² = 10 000 mm².' },
    ],
    describe: () => 'Inductor or transformer',
    compute(p, prof) {
      const errors = [];
      if (p.area === 0) errors.push('The radiating surface cannot be 0.');
      const l0 = isNum(p.l0) ? p.l0 : 0;
      const rise = p.area > 0 ? (INDUCTORS.riseCoef * (p.ploss || 0)) / p.area : 0;
      const op = operatingSum(prof, (ph) => ph.tac + rise, EA.RESISTOR, 303);
      const cyc = cyclingSum(prof, rise);
      const temp = l0 * op.value;
      const cycling = l0 * INDUCTORS.k * cyc.value;
      return {
        fit: temp + cycling,
        parts: [['Operating', temp], ['Thermal cycling', cycling]],
        values: [
          ['λ0', fmtE(l0), 'entered'],
          ['Temperature rise', fmtE(rise), '°C = 8.2 × P_loss / S'],
          ['π_t reference', `303 K, A = ${EA.RESISTOR}`, ''],
          ['Σ π_t·τ_i / (τ_on + τ_off)', fmtE(op.value), ''],
          ['k', fmtE(INDUCTORS.k), ''],
          ['Σ π_n·ΔT_i^0.68', fmtE(cyc.value), ''],
        ],
        operating: op.rows,
        cycling: cyc.rows,
        tempLabel: 't_R',
        errors,
      };
    },
  },

  vendor: {
    label: 'Part with a vendor failure rate, rescaled',
    group: 'Vendor data',
    clause: 'Vendor data',
    status: 'Rescales a manufacturer\'s FIT to this mission profile. "One temperature" uses the Arrhenius law, per operating hour, weighted by working time. "IEC 62380 FIT report" rescales the die and package terms with the IEC TR 62380 formulas published in TI SLOA294A; no coefficient tables are involved. "MTBF from a data sheet" keeps a module\'s or power supply\'s MTBF with its prediction method, environment and temperature, converts neither method nor environment, and rescales for temperature with E_a fitted from two figures on the sheet, or 0.3 eV from makers\' own figures for whole units.',
    defaults: {
      method: 'arrhenius', note: '', fit: null, tref: null, ea: null, dieFit: null, pkgFit: null, eosFit: 0, refProfile: 'auto-motor', refRise: null, tech: 'mos', power: null, rja: null,
      rateUnit: 'mtbf-h', mtbfHours: null, statedFit: null, predMethod: null, statedEnv: null, statistic: 'mean', confidence: null,
      refPoint: null, tStated: null, pointRise: null, mtbfHours2: null, statedFit2: null, tStated2: null, moduleEa: VENDOR_MTBF.ea,
    },
    fields: [
      { key: 'method', label: 'Vendor data', type: 'select', required: true, wide: true, options: [
        { value: 'arrhenius', label: 'Failure rate at one temperature (qualification or reliability report)' },
        { value: 'report62380', label: 'IEC 62380 FIT report: die and package FIT at a stated mission profile' },
        { value: 'mtbf', label: 'MTBF from a data sheet (module, power supply, converter)' },
      ] },
      { key: 'note', label: 'Part and source', type: 'text', wide: true },
      { key: 'rateUnit', label: 'Stated as', type: 'select', required: true, show: isMtbf, options: [{ value: 'mtbf-h', label: 'MTBF in hours' }, { value: 'fit', label: 'Failure rate in FIT' }] },
      { key: 'mtbfHours', label: 'Stated MTBF', unit: 'h', type: 'number', min: 0, step: 'any', required: true, show: (p) => isMtbf(p) && p.rateUnit !== 'fit', help: 'As printed: 7,976 kh is 7,976,000 h; 7.74 Mh is 7,740,000 h.' },
      { key: 'statedFit', label: 'Stated failure rate', unit: 'FIT', type: 'number', min: 0, step: 'any', required: true, show: (p) => isMtbf(p) && p.rateUnit === 'fit' },
      { key: 'predMethod', label: 'Prediction method', type: 'select', required: true, wide: true, show: isMtbf, options: VENDOR_MTBF.methods.map((m) => ({ value: m.id, label: m.label })), help: 'Printed next to the figure. Methods are not comparable: for the same unit 217F gives a 2–5× shorter MTBF than SR-332.' },
      { key: 'statedEnv', label: 'Environment it is stated for', type: 'select', required: true, show: isMtbf, options: [...ENVIRONMENTS.map((e) => ({ value: e.id, label: e.label })), { value: 'unstated', label: 'Not stated' }], help: 'Usually ground, benign. It is not converted to the board\'s environment.' },
      { key: 'statistic', label: 'The figure is', type: 'select', required: true, show: isMtbf, options: MTBF_STATISTICS, help: 'Most data sheets give one predicted figure. A bound is used as stated, not converted to a mean.' },
      { key: 'confidence', label: 'Confidence of the bound', unit: '%', type: 'number', min: 0, max: 100, step: 'any', required: true, show: (p) => isMtbf(p) && p.statistic === 'bound' },
      { key: 'refPoint', label: 'Its temperature is measured at', type: 'select', required: true, show: isMtbf, options: MTBF_POINTS },
      { key: 'tStated', label: 'Stated temperature', unit: '°C', type: 'number', step: 'any', required: true, show: mtbfScaled },
      { key: 'pointRise', label: 'That point\'s rise above board ambient, in this design', unit: '°C', type: 'number', min: 0, step: 'any', required: true, show: (p) => isMtbf(p) && (p.refPoint === 'case' || p.refPoint === 'board'), help: 'A module\'s case or board runs warmer than the air around it: measured, or from its data sheet\'s derating.' },
      { key: 'mtbfHours2', label: 'Second MTBF, if the sheet gives one', unit: 'h', type: 'number', min: 0, step: 'any', show: (p) => mtbfScaled(p) && p.rateUnit !== 'fit', help: 'At another temperature: E_a is then fitted from the two figures.' },
      { key: 'statedFit2', label: 'Second failure rate, if the sheet gives one', unit: 'FIT', type: 'number', min: 0, step: 'any', show: (p) => mtbfScaled(p) && p.rateUnit === 'fit', help: 'At another temperature: E_a is then fitted from the two figures.' },
      { key: 'tStated2', label: 'At temperature', unit: '°C', type: 'number', step: 'any', required: true, show: (p) => mtbfScaled(p) && isNum(mtbfSecond(p)) },
      { key: 'moduleEa', label: 'Activation energy E_a', unit: 'eV', type: 'number', min: 0, step: 'any', required: true, show: (p) => mtbfScaled(p) && !isNum(mtbfSecond(p)), help: 'Starts at 0.3 eV, from makers\' own two-temperature figures for whole modules and supplies (0.16–0.41 eV). The IC value, 0.7 eV, would overstate the temperature effect several times.' },
      { key: 'fit', label: 'Vendor failure rate', unit: 'FIT', type: 'number', min: 0, step: 'any', required: true, show: (p) => p.method === 'arrhenius' },
      { key: 'tref', label: 'At junction temperature', unit: '°C', type: 'number', step: 'any', required: true, show: (p) => p.method === 'arrhenius', help: 'The temperature the vendor states the rate at, often 55 °C.' },
      { key: 'ea', label: 'Activation energy', unit: 'eV', type: 'number', min: 0, step: 'any', required: true, show: (p) => p.method === 'arrhenius', help: 'Use the vendor\'s value; 0.7 eV is common for ICs.' },
      { key: 'dieFit', label: 'Die FIT (report)', unit: 'FIT', type: 'number', min: 0, step: 'any', required: true, show: (p) => p.method === 'report62380' },
      { key: 'pkgFit', label: 'Package FIT (report)', unit: 'FIT', type: 'number', min: 0, step: 'any', required: true, show: (p) => p.method === 'report62380' },
      { key: 'eosFit', label: 'Overstress FIT (report)', unit: 'FIT', type: 'number', min: 0, step: 'any', required: true, show: (p) => p.method === 'report62380', help: 'Usually 0 in vendor reports.' },
      { key: 'refProfile', label: 'Report\'s mission profile', type: 'select', required: true, show: (p) => p.method === 'report62380', options: MISSION_PROFILES.rows.map((r) => ({ value: r.id, label: `${r.label} (${r.ref})` })) },
      { key: 'refRise', label: 'Report\'s junction temperature rise', unit: '°C', type: 'number', min: 0, step: 'any', required: true, show: (p) => p.method === 'report62380', help: 'Power dissipation × θ_JA as stated in the report.' },
      { key: 'tech', label: 'Die technology', type: 'select', required: true, show: (p) => p.method === 'report62380', options: [
        { value: 'mos', label: 'MOS (A = 3480 K)' }, { value: 'bipolar', label: 'Bipolar (A = 4640 K)' },
      ] },
      ...thermalFields.map((f) => ({ ...f, label: `${f.label}, in this design`, show: (p) => !isMtbf(p) })),
    ],
    describe: (p) => p.note || (p.method === 'report62380' ? 'Vendor IEC 62380 FIT report, rescaled' : isMtbf(p) ? 'Maker\'s MTBF, rescaled' : 'Vendor failure rate, rescaled'),
    compute(p, prof) {
      if (isMtbf(p)) return vendorMtbf(p, prof);
      const dTj = (p.rja || 0) * (p.power || 0);
      if (p.method === 'report62380') {
        const ref = normaliseProfile({ phases: byId(MISSION_PROFILES, p.refProfile).phases });
        const ea = p.tech === 'bipolar' ? EA.BIPOLAR : EA.MOS;
        const refRise = p.refRise || 0;
        const opRef = operatingSum(ref, (ph) => ph.tac + refRise, ea, 328);
        const opUser = operatingSum(prof, (ph) => ph.tac + dTj, ea, 328);
        const cycRef = cyclingSum(ref, refRise);
        const cycUser = cyclingSum(prof, dTj);
        const errors = [];
        if (!(opRef.value > 0)) errors.push('The report\'s mission profile has no working phase.');
        if (!(cycRef.value > 0) && (p.pkgFit || 0) > 0) errors.push('The report\'s mission profile has no thermal cycles to rescale the package term from.');
        const die = opRef.value > 0 ? (p.dieFit || 0) * (opUser.value / opRef.value) : 0;
        const pkg = cycRef.value > 0 ? (p.pkgFit || 0) * (cycUser.value / cycRef.value) : 0;
        const eos = p.eosFit || 0;
        return {
          fit: die + pkg + eos,
          parts: [['Die', die], ['Package', pkg], ['Overstress', eos]],
          values: [
            ['Die', `${fmtE(p.dieFit || 0)} × ${fmtE(opUser.value)} / ${fmtE(opRef.value)}`, 'report die FIT × Σπ_t·τ here / in the report\'s profile'],
            ['Package', `${fmtE(p.pkgFit || 0)} × ${fmtE(cycUser.value)} / ${fmtE(cycRef.value)}`, 'report package FIT × Σπ_n·ΔT^0.68 here / in the report\'s profile'],
            ['ΔT_j', `${fmtE(dTj)} here, ${fmtE(refRise)} in the report`, '°C'],
          ],
          operating: opUser.rows,
          cycling: cycUser.rows,
          tempLabel: 't_j',
          errors,
        };
      }
      const k = 8.617e-5;
      const tref = isNum(p.tref) ? p.tref : 25;
      const ea = p.ea || 0;
      const denom = prof.tauOn + prof.tauOff;
      let total = 0;
      const rows = [];
      prof.phases.forEach((ph, i) => {
        if (!(ph.tau > 0)) return;
        const t = ph.tac + dTj;
        const factor = Math.exp((ea / k) * (1 / (tref + 273) - 1 / (t + 273)));
        total += factor * ph.tau;
        rows.push({ phase: i, t, piT: factor, tau: ph.tau });
      });
      const weight = denom > 0 ? total / denom : 0;
      const fit = (p.fit || 0) * weight;
      return {
        fit,
        parts: [['Rescaled', fit]],
        values: [
          ['Vendor rate', `${fmtE(p.fit || 0)} FIT at ${fmtE(tref)} °C`, `E_a = ${fmtE(ea)} eV`],
          ['ΔT_j', fmtE(dTj), '°C = R_JA × P'],
          ['Σ AF·τ_i / (τ_on + τ_off)', fmtE(weight), 'AF = exp{E_a/k × [1/(T_ref+273) − 1/(T_j+273)]}'],
        ],
        operating: rows,
        cycling: [],
        tempLabel: 'T_j',
        operatingLabel: 'AF',
        errors: [],
      };
    },
  },

  fixed: {
    label: 'Other part (failure rate entered)',
    clause: 'Entered rate',
    status: 'No model: the failure rate is used as entered.',
    defaults: { fit: null, note: '' },
    fields: [
      { key: 'fit', label: 'Failure rate λ', unit: 'FIT', type: 'number', min: 0, step: 'any', required: true },
      { key: 'note', label: 'Description or source', type: 'text', wide: true },
    ],
    describe: (p) => p.note || 'Failure rate entered',
    compute(p) {
      const fit = isNum(p.fit) ? p.fit : 0;
      return { fit, parts: [['Entered', fit]], values: [], operating: [], cycling: [], errors: [] };
    },
  },
};

// The MIL-HDBK-217F models cover relays, switches, connectors, sockets,
// plated-through-hole boards, crystals, fuses, lamps and optoelectronics.
for (const m of Object.values(MODELS)) m.group ??= 'IEC TR 62380 approach';
MODELS.fixed.group = 'Other';
Object.assign(MODELS, MODELS_217F, MODELS_MAKER);
export const MODEL_GROUPS = ['IEC TR 62380 approach', 'MIL-HDBK-217F', 'Vendor data', 'Other'];

// "Clause 7" for the 62380 models; the others already name their handbook section or source.
export const clauseOf = (m) => (m.group === 'IEC TR 62380 approach' ? `Clause ${m.clause}` : m.clause);

// Families with no model here yet, under either method.
export const PENDING_FAMILIES = [
  'Hybrid circuits (62380 clause 6); for the circuit board, failure modes other than plated-hole fatigue, such as conductive anodic filament growth and delamination',
  'Laser diodes, passive optics (62380 clause 9)',
  'Failure rates for aluminium solid and polymer capacitors (62380 clauses 10.6, 10.7): enter the maker\'s rate; their wear-out is checked under Electrolytic capacitor life. Film, paper, mica, glass and variable capacitors, composition, power, wirewound and variable resistors, and thermistors use the MIL-HDBK-217F capacitor and resistor models',
  'Microwave passives, SAW filters (62380 clause 13)',
  'Keyboards, displays (62380 clauses 15, 17)',
  'Varistors, arrestors (62380 clause 18)',
  'Batteries, fans, thermoelectric coolers, disk drives, converters (62380 clause 19)',
];

// ---------------------------------------------------------------------------
// Whole board

// A part with missing inputs or errors contributes nothing to the board total.
export function computeComponent(comp, prof) {
  const model = MODELS[comp.model];
  const p = { ...model.defaults, ...comp.params };
  const missing = missingFields(model, p);
  const r = model.compute(p, prof);
  const errors = [
    ...(missing.length ? [`Missing: ${missing.map((f) => fieldLabel(f, p)).join(', ')}.`] : []),
    ...r.errors,
  ];
  const qty = Math.max(0, Number(comp.qty) || 0);
  const complete = errors.length === 0;
  return { ...r, errors, missing: missing.map((f) => f.key), complete, qty, total: complete ? r.fit * qty : 0 };
}

export function computeBoard(project) {
  const prof = normaliseProfile(project.profile);
  const items = project.components.map((c) => ({ comp: c, result: computeComponent(c, prof) }));
  const total = items.reduce((s, it) => s + it.result.total, 0);
  return { prof, items, total, incomplete: items.filter((it) => !it.result.complete).length };
}

// MTBF in hours and survival probability over `years` for a rate in FIT.
export function mtbfHours(fit) {
  return fit > 0 ? 1e9 / fit : Infinity;
}

export function reliability(fit, years) {
  return Math.exp(-fit * 1e-9 * years * 8760);
}
