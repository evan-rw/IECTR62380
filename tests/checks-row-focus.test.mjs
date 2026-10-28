// Removing a hole size, a solder-joint device or a capacitor-life
// line, or confirming a line's guesses, rebuilds the table and drops keyboard
// focus to <body>; the next Tab starts again at the top of the page. Focus
// should stay in the table: on the row that took the removed row's place,
// else on the panel's add control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, KICAD } from './_page-checks.mjs';

test('removing or confirming a row keeps keyboard focus in the table', async () => {
  const { $, $$, document, click, fire, pickNetlist } = await openPage();
  const press = (btn) => { btn.focus(); assert.equal(document.activeElement, btn); click(btn); };

  // Solder joints: remove the middle of three rows.
  for (let i = 0; i < 3; i++) click($('[data-act="smt-add"]'));
  press($$('#smt-devices [data-act="smt-del"]')[1]);
  assert.equal($$('#smt-devices tr[data-smt]').length, 2);
  assert.notEqual(document.activeElement, document.body, 'focus is not dropped to the page');
  assert.ok(document.activeElement.closest('#smt'), 'focus stays in the solder-joint panel');
  // Removing the last row lands on "Add device".
  press($$('#smt-devices [data-act="smt-del"]').at(-1));
  press($$('#smt-devices [data-act="smt-del"]').at(-1));
  assert.equal(document.activeElement, $('[data-act="smt-add"]'));

  // Circuit board: the same.
  for (let i = 0; i < 3; i++) click($('[data-act="pcb-add"]'));
  press($$('#pcb-holes [data-act="pcb-del"]')[1]);
  assert.ok(document.activeElement.closest('#pcb'), 'focus stays in the circuit-board panel');

  // Capacitor life: stop checking a line added by hand, then confirm a guessed line.
  await pickNetlist('demo.net', KICAD);
  const add = $('#life-add');
  add.value = [...add.options].find((o) => /C3/.test(o.textContent)).value;
  fire(add, 'change');
  press($('#life-lines [data-act="life-del"]'));
  assert.ok(document.activeElement.closest('#caplife'), 'focus stays in the capacitor-life panel');
  // C5's rated life was guessed from its description; confirming hides the ✓.
  const confirmBtn = $$('#life-lines [data-act="life-confirm"]').find((b) => !b.hidden);
  const line = confirmBtn.dataset.id;
  press(confirmBtn);
  assert.ok(document.activeElement.closest(`#life-lines [data-life="${line}"]`), 'focus stays on the confirmed line');
});
