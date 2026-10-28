// ✕ removes a line at once, with no confirmation and no undo; on a phone it is a 23 × 30 px
// button 2 px from Copy. Removing a line should offer Undo, which puts the line back where it was with
// everything typed into it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, fixture } from './_page.mjs';

const page = await openPage();
const { $, $$, click, typeInto, open, refOf, shown, importNetlist } = page;
await importNetlist('tree-board.net', fixture('tree-board.net'));
const boardTotal = () => $('#results tr:last-child td:nth-child(5)').textContent;

test('a removed line can be put back with Undo, values and place intact', async () => {
  // Fill in a line so it has values of the user's own.
  const card = open($$('.part.needs-input').find((c) => /^R/.test(refOf(c))));
  for (const input of $$('.field.missing input[type="number"]', card)) typeInto(input, 0.05);
  const ref = refOf(card);
  const index = $$('.part').indexOf(card);
  const totalBefore = boardTotal();
  const valuesBefore = $$('[data-bind="part"]', card).map((i) => [i.dataset.key, i.value]);

  click($('[data-act="del"]', card));
  assert.equal($$('.part').some((c) => refOf(c) === ref), false, 'the line is removed');
  const undo = $$('button').find((b) => /undo/i.test(b.textContent) && shown(b));
  assert.ok(undo, 'an Undo button is offered after removing a line');
  assert.match(undo.closest('[role="status"], [aria-live]')?.textContent ?? '', new RegExp(ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the notice names the removed line');

  click(undo);
  const back = $$('.part')[index];
  assert.equal(back && refOf(back), ref, 'the line returns to its place');
  const reopened = open(back);
  assert.deepEqual($$('[data-bind="part"]', reopened).map((i) => [i.dataset.key, i.value]), valuesBefore);
  assert.equal(boardTotal(), totalBefore);
  assert.ok(!$$('button').some((b) => /undo/i.test(b.textContent) && shown(b)), 'the Undo offer goes away once used');
});
