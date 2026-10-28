// A keystroke in one part repaints that part's card, not every card on the board.
// keystroke (assets/app.js update(), the board.items.forEach loop), so the cost grows with the board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, fixture } from './_page.mjs';

const page = await openPage();
const { $, $$, typeInto, open, importNetlist, mutationsDuring, refOf } = page;
await importNetlist('tree-board.net', fixture('tree-board.net'));

test('typing in one part mutates only that part\'s card in the parts list', () => {
  const card = open($$('.part.needs-input').find((c) => $('[data-act="toggle"]', c)));
  const field = $('.field.missing input[type="number"]', card);
  assert.ok(field, 'a Missing number field to type into');
  for (const v of ['0', '0.', '0.1']) {
    const { cards } = mutationsDuring(() => typeInto(field, v), $('#parts'));
    assert.deepEqual([...cards], [card.dataset.part], `keystroke "${v}" touched ${cards.size} cards: ${[...cards].map((id) => refOf($(`[data-part="${id}"]`))).join(', ')}`);
  }
});

test('a mission-profile change still repaints every card (the saving must not skip real changes)', () => {
  const fits = () => $$('.part').map((c) => $('[data-out="fit"]', c).textContent);
  const before = fits();
  const tac = $('#phases [data-key="tac"]');
  typeInto(tac, Number(tac.value) + 30);
  const after = fits();
  const complete = $$('.part').map((c, i) => [c, i]).filter(([c]) => !c.classList.contains('needs-input'));
  assert.ok(complete.length >= 2, 'some complete lines to compare');
  for (const [c, i] of complete) assert.notEqual(after[i], before[i], `${refOf(c)} should show a new FIT after a 30 °C rise`);
});
