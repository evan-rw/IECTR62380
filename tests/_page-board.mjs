// Page set-up for the board-bar tests: loads <SITE>/index.html and assets/app.js in
// jsdom, the way tests/ui.test.mjs does. SITE defaults to this repository; another
// path runs the same tests against that copy.
// app.js is a module, imported once per process, so each test file gets one page.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const siteDir = resolve(here, process.env.SITE ?? '..');
const root = pathToFileURL(`${siteDir}/`);
const require = createRequire(pathToFileURL(`${siteDir}/package.json`));
const { JSDOM } = require('jsdom');

// opts.css: inline assets/style.css so getComputedStyle sees its (non-@media) rules.
// opts.board: an exported board object to start from (as if saved in the browser).
export async function openPage(opts = {}) {
  let html = readFileSync(new URL('index.html', root), 'utf8');
  if (opts.css) html = html.replace('</head>', `<style>${readFileSync(new URL('assets/style.css', root), 'utf8')}</style></head>`);
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  const page = { window, document: window.document, alerts: [], downloads: [] };
  Object.assign(globalThis, {
    window, document: window.document, localStorage: window.localStorage,
    confirm: () => true, alert: (m) => page.alerts.push(m),
  });
  if (opts.board) window.localStorage.setItem('iec62380.board.v1', JSON.stringify(opts.board));
  window.HTMLElement.prototype.scrollIntoView = function () { page.scrolledTo = this; };
  window.HTMLAnchorElement.prototype.click = () => {};
  URL.createObjectURL = (blob) => { page.downloads.push(blob); return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  await import(new URL('assets/app.js', root).href);

  const $ = (s, r = window.document) => r.querySelector(s);
  const $$ = (s, r = window.document) => [...r.querySelectorAll(s)];
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  Object.assign(page, {
    $, $$, fire,
    typeInto: (el, v) => { el.value = String(v); fire(el, 'input'); },
    click: (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })),
    settle: (ms = 20) => new Promise((r) => setTimeout(r, ms)),
    // Picks a file for one of the hidden file inputs, as the real handlers read it.
    async pick(inputId, name, text) {
      const input = $(inputId);
      Object.defineProperty(input, 'files', { value: [{ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer }], configurable: true });
      fire(input, 'change');
      await page.settle();
    },
    // Records every DOM change under the given selectors while fn runs.
    mutations(selectors, fn) {
      const records = [];
      const obs = selectors.map((sel) => {
        const o = new window.MutationObserver((rs) => records.push(...rs.map((r) => `${sel}: ${r.type}`)));
        o.observe($(sel), { childList: true, subtree: true, characterData: true, attributes: true });
        return o;
      });
      fn();
      for (const o of obs) { records.push(...o.takeRecords().map((r) => `${r.target.nodeName}: ${r.type}`)); o.disconnect(); }
      return records;
    },
  });
  return page;
}

// A Protel 2.0 netlist: [designator, footprint, value] parts and [net, 'REF-pin', ...] nets.
export function protel(parts, nets) {
  return ['PROTEL NETLIST 2.0',
    ...parts.map(([d, fp, v]) => `[\nDESIGNATOR\n${d}\nFOOTPRINT\n${fp}\nPARTTYPE\n${v}\nDESCRIPTION\n\n]`),
    ...nets.map(([name, ...nodes]) => `(\n${name}\n${nodes.join('\n')}\n)`),
  ].join('\n');
}
