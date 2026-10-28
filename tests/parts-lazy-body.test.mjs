// A closed card carries only its head; its fields are built when it is opened.
// options, the advanced overrides, the trace) and hides it. On a 500-line board that is 84,000 elements and
// 33,000 <option>s under #parts, which every keystroke's style and layout pass has to walk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, fixture } from './_page.mjs';

const page = await openPage();
const { $, $$, click, toggleOf, cardById, importNetlist } = page;
await importNetlist('tree-board.net', fixture('tree-board.net'));

test('closed cards hold no form controls in their body', () => {
  const closed = $$('.part').filter((c) => toggleOf(c).getAttribute('aria-expanded') === 'false');
  assert.ok(closed.length >= 10);
  for (const c of closed) assert.equal($$('.part-body select, .part-body input, .part-body details', c).length, 0, `closed ${$('[data-key="ref"]', c).value} still holds its fields`);
  assert.ok($('#parts').getElementsByTagName('option').length < 100, `${$('#parts').getElementsByTagName('option').length} <option>s under a list of closed cards`);
});

test('the head of a closed card still shows its flags and rate', () => {
  for (const c of $$('.part.needs-input')) {
    assert.match($('[data-out="flags"]', c).textContent, /\d+ missing/);
    assert.equal($('[data-out="fit"]', c).textContent, 'Needs input');
  }
  const done = $$('.part:not(.needs-input)')[0];
  assert.match($('[data-out="fit"]', done).textContent, /FIT/);
});

test('opening builds the fields with their Missing and Guessed states; closing drops them', () => {
  const c = $$('.part.needs-input.has-guesses')[0];
  const id = c.dataset.part;
  click(toggleOf(c));
  let now = cardById(id);
  assert.ok($$('.field.missing input, .field.missing select', now).length > 0);
  assert.ok($$('.field.inferred', now).length > 0);
  assert.ok($('[data-act="confirm-guesses"]', now));
  click(toggleOf(now));
  now = cardById(id);
  assert.equal($$('.part-body select, .part-body input', now).length, 0);
});
