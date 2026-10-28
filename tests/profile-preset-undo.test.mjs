// A hand-made profile survives a stray choice on the preset list.
// Before the fix, choosing a preset replaces every phase at once, with no question and no
// undo. On Windows, an arrow key or a typed letter on the focused (closed) list
// changes its value and fires "change" straight away.
//
// Either remedy passes: a confirm() that, when declined, keeps the phases, or an
// Undo control that brings them back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './_page-profile.mjs';

test('profile: a preset does not silently replace a hand-made profile', async (t) => {
  const page = await openPage({ confirmAnswer: false });
  const { $, $$, dialogs, choose, typeInto, cell, click, table, rows } = page;

  await t.test('switching between untouched presets asks nothing (guard)', () => {
    choose($('#preset'), 'auto-motor');
    choose($('#preset'), 'military-radio');
    assert.equal(rows().length, 2);
    assert.deepEqual(dialogs, [], 'no dialog when nothing hand-made is lost');
  });

  await t.test('a custom profile can be got back after a preset replaces it', () => {
    choose($('#preset'), 'auto-motor');
    typeInto(cell(0, 'name'), 'Cold soak');
    typeInto(cell(0, 'tac'), '-40');
    typeInto(cell(5, 'n'), '45');
    assert.equal($('#preset').value, '', 'the profile is now custom');
    const mine = table();

    choose($('#preset'), 'geo-permanent');
    if (JSON.stringify(table()) !== JSON.stringify(mine)) {
      // Not asked, or asked and replaced anyway: an undo must be on offer.
      const undo = $$('[aria-labelledby="profile-heading"] button')
        .find((b) => !b.closest('[hidden]') && /undo|restore/i.test(b.textContent + (b.getAttribute('aria-label') ?? '')));
      assert.ok(undo, 'replacing a custom profile offers an undo');
      click(undo);
    }
    assert.deepEqual(table(), mine, 'the six hand-made phases are back');
    assert.equal($('#preset').value, '', 'and the list shows Custom profile');
  });
});
