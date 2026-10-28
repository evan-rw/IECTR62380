// Working through an import from the keyboard. Before the fix the path from the last Missing
// field of one line to typing in the next line's first Missing field is 15 to 18 key presses on the
// vme-wren import (Tab through the rest of the card, the next card's reference and quantity, Enter on
// Edit, Tab through the part type to the field), and the finished card stays open. Enter in a part's
// number field should go to the next Missing field, opening the next line that needs input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, fixture } from './_page.mjs';

const page = await openPage();
const { $, $$, typeInto, key, open, refOf, cardById, isOpen, importNetlist, document } = page;
await importNetlist('tree-board.net', fixture('tree-board.net'));

test('Enter goes to the next Missing field in the card, then into the next line that needs input', () => {
  const cards = $$('.part');
  const ai = cards.findIndex((c) => refOf(c) === 'D1');
  const a = open(cards[ai]);
  const aid = a.dataset.part;
  const bid = $$('.part').slice(ai + 1).find((c) => c.classList.contains('needs-input')).dataset.part;
  const missing = $$('.field.missing input[type="number"]', a).map((i) => i.dataset.key);
  assert.deepEqual(missing, ['power', 'rja']);

  const power = $(`[data-part="${aid}"] [data-key="power"]`);
  power.focus();
  typeInto(power, 0.01);
  key(power, 'Enter');
  assert.equal(document.activeElement?.dataset.key, 'rja', 'Enter moves to the next Missing field of the same line');
  assert.equal(document.activeElement.closest('.part')?.dataset.part, aid);

  typeInto(document.activeElement, 300);
  key(document.activeElement, 'Enter');
  const b = cardById(bid);
  assert.ok(isOpen(b), `the next line needing input (${refOf(b)}) is opened`);
  assert.ok(b.contains(document.activeElement), `focus is in ${refOf(b)}`);
  assert.ok(document.activeElement.closest('.field.missing'), 'on its first Missing field');
  assert.ok(!cardById(aid).classList.contains('needs-input'), 'D1 is complete');
});

test('Enter in the last line that needs input leaves focus where it is rather than losing it', () => {
  const last = open($$('.part.needs-input').at(-1));
  const field = $('.field.missing input[type="number"]', last);
  field.focus();
  key(field, 'Enter');
  assert.notEqual(document.activeElement, document.body);
});
