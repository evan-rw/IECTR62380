// Edit and Close change no figure, so they should repaint their own card only.
// Before the fix, the 'toggle' case in the click handler falls through to save(); update(), which recomputes the
// board and rebuilds the summary, the results table, every card's outputs and the structure tree/diagram.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, fixture } from './_page.mjs';

const page = await openPage();
const { $, $$, click, toggleOf, cardById, importNetlist, mutationsDuring, document } = page;
await importNetlist('tree-board.net', fixture('tree-board.net'));

for (const which of ['Edit', 'Close']) {
  test(`${which} touches only its own card`, () => {
    const card = $$('.part.needs-input')[1];
    const id = card.dataset.part;
    if (which === 'Close' && toggleOf(card).textContent.trim() === 'Edit') click(toggleOf(card));
    const { cards, regions } = mutationsDuring(() => click(toggleOf(cardById(id))));
    assert.deepEqual([...regions], [], `${which} also rewrote: ${[...regions].join(', ')}`);
    assert.deepEqual([...cards], [id], `${which} touched other cards`);
    // The card still shows its state and outputs after the repaint.
    const now = cardById(id);
    assert.match($('[data-out="flags"]', now).textContent, /missing/);
    assert.equal($('[data-out="fit"]', now).textContent, 'Needs input');
    assert.equal(document.activeElement, toggleOf(now), 'focus stays on the button');
  });
}

test('an opened card shows its Missing and Guessed states at once', () => {
  const card = $$('.part.needs-input.has-guesses').find((c) => toggleOf(c).textContent.trim() === 'Edit');
  click(toggleOf(card));
  const now = cardById(card.dataset.part);
  assert.ok($$('.field.missing', now).length > 0);
  assert.ok($$('.field.inferred', now).length > 0);
  assert.ok($$('.field.missing .state-tag', now).every((t) => t.textContent === 'Missing'));
});
