// In the three board-check panels a missing value is shown by
// colour only (a pink fill), while part cards and the capacitor-life default
// role print "Missing" beside the label and set aria-invalid. The circuit-board
// and solder-joint labels even carry an empty <span class="state-tag">.
// Each missing control in the three panels should say so in text and to
// assistive technology, the way part cards already do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, pcbNeedsInput, KICAD } from './_page-checks.mjs';

test('missing values in the board checks are marked in text, not colour alone', async () => {
  const page = await openPage();
  const { $, $$, click, pickNetlist } = page;

  // Reference behaviour that already exists: a part card field.
  await pickNetlist('demo.net', KICAD);
  // Closed cards are only their head: open the first line that needs input.
  click($('.part.needs-input [data-act="toggle"]'));
  const partMissing = $('.part .field.missing');
  assert.equal($('.state-tag', partMissing).textContent, 'Missing');
  assert.equal($('input, select', partMissing).getAttribute('aria-invalid'), 'true');

  // Circuit board settings.
  pcbNeedsInput(page);
  const kq = $('#pcb [data-field="kq"]');
  assert.ok(kq.classList.contains('missing'));
  assert.equal($('.state-tag', kq).textContent, 'Missing', 'K_Q label says Missing');
  assert.equal($('#pcb-kq').getAttribute('aria-invalid'), 'true');
  assert.notEqual($('#pcb-thickness').getAttribute('aria-invalid'), 'true', 'a filled field is not invalid');

  // Solder joints: the substrate setting and a device row's joint height.
  click($('[data-act="smt-chips"]'));
  const substrate = $('#smt-substrate').closest('.field');
  assert.ok(substrate.classList.contains('missing'));
  assert.equal($('.state-tag', substrate).textContent, 'Missing', 'substrate label says Missing');
  assert.equal($('#smt-substrate').getAttribute('aria-invalid'), 'true');
  const row = $$('#smt-devices tr[data-smt]')[0];
  assert.ok($('[data-cell="h"]', row).classList.contains('missing'));
  assert.equal($('[data-key="h"]', row).getAttribute('aria-invalid'), 'true', 'joint height cell is invalid');

  // Capacitor life: the wet line's rated life.
  const life = $('#life-lines tr[data-life]');
  assert.ok($('[data-cell="hours"]', life).classList.contains('missing'));
  assert.equal($('[data-key="hours"]', life).getAttribute('aria-invalid'), 'true', 'rated life cell is invalid');
});
