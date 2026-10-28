// Find a block from the diagram without precise dragging.
// On a phone the diagram tab has no Find (it lives in the tree pane, which the
// diagram tab hides). At Fit a block header is 1.6-3.5 px tall and a part box
// 19 x 6 px (vme-wren at 360 px); reading needs about 100 %, where the board is
// 4 x 6 screens. Proposed: a "Go to…" list in the diagram's head that frames the
// chosen block, and switching to the Diagram tab frames the tree's selection
// when it is off screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, railsNetlist, settle } from './_page-diagram.mjs';

test('phone: Go to… frames a block; switching tabs reveals the tree selection', async () => {
  const p = await openPage({ width: 320, height: 420, narrow: true });
  await p.importNetlist('rails.net', railsNetlist(30));
  p.$('[role="tab"][data-tab="diagram"]').click();
  await settle(30);
  p.$('[data-st="fit"]').click();
  await settle(30);
  // Framed: on screen, and either at 80 % zoom or filling the pane in one direction.
  const framed = (r) => p.inPane(r, 2) && (p.view().k >= 0.8 || r.w >= 0.8 * (p.width - 40) || r.h >= 0.8 * (p.height - 40));

  // A block chooser in the diagram's own head.
  const go = p.$('.st-diagram-pane select');
  assert.ok(go, 'the diagram pane has a block chooser');
  const blockIds = p.$$('#st-vp .frame').map((f) => f.dataset.id);
  const offered = [...go.options].map((o) => o.value).filter(Boolean);
  for (const id of blockIds) assert.ok(offered.includes(id), `block ${id} is offered`);
  const target = blockIds[blockIds.length - 3];
  go.value = target;
  p.fire(go, 'change');
  await settle(30);
  const frame = p.$$('#st-vp .frame').find((f) => f.dataset.id === target);
  const s = p.toScreen(p.layoutRect(frame));
  assert.ok(framed(s), `the chosen block is framed: ${JSON.stringify(s)} at k=${p.view().k.toFixed(2)}`);
  assert.equal(p.$(`#st-t-${CSS.escape(target)}`)?.getAttribute('aria-selected'), 'true', 'and selected');

  // Back to Fit, pick a block in the tree, switch to the diagram: it is framed.
  p.$('[data-st="fit"]').click();
  await settle(30);
  p.$('[role="tab"][data-tab="tree"]').click();
  const other = blockIds[1];
  p.$(`#st-t-${CSS.escape(other)} .st-nm`).click();
  p.$('[role="tab"][data-tab="diagram"]').click();
  await settle(40);
  const f2 = p.$$('#st-vp .frame').find((f) => f.dataset.id === other);
  const s2 = p.toScreen(p.layoutRect(f2));
  assert.ok(framed(s2), `the tree's selection is framed when the diagram is shown: ${JSON.stringify(s2)} at k=${p.view().k.toFixed(2)}`);
});
