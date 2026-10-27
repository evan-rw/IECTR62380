// Drives the real page (index.html + assets/app.js) in jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const root = new URL('..', import.meta.url);

const NETLIST = [
  'PROTEL NETLIST 2.0',
  ...[
    ['U1', 'LQFP-48_7x7mm_P0.5mm', 'STM32F103C8T6'],
    ['C1', 'C_0603_1608Metric', '100nF'],
    ['C2', 'C_0603_1608Metric', '100nF'],
    ['C3', 'C_0603_1608Metric', '100nF'],
    ['R1', 'R_0603_1608Metric', '10µ'], // non-ASCII value, written in Windows-1252 below
    ['J1', 'PinHeader_1x04', 'Conn_01x04'],
    ['TP1', 'TestPoint', 'TP'],
  ].map(([d, f, v]) => `[\r\nDESIGNATOR\r\n${d}\r\nFOOTPRINT\r\n${f}\r\nPARTTYPE\r\n${v}\r\nDESCRIPTION\r\n\r\n]`),
  '(\r\nGND\r\nU1-8\r\nC1-2\r\n)',
].join('\r\n');

// Encode as Windows-1252 so "µ" is the single byte 0xB5, as older EDA tools write it.
const cp1252 = (s) => Uint8Array.from([...s].map((ch) => (ch === 'µ' ? 0xb5 : ch.charCodeAt(0)))).buffer;

test('page behaviour: editing, part types, netlist import, files, storage', async () => {
  const dom = new JSDOM(readFileSync(new URL('index.html', root), 'utf8'), { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  const downloads = [];
  let alerted = '';
  Object.assign(globalThis, {
    window, document: window.document, localStorage: window.localStorage,
    confirm: () => true, alert: (m) => { alerted = m; },
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error ?? e.message));

  await import(new URL('assets/app.js', root).href);

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  const typeInto = (el, v) => { el.value = String(v); fire(el, 'input'); };
  const choose = (el, v) => { el.value = v; fire(el, 'input'); fire(el, 'change'); };
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const fill = (card, values) => { for (const [k, v] of Object.entries(values)) typeInto($(`[data-key="${k}"]`, card), v); };
  const total = () => $('#summary .value').textContent;
  // The results table keeps three significant digits; the headline tiles show two.
  const boardTotal = () => parseFloat($('#results tr:last-child td:nth-child(5)').textContent.replace(/,/g, ''));
  const warn = () => $('#summary .warn')?.textContent ?? '';
  const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const pick = async (inputId, file) => {
    const input = $(inputId);
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fire(input, 'change');
    await settle();
  };
  const cardFor = (ref) => $$('.part').find((p) => $('[data-key="ref"]', p).value === ref);

  // The example board renders complete, with the provenance and safety-case caution up top.
  assert.equal($$('.part').length, 8);
  assert.equal(total(), '49 FIT');
  assert.equal(boardTotal(), 48.7);
  assert.equal(warn(), '');
  assert.match($('.notice').textContent, /not taken from the standard.*not suitable as evidence for an ISO 26262 or IEC 61508 safety case/s);
  assert.match($('#summary .scope').textContent, /parts wired in parallel still add up/);

  // Typing updates results without replacing the input being typed in.
  const u1 = $$('.part')[0];
  const power = $('[data-key="power"]', u1);
  typeInto(power, 2);
  assert.ok(document.contains(power));
  assert.notEqual(boardTotal(), 48.7);
  typeInto(power, 0.8);
  assert.equal(boardTotal(), 48.7);
  typeInto($('[data-key="count"]', u1), 1000);
  assert.match($('[data-help-key="count"]', u1).textContent, /= 4000 transistors/);

  // A diagonal package marks the body size missing and drops the part from the total.
  choose($('[data-key="package"]', u1), 'diag-matrix');
  let card = $$('.part')[0];
  assert.equal($('[data-out="fit"]', card).textContent, 'Needs input');
  assert.deepEqual($$('.field.missing', card).map((f) => f.dataset.field), ['bodyW', 'bodyL']);
  assert.equal($('[data-field="bodyW"] .state-tag', card).textContent, 'Missing');
  assert.equal($('[data-key="bodyW"]', card).getAttribute('aria-invalid'), 'true');
  assert.match(warn(), /1 part line needs more input/);
  // With a line left out, the total is a lower bound and MTBF/survival are upper bounds.
  assert.match(total(), /^≥ \d/);
  assert.match($$('#summary .value')[1].textContent, /^≤ /);
  assert.match($$('#summary .value')[2].textContent, /^≤ /);
  assert.match($('#summary').textContent, /Lower bound: 1 line left out/);
  assert.equal(document.activeElement?.dataset.key, 'package');
  fill(card, { bodyW: 13, bodyL: 15 });
  assert.equal($$('.field.missing', card).length, 0);
  assert.equal(warn(), '');
  assert.doesNotMatch(total(), /≥/);

  // New parts start with their operating values missing, then compute once filled.
  for (const opt of [...$('#add-model').options]) {
    $('#add-model').value = opt.value;
    click($('[data-act="add-part"]'));
  }
  const refs = $$('.part [data-key="ref"]').map((i) => i.value);
  assert.deepEqual(refs.slice(8), ['U4', 'D5', 'Q3', 'C22', 'R31', 'L1', 'X1'], 'numbering continues past ranges like D1–D4');
  assert.match(warn(), /6 part lines need more input/, 'all but the capacitor');
  fill(cardFor('U4'), { count: 1000, power: 0.1, rja: 50 });
  fill(cardFor('D5'), { power: 0.01, rja: 300 });
  fill(cardFor('Q3'), { stress: 0.5, power: 0.05, rja: 300 });
  fill(cardFor('R31'), { power: 0.01, rated: 0.1 });
  fill(cardFor('L1'), { l0: 1, ploss: 0.1, area: 0.04 });
  fill(cardFor('X1'), { fit: 25 });
  assert.equal(warn(), '');

  // Quantity, duplicate, remove, collapse.
  const fixed = cardFor('X1');
  const before = boardTotal();
  typeInto($('[data-key="qty"]', fixed), 2);
  assert.ok(Math.abs(boardTotal() - before - 25) < 0.15, `${boardTotal()} vs ${before}`);
  click($('[data-act="dup"]', fixed));
  assert.ok(cardFor('X1 copy'));
  click($('[data-act="del"]', cardFor('X1 copy')));
  click($('[data-act="toggle"]', cardFor('X1')));
  assert.equal($('.part-body', cardFor('X1')).hidden, true);

  // The automotive profiles from TI SLOA294A Table 6-1.
  choose($('#preset'), 'auto-motor');
  assert.equal($$('#phases tr').length, 6);
  assert.match($('#tau-summary').textContent, /τon = 0.058, τoff = 0.942/);
  assert.equal($('#profile-problems').textContent, '');
  assert.equal($('#phases [data-i="3"][data-key="tac"]').placeholder, '—', 'cycle-only phases leave t_ac blank');
  typeInto($('#phases [data-i="0"][data-key="tac"]'), '');
  assert.match($('#profile-problems').textContent, /Phase 1 is a working phase but has no t_ac/);

  // Mission profile editing.
  choose($('#preset'), 'military-radio');
  assert.equal($$('#phases tr').length, 2);
  assert.match($('#tau-summary').textContent, /τon = 0.01, τoff = 0.99/);
  typeInto($('#phases [data-i="0"][data-key="tau"]'), 0.5);
  assert.equal($('#preset').value, '', 'editing a preset makes it custom');
  typeInto($('#phases [data-i="1"][data-key="tau"]'), 0.7);
  assert.match($('#profile-problems').textContent, /more than 1/);
  click($('[data-act="del-phase"][data-i="1"]'));
  assert.equal($('#profile-problems').textContent, '');

  // Netlist import: grouped lines, mechanical parts skipped, missing and guessed marked.
  await pick('#netlist-file', { name: 'demo.NET', arrayBuffer: async () => cp1252(NETLIST) });
  assert.equal(alerted, '');
  assert.deepEqual($$('.part [data-key="ref"]').map((i) => i.value), ['U1', 'C1–C3', 'R1', 'J1']);
  assert.equal($('#title').value, 'demo');
  const report = $('#import-report');
  assert.equal(report.hidden, false);
  assert.match(report.textContent, /Read 7 components from “demo.NET” \(Protel 2.0, 1 net\) into 4 lines/);
  assert.match(report.textContent, /Skipped 1 mechanical items \(TP1\)/);
  assert.match(report.textContent, /3 lines need input/);
  // Only the capacitors are complete: 3 × 0.15 × (π_t(26 °C)·0.5 + 3.3e-3 × 36^0.76 × 15^0.68).
  assert.equal(boardTotal(), 0.356);
  assert.equal(total(), '≥ 0.36 FIT');
  assert.match(warn(), /3 part lines need more input.*3 lines use guessed values/);

  const mcu = cardFor('U1');
  assert.ok(mcu.classList.contains('needs-input') && mcu.classList.contains('has-guesses'));
  assert.match($('[data-out="flags"]', mcu).textContent, /3 missing.*2 guessed/);
  assert.match($('.source-line', mcu).textContent, /Value: STM32F103C8T6 · Footprint: LQFP-48_7x7mm_P0.5mm/);
  assert.deepEqual($$('.field.missing', mcu).map((f) => f.dataset.field), ['count', 'power', 'rja']);
  assert.deepEqual($$('.field.inferred', mcu).map((f) => f.dataset.field), ['family', 'package']);
  assert.match($('[data-guess-for="package"]', mcu).textContent, /from footprint “LQFP-48_7x7mm_P0.5mm”/);
  assert.match($('.source-line', cardFor('R1')).textContent, /Value: 10µ/, 'Windows-1252 µ decoded');
  assert.match($('[data-out="desc"]', cardFor('J1')).textContent, /^Connector \(clause 16\)/);

  // The attention filter hides parts with nothing to do.
  const onlyAttention = $('#attention-only');
  onlyAttention.checked = true;
  fire(onlyAttention, 'change');
  assert.ok($('#parts').classList.contains('attention-only'));
  onlyAttention.checked = false;
  fire(onlyAttention, 'change');

  // Changing a guessed select clears that guess; filling the gaps completes the part.
  choose($('[data-key="family"]', mcu), 'mos-digital');
  let mcuCard = cardFor('U1');
  assert.deepEqual($$('.field.inferred', mcuCard).map((f) => f.dataset.field), ['package']);
  fill(mcuCard, { count: 1e5, power: 0.3, rja: 60 });
  assert.ok(!mcuCard.classList.contains('needs-input'));
  assert.ok(boardTotal() > 0.356);
  click($('[data-act="confirm-guesses"]', mcuCard));
  mcuCard = cardFor('U1');
  assert.ok(!mcuCard.classList.contains('has-guesses'));
  assert.equal($$('.field.inferred', mcuCard).length, 0);
  // Confirming keeps a record of what was guessed; editing the value removes it.
  assert.match($('[data-confirmed-for="package"]', mcuCard).textContent, /Guessed from footprint .*; confirmed/);
  choose($('[data-key="package"]', mcuCard), 'pqfp-10');
  assert.equal($('[data-confirmed-for="package"]', cardFor('U1')), null);

  // Split turns a grouped line into one line per reference, keeping its values.
  const caps = cardFor('C1–C3');
  click($('[data-act="split"]', caps));
  assert.deepEqual($$('.part [data-key="ref"]').map((i) => i.value).filter((r) => r.startsWith('C')), ['C1', 'C2', 'C3']);
  assert.equal($('[data-key="qty"]', cardFor('C2')).value, '1');
  assert.ok(cardFor('C2').classList.contains('has-guesses'), 'guesses carried over');
  assert.equal($('[data-act="split"]', cardFor('C2')), null, 'single lines have no Split');

  // Typing into a guessed number clears its guess.
  const res = cardFor('R1');
  click($('[data-act="toggle"]', res));
  assert.equal($('[data-field="rated"]', cardFor('R1')).classList.contains('inferred'), true);
  typeInto($('[data-key="rated"]', cardFor('R1')), 0.125);
  assert.equal($('[data-field="rated"]', cardFor('R1')).classList.contains('inferred'), false);

  // A file that is not a netlist leaves the board alone.
  const partsBefore = $$('.part').length;
  await pick('#netlist-file', { name: 'notes.txt', arrayBuffer: async () => new TextEncoder().encode('hello').buffer });
  assert.match(alerted, /Could not read “notes.txt”: No components found/);
  assert.equal($$('.part').length, partsBefore);

  // JSON round trip keeps guesses, confirmed guesses and netlist sources.
  click($('[data-act="toggle"]', cardFor('C3')));
  click($('[data-act="confirm-guesses"]', cardFor('C3')));
  const exported = total();
  click($('[data-act="export-json"]'));
  const json = await downloads.at(-1).text();
  const parsed = JSON.parse(json);
  assert.equal(parsed.format, 'iec62380-board');
  assert.ok(!('id' in parsed.parts[0]) && !('open' in parsed.parts[0]), 'export omits UI state');
  assert.equal(parsed.parts.find((p) => p.ref === 'C1').inferred.type.startsWith('assumed class II'), true);
  assert.match(parsed.parts.find((p) => p.ref === 'C3').confirmed.type, /assumed class II/);
  assert.equal(parsed.parts.find((p) => p.ref === 'C3').inferred, undefined);
  assert.equal(parsed.parts.find((p) => p.ref === 'R1').source.value, '10µ');
  click($('[data-act="new"]'));
  assert.equal(total(), '0 FIT');
  await pick('#import-file', { text: async () => json });
  assert.equal(total(), exported);
  assert.equal($$('.field.inferred', cardFor('C1')).length, 1);

  // A blank phase temperature survives a save and reload instead of becoming a default.
  choose($('#preset'), 'auto-motor');
  click($('[data-act="export-json"]'));
  await pick('#import-file', { text: async () => downloads.at(-1).text() });
  assert.equal($('#phases [data-i="3"][data-key="tac"]').value, '');
  assert.equal($('#profile-problems').textContent, '');

  // CSV: one row per line plus header and total; formula-like text neutralised.
  typeInto($('[data-key="ref"]', $$('.part')[0]), '=HYPERLINK("x")');
  click($('[data-act="export-csv"]'));
  const csv = (await downloads.at(-1).text()).split('\r\n');
  assert.match(csv[0], /^"Ref","Part type"/);
  assert.equal(csv.length, $$('.part').length + 2);
  assert.match(csv[1], /^"'=HYPERLINK\(""x""\)"/);
  assert.ok(csv.some((row) => row.includes('Missing: Failure rate λ.')), 'missing values listed');

  // Autosave, and a bad JSON import leaves the board alone.
  await settle(300);
  assert.equal(JSON.parse(localStorage.getItem('iec62380.board.v1')).parts.length, $$('.part').length);
  await pick('#import-file', { text: async () => '{"nope":1}' });
  assert.match(alerted, /not a board/);

  assert.deepEqual(errors, []);
});
