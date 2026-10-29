// Hover notes on buttons (assets/tooltip.js): every button has one, a mouse sees it after a short rest,
// and a touch screen after a press and hold, which then does not press the button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPage, root } from './_page.mjs';

const { window, document, $, $$, click, settle } = await openPage();
const { tipText } = await import(new URL('assets/tooltip.js', root).href);

// jsdom has no PointerEvent: a MouseEvent with the pointer's type does what the page listens for.
function pointer(el, type, pointerType, { x = 20, y = 20, related = null } = {}) {
  const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, relatedTarget: related });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  el.dispatchEvent(e);
}
const tip = () => $('#tip');

test('every button in the page\'s source has a note of its own', () => {
  const keys = new Set();
  for (const file of ['index.html', 'assets/app.js', 'assets/structure-ui.js']) {
    const text = readFileSync(new URL(file, root), 'utf8');
    for (const [, attrs] of text.matchAll(/<button\b([^>]*)>/g)) {
      for (const [, kind, value] of attrs.matchAll(/data-(act|st|tab)="([^"$]+)"/g)) keys.add(`${kind}=${value}`);
    }
  }
  assert.ok(keys.size >= 45, `found ${keys.size} buttons`);
  // A bare button with only that attribute: the note must come from the table, not a title or label.
  const missing = [...keys].filter((key) => {
    const [kind, value] = key.split('=');
    const b = document.createElement('button');
    b.setAttribute(`data-${kind}`, value);
    return !tipText(b);
  });
  assert.deepEqual(missing, []);
});

test('a mouse resting on a button shows its note after half a second; leaving hides it', async () => {
  const btn = $('[data-act="new"]');
  pointer(btn, 'pointerover', 'mouse', { x: 50, y: 40 });
  await settle(200);
  assert.ok(!tip() || tip().hidden, 'not yet');
  await settle(450);
  assert.equal(tip().hidden, false);
  assert.equal(tip().textContent, 'Start an empty board: no parts, the default mission profile and empty checks.');
  assert.equal(btn.getAttribute('aria-describedby'), 'tip');
  pointer(btn, 'pointerout', 'mouse', { related: document.body });
  assert.equal(tip().hidden, true);
  assert.equal(btn.hasAttribute('aria-describedby'), false);
});

test('a button\'s own title becomes its note, so the browser\'s plain note does not show as well', async () => {
  const btn = $('[data-st="lasso"]');
  assert.ok(btn.hasAttribute('title'));
  pointer(btn, 'pointerover', 'mouse');
  await settle(550);
  assert.equal(tip().textContent, 'Drag on the background to select a box of items (or hold Shift).');
  assert.equal(btn.hasAttribute('title'), false);
  pointer(btn, 'pointerout', 'mouse', { related: document.body });
});

test('on a touch screen, press and hold shows the note and does not press the button; a tap still does', async () => {
  const add = $('[data-act="add-part"]');
  const lines = () => $$('.part').length;
  const before = lines();
  pointer(add, 'pointerdown', 'touch');
  await settle(600);
  assert.equal(tip().hidden, false);
  assert.equal(tip().textContent, 'Add a line of the part type chosen beside this button.');
  pointer(add, 'pointerup', 'touch');
  click(add);
  assert.equal(lines(), before, 'the release after a hold adds nothing');
  // A quick tap: the note goes, and the button works.
  pointer(add, 'pointerdown', 'touch');
  assert.equal(tip().hidden, true);
  pointer(add, 'pointerup', 'touch');
  click(add);
  assert.equal(lines(), before + 1);
  // A finger that moves is scrolling: no note.
  pointer(add, 'pointerdown', 'touch', { x: 20, y: 20 });
  pointer(document.body, 'pointermove', 'touch', { x: 20, y: 60 });
  await settle(600);
  assert.equal(tip().hidden, true);
  pointer(add, 'pointerup', 'touch');
});

test('a part line\'s Edit button says whether it opens or closes the line', () => {
  const toggle = $('[data-act="toggle"]');
  const open = toggle.getAttribute('aria-expanded') === 'true';
  assert.equal(tipText(toggle), open ? 'Close this line.' : 'Open this line to see and change its inputs.');
});

test('the keyboard shows a note when Tab reaches a button, not when the page moves focus after a click', () => {
  const btn = $('[data-act="export-json"]');
  pointer(document.body, 'pointerdown', 'mouse');
  btn.focus();
  assert.ok(!tip() || tip().hidden, 'focus moved by the page after a click');
  btn.blur();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  btn.focus();
  assert.equal(tip().hidden, false);
  assert.equal(tip().textContent, 'Save the whole board as a JSON file, to open again later.');
  btn.blur();
  assert.equal(tip().hidden, true);
});
