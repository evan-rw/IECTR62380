// Reliability structure: which parts back each other up.
//
// By default every part is in series: any failure fails the board, and the
// board failure rate is the sum of the part rates. A group can instead be
// marked redundant: the group keeps working while at least `need` of its n
// members work. A share `shortPct` of each member's failures (a capacitor
// short that takes the rail down, say) breaks the group at once, whatever
// the redundancy. Redundant groups have no constant failure rate, so they
// are evaluated over the mission time T:
//
//   R_group(T) = exp(−c·Σλ_i·T) × P(at most n − need members failed by T)
//
// with c = shortPct/100 and member i failing benignly with probability
// 1 − exp(−(1 − c)·λ_i·T). The board's mission-average failure rate is
// −ln R_board(T) / T. Pure functions, no DOM.

import { expandRefs } from './netlist.js';

const HOURS_PER_YEAR = 8760;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Probability that at most `allowed` of the members fail, member i failing
// with probability p[i] (Poisson-binomial, by dynamic programming).
export function atMostFailing(p, allowed) {
  let dist = [1];
  for (const pi of p) {
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((d, k) => {
      next[k] += d * (1 - pi);
      next[k + 1] += d * pi;
    });
    dist = next;
  }
  return dist.slice(0, allowed + 1).reduce((s, d) => s + d, 0);
}

// Survival of one redundant group at time t (hours); rates in FIT.
export function groupSurvival(fits, need, shortPct, t) {
  const c = shortPct / 100;
  const perHour = fits.map((f) => f * 1e-9);
  const critical = c * perHour.reduce((s, l) => s + l, 0);
  const p = perHour.map((l) => 1 - Math.exp(-(1 - c) * l * t));
  return Math.exp(-critical * t) * atMostFailing(p, fits.length - need);
}

// Check a group's inputs. Returns the problems that stop it counting as redundant.
export function groupProblems(group, members) {
  const problems = [];
  if (members.unknown.length) problems.push(`Not in the parts list: ${members.unknown.join(', ')}.`);
  if (members.duplicate.length) problems.push(`Also in another group: ${members.duplicate.join(', ')}.`);
  if (group.mode !== 'redundant') return problems;
  const n = members.refs.length;
  if (n < 2) problems.push('A redundant group needs at least two parts.');
  if (!isNum(group.need)) problems.push('Missing: how many parts must keep working.');
  else if (!Number.isInteger(group.need) || group.need < 1 || group.need > n) problems.push(`The number that must keep working must be a whole number from 1 to ${n}.`);
  if (!isNum(group.shortPct)) problems.push('Missing: share of failures that break the group anyway.');
  else if (group.shortPct < 0 || group.shortPct > 100) problems.push('The share of failures must be between 0 and 100%.');
  if (members.incomplete.length) problems.push(`Members still need input: ${members.incomplete.join(', ')}.`);
  return problems;
}

// items: [{ comp, result }] from computeBoard; groups: board groups; years: mission length.
export function computeStructure(items, groups, years) {
  const T = (isNum(years) ? years : 0) * HOURS_PER_YEAR;

  // Each reference's per-piece rate, from lines whose reference list matches their quantity.
  const byRef = new Map();
  for (const { comp, result } of items) {
    const refs = expandRefs(comp.ref);
    if (refs.length !== result.qty) continue;
    for (const ref of refs) byRef.set(ref, { comp, result });
  }

  const claimed = new Set();
  const evaluated = groups.map((group) => {
    const refs = [];
    const unknown = [];
    const duplicate = [];
    const incomplete = [];
    for (const ref of expandRefs(group.refs ?? '')) {
      if (!byRef.has(ref)) unknown.push(ref);
      else if (claimed.has(ref)) duplicate.push(ref);
      else {
        refs.push(ref);
        if (!byRef.get(ref).result.complete) incomplete.push(ref);
      }
    }
    refs.forEach((r) => claimed.add(r));
    const members = { refs, unknown, duplicate, incomplete };
    const problems = groupProblems(group, members);
    if (group.mode === 'redundant' && !problems.length && T <= 0) problems.push('Set the mission length to evaluate redundancy.');
    const fits = refs.map((r) => byRef.get(r).result.fit);
    // Like the board total, a series subtotal leaves out members still missing input.
    const sum = refs.reduce((s, r) => s + (byRef.get(r).result.complete ? byRef.get(r).result.fit : 0), 0);
    const redundant = group.mode === 'redundant' && problems.length === 0;
    const R = redundant ? groupSurvival(fits, group.need, group.shortPct, T) : Math.exp(-sum * 1e-9 * T);
    const fit = redundant ? (R > 0 ? (-Math.log(R) / T) * 1e9 : Infinity) : sum;
    return { group, refs, fits, sum, redundant, R, fit, problems };
  });

  // Series part of the board: every complete line, minus members of redundant groups.
  const inRedundant = new Set(evaluated.filter((g) => g.redundant).flatMap((g) => g.refs));
  let seriesFit = 0;
  for (const { comp, result } of items) {
    if (!result.complete) continue;
    const refs = expandRefs(comp.ref);
    const removed = refs.length === result.qty ? refs.filter((r) => inRedundant.has(r)).length : 0;
    seriesFit += result.fit * (result.qty - removed);
  }

  const active = evaluated.filter((g) => g.redundant);
  const boardFit = seriesFit + active.reduce((s, g) => s + g.fit, 0);
  const survival = (t) => Math.exp(-seriesFit * 1e-9 * t) * active.reduce((s, g) => s * groupSurvival(g.fits, g.group.need, g.group.shortPct, t), 1);
  return {
    groups: evaluated,
    seriesFit,
    boardFit,
    redundancy: active.length > 0,
    survival,
    mttfHours: active.length ? meanTimeToFailure(survival) : (seriesFit > 0 ? 1e9 / seriesFit : Infinity),
  };
}

// ∫ R(t) dt from 0 to ∞, by Simpson's rule up to where R has decayed.
export function meanTimeToFailure(R) {
  let tMax = 1e4;
  while (R(tMax) > 1e-12 && tMax < 1e15) tMax *= 2;
  if (R(tMax) > 1e-12) return Infinity;
  const n = 20000;
  const h = tMax / n;
  let s = R(0) + R(tMax);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * R(i * h);
  return (s * h) / 3;
}
