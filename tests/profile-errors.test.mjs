// A profile problem marks the cells it is about, names the phase,
// and offers a way to the cell. Before the fix the messages sat under the table with no
// cell marked, "Cycle counts and amplitudes cannot be negative." names no
// phase, and on a phone the n and ΔT columns are scrolled out of view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './_page-profile.mjs';

const invalid = (el) => el.getAttribute('aria-invalid') === 'true';

test('profile: problems point at their cells', async (t) => {
  const { $, document, choose, typeInto, cell, click } = await openPage();

  await t.test('a negative cycle count marks its cell and names its phase', () => {
    choose($('#preset'), 'military-radio');
    typeInto(cell(0, 'n'), '-5');
    assert.ok(invalid(cell(0, 'n')), 'the n cell of phase 1 is marked invalid');
    assert.ok(!invalid(cell(1, 'n')), 'phase 2 is not');
    assert.ok(!invalid(cell(0, 'dT')), 'nor the cell next to it');
    assert.match($('#profile-problems').textContent, /Phase 1\b/, 'the message names the phase');
    // The cell is described by the message, so a screen reader reads it on focus.
    const described = (cell(0, 'n').getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    assert.ok(described.length, 'aria-describedby is set');
    assert.match(described.map((id) => document.getElementById(id)?.textContent ?? '').join(' '), /Phase 1/);
  });

  await t.test('the message leads to the cell (on a phone the n column is off screen)', () => {
    const go = $('#profile-problems button, #profile-problems a');
    assert.ok(go, 'the problem has a control that leads to the cell');
    click(go);
    assert.equal(document.activeElement, cell(0, 'n'));
  });

  await t.test('fixing the value clears the mark (guard)', () => {
    typeInto(cell(0, 'n'), '36');
    assert.ok(!invalid(cell(0, 'n')));
    assert.equal(cell(0, 'n').getAttribute('aria-describedby'), null);
  });

  await t.test('working ratios above 1 mark the τ cells; a blank t_ac marks its cell', () => {
    typeInto(cell(0, 'tau'), '0.7');
    typeInto(cell(1, 'tau'), '0.6');
    assert.match($('#profile-problems').textContent, /more than 1/);
    assert.ok(invalid(cell(0, 'tau')) && invalid(cell(1, 'tau')), 'both working τ cells are marked');
    typeInto(cell(1, 'tau'), '0');
    assert.ok(!invalid(cell(0, 'tau')) && !invalid(cell(1, 'tau')));
    typeInto(cell(0, 'tac'), '');
    assert.ok(invalid(cell(0, 'tac')), 'a working phase with no t_ac is marked');
  });

  await t.test('problems are announced as they appear', () => {
    const list = $('#profile-problems');
    const live = list.closest('[aria-live]')?.getAttribute('aria-live');
    const role = list.getAttribute('role');
    assert.ok(['polite', 'assertive'].includes(live) || ['status', 'alert'].includes(role), 'the problem list is a live region');
  });
});
