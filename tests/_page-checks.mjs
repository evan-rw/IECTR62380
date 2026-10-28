// Shared loader for the board-level-check UI tests: drives the real page
// (index.html + assets/app.js) in jsdom, as the repo's tests/ui.test.mjs does.
// The site under test is this repository; CHECKS_SITE=/abs/path/ points
// the same tests at another copy (for example one with a change applied).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

export const siteRoot = process.env.CHECKS_SITE
  ? pathToFileURL(process.env.CHECKS_SITE.endsWith('/') ? process.env.CHECKS_SITE : `${process.env.CHECKS_SITE}/`)
  : new URL('..', import.meta.url);

export async function openPage({ css = false } = {}) {
  const dom = new JSDOM(readFileSync(new URL('index.html', siteRoot), 'utf8'), { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, confirm: () => true, alert: () => {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  if (css) {
    const style = window.document.createElement('style');
    style.textContent = readFileSync(new URL('assets/style.css', siteRoot), 'utf8');
    window.document.head.append(style);
  }
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error ?? e.message));
  await import(new URL('assets/app.js', siteRoot).href);

  const $ = (s, r = window.document) => r.querySelector(s);
  const $$ = (s, r = window.document) => [...r.querySelectorAll(s)];
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  const typeInto = (el, v) => { el.value = String(v); fire(el, 'input'); };
  const choose = (el, v) => { el.value = v; fire(el, 'input'); fire(el, 'change'); };
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const pickNetlist = async (name, text) => {
    const input = $('#netlist-file');
    Object.defineProperty(input, 'files', { value: [{ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer }], configurable: true });
    fire(input, 'change');
    await settle();
  };
  return { window, document: window.document, errors, $, $$, fire, typeInto, choose, click, settle, pickNetlist };
}

// The phone case: a board whose circuit-board check "needs input" because one
// board setting (plating quality K_Q) is empty; the hole size itself is complete.
export function pcbNeedsInput({ $, click, typeInto, choose }) {
  click($('[data-act="pcb-add"]'));
  typeInto($('#pcb-holes [data-key="label"]'), '0.3 mm vias');
  typeInto($('#pcb-holes [data-key="drill"]'), 0.3);
  typeInto($('#pcb-holes [data-key="plating"]'), 25);
  choose($('#pcb-laminate'), 'fr4');
  for (const [key, v] of [['thickness', 1.6], ['ductility', 20], ['strength', 300], ['kd', 2.5], ['reflows', 2], ['reflowPeak', 245]]) typeInto($(`#pcb-${key}`), v);
}

// A small KiCad netlist with chip parts (for "Fill from chip parts") and one
// wet aluminium capacitor with nothing guessed (C4) and one whose rated life is
// guessed from its description (C5), for the capacitor-life table.
export const KICAD = `(export (version "E")
  (components
    (comp (ref "U1") (value "STM32") (footprint "Package_QFP:LQFP-48_7x7mm_P0.5mm"))
    (comp (ref "C1") (value "100nF") (footprint "Capacitor_SMD:C_0603_1608Metric"))
    (comp (ref "C2") (value "100nF") (footprint "Capacitor_SMD:C_0603_1608Metric"))
    (comp (ref "C3") (value "10uF") (footprint "Capacitor_SMD:C_1206_3216Metric"))
    (comp (ref "R1") (value "10k") (footprint "Resistor_SMD:R_0603_1608Metric"))
    (comp (ref "C4") (value "100uF") (footprint "Capacitor_THT:CP_Radial_D8.0mm_P3.50mm")
      (libsource (lib "Device") (part "C_Polarized")) (fields (field (name "Description") "Polarized capacitor")))
    (comp (ref "C5") (value "220uF") (footprint "Capacitor_THT:CP_Radial_D10.0mm_P5.00mm")
      (libsource (lib "Device") (part "C_Polarized")) (description "CAP ALUM 220UF 20% 35V RADIAL 2000H 105C")))
  (nets
    (net (code "1") (name "GND") (node (ref "U1") (pin "8")) (node (ref "C1") (pin "2")) (node (ref "C2") (pin "2")) (node (ref "C3") (pin "2")) (node (ref "C4") (pin "2")) (node (ref "C5") (pin "2")) (node (ref "R1") (pin "2")))
    (net (code "2") (name "+3V3") (node (ref "U1") (pin "48")) (node (ref "C1") (pin "1")) (node (ref "C2") (pin "1")) (node (ref "C3") (pin "1")) (node (ref "C4") (pin "1")) (node (ref "C5") (pin "1")) (node (ref "R1") (pin "1")))))
`;
