// With "Only parts that need attention" ticked, the card being worked on stays on screen
// until it is closed. Before the fix the rule `.parts.attention-only .part:not(.needs-input):not(.has-guesses)
// { display: none }` (assets/style.css) hides the card on the keystroke that completes it: in Chrome focus
// falls to <body>, so typing "1.5" into the last Missing field stores 1 and the ".5" goes nowhere.
// Confirm guesses does the same to a complete card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, fixture } from './_page.mjs';

const page = await openPage({ css: true });
const { $, $$, fire, typeInto, click, toggleOf, cardById, shown, importNetlist, document } = page;
await importNetlist('tree-board.net', fixture('tree-board.net'));
const filterOn = (on) => { $('#attention-only').checked = on; fire($('#attention-only'), 'change'); };

test('the card being filled in stays on screen when its last Missing value is typed', () => {
  $('#add-model').value = 'resistor';
  click($('[data-act="add-part"]'));
  const id = $$('.part').at(-1).dataset.part;
  filterOn(true);
  const missing = $$(`[data-part="${id}"] .field.missing input`);
  assert.deepEqual(missing.map((i) => i.dataset.key), ['power', 'rated']);
  typeInto(missing[0], 0.1);
  const last = $(`[data-part="${id}"] [data-key="rated"]`);
  last.focus();
  typeInto(last, '1'); // the first key of "1.5": the line is now complete
  assert.ok(shown(cardById(id)), 'the card vanished under the cursor');
  assert.ok(shown(document.activeElement) && cardById(id).contains(document.activeElement), 'focus must stay in the field being typed in');
  typeInto(last, '1.5');
  assert.equal(last.value, '1.5');
  // Closing it is what takes it off the filtered list.
  click(toggleOf(cardById(id)));
  assert.ok(!shown(cardById(id)), 'a complete, closed card is filtered out');
  filterOn(false);
});

test('Confirm guesses does not make the card vanish while it is open', () => {
  const card = $$('.part.has-guesses:not(.needs-input)')[0];
  assert.ok(card, 'a complete line with guessed values');
  const id = card.dataset.part;
  filterOn(true);
  if (toggleOf(card).textContent.trim() === 'Edit') click(toggleOf(card));
  const btn = $(`[data-act="confirm-guesses"][data-id="${id}"]`);
  btn.focus();
  click(btn);
  assert.ok(shown(cardById(id)), 'the card vanished after Confirm guesses');
  click(toggleOf(cardById(id)));
  assert.ok(!shown(cardById(id)));
  filterOn(false);
});

test('the filter still hides complete lines that were never opened', () => {
  filterOn(true);
  const complete = $$('.part:not(.needs-input):not(.has-guesses)');
  assert.ok(complete.length > 0);
  for (const c of complete) if (toggleOf(c).getAttribute('aria-expanded') === 'false') assert.ok(!shown(c));
  for (const c of $$('.part.needs-input')) assert.ok(shown(c));
  filterOn(false);
});
