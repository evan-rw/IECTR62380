// With Lasso on (or Shift held), a drag that starts on a box draws a
// lasso instead of moving the box. On a large board at Fit, boxes and headers
// cover 12-30 % of the diagram (report.md), so a lasso that starts on one picks
// it up instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, railsNetlist, settle } from './_page-diagram.mjs';

test('lasso: Lasso mode and Shift+drag start a lasso even on a box', async () => {
  const p = await openPage({ width: 640, height: 480 });
  await p.importNetlist('rails.net', railsNetlist(30));
  p.$('[data-st="fit"]').click();
  await settle(30);
  const framesBefore = p.$$('#st-vp .frame').length;
  const all = p.toScreen(p.boardRect());
  const corner0 = [all.x - 4, all.y - 4];
  const corner1 = [all.x + all.w + 4, all.y + all.h + 4];

  // Lasso mode on, drag starts on a leaf box and covers the board.
  p.$('[data-st="lasso"]').click();
  const box = p.$$('#st-vp .st-box.leaf')[0];
  p.ptr(box, 'pointerdown', ...corner0);
  p.ptr(p.svg, 'pointermove', (corner0[0] + corner1[0]) / 2, (corner0[1] + corner1[1]) / 2);
  assert.equal(p.$('#st-ghost').hidden, true, 'no move ghost in lasso mode');
  p.ptr(p.svg, 'pointermove', ...corner1);
  p.ptr(p.svg, 'pointerup', ...corner1);
  p.ptr(p.window, 'pointerup', ...corner1);
  assert.match(p.$('#st-status').textContent, /Lasso selected \d+ items/);
  assert.equal(p.$$('#st-vp .frame').length, framesBefore, 'nothing moved');
  p.$('[data-st="lasso"]').click();

  // Shift+drag from a box, Lasso off: also a lasso.
  p.ptr(p.$$('#st-vp .st-box.leaf')[1], 'pointerdown', ...corner0, { shiftKey: true });
  p.ptr(p.svg, 'pointermove', ...corner1, { shiftKey: true });
  assert.equal(p.$('#st-ghost').hidden, true, 'no move ghost on Shift+drag');
  p.ptr(p.svg, 'pointerup', ...corner1, { shiftKey: true });
  p.ptr(p.window, 'pointerup', ...corner1, { shiftKey: true });
  assert.match(p.$('#st-status').textContent, /Lasso selected \d+ items/);

  // Guard: a plain drag on a box still moves it.
  p.ptr(p.$$('#st-vp .st-box.leaf')[1], 'pointerdown', 100, 100);
  p.ptr(p.window, 'pointermove', 140, 140);
  assert.equal(p.$('#st-ghost').hidden, false, 'plain drag picks the box up');
  p.ptr(p.window, 'pointerup', 140, 140);
});
