// Guessed values look the same (amber) in all three places, but
// only part cards ("Confirm guesses") and capacitor-life lines (✓) can be
// confirmed. Rows from "Fill from chip parts" keep their amber cells until each
// one is retyped. The ✓ itself is named only by its title, so its accessible
// name is the glyph "✓".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, KICAD } from './_page-checks.mjs';

test('guessed solder-joint values can be confirmed like capacitor-life ones', async () => {
  const { $, $$, document, click, pickNetlist } = await openPage();
  await pickNetlist('demo.net', KICAD);

  // The capacitor-life ✓ has a real name.
  const lifeConfirm = $$('#life-lines [data-act="life-confirm"]').find((b) => !b.hidden);
  assert.match(lifeConfirm.getAttribute('aria-label') ?? '', /^Confirm the guessed values of C5/);

  click($('[data-act="smt-chips"]'));
  const row = () => $('#smt-devices tr[data-smt="0"]');
  const guessed = () => $$('td.inferred', row()).map((td) => td.dataset.cell);
  assert.ok(guessed().length > 0, 'chip rows start with guessed cells');
  const d = $('[data-key="d"]', row()).value;
  const confirmBtn = $('[data-act="smt-confirm"]', row());
  assert.ok(confirmBtn && !confirmBtn.hidden, 'a row with guesses has a confirm button');
  assert.match(confirmBtn.getAttribute('aria-label') ?? '', /^Confirm the guessed values of C1, C2/);
  confirmBtn.focus();
  click(confirmBtn);
  assert.deepEqual(guessed(), [], 'confirmed cells are no longer amber');
  assert.equal($('[data-key="d"]', row()).value, d, 'the values stay');
  assert.ok(document.activeElement.closest('#smt-devices tr[data-smt="0"]'), 'focus stays on the row');
});
