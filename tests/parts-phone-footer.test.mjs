// On a phone, Split, Copy and Remove sit in the open card's foot, away from Edit (the
// stylesheet hides the head's copies below 760 px). The foot's buttons do what the head's do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, fixture } from './_page.mjs';

const page = await openPage();
const { $, $$, click, open, refOf, importNetlist } = page;
await importNetlist('tree-board.net', fixture('tree-board.net'));

test('an open card has Split, Copy and Remove in its foot; a closed card has no foot', () => {
  const closed = $$('.part').find((c) => $('.part-body', c).hidden);
  assert.equal($('.part-foot', closed), null, 'a closed card is only its head');
  const card = open($$('.part').find((c) => /–/.test(refOf(c))));
  assert.deepEqual($$('.part-foot button', card).map((b) => b.textContent), ['Split line', 'Copy line', 'Remove line']);
  // The head's copies are marked for the phone stylesheet to hide.
  assert.deepEqual($$('.part-head .part-more', card).map((b) => b.dataset.act), ['split', 'dup', 'del']);
});

test('Remove line in the foot removes the line and offers Undo', () => {
  const card = open($$('.part').find((c) => /^R/.test(refOf(c))));
  const ref = refOf(card);
  click($('.part-foot [data-act="del"]', card));
  assert.ok(!$$('.part').some((c) => refOf(c) === ref), 'removed');
  assert.match($('#parts-undo').textContent, new RegExp(ref));
  click($('#parts-undo [data-act="undo-del"]'));
  assert.ok($$('.part').some((c) => refOf(c) === ref), 'back again');
});

test('the phone stylesheet hides the head copies and shows the foot', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../assets/style.css', import.meta.url), 'utf8');
  const phone = css.slice(css.indexOf('@media (max-width: 760px) {\n  body'));
  assert.match(css, /\n\.part-foot \{ display: none; \}/, 'no foot on a desktop');
  assert.match(phone, /\.part-head \.part-more \{ display: none; \}/);
  assert.match(phone, /\.part-foot \{ display: flex;/);
});
