// A page opened with "Remember this board on this computer" unticked starts unticked and does not
// read a board left in storage (one written by a tab that had not yet heard of the choice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './_page.mjs';

// A board the page would load if the choice were ticked.
const left = { title: 'Left behind', years: 10, parts: [], profile: { phases: [{ name: 'On', tac: 25, tau: 1, n: 0, dT: 0 }] } };
const { $ } = await openPage({ board: left, before: (w) => w.localStorage.setItem('iec62380.remember', 'no') });

test('opens unticked, with the note, and without the stored board', () => {
  assert.equal($('#remember').checked, false);
  assert.equal($('#remember-note').hidden, false);
  assert.notEqual($('#title').value, 'Left behind');
});
