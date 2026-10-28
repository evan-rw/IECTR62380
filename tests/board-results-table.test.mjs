// The "Results by part" rows.
// make a 569 px row on a phone), the part type is hidden on phones, and a row leads
// nowhere: an engineer reading "Missing" has to find that line among hundreds of cards.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, protel } from './_page-board.mjs';

let page;
// Thirty 100 nF capacitors on odd designators only, so the line's reference list
// cannot be shortened to a range: "C1, C3, C5, …, C59".
const caps = Array.from({ length: 30 }, (_, i) => `C${2 * i + 1}`);
const NETLIST = protel([
  ['U1', 'SOIC-8_3.9x4.9mm_P1.27mm', 'NE555'],
  ...caps.map((c) => [c, 'C_0603_1608Metric', '100nF']),
  ['R1', 'R_0603_1608Metric', '10k'],
], [
  ['+5V', 'U1-8', 'R1-1', ...caps.map((c) => `${c}-1`)],
  ['GND', 'U1-1', ...caps.map((c) => `${c}-2`)],
  ['OUT', 'U1-3', 'R1-2'],
]);

before(async () => {
  page = await openPage();
  await page.pick('#netlist-file', 'odd-caps.net', NETLIST);
});

const rowFor = (ref) => page.$$('#results tr').find((tr) => tr.cells[0].textContent.trim() === ref);

test('a long reference list stays one short row: full list as a tooltip, part type kept for phones', () => {
  const { $$ } = page;
  const capRef = caps.join(', ');
  const row = rowFor(capRef);
  assert.ok(row, 'the capacitor line is in the results, with its reference text unchanged');
  const cell = row.cells[0];
  // The full list stays available on hover and to screen readers.
  assert.ok([cell, ...cell.querySelectorAll('*')].some((el) => el.getAttribute('title') === capRef), 'full reference list as a tooltip');
  // The part column is hidden below 760 px (td.opt); the first cell must still say what the line is.
  const phoneText = `${cell.dataset.desc ?? ''} ${[...cell.querySelectorAll('.ref-desc')].map((e) => e.textContent).join(' ')}`;
  assert.match(phoneText, /Ceramic/, 'the part type travels with the reference for narrow screens');
  assert.equal($$('#results tr.top').length, 1);
});

test('clicking a line in the results opens that part and puts the focus on it', () => {
  const { $, click, document } = page;
  const row = rowFor('U1');
  const target = row.cells[0].querySelector('button, a');
  assert.ok(target, 'the reference is a button (keyboard reachable), not plain text');
  click(target);
  const card = page.$$('#parts .part').find((p) => $('[data-key="ref"]', p).value === 'U1');
  assert.equal($('[data-act="toggle"]', card).getAttribute('aria-expanded'), 'true', 'the line is opened');
  assert.ok(card.contains(document.activeElement), 'the focus moves into that line');
  assert.equal(page.scrolledTo && card.contains(page.scrolledTo), true, 'and the page scrolls to it');
});

test('a line hidden by "Only parts that need attention" is shown when picked from the results', () => {
  const { $, click, fire, document } = page;
  const filter = $('#attention-only');
  filter.checked = true;
  fire(filter, 'change');
  // The capacitors are complete (no Missing, guesses confirmed) so the filter hides them.
  const capCard = page.$$('#parts .part').find((p) => $('[data-key="ref"]', p).value.startsWith('C1, C3'));
  const confirm = $('[data-act="confirm-guesses"]', capCard);
  if (confirm) click(confirm);
  const target = rowFor(caps.join(', ')).cells[0].querySelector('button, a');
  assert.ok(target, 'the reference is a button');
  click(target);
  const card = page.$$('#parts .part').find((p) => $('[data-key="ref"]', p).value.startsWith('C1, C3'));
  assert.ok(card.contains(document.activeElement));
  assert.ok(!($('#parts').classList.contains('attention-only') && !card.matches('.needs-input, .has-guesses')), 'the picked line is not left hidden by the filter');
});
