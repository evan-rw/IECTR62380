// Layout rules, checked from the stylesheet in jsdom (no layout engine; the
// matching Chrome measurements are in chrome-checks.test.mjs).
// jsdom applies assets/style.css rules outside @media blocks to getComputedStyle.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './_page-board.mjs';

let page;
before(async () => { page = await openPage({ css: true }); });

const POSITIONED = new Set(['relative', 'absolute', 'fixed', 'sticky']);

test('no visually hidden header text can push the page sideways', () => {
  const { window, $$ } = page;
  // .visually-hidden is position: absolute. Unless something between it and its
  // .table-scroll is positioned, its containing block is the page, not the scroller,
  // so a header cell 1040 px into a scrolled table widens the whole page to 1050 px.
  const hidden = $$('.table-scroll .visually-hidden');
  assert.ok(hidden.length >= 4, 'the Remove/Actions header cells');
  const escaping = hidden.filter((el) => {
    if (!POSITIONED.has(window.getComputedStyle(el).position)) return false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (POSITIONED.has(window.getComputedStyle(p).position)) return false;
      if (p.classList.contains('table-scroll')) return true;
    }
    return true;
  });
  assert.deepEqual(escaping.map((el) => `${el.closest('table').className}: ${el.textContent}`), []);
});
