// The card buttons keep keyboard focus in the list. Before the fix, Split, Copy and ✕ call
// renderParts() and Confirm guesses calls rerenderPart() without a focus target, so the focused button
// is destroyed and focus falls to <body> (checked in Chrome as well): the next Tab starts from the top
// of the page, above the Board panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, fixture } from './_page.mjs';

const page = await openPage();
const { $, $$, click, toggleOf, cardById, cardFor, refOf, importNetlist, document } = page;
await importNetlist('tree-board.net', fixture('tree-board.net'));
const press = (btn) => { btn.focus(); click(btn); };
const where = () => {
  const el = document.activeElement;
  return el === document.body ? '<body>' : `${el.dataset.act ?? el.dataset.key ?? el.tagName} in ${el.closest('.part') ? refOf(el.closest('.part')) : 'no card'}`;
};

test('Copy puts focus on the copy\'s reference, ready to rename it', () => {
  press($('[data-act="dup"]', cardFor('R5')));
  assert.equal(document.activeElement?.dataset.key, 'ref', `focus is on ${where()}`);
  assert.equal(document.activeElement.value, 'R5 copy');
});

test('Split puts focus on the first of the new lines', () => {
  press($('[data-act="split"]', cardFor('R2–R4')));
  const card = document.activeElement.closest('.part');
  assert.ok(card, `focus is on ${where()}`);
  assert.equal(refOf(card), 'R2');
});

test('✕ moves focus to the next line (the previous one for the last line)', () => {
  const cards = $$('.part');
  const i = cards.findIndex((c) => refOf(c) === 'R5 copy');
  const next = refOf(cards[i + 1]);
  press($('[data-act="del"]', cards[i]));
  assert.equal(document.activeElement.closest('.part') && refOf(document.activeElement.closest('.part')), next, `focus is on ${where()}`);
  const last = $$('.part').at(-1);
  const prev = refOf($$('.part').at(-2));
  press($('[data-act="del"]', last));
  assert.equal(document.activeElement.closest('.part') && refOf(document.activeElement.closest('.part')), prev, `focus is on ${where()}`);
});

test('Confirm guesses keeps focus in the same card', () => {
  const card = $$('.part.has-guesses')[0];
  const id = card.dataset.part;
  if (toggleOf(card).textContent.trim() === 'Edit') click(toggleOf(card));
  press($(`[data-act="confirm-guesses"][data-id="${id}"]`));
  assert.ok(cardById(id).contains(document.activeElement), `focus is on ${where()}`);
});
