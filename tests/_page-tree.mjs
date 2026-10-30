// Page set-up for the structure-tree tests, following tests/ui.test.mjs.
// Several pages per file: app.js is imported afresh for each.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

export const SITE = new URL('..', import.meta.url);

// Three rails, each with two capacitors pin for pin: three proposals. R1 is on its own.
export const THREE_RAILS = `(export (version "E")
  (components
${[['C1', '100n'], ['C2', '100n'], ['C3', '10u'], ['C4', '10u'], ['C5', '1u'], ['C6', '1u']].map(([r, v]) => `    (comp (ref "${r}") (value "${v}") (footprint "Capacitor_SMD:C_0603_1608Metric") (libsource (lib "Device") (part "C") (description "Unpolarized capacitor")))`).join('\n')}
    (comp (ref "R1") (value "10k") (footprint "Resistor_SMD:R_0603_1608Metric") (libsource (lib "Device") (part "R") (description "Resistor"))))
  (nets
    (net (code "1") (name "+3V3") (node (ref "C1") (pin "1")) (node (ref "C2") (pin "1")) (node (ref "R1") (pin "1")))
    (net (code "2") (name "GND") ${['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((r) => `(node (ref "${r}") (pin "2"))`).join(' ')})
    (net (code "3") (name "+5V") (node (ref "C3") (pin "1")) (node (ref "C4") (pin "1")))
    (net (code "4") (name "+1V8") (node (ref "C5") (pin "1")) (node (ref "C6") (pin "1")))
    (net (code "5") (name "EN") (node (ref "R1") (pin "2")))))`;

let previous = null;
export async function loadPage() {
  // Leaving a page fires pagehide, as a browser does: the last page writes its pending save to its own
  // storage now. Otherwise its save timer fires later and writes into this page's storage (the globals
  // below point at the newest page), and on a loaded machine this page opens the last page's board.
  previous?.dispatchEvent(new previous.Event('pagehide'));
  const dom = new JSDOM(readFileSync(new URL('index.html', SITE), 'utf8'), { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  previous = window;
  Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, confirm: () => true, alert: () => {} });
  globalThis.CSS ??= { escape: (s) => String(s).replace(/[^\w-]/g, (c) => `\\${c}`) };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  URL.createObjectURL = () => 'blob:x';
  URL.revokeObjectURL = () => {};
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error ?? e.message));
  await import(new URL(`assets/app.js?page=${Math.random()}`, SITE).href);
  const { currentStructure } = await import(new URL('assets/structure-ui.js', SITE).href);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  const typeInto = (el, v) => { el.value = String(v); fire(el, 'input'); };
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const key = (el, k, o = {}) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const importKicad = async (text, name = 'board.net') => {
    const input = $('#netlist-file');
    Object.defineProperty(input, 'files', { value: [{ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer }], configurable: true });
    fire(input, 'change');
    await settle();
  };
  const rows = () => $$('#st-tree li[role="treeitem"]');
  const ownRow = (li) => li.querySelector(':scope > .st-row');
  const nameOf = (li) => ownRow(li).querySelector('.st-nm').textContent.trim();
  const proposedRows = () => rows().filter((li) => ownRow(li).querySelector('.st-badge.proposed'));
  const selectedRows = () => rows().filter((li) => li.getAttribute('aria-selected') === 'true');
  const inspector = () => $('#st-inspector');
  const status = () => $('#st-status').textContent;
  const rt = () => currentStructure().rt;
  const blocks = () => [...rt().nodes.values()].filter((n) => n.kind === 'block' && !n.fixed);
  return { window, document: window.document, errors, $, $$, fire, typeInto, click, key, settle, importKicad, rows, ownRow, nameOf, proposedRows, selectedRows, inspector, status, rt, blocks, currentStructure };
}
