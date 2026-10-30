// "Remember this board on this computer": ticked, the board is saved in the browser as before;
// unticked, its saved copy is deleted and nothing more is written, the choice holds across tabs,
// and closing the tab asks first while there are changes that were not exported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './_page.mjs';

const BOARD = 'iec62380.board.v1';
const REMEMBER = 'iec62380.remember';
const { window, $, typeInto, click, fire, settle } = await openPage();
URL.createObjectURL = () => 'blob:x';
URL.revokeObjectURL = () => {};
const stored = () => window.localStorage.getItem(BOARD);
const leaving = () => {
  const e = new window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented ? 'asks' : 'closes';
};
const tick = (on) => { $('#remember').checked = on; fire($('#remember'), 'change'); };

test('ticked by default: edits are saved and closing the tab does not ask', async () => {
  assert.equal($('#remember').checked, true);
  assert.equal($('#remember-note').hidden, true);
  typeInto($('#title'), 'Remembered board');
  await settle(300);
  assert.equal(JSON.parse(stored()).title, 'Remembered board');
  assert.equal(leaving(), 'closes');
});

test('unticked: the saved copy goes at once, and later edits are not written', async () => {
  tick(false);
  assert.equal(stored(), null, 'the saved board is deleted');
  assert.equal(window.localStorage.getItem(REMEMBER), 'no');
  assert.equal($('#remember-note').hidden, false);
  assert.match($('#remember-note').textContent, /until this tab closes/);
  typeInto($('#title'), 'Private board');
  await settle(300);
  assert.equal(stored(), null);
  window.dispatchEvent(new window.Event('pagehide'));
  assert.equal(stored(), null, 'not even when leaving the page');
});

test('unticked: closing asks while there are changes not exported', async () => {
  assert.equal(leaving(), 'asks');
  click($('[data-act="export-json"]'));
  assert.equal(leaving(), 'closes', 'just exported');
  typeInto($('#title'), 'Private board, edited');
  assert.equal(leaving(), 'asks');
});

test('ticked again: the board is saved straight away', async () => {
  tick(true);
  assert.equal(JSON.parse(stored()).title, 'Private board, edited');
  assert.equal(window.localStorage.getItem(REMEMBER), null);
  assert.equal($('#remember-note').hidden, true);
  assert.equal(leaving(), 'closes');
});

test('unticked in another tab: this tab stops writing too', async () => {
  // The other tab writes the choice and deletes the board; the browser tells this tab with a storage event.
  window.localStorage.setItem(REMEMBER, 'no');
  window.localStorage.removeItem(BOARD);
  window.dispatchEvent(new window.StorageEvent('storage', { key: REMEMBER }));
  assert.equal($('#remember').checked, false);
  typeInto($('#title'), 'Edited in this tab');
  await settle(300);
  assert.equal(stored(), null);
});
