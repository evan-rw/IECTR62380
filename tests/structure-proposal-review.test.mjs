// Reviewing many proposals in a row, by mouse, keyboard or touch: Dismiss moves on,
// Next proposal (button or N) steps through them, the selected proposal's row carries
// its own buttons, and each row names its rail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, THREE_RAILS } from './_page-tree.mjs';

async function threeProposals() {
  const P = await loadPage();
  await P.importKicad(THREE_RAILS);
  assert.deepEqual(P.proposedRows().map(P.nameOf), ['C1, C2 in parallel', 'C3, C4 in parallel', 'C5, C6 in parallel']);
  return P;
}

test('Dismiss moves on to the next proposal and keeps focus in the editor', async () => {
  const P = await threeProposals();
  P.click(P.$('.st-nm', P.proposedRows()[0]));
  const dismiss = P.$('[data-st="dismiss"]', P.inspector());
  dismiss.focus();
  P.click(dismiss);
  assert.equal(P.proposedRows().length, 2);
  assert.deepEqual(P.selectedRows().map(P.nameOf), ['C3, C4 in parallel'], 'the next proposal is selected');
  assert.ok(P.$('[data-st="accept"]', P.inspector()), 'its accept button is ready');
  const a = P.document.activeElement;
  assert.notEqual(a, P.document.body, 'focus is not dropped to the page');
  assert.ok(P.$('#structure').contains(a), `focus is in the structure editor, not on ${a.tagName}`);
  assert.match(P.status(), /Dismissed/, 'the status names the action that was taken');
});

test('after accepting, "Next proposal" (button or N) selects the next one', async () => {
  const P = await threeProposals();
  P.click(P.$('.st-nm', P.proposedRows()[0]));
  P.click(P.$('[data-st="accept"]', P.inspector()));
  P.typeInto(P.$('#st-need'), 1);
  const next = P.$('[data-st="next-proposal"]', P.inspector());
  assert.ok(next, 'the side panel offers the next proposal while any remain');
  assert.match(P.inspector().textContent, /2 (?:more )?proposals? (?:left|to review)/);
  P.click(next);
  assert.deepEqual(P.selectedRows().map(P.nameOf), ['C3, C4 in parallel']);
  // From the tree, N does the same.
  const row = P.$('#st-tree li[tabindex="0"]');
  row.focus();
  P.key(row, 'n');
  assert.deepEqual(P.selectedRows().map(P.nameOf), ['C5, C6 in parallel']);
});

test('a selected proposal carries its own Mark redundant and Dismiss buttons in the tree row', async () => {
  const P = await threeProposals();
  const li = P.proposedRows()[1];
  P.click(P.$('.st-nm', li));
  const sel = P.selectedRows()[0];
  // Buttons that belong to the selected item itself, not to an item inside it.
  const own = (s) => [...sel.querySelectorAll(s)].find((b) => b.closest('[role="treeitem"]') === sel);
  const accept = own('[data-st="accept"]');
  const dismiss = own('[data-st="dismiss"]');
  assert.ok(accept && dismiss, 'the selected proposal row shows Mark redundant and Dismiss');
  P.click(accept);
  const block = P.blocks().find((b) => b.name === 'C3, C4 in parallel');
  assert.equal(block.mode, 'kofn');
  assert.equal(block.proposed, null);
  assert.equal(P.document.activeElement?.id, 'st-need', 'k is asked for next');
  // Only the selected proposal has them: other rows stay one line high.
  assert.equal(P.$$('#st-tree [data-st="accept"]').length, 0, 'no accept buttons once nothing proposed is selected');
});

// a reviewer recognises a decoupling bank by its rail, not by a
// truncated list of designators.
test('each proposal row names its rail, and Find matches a net name', async () => {
  const P = await threeProposals();
  const text = (li) => P.ownRow(li).textContent;
  assert.deepEqual(P.proposedRows().map((li) => ['+3V3', '+5V', '+1V8'].filter((n) => text(li).includes(n))), [['+3V3'], ['+5V'], ['+1V8']]);
  const find = P.$('#st-find');
  P.typeInto(find, '+5V');
  P.key(find, 'Enter');
  assert.deepEqual(P.selectedRows().map(P.nameOf).map((s) => s.replace(/\s*[·(].*$/, '')), ['C3, C4 in parallel']);
});
