// Found while measuring: after a netlist import the saved structure has no block
// ids, so buildStructure gives every block a new time-based id on each rebuild
// (newBlockId) until the first structural edit is committed. update() rebuilds on
// every keystroke anywhere on the page, so a block selected in the diagram is
// deselected by the next keystroke (the inspector falls back to "Board"), and
// every rebuild redraws the whole diagram because its ids changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, railsNetlist, settle } from './_page-diagram.mjs';

test('a block selected after an import stays selected while typing elsewhere', async () => {
  const p = await openPage({ width: 640, height: 480 });
  await p.importNetlist('rails.net', railsNetlist(30));
  await settle(30);
  const ids = () => p.$$('#st-vp .frame').map((f) => f.dataset.id);
  const before = ids();
  const hb = p.$$('#st-vp .hband')[2];
  const id = hb.dataset.id;
  p.ptr(hb, 'pointerdown', 5, 5);
  p.ptr(p.window, 'pointerup', 5, 5);
  assert.equal(p.$('#st-inspector h3').textContent, 'Block');

  const title = p.$('#title');
  title.value = 'Rails';
  p.fire(title, 'input');
  assert.deepEqual(ids(), before, 'block ids are the same after an unrelated keystroke');
  assert.equal(p.$('#st-inspector h3').textContent, 'Block', 'the inspector still shows the block');
  assert.ok(p.$$('#st-vp .frame').find((f) => f.dataset.id === id)?.classList.contains('sel'), 'the block is still drawn selected');
});
