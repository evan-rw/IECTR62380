// The import report.
// "Import netlist" at the top of the page it starts at y = 838 px of a 900 px desktop
// window and at y = 1774 px on a 360 x 740 phone, the focus stays on <body>, the next
// step is a sentence ("Tick ... to work through them") rather than a control, and
// Dismiss drops the focus to <body>.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, protel } from './_page-board.mjs';

let page;
const NETLIST = protel([
  ['U1', 'LQFP-48_7x7mm_P0.5mm', 'STM32F103C8T6'],
  ['C1', 'C_0603_1608Metric', '100nF'],
  ['C2', 'C_0603_1608Metric', '100nF'],
  ['R1', 'R_0603_1608Metric', '10k'],
  ['J1', 'PinHeader_1x04', 'Conn_01x04'],
], [
  ['GND', 'U1-8', 'C1-2', 'C2-2', 'J1-1'],
  ['+3V3', 'U1-48', 'C1-1', 'C2-1', 'R1-1', 'J1-2'],
  ['NRST', 'U1-7', 'R1-2'],
]);

before(async () => {
  page = await openPage();
  // The user's path: the toolbar button, then the file picker.
  page.click(page.$('[data-act="import-netlist"]'));
  page.$('[data-act="import-netlist"]').focus();
  await page.pick('#netlist-file', 'demo.net', NETLIST);
});

test('the report appears next to the toolbar that started the import, and takes the focus', () => {
  const { $, document } = page;
  const report = $('#import-report');
  assert.equal(report.hidden, false);
  assert.match(report.textContent, /Read 5 components from “demo.net”/);
  const board = $('#board-heading').closest('section');
  assert.ok(board.contains(report), 'in the Board panel, under the file toolbar, not in Parts');
  assert.ok(report.compareDocumentPosition($('#summary')) & 4, 'above the summary tiles');
  assert.ok(report === document.activeElement || report.contains(document.activeElement), 'focus moves to the report, so it is read out and in view');
});

test('the next step is a button, not an instruction', () => {
  const { $, $$, click, document } = page;
  const report = $('#import-report');
  const go = $$('button', report).find((b) => /attention/i.test(b.textContent));
  assert.ok(go, 'a button that shows the lines that need attention');
  click(go);
  assert.equal($('#attention-only').checked, true);
  assert.ok($('#parts').classList.contains('attention-only'));
  const first = $('#parts .part.needs-input, #parts .part.has-guesses');
  assert.ok(first.contains(document.activeElement), 'focus lands on the first line to fix');
});

test('dismissing the report gives the focus back to the toolbar button', () => {
  const { $, click, document } = page;
  const dismiss = $('#import-report [data-act="dismiss-report"]');
  dismiss.focus();
  click(dismiss);
  assert.equal($('#import-report').hidden, true);
  assert.notEqual(document.activeElement, document.body, 'focus is not dropped to the page');
  assert.equal(document.activeElement, $('[data-act="import-netlist"]'));
});
