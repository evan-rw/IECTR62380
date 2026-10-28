// Shared loader for the page tests: the real index.html + assets/app.js in jsdom, driven the
// way tests/ui.test.mjs and tests/netlist-tree.test.mjs drive them. One page per test file:
// app.js is an ES module, so it runs once per process. SITE=<folder> tests another copy.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const root = process.env.SITE ? pathToFileURL(`${process.env.SITE.replace(/\/$/, '')}/`) : new URL('..', import.meta.url);
export const fixture = (name) => readFileSync(new URL(`tests/fixtures/${name}`, root), 'latin1');

// One page per test file: app.js is an ES module, so it runs once per process.
export async function openPage({ css = false, board = null, before = null } = {}) {
  const { JSDOM } = createRequire(new URL('package.json', root))('jsdom');
  const dom = new JSDOM(readFileSync(new URL('index.html', root), 'utf8'), { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  // The stylesheet decides what the attention filter and [hidden] hide; jsdom applies it in getComputedStyle.
  if (css) {
    const style = document.createElement('style');
    style.textContent = readFileSync(new URL('assets/style.css', root), 'utf8');
    document.head.append(style);
  }
  if (board) window.localStorage.setItem('iec62380.board.v1', JSON.stringify(board));
  Object.assign(globalThis, { window, document, localStorage: window.localStorage, confirm: () => true, alert: () => {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  if (before) before(window);
  await import(new URL('assets/app.js', root).href);

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  const typeInto = (el, v) => { el.value = String(v); fire(el, 'input'); };
  const choose = (el, v) => { el.value = v; fire(el, 'input'); fire(el, 'change'); };
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const refOf = (card) => $('[data-key="ref"]', card).value;
  const cardFor = (ref) => $$('.part').find((p) => refOf(p) === ref);
  const cardById = (id) => $(`[data-part="${id}"]`);
  const toggleOf = (card) => $(`[data-act="toggle"][data-id="${card.dataset.part}"]`);
  const isOpen = (card) => toggleOf(card).getAttribute('aria-expanded') === 'true';
  // Opens a card (if closed) and returns the card element as it is after the re-render.
  const open = (card) => { const id = card.dataset.part; if (!isOpen(card)) click(toggleOf(card)); return cardById(id); };
  const shown = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden || window.getComputedStyle(n).display === 'none') return false;
    }
    return true;
  };
  async function importNetlist(name, text) {
    const input = $('#netlist-file');
    Object.defineProperty(input, 'files', { value: [{ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer }], configurable: true });
    fire(input, 'change');
    for (let i = 0; i < 200 && $('#import-report').hidden; i++) await settle(10);
  }
  // Collects which cards (by id) and which other page regions a callback mutates.
  function mutationsDuring(fn, target = document.body) {
    const mo = new window.MutationObserver(() => {});
    mo.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
    fn();
    const records = mo.takeRecords();
    mo.disconnect();
    const cards = new Set();
    const regions = new Set();
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      const card = el.closest('.part');
      if (card) { cards.add(card.dataset.part); continue; }
      // A card replaced as a whole shows up as a childList change on #parts: count the cards it swapped.
      if (el.id === 'parts') {
        for (const n of [...r.addedNodes, ...r.removedNodes]) if (n.nodeType === 1 && n.dataset?.part) cards.add(n.dataset.part);
        continue;
      }
      regions.add(el.closest('[id]')?.id ?? el.tagName);
    }
    return { cards, regions, records: records.length };
  }
  return { window, document, $, $$, fire, typeInto, choose, click, key, settle, refOf, cardFor, cardById, toggleOf, isOpen, open, shown, importNetlist, mutationsDuring };
}
