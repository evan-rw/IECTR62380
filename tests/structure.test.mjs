import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ROOT, REST, atMostFailing, groupSurvival, meanTimeToFailure, buildStructure, serializeStructure,
  evaluateStructure, migrateGroups, groupNodes, ungroupNodes, moveNodes, splitLeaves, selectRefs, label, members,
} from '../assets/structure.js';
import { computeBoard } from '../assets/models.js';
import { netlistToParts } from '../assets/netlist.js';

const close = (actual, expected, rel = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected), `expected ${expected}, got ${actual}`);

const T10 = 10 * 8760; // ten years in hours

// "Other part" lines with given per-piece rates (FIT); null makes a line incomplete.
const items = (lines) => computeBoard({
  profile: { phases: [{ tac: 25, tau: 1, n: 0, dT: 0 }] },
  components: lines.map(([ref, qty, fit], i) => ({ id: `ln${i}`, ref, qty, model: 'fixed', params: { fit } })),
}).items;
const block = (refs, extra = {}) => ({ kind: 'block', name: refs, mode: 'kofn', children: [{ kind: 'leaf', refs }], ...extra });
const evaluate = (lines, children, years = 10) => {
  const rt = buildStructure({ kind: 'block', children }, items(lines));
  return { rt, ev: evaluateStructure(rt, years) };
};

test('Poisson-binomial tail and flat-group limits', () => {
  close(atMostFailing([0.5, 0.5], 1), 0.75);
  close(atMostFailing([0.1, 0.2, 0.3], 2), 1 - 0.1 * 0.2 * 0.3);
  const series = Math.exp(-600e-9 * T10);
  close(groupSurvival([100, 200, 300], 3, 0, T10), series, 1e-9);
  close(groupSurvival([100, 200, 300], 1, 100, T10), series, 1e-9);
  // Textbook: a 1-of-2 parallel pair has MTTF = 3 / (2λ).
  const lambda = 1e6;
  close(meanTimeToFailure((t) => groupSurvival([lambda, lambda], 1, 0, t)), 3 / (2 * lambda * 1e-9), 1e-4);
});

test('with no blocks everything is in series under "Everything else"', () => {
  const { rt, ev } = evaluate([['U1', 1, 10], ['C1–C4', 4, 2]], []);
  close(ev.board.fit, 18);
  close(ev.board.sfit, 18);
  close(ev.mttfHours, 1e9 / 18);
  assert.equal(ev.redundancy, false);
  assert.deepEqual(rt.nodes.get(REST).children.map((id) => label(rt, id)), ['U1', 'C1–C4']);
});

test('a flat redundant block gives the same result as the previous engine', () => {
  const { ev } = evaluate([['U1', 1, 10], ['C1–C4', 4, 2]], [block('C1–C3', { need: 2, shortPct: 50 })]);
  assert.equal(ev.redundancy, true);
  const g = -Math.log(groupSurvival([2, 2, 2], 2, 50, T10)) / T10 * 1e9;
  close(ev.board.fit, 10 + 2 + g, 1e-9);
  close(ev.board.sfit, 18);
  close(ev.survival(T10), Math.exp(-12e-9 * T10) * groupSurvival([2, 2, 2], 2, 50, T10), 1e-12);
});

test('nested: two series power paths in a 1-of-2 block', () => {
  const lines = [['U2', 1, 12], ['L1', 1, 1.2], ['U3', 1, 12], ['L2', 1, 1.2]];
  const path = (a, b) => ({ kind: 'block', name: a, mode: 'series', children: [{ kind: 'leaf', refs: a }, { kind: 'leaf', refs: b }] });
  const paths = (shortPct) => [{ kind: 'block', name: 'Power', mode: 'kofn', need: 1, shortPct, children: [path('U2', 'L1'), path('U3', 'L2')] }];
  const lam = 13.2e-9;
  // No critical share: R = 1 − (1 − e^(−λt))².
  const q = -Math.expm1(-lam * T10);
  const { ev, rt } = evaluate(lines, paths(0));
  assert.equal(members(rt, [...rt.nodes.values()].find((n) => n.name === 'Power').id), 2);
  close(ev.survival(T10), 1 - q * q, 1e-12);
  // With 20% of failures critical: R = e^(−0.2·2λt) × (1 − q'²), q' = 1 − e^(−0.8λt).
  const q8 = -Math.expm1(-0.8 * lam * T10);
  close(evaluate(lines, paths(20)).ev.survival(T10), Math.exp(-0.2 * 2 * lam * T10) * (1 - q8 * q8), 1e-12);
});

test('deeply nested redundancy keeps its digits', () => {
  // Two 1-of-2 pairs of 1-FIT parts, in a 1-of-2 block: 1 − R ≈ 6e-17, which 1 − R in floating point would lose.
  const lines = [['C1', 1, 1], ['C2', 1, 1], ['C3', 1, 1], ['C4', 1, 1]];
  const pair = (a, b) => ({ kind: 'block', name: a, mode: 'kofn', need: 1, shortPct: 0, children: [{ kind: 'leaf', refs: `${a}, ${b}` }] });
  const { ev } = evaluate(lines, [{ kind: 'block', name: 'Outer', mode: 'kofn', need: 1, shortPct: 0, children: [pair('C1', 'C2'), pair('C3', 'C4')] }]);
  const q = -Math.expm1(-1e-9 * T10);
  const qPair = q * q;
  close(ev.board.fit, (qPair * qPair / T10) * 1e9, 1e-6);
  assert.ok(ev.board.fit > 0);
});

test('problems: missing inputs fall back to series, with the reason', () => {
  const lines = [['C1–C2', 2, 5], ['U1', 1, null]];
  const fallback = (children, pattern, years = 10) => {
    const { rt, ev } = evaluate(lines, children, years);
    const b = [...rt.nodes.values()].find((n) => n.kind === 'block' && !n.fixed);
    assert.match(ev.prob.get(b.id).join(' '), pattern);
    assert.equal(ev.red.has(b.id), false);
    close(ev.board.fit, 10);
  };
  fallback([block('C1–C2', { shortPct: 10 })], /Missing: how many must keep working/);
  fallback([block('C1–C2', { need: 1 })], /Missing: share of failures/);
  fallback([block('C1–C2', { need: 3, shortPct: 10 })], /from 1 to 2/);
  fallback([block('C1–C2', { need: 1, shortPct: 10 })], /Set the mission length/, 0);
  fallback([block('C1, C9', { need: 1, shortPct: 10 })], /Not in the parts list: C9/);
  // A member still missing input.
  const { rt, ev } = evaluate(lines, [block('C1, C2, U1', { need: 1, shortPct: 10 })]);
  assert.match(ev.prob.get([...rt.nodes.values()].find((n) => n.name === 'C1, C2, U1').id).join(' '), /Members still need input: U1/);
  assert.equal(ev.board.missing, 1);
  // A part placed twice counts once.
  const dup = evaluate(lines, [block('C1', { mode: 'series' }), block('C1', { mode: 'series', name: 'again' })]);
  assert.match(dup.ev.prob.get([...dup.rt.nodes.values()].find((n) => n.name === 'again').id).join(' '), /Also placed elsewhere/);
  close(dup.ev.board.fit, 10);
});

test('save, load and version-1 boards', () => {
  const lines = [['U1', 1, 10], ['C1–C4', 4, 2]];
  const saved = { kind: 'block', id: 'board', children: [{ kind: 'block', id: 'bA', name: 'Caps', mode: 'kofn', need: 2, shortPct: 49, inferred: { shortPct: 'from MIL-HDBK-338B' }, children: [{ kind: 'leaf', refs: 'C1–C3' }] }] };
  const rt = buildStructure(saved, items(lines));
  assert.deepEqual(serializeStructure(rt), saved);
  assert.ok(rt.nodes.has('bA'), 'block ids survive a rebuild');
  // Version 1: a flat list of groups.
  const v1 = [{ refs: 'C1–C3', mode: 'redundant', need: 2, shortPct: 50 }, { refs: 'U1', mode: 'series' }];
  const ev = evaluateStructure(buildStructure(migrateGroups(v1), items(lines)), 10);
  close(ev.board.fit, 10 + 2 - Math.log(groupSurvival([2, 2, 2], 2, 50, T10)) / T10 * 1e9, 1e-9);
});

test('editing: find, group, move, split, ungroup', () => {
  const lines = [['U1', 1, 10], ['C1–C4', 4, 2], ['Q1, Q2', 2, 4]];
  const rt = buildStructure(null, items(lines));
  // Find splits the line so exactly the asked-for parts are selected.
  const found = selectRefs(rt, 'C2–C3, X9');
  assert.equal(found.count, 2);
  assert.deepEqual(found.unknown, ['X9']);
  assert.deepEqual(rt.nodes.get(REST).children.map((id) => label(rt, id)).sort(), ['C1, C4', 'C2, C3', 'Q1, Q2', 'U1'].sort());
  // Grouping parts from "Everything else" puts the new block on the board.
  const g = groupNodes(rt, found.ids, 'kofn');
  assert.equal(rt.parent.get(g), ROOT);
  assert.equal(rt.nodes.get(g).name, 'C2, C3 in parallel');
  // Move U1 in; a block cannot move into its own descendant.
  const u1 = rt.nodes.get(REST).children.find((id) => label(rt, id) === 'U1');
  assert.equal(moveNodes(rt, [u1], g), 1);
  const outer = groupNodes(rt, [g], 'series');
  assert.equal(moveNodes(rt, [outer], g), 0);
  // Round trip keeps the nesting.
  const saved = serializeStructure(rt);
  assert.equal(saved.children[0].children[0].children.length, 2);
  const again = buildStructure(saved, items(lines));
  assert.equal(evaluateStructure(again, 10).board.pieces, 7);
  // Split a line into single parts; ungroup the outer block back onto the board.
  const caps = again.nodes.get(REST).children.find((id) => label(again, id) === 'C1, C4');
  assert.equal(splitLeaves(again, [caps]).length, 2);
  const outerId = [...again.nodes.values()].find((n) => n.name === 'Series block').id;
  ungroupNodes(again, [outerId]);
  assert.equal(again.parent.get([...again.nodes.values()].find((n) => n.name === 'C2, C3 in parallel').id), ROOT);
  // Ungrouping a top-level block of parts returns them to "Everything else".
  const inner = [...again.nodes.values()].find((n) => n.name === 'C2, C3 in parallel').id;
  ungroupNodes(again, [inner]);
  assert.equal(serializeStructure(again).children.length, 0);
});

test('the netlist import still proposes parts sharing the same nets', () => {
  const blk = (d, f, v) => `[\nDESIGNATOR\n${d}\nFOOTPRINT\n${f}\nPARTTYPE\n${v}\nDESCRIPTION\n\n]`;
  const net = (name, ...nodes) => `(\n${name}\n${nodes.join('\n')}\n)`;
  const text = ['PROTEL NETLIST 2.0',
    blk('C1', 'C_0603', '100nF'), blk('C2', 'C_0603', '100nF'), blk('C3', 'C_0805', '10uF'), blk('C4', 'C_0603', '100nF'),
    blk('Q1', 'SOT-23', '2N7002'), blk('Q2', 'SOT-23', '2N7002'), blk('R1', 'R_0603', '10k'),
    net('+3V3', 'C1-1', 'C2-1', 'C3-1'), net('+5V', 'C4-1'), net('GND', 'C1-2', 'C2-2', 'C3-2', 'C4-2', 'Q1-2', 'Q2-2'),
    net('LOAD', 'Q1-3', 'Q2-3'), net('GATE', 'Q1-1', 'Q2-1', 'R1-1'),
  ].join('\n');
  const { groups } = netlistToParts(text);
  assert.deepEqual(groups.map((g) => [g.refs, g.nets.join(' ')]), [['C1–C3', '+3V3 GND'], ['Q1, Q2', 'GATE GND LOAD']]);
  assert.match(groups[0].proposed, /same nets/);
});
