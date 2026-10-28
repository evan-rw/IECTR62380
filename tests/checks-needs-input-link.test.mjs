// The summary says "The circuit-board check needs input; the total
// leaves it out." but neither says which input nor links to it. On a 360 px phone
// the empty K_Q field is 2,972 px below that warning on the example board,
// 7,026 px on a 53-line board and 15,319 px (21 screens) on a 135-line board.
// Each board-check warning should name what is missing and link to the panel,
// and following the link should put focus in the first missing control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, pcbNeedsInput, KICAD } from './_page-checks.mjs';

test('"needs input" warnings name the missing input and take you to it', async () => {
  const page = await openPage();
  const { $, $$, document, click, choose, typeInto, pickNetlist } = page;
  const warnLink = (panel) => $(`#summary .warn a[href="#${panel}"], #summary .warn [data-goto="${panel}"]`);

  // Circuit board: one board setting (plating quality K_Q) is empty.
  pcbNeedsInput(page);
  assert.match($('#summary .warn').textContent, /circuit-board check needs input/);
  assert.match($('#summary .warn').textContent, /plating quality K_?Q/i, 'the warning names the missing setting');
  const pcbLink = warnLink('pcb');
  assert.ok(pcbLink, 'the circuit-board warning links to the Circuit board panel');
  click(pcbLink);
  assert.equal(document.activeElement, $('#pcb-kq'), 'focus lands in the empty K_Q field');

  // Surface mount: devices listed, substrate not chosen.
  await pickNetlist('demo.net', KICAD);
  click($('[data-act="smt-chips"]'));
  for (const tr of $$('#smt-devices tr[data-smt]')) typeInto($('[data-key="h"]', tr), 0.05);
  assert.match($('#summary .warn').textContent, /surface-mount check needs input/);
  assert.match($('#summary .warn').textContent, /board substrate/i);
  const smtLink = warnLink('smt');
  assert.ok(smtLink, 'the surface-mount warning links to its panel');
  click(smtLink);
  assert.equal(document.activeElement, $('#smt-substrate'));
  choose($('#smt-substrate'), 'fr4');

  // Capacitor life: the wet aluminium line C4 has no rated life yet.
  assert.match($('#summary .warn').textContent, /capacitor life checks? needs? input/);
  const lifeLink = warnLink('caplife');
  assert.ok(lifeLink, 'the capacitor-life warning links to its panel');
  click(lifeLink);
  const focused = document.activeElement;
  assert.ok(focused.closest('#caplife'), 'focus moves into the capacitor-life panel');
  assert.ok(focused.closest('.missing'), 'onto a control marked missing');
});
