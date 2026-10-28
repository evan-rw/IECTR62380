// Entering ten devices at a desk. Before the fix Enter did nothing in
// these tables; from a row's last field the way to a new row is Tab onto ✕
// (Enter there deletes the row, with no undo), Tab onto "Add device", Enter.
// Enter in a table field should move down a row, and from the last row add one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './_page-checks.mjs';

test('Enter moves down the solder-joint and hole tables and adds a row at the end', async () => {
  const { window, $, $$, document, click } = await openPage();
  const enter = (el) => { el.focus(); el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); };

  click($('[data-act="smt-add"]'));
  click($('[data-act="smt-add"]'));
  enter($('#smt-devices tr[data-smt="0"] [data-key="d"]'));
  assert.equal(document.activeElement, $('#smt-devices tr[data-smt="1"] [data-key="d"]'), 'Enter goes to the same column, next row');
  enter($('#smt-devices tr[data-smt="1"] [data-key="rise"]'));
  assert.equal($$('#smt-devices tr[data-smt]').length, 3, 'Enter on the last row adds a device');
  assert.equal(document.activeElement, $('#smt-devices tr[data-smt="2"] [data-key="label"]'), 'and starts it at its name');

  click($('[data-act="pcb-add"]'));
  enter($('#pcb-holes tr[data-hole="0"] [data-key="plating"]'));
  assert.equal($$('#pcb-holes tr[data-hole]').length, 2, 'the hole table behaves the same');
  assert.equal(document.activeElement, $('#pcb-holes tr[data-hole="1"] [data-key="label"]'));
});
