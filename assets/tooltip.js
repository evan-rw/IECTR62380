// Hover notes for buttons, after the Windows 2000 ones: a pale yellow note with black text and a
// hairline border, here with a folded corner. A mouse shows one after a short rest on a button, the
// keyboard when a button gets focus by Tab, and a touch screen after a press and hold, which then does
// not press the button.

const HOVER_MS = 500; // Windows' initial tooltip delay
const HOLD_MS = 500;
const SLOP_PX = 10; // a finger that moves this far is scrolling, not holding
const TOUCH_SHOWN_MS = 6000;
const TARGETS = 'button, a.caption-btn, [data-tip]';

const opened = (el) => el.getAttribute('aria-expanded') === 'true';

// Keyed by the button's data-act (page actions), data-st (structure panel) or data-tab. A function
// gets the button, for a note that follows its state.
const TIPS = {
  'act:new': 'Start an empty board: no parts, the default mission profile and empty checks.',
  'act:example': 'Replace the board with the example board.',
  'act:import-netlist': 'Read a KiCad or Protel netlist into part lines, with proposed parallel blocks.',
  'act:import-bom': 'Read a BOM (CSV): new lines on an empty board, or part numbers added to the lines already here.',
  'act:import': 'Open a board saved with Export JSON.',
  'act:export-json': 'Save the whole board as a JSON file, to open again later.',
  'act:export-csv': 'Save the part lines and their rates as a CSV table.',
  'act:export-xlsx': 'An Excel workbook: summary, parts with their rates, the calculation, inputs, mission profile and structure.',
  'act:add-phase': 'Add a phase to the mission profile.',
  'act:add-part': 'Add a line of the part type chosen beside this button.',
  'act:pcb-add': 'Add a hole size (drill and plating) to check for barrel cracking.',
  'act:smt-add': 'Add a surface-mount device to check its solder joints.',
  'act:smt-chips': 'Add a row for each chip size and kind among the part lines; rows already here keep their values.',
  'act:toggle': (el) => (opened(el) ? 'Close this line.' : 'Open this line to see and change its inputs.'),
  'act:split': 'One line per reference, so each can have its own values.',
  'act:dup': 'Add a copy of this line.',
  'act:del': 'Remove this line. Undo brings it back.',
  'act:confirm-guesses': 'Accept the amber guessed values as they are; their reasons stay on record.',
  'act:ic-confirm': 'Accept the guessed family on every line of this part number; the reason stays on record.',
  'act:ic-confirm-all': 'Accept every guessed IC family in this list; the reasons stay on record.',
  'act:review-ics': 'Open the list of IC part numbers to check their families and enter R_JA once for each.',
  'act:del-phase': 'Remove this phase.',
  'act:undo-profile': 'Put back the mission profile you had before choosing the preset.',
  'act:pcb-del': 'Remove this hole size.',
  'act:smt-confirm': 'Accept the guessed values in this row.',
  'act:smt-del': 'Remove this device from the check.',
  'act:life-confirm': 'Accept the guessed values in this row.',
  'act:life-del': 'Stop checking this capacitor\'s life.',
  'act:show-cell': 'Go to the input that needs a value.',
  'act:goto-part': (el) => `Open ${el.textContent.trim()} in the parts list.`,
  'act:attention': 'Hide the lines that are complete, leaving those with missing or guessed values.',
  'act:dismiss-report': 'Close this report.',
  'act:undo-del': 'Put back the line just removed.',
  'act:cancel-import': 'Stop reading this file; the board stays as it was.',
  'act:import-board': 'Read the drill sizes and layer stackup from a board file: Altium ASCII .PcbDoc, KiCad .kicad_pcb, IPC-2581, P-CAD ASCII .pcb or Excellon.',
  'act:dismiss-pcb-report': 'Close this report.',
  'act:pcb-confirm': 'Accept the guessed values in this row.',
  'act:pcb-confirm-settings': 'Accept the board thickness and laminate read from the board file.',
  'st:group-kofn': 'Group the selected items as a redundant (k-of-n) block. (P)',
  'st:group-series': 'Group the selected items in series. (S)',
  'st:ungroup': 'Take the selected block apart, keeping its items. (U)',
  'st:split': 'Split the selected line into one item per part. (L)',
  'st:undo': 'Undo the last change to the structure. (Ctrl+Z)',
  'st:select-matches': 'Select the parts, or the blocks on a net, that Find names.',
  'st:multi': 'While pressed, each tap adds to the selection or takes away from it (as Ctrl+click).',
  'st:zout': 'Zoom out.',
  'st:zin': 'Zoom in.',
  'st:fit': 'Fit the whole diagram in view. (0)',
  'st:lasso': 'Drag on the background to select a box of items (or hold Shift).',
  'st:accept': 'Make this proposed block redundant (k-of-n).',
  'st:dismiss': 'Turn this proposal down: its parts stay in series.',
  'st:open-part': 'Open this part\'s line in the parts list.',
  'st:zoom': 'Show this item in the diagram.',
  'st:need-': 'One fewer member needed for the block to work.',
  'st:need+': 'One more member needed for the block to work.',
  'st:confirm': 'Accept the guessed values for this block.',
  'st:next-proposal': 'Go to the next proposed block. (N)',
  'tab:tree': 'Show the structure as a tree.',
  'tab:diagram': 'Show the structure as a block diagram.',
};

// The note for a button: from the table, else its own title (moved off the button, so the browser's
// plain note does not show as well), data-tip or aria-label.
export function tipText(el) {
  if (el.hasAttribute('title')) {
    el.dataset.tipTitle = el.getAttribute('title');
    el.removeAttribute('title');
  }
  const keys = [el.dataset.act && `act:${el.dataset.act}`, el.dataset.st && `st:${el.dataset.st}`, el.dataset.tab && `tab:${el.dataset.tab}`];
  for (const key of keys) {
    const t = key && TIPS[key];
    if (t) return typeof t === 'function' ? t(el) : t;
  }
  return el.dataset.tip || el.dataset.tipTitle || el.getAttribute('aria-label') || '';
}

let note = null;
let timer = null;
let shownFor = null;
let hold = null;
let swallow = null;

function noteEl() {
  if (!note) {
    note = document.createElement('div');
    note.id = 'tip';
    note.setAttribute('role', 'tooltip');
    note.hidden = true;
    document.body.append(note);
  }
  return note;
}

// at: the pointer ({ x, y }) for a mouse, or { x, y, above } for a finger; none for the keyboard.
function show(el, at) {
  const text = tipText(el);
  if (!text || !el.isConnected) return;
  const n = noteEl();
  n.textContent = text;
  n.hidden = false;
  shownFor = el;
  el.setAttribute('aria-describedby', 'tip');
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const w = n.offsetWidth;
  const h = n.offsetHeight;
  // Under the pointer, as Windows puts it; above a finger, which would hide it; under the button otherwise.
  let y = at && !at.above ? at.y + 20 : r.bottom + 6;
  if (at?.above || y + h > vh - 4) y = r.top - h - 6;
  const x = at ? at.x : r.left;
  n.style.left = `${Math.max(4, Math.min(x, vw - w - 4))}px`;
  n.style.top = `${Math.max(4, y)}px`;
}

function hide() {
  clearTimeout(timer);
  timer = null;
  if (shownFor) shownFor.removeAttribute('aria-describedby');
  shownFor = null;
  if (note) note.hidden = true;
}

function cancelHold() {
  if (hold) clearTimeout(hold.timer);
  hold = null;
}

const target = (e) => (typeof e.target?.closest === 'function' ? e.target.closest(TARGETS) : null);
const isNode = (x) => typeof x?.nodeType === 'number';
// Focus shows a note only when the last thing the user did was press a key (Tab to a button), not
// when the page moves focus after a click.
let byKeyboard = false;

export function initTooltips() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = target(e);
    if (!el || el === shownFor) return;
    hide();
    const at = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => show(el, at), HOVER_MS);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = target(e);
    if (el && !(isNode(e.relatedTarget) && el.contains(e.relatedTarget))) hide();
  });
  document.addEventListener('pointerdown', (e) => {
    hide();
    swallow = null;
    byKeyboard = false;
    if (e.pointerType === 'mouse') return;
    const el = target(e);
    if (!el) return;
    const at = { x: e.clientX - 20, y: e.clientY, above: true };
    hold = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        hold = null;
        show(el, at);
        swallow = { el, at: Date.now() };
        timer = setTimeout(hide, TOUCH_SHOWN_MS);
      }, HOLD_MS),
    };
  });
  document.addEventListener('pointermove', (e) => {
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > SLOP_PX) cancelHold();
  });
  document.addEventListener('pointerup', cancelHold);
  document.addEventListener('pointercancel', cancelHold);
  // After a press and hold the note was the answer, so the release does not press the button.
  document.addEventListener('click', (e) => {
    if (swallow && Date.now() - swallow.at < 2000 && isNode(e.target) && swallow.el.contains(e.target)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    swallow = null;
  }, true);
  document.addEventListener('focusin', (e) => {
    const el = target(e);
    if (el && byKeyboard) show(el);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => {
    byKeyboard = true;
    if (e.key === 'Escape') hide();
  });
  window.addEventListener('scroll', hide, true);
}
