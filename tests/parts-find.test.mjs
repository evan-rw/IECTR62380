// Finding a line. A grouped line's reference is cut off in its 96 px (desktop) or 64 px
// (phone) box: 44 of vme-wren's 135 references are cut at 1366 px and 63 at 360 px, so "which card holds
// IC49?" means opening cards. A Find box in the Parts panel filters the cards by designator, matching
// inside ranges (C7 finds "C1, C2, C6–C8"), or by the start of the imported value or part number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, fixture } from './_page.mjs';

const page = await openPage({ css: true });
const { $, $$, typeInto, click, toggleOf, refOf, shown, importNetlist } = page;
await importNetlist('tree-board.net', fixture('tree-board.net'));
const visible = () => $$('.part').filter(shown).map(refOf);
const find = () => $('section[aria-labelledby="parts-heading"] input[type="search"]');

test('the Parts panel has a labelled Find box', () => {
  assert.ok(find(), 'an <input type="search"> in the Parts panel');
  const f = find();
  assert.ok(f.labels?.length || f.getAttribute('aria-label'), 'it has a label');
});

test('a designator finds its line, inside a range too, and matches whole', () => {
  typeInto(find(), 'C7');
  assert.deepEqual(visible(), ['C1, C2, C6–C8, C10, C11']);
  typeInto(find(), 'r1');
  assert.deepEqual(visible(), ['R1'], 'R1 is not R11, and the search ignores case');
  typeInto(find(), 'R3 D1');
  assert.deepEqual(visible(), ['D1', 'R2–R4'], 'several designators at once, in board order');
});

test('the imported value or part number finds lines by its start', () => {
  typeInto(find(), '100n');
  assert.deepEqual(visible(), ['C1, C2, C6–C8, C10, C11']);
  typeInto(find(), 'smaj');
  assert.deepEqual(visible(), ['D1']);
});

test('the search survives a card being re-rendered, and clearing it shows every line', () => {
  typeInto(find(), 'D1');
  click(toggleOf($$('.part').find((c) => refOf(c) === 'D1')));
  assert.deepEqual(visible(), ['D1']);
  typeInto(find(), '');
  assert.equal(visible().length, 12);
});
