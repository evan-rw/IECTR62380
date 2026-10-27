// Circuit board: plated-through-hole barrel fatigue, the IPC-TR-579 model as
// published by Sharon (2014) and Brillhart et al. (2002). Each hole size gets
// a cycles-to-failure life under the mission profile's thermal cycles and the
// assembly reflows; the weakest hole size sets the board's rate, averaged over
// the mission length the same way as the surface-mount check (217F 16.2).
// Pure functions. Lengths in mm (plating in µm), stresses and moduli in MPa.

import { PTH_MODEL, COPPER, LAMINATES } from './tablesboard.js';
import { lifeRate } from './smt.js';

const HOURS_PER_YEAR = 8760;
const ROOM = 25;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ∫ α_z dT between two temperatures, in ppm·°C: α1 below Tg, α2 above.
export function zExpansion(lam, tA, tB) {
  const lo = Math.min(tA, tB);
  const hi = Math.max(tA, tB);
  const below = Math.max(0, Math.min(hi, lam.tg) - lo);
  const above = Math.max(0, hi - Math.max(lo, lam.tg));
  return lam.alpha1 * below + lam.alpha2 * above;
}

// Barrel stress and strain range for one thermal cycle (IPC-TR-579 equations 8 and 9).
export function barrelStrain({ thickness, drill, platingUm, lam, tLow, tHigh, copper = COPPER }) {
  const h = thickness;
  const d = drill;
  const t = platingUm / 1000;
  const mismatch = Math.abs(zExpansion(lam, tLow, tHigh) - copper.alpha * Math.abs(tHigh - tLow)) * 1e-6;
  const areaE = (Math.PI / 4) * ((h + d) ** 2 - d ** 2);
  const areaCu = (Math.PI / 4) * (d ** 2 - (d - 2 * t) ** 2);
  const EE = lam.modulus;
  const { modulus: ECu, tangent: Et, yield: Sy } = copper;
  const elastic = (mismatch * areaE * EE * ECu) / (areaE * EE + areaCu * ECu);
  if (elastic <= Sy) return { areaE, areaCu, mismatch, stress: elastic, strain: elastic / ECu, plastic: false };
  const stress = ((mismatch + (Sy * (ECu - Et)) / (ECu * Et)) * areaE * EE * Et) / (areaE * EE + areaCu * Et);
  return { areaE, areaCu, mismatch, stress, strain: Sy / ECu + (stress - Sy) / Et, plastic: true };
}

// Equation 10: Δε_eff = Δε·K_d·10/K_Q.
export const effectiveStrain = (strain, kd, kq) => (strain * kd * 10) / kq;

// Equation 11 as a residual: zero at the cycles to failure. Ductility as a fraction.
export const fatigueResidual = (N, strain, ductility, strength, modulus = COPPER.modulus) =>
  N ** -0.6 * ductility ** 0.75 + 0.9 * (strength / modulus) * (Math.exp(ductility) / 0.36) ** (0.1785 * Math.log10(1e5 / N)) - strain;

// Solve equation 11 for N_f. The residual falls as N grows, so bisect on log N.
export function cyclesToFailure(strain, ductility, strength, modulus = COPPER.modulus) {
  if (!(strain > 0)) return Infinity;
  const f = (logN) => fatigueResidual(10 ** logN, strain, ductility, strength, modulus);
  let lo = -3;
  let hi = 15;
  if (f(hi) > 0) return Infinity;
  if (f(lo) < 0) return 10 ** lo;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return 10 ** ((lo + hi) / 2);
}

export const laminateOf = (settings) => (settings.laminate === 'custom'
  ? { id: 'custom', label: 'Custom laminate', ...settings.custom, modulus: isNum(settings.custom?.modulus) ? settings.custom.modulus * 1000 : null }
  : LAMINATES.rows.find((r) => r.id === settings.laminate) ?? null);

// Board settings: what is missing, and the thermal loads to evaluate.
export function boardConditions(settings, profile) {
  const problems = [];
  const lam = laminateOf(settings);
  if (!lam) problems.push('Missing: laminate.');
  else if (lam.id === 'custom') {
    const absent = [['tg', 'Tg'], ['alpha1', 'z-axis expansion below Tg'], ['alpha2', 'z-axis expansion above Tg'], ['modulus', 'z-axis modulus']]
      .filter(([k]) => !(k === 'tg' ? isNum(lam.tg) : lam[k] > 0)).map(([, label]) => label);
    if (absent.length) problems.push(`Missing for the custom laminate: ${absent.join(', ')}.`);
  }
  const need = [
    ['thickness', 'board thickness', (v) => v > 0],
    ['ductility', 'plating ductility', (v) => v > 0],
    ['strength', 'plating tensile strength', (v) => v > 0],
    ['kq', 'plating quality K_Q', (v) => v > 0 && v <= 10],
    ['kd', 'strain distribution K_d', (v) => v > 0],
    ['reflows', 'number of reflows', (v) => isNum(v) && v >= 0],
    ['reflowPeak', 'reflow peak temperature', (v) => isNum(v)],
  ];
  const missing = need.filter(([k, , ok]) => !ok(settings[k])).map(([, label]) => label);
  if (missing.length) problems.push(`Missing: ${missing.join(', ')}.`);
  const field = (profile.phases ?? []).filter((ph) => ph.n > 0 && ph.dT > 0).map((ph, i) => {
    const mid = isNum(ph.tac) ? ph.tac : ROOM;
    return { label: ph.name || `Phase ${i + 1}`, tLow: mid - ph.dT / 2, tHigh: mid + ph.dT / 2, cyclesPerHour: ph.n / HOURS_PER_YEAR };
  });
  const assembly = isNum(settings.reflows) && settings.reflows > 0 && isNum(settings.reflowPeak)
    ? { label: 'Assembly reflows', tLow: ROOM, tHigh: settings.reflowPeak, count: settings.reflows } : null;
  return { lam, field, assembly, problems };
}

// One hole size: cycles to failure for each load, the life left after assembly, and the rate.
export function evaluateHole(hole, settings, conditions, lcHours) {
  const missing = [];
  if (!(hole.drill > 0)) missing.push('drill');
  if (!(hole.plating > 0)) missing.push('plating');
  if (missing.length || conditions.problems.length) return { missing, complete: false };
  if (2 * hole.plating / 1000 >= hole.drill) return { missing: ['plating'], complete: false, problem: 'The plating fills the hole.' };
  const life = (load) => {
    const geo = barrelStrain({ thickness: settings.thickness, drill: hole.drill, platingUm: hole.plating, lam: conditions.lam, tLow: load.tLow, tHigh: load.tHigh });
    const strainEff = effectiveStrain(geo.strain, settings.kd, settings.kq);
    return { ...load, ...geo, strainEff, nf: cyclesToFailure(strainEff, settings.ductility / 100, settings.strength) };
  };
  const field = conditions.field.map(life);
  const assembly = conditions.assembly ? life(conditions.assembly) : null;
  // Miner's rule: the reflows use up part of the life before service starts.
  const used = assembly ? assembly.count / assembly.nf : 0;
  if (used >= 1) return { missing, complete: true, cracked: true, field, assembly, used };
  const damagePerHour = field.reduce((s, l) => s + l.cyclesPerHour / l.nf, 0);
  const alphaHours = damagePerHour > 0 ? (1 - used) / damagePerHour : Infinity;
  const { ratio, ecf, perHour } = lifeRate(alphaHours, lcHours);
  return { missing, complete: true, cracked: false, field, assembly, used, alphaHours, ratio, ecf, fit: perHour * 1e9 };
}

// The board: every hole size, and the weakest.
export function evaluateBoard(settings, profile, years) {
  const conditions = boardConditions(settings, profile);
  const lcHours = (isNum(years) ? years : 0) * HOURS_PER_YEAR;
  const problems = [...conditions.problems];
  if (!(lcHours > 0)) problems.push('Set the mission length: it is the design life the wear-out is averaged over.');
  const holes = (settings.holes ?? []).map((hole) => ({ hole, ...evaluateHole(hole, settings, { ...conditions, problems }, lcHours) }));
  for (const r of holes) if (r.problem) problems.push(`${r.hole.label || 'A hole size'}: ${r.problem}`);
  const cracked = holes.filter((r) => r.cracked);
  for (const r of cracked) {
    problems.push(`${r.hole.label || 'A hole size'} is predicted to crack during assembly: the reflows use ${Math.round(r.used * 100)} % of its life.`);
  }
  const rated = holes.filter((r) => r.complete && !r.cracked);
  const worst = cracked.length ? null : rated.reduce((w, r) => (!w || r.fit > w.fit ? r : w), null);
  return {
    problems,
    conditions,
    holes,
    worst,
    cracked: cracked.length,
    incomplete: holes.filter((r) => !r.complete).length,
    fit: worst ? worst.fit : 0,
  };
}

export const qualityBand = (kq) => PTH_MODEL.qualityBands.find((b) => kq >= b.min)?.label ?? null;
