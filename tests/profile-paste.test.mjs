// Paste a block of phases from a spreadsheet. An automotive profile
// usually arrives as a table (an OEM spec, TI SLOA294A Table 6-1, an Excel
// sheet). Before the change a paste dropped the whole block, tabs and all, into one field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './_page-profile.mjs';

// A paste event as a browser sends it, with the clipboard's text.
function paste(window, el, text) {
  const e = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => (/^text(\/plain)?$/.test(t) ? text : '') } });
  el.focus();
  el.dispatchEvent(e);
  return e;
}

// Copied from Excel: tab-separated cells, CRLF rows, a trailing line break.
const SIX = [
  ['Cold soak', '-40', '0', '30', '20'],
  ['Night starts', '-10', '0', '670', '55'],
  ['Day starts', '15', '0', '1340', '45'],
  ['Idle', '40', '0.02', '0', '0'],
  ['City', '60', '0.03', '0', '0'],
  ['Highway', '85', '0.01', '0', '0'],
];
const clip = (rows) => `${rows.map((r) => r.join('\t')).join('\r\n')}\r\n`;

test('profile: pasting phases from a spreadsheet', async (t) => {
  const { window, $, document, choose, cell, rows, table } = await openPage();

  await t.test('a block of six phases fills the table', () => {
    choose($('#preset'), 'military-radio');
    const e = paste(window, cell(0, 'name'), clip(SIX));
    assert.ok(e.defaultPrevented, 'the block is not also pasted into the one field');
    assert.equal(rows().length, 6, 'phases are added for the extra rows');
    assert.deepEqual(table().map((r) => r.slice(0, 5)), SIX);
    assert.equal($('#preset').value, '', 'the profile becomes custom');
    assert.equal(document.activeElement, cell(0, 'name'));
    assert.match($('#tau-summary').textContent, /0\.06/, 'τ_on is recomputed (0.02 + 0.03 + 0.01)');
  });

  await t.test('a block pasted into a later column fills from that column', () => {
    choose($('#preset'), 'military-radio');
    paste(window, cell(1, 'tac'), '-25\t0.2\n-30\t0.1');
    assert.equal(cell(1, 'name').value, 'Dormant', 'the name column is left alone');
    assert.deepEqual([cell(1, 'tac').value, cell(1, 'tau').value], ['-25', '0.2']);
    assert.deepEqual([cell(2, 'tac').value, cell(2, 'tau').value], ['-30', '0.1']);
  });

  await t.test('a single value pastes normally (guard)', () => {
    const e = paste(window, cell(0, 'tac'), '42');
    assert.ok(!e.defaultPrevented, 'the browser handles a plain value');
  });
});
