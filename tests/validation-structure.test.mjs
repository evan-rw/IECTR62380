// Validation of the reliability structure maths against references that do not
// share its code: textbook k-of-n formulas, and a Monte Carlo simulation that
// draws a failure time for every part and plays the structure out.
//
// What the simulation encodes (the model the page describes):
// - every part fails at an exponentially distributed time with its own rate;
// - a part whose nearest enclosing block is redundant (k of n), reached only
//   through series blocks, breaks that block outright with probability
//   shortPct/100 (a short), otherwise it only takes out its member;
// - a series block fails at its first failure; a redundant block fails when more
//   than n − k members have failed or at its first critical failure; a
//   redundant block inside another counts as one member, and its parts' shorts
//   stay inside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildStructure, evaluateStructure, groupSurvival } from '../assets/structure.js';
import { computeBoard } from '../assets/models.js';

const HOURS = 8760;

// Seeded generator (mulberry32), so a failure can be reproduced.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Parts lines of fixed rates (FIT per piece) and the evaluated structure.
function evaluate(lines, children, years = 10) {
  const board = computeBoard({
    profile: { phases: [{ tac: 25, tau: 1, n: 0, dT: 0 }] },
    components: lines.map((l, i) => ({ id: `ln${i}`, ref: l.ref, qty: l.qty, model: 'fixed', params: { fit: l.fit } })),
  });
  return evaluateStructure(buildStructure({ kind: 'block', children }, board.items), years);
}

// A random structure: blocks nest up to three deep, mixing series and k-of-n,
// with 0–50 % critical shares. Returns the saved form, the parts lines, and a
// plain tree for the simulation.
function randomStructure(rand) {
  const lines = [];
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const prefix = () => String.fromCharCode(65 + Math.floor(lines.length / 26)) + String.fromCharCode(65 + (lines.length % 26));
  const leaf = () => {
    const qty = 1 + Math.floor(rand() * 3);
    const p = prefix();
    const line = { ref: qty === 1 ? `${p}1` : `${p}1–${p}${qty}`, qty, fit: Math.round(300 + rand() * 6000) };
    lines.push(line);
    return { saved: { kind: 'leaf', refs: line.ref }, sim: { kind: 'leaf', qty, lambda: line.fit * 1e-9 } };
  };
  const block = (depth) => {
    const kids = [];
    const count = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) kids.push(depth < 3 && rand() < 0.4 ? block(depth + 1) : leaf());
    const members = kids.reduce((s, k) => s + (k.sim.kind === 'leaf' ? k.sim.qty : 1), 0);
    const kofn = rand() < 0.65;
    const need = kofn ? 1 + Math.floor(rand() * members) : null;
    const shortPct = kofn ? pick([0, 5, 20, 50]) : null;
    return {
      saved: { kind: 'block', name: `b${depth}`, mode: kofn ? 'kofn' : 'series', need, shortPct, children: kids.map((k) => k.saved) },
      sim: { kind: 'block', kofn, need, c: kofn ? shortPct / 100 : 0, children: kids.map((k) => k.sim) },
    };
  };
  const top = [block(1), block(1)];
  // One line left unplaced: it counts in series under "Everything else".
  const rest = leaf();
  return { lines, children: top.map((b) => b.saved), sim: { kind: 'block', kofn: false, children: [...top.map((b) => b.sim), rest.sim] } };
}

// One simulated board: the time at which it fails.
function simulate(node, rand, scope = null) {
  const draw = (lambda) => -Math.log(1 - rand()) / lambda;
  if (node.kind !== 'block') throw new Error('leaves are handled by their block');
  const own = node.kofn ? { c: node.c, critical: Infinity } : scope;
  const times = [];
  for (const child of node.children) {
    if (child.kind === 'leaf') {
      for (let i = 0; i < child.qty; i++) {
        const t = draw(child.lambda);
        if (own && rand() < own.c) own.critical = Math.min(own.critical, t);
        times.push(t);
      }
    } else {
      times.push(simulate(child, rand, own));
    }
  }
  if (!node.kofn) return Math.min(...times);
  times.sort((a, b) => a - b);
  return Math.min(times[times.length - node.need], own.critical);
}

test('nested structures agree with a Monte Carlo simulation', () => {
  const N = 40000;
  for (let seed = 1; seed <= 8; seed++) {
    const rand = rng(seed);
    const s = randomStructure(rand);
    const ev = evaluate(s.lines, s.children);
    assert.equal(ev.redundancy, true);
    for (const id of ev.red) assert.deepEqual(ev.prob.get(id), [], 'every generated block is complete');
    const samples = Float64Array.from({ length: N }, () => simulate(s.sim, rand));
    // Survival at several times, within 4.5 standard errors.
    for (const years of [2, 10, 25]) {
      const t = years * HOURS;
      const R = ev.survival(t);
      const mc = samples.reduce((n, x) => n + (x > t), 0) / N;
      const se = Math.sqrt(Math.max(R * (1 - R), 1e-4) / N);
      assert.ok(Math.abs(mc - R) <= 4.5 * se, `seed ${seed}, ${years} y: model R = ${R.toFixed(5)}, simulation ${mc.toFixed(5)} ± ${se.toFixed(5)}`);
    }
    // Mean time to failure, against the sample mean.
    const mean = samples.reduce((a, b) => a + b, 0) / N;
    const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (N - 1));
    assert.ok(Math.abs(mean - ev.mttfHours) <= 4.5 * sd / Math.sqrt(N), `seed ${seed}: model MTTF ${ev.mttfHours.toFixed(0)} h, simulation ${mean.toFixed(0)} ± ${(sd / Math.sqrt(N)).toFixed(0)} h`);
    // The headline rate is the mission average −ln R(T)/T.
    assert.ok(Math.abs(ev.board.fit - (-Math.log(ev.survival(10 * HOURS)) / (10 * HOURS)) * 1e9) <= 1e-9 * ev.board.fit);
  }
});

test('k-of-n of identical parts matches the textbook formulas', () => {
  const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  for (const [k, n] of [[1, 2], [2, 3], [3, 5], [4, 4], [1, 6]]) {
    const fit = 20000;
    const lambda = fit * 1e-9;
    const refs = `C1–C${n}`;
    const ev = evaluate([{ ref: refs, qty: n, fit }], [{ kind: 'block', name: 'x', mode: 'kofn', need: k, shortPct: 0, children: [{ kind: 'leaf', refs }] }]);
    // R(t) = Σ_{i=k..n} C(n,i) e^(−iλt) (1 − e^(−λt))^(n−i)
    for (const t of [5000, 50000, 200000]) {
      const p = Math.exp(-lambda * t);
      let R = 0;
      for (let i = k; i <= n; i++) R += binom(n, i) * p ** i * (1 - p) ** (n - i);
      assert.ok(Math.abs(ev.survival(t) - R) <= 1e-12, `${k} of ${n} at ${t} h: ${ev.survival(t)} vs ${R}`);
    }
    // MTTF = (1/λ) Σ_{i=k..n} 1/i
    let H = 0;
    for (let i = k; i <= n; i++) H += 1 / i;
    assert.ok(Math.abs(ev.mttfHours - H / lambda) <= 1e-4 * (H / lambda), `${k} of ${n}: MTTF ${ev.mttfHours} vs ${H / lambda}`);
  }
});

test('a critical share of 100 % turns a redundant block back into series', () => {
  const lines = [{ ref: 'C1–C4', qty: 4, fit: 5000 }];
  const kofn = evaluate(lines, [{ kind: 'block', name: 'x', mode: 'kofn', need: 1, shortPct: 100, children: [{ kind: 'leaf', refs: 'C1–C4' }] }]);
  const series = evaluate(lines, []);
  for (const t of [1000, 87600, 500000]) assert.ok(Math.abs(kofn.survival(t) - series.survival(t)) <= 1e-12 * series.survival(t));
  assert.ok(Math.abs(groupSurvival([5000, 5000, 5000, 5000], 1, 100, 87600) - Math.exp(-20000e-9 * 87600)) < 1e-12);
});
