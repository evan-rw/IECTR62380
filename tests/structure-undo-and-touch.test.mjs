// Undo in the structure editor (Ctrl+Z or the button), and selecting several rows by
// touch with a latched "Select several" button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, THREE_RAILS } from './_page-tree.mjs';

test('Ctrl+Z, or the Undo button, brings back a dismissed proposal', async () => {
  const P = await loadPage();
  await P.importKicad(THREE_RAILS);
  const before = P.proposedRows().map(P.nameOf);
  P.click(P.$('.st-nm', P.proposedRows()[0]));
  P.click(P.$('[data-st="dismiss"]', P.inspector()));
  assert.equal(P.proposedRows().length, 2);
  // Keyboard: Ctrl+Z inside the structure editor, outside a text field.
  const row = P.$('#st-tree li[tabindex="0"]');
  row.focus();
  P.key(row, 'z', { ctrlKey: true });
  assert.deepEqual(P.proposedRows().map(P.nameOf), before, 'the proposal is back, in its place');
  const back = P.blocks().find((b) => b.name === 'C1, C2 in parallel');
  assert.deepEqual(back.nets, ['+3V3', 'GND'], 'with its nets');
  assert.ok(back.proposed, 'and still proposed');
  // Touch: the same through a button, here after a second dismiss.
  P.click(P.$('.st-nm', P.proposedRows()[0]));
  P.click(P.$('[data-st="dismiss"]', P.inspector()));
  const undo = P.$('#structure [data-st="undo"]');
  assert.ok(undo && !undo.disabled, 'an enabled Undo button');
  P.click(undo);
  assert.deepEqual(P.proposedRows().map(P.nameOf), before);
});

test('a "Select several" toggle lets taps add to the selection', async () => {
  const P = await loadPage();
  // The example board: open Everything else to get at single lines.
  P.click(P.$('#st-t-rest .st-twisty'));
  const leaf = (ref) => P.rows().find((li) => P.ownRow(li).querySelector('.st-nm b')?.textContent === ref);
  const toggle = P.$('#structure [data-st="multi"]');
  assert.ok(toggle, 'a latched Select several button next to Find');
  P.click(toggle);
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  P.click(P.$('.st-nm', leaf('U1')));
  P.click(P.$('.st-nm', leaf('U2')));
  assert.deepEqual(P.selectedRows().map((li) => P.ownRow(li).querySelector('.st-nm b').textContent).sort(), ['U1', 'U2']);
  // A second tap on a selected row takes it out again, as Ctrl+click does.
  P.click(P.$('.st-nm', leaf('U2')));
  assert.deepEqual(P.selectedRows().map((li) => P.ownRow(li).querySelector('.st-nm b').textContent), ['U1']);
  P.click(P.$('.st-nm', leaf('U2')));
  P.click(P.$('.st-toolbar [data-st="group-series"]'));
  assert.ok(P.blocks().find((b) => b.name === 'U1, U2 in series'), P.status());
});
