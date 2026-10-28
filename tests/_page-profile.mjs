// Shared jsdom set-up for the mission-profile UI tests: loads the real page
// (index.html + assets/app.js) the way tests/ui.test.mjs does.
//
// The site root is this repository (../), or ../site/ beside a review copy.
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const here = new URL('.', import.meta.url);
// PROFILE_SITE=/path/to/site/ points the tests at another copy.
export const root = process.env.PROFILE_SITE ? pathToFileURL(process.env.PROFILE_SITE.replace(/\/?$/, '/'))
  : existsSync(new URL('../site/index.html', here)) ? new URL('../site/', here) : new URL('../', here);

// beforeImport(window) runs after the globals are set and before app.js loads,
// for stubs the page reads at start-up (IntersectionObserver, say).
// app.js is an ES module, so it runs once per process: open one page per test
// file and run that file's cases as subtests on it.
let opened = false;
export async function openPage({ beforeImport, confirmAnswer = true } = {}) {
  if (opened) throw new Error('openPage() runs app.js once per process; use subtests on one page');
  opened = true;
  const dom = new JSDOM(readFileSync(new URL('index.html', root), 'utf8'), { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  const dialogs = [];
  Object.assign(globalThis, {
    window, document: window.document, localStorage: window.localStorage,
    confirm: (m) => { dialogs.push(m); return typeof confirmAnswer === 'function' ? confirmAnswer(m) : confirmAnswer; },
    alert: (m) => { dialogs.push(m); },
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error ?? e.message));
  if (beforeImport) await beforeImport(window);
  await import(new URL('assets/app.js', root).href);

  const $ = (s, r = window.document) => r.querySelector(s);
  const $$ = (s, r = window.document) => [...r.querySelectorAll(s)];
  const fire = (el, type, init = {}) => el.dispatchEvent(new window.Event(type, { bubbles: true, ...init }));
  const typeInto = (el, v) => { el.value = String(v); fire(el, 'input'); };
  const choose = (el, v) => { el.value = v; fire(el, 'input'); fire(el, 'change'); };
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const cell = (i, key) => $(`#phases [data-i="${i}"][data-key="${key}"]`);
  const rows = () => $$('#phases tr');
  const frame = () => new Promise((r) => window.requestAnimationFrame(() => setTimeout(r, 0)));
  // Phase values as the table shows them: [name, tac, tau, n, dT, addRise].
  const table = () => rows().map((tr, i) => [
    cell(i, 'name').value, cell(i, 'tac').value, cell(i, 'tau').value, cell(i, 'n').value, cell(i, 'dT').value, cell(i, 'addRise').checked,
  ]);
  return { window, document: window.document, dialogs, errors, $, $$, fire, typeInto, choose, click, cell, rows, table, frame };
}
