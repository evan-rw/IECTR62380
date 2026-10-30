// ICs by part number: one row per IC part number under Parts, covering all its lines. The importer guesses
// most families from the name or the function; a family, a confirmation or an R_JA typed here applies to
// every line of the part, as on each line's own card. R_JA is never guessed (no public table is complete enough).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, protel } from './_page-board.mjs';

let page;
const NETLIST = protel([
  // The same logic part in two packages: two lines, one part number.
  ['U1', 'SOT-23-5', 'SN74LVC1G14DBVR'],
  ['U2', 'SC-70-5', 'SN74LVC1G14DBVR'],
  ['U3', 'VQFN-12', 'TPS62902RPJR'],
  ['U4', 'SOIC-8', 'ZZ9000'],
  ['U5', 'SOIC-8', 'W25Q128JVSIQ'],
  ['C1', 'C_0603_1608Metric', '100nF'],
], [
  ['GND', 'U1-3', 'U2-2', 'U3-1', 'U4-4', 'U5-4', 'C1-2'],
  ['+3V3', 'U1-5', 'U2-5', 'U3-2', 'U4-8', 'U5-8', 'C1-1'],
]);

before(async () => {
  page = await openPage();
  await page.pick('#netlist-file', 'ics.net', NETLIST);
});

const rows = () => page.$$('#ic-families tr').map((tr) => ({
  pn: page.$('th', tr).textContent,
  lines: page.$$('td', tr)[0].textContent,
  qty: page.$$('td', tr)[1].textContent,
  family: page.$('select', tr).value,
  state: page.$$('td', tr)[2].className,
  rja: page.$('input', tr).value,
  rjaState: page.$$('td', tr)[3].className,
  why: page.$$('td', tr)[4].textContent,
}));
const lineOf = (ref) => JSON.parse(page.window.localStorage.getItem('iec62380.board.v1') ?? '{}').parts?.find((p) => p.ref === ref);
// A line's card, opened: a closed card holds only its head.
const openCard = (ref) => {
  const card = page.$$('#parts [data-part]').find((c) => page.$('[data-key="ref"]', c)?.value === ref);
  if (!card.classList.contains('is-open')) page.click(page.$('[data-act="toggle"]', card));
  return page.$(`[data-part="${card.dataset.part}"]`);
};
const rowFor = (pn) => page.$$('#ic-families tr').find((tr) => page.$('th', tr).textContent === pn);

test('one row per IC part number: missing first, then guessed, with the reason; the report offers the list', () => {
  const { $ } = page;
  assert.equal($('#ic-review').hidden, false);
  assert.equal($('#ic-review-summary').textContent, 'ICs by part number: 4; family 1 missing, 3 guessed; R_JA missing on 4');
  const r = rows();
  assert.deepEqual(r.map((x) => [x.pn, x.qty, x.family, x.state]), [
    ['ZZ9000', '1', '', 'missing'],
    ['SN74LVC1G14DBVR', '2', 'mos-digital', 'inferred'],
    ['TPS62902RPJR', '1', 'bicmos-highv', 'inferred'],
    ['W25Q128JVSIQ', '1', 'mos-eprom', 'inferred'],
  ]);
  assert.match(r[1].lines, /^U1, U2$/);
  assert.equal(r[0].why, 'Nothing in the name, description or symbol says.');
  assert.match(r[2].why, /^Guessed: assumed for a power IC .*the name does not say how the chip is made$/);
  assert.ok(page.$$('#ic-families tr select, #ic-families tr input').every((s) => page.$(`label[for="${s.id}"]`)), 'each control has a label');
  assert.deepEqual(r.map((x) => [x.rja, x.rjaState]), Array(4).fill(['', 'missing']), 'R_JA is not guessed');
  assert.ok($('#import-report [data-act="review-ics"]'), 'the import report offers the list');
});

test('Review ICs by part number opens the list at its first row', () => {
  const { $, click, document } = page;
  click($('#import-report [data-act="review-ics"]'));
  assert.equal($('#ic-review').open, true);
  assert.equal(document.activeElement, $('#ic-families select'));
});

test('choosing a family sets it on every line of the part number, as the user\'s own', async () => {
  const { $, fire, settle } = page;
  const select = $('select', rowFor('SN74LVC1G14DBVR'));
  select.value = 'bicmos-digital';
  fire(select, 'change');
  await settle(300);
  assert.equal(page.document.activeElement, $('select', rowFor('SN74LVC1G14DBVR')), 'the focus stays on the row');
  for (const ref of ['U1', 'U2']) {
    const line = lineOf(ref);
    assert.equal(line.params.family, 'bicmos-digital', ref);
    assert.equal(line.inferred.family, undefined, `${ref}: no longer a guess`);
  }
  const row = rows().find((x) => x.pn === 'SN74LVC1G14DBVR');
  assert.deepEqual([row.family, row.state, row.why], ['bicmos-digital', '', 'Your choice.']);
  assert.equal($('#ic-review-summary').textContent, 'ICs by part number: 4; family 1 missing, 2 guessed; R_JA missing on 4');
  assert.equal(page.$('[data-key="family"]', openCard('U1')).value, 'bicmos-digital', 'the card shows it');
});

test('Confirm keeps a guess with its reason; Confirm all does the rest', async () => {
  const { $, click, settle } = page;
  click($('[data-act="ic-confirm"]', rowFor('TPS62902RPJR')));
  await settle(300);
  const u3 = lineOf('U3');
  assert.equal(u3.params.family, 'bicmos-highv');
  assert.equal(u3.inferred.family, undefined);
  assert.match(u3.confirmed.family, /^assumed for a power IC/);
  assert.match(rows().find((x) => x.pn === 'TPS62902RPJR').why, /^Confirmed: assumed for a power IC/);
  click($('[data-act="ic-confirm-all"]'));
  await settle(300);
  assert.match(lineOf('U5').confirmed.family, /^from “W25Q128JVSIQ/);
  assert.equal($('[data-act="ic-confirm-all"]').hidden, true, 'nothing left to confirm');
  assert.equal(lineOf('U5').inferred.count, '128 Mbit, from the part number “W25Q128”', 'only the family is confirmed here');
  assert.equal($('#ic-review-summary').textContent, 'ICs by part number: 4; family 1 missing; R_JA missing on 4');
});

test('a family chosen on a card shows in the list; lines that differ say so', async () => {
  const { $, fire, settle } = page;
  const select = page.$('[data-key="family"]', openCard('U2'));
  select.value = 'mos-digital';
  fire(select, 'change');
  await settle(300);
  const row = rows().find((x) => x.pn === 'SN74LVC1G14DBVR');
  assert.deepEqual([row.family, row.why], ['', 'The lines differ; a choice here sets them all.']);
  assert.equal($('option:checked', rowFor('SN74LVC1G14DBVR')).textContent, '(differs between lines)');
});

test('R_JA typed once fills every line of the part number, when the box is left, not while typing', async () => {
  const { $, fire, settle } = page;
  const box = $('input', rowFor('ZZ9000'));
  box.value = '12';
  fire(box, 'input');
  await settle(300);
  assert.equal(lineOf('U4').params.rja, null, 'nothing is applied while typing');
  assert.ok(box.isConnected, 'the box is not redrawn while typing');
  const sn74 = $('input', rowFor('SN74LVC1G14DBVR'));
  sn74.focus();
  sn74.value = '206.5';
  fire(sn74, 'input');
  fire(sn74, 'change');
  await settle(300);
  assert.deepEqual(['U1', 'U2'].map((ref) => lineOf(ref).params.rja), [206.5, 206.5]);
  const row = rows().find((x) => x.pn === 'SN74LVC1G14DBVR');
  assert.deepEqual([row.rja, row.rjaState], ['206.5', '']);
  assert.equal(page.document.activeElement, $('input', rowFor('SN74LVC1G14DBVR')), 'the focus stays in the box');
  assert.equal($('#ic-review-summary').textContent, 'ICs by part number: 4; family 1 missing; R_JA missing on 3');
  assert.equal(page.$('[data-key="rja"]', openCard('U1')).value, '206.5', 'the card shows it');
  // A different value on one card: the row says the lines differ.
  const card = page.$('[data-key="rja"]', openCard('U2'));
  card.value = '180';
  fire(card, 'input');
  await settle(300);
  const differs = $('input', rowFor('SN74LVC1G14DBVR'));
  assert.deepEqual([differs.value, differs.placeholder], ['', 'differs']);
});
