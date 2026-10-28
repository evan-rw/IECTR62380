// The netlist import's reliability tree, end to end: netlist -> proposed parallel
// blocks -> the structure the page builds -> board totals -> a block accepted as
// k of n. Every netlist here is written by hand, in KiCad s-expression or Protel
// form, with the tree it should give worked out beside it.
//
// The rules the expectations follow:
//  - a block is proposed for two or more fitted parts of the same part type whose
//    pins go to the same nets, pin for pin. The two ends of a resistor, capacitor or
//    inductor are interchangeable; the pins of a diode or transistor are not. A
//    resistor array is compared element by element (KiCad's units name each
//    element's pins).
//  - a part needs connected pins on two different nets. A pin on an
//    "unconnected-(…)" net or a single-node net is not connected, and is ignored.
//  - ICs, parts with no model ("Other"), connectors, do-not-populate parts,
//    symbols excluded from the board and mechanical items are never proposed.
//  - two or more alike series strings between the same two nets are parallel strings.
// Values (100 nF next to 10 µF) may differ: a rail's decoupling is one bank.
// Proposals count in series until accepted. Expected values for an accepted block
// come from textbook formulas (closed forms, or a list of every outcome), never
// from assets/structure.js. Tests the code fails today are marked todo with the reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { netlistToParts, compressRefs, expandRefs } from '../assets/netlist.js';
import { splitDesignators } from '../assets/bom.js';
import { buildStructure, evaluateStructure, serializeStructure, sanitizeStructure, ungroupNodes, ROOT, REST } from '../assets/structure.js';
import { computeBoard } from '../assets/models.js';

const HOURS = 10 * 8760; // the 10-year mission used throughout
const PROFILE = { phases: [{ tac: 25, tau: 1, n: 0, dT: 0 }] };
const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Hand-written netlists in compact form

// KiCad: parts [ref, value, footprint, 'Lib:Part', ...], where each extra is a
// property name ("dnp", "exclude_from_board") or a raw s-expression such as
// "(units …)"; nets [name, 'REF.pin', …].
function kicad(parts, nets) {
  const comp = ([ref, value, footprint, symbol, ...extra]) => {
    const [lib, part] = symbol.split(':');
    const more = extra.map((x) => (x.startsWith('(') ? ` ${x}` : ` (property (name "${x}"))`)).join('');
    return `    (comp (ref "${ref}") (value "${value}") (footprint "${footprint}") (libsource (lib "${lib}") (part "${part}") (description ""))${more})`;
  };
  const net = ([name, ...nodes], i) => `    (net (code "${i + 1}") (name "${name}") (class "Default")\n${nodes.map((n) => {
    const dot = n.lastIndexOf('.');
    return `      (node (ref "${n.slice(0, dot)}") (pin "${n.slice(dot + 1)}") (pintype "passive"))`;
  }).join('\n')})`;
  return `(export (version "E")\n  (components\n${parts.map(comp).join('\n')})\n  (nets\n${nets.map(net).join('\n')}))\n`;
}

// Protel 2.0: parts [designator, footprint, value]; nets [name, 'REF-pin', …].
function protel(parts, nets) {
  return ['PROTEL NETLIST 2.0',
    ...parts.map(([d, fp, v]) => `[\nDESIGNATOR\n${d}\nFOOTPRINT\n${fp}\nPARTTYPE\n${v}\nDESCRIPTION\n\n]`),
    ...nets.map(([name, ...nodes]) => `(\n${name}\n${nodes.join('\n')}\n)`),
  ].join('\n');
}

const R_PACK04_UNITS = '(units (unit (name "A") (pins (pin (num "1")) (pin (num "8")))) (unit (name "B") (pins (pin (num "2")) (pin (num "7"))))'
  + ' (unit (name "C") (pins (pin (num "3")) (pin (num "6")))) (unit (name "D") (pins (pin (num "4")) (pin (num "5")))))';

// ---------------------------------------------------------------------------
// The page's side of the import

// The saved structure that the #netlist-file handler in assets/app.js builds from an
// import. This is a copy; the page test at the end checks it against the real handler.
const appStructure = (result) => ({
  kind: 'block', id: ROOT,
  children: result.groups.map((g) => ({
    kind: 'block', name: `${g.refs} in parallel`, mode: 'series', proposed: g.proposed, nets: g.nets,
    children: g.strings ? g.strings.map((refs) => ({ kind: 'block', name: `${refs} in series`, mode: 'series', children: [{ kind: 'leaf', refs }] })) : [{ kind: 'leaf', refs: g.refs }],
  })),
});

// The page's part lines, each given a rate per piece with the 'fixed' model, so that
// every line is complete and the numbers can be worked by hand. The tree reads only a
// line's ref, qty and rate.
function itemsFor(lines, rateOf) {
  const components = lines.map((l, i) => ({ id: `p${i}`, ref: l.ref, qty: l.qty, model: 'fixed', params: { fit: rateOf(l) }, inferred: {} }));
  return computeBoard({ profile: PROFILE, components }).items;
}
const byPrefix = (rates) => (line) => rates[/^[A-Za-z]+/.exec(line.ref)[0]];
const linesTotal = (items) => items.reduce((s, it) => s + it.result.total, 0);

const groupsOf = (r) => r.groups.map((g) => [g.refs, g.nets]).sort((a, b) => a[0].localeCompare(b[0]));
// The board's top level as [name, mode, [[leaf refs, its part line], …]].
const view = (rt) => rt.nodes.get(ROOT).children.map((id) => {
  const n = rt.nodes.get(id);
  return [n.name, n.mode, n.children.map((c) => {
    const leaf = rt.nodes.get(c);
    return [compressRefs(leaf.refs), leaf.lineId ? rt.lines.get(leaf.lineId).comp.ref : null];
  })];
});
const blockNamed = (rt, name) => [...rt.nodes.values()].find((n) => n.kind === 'block' && n.name === name);
// All leaf refs under a block.
const refsUnder = (rt, id) => {
  const n = rt.nodes.get(id);
  return n.kind === 'leaf' ? n.refs : n.children.flatMap((c) => refsUnder(rt, c));
};

// What the page's "Mark redundant" does, followed by the user entering k and the share.
function accept(rt, name, need, shortPct) {
  const n = blockNamed(rt, name);
  Object.assign(n, { proposed: null, mode: 'kofn', need, shortPct });
}
// Every edit is saved and the structure built again from the saved form.
const rebuild = (rt, items) => buildStructure(serializeStructure(rt), items);

// ---------------------------------------------------------------------------
// Reference values that share no code with assets/structure.js

// Survival of a k-of-n block over t hours, by listing every outcome. Each part, at
// rate λ (FIT), works with probability e^−λt, has failed harmlessly with
// (1 − c)(1 − e^−λt), or has failed critically (a short) with c(1 − e^−λt). The
// block survives when no failure is critical and at most n − k have failed.
function survivalByOutcomes(fits, need, c, t) {
  const n = fits.length;
  let R = 0;
  for (let s = 0; s < 3 ** n; s++) {
    let p = 1;
    let failed = 0;
    let critical = false;
    for (let i = 0, x = s; i < n; i++, x = Math.floor(x / 3)) {
      const w = Math.exp(-fits[i] * 1e-9 * t);
      if (x % 3 === 0) p *= w;
      else if (x % 3 === 1) { p *= (1 - c) * (1 - w); failed++; } else { p *= c * (1 - w); critical = true; }
    }
    if (!critical && failed <= n - need) R += p;
  }
  return R;
}
// The mission-average rate in FIT of a survival R over t hours.
const fitOver = (R, t) => (-Math.log(R) / t) * 1e9;
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

test('reference: listing every outcome agrees with the textbook closed forms', () => {
  const lt = 1000e-9 * HOURS; // λt = 0.0876 at 1000 FIT over 10 years
  const e = Math.exp(-lt);
  // 1 of 2: R = 2e^−λt − e^−2λt.
  assert.ok(close(survivalByOutcomes([1000, 1000], 1, 0, HOURS), 2 * e - e * e));
  assert.ok(close(2 * e - e * e, 0.9929653625362336));
  // 2 of 3: R = 3e^−2λt − 2e^−3λt.
  assert.ok(close(survivalByOutcomes([1000, 1000, 1000], 2, 0, HOURS), 3 * e ** 2 - 2 * e ** 3));
  // 1 of 2 with a share c of shorts: both work, or one has failed open and the other works.
  const c = 0.49;
  assert.ok(close(survivalByOutcomes([1000, 1000], 1, c, HOURS), e * e + 2 * (1 - c) * (1 - e) * e));
  // Unequal rates, 1 of 2: R = 1 − q1·q2.
  const [q1, q2] = [1 - Math.exp(-1000e-9 * HOURS), 1 - Math.exp(-4000e-9 * HOURS)];
  assert.ok(close(survivalByOutcomes([1000, 4000], 1, 0, HOURS), 1 - q1 * q2));
});

// ---------------------------------------------------------------------------
// One KiCad board with the common patterns (tests/fixtures/tree-board.net)
//
//   +3V3/GND  C1, C2 100 nF; C3 10 µF (pins the other way round); C4 100 µF electrolytic;
//             C5, C13 220 µF polymer (no model: "Other"); R1 100 k bleeder
//   /sensor/VDD/GND  C6, C8 100 nF; C9 100 nF DNP      VDD/GND (top sheet)  C7 100 nF
//   /sensor/VDD - /sensor/SDA  R11, R12 10 k; R10 10 k excluded from the board
//   GND/GND   C10, C11 (both pins on GND)              +5V/GND  C12 1 µF and D1 TVS
//   ISNS/GND  R2–R4 0R1 sharing current; Q1, Q2 2N7002 G=GATE S=ISNS D=LOAD; R5 gate resistor
//   U1, U2    two LDOs on the same pins; H1, H2 mounting holes on GND
//
// Proposed blocks (the code and the rules agree on this board):
//   C1–C4 [+3V3, GND]: mixed values and the reversed C3 are one bank; R1 is not a
//     capacitor; C5, C13 have no model.
//   C6, C8 [/sensor/VDD, GND]: not C7, whose VDD is another net; not C9 (DNP).
//   R11, R12: not R10 (off the board).   R2–R4.   Q1, Q2.
//   Not U1, U2 (ICs), C10, C11 (one net), C12 with D1 (different types), H1, H2 (mechanical).
// Rates per piece in FIT: U 2000, Q 5000, D 300, C 1000, R 200. 24 fitted parts:
//   2×2000 + 2×5000 + 300 + 12×1000 + 7×200 = 27 700 FIT in series.

const BOARD = fixture('tree-board.net');
const RATES = { U: 2000, Q: 5000, D: 300, C: 1000, R: 200 };

test('KiCad board: netlist -> groups', () => {
  const r = netlistToParts(BOARD);
  assert.deepEqual([r.format, r.components, r.nets, r.skipped, r.notFitted], ['KiCad', 28, 10, 'H1, H2', 'C9']);
  assert.deepEqual(r.lines.map((l) => [l.ref, l.qty, l.model]), [
    ['U1, U2', 2, 'ic'], ['Q1, Q2', 2, 'transistor'], ['D1', 1, 'diode'],
    ['C1, C2, C6–C8, C10, C11', 7, 'capacitor'], ['C3', 1, 'capacitor'], ['C4', 1, 'capacitor'], ['C12', 1, 'capacitor'],
    ['R1', 1, 'resistor'], ['R2–R4', 3, 'resistor'], ['R5', 1, 'resistor'], ['R11, R12', 2, 'resistor'],
    ['C5, C13', 2, 'fixed'],
  ]);
  assert.equal(r.lines.reduce((s, l) => s + l.qty, 0), 24, 'every fitted part, once');
  assert.deepEqual(groupsOf(r), [
    ['C1–C4', ['+3V3', 'GND']],
    ['C6, C8', ['/sensor/VDD', 'GND']],
    ['Q1, Q2', ['GATE', 'ISNS', 'LOAD']],
    ['R11, R12', ['/sensor/SDA', '/sensor/VDD']],
    ['R2–R4', ['GND', 'ISNS']],
  ]);
  for (const g of r.groups) {
    assert.equal(g.mode, 'series');
    assert.equal(g.proposed, `wired in parallel: same part type connected to the same nets (${g.nets.join(', ')})`);
  }
});

test('KiCad board: groups -> the structure the page builds, every part once', () => {
  const r = netlistToParts(BOARD);
  const rt = buildStructure(appStructure(r), itemsFor(r.lines, byPrefix(RATES)));
  // Board (series)
  //   Everything else: one leaf per line, holding the parts not in a block
  //   C1–C4 in parallel: leaves on three lines (C1, C2 from the 100 nF line, C3, C4)
  //   C6, C8 in parallel: refs with a gap; C7 of the same line stays outside
  //   R2–R4, R11–R12, Q1–Q2 in parallel
  const line = 'C1, C2, C6–C8, C10, C11';
  assert.deepEqual(view(rt), [
    ['Everything else', 'series', [['U1, U2', 'U1, U2'], ['D1', 'D1'], ['C7, C10, C11', line], ['C12', 'C12'], ['R1', 'R1'], ['R5', 'R5'], ['C5, C13', 'C5, C13']]],
    ['C1–C4 in parallel', 'series', [['C1, C2', line], ['C3', 'C3'], ['C4', 'C4']]],
    ['C6, C8 in parallel', 'series', [['C6, C8', line]]],
    ['R2–R4 in parallel', 'series', [['R2–R4', 'R2–R4']]],
    ['R11, R12 in parallel', 'series', [['R11, R12', 'R11, R12']]],
    ['Q1, Q2 in parallel', 'series', [['Q1, Q2', 'Q1, Q2']]],
  ]);
  assert.equal(rt.buildProblems.size, 0);
  const placed = refsUnder(rt, ROOT).sort();
  const fitted = r.lines.flatMap((l) => expandRefs(l.ref)).sort();
  assert.deepEqual(placed, fitted, 'each fitted part in exactly one leaf');
  for (const n of rt.nodes.values()) if (n.kind === 'block' && !n.fixed) assert.match(n.proposed, /same nets/);
});

test('KiCad board: before acceptance the total is the plain sum of the lines', () => {
  const r = netlistToParts(BOARD);
  const items = itemsFor(r.lines, byPrefix(RATES));
  const ev = evaluateStructure(buildStructure(appStructure(r), items), 10);
  assert.equal(linesTotal(items), 27700);
  assert.equal(ev.board.fit, 27700);
  assert.equal(ev.board.pieces, 24);
  assert.equal(ev.red.size, 0, 'proposals count in series');
  assert.ok(close(ev.mttfHours, 1e9 / 27700));
});

test('KiCad board: accepted blocks give the textbook k-of-n values', () => {
  const r = netlistToParts(BOARD);
  const items = itemsFor(r.lines, byPrefix(RATES));
  let rt = buildStructure(appStructure(r), items);
  accept(rt, 'C1–C4 in parallel', 2, 0);
  accept(rt, 'Q1, Q2 in parallel', 1, 30);
  rt = rebuild(rt, items);
  const ev = evaluateStructure(rt, 10);

  // Bank, 2 of 4 at 1000 FIT, no shorts: R = p⁴ + 4qp³ + 6q²p², p = e^−λt, q = 1 − p.
  let p = Math.exp(-1000e-9 * HOURS);
  let q = 1 - p;
  const bank = p ** 4 + 4 * q * p ** 3 + 6 * q * q * p * p; // 0.997788…, 25.27 FIT
  assert.ok(close(bank, 0.9977884009376357));
  // MOSFETs, 1 of 2 at 5000 FIT, 30 % of failures are shorts: R = p² + 2(1 − c)qp.
  p = Math.exp(-5000e-9 * HOURS);
  q = 1 - p;
  const fets = p * p + 2 * 0.7 * q * p; // 0.736878…, 3485.5 FIT
  assert.ok(close(bank, survivalByOutcomes([1000, 1000, 1000, 1000], 2, 0, HOURS)));
  assert.ok(close(fets, survivalByOutcomes([5000, 5000], 1, 0.3, HOURS)));

  assert.deepEqual([...ev.red].map((id) => rt.nodes.get(id).name).sort(), ['C1–C4 in parallel', 'Q1, Q2 in parallel']);
  assert.ok(close(ev.stats.get(blockNamed(rt, 'C1–C4 in parallel').id).fit, fitOver(bank, HOURS)));
  assert.ok(close(ev.stats.get(blockNamed(rt, 'Q1, Q2 in parallel').id).fit, fitOver(fets, HOURS)));
  // The rest stay in series: 27 700 − 4×1000 − 2×5000 = 13 700 FIT.
  const want = 13700 + fitOver(bank, HOURS) + fitOver(fets, HOURS); // 17 210.81 FIT
  assert.ok(close(want, 17210.81110866149));
  assert.ok(close(ev.board.fit, want), `${ev.board.fit} vs ${want}`);
  assert.ok(close(ev.survival(HOURS), Math.exp(-13700e-9 * HOURS) * bank * fets));
  // Still-proposed blocks are unchanged by the acceptance of the others.
  assert.equal(ev.stats.get(blockNamed(rt, 'R2–R4 in parallel').id).fit, 600);
});

test('KiCad board: save, load and JSON keep the proposals and the accepted blocks', () => {
  const r = netlistToParts(BOARD);
  const items = itemsFor(r.lines, byPrefix(RATES));
  // Right after the import the page saves (and exports) the raw form it built.
  const raw = sanitizeStructure(JSON.parse(JSON.stringify(appStructure(r))));
  const fresh = buildStructure(raw, items);
  for (const g of r.groups) {
    const n = blockNamed(fresh, `${g.refs} in parallel`);
    assert.deepEqual([n.mode, n.proposed, n.nets, refsUnder(fresh, n.id).sort()], ['series', g.proposed, g.nets, expandRefs(g.refs).sort()]);
  }
  // After accepting two blocks.
  let rt = buildStructure(appStructure(r), items);
  accept(rt, 'C1–C4 in parallel', 2, 0);
  accept(rt, 'Q1, Q2 in parallel', 1, 30);
  rt = rebuild(rt, items);
  const before = evaluateStructure(rt, 10).board.fit;
  const again = buildStructure(sanitizeStructure(JSON.parse(JSON.stringify(serializeStructure(rt)))), items);
  assert.ok(close(evaluateStructure(again, 10).board.fit, before));
  assert.deepEqual(view(again), view(rt));
  const bank = blockNamed(again, 'C1–C4 in parallel');
  assert.deepEqual([bank.mode, bank.need, bank.shortPct, bank.proposed, bank.nets], ['kofn', 2, 0, null, ['+3V3', 'GND']]);
  assert.match(blockNamed(again, 'C6, C8 in parallel').proposed, /same nets \(\/sensor\/VDD, GND\)/);
});

test('KiCad board: splitting every line into single parts changes nothing', () => {
  const r = netlistToParts(BOARD);
  const items = itemsFor(r.lines, byPrefix(RATES));
  let rt = buildStructure(appStructure(r), items);
  accept(rt, 'C1–C4 in parallel', 2, 0);
  accept(rt, 'Q1, Q2 in parallel', 1, 30);
  const saved = serializeStructure(rt);
  rt = buildStructure(saved, items);
  const want = evaluateStructure(rt, 10).board.fit;
  // As the page's Split does: one line per reference, quantity 1, same values.
  const singles = r.lines.flatMap((l) => expandRefs(l.ref).map((ref) => ({ ...l, ref, qty: 1 })));
  const split = buildStructure(saved, itemsFor(singles, byPrefix(RATES)));
  assert.ok(close(evaluateStructure(split, 10).board.fit, want));
  assert.deepEqual(view(split).find(([name]) => name === 'C1–C4 in parallel')[2], [['C1', 'C1'], ['C2', 'C2'], ['C3', 'C3'], ['C4', 'C4']]);
});

test('KiCad board: dismissing a proposal puts its parts back in series', () => {
  const r = netlistToParts(BOARD);
  const items = itemsFor(r.lines, byPrefix(RATES));
  let rt = buildStructure(appStructure(r), items);
  ungroupNodes(rt, [blockNamed(rt, 'R11, R12 in parallel').id]);
  rt = rebuild(rt, items);
  assert.equal(blockNamed(rt, 'R11, R12 in parallel'), undefined);
  assert.deepEqual(view(rt)[0][2].find(([refs]) => refs === 'R11, R12'), ['R11, R12', 'R11, R12']);
  assert.equal(evaluateStructure(rt, 10).board.fit, 27700);
});

// ---------------------------------------------------------------------------
// The Protel path (tests/fixtures/tree-board-protel.net): the same rails without
// sheets, DNP or polymer parts.
//   C1, C2 100 nF and C3 10 µF (reversed) on +3V3/GND: one bank. R1 across it: not.
//   R2–R4 on ISNS/GND. Q1, Q2 G=GATE S=ISNS D=LOAD. Not U1, U2, C10, C11, nor C12 with D1.
// Rates as above; 16 parts: 2×2000 + 2×5000 + 300 + 6×1000 + 5×200 = 21 300 FIT.

test('Protel 2.0 board: groups, totals and a 1-of-3 bank', () => {
  const r = netlistToParts(fixture('tree-board-protel.net'));
  assert.deepEqual([r.format, r.components, r.nets], ['Protel 2.0', 16, 8]);
  assert.deepEqual(groupsOf(r), [['C1–C3', ['+3V3', 'GND']], ['Q1, Q2', ['GATE', 'ISNS', 'LOAD']], ['R2–R4', ['GND', 'ISNS']]]);
  const items = itemsFor(r.lines, byPrefix(RATES));
  let rt = buildStructure(appStructure(r), items);
  assert.deepEqual(view(rt).find(([n]) => n === 'C1–C3 in parallel')[2], [['C1, C2', 'C1, C2, C10, C11'], ['C3', 'C3']]);
  assert.equal(evaluateStructure(rt, 10).board.fit, 21300);
  accept(rt, 'C1–C3 in parallel', 1, 0);
  rt = rebuild(rt, items);
  // 1 of 3: R = 1 − q³.
  const q = 1 - Math.exp(-1000e-9 * HOURS);
  assert.ok(close(evaluateStructure(rt, 10).board.fit, 21300 - 3000 + fitOver(1 - q ** 3, HOURS)));
});

test('Protel 1 netlist: a bank on one rail', () => {
  const text = ['[', 'C1', 'C_0603', '100nF', ']', '[', 'C2', 'C_0805', '10uF', ']', '[', 'R1', 'R_0603', '10k', ']',
    '(', 'VCC', 'C1-1', 'C2-1', 'R1-1', ')', '(', 'GND', 'C1-2', 'C2-2', ')', '(', 'EN', 'R1-2', ')'].join('\r\n');
  const r = netlistToParts(text);
  assert.equal(r.format, 'Protel');
  assert.deepEqual(groupsOf(r), [['C1, C2', ['GND', 'VCC']]]);
  const rt = buildStructure(appStructure(r), itemsFor(r.lines, () => 100));
  assert.deepEqual(view(rt)[1], ['C1, C2 in parallel', 'series', [['C1', 'C1'], ['C2', 'C2']]]);
});

// ---------------------------------------------------------------------------
// Pin to net mapping

// D1, D3 (Device:D, pin 1 = K, pin 2 = A): anode on SIG, cathode on +3V3, clamping to the rail.
// D2: anode on +3V3, cathode on SIG. Same two nets, facing the other way: it conducts
// when D1 and D3 block, so it is no spare for them. Wanted: D1, D3; D2 in series.
const DIODES = [['SIG', 'D1.2', 'D3.2', 'D2.1', 'R1.1'], ['+3V3', 'D1.1', 'D3.1', 'D2.2', 'R1.2']];
const diode = (ref) => [ref, '1N4148', 'Diode_SMD:D_SOD-123', 'Device:D'];
const R1 = ['R1', '10k', 'Resistor_SMD:R_0603_1608Metric', 'Device:R'];

test('diodes facing the same way are proposed', () => {
  const r = netlistToParts(kicad([diode('D1'), diode('D3'), R1], [['SIG', 'D1.2', 'D3.2', 'R1.1'], ['+3V3', 'D1.1', 'D3.1', 'R1.2']]));
  assert.deepEqual(groupsOf(r), [['D1, D3', ['+3V3', 'SIG']]]);
});

test('anti-parallel diodes are not one block (KiCad)', () => {
  const r = netlistToParts(kicad([diode('D1'), diode('D2'), diode('D3'), R1], DIODES));
  assert.deepEqual(groupsOf(r), [['D1, D3', ['+3V3', 'SIG']]]);
});

test('anti-parallel diodes are not one block (Protel)', () => {
  const r = netlistToParts(protel([['D1', 'SOD-123', '1N4148'], ['D2', 'SOD-123', '1N4148']], [['SIG', 'D1-2', 'D2-1'], ['+3V3', 'D1-1', 'D2-2']]));
  assert.deepEqual(r.groups, []);
});

// Q1, Q2 (pin 1 G, 2 S, 3 D) switch X to Y: parallel. Q3 has drain and source swapped on
// the same three nets: wanted Q1, Q2 only.
test('a MOSFET with drain and source swapped is not in the block', () => {
  const q = (ref) => [ref, '2N7002', 'Package_TO_SOT_SMD:SOT-23', 'Transistor_FET:2N7002'];
  const r = netlistToParts(kicad([q('Q1'), q('Q2'), q('Q3'), R1],
    [['GATE', 'Q1.1', 'Q2.1', 'Q3.1', 'R1.1'], ['X', 'Q1.2', 'Q2.2', 'Q3.3'], ['Y', 'Q1.3', 'Q2.3', 'Q3.2', 'R1.2']]));
  assert.deepEqual(groupsOf(r), [['Q1, Q2', ['GATE', 'X', 'Y']]]);
});

// ---------------------------------------------------------------------------
// Multi-unit symbols and resistor arrays (Device:R_Pack04: elements 1–8, 2–7, 3–6, 4–5)
//   RN1, RN2: pins 1–4 on +3V3, 8, 7, 6, 5 on S1–S4: four pull-ups each, the same ones.
//   RN4: pins 1–4 on +3V3, 8, 7, 6, 5 on S4–S1: numbered differently, the same four pull-ups.
//   RN3: 1–8 +3V3–S1, 2–7 S1–S2, 3–6 S2–S3, 4–5 S3–S4: a ladder on the same five nets.
// Wanted: RN1, RN2, RN4 in one block, one part each; RN3 in series.
const pack = (ref) => [ref, '4x10k', 'Resistor_SMD:R_Array_Convex_4x0603', 'Device:R_Pack04', R_PACK04_UNITS];
const PULLUPS = (refs) => [
  ['+3V3', ...refs.flatMap((x) => [`${x}.1`, `${x}.2`, `${x}.3`, `${x}.4`])],
  ['S1', ...refs.map((x) => (x === 'RN4' ? `${x}.5` : `${x}.8`))], ['S2', ...refs.map((x) => (x === 'RN4' ? `${x}.6` : `${x}.7`))],
  ['S3', ...refs.map((x) => (x === 'RN4' ? `${x}.7` : `${x}.6`))], ['S4', ...refs.map((x) => (x === 'RN4' ? `${x}.8` : `${x}.5`))],
];

test('resistor arrays wired alike are one block, each array one part', () => {
  const r = netlistToParts(kicad([pack('RN1'), pack('RN2'), pack('RN4')], PULLUPS(['RN1', 'RN2', 'RN4'])));
  assert.deepEqual(r.lines.map((l) => [l.ref, l.qty, l.model, l.params.elements]), [['RN1, RN2, RN4', 3, 'resistor', 4]]);
  assert.deepEqual(groupsOf(r), [['RN1, RN2, RN4', ['+3V3', 'S1', 'S2', 'S3', 'S4']]]);
  const rt = buildStructure(appStructure(r), itemsFor(r.lines, () => 10));
  assert.equal(evaluateStructure(rt, 10).stats.get(blockNamed(rt, 'RN1, RN2, RN4 in parallel').id).pieces, 3);
});

test('a resistor ladder on the same nets as the arrays is not in their block', () => {
  const nets = PULLUPS(['RN1', 'RN2', 'RN4']);
  // RN3: 1 on +3V3, 8 and 2 on S1, 7 and 3 on S2, 6 and 4 on S3, 5 on S4.
  const add = { '+3V3': ['RN3.1'], S1: ['RN3.8', 'RN3.2'], S2: ['RN3.7', 'RN3.3'], S3: ['RN3.6', 'RN3.4'], S4: ['RN3.5'] };
  const r = netlistToParts(kicad([pack('RN1'), pack('RN2'), pack('RN3'), pack('RN4')], nets.map(([n, ...x]) => [n, ...x, ...add[n]])));
  assert.deepEqual(groupsOf(r), [['RN1, RN2, RN4', ['+3V3', 'S1', 'S2', 'S3', 'S4']]]);
});

// ---------------------------------------------------------------------------
// Unconnected pins and single-node nets
// D1, D2: BAT54 in SOT-23 (pin 1 A, pin 2 not connected, pin 3 K), OR-ing VIN onto VOUT.
// Wanted: D1, D2 [VIN, VOUT]. The free pin carries nothing, whatever its net is called.
const BAT = (ref) => [ref, 'BAT54', 'Package_TO_SOT_SMD:SOT-23', 'Diode:BAT54'];
const ORING = [['VIN', 'D1.1', 'D2.1', 'R1.1'], ['VOUT', 'D1.3', 'D2.3', 'R1.2']];

test('unconnected pins: Protel lists only connected pins, and the pair is proposed', () => {
  const r = netlistToParts(protel([['D1', 'SOT-23', 'BAT54'], ['D2', 'SOT-23', 'BAT54']], [['VIN', 'D1-1', 'D2-1'], ['VOUT', 'D1-3', 'D2-3']]));
  assert.deepEqual(groupsOf(r), [['D1, D2', ['VIN', 'VOUT']]]);
});

test('unconnected pins: KiCad\'s unconnected-(…) nets do not stop the pair', () => {
  const r = netlistToParts(kicad([BAT('D1'), BAT('D2'), R1], [...ORING, ['unconnected-(D1-NC-Pad2)', 'D1.2'], ['unconnected-(D2-NC-Pad2)', 'D2.2']]));
  assert.deepEqual(groupsOf(r), [['D1, D2', ['VIN', 'VOUT']]]);
});

test('single-node nets do not stop the pair (KiCad and Protel)', () => {
  const k = netlistToParts(kicad([BAT('D1'), BAT('D2'), R1], [...ORING, ['/spare1', 'D1.2'], ['/spare2', 'D2.2']]));
  assert.deepEqual(groupsOf(k), [['D1, D2', ['VIN', 'VOUT']]]);
  const p = netlistToParts(protel([['D1', 'SOT-23', 'BAT54'], ['D2', 'SOT-23', 'BAT54']], [['VIN', 'D1-1', 'D2-1'], ['VOUT', 'D1-3', 'D2-3'], ['NetD1_2', 'D1-2'], ['NetD2_2', 'D2-2']]));
  assert.deepEqual(groupsOf(p), [['D1, D2', ['VIN', 'VOUT']]]);
});

// D1's free pin goes to R9, which is not fitted: the net reaches nothing, so D1 and D2
// are still wired alike.
test('a net that reaches only a do-not-populate part carries nothing', () => {
  const r = netlistToParts(kicad([BAT('D1'), BAT('D2'), R1, ['R9', '10k', 'Resistor_SMD:R_0603_1608Metric', 'Device:R', 'dnp']],
    [...ORING, ['SPARE', 'D1.2', 'R9.1'], ['GND', 'R9.2']]));
  assert.deepEqual(groupsOf(r), [['D1, D2', ['VIN', 'VOUT']]]);
});

test('a part with one connected pin is never proposed', () => {
  const c = (ref) => [ref, '100n', 'Capacitor_SMD:C_0603_1608Metric', 'Device:C'];
  const r = netlistToParts(kicad([c('C1'), c('C2'), R1],
    [['VCC', 'C1.1', 'C2.1', 'R1.1'], ['GND', 'R1.2'], ['unconnected-(C1-Pad2)', 'C1.2'], ['unconnected-(C2-Pad2)', 'C2.2']]));
  assert.deepEqual(r.groups, []);
});

// ---------------------------------------------------------------------------
// Series strings
// J1 brings +12V and GND in. +12V - R1 - N1 - D1 - N2 - D2 - GND and +12V - R2 - N3 - D3 -
// N4 - D4 - GND (Device:LED, pin 1 K, pin 2 A). No two parts share both nets, so there is
// no part-level block. The two strings are alike and between the same two nets.
// Wanted: one proposed block of two series blocks, R1 D1 D2 and R2 D3 D4.
// (Without J1 the strings close on themselves: every net joins two parts, there are no
// ends, and nothing is proposed. A real board always has something on its rails.)
const LED = (ref) => [ref, 'red', 'LED_SMD:LED_0603_1608Metric', 'Device:LED'];
const J1 = ['J1', 'Conn_01x02', 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical', 'Connector_Generic:Conn_01x02'];
const STRINGS = kicad([LED('D1'), LED('D2'), LED('D3'), LED('D4'), R1, ['R2', '1k', 'Resistor_SMD:R_0603_1608Metric', 'Device:R'], J1], [
  ['+12V', 'R1.1', 'R2.1', 'J1.1'], ['N1', 'R1.2', 'D1.2'], ['N2', 'D1.1', 'D2.2'], ['N3', 'R2.2', 'D3.2'], ['N4', 'D3.1', 'D4.2'], ['GND', 'D2.1', 'D4.1', 'J1.2'],
]);

test('series strings: no part-level block inside a string', () => {
  const r = netlistToParts(STRINGS);
  assert.deepEqual(r.lines.map((l) => [l.ref, l.model]), [['R1', 'resistor'], ['R2', 'resistor'], ['D1–D4', 'mil-opto'], ['J1', 'mil-connector']]);
  assert.deepEqual(r.groups.filter((g) => !g.strings), []);
});

test('series strings: two alike strings between the same nets are proposed as parallel strings', () => {
  const r = netlistToParts(STRINGS);
  assert.deepEqual(r.groups.map((g) => [g.refs, g.nets, g.strings]), [['D1–D4, R1, R2', ['+12V', 'GND'], ['D1, D2, R1', 'D3, D4, R2']]]);
  // The tree: a proposed block of two series blocks. R 100 FIT, LED 400 FIT, J1 50 FIT.
  const items = itemsFor(r.lines, byPrefix({ R: 100, D: 400, J: 50 }));
  let rt = buildStructure(appStructure(r), items);
  assert.deepEqual(rt.nodes.get(blockNamed(rt, 'D1–D4, R1, R2 in parallel').id).children.map((c) => [rt.nodes.get(c).name, refsUnder(rt, c).sort()]),
    [['D1, D2, R1 in series', ['D1', 'D2', 'R1']], ['D3, D4, R2 in series', ['D3', 'D4', 'R2']]]);
  assert.equal(evaluateStructure(rt, 10).board.fit, 2 * 100 + 4 * 400 + 50, 'counts in series until accepted');
  // Accepted as 1 of 2 strings: each string survives with e^−(100 + 2×400)t.
  accept(rt, 'D1–D4, R1, R2 in parallel', 1, 0);
  rt = rebuild(rt, items);
  const e = Math.exp(-900e-9 * HOURS);
  assert.ok(close(evaluateStructure(rt, 10).board.fit, 50 + fitOver(2 * e - e * e, HOURS)));
});

test('series strings: strings facing different ways, or of different parts, are not alike', () => {
  // D3 turned round in the second string; then R2 swapped for a capacitor, C9.
  const turned = STRINGS.replace('(node (ref "D3") (pin "2")', '(node (ref "D3") (pin "X")').replace('(node (ref "D3") (pin "1")', '(node (ref "D3") (pin "2")').replace('(node (ref "D3") (pin "X")', '(node (ref "D3") (pin "1")');
  assert.deepEqual(netlistToParts(turned).groups, []);
  const cap = STRINGS.replace('(comp (ref "R2") (value "1k") (footprint "Resistor_SMD:R_0603_1608Metric") (libsource (lib "Device") (part "R")', '(comp (ref "C9") (value "1u") (footprint "Capacitor_SMD:C_0603_1608Metric") (libsource (lib "Device") (part "C")')
    .replaceAll('(ref "R2")', '(ref "C9")');
  assert.equal(netlistToParts(cap).lines.find((l) => l.ref === 'C9').model, 'capacitor');
  assert.deepEqual(netlistToParts(cap).groups, []);
  // The second string moved to its own rail, +5V, which J1 also brings in.
  const rails = STRINGS.replace('(node (ref "R2") (pin "1") (pintype "passive"))', '');
  const moved = rails.replace('(net (code "6")', '(net (code "7") (name "+5V") (class "Default") (node (ref "R2") (pin "1") (pintype "passive")) (node (ref "J1") (pin "3") (pintype "passive")))\n    (net (code "6")');
  assert.notEqual(moved, STRINGS);
  assert.deepEqual(netlistToParts(moved).groups, []);
});

// ---------------------------------------------------------------------------
// Parts that should never be proposed

// J1, J2: the same 4-pin I2C header twice, pin for pin (a daisy chain); J3 with the pins in
// another order. Each connector serves its own cable; one cannot stand in for another.
test('connectors on the same nets are not proposed', () => {
  const j = (ref) => [ref, 'Conn_01x04', 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical', 'Connector_Generic:Conn_01x04'];
  const r = netlistToParts(kicad([j('J1'), j('J2'), j('J3')], [
    ['GND', 'J1.1', 'J2.1', 'J3.4'], ['+3V3', 'J1.2', 'J2.2', 'J3.3'], ['SDA', 'J1.3', 'J2.3', 'J3.2'], ['SCL', 'J1.4', 'J2.4', 'J3.1'],
  ]));
  assert.deepEqual(r.lines.map((l) => [l.ref, l.model]), [['J1–J3', 'mil-connector']]);
  assert.deepEqual(r.groups, []);
});

// ---------------------------------------------------------------------------
// Designators the tree must still resolve

// C01–C03 100 nF; C01, C02 on VCC/GND, C03 on VCC/AUX. Wanted: block C01, C02 holding both
// parts of the line "C01–C03"; C03 in Everything else.
const ZEROS = protel([['C01', 'C_0603', '100nF'], ['C02', 'C_0603', '100nF'], ['C03', 'C_0603', '100nF'], ['R1', 'R_0603', '10k']],
  [['VCC', 'C01-1', 'C02-1', 'C03-1', 'R1-1'], ['GND', 'C01-2', 'C02-2'], ['AUX', 'C03-2', 'R1-2']]);

test('leading zeros: the total stays the plain sum', () => {
  const r = netlistToParts(ZEROS);
  assert.deepEqual([r.lines.map((l) => l.ref), groupsOf(r)], [['C01–C03', 'R1'], [['C01, C02', ['GND', 'VCC']]]]);
  const items = itemsFor(r.lines, () => 100);
  assert.equal(evaluateStructure(buildStructure(appStructure(r), items), 10).board.fit, 400);
});

test('leading zeros: the proposed block holds C01 and C02', () => {
  const r = netlistToParts(ZEROS);
  const rt = buildStructure(appStructure(r), itemsFor(r.lines, () => 100));
  assert.deepEqual(view(rt), [
    ['Everything else', 'series', [['C03', 'C01–C03'], ['R1', 'R1']]],
    ['C01, C02 in parallel', 'series', [['C01, C02', 'C01–C03']]],
  ]);
  assert.equal(rt.buildProblems.size, 0);
  assert.deepEqual(evaluateStructure(rt, 10).prob.get(blockNamed(rt, 'C01, C02 in parallel').id), []);
});

// R1-2 (10 k) and R7 (12 k), 1000 FIT each, in parallel on A/B; R1, R2 (1 k, 100 FIT) elsewhere.
// Wanted: block R1-2, R7. Accepted 1 of 2: 2×100 + λ-average of 2e^−λt − e^−2λt.
test('a designator with a hyphen is one part, not a range', () => {
  const r = netlistToParts(protel([['R1-2', 'R_0603', '10k'], ['R7', 'R_0603', '12k'], ['R1', 'R_0805', '1k'], ['R2', 'R_0805', '1k']],
    [['A', 'R1-2-1', 'R7-1', 'R1-1'], ['B', 'R1-2-2', 'R7-2'], ['C', 'R1-2', 'R2-1'], ['D', 'R2-2']]));
  // compressRefs sorts prefix "R" before "R1-".
  assert.deepEqual(groupsOf(r), [['R7, R1-2', ['A', 'B']]]);
  const items = itemsFor(r.lines, (l) => (l.ref === 'R1-2' || l.ref === 'R7' ? 1000 : 100));
  let rt = buildStructure(appStructure(r), items);
  assert.deepEqual(refsUnder(rt, blockNamed(rt, 'R7, R1-2 in parallel').id).sort(), ['R1-2', 'R7']);
  accept(rt, 'R7, R1-2 in parallel', 1, 0);
  rt = rebuild(rt, items);
  const e = Math.exp(-1000e-9 * HOURS);
  assert.ok(close(evaluateStructure(rt, 10).board.fit, 200 + fitOver(2 * e - e * e, HOURS)));
});

// The same designator twice (an unannotated or badly annotated schematic, or a tool that
// writes a part once per gate). C1, C2 on VCC/GND; R5 twice. Wanted: R5 never "in parallel"
// with itself, and the tree counts what the lines count once a block is accepted.
test('duplicate designators: no self-parallel block, nothing dropped from the tree', () => {
  const r = netlistToParts(protel([['R5', 'R_0603', '10k'], ['R5', 'R_0603', '10k'], ['C1', 'C_0603', '100nF'], ['C2', 'C_0603', '100nF']],
    [['A', 'R5-1', 'C1-1', 'C2-1'], ['B', 'R5-2', 'C1-2', 'C2-2']]));
  assert.ok(r.groups.every((g) => new Set(expandRefs(g.refs)).size === expandRefs(g.refs).length), JSON.stringify(r.groups));
  const items = itemsFor(r.lines, () => 100);
  let rt = buildStructure(appStructure(r), items);
  accept(rt, 'C1, C2 in parallel', 1, 0);
  rt = rebuild(rt, items);
  const e = Math.exp(-100e-9 * HOURS);
  const ev = evaluateStructure(rt, 10);
  assert.equal(ev.board.pieces, r.lines.reduce((s, l) => s + l.qty, 0));
  assert.ok(close(ev.board.fit, (linesTotal(items) - 200) + fitOver(2 * e - e * e, HOURS)));
  assert.deepEqual([r.duplicates, r.duplicatesCount], ['R5', 1], 'the import reports it');
});

// The same designator on two lines (typed by hand, or two imports merged): a block that
// takes R5 takes it from the first line only, and the second R5 stays in series.
test('a designator on two lines is placed once and counted twice', () => {
  const items = itemsFor([{ ref: 'R5', qty: 1 }, { ref: 'R5', qty: 1 }, { ref: 'R6', qty: 1 }], (l) => 100);
  const rt = buildStructure({ kind: 'block', children: [{ kind: 'block', name: 'pair', mode: 'kofn', need: 1, shortPct: 0, children: [{ kind: 'leaf', refs: 'R5, R6' }] }] }, items);
  const ev = evaluateStructure(rt, 10);
  assert.equal(ev.board.pieces, 3);
  const e = Math.exp(-100e-9 * HOURS);
  assert.ok(close(ev.board.fit, 100 + fitOver(2 * e - e * e, HOURS)));
});

// Altium's multi-channel designators: two channels of one sheet, each with a 10 k resistor
// and three 100 nF capacitors on its own OUT net. Wanted for every naming style: one bank
// per channel, every part in the tree once, and a BOM that reads the same designators.
test('Altium channel designators (R1-A, R1_A, R1A, R1-1, R1_1, R1_CH1) import cleanly', () => {
  const styles = [(b, ch) => `${b}-${'AB'[ch]}`, (b, ch) => `${b}_${'AB'[ch]}`, (b, ch) => `${b}${'AB'[ch]}`,
    (b, ch) => `${b}-${ch + 1}`, (b, ch) => `${b}_${ch + 1}`, (b, ch) => `${b}_CH${ch + 1}`];
  for (const d of styles) {
    const parts = [];
    const nets = [['GND']];
    for (const ch of [0, 1]) {
      parts.push([d('R1', ch), 'R_0603', '10k'], ...['C1', 'C2', 'C3'].map((c) => [d(c, ch), 'C_0603', '100nF']));
      nets.push([`IN${ch}`, `${d('R1', ch)}-1`, `J1-${ch + 1}`], [`OUT${ch}`, `${d('R1', ch)}-2`, ...['C1', 'C2', 'C3'].map((c) => `${d(c, ch)}-1`)]);
      nets[0].push(...['C1', 'C2', 'C3'].map((c) => `${d(c, ch)}-2`));
    }
    nets[0].push('J1-3');
    const r = netlistToParts(protel([...parts, ['J1', 'HDR3', 'HEADER']], nets));
    const name = d('R1', 0);
    assert.deepEqual(groupsOf(r).map(([refs]) => expandRefs(refs).sort()),
      [0, 1].map((ch) => ['C1', 'C2', 'C3'].map((c) => d(c, ch)).sort()).sort((a, b) => a[0].localeCompare(b[0])), name);
    const items = itemsFor(r.lines, () => 10);
    const rt = buildStructure(appStructure(r), items);
    assert.equal(rt.buildProblems.size, 0, name);
    assert.deepEqual(refsUnder(rt, ROOT).sort(), [...parts.map(([ref]) => ref), 'J1'].sort(), name);
    assert.equal(evaluateStructure(rt, 10).board.fit, 90, name);
    assert.deepEqual(splitDesignators(`${d('C1', 0)}, ${d('C1', 1)}, ${name}`), [d('C1', 0), d('C1', 1), name].map((x) => x.toUpperCase()), name);
  }
});

// 400 capacitors on +1V0/GND with odd numbers (C1, C3, … C799) and 400 on +1V8/GND with
// even ones: two banks whose refs never form a range, about 2300 characters each.
test('a bank of 400 parts survives save and load', () => {
  const cap = (n) => [`C${n}`, '100n', 'Capacitor_SMD:C_0402_1005Metric', 'Device:C'];
  const odd = Array.from({ length: 400 }, (_, i) => 2 * i + 1);
  const even = odd.map((n) => n + 1);
  const text = kicad([...odd, ...even].map(cap), [
    ['+1V0', ...odd.map((n) => `C${n}.1`)], ['+1V8', ...even.map((n) => `C${n}.1`)], ['GND', ...[...odd, ...even].map((n) => `C${n}.2`)],
  ]);
  const r = netlistToParts(text);
  assert.equal(r.groups.length, 2);
  const rt = buildStructure(sanitizeStructure(JSON.parse(JSON.stringify(appStructure(r)))), itemsFor(r.lines, () => 1));
  const first = rt.nodes.get(ROOT).children.find((id) => id !== REST);
  assert.deepEqual(refsUnder(rt, first).sort(), odd.map((n) => `C${n}`).sort());
});

// A range is written only when it reads back as the same designators.
test('compressRefs never writes a range that reads back differently', () => {
  for (const refs of [['C8', 'C09', 'C10'], ['C08', 'C09', 'C10'], ['R1-1', 'R1-2', 'R1-3'], ['C1', 'C2', 'C3', 'C03']]) {
    assert.deepEqual(expandRefs(compressRefs(refs)).sort(), [...refs].sort(), compressRefs(refs));
  }
  assert.equal(compressRefs(['C8', 'C09', 'C10']), 'C8, C09, C10');
});

// A line whose refs repeat ("R5, R5", two parts) is placed whole: a block that holds it
// keeps both parts through save and load.
test('a line with a repeated designator is placed whole and keeps both parts', () => {
  const items = itemsFor([{ ref: 'R5, R5', qty: 2 }, { ref: 'C1', qty: 1 }], () => 100);
  const saved = { kind: 'block', children: [{ kind: 'block', name: 'R5s', mode: 'series', children: [{ kind: 'leaf', refs: 'R5, R5' }] }] };
  for (const rt of [buildStructure(saved, items), rebuild(buildStructure(saved, items), items)]) {
    assert.equal(rt.buildProblems.size, 0, JSON.stringify([...rt.buildProblems]));
    assert.equal(evaluateStructure(rt, 10).stats.get(blockNamed(rt, 'R5s').id).pieces, 2);
    assert.equal(evaluateStructure(rt, 10).board.pieces, 3);
  }
});

// A saved leaf longer than the limit is cut between refs, never inside one.
test('an over-long saved leaf is cut at a comma', () => {
  const refs = Array.from({ length: 40000 }, (_, i) => `C${2 * i + 1}`);
  const kept = sanitizeStructure({ kind: 'block', children: [{ kind: 'block', children: [{ kind: 'leaf', refs: refs.join(', ') }] }] }).children[0].children[0].refs.split(', ');
  assert.ok(kept.length > 20000 && kept.length < refs.length, `${kept.length}`);
  assert.deepEqual(kept, refs.slice(0, kept.length));
});

// ---------------------------------------------------------------------------
// The page: import, accept, and the board figures follow the formula
//
// C1, C2 100 nF on +3V3/GND and C3, C4 10 µF on +5V/GND: two proposals. R1 on its own.
// Each line is set to "Other part" with its rate entered: C 1000 FIT, C3/C4 500 FIT,
// R1 50 FIT, so 3050 FIT in series. C1, C2 accepted as 1 of 2:
//   no shorts:  1050 + λ-average of 2e^−λt − e^−2λt          = 1130.59 FIT
//   49 % shorts: 1050 + λ-average of e^−2λt + 2(0.51)(1 − e^−λt)e^−λt = 2030.87 FIT
const PAGE_NETLIST = `(export (version "E")
  (components
    (comp (ref "C1") (value "100n") (footprint "Capacitor_SMD:C_0603_1608Metric") (libsource (lib "Device") (part "C") (description "Unpolarized capacitor")))
    (comp (ref "C2") (value "100n") (footprint "Capacitor_SMD:C_0603_1608Metric") (libsource (lib "Device") (part "C") (description "Unpolarized capacitor")))
    (comp (ref "C3") (value "10u") (footprint "Capacitor_SMD:C_0805_2012Metric") (libsource (lib "Device") (part "C") (description "Unpolarized capacitor")))
    (comp (ref "C4") (value "10u") (footprint "Capacitor_SMD:C_0805_2012Metric") (libsource (lib "Device") (part "C") (description "Unpolarized capacitor")))
    (comp (ref "R1") (value "10k") (footprint "Resistor_SMD:R_0603_1608Metric") (libsource (lib "Device") (part "R") (description "Resistor"))))
  (nets
    (net (code "1") (name "+3V3") (node (ref "C1") (pin "1")) (node (ref "C2") (pin "1")) (node (ref "R1") (pin "1")))
    (net (code "2") (name "GND") (node (ref "C1") (pin "2")) (node (ref "C2") (pin "2")) (node (ref "C3") (pin "2")) (node (ref "C4") (pin "2")))
    (net (code "3") (name "+5V") (node (ref "C3") (pin "1")) (node (ref "C4") (pin "1")))
    (net (code "4") (name "EN") (node (ref "R1") (pin "2")))))`;

test('page: import a KiCad netlist, accept a proposal, and the figures follow the formula', async () => {
  const root = new URL('..', import.meta.url);
  const dom = new JSDOM(readFileSync(new URL('index.html', root), 'utf8'), { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  const downloads = [];
  Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, confirm: () => true, alert: () => {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error ?? e.message));
  await import(new URL('assets/app.js', root).href);
  const { currentStructure } = await import(new URL('assets/structure-ui.js', root).href);

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  const typeInto = (el, v) => { el.value = String(v); fire(el, 'input'); };
  const choose = (el, v) => { el.value = v; fire(el, 'input'); fire(el, 'change'); };
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const pick = async (id, file) => { Object.defineProperty($(id), 'files', { value: [file], configurable: true }); fire($(id), 'change'); await settle(); };
  // A closed card is only its head: the test opens it before looking inside, as a user would.
  const cardFor = (ref) => {
    const find = () => $$('.part').find((p) => $('[data-key="ref"]', p).value === ref);
    const c = find();
    if (c && $('.part-body', c).hidden) $('[data-act="toggle"]', c).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    return find();
  };
  const row = (name) => $$('#st-tree li[role="treeitem"]').find((li) => $('.st-nm', li)?.textContent.includes(name));
  const ev = () => currentStructure().ev;
  const exportJson = async () => { click($('[data-act="export-json"]')); return JSON.parse(await downloads.at(-1).text()); };
  const tiles = () => $$('#summary .tile .value').map((v) => v.textContent);

  await pick('#netlist-file', { name: 'rails.net', arrayBuffer: async () => new TextEncoder().encode(PAGE_NETLIST).buffer });
  assert.match($('#import-report').textContent, /Proposed 2 blocks of parts wired in parallel/);
  assert.deepEqual($$('.part [data-key="ref"]').map((i) => i.value), ['C1, C2', 'C3, C4', 'R1']);
  // The handler's saved structure is the one the tests above build.
  assert.deepEqual((await exportJson()).structure, appStructure(netlistToParts(PAGE_NETLIST)));
  assert.equal($$('#st-tree .st-badge.proposed').length, 2);

  // Known rates: each line becomes "Other part" with its rate entered.
  for (const [ref, fit] of [['C1, C2', 1000], ['C3, C4', 500], ['R1', 50]]) {
    choose($('[data-bind="part-model"]', cardFor(ref)), 'fixed');
    typeInto($('[data-key="fit"]', cardFor(ref)), fit);
  }
  assert.equal(ev().red.size, 0);
  assert.equal(ev().board.fit, 3050, 'proposals count in series');
  assert.equal(tiles()[0], '3,100 FIT');

  // Accept C1, C2; the page asks how many must work and the share of shorts.
  click($('.st-nm', row('C1, C2 in parallel')));
  click($('[data-st="accept"]', $('#st-inspector')));
  assert.equal($('.st-proposal', $('#st-inspector')), null);
  assert.equal(ev().board.fit, 3050, 'counts in series until complete');
  typeInto($('#st-need'), 1);
  typeInto($('#st-short'), 0);
  const e = Math.exp(-1000e-9 * HOURS);
  const pair = 2 * e - e * e;
  assert.ok(close(ev().board.fit, 1050 + fitOver(pair, HOURS)), `${ev().board.fit}`);
  assert.ok(close(ev().board.fit, 1130.5878673579411));
  assert.match($('#summary .label').textContent, /average over 10 years/);
  assert.equal(tiles()[0], '1,100 FIT');
  // Survival: the series parts times the pair, 0.9057.
  assert.ok(close(ev().survival(HOURS), Math.exp(-1050e-9 * HOURS) * pair));
  assert.equal(tiles()[2], '90.6%');
  typeInto($('#st-short'), 49);
  const withShorts = e * e + 2 * 0.51 * (1 - e) * e;
  assert.ok(close(ev().board.fit, 1050 + fitOver(withShorts, HOURS)));
  assert.ok(close(ev().board.fit, 2030.8670141893958));

  // Dismiss the other proposal: its parts go back to Everything else, the total stays.
  click($('.st-nm', row('C3, C4 in parallel')));
  click($('[data-st="dismiss"]', $('#st-inspector')));
  assert.equal(row('C3, C4 in parallel'), undefined);
  assert.equal($$('#st-tree .st-badge.proposed').length, 0);
  assert.ok(close(ev().board.fit, 2030.8670141893958));

  // JSON out and back in: the same figures and the same block.
  const saved = await exportJson();
  assert.deepEqual(saved.structure.children.map((b) => [b.name, b.mode, b.need, b.shortPct, b.proposed, b.nets, b.children]),
    [['C1, C2 in parallel', 'kofn', 1, 49, undefined, ['+3V3', 'GND'], [{ kind: 'leaf', refs: 'C1, C2' }]]]);
  click($('[data-act="new"]'));
  assert.equal(ev().board.fit, 0);
  await pick('#import-file', { text: async () => JSON.stringify(saved) });
  assert.ok(close(ev().board.fit, 2030.8670141893958));

  // Parallel strings on the page: a block of two series blocks; dismissing it puts all
  // six parts back in series and leaves no string blocks behind.
  await pick('#netlist-file', { name: 'strings.net', arrayBuffer: async () => new TextEncoder().encode(STRINGS).buffer });
  assert.match($('#import-report').textContent, /Proposed 1 block of parts wired in parallel/);
  const strings = currentStructure().rt;
  const block = [...strings.nodes.values()].find((x) => x.name === 'D1–D4, R1, R2 in parallel');
  assert.deepEqual(block.children.map((c) => strings.nodes.get(c).name), ['D1, D2, R1 in series', 'D3, D4, R2 in series']);
  click($('.st-nm', row('D1–D4, R1, R2 in parallel')));
  click($('[data-st="dismiss"]', $('#st-inspector')));
  const after = currentStructure().rt;
  assert.deepEqual([...after.nodes.values()].filter((x) => x.kind === 'block').map((x) => x.name), ['Board', 'Everything else']);
  assert.equal(refsUnder(after, ROOT).length, 7);

  // A designator used twice is named in the report.
  const twice = protel([['R5', 'R_0603', '10k'], ['R5', 'R_0603', '10k'], ['C1', 'C_0603', '100nF']], [['A', 'R5-1', 'C1-1'], ['B', 'R5-2', 'C1-2']]);
  await pick('#netlist-file', { name: 'twice.net', arrayBuffer: async () => new TextEncoder().encode(twice).buffer });
  assert.match($('#import-report').textContent, /1 designator is used more than once \(R5\)/);
  assert.deepEqual(errors, []);
});
