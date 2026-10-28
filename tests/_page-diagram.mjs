// Page set-up for the block-diagram tests: opens the real page
// (index.html + assets/app.js) in jsdom with a sized diagram, and helpers to
// drive and read the block diagram.
//
// SITE selects another copy of the site to test (default: this repository):
//   SITE=/path/to/site/ node --test tests/
// Each test file runs in its own process, so each opens one page.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

export const SITE = process.env.SITE
  ? pathToFileURL(process.env.SITE.endsWith('/') ? process.env.SITE : `${process.env.SITE}/`)
  : new URL('..', import.meta.url);

export const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

// A Protel 2.0 netlist with `rails` supply rails, each decoupled by 1–4 values of
// capacitor (two of each), so the import proposes one block per rail with 1–4
// part lines in it, plus 40 resistors that stay in "Everything else".
export function railsNetlist(rails = 30) {
  const parts = [['U1', 'LQFP-100_14x14mm_P0.5mm', 'MCU']];
  const nets = new Map();
  const add = (net, node) => { if (!nets.has(net)) nets.set(net, []); nets.get(net).push(node); };
  let c = 0;
  for (let i = 1; i <= rails; i++) {
    for (let v = 0; v < 1 + (i % 4); v++) {
      for (let j = 0; j < 2; j++) {
        c++;
        parts.push([`C${c}`, 'C_0603_1608Metric', ['100nF', '1uF', '10uF', '4.7uF'][v]]);
        add(`V${i}`, `C${c}-1`);
        add('GND', `C${c}-2`);
      }
    }
    add(`V${i}`, `U1-${i}`);
  }
  add('GND', 'U1-100');
  for (let r = 1; r <= 40; r++) {
    parts.push([`R${r}`, 'R_0603_1608Metric', '10k']);
    add(`N${r}`, `R${r}-1`);
    add(`N${r}`, `U1-${40 + r}`);
    add(`M${r}`, `R${r}-2`);
    add(`M${r}`, `U1-${(r % 30) + 1}`);
  }
  return ['PROTEL NETLIST 2.0',
    ...parts.map(([d, f, v]) => `[\r\nDESIGNATOR\r\n${d}\r\nFOOTPRINT\r\n${f}\r\nPARTTYPE\r\n${v}\r\nDESCRIPTION\r\n\r\n]`),
    ...[...nets].map(([name, nodes]) => `(\r\n${name}\r\n${nodes.join('\r\n')}\r\n)`),
  ].join('\r\n');
}

// Opens the page. `width` x `height` is the diagram's size; `narrow` makes
// matchMedia('(max-width: 760px)') match, as on a phone.
export async function openPage({ width = 640, height = 480, narrow = false } = {}) {
  const dom = new JSDOM(readFileSync(new URL('index.html', SITE), 'utf8'), { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  const layoutReads = { clientWidth: 0, clientHeight: 0, rect: 0 };
  const svg = document.getElementById('st-rbd');
  Object.defineProperty(svg, 'clientWidth', { configurable: true, get: () => { layoutReads.clientWidth++; return width; } });
  Object.defineProperty(svg, 'clientHeight', { configurable: true, get: () => { layoutReads.clientHeight++; return height; } });
  svg.getBoundingClientRect = () => { layoutReads.rect++; return { left: 0, top: 0, x: 0, y: 0, width, height, right: width, bottom: height }; };
  const matchMedia = (q) => ({ matches: /reduced-motion/.test(q) || (narrow && /max-width/.test(q)), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.matchMedia = matchMedia;
  const raf = (cb) => setTimeout(() => cb(performance.now()), 0);
  window.requestAnimationFrame = raf;
  Object.assign(globalThis, {
    window, document, localStorage: window.localStorage,
    confirm: () => true, alert: () => {},
    matchMedia, requestAnimationFrame: raf,
    getComputedStyle: window.getComputedStyle.bind(window),
  });
  globalThis.CSS ??= { escape: (s) => String(s).replace(/[^\w-]/g, (ch) => `\\${ch}`) };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.Element.prototype.scrollIntoView = () => {};
  document.elementFromPoint = () => null;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error ?? e.message));

  await import(new URL('assets/app.js', SITE).href);
  await settle();

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

  // A pointer event (jsdom has no PointerEvent): a MouseEvent with pointerId and pointerType.
  const ptr = (target, type, x, y, o = {}) => {
    const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: o.button ?? 0, buttons: type === 'pointerup' ? 0 : 1, shiftKey: !!o.shiftKey, ctrlKey: !!o.ctrlKey, metaKey: !!o.metaKey });
    Object.defineProperty(e, 'pointerId', { value: o.pointerId ?? 1 });
    Object.defineProperty(e, 'pointerType', { value: o.pointerType ?? 'mouse' });
    Object.defineProperty(e, 'isPrimary', { value: o.isPrimary ?? true });
    target.dispatchEvent(e);
    return e;
  };
  const wheel = (o = {}) => {
    const e = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: o.x ?? width / 2, clientY: o.y ?? height / 2, deltaX: o.deltaX ?? 0, deltaY: o.deltaY ?? 0, deltaMode: o.deltaMode ?? 0, ctrlKey: !!o.ctrlKey, shiftKey: !!o.shiftKey });
    svg.dispatchEvent(e);
    return e;
  };

  async function importNetlist(name, text) {
    const input = $('#netlist-file');
    const buf = new TextEncoder().encode(text).buffer;
    Object.defineProperty(input, 'files', { value: [{ name, arrayBuffer: async () => buf }], configurable: true });
    fire(input, 'change');
    await settle(50);
  }

  // The view transform of #st-vp: screen = layout * k + (x, y).
  const view = () => {
    const m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)\s*scale\(([-\d.e]+)\)/.exec($('#st-vp').getAttribute('transform') ?? '');
    return m ? { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) } : null;
  };
  // Layout rectangle of a drawn item (a box <g> or a frame <rect>), in layout units.
  const layoutRect = (node) => {
    if (node.matches('rect')) return { x: +node.getAttribute('x'), y: +node.getAttribute('y'), w: +node.getAttribute('width'), h: +node.getAttribute('height') };
    const m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)/.exec(node.getAttribute('transform'));
    const face = node.querySelector('rect.face');
    return { x: +m[1], y: +m[2], w: +face.getAttribute('width'), h: +face.getAttribute('height') };
  };
  const toScreen = (r, v = view()) => ({ x: r.x * v.k + v.x, y: r.y * v.k + v.y, w: r.w * v.k, h: r.h * v.k });
  // The whole drawn board in layout units.
  const boardRect = () => {
    const rs = [...$$('#st-vp .frame'), ...$$('#st-vp .st-box')].map(layoutRect);
    const x0 = Math.min(...rs.map((r) => r.x));
    const y0 = Math.min(...rs.map((r) => r.y));
    const x1 = Math.max(...rs.map((r) => r.x + r.w));
    const y1 = Math.max(...rs.map((r) => r.y + r.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const inPane = (s, tol = 1) => s.x >= -tol && s.y >= -tol && s.x + s.w <= width + tol && s.y + s.h <= height + tol;
  const boxFor = (ref) => $$('#st-vp .st-box').find((g) => (g.querySelector('title')?.textContent ?? '').startsWith(`${ref}:`) || g.dataset.id.endsWith(`|${ref}`));

  return { window, document, svg, width, height, layoutReads, errors, $, $$, fire, ptr, wheel, importNetlist, view, layoutRect, toScreen, boardRect, inPane, boxFor };
}
