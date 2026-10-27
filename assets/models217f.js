// MIL-HDBK-217F part models, for families the IEC TR 62380 tables here do
// not cover. Same model interface as models.js (fields, defaults, describe,
// compute(p, prof) -> { fit, parts, values, operating, cycling, errors }).
//
// 217F gives failures per 10^6 operating hours. These models convert to FIT
// and weight each working phase by its time share, Σ λ(T_i)·τ_i/(τ_on+τ_off),
// so the result is per calendar hour like the 62380 models. 217F has no
// dormant model: dormant phases add nothing.

import {
  ENVIRONMENTS, LOAD_TYPES, RELAY_MECHANICAL, RELAY_SOLID_STATE, SWITCHES, CONNECTORS, SOCKETS,
  PTH_BOARDS, CRYSTALS, FUSES, LAMPS, OPTOELECTRONICS, CAPACITORS_217F, RESISTORS_217F,
} from './tables217f.js';

const BOLTZMANN_EV = 8.617e-5;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const find = (rows, id) => rows.find((r) => r.id === id);
const fmtE = (x) => (x === 0 ? '0' : Math.abs(x) >= 0.01 && Math.abs(x) < 1e5 ? String(+x.toPrecision(4)) : x.toExponential(3));
const opts = (rows, labelOf = (r) => r.label ?? r.id) => rows.map((r) => ({ value: r.id, label: labelOf(r), group: r.group }));
const qualityField = (table) => ({ key: 'quality', label: 'Quality', type: 'select', required: true, options: opts(table.quality, (r) => `${r.label} (π_Q ${r.piQ})`) });

// π_E for the board's environment; null where the handbook gives none.
function environment(table, prof) {
  const i = Math.max(0, ENVIRONMENTS.findIndex((e) => e.id === prof.env217f));
  return { id: ENVIRONMENTS[i].id, piE: table.piE[i] };
}

// Σ λ_op(T_i)·τ_i / (τ_on + τ_off), with λ_op in failures per 10^6 hours.
function weighted(prof, lambdaAt, tempOf) {
  const denom = prof.tauOn + prof.tauOff;
  let total = 0;
  const rows = [];
  prof.phases.forEach((ph, i) => {
    if (!(ph.tau > 0)) return;
    const t = tempOf ? tempOf(ph) : null;
    const { lambda, factor } = lambdaAt(t);
    total += lambda * ph.tau;
    if (tempOf) rows.push({ phase: i, t, piT: factor, tau: ph.tau });
  });
  return { perMillion: denom > 0 ? total / denom : 0, rows };
}

// Shared result shape: the operating-hour rate, the calendar-weighted FIT,
// and the factor list for the calculation trace.
function result(table, env, w, values, extra = {}) {
  const errors = [];
  if (env.piE == null) errors.push(`MIL-HDBK-217F gives no environment factor for ${env.id} for this part type.`);
  const fit = errors.length ? 0 : w.perMillion * 1000;
  return {
    fit,
    parts: [['Operating', fit]],
    values: [
      ...values,
      ['π_E', env.piE == null ? 'n/a' : fmtE(env.piE), `environment ${env.id}`],
      ['Σ λ_p·τ_i / (τ_on + τ_off)', fmtE(w.perMillion), 'failures per 10⁶ h, weighted by working time'],
      ['λ', fmtE(fit), 'FIT'],
    ],
    operating: w.rows,
    cycling: [],
    errors,
    ...extra,
  };
}

const status = () => 'Public-domain model. Rates per 10⁶ operating hours, converted to FIT and weighted by working time; dormant phases add nothing.';

const loadFactor = (loadId, S) => Math.exp((S / find(LOAD_TYPES, loadId).divisor) ** 2);
const loadFields = [
  { key: 'load', label: 'Load type', type: 'select', required: true, options: opts(LOAD_TYPES) },
  { key: 'stress', label: 'Load stress S', type: 'number', min: 0, max: 1, step: 'any', required: true, help: 'Operating load current ÷ rated resistive load current.' },
];

export const MODELS_217F = {
  'mil-relay': {
    label: 'Relay, mechanical (MIL-HDBK-217F)',
    group: 'MIL-HDBK-217F',
    clause: RELAY_MECHANICAL.ref,
    status: status(RELAY_MECHANICAL),
    defaults: { rating: '85', load: 'resistive', stress: null, contact: 'SPDT', cycles: null, application: null, quality: 'commercial', rise: 0 },
    fields: [
      { key: 'application', label: 'Application and construction', type: 'select', required: true, wide: true, options: opts(RELAY_MECHANICAL.application) },
      { key: 'rating', label: 'Temperature rating', type: 'select', required: true, options: opts(RELAY_MECHANICAL.ratings) },
      { key: 'contact', label: 'Contact form', type: 'select', required: true, options: opts(RELAY_MECHANICAL.contactForms, (r) => `${r.id} (π_C ${r.piC})`) },
      ...loadFields,
      { key: 'cycles', label: 'Cycle rate', unit: 'cycles/hour', type: 'number', min: 0, step: 'any', required: true },
      qualityField(RELAY_MECHANICAL),
      { key: 'rise', label: 'Temperature rise above board ambient', unit: '°C', type: 'number', min: 0, step: 'any', required: true },
    ],
    describe: (p) => ['Relay', p.application && find(RELAY_MECHANICAL.application, p.application)?.label.replace(/ \(π_F.*/, ''), p.contact].filter(Boolean).join(', '),
    compute(p, prof) {
      const env = environment(RELAY_MECHANICAL, prof);
      const ea = find(RELAY_MECHANICAL.ratings, p.rating)?.ea ?? 0.19;
      const S = Math.min(1, Math.max(0, p.stress || 0));
      const piL = loadFactor(p.load, S);
      const piC = find(RELAY_MECHANICAL.contactForms, p.contact)?.piC ?? 1;
      const rate = p.cycles || 0;
      const commercial = p.quality === 'commercial';
      const piCYC = commercial
        ? (rate > 1000 ? (rate / 100) ** 2 : rate >= 10 ? rate / 10 : 1.0)
        : (rate >= 1 ? rate / 10 : 0.1);
      const piF = find(RELAY_MECHANICAL.application, p.application)?.piF ?? 0;
      const piQ = find(RELAY_MECHANICAL.quality, p.quality)?.piQ ?? 1;
      const rise = p.rise || 0;
      const lambdaB = (t) => 0.0059 * Math.exp((-ea / BOLTZMANN_EV) * (1 / (t + 273) - 1 / 298));
      const w = weighted(prof, (t) => {
        const lb = lambdaB(t);
        return { lambda: lb * piL * piC * piCYC * piF * piQ * (env.piE ?? 0), factor: lb };
      }, (ph) => ph.tac + rise);
      return result(RELAY_MECHANICAL, env, w, [
        ['λ_b', `0.0059·exp(−${ea}/k·[1/(T+273) − 1/298])`, 'per phase, below'],
        ['π_L', fmtE(piL), `${p.load}, S = ${fmtE(S)}`],
        ['π_C', fmtE(piC), p.contact],
        ['π_CYC', fmtE(piCYC), `${fmtE(rate)} cycles/hour, ${commercial ? 'commercial' : 'MIL-SPEC'} rule`],
        ['π_F', fmtE(piF), ''],
        ['π_Q', fmtE(piQ), ''],
      ], { tempLabel: 'T_A', operatingLabel: 'λ_b' });
    },
  },

  'mil-ssr': {
    label: 'Relay, solid state (MIL-HDBK-217F)',
    group: 'MIL-HDBK-217F',
    clause: RELAY_SOLID_STATE.ref,
    status: status(RELAY_SOLID_STATE),
    defaults: { type: 'ss', quality: 'commercial' },
    fields: [
      { key: 'type', label: 'Type', type: 'select', required: true, options: opts(RELAY_SOLID_STATE.types) },
      qualityField(RELAY_SOLID_STATE),
    ],
    describe: (p) => find(RELAY_SOLID_STATE.types, p.type)?.label ?? 'Solid-state relay',
    compute(p, prof) {
      const env = environment(RELAY_SOLID_STATE, prof);
      const lb = find(RELAY_SOLID_STATE.types, p.type)?.lb ?? 0;
      const piQ = find(RELAY_SOLID_STATE.quality, p.quality)?.piQ ?? 1;
      const w = weighted(prof, () => ({ lambda: lb * piQ * (env.piE ?? 0) }));
      return result(RELAY_SOLID_STATE, env, w, [['λ_b', fmtE(lb), ''], ['π_Q', fmtE(piQ), '']]);
    },
  },

  'mil-switch': {
    label: 'Switch (MIL-HDBK-217F)',
    group: 'MIL-HDBK-217F',
    clause: SWITCHES.ref,
    status: status(SWITCHES),
    defaults: { type: null, load: 'resistive', stress: null, contact: 'SPST', quality: 'lower' },
    fields: [
      { key: 'type', label: 'Type', type: 'select', required: true, options: opts(SWITCHES.types, (r) => `${r.label} (λ_b ${r.lb})`) },
      ...loadFields.map((f) => (f.key === 'stress' ? { ...f, help: `${f.help} For a switch rated by inductive load, choose resistive.` } : f)),
      { key: 'contact', label: 'Contact form', type: 'select', required: true, options: opts(SWITCHES.contactForms, (r) => `${r.id} (${r.contacts} contacts)`), show: (p) => Boolean(find(SWITCHES.types, p.type)?.contacts) },
      qualityField(SWITCHES),
    ],
    describe: (p) => (p.type ? `${find(SWITCHES.types, p.type).label} switch` : 'Switch'),
    compute(p, prof) {
      const env = environment(SWITCHES, prof);
      const type = find(SWITCHES.types, p.type);
      const lb = type?.lb ?? 0;
      const S = Math.min(1, Math.max(0, p.stress || 0));
      const piL = loadFactor(p.load, S);
      const contacts = type?.contacts ? (find(SWITCHES.contactForms, p.contact)?.contacts ?? 1) : 1;
      const piC = contacts ** 0.33;
      const piQ = find(SWITCHES.quality, p.quality)?.piQ ?? 1;
      const w = weighted(prof, () => ({ lambda: lb * piL * piC * piQ * (env.piE ?? 0) }));
      return result(SWITCHES, env, w, [
        ['λ_b', fmtE(lb), type?.label ?? ''],
        ['π_L', fmtE(piL), `${p.load}, S = ${fmtE(S)}`],
        ['π_C', fmtE(piC), type?.contacts ? `${contacts} contacts, (NC)^0.33` : 'not a toggle or pushbutton'],
        ['π_Q', fmtE(piQ), ''],
      ]);
    },
  },

  'mil-connector': {
    label: 'Connector (MIL-HDBK-217F)',
    group: 'MIL-HDBK-217F',
    clause: CONNECTORS.ref,
    status: status(CONNECTORS),
    defaults: { type: null, half: 'pair', current: null, gauge: '22', cycles: null, quality: 'lower' },
    fields: [
      { key: 'type', label: 'Type', type: 'select', required: true, wide: true, options: opts(CONNECTORS.types, (r) => `${r.label} (λ_b ${r.lb})`) },
      { key: 'half', label: 'Count', type: 'select', required: true, options: [{ value: 'pair', label: 'Mated pair' }, { value: 'single', label: 'One half (rate ÷ 2)' }], help: 'The handbook rate is for a mated pair.' },
      { key: 'current', label: 'Current per contact', unit: 'A', type: 'number', min: 0, step: 'any', required: true, show: (p) => !isNum(find(CONNECTORS.types, p.type)?.dT) },
      { key: 'gauge', label: 'Contact gauge', unit: 'AWG', type: 'select', required: true, options: opts(CONNECTORS.gauges, (r) => `${r.id} AWG`), show: (p) => !isNum(find(CONNECTORS.types, p.type)?.dT) },
      { key: 'cycles', label: 'Mating cycles', unit: 'per 1000 h', type: 'number', min: 0, step: 'any', required: true, help: 'One cycle is a connect and a disconnect. 0 if never unplugged.' },
      qualityField(CONNECTORS),
    ],
    describe: (p) => (p.type ? `${find(CONNECTORS.types, p.type).label} connector${p.half === 'single' ? ', one half' : ''}` : 'Connector'),
    compute(p, prof) {
      const env = environment(CONNECTORS, prof);
      const type = find(CONNECTORS.types, p.type);
      const lb = type?.lb ?? 0;
      const k = find(CONNECTORS.gauges, p.gauge)?.k ?? 0;
      const dT = isNum(type?.dT) ? type.dT : k * (p.current || 0) ** 1.85;
      const cycles = p.cycles || 0;
      const piK = CONNECTORS.piK.find(([upTo]) => cycles <= upTo)[1];
      const piQ = find(CONNECTORS.quality, p.quality)?.piQ ?? 1;
      const share = p.half === 'single' ? 0.5 : 1;
      const piT = (t) => Math.exp((-0.14 / BOLTZMANN_EV) * (1 / (t + 273) - 1 / 298));
      const w = weighted(prof, (t) => {
        const f = piT(t);
        return { lambda: share * lb * f * piK * piQ * (env.piE ?? 0), factor: f };
      }, (ph) => ph.tac + dT);
      return result(CONNECTORS, env, w, [
        ['λ_b', fmtE(lb), `${type?.label ?? ''}, mated pair${share < 1 ? ' (halved)' : ''}`],
        ['ΔT insert rise', fmtE(dT), isNum(type?.dT) ? '°C, fixed for RF coaxial' : `°C = ${k}·i^1.85`],
        ['π_K', fmtE(piK), `${fmtE(cycles)} cycles per 1000 h`],
        ['π_Q', fmtE(piQ), ''],
      ], { tempLabel: 'T_0', operatingLabel: 'π_T' });
    },
  },

  'mil-socket': {
    label: 'IC socket (MIL-HDBK-217F)',
    group: 'MIL-HDBK-217F',
    clause: SOCKETS.ref,
    status: status(SOCKETS),
    defaults: { type: null, pins: null, quality: 'lower' },
    fields: [
      { key: 'type', label: 'Type', type: 'select', required: true, options: opts(SOCKETS.types) },
      { key: 'pins', label: 'Active contacts', type: 'number', min: 1, step: 1, required: true },
      qualityField(SOCKETS),
    ],
    describe: (p) => (p.type ? `${find(SOCKETS.types, p.type).label} socket` : 'Socket'),
    compute(p, prof) {
      const env = environment(SOCKETS, prof);
      const lb = find(SOCKETS.types, p.type)?.lb ?? 0;
      const N = Math.max(1, p.pins || 1);
      const piP = Math.exp(((N - 1) / 10) ** 0.39);
      const piQ = find(SOCKETS.quality, p.quality)?.piQ ?? 1;
      const w = weighted(prof, () => ({ lambda: lb * piP * piQ * (env.piE ?? 0) }));
      return result(SOCKETS, env, w, [
        ['λ_b', fmtE(lb), ''],
        ['π_P', fmtE(piP), `exp(((${N} − 1)/10)^0.39)`],
        ['π_Q', fmtE(piQ), ''],
      ]);
    },
  },

  'mil-pwb': {
    label: 'Circuit board, plated through holes (MIL-HDBK-217F)',
    group: 'MIL-HDBK-217F',
    clause: PTH_BOARDS.ref,
    status: `${status(PTH_BOARDS)} For leaded parts in plated through holes; surface-mount boards are not covered.`,
    defaults: { technology: 'pcb', n1: null, n2: 0, planes: null, quality: 'lower' },
    fields: [
      { key: 'technology', label: 'Technology', type: 'select', required: true, wide: true, options: opts(PTH_BOARDS.technologies) },
      { key: 'n1', label: 'Machine-soldered PTHs (N₁)', type: 'number', min: 0, step: 1, required: true, help: 'Wave, infrared or vapour-phase soldered functional plated through holes.' },
      { key: 'n2', label: 'Hand-soldered PTHs (N₂)', type: 'number', min: 0, step: 1, required: true },
      { key: 'planes', label: 'Circuit planes (layers)', type: 'number', min: 1, max: 18, step: 1, required: true, show: (p) => p.technology !== 'discrete' },
      qualityField(PTH_BOARDS),
    ],
    describe: (p) => (p.technology === 'discrete' ? 'Discrete wiring board' : `Printed wiring board${isNum(p.planes) ? `, ${p.planes} planes` : ''}`),
    compute(p, prof) {
      const env = environment(PTH_BOARDS, prof);
      const lb = find(PTH_BOARDS.technologies, p.technology)?.lb ?? 0;
      const P = p.planes || 0;
      const errors = [];
      if (p.technology !== 'discrete' && P > 18) errors.push('The complexity factor is defined for up to 18 circuit planes.');
      const piC = p.technology === 'discrete' || P <= 2 ? 1.0 : 0.65 * P ** 0.63;
      const piQ = find(PTH_BOARDS.quality, p.quality)?.piQ ?? 1;
      const holes = (p.n1 || 0) * piC + (p.n2 || 0) * (piC + 13);
      const w = weighted(prof, () => ({ lambda: lb * holes * piQ * (env.piE ?? 0) }));
      const r = result(PTH_BOARDS, env, w, [
        ['λ_b', fmtE(lb), ''],
        ['π_C', fmtE(piC), p.technology === 'discrete' ? 'discrete wiring' : `0.65·P^0.63, P = ${P}`],
        ['N₁·π_C + N₂·(π_C + 13)', fmtE(holes), ''],
        ['π_Q', fmtE(piQ), ''],
      ]);
      return { ...r, errors: [...errors, ...r.errors] };
    },
  },

  'mil-crystal': {
    label: 'Quartz crystal (MIL-HDBK-217F)',
    group: 'MIL-HDBK-217F',
    clause: CRYSTALS.ref,
    status: status(CRYSTALS),
    defaults: { freq: null, quality: 'lower' },
    fields: [
      { key: 'freq', label: 'Frequency', unit: 'MHz', type: 'number', min: 0, step: 'any', required: true },
      qualityField(CRYSTALS),
    ],
    describe: (p) => `Quartz crystal${isNum(p.freq) ? `, ${p.freq} MHz` : ''}`,
    compute(p, prof) {
      const env = environment(CRYSTALS, prof);
      const lb = 0.013 * (p.freq || 0) ** 0.23;
      const piQ = find(CRYSTALS.quality, p.quality)?.piQ ?? 1;
      const w = weighted(prof, () => ({ lambda: lb * piQ * (env.piE ?? 0) }));
      return result(CRYSTALS, env, w, [['λ_b', fmtE(lb), `0.013·f^0.23, f = ${fmtE(p.freq || 0)} MHz`], ['π_Q', fmtE(piQ), '']]);
    },
  },

  'mil-fuse': {
    label: 'Fuse (MIL-HDBK-217F)',
    group: 'MIL-HDBK-217F',
    clause: FUSES.ref,
    status: status(FUSES),
    defaults: {},
    fields: [],
    describe: () => 'Fuse',
    compute(p, prof) {
      const env = environment(FUSES, prof);
      const w = weighted(prof, () => ({ lambda: FUSES.lb * (env.piE ?? 0) }));
      return result(FUSES, env, w, [['λ_b', fmtE(FUSES.lb), '']]);
    },
  },

  'mil-lamp': {
    label: 'Lamp, incandescent (MIL-HDBK-217F)',
    group: 'MIL-HDBK-217F',
    clause: LAMPS.ref,
    status: status(LAMPS),
    defaults: { voltage: null, utilization: null, application: null },
    fields: [
      { key: 'voltage', label: 'Rated voltage', unit: 'V', type: 'number', min: 0, step: 'any', required: true },
      { key: 'utilization', label: 'Utilisation', type: 'number', min: 0, max: 1, step: 'any', required: true, help: 'Hours lit ÷ equipment operating hours.' },
      { key: 'application', label: 'Supply', type: 'select', required: true, options: opts(LAMPS.applications, (r) => `${r.label} (π_A ${r.piA})`) },
    ],
    describe: (p) => `Lamp${isNum(p.voltage) ? `, ${p.voltage} V` : ''}`,
    compute(p, prof) {
      const env = environment(LAMPS, prof);
      const lb = 0.074 * (p.voltage || 0) ** 1.29;
      const u = p.utilization || 0;
      const piU = u < 0.10 ? 0.10 : u <= 0.90 ? 0.72 : 1.0;
      const piA = find(LAMPS.applications, p.application)?.piA ?? 1;
      const w = weighted(prof, () => ({ lambda: lb * piU * piA * (env.piE ?? 0) }));
      return result(LAMPS, env, w, [
        ['λ_b', fmtE(lb), `0.074·V^1.29, V = ${fmtE(p.voltage || 0)}`],
        ['π_U', fmtE(piU), `utilisation ${fmtE(u)}`],
        ['π_A', fmtE(piA), ''],
      ]);
    },
  },

  'mil-opto': {
    label: 'Optoelectronic: LED, optocoupler, photodetector (MIL-HDBK-217F)',
    group: 'MIL-HDBK-217F',
    clause: OPTOELECTRONICS.ref,
    status: status(OPTOELECTRONICS),
    defaults: { type: null, power: null, rja: null, quality: 'plastic' },
    fields: [
      { key: 'type', label: 'Type', type: 'select', required: true, wide: true, options: opts(OPTOELECTRONICS.types, (r) => `${r.label} (λ_b ${r.lb})`) },
      { key: 'power', label: 'Dissipated power P', unit: 'W', type: 'number', min: 0, step: 'any', required: true },
      { key: 'rja', label: 'Thermal resistance R_JA', unit: '°C/W', type: 'number', min: 0, step: 'any', required: true, help: 'T_j = t_ac + R_JA × P.' },
      qualityField(OPTOELECTRONICS),
    ],
    describe: (p) => find(OPTOELECTRONICS.types, p.type)?.label ?? 'Optoelectronic part',
    compute(p, prof) {
      const env = environment(OPTOELECTRONICS, prof);
      const lb = find(OPTOELECTRONICS.types, p.type)?.lb ?? 0;
      const piQ = find(OPTOELECTRONICS.quality, p.quality)?.piQ ?? 1;
      const dTj = (p.rja || 0) * (p.power || 0);
      const piT = (t) => Math.exp(-2790 * (1 / (t + 273) - 1 / 298));
      const w = weighted(prof, (t) => {
        const f = piT(t);
        return { lambda: lb * f * piQ * (env.piE ?? 0), factor: f };
      }, (ph) => ph.tac + dTj);
      return result(OPTOELECTRONICS, env, w, [
        ['λ_b', fmtE(lb), ''],
        ['ΔT_j', fmtE(dTj), '°C = R_JA × P'],
        ['π_T', 'exp(−2790·[1/(T_j+273) − 1/298])', 'per phase, below'],
        ['π_Q', fmtE(piQ), ''],
      ], { tempLabel: 'T_j', operatingLabel: 'π_T' });
    },
  },
  'mil-capacitor': {
    label: 'Capacitor, any dielectric (MIL-HDBK-217F)',
    group: 'MIL-HDBK-217F',
    clause: CAPACITORS_217F.ref,
    status: status(CAPACITORS_217F),
    defaults: { style: null, capacitance: null, stress: null, cr: null, quality: 'commercial', rise: 0 },
    fields: [
      {
        key: 'style', label: 'Style', type: 'select', required: true, wide: true,
        options: CAPACITORS_217F.styles.map((r) => ({ value: r.id, label: `${r.name ?? r.id}: ${r.desc} (MIL-C-${r.spec})`, group: r.group })),
        help: 'Closest commercial equivalents: film (MKT, MKP) CFR; multilayer ceramic chip CDR; tantalum chip CWR; aluminium electrolytic CE.',
      },
      { key: 'capacitance', label: 'Capacitance', unit: 'µF', type: 'number', min: 0, step: 'any', required: true },
      { key: 'stress', label: 'Voltage stress S', type: 'number', min: 0, step: 'any', required: true, help: '(DC voltage + peak AC voltage) ÷ rated voltage; peak AC = √2 × rms.' },
      {
        key: 'cr', label: 'Circuit resistance CR', unit: 'Ω/V', type: 'number', min: 0, step: 'any', required: true,
        show: (p) => Boolean(find(CAPACITORS_217F.styles, p.style)?.sr),
        help: 'Effective resistance between the capacitor and the power supply ÷ voltage applied to the capacitor.',
      },
      { ...qualityField(CAPACITORS_217F), help: 'Commercial parts take π_Q = 10.' },
      { key: 'rise', label: 'Temperature rise above board ambient', unit: '°C', type: 'number', min: 0, step: 'any', required: true },
    ],
    describe: (p) => {
      const st = find(CAPACITORS_217F.styles, p.style);
      return st ? `${st.desc} (${st.name ?? st.id})` : 'Capacitor';
    },
    compute(p, prof) {
      const t = CAPACITORS_217F;
      const env = environment(t, prof);
      const st = find(t.styles, p.style);
      const lb = st?.lb ?? 0;
      const ea = t.ea[st?.t ?? 1];
      const cExp = t.capExponent[st?.c ?? 1];
      const C = p.capacitance > 0 ? p.capacitance : 1;
      const piC = C ** cExp;
      const [a, n] = t.voltage[st?.v ?? 1];
      const S = Math.max(0, p.stress || 0);
      const piV = (S / a) ** n + 1;
      const cr = Math.max(0, p.cr || 0);
      const piSR = st?.sr ? t.seriesResistance.find(([upTo]) => cr <= upTo)[1] : 1;
      const piQ = find(t.quality, p.quality)?.piQ ?? 1;
      const rise = p.rise || 0;
      const piT = (temp) => Math.exp((-ea / BOLTZMANN_EV) * (1 / (temp + 273) - 1 / 298));
      const w = weighted(prof, (temp) => {
        const f = piT(temp);
        return { lambda: lb * f * piC * piV * piSR * piQ * (env.piE ?? 0), factor: f };
      }, (ph) => ph.tac + rise);
      return result(t, env, w, [
        ['λ_b', fmtE(lb), st ? `style ${st.name ?? st.id}` : ''],
        ['π_T', `exp(−${ea}/k·[1/(T+273) − 1/298])`, `column ${st?.t ?? 1}, per phase, below`],
        ['π_C', fmtE(piC), `C^${cExp}, C = ${fmtE(C)} µF`],
        ['π_V', fmtE(piV), `(S/${a})^${n} + 1, S = ${fmtE(S)}`],
        ['π_SR', fmtE(piSR), st?.sr ? `CR = ${fmtE(cr)} Ω/V` : 'not used for this style'],
        ['π_Q', fmtE(piQ), ''],
      ], { tempLabel: 'T', operatingLabel: 'π_T' });
    },
  },
  'mil-resistor': {
    label: 'Resistor, any style (MIL-HDBK-217F)',
    group: 'MIL-HDBK-217F',
    clause: RESISTORS_217F.ref,
    status: status(RESISTORS_217F),
    defaults: { style: null, power: null, rated: null, quality: 'commercial', rise: 0 },
    fields: [
      {
        key: 'style', label: 'Style', type: 'select', required: true, wide: true,
        options: RESISTORS_217F.styles.map((r) => ({ value: r.id, label: `${r.name ?? r.id}: ${r.desc} (MIL-R-${r.spec})`, group: r.group })),
        help: 'Closest commercial equivalents: thick or thin film chip RM; metal film RN; power wirewound RW; cermet trimmer RJ; NTC or PTC thermistor RTH.',
      },
      { key: 'power', label: 'Dissipated power P', unit: 'W', type: 'number', min: 0, step: 'any', required: true },
      {
        key: 'rated', label: 'Rated power', unit: 'W', type: 'number', min: 0, step: 'any', required: true,
        show: (p) => find(RESISTORS_217F.styles, p.style)?.s != null,
      },
      { ...qualityField(RESISTORS_217F), help: 'Commercial parts take π_Q = 10.' },
      {
        key: 'rise', label: 'Case temperature rise above board ambient', unit: '°C', type: 'number', min: 0, step: 'any', required: true,
        show: (p) => find(RESISTORS_217F.styles, p.style)?.t != null,
        help: 'The handbook allows 0 for low-power resistors that are not power types.',
      },
    ],
    describe: (p) => {
      const st = find(RESISTORS_217F.styles, p.style);
      return st ? `${st.desc} (${st.name ?? st.id})` : 'Resistor';
    },
    compute(p, prof) {
      const t = RESISTORS_217F;
      const env = environment(t, prof);
      const st = find(t.styles, p.style);
      const lb = st?.lb ?? 0;
      // The page's π_P table starts at 0.001 W; below that the power law would reach 0.
      const P = Math.max(0.001, p.power || 0);
      const piP = P ** t.powerExponent;
      const S = p.rated > 0 ? (p.power || 0) / p.rated : 0;
      const [a, b] = st?.s ? t.stress[st.s] : [1, 0];
      const piS = a * Math.exp(b * S);
      const piQ = find(t.quality, p.quality)?.piQ ?? 1;
      const ea = st?.t ? t.ea[st.t] : 0;
      const rise = st?.t ? p.rise || 0 : 0;
      const piT = (temp) => (st?.t ? Math.exp((-ea / BOLTZMANN_EV) * (1 / (temp + 273) - 1 / 298)) : 1);
      const w = weighted(prof, (temp) => {
        const f = piT(temp);
        return { lambda: lb * f * piP * piS * piQ * (env.piE ?? 0), factor: f };
      }, (ph) => ph.tac + rise);
      return result(t, env, w, [
        ['λ_b', fmtE(lb), st ? `style ${st.name ?? st.id}` : ''],
        ['π_T', st?.t ? `exp(−${ea}/k·[1/(T+273) − 1/298])` : '1', st?.t ? `column ${st.t}, per phase, below` : 'no temperature factor for this style'],
        ['π_P', fmtE(piP), `P^0.39, P = ${fmtE(P)} W${(p.power || 0) < 0.001 ? ' (the table starts at 0.001 W)' : ''}`],
        ['π_S', fmtE(piS), st?.s ? `${a}·e^(${b}·S), S = ${fmtE(S)}` : 'no stress factor for this style'],
        ['π_Q', fmtE(piQ), ''],
      ], { tempLabel: 'T', operatingLabel: 'π_T' });
    },
  },
};
