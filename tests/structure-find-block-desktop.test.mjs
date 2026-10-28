// Desktop: Find + Enter frames what it selected in the diagram.
// was, so on a large board at Fit the selected box is a 30 x 10 px rectangle
// with 3 px text somewhere in the pane. Find now frames
// its matches. The query names a whole part line ("C149, C150"): a query for part
// of a line lost its selection before the fix (selectRefs' "|sel" leaf id does not survive
// the rebuild; see report.md, outside this area).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, railsNetlist, settle } from './_page-diagram.mjs';

test('desktop: Find + Enter frames the selected parts', async () => {
  const p = await openPage({ width: 640, height: 480 });
  await p.importNetlist('rails.net', railsNetlist(30));
  p.$('[data-st="fit"]').click();
  await settle(30);
  const find = p.$('#st-find');
  find.value = 'C149, C150';
  p.fire(find, 'input');
  find.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle(30);
  assert.match(p.$('#st-status').textContent, /Selected 2 parts/);
  const sel = p.$$('#st-vp .st-box.sel');
  assert.equal(sel.length, 1, 'the found part is drawn selected');
  const s = p.toScreen(p.layoutRect(sel[0]));
  assert.ok(p.inPane(s, 2), `the found part is on screen: ${JSON.stringify(s)}`);
  assert.ok(s.w >= 100, `and large enough to read (${s.w.toFixed(0)} px wide, k=${p.view().k.toFixed(2)})`);
});
