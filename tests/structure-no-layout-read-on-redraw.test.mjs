// Redraw the diagram without asking the browser for layout.
// renderDiagram() -> lay(ROOT) -> wrapWidth() reads #st-rbd.clientWidth on every
// redraw. renderTree() has just replaced the tree's HTML, so that read forces a
// synchronous layout of the whole page: in Chrome on the vme-wren board it is
// 11.7 of the 14.2 ms renderDiagram takes on a click, and 42 of 53 ms on a board
// split into single parts (report.md, measurements). The pane size only changes
// on resize, which the ResizeObserver already watches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, railsNetlist, settle } from './_page-diagram.mjs';

test('redrawing the diagram reads no layout from the browser', async () => {
  const p = await openPage({ width: 640, height: 480 });
  await p.importNetlist('rails.net', railsNetlist(30));
  await settle(30);
  const reads = () => p.layoutReads.clientWidth + p.layoutReads.clientHeight;

  // A Find keystroke redraws the tree and the diagram (match highlight).
  let r0 = reads();
  const find = p.$('#st-find');
  find.value = 'C1';
  p.fire(find, 'input');
  assert.equal(reads() - r0, 0, 'a Find keystroke reads #st-rbd.clientWidth/clientHeight');

  // A structural edit: ungroup a proposal (commit -> full page update -> redraw).
  const proposal = p.$$('#st-tree li[role="treeitem"]').find((li) => li.querySelector(':scope > .st-row .st-badge.proposed'));
  proposal.querySelector(':scope > .st-row .st-nm').click();
  r0 = reads();
  p.$('#st-tree').dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'u', bubbles: true }));
  await settle(10);
  assert.match(p.$('#st-status').textContent, /Ungrouped 1 block/);
  assert.equal(reads() - r0, 0, 'ungrouping reads #st-rbd.clientWidth/clientHeight');

  // A keystroke in an unrelated field (the board title) used to redraw too.
  r0 = reads();
  const title = p.$('#title');
  title.value = 'Rails';
  p.fire(title, 'input');
  assert.equal(reads() - r0, 0, 'typing the board title reads #st-rbd.clientWidth/clientHeight');
});
