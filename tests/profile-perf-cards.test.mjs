// A phase keystroke rewrites only what changed in the part cards.
// hidden "Show the calculation" body, and finds each card with a
// document-wide attribute selector. In Chrome that is 32 ms a keystroke on the
// 106-line Jetson board and 417 ms once its lines are split per reference.
//
// The DOM work is counted, not timed, so the test is deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './_page-profile.mjs';

const OPTS = { childList: true, subtree: true, characterData: true };

test('profile: part cards and phase keystrokes', async (t) => {
  const { window, $, $$, cell, typeInto, click } = await openPage();

  await t.test('a phase keystroke writes nothing inside closed cards, and only what changed elsewhere', () => {
    const cards = $$('#parts .part');
    const open = cards.filter((c) => !$('.part-body', c).hidden).length;
    assert.ok(cards.length >= 8 && cards.length - open >= 5, 'the example board, most cards closed');
    const mo = new window.MutationObserver(() => {});
    mo.observe($('#parts'), OPTS);
    typeInto(cell(0, 'tac'), 31);
    const records = mo.takeRecords();
    mo.disconnect();
    const inHidden = records.filter((r) => (r.target.nodeType === 1 ? r.target : r.target.parentElement).closest('.part-body[hidden]'));
    console.log(`DOM writes for one keystroke: ${records.length} total, ${inHidden.length} inside closed cards`);
    assert.equal(inHidden.length, 0, `nothing is written inside closed cards (got ${inHidden.length} writes)`);
    // One write per card for its FIT, and one more per open card for its calculation.
    assert.ok(records.length <= cards.length + open, `at most ${cards.length + open} writes for ${cards.length} cards, ${open} open (got ${records.length})`);
  });

  await t.test('a card opened after the profile changed shows the current calculation (guard)', () => {
    const card = $$('#parts .part').find((c) => $('[data-out="fit"]', c).textContent.includes('FIT'));
    const id = card.dataset.part;
    const trace = () => $(`[data-part="${id}"] [data-out="trace"]`).textContent;
    const toggle = () => click($(`[data-act="toggle"][data-id="${id}"]`));
    const setOpen = (on) => { if ($(`[data-part="${id}"] .part-body`).hidden === on) toggle(); };
    // Open all along: the calculation follows the profile.
    setOpen(true);
    typeInto(cell(0, 'tac'), 70);
    const live = trace();
    assert.ok(live.length > 0);
    // Closed while the profile changes, then opened: the same calculation.
    setOpen(false);
    typeInto(cell(0, 'tac'), 20);
    typeInto(cell(0, 'tac'), 70);
    setOpen(true);
    assert.equal(trace(), live);
  });
});
