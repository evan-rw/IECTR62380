// On touch, a finger on a box pans and pinches like a finger on the background;
// moving a box needs a press and hold first. A mouse still picks a box up at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, railsNetlist, settle } from './_page-diagram.mjs';

const touch = (id) => ({ pointerType: 'touch', pointerId: id, isPrimary: id === 11 });

test('touch: pan and pinch work when a finger starts on a box; hold to move', async () => {
  const p = await openPage({ width: 320, height: 420, narrow: true });
  await p.importNetlist('rails.net', railsNetlist(30));
  p.$('[role="tab"][data-tab="diagram"]').click();
  await settle(30);
  p.$('[data-st="fit"]').click();
  await settle(30);
  const boxes = () => p.$$('#st-vp .st-box.leaf');
  const framesBefore = p.$$('#st-vp .frame').length;

  // One finger on a box, swiped 60 px right: the view pans; nothing is moved.
  let v0 = p.view();
  p.ptr(boxes()[2], 'pointerdown', 150, 200, touch(11));
  p.ptr(p.svg, 'pointermove', 180, 200, touch(11));
  p.ptr(p.svg, 'pointermove', 210, 200, touch(11));
  assert.equal(p.$('#st-ghost').hidden, true, 'no move ghost while panning');
  p.ptr(p.svg, 'pointerup', 210, 200, touch(11));
  let v1 = p.view();
  assert.ok(Math.abs(v1.x - v0.x - 60) < 1 && Math.abs(v1.y - v0.y) < 1 && v1.k === v0.k, `panned by 60 px: x ${v0.x.toFixed(1)} -> ${v1.x.toFixed(1)}`);
  assert.doesNotMatch(p.$('#st-status').textContent, /Move|drop/i);
  assert.equal(p.$$('#st-vp .frame').length, framesBefore, 'structure unchanged');

  // Pinch: first finger on a box, second on the background, spread from 100 to 200 px apart.
  v0 = p.view();
  p.ptr(boxes()[2], 'pointerdown', 150, 200, touch(11));
  p.ptr(p.svg, 'pointerdown', 250, 200, touch(12));
  p.ptr(p.svg, 'pointermove', 100, 200, touch(11));
  p.ptr(p.svg, 'pointermove', 300, 200, touch(12));
  assert.equal(p.$('#st-ghost').hidden, true, 'no move ghost during a pinch');
  p.ptr(p.svg, 'pointerup', 100, 200, touch(11));
  p.ptr(p.svg, 'pointerup', 300, 200, touch(12));
  v1 = p.view();
  assert.ok(Math.abs(v1.k / v0.k - 2) < 0.05, `pinch doubles the zoom: k ${v0.k.toFixed(3)} -> ${v1.k.toFixed(3)}`);
  assert.equal(p.$$('#st-vp .frame').length, framesBefore, 'structure unchanged');

  // Guard: a tap on a box selects it.
  const tapped = boxes()[4];
  const tappedId = tapped.dataset.id;
  p.ptr(tapped, 'pointerdown', 120, 120, touch(11));
  p.ptr(p.svg, 'pointerup', 120, 120, touch(11));
  p.ptr(p.window, 'pointerup', 120, 120, touch(11));
  assert.ok(p.$$('#st-vp .st-box').find((g) => g.dataset.id === tappedId)?.classList.contains('sel'), 'tap selects the box');

  // Guard: press and hold, then drag: the box is picked up.
  p.ptr(boxes()[5], 'pointerdown', 120, 160, touch(11));
  await settle(700);
  p.ptr(p.svg, 'pointermove', 160, 200, touch(11));
  assert.equal(p.$('#st-ghost').hidden, false, 'after a long press the box moves');
  p.ptr(p.svg, 'pointerup', 160, 200, touch(11));
  p.ptr(p.window, 'pointerup', 160, 200, touch(11));
  assert.equal(p.$('#st-ghost').hidden, true);

  // Guard: with a mouse, dragging a box still picks it up at once.
  p.ptr(boxes()[1], 'pointerdown', 50, 50);
  p.ptr(p.window, 'pointermove', 90, 90);
  assert.equal(p.$('#st-ghost').hidden, false, 'mouse drag picks the box up');
  p.ptr(p.window, 'pointerup', 90, 90);
});
