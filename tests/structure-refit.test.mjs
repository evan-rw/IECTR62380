// Frame the whole board in the diagram after a new board is loaded.
// Before the fix, the view keeps the zoom and offset that fitted the previous board (the
// 8-line example, at 160 %), so after importing a netlist the diagram shows a
// corner of the new board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, railsNetlist, settle } from './_page-diagram.mjs';

test('a new board is framed whole; edits to it keep the user\'s zoom', async () => {
  const p = await openPage({ width: 640, height: 480 });
  assert.ok(p.view(), 'the example board is drawn and fitted');

  await p.importNetlist('rails.net', railsNetlist(30));
  await settle(30);
  const board = p.boardRect();
  const onScreen = p.toScreen(board);
  assert.ok(board.h > 1000, `the imported board is large (${board.w} x ${board.h} layout units)`);
  assert.ok(p.inPane(onScreen, 2), `whole board inside the 640x480 pane after import; it spans x ${onScreen.x.toFixed(0)}..${(onScreen.x + onScreen.w).toFixed(0)}, y ${onScreen.y.toFixed(0)}..${(onScreen.y + onScreen.h).toFixed(0)} at k=${p.view().k.toFixed(3)}`);

  // Guard: an edit to the same board is not a new board, so the view stays put.
  p.$('[data-st="zin"]').click();
  p.$('[data-st="zin"]').click();
  const zoomed = p.view();
  const proposal = p.$$('#st-tree li[role="treeitem"]').find((li) => li.querySelector(':scope > .st-row .st-badge.proposed'));
  proposal.querySelector(':scope > .st-row .st-nm').click();
  p.$('#st-tree').dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'u', bubbles: true }));
  await settle(30);
  assert.match(p.$('#st-status').textContent, /Ungrouped 1 block/);
  assert.deepEqual(p.view(), zoomed, 'ungrouping a block keeps the zoom and position');
});
