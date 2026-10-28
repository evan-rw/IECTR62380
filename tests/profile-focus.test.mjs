// Add phase and Remove phase keep the keyboard user's place.
// Before the fix, Add phase leaves focus on the button (the new row is six Shift+Tabs
// back), and Remove phase destroys the focused button, dropping focus to <body>.
// The circuit-board and surface-mount tables on the same page already focus
// their new row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './_page-profile.mjs';

test('profile: focus when adding and removing phases', async (t) => {
  const { $, $$, document, choose, click, cell, rows } = await openPage();

  await t.test('Add phase puts the cursor in the new phase name, its text selected', () => {
    choose($('#preset'), 'military-radio');
    const add = $('[data-act="add-phase"]');
    add.focus();
    click(add);
    assert.equal(rows().length, 3);
    assert.equal(document.activeElement, cell(2, 'name'), 'focus moves to the new row');
    // Typing replaces the default "Phase 3" rather than appending to it.
    const el = cell(2, 'name');
    assert.equal(el.selectionStart, 0);
    assert.equal(el.selectionEnd, el.value.length);
  });

  await t.test('each remove button names its phase', () => {
    choose($('#preset'), 'auto-motor');
    $$('[data-act="del-phase"]').forEach((b, i) => {
      assert.match(b.getAttribute('aria-label') ?? b.textContent, new RegExp(`Remove.*phase ${i + 1}\\b`, 'i'));
    });
  });

  await t.test('Remove phase leaves focus with the phases', () => {
    choose($('#preset'), 'auto-motor');
    const del = $('[data-act="del-phase"][data-i="2"]');
    del.focus();
    click(del);
    assert.equal(rows().length, 5);
    const now = document.activeElement;
    assert.notEqual(now, document.body, 'focus is not dropped to the page');
    assert.ok($('#phases').contains(now) || now === $('[data-act="add-phase"]'), `focus stays with the phases (got ${now.outerHTML.slice(0, 80)})`);
    // Down to one phase, the last remove button is disabled: focus goes to Add phase.
    while (rows().length > 1) { const b = $('[data-act="del-phase"][data-i="0"]'); b.focus(); click(b); }
    assert.equal(document.activeElement, $('[data-act="add-phase"]'));
  });
});
