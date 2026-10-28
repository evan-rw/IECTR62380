// T_ac must be typeable as a negative number on a phone.
// inputmode="decimal" brings up iOS's decimal pad, which has digits and a
// decimal point but no minus key, so -40 °C cannot be typed on an iPhone.
// type="number" with no inputmode gives the numbers-and-punctuation keyboard
// on iOS and the numeric pad with a minus key on Android.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './_page-profile.mjs';

// Keypads with no minus key: iOS decimalPad (decimal), numberPad (numeric), phonePad (tel).
const NO_MINUS = ['decimal', 'numeric', 'tel'];

test('profile: negative temperatures on a phone keyboard', async (t) => {
  const { $, $$, choose, typeInto, cell } = await openPage();

  await t.test('every t_ac field brings up a keyboard with a minus key', () => {
    choose($('#preset'), 'auto-motor');
    const tac = $$('#phases [data-key="tac"]');
    assert.equal(tac.length, 6);
    for (const el of tac) {
      const mode = (el.getAttribute('inputmode') ?? '').toLowerCase();
      assert.ok(!NO_MINUS.includes(mode), `${el.getAttribute('aria-label')}: inputmode="${mode}" has no minus key on iOS`);
      if (el.type === 'text') assert.ok(!el.pattern || new RegExp(`^(?:${el.pattern})$`).test('-40'), 'a text field must accept -40');
    }
  });

  await t.test('fields that are never negative keep a numeric keypad (guard)', () => {
    for (const key of ['tau', 'n', 'dT']) {
      assert.ok(['decimal', 'numeric'].includes($(`#phases [data-key="${key}"]`).getAttribute('inputmode')), `${key} keeps its numeric keypad`);
    }
  });

  await t.test('a negative t_ac is taken as typed (guard)', () => {
    choose($('#preset'), 'military-radio');
    typeInto(cell(0, 'tac'), '-40');
    assert.equal(cell(0, 'tac').value, '-40');
    assert.equal($('#profile-problems').textContent, '');
  });
});
