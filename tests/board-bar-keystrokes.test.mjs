// Typing in the Board bar.
// Before the fix, every keystroke in Board name or Mission length runs update(), which rebuilds
// the summary, the results table, every part card's outputs and the structure tree and
// diagram (174 ms per keystroke on a 522-line board in Chrome on a Ryzen 9 7950X).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './_page-board.mjs';

let page;
before(async () => { page = await openPage(); });

const OUTPUTS = ['#summary', '#results', '#parts', '#st-tree', '#st-vp', '#tau-summary'];

test('typing the board name changes no output, and the name is still saved', async () => {
  const { $, typeInto, mutations, settle } = page;
  const changes = mutations(OUTPUTS, () => {
    for (const name of ['M', 'Mo', 'Mot', 'Moto', 'Motor board']) typeInto($('#title'), name);
  });
  assert.deepEqual(changes, [], 'the board name is not part of any figure, so nothing should be rebuilt');
  await settle(300); // save() is debounced by 250 ms
  assert.equal(JSON.parse(localStorage.getItem('iec62380.board.v1')).title, 'Motor board');
});

test('a mission-length keystroke finds the part cards with one query, not one per line', () => {
  const { window, $, $$, typeInto } = page;
  const lines = $$('#parts .part').length;
  assert.ok(lines >= 8);
  const proto = window.Document.prototype;
  const original = proto.querySelector;
  let perLine = 0;
  proto.querySelector = function (sel) {
    if (/^\[data-part="/.test(sel)) perLine++;
    return original.call(this, sel);
  };
  try {
    typeInto($('#years'), 12);
  } finally {
    proto.querySelector = original;
  }
  // Each document-wide attribute query walks the whole page (88,848 elements on a
  // 522-line board), so one per line makes a keystroke quadratic in the board size.
  assert.ok(perLine <= 1, `${perLine} document-wide [data-part] queries for ${lines} lines`);
  assert.match($('#summary').textContent, /Survival over 12 years/);
});

test('re-entering the same mission length leaves the summary and the results alone', () => {
  const { $, typeInto, mutations } = page;
  typeInto($('#years'), 10);
  // #summary is aria-live="polite": rewriting it unchanged makes screen readers repeat it,
  // and rewriting #results drops any selection the user is copying from the table.
  const changes = mutations(['#summary', '#results'], () => typeInto($('#years'), 10));
  assert.deepEqual(changes, []);
  // A real change still updates both.
  const changed = mutations(['#summary', '#results'], () => typeInto($('#years'), 15));
  assert.ok(changed.length > 0);
  assert.match($('#summary').textContent, /Survival over 15 years/);
});
