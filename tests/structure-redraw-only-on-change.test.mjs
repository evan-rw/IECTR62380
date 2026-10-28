// Rebuild the diagram's SVG only when what it draws changes; show
// selection and Find matches by toggling classes on the existing elements.
// Before the fix, a click on a box, a Find keystroke and a keystroke in any field of the
// page (here the board title) each replace every element under #st-vp
// (1169 elements on vme-wren, 5086 split into single parts). Chrome: a click on
// a box costs 32-44 ms per frame on vme-wren and 101 ms on the split board, a
// title keystroke 58-65 ms and 133 ms (report.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, railsNetlist, settle } from './_page-diagram.mjs';

test('selection, Find highlight and unrelated typing keep the diagram\'s elements', async () => {
  const p = await openPage({ width: 640, height: 480 });
  await p.importNetlist('rails.net', railsNetlist(30));
  await settle(30);
  const first = () => p.$('#st-vp').firstElementChild;

  // Click a leaf box: it is selected, and it is the same element as before.
  const box = p.$$('#st-vp .st-box.leaf')[3];
  const id = box.dataset.id;
  const keep = first();
  p.ptr(box, 'pointerdown', 10, 10);
  p.ptr(p.window, 'pointerup', 10, 10);
  assert.equal(p.$('#st-inspector h3').textContent.length > 0, true);
  const now = p.$$('#st-vp .st-box').find((g) => g.dataset.id === id);
  assert.ok(now.classList.contains('sel'), 'the clicked box is drawn selected');
  assert.equal(now, box, 'the clicked box is still the same element (not redrawn)');
  assert.equal(first(), keep, 'the rest of the diagram is not redrawn');

  // Find highlight: typing marks matches without redrawing.
  const find = p.$('#st-find');
  find.value = 'C5';
  p.fire(find, 'input');
  assert.ok(p.$$('#st-vp .st-box.match').length >= 1, 'the match is highlighted');
  assert.equal(first(), keep, 'a Find keystroke does not redraw the diagram');
  find.value = '';
  p.fire(find, 'input');

  // Typing in an unrelated field changes nothing the diagram shows.
  const title = p.$('#title');
  title.value = 'Rails board';
  p.fire(title, 'input');
  assert.equal(first(), keep, 'typing the board title does not redraw the diagram');

  // Guard: a structural change does redraw.
  p.ptr(p.$$('#st-vp .st-box.leaf')[3], 'pointerdown', 10, 10);
  p.ptr(p.window, 'pointerup', 10, 10);
  const before = p.$$('#st-vp .frame').length;
  p.$('#st-tree').dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 's', bubbles: true }));
  await settle(10);
  assert.match(p.$('#st-status').textContent, /Grouped 1 item as a series block/);
  assert.equal(p.$$('#st-vp .frame').length, before + 1, 'grouping draws the new block');
});
