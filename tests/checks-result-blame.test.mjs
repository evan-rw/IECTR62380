// When a board setting is missing, the circuit-board result says
// "1 hole size needs input (red)." and the hole row's λ cell says "Missing",
// although nothing in that row is red or empty; the real gap (K_Q) is listed
// last, below the table. The solder-joint panel does the same with a missing
// substrate ("1 device needs input (red)"). The result should point at the
// settings and only count rows whose own cells are incomplete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, pcbNeedsInput } from './_page-checks.mjs';

test('a missing board setting is not blamed on complete rows', async () => {
  const page = await openPage();
  const { $, click, typeInto, choose } = page;

  pcbNeedsInput(page);
  const hole = $('#pcb-holes tr[data-hole="0"]');
  assert.equal($('#pcb-holes .missing'), null, 'the hole row itself is complete');
  const pcbLead = $('#pcb-result p')?.textContent ?? '';
  assert.doesNotMatch(pcbLead, /hole sizes? needs? input/, 'no hole size is said to need input');
  assert.match(pcbLead, /plating quality K_?Q/i, 'the first sentence names the missing setting');
  assert.notEqual($('[data-out="fit"]', hole).textContent.trim(), 'Missing', 'the row does not claim its own value is missing');

  // Same pattern in the solder-joint panel: a complete device, no substrate.
  click($('[data-act="smt-add"]'));
  const dev = $('#smt-devices tr[data-smt="0"]');
  typeInto($('[data-key="label"]', dev), 'U3 (QFN-48)');
  choose($('[data-key="lead"]', dev), 'leadless');
  choose($('#smt-devices tr[data-smt="0"] [data-key="body"]'), 'plastic');
  for (const [k, v] of [['d', 3.5], ['h', 0.05], ['rise', 5]]) typeInto($(`#smt-devices tr[data-smt="0"] [data-key="${k}"]`), v);
  assert.equal($('#smt-devices .missing'), null, 'the device row itself is complete');
  const smtLead = $('#smt-result p')?.textContent ?? '';
  assert.doesNotMatch(smtLead, /devices? needs? input/, 'no device is said to need input');
  assert.match(smtLead, /board substrate/i, 'the first sentence names the missing setting');
});
