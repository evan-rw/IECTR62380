// Surface-mount solder joints, MIL-HDBK-217F Notice 2 section 16.2: a board-
// level wear-out check. Each candidate device's thermal-cycling life is
// worked out; the worst device (the "weakest link") sets the board's rate,
// averaged over the design life. Pure functions; lengths in millimetres at
// the interface, converted to the handbook's mils inside.

import { SMT_217F, ENVIRONMENTS } from './tables217f.js';
import { FLEX } from './tablesmaker.js';

const MM_PER_MIL = 0.0254;
const HOURS_PER_YEAR = 8760;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const find = (rows, id) => rows.find((r) => r.id === id);

// N_f = 3.5·(d/(0.65·h)·|α_S·ΔT − α_CC·(ΔT + T_RISE)|·10⁻⁶)^−2.26·π_LC, d and h in mils.
export function cyclesToFailure({ dMils, hMils, alphaS, alphaCC, dT, tRise, piLC }) {
  const strain = (dMils / (0.65 * hMils)) * Math.abs(alphaS * dT - alphaCC * (dT + tRise)) * 1e-6;
  return strain > 0 ? 3.5 * strain ** -2.26 * piLC : Infinity;
}

// Effective cumulative failures for LC/α_SMT.
export const ecfFor = (ratio) => SMT_217F.ecf.find(([upTo]) => ratio <= upTo)[1];

// Rate over the design life: ECF/α_SMT, per hour; α_SMT in hours.
export function lifeRate(alphaHours, lcHours) {
  if (!(alphaHours > 0) || !Number.isFinite(alphaHours)) return { ratio: 0, ecf: 0, perHour: 0 };
  const ratio = lcHours / alphaHours;
  const ecf = ecfFor(ratio);
  return { ratio, ecf, perHour: ecf / alphaHours };
}

// What the board-level settings give: α_S, and the thermal cycles to evaluate.
// From the mission profile each phase with cycles is its own load, combined
// with Miner's rule (with one phase this is exactly N_f/CR); otherwise CR and
// ΔT come from the handbook's equipment and environment tables.
export function smtConditions(settings, profile) {
  const problems = [];
  const substrate = find(SMT_217F.substrates, settings.substrate);
  if (!substrate) problems.push('Missing: board substrate.');
  let loads = [];
  if (settings.cycling === 'handbook') {
    const equipment = find(SMT_217F.equipment, settings.equipment);
    const envIndex = Math.max(0, ENVIRONMENTS.findIndex((e) => e.id === (profile.env217f ?? 'GB')));
    const dT = SMT_217F.deltaT[envIndex];
    if (!equipment) problems.push('Missing: equipment type for the cycling rate.');
    if (dT == null) problems.push(`MIL-HDBK-217F gives no temperature difference for ${ENVIRONMENTS[envIndex].id}.`);
    if (equipment && dT != null) loads = [{ dT, cyclesPerHour: equipment.cr, label: `${equipment.label}, ${ENVIRONMENTS[envIndex].id}` }];
  } else {
    loads = (profile.phases ?? []).filter((ph) => ph.n > 0 && ph.dT > 0)
      .map((ph, i) => ({ dT: ph.dT, cyclesPerHour: ph.n / HOURS_PER_YEAR, label: ph.name || `Phase ${i + 1}` }));
    if (!loads.length) problems.push('The mission profile has no thermal cycles (n and ΔT) to wear the joints.');
  }
  return { alphaS: substrate?.alphaS ?? null, loads, problems };
}

// One candidate device: its inputs, what is missing, and its life and rate.
export function evaluateDevice(device, conditions, lcHours) {
  const lead = find(SMT_217F.leads, device.lead);
  const body = find(SMT_217F.bodies, device.body);
  const missing = [];
  if (!lead) missing.push('lead');
  if (!body) missing.push('body');
  if (!(device.d > 0)) missing.push('d');
  const leadless = device.lead === 'leadless';
  if (leadless && !(device.h > 0)) missing.push('h');
  if (!isNum(device.rise)) missing.push('rise');
  if (missing.length || conditions.problems.length) return { missing, complete: false };
  const dMils = device.d / MM_PER_MIL;
  const hMils = leadless ? device.h / MM_PER_MIL : SMT_217F.leadedHeight;
  // Miner's rule: damage per hour = Σ cycles per hour / N_f for each load.
  const perLoad = conditions.loads.map((load) => {
    const nf = cyclesToFailure({ dMils, hMils, alphaS: conditions.alphaS, alphaCC: body.alphaCC, dT: load.dT, tRise: device.rise, piLC: lead.piLC });
    return { ...load, nf };
  });
  const damagePerHour = perLoad.reduce((s, l) => s + l.cyclesPerHour / l.nf, 0);
  const alphaHours = damagePerHour > 0 ? 1 / damagePerHour : Infinity;
  const { ratio, ecf, perHour } = lifeRate(alphaHours, lcHours);
  return { missing, complete: true, dMils, hMils, perLoad, alphaHours, ratio, ecf, fit: perHour * 1e9 };
}

// The board: every candidate, and the weakest link.
export function evaluateSmt(settings, profile, years) {
  const conditions = smtConditions(settings, profile);
  const lcHours = (isNum(years) ? years : 0) * HOURS_PER_YEAR;
  const problems = [...conditions.problems];
  if (!(lcHours > 0)) problems.push('Set the mission length: it is the design life the wear-out is averaged over.');
  const devices = (settings.devices ?? []).map((d) => ({ device: d, ...evaluateDevice(d, { ...conditions, problems }, lcHours) }));
  const complete = devices.filter((r) => r.complete);
  const worst = complete.reduce((w, r) => (!w || r.fit > w.fit ? r : w), null);
  return {
    problems,
    conditions,
    devices,
    worst,
    incomplete: devices.length - complete.length,
    fit: worst ? worst.fit : 0,
  };
}

// Chip sizes by EIA code: body length in millimetres (the metric code's first figure).
// Tantalum footprints use the metric case codes (A 3216, B 3528, C 6032, D 7343).
const CHIP_LENGTH_MM = {
  '01005': 0.4, '0201': 0.6, '0402': 1.0, '0603': 1.6, '0805': 2.0, '1206': 3.2, '1210': 3.2,
  '1808': 4.5, '1812': 4.5, '1825': 4.5, '2010': 5.0, '2220': 5.7, '2225': 5.7, '2512': 6.4,
  '3216': 3.2, '3528': 3.5, '6032': 6.0, '7343': 7.3,
};
const CHIP_CODE = new RegExp(`(?:^|[^0-9])(${Object.keys(CHIP_LENGTH_MM).join('|')})(?![0-9])`);

export const chipCodeOf = (text) => CHIP_CODE.exec(String(text ?? '').split(':').pop())?.[1] ?? null;

// Candidate devices for the chip capacitors and resistors on the board, one per
// chip size and body: leadless, d = half the body length. The joint height is
// left for the user; the body material and zero self-heating are guesses.
export function chipCandidates(parts) {
  const groups = new Map();
  for (const part of parts) {
    const isCap = ['capacitor', 'mil-capacitor', 'tantalum-maker', 'ceramic-test'].includes(part.model);
    const isRes = part.model === 'resistor' || part.model === 'mil-resistor';
    if (!isCap && !isRes) continue;
    const src = part.source ?? {};
    const code = chipCodeOf(src.footprint) ?? chipCodeOf(src.description) ?? chipCodeOf(src.value);
    if (!code) continue;
    // Tantalum chips are moulded in plastic; ceramic capacitors and thick-film resistors have ceramic bodies.
    const tantalum = part.model === 'tantalum-maker' || part.params?.type === 'tantalum-solid' || ['CSR', 'CWR'].includes(part.params?.style);
    const body = tantalum ? 'plastic' : 'ceramic';
    const kind = tantalum ? 'tantalum chip' : isCap ? 'ceramic chip capacitor' : 'chip resistor';
    const auto = `chip-${code}-${tantalum ? 'tantalum' : isCap ? 'capacitor' : 'resistor'}`;
    const g = groups.get(auto) ?? { auto, code, body, kind, refs: [] };
    g.refs.push(part.ref);
    groups.set(auto, g);
  }
  return [...groups.values()].map((g) => ({
    auto: g.auto,
    label: `${g.refs.join(', ')} (${g.code} ${g.kind})`,
    lead: 'leadless',
    body: g.body,
    d: CHIP_LENGTH_MM[g.code] / 2,
    h: null,
    rise: 0,
    inferred: {
      d: `half the ${g.code} body length (${CHIP_LENGTH_MM[g.code]} mm)`,
      body: g.body === 'plastic' ? 'tantalum chips are moulded in plastic' : 'ceramic body',
      rise: 'a chip passive: self-heating taken as 0',
    },
  }));
}

// Ceramic chip capacitors large enough to crack when the board bends, unless
// their text says they have soft (flexible) terminations. No rate model counts
// flex cracks, so these are flagged rather than charged.
const SOFT_TERMINATION = /SOFT|FLEX|\bF[TF]-?CAP|\bGCJ/;
const CERAMIC_STYLES = ['CK', 'CKR', 'CC', 'CDR'];
export function flexRisks(parts) {
  const risks = [];
  for (const part of parts) {
    const p = part.params ?? {};
    const ceramic = (part.model === 'capacitor' && /^ceramic/.test(p.type ?? ''))
      || (part.model === 'mil-capacitor' && CERAMIC_STYLES.includes(p.style)) || part.model === 'ceramic-test';
    if (!ceramic) continue;
    const src = part.source ?? {};
    const code = chipCodeOf(src.footprint) ?? chipCodeOf(src.description) ?? chipCodeOf(src.value);
    const text = [src.value, src.description, src.footprint, p.note].filter(Boolean).join(' ').toUpperCase();
    if (FLEX.sizes.includes(code) && !SOFT_TERMINATION.test(text)) risks.push({ ref: part.ref, code });
  }
  return risks;
}
