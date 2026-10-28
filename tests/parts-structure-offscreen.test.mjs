// A part keystroke redraws the reliability block diagram even though the Structure panel
// is far below the Parts list. In Chrome that redraw (renderDiagram in assets/structure-ui.js, called by
// refreshStructure from update()) is 18.8 ms of a 36 ms keystroke on vme-wren. The evaluation the totals
// need is 1.5 ms; the tree and diagram can wait until the panel is on screen.
// jsdom has no IntersectionObserver; this test supplies one it controls, so "off screen" is deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, fixture } from './_page.mjs';

const observers = [];
const page = await openPage({
  before(window) {
    window.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); }
      observe(el) { this.targets.push(el); }
      unobserve() {}
      disconnect() {}
    };
    globalThis.IntersectionObserver = window.IntersectionObserver;
  },
});
const { $, $$, typeInto, open, importNetlist, mutationsDuring } = page;
await importNetlist('tree-board.net', fixture('tree-board.net'));
const report = (visible) => { for (const o of observers) o.cb(o.targets.map((target) => ({ target, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 })), o); };

test('a part keystroke does not redraw the structure tree or diagram while they are off screen', () => {
  assert.ok(observers.some((o) => o.targets.some((t) => t.closest?.('#structure') || t.id === 'structure' || t.querySelector?.('#st-rbd'))), 'the structure panel is watched for being on screen');
  report(false);
  const card = open($$('.part.needs-input')[0]);
  const field = $('.field.missing input[type="number"]', card);
  const { regions } = mutationsDuring(() => typeInto(field, 0.1));
  assert.ok(!regions.has('st-vp') && !regions.has('st-tree') && !regions.has('st-t-board'), `redrawn off screen: ${[...regions].filter((r) => r.startsWith('st-')).join(', ')}`);
  // The board figures still follow at once: they use the evaluation, not the drawing.
  assert.match($('#summary .value').textContent, /FIT/);
});

test('coming back on screen brings the tree and diagram up to date', () => {
  const card = open($$('.part')[0]);
  const qty = $('[data-key="qty"]', card);
  typeInto(qty, Number(qty.value) + 5);
  const before = $('#st-tree').textContent;
  const { regions } = mutationsDuring(() => report(true));
  assert.ok(regions.has('st-tree') || regions.has('st-vp'), 'redrawn when it comes on screen');
  assert.notEqual($('#st-tree').textContent, before, 'with the new quantity');
});
