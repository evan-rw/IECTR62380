// The mean time to failure of a board with redundant blocks is an integral of its
// survival, and every survival value walks the whole tree. A fixed 20,000-point
// Simpson rule made each structure edit cost 0.2–0.9 s on a large import with
// accepted blocks. The integral now samples where the curve needs it; these tests
// hold the number of samples down and the answer to closed forms and to an
// independent integrator, never to assets/structure.js itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBoard } from '../assets/models.js';
import { buildStructure, evaluateStructure, meanTimeToFailure, ROOT } from '../assets/structure.js';

const PROFILE = { phases: [{ tac: 25, tau: 1, n: 0, dT: 0 }] };
const YEARS = 10;

// A board like a large import after review: `nBlocks` accepted 1-of-3 banks of
// identical parts at `lam` FIT with a critical share `c`, and `nSeries` other lines.
function board({ nBlocks, nSeries, lam = 50, c = 0.1, seriesFit = 20 }) {
  const components = [];
  const children = [];
  for (let b = 0; b < nBlocks; b++) {
    const ref = `C${3 * b + 1}–C${3 * b + 3}`;
    components.push({ id: `b${b}`, ref, qty: 3, model: 'fixed', params: { fit: lam }, inferred: {} });
    children.push({ kind: 'block', name: `${ref} in parallel`, mode: 'kofn', need: 1, shortPct: c * 100, children: [{ kind: 'leaf', refs: ref }] });
  }
  for (let s = 0; s < nSeries; s++) components.push({ id: `s${s}`, ref: `R${s + 1}`, qty: 1, model: 'fixed', params: { fit: seriesFit }, inferred: {} });
  const items = computeBoard({ profile: PROFILE, components }).items;
  return buildStructure({ kind: 'block', id: ROOT, children }, items);
}

// Survival of that board by listing outcomes per part: works e^-λt, failed
// harmlessly (1-c)(1-e^-λt), failed critically c(1-e^-λt). A 1-of-3 bank survives
// with no critical failure and at least one part working.
function closedR(t, { nBlocks, nSeries, lam = 50, c = 0.1, seriesFit = 20 }) {
  const w = Math.exp(-lam * 1e-9 * t);
  const h = (1 - c) * (1 - w);
  return Math.exp(-nSeries * seriesFit * 1e-9 * t) * ((w + h) ** 3 - h ** 3) ** nBlocks;
}

// Independent integrator: composite Simpson on a fine grid out to R < 1e-15.
function integrate(R) {
  let tMax = 1e4;
  while (R(tMax) > 1e-15) tMax *= 1.5;
  const n = 400000;
  const hh = tMax / n;
  let s = R(0) + R(tMax);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * R(i * hh);
  return (s * hh) / 3;
}

test('a board with 34 accepted blocks needs few survival evaluations', () => {
  const spec = { nBlocks: 34, nSeries: 60 };
  const ev = evaluateStructure(board(spec), YEARS);
  let n = 0;
  meanTimeToFailure((t) => { n++; return ev.survival(t); });
  assert.ok(n < 2000, `${n} survival evaluations (the fixed rule used 20,017)`);
});

test('the integral holds to closed forms with few samples', () => {
  const lam = 1000e-9;
  for (const [name, R, want] of [
    ['one part', (t) => Math.exp(-lam * t), 1 / lam],
    ['1 of 2', (t) => 2 * Math.exp(-lam * t) - Math.exp(-2 * lam * t), 3 / (2 * lam)],
    ['2 of 3', (t) => 3 * Math.exp(-2 * lam * t) - 2 * Math.exp(-3 * lam * t), 5 / (6 * lam)],
    ['1 of 3', (t) => 3 * Math.exp(-lam * t) - 3 * Math.exp(-2 * lam * t) + Math.exp(-3 * lam * t), 11 / (6 * lam)],
    ['a very reliable part', (t) => Math.exp(-1e-12 * t), 1e12],
  ]) {
    let n = 0;
    const got = meanTimeToFailure((t) => { n++; return R(t); });
    assert.ok(Math.abs(got - want) / want < 1e-9, `${name}: ${got} vs ${want}`);
    assert.ok(n < 2000, `${name}: ${n} evaluations`);
  }
});

test('the mean time to failure still matches the closed form (34 blocks)', () => {
  const spec = { nBlocks: 34, nSeries: 60 };
  const ev = evaluateStructure(board(spec), YEARS);
  const want = integrate((t) => closedR(t, spec));
  assert.ok(Math.abs(ev.mttfHours - want) / want < 1e-6, `${ev.mttfHours} vs ${want}`);
  const T = YEARS * 8760;
  assert.ok(Math.abs(ev.survival(T) - closedR(T, spec)) / closedR(T, spec) < 1e-9);
});

test('the mean time to failure matches the textbook 1-of-2 formula', () => {
  // One 1-of-2 pair (no critical share) in series with the rest:
  // MTTF = 2/(Λs + λ) - 1/(Λs + 2λ).
  const components = [
    { id: 'p', ref: 'C1, C2', qty: 2, model: 'fixed', params: { fit: 1000 }, inferred: {} },
    { id: 's', ref: 'R1', qty: 1, model: 'fixed', params: { fit: 300 }, inferred: {} },
  ];
  const items = computeBoard({ profile: PROFILE, components }).items;
  const rt = buildStructure({ kind: 'block', id: ROOT, children: [{ kind: 'block', mode: 'kofn', need: 1, shortPct: 0, children: [{ kind: 'leaf', refs: 'C1, C2' }] }] }, items);
  const ev = evaluateStructure(rt, YEARS);
  const ls = 300e-9;
  const l = 1000e-9;
  const want = 2 / (ls + l) - 1 / (ls + 2 * l);
  assert.ok(Math.abs(ev.mttfHours - want) / want < 1e-7, `${ev.mttfHours} vs ${want}`);
});
