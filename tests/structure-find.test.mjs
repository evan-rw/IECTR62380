// Find, Enter, then P must group exactly the parts found.
// The page's own tip says "type C1–C3 in Find and press Enter, then P". On the
// example board, C1–C3 are part of the line C1–C20 in the collapsed "Everything
// else". Before the fix, Enter reported "Selected 3 parts" but nothing is selected (the
// split leaf's id does not survive the commit's rebuild), the parts are not shown
// (their block stays collapsed), and focus stays in Find, so a real P keystroke
// would be typed into the box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './_page-tree.mjs';

test('Find + Enter selects exactly the parts found, and shows them', async () => {
  const P = await loadPage();
  const find = P.$('#st-find');
  find.focus();
  P.typeInto(find, 'C1–C3');
  P.key(find, 'Enter');
  assert.match(P.status(), /Selected 3 parts/);
  const sel = P.selectedRows();
  assert.deepEqual(sel.map((li) => P.nameOf(li).split(' ')[0]), ['C1–C3'], 'the one visible selected row is C1–C3');
  // Its ancestors are expanded so the selection can be seen.
  for (let p = sel[0].parentElement.closest('[role="treeitem"]'); p; p = p.parentElement.closest('[role="treeitem"]')) {
    assert.equal(p.getAttribute('aria-expanded'), 'true', `${P.nameOf(p)} is expanded`);
  }
  assert.deepEqual(P.errors, []);
});

test('after Find + Enter, focus is in the tree, so the next P groups the parts', async () => {
  const P = await loadPage();
  const find = P.$('#st-find');
  find.focus();
  P.typeInto(find, 'C1–C3');
  P.key(find, 'Enter');
  const focused = P.document.activeElement;
  assert.ok(P.$('#st-tree').contains(focused), `focus is on ${focused.id || focused.tagName}, not in the tree`);
  // The keystroke goes where the browser would send it: the focused element.
  P.key(focused, 'p');
  const made = P.blocks().find((b) => b.name === 'C1–C3 in parallel');
  assert.ok(made, `no "C1–C3 in parallel" block; status: ${P.status()}`);
  assert.equal(made.mode, 'kofn');
  assert.equal(P.currentStructure().ev.stats.get(made.id).pieces, 3);
  assert.match(P.status(), /Grouped 1 item as a redundant block/);
});

test('typing in Find shows how many parts match, even inside a collapsed block', async () => {
  const P = await loadPage();
  // C21 is a line of its own in the collapsed "Everything else".
  P.typeInto(P.$('#st-find'), 'C21');
  const shown = P.$$('#st-tree .st-row.match, #st-tree .st-row.has-match');
  assert.ok(shown.length >= 1, 'a visible row marks the match (the leaf revealed, or its collapsed block marked has-match)');
  assert.match(P.status(), /1 (?:part|line) match/i);
});
