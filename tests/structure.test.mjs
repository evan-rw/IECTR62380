import { test } from 'node:test';
import assert from 'node:assert/strict';

import { atMostFailing, groupSurvival, computeStructure, meanTimeToFailure } from '../assets/structure.js';
import { computeBoard } from '../assets/models.js';
import { netlistToParts } from '../assets/netlist.js';

const close = (actual, expected, rel = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected), `expected ${expected}, got ${actual}`);

const T10 = 10 * 8760; // ten years in hours

// A board of "Other part" lines with the given per-piece rates.
const board = (lines, groups = [], years = 10) => {
  const b = computeBoard({
    profile: { phases: [{ tac: 25, tau: 1, n: 0, dT: 0 }] },
    components: lines.map(([ref, qty, fit]) => ({ ref, qty, model: 'fixed', params: { fit } })),
  });
  return { board: b, structure: computeStructure(b.items, groups, years) };
};

test('Poisson-binomial tail', () => {
  assert.equal(atMostFailing([], 0), 1);
  close(atMostFailing([0.5, 0.5], 0), 0.25);
  close(atMostFailing([0.5, 0.5], 1), 0.75);
  close(atMostFailing([0.1, 0.2, 0.3], 2), 1 - 0.1 * 0.2 * 0.3);
});

test('limits of a redundant group reduce to series', () => {
  const fits = [100, 200, 300];
  const series = Math.exp(-600e-9 * T10);
  close(groupSurvival(fits, 3, 0, T10), series, 1e-9); // all must work
  close(groupSurvival(fits, 1, 100, T10), series, 1e-9); // every failure is critical
});

test('one of two identical parts, no critical share', () => {
  const p = 1 - Math.exp(-1000e-9 * T10);
  close(groupSurvival([1000, 1000], 1, 0, T10), 1 - p * p);
  // Textbook result: a 1-of-2 parallel pair has MTTF = 3 / (2λ).
  const lambda = 1e6; // FIT, so the integral spans a short time range
  close(meanTimeToFailure((t) => groupSurvival([lambda, lambda], 1, 0, t)), 3 / (2 * lambda * 1e-9), 1e-4);
  close(meanTimeToFailure((t) => Math.exp(-lambda * 1e-9 * t)), 1 / (lambda * 1e-9), 1e-4);
});

test('without redundant groups the structure is the plain sum', () => {
  const { board: b, structure: s } = board([['U1', 1, 10], ['C1–C4', 4, 2]]);
  close(s.boardFit, b.total);
  close(s.mttfHours, 1e9 / b.total);
  assert.equal(s.redundancy, false);
  const proposed = board([['U1', 1, 10], ['C1–C4', 4, 2]], [{ refs: 'C1–C4', mode: 'series' }]).structure;
  close(proposed.boardFit, 18);
});

test('a redundant group replaces its members in the series sum', () => {
  const { structure: s } = board([['U1', 1, 10], ['C1–C4', 4, 2]], [{ refs: 'C1–C3', mode: 'redundant', need: 2, shortPct: 50 }]);
  assert.equal(s.redundancy, true);
  close(s.seriesFit, 10 + 2); // U1 and C4
  const g = s.groups[0];
  assert.deepEqual(g.refs, ['C1', 'C2', 'C3']);
  close(g.R, groupSurvival([2, 2, 2], 2, 50, T10));
  // Half the failures are critical (3 FIT); the tolerated half adds almost nothing.
  assert.ok(g.fit > 3 && g.fit < 3.01, g.fit);
  close(s.boardFit, 12 + g.fit);
  close(s.survival(T10), Math.exp(-12e-9 * T10) * g.R);
});

test('an incomplete or invalid group counts in series and says why', () => {
  const lines = [['C1–C2', 2, 5]];
  const check = (group, pattern) => {
    const s = board(lines, [group]).structure;
    assert.equal(s.groups[0].redundant, false);
    assert.match(s.groups[0].problems.join(' '), pattern);
    close(s.boardFit, 10);
  };
  check({ refs: 'C1–C2', mode: 'redundant', need: null, shortPct: 10 }, /Missing: how many parts must keep working/);
  check({ refs: 'C1–C2', mode: 'redundant', need: 1, shortPct: null }, /Missing: share of failures/);
  check({ refs: 'C1–C2', mode: 'redundant', need: 3, shortPct: 10 }, /from 1 to 2/);
  check({ refs: 'C1, C9', mode: 'redundant', need: 1, shortPct: 10 }, /Not in the parts list: C9/);
  const noMission = board(lines, [{ refs: 'C1–C2', mode: 'redundant', need: 1, shortPct: 10 }], 0).structure;
  assert.match(noMission.groups[0].problems.join(' '), /Set the mission length/);
  const twice = board(lines, [{ refs: 'C1–C2', mode: 'series' }, { refs: 'C2', mode: 'series' }]).structure;
  assert.match(twice.groups[1].problems.join(' '), /Also in another group: C2/);
});

test('the netlist import proposes parts sharing the same nets as parallel groups', () => {
  const blk = (d, f, v) => `[\nDESIGNATOR\n${d}\nFOOTPRINT\n${f}\nPARTTYPE\n${v}\nDESCRIPTION\n\n]`;
  const net = (name, ...nodes) => `(\n${name}\n${nodes.join('\n')}\n)`;
  const text = ['PROTEL NETLIST 2.0',
    blk('C1', 'C_0603', '100nF'), blk('C2', 'C_0603', '100nF'), blk('C3', 'C_0805', '10uF'), blk('C4', 'C_0603', '100nF'),
    blk('Q1', 'SOT-23', '2N7002'), blk('Q2', 'SOT-23', '2N7002'), blk('R1', 'R_0603', '10k'),
    net('+3V3', 'C1-1', 'C2-1', 'C3-1'), net('+5V', 'C4-1'), net('GND', 'C1-2', 'C2-2', 'C3-2', 'C4-2', 'Q1-2', 'Q2-2'),
    net('LOAD', 'Q1-3', 'Q2-3'), net('GATE', 'Q1-1', 'Q2-1', 'R1-1'),
  ].join('\n');
  const { groups } = netlistToParts(text);
  assert.deepEqual(groups.map((g) => [g.refs, g.nets.join(' ')]), [
    ['C1–C3', '+3V3 GND'],
    ['Q1, Q2', 'GATE GND LOAD'],
  ]);
  assert.equal(groups[0].mode, 'series', 'proposals start in series');
  assert.match(groups[0].proposed, /same nets/);
});
