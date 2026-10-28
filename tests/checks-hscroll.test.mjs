// on a phone the whole page pans sideways (scrollWidth 1050-1081 px
// at a 360 px viewport). The cause is the visually hidden "Remove"/"Actions"
// column headers: they are position:absolute with no positioned ancestor, so
// they escape the .table-scroll box and stretch the page to the table's width.
// jsdom has no layout, so this checks the cause: each such label must have a
// positioned ancestor at or inside its scroller, which then clips it.
// The layout effect itself is measured in Chrome by chrome-checks.py (page-hscroll).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './_page-checks.mjs';

test('hidden column labels in the board-check tables stay inside their scrollers', async () => {
  const { window, $$ } = await openPage({ css: true });
  const positioned = (el) => ['relative', 'absolute', 'fixed', 'sticky'].includes(window.getComputedStyle(el).position);
  const escaping = [];
  for (const panel of ['#pcb', '#smt', '#caplife']) {
    for (const label of $$(`${panel} .table-scroll .visually-hidden`)) {
      assert.equal(window.getComputedStyle(label).position, 'absolute');
      const scroller = label.closest('.table-scroll');
      let el = label.parentElement;
      let clipped = false;
      for (; el && el !== scroller.parentElement; el = el.parentElement) if (positioned(el)) { clipped = true; break; }
      if (!clipped) escaping.push(`${panel}: "${label.textContent}"`);
    }
  }
  assert.deepEqual(escaping, [], 'these labels are laid out relative to the page, not the table scroller');
});
