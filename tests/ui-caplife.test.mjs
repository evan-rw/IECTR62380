// Drives the Electrolytic capacitor life panel of the real page in jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { evaluateLine, lifeConditions } from '../assets/caplife.js';

const root = new URL('..', import.meta.url);

const BOM = [
  '"Comment","Description","Designator","Footprint","Manufacturer","Manufacturer Part Number"',
  '"100uF","CAP ALUM 100UF 20% 25V RADIAL 2000H 105C","C1","CP_Radial_D8.0mm","Nichicon","UVR1E101MED"',
  '"100uF","CAP ALUM POLY 100UF 16V","C2","CASE_D","Panasonic","16SVPF100M"',
  '"100uF","CAP TANT POLYMER 100UF 6.3V","C3","CASE_B","Panasonic","6TPE100MAZB"',
  '"10uF","CAP CER 10UF 50V X7R 1210","C4","C_1210_3225Metric","Murata","GRM32ER71H106KA12L"',
].join('\r\n');

test('capacitor life: lines, roles, totals, guesses and files', async () => {
  const dom = new JSDOM(readFileSync(new URL('index.html', root), 'utf8'), { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  const downloads = [];
  Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, confirm: () => true, alert: () => {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error ?? e.message));

  await import(new URL('assets/app.js', root).href);

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  const typeInto = (el, v) => { el.value = String(v); fire(el, 'input'); };
  const choose = (el, v) => { el.value = v; fire(el, 'input'); fire(el, 'change'); };
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const total = () => $('#summary .value').textContent;
  const boardTotal = () => parseFloat($('#results tr:last-child td:nth-child(5)').textContent.replace(/,/g, ''));
  const warn = () => $('#summary .warn')?.textContent ?? '';
  const rows = () => $$('#life-lines tr[data-life]');
  const cell = (row, key) => $(`[data-cell="${key}"]`, row);
  const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const exported = async () => { click($('[data-act="export-json"]')); return JSON.parse(await downloads.at(-1).text()); };

  // The example board has no aluminium capacitors: nothing to check, nothing pending.
  assert.equal(rows().length, 0);
  assert.match($('#life-lines').textContent, /No aluminium electrolytic capacitors yet/);
  assert.equal(warn(), '');
  assert.match($('#life-heading').textContent, /Electrolytic capacitor life/);
  const before = boardTotal();

  // A wet aluminium capacitor appears by itself, its kind from the part type.
  choose($('#add-model'), 'capacitor');
  click($('[data-act="add-part"]'));
  const card = $$('.part').at(-1);
  choose($('[data-key="type"]', card), 'aluminium-wet');
  assert.equal(rows().length, 1);
  const row = () => rows()[0];
  assert.equal($('[data-out="ref"]', row()).textContent, 'C22');
  assert.equal($('[data-key="tech"]', row()).value, 'wet');
  assert.equal(cell(row(), 'tech').classList.contains('inferred'), false);
  assert.equal($('[data-act="life-del"]', row()), null, 'a wet aluminium line cannot be dropped from the check');
  for (const key of ['hours', 'temp', 'ripple', 'role']) assert.ok(cell(row(), key).classList.contains('missing'), key);
  assert.ok($('#life-role').closest('.field').classList.contains('missing'));
  // Until it is filled in, its wear-out is left out and the total is a lower bound.
  assert.match(warn(), /1 capacitor life check needs input/);
  assert.match(total(), /^≥ /);
  assert.match($('#summary .sub:last-child').textContent, /1 capacitor wear-out left out/);

  typeInto($('[data-key="hours"]', row()), 2000);
  typeInto($('[data-key="temp"]', row()), 105);
  choose($('[data-key="ripple"]', row()), 'none');
  assert.equal(cell(row(), 'hours').classList.contains('missing'), false);
  assert.match($('[data-out="life"]', row()).textContent, /^15 y \(cap\)$/, '2000 h at 105 °C used at 40 °C is over the 15-year cap');
  assert.match($('[data-out="fit"]', row()).textContent, /Missing/, 'no role yet');

  // Board default "No": checked but not counted, and nothing pending.
  choose($('#life-role'), 'hard');
  assert.equal($('[data-out="fit"]', row()).textContent, 'not counted');
  assert.equal(warn(), '');
  const withoutWear = boardTotal();
  assert.ok(withoutWear > before);

  // This line's drift is a failure: its wear-out joins its own rate.
  choose($('[data-key="role"]', row()), 'drift');
  const board = await exported();
  const part = board.parts.at(-1);
  assert.deepEqual(part.life, { hours: 2000, temp: 105, ripple: 'none', role: 'drift' });
  assert.deepEqual(board.caplife, { defaultRole: 'hard', polymerRule: 'majority' });
  const expected = evaluateLine(part, board.caplife, lifeConditions(board.profile, board.years));
  assert.equal(expected.capped, true);
  const shown = parseFloat($('[data-out="fit"]', row()).textContent);
  assert.ok(Math.abs(shown - expected.fitEach) <= 0.005 * expected.fitEach, `${shown} vs ${expected.fitEach}`);
  const c22 = $$('#results tr').find((tr) => tr.cells[0].textContent === 'C22');
  assert.match(c22.cells[1].textContent, /, with wear-out$/);
  assert.ok(expected.fitEach < 0.001, 'a 15-year life against a 10-year mission adds almost nothing');
  assert.ok(Math.abs(boardTotal() - (withoutWear + expected.fitEach)) <= 0.11, `${boardTotal()} vs ${withoutWear} + ${expected.fitEach}`);
  assert.match($('#life-result').textContent, /1 line counts wear-out/);
  assert.match($('#summary .scope').textContent, /include their wear-out only where drift is a failure/);

  // A short life: it wears out before the end of the mission, and the page says so.
  typeInto($('[data-key="hours"]', row()), 1000);
  typeInto($('[data-key="temp"]', row()), 100);
  assert.ok(row().classList.contains('worn'));
  assert.match($('#life-result').textContent, /C22 reaches end of life after 7\.3 years, before the end of the mission \(95 % worn out by then\)\./);
  assert.match(warn(), /1 capacitor line reaches end of life before the end of the mission/);

  // Ripple from a current ratio needs ΔT0 and what the rating includes; the row's cells change.
  choose($('[data-key="ripple"]', row()), 'ratio');
  for (const key of ['ratio', 'rated', 'rise0']) assert.ok(cell(row(), key).classList.contains('missing'), key);
  typeInto($('[data-key="ratio"]', row()), 1);
  typeInto($('[data-key="rise0"]', row()), 5);
  choose($('[data-key="rated"]', row()), 'dc');
  assert.equal($$('#life-lines td.missing').length, 0);
  assert.match($('[data-out="life"]', row()).textContent, /^3\.7 y$/, '1000·2⁶·2⁻¹ h is 3.65 years');

  // The board saves and reloads with its life inputs.
  const saved = await exported();
  click($('[data-act="new"]'));
  assert.equal(rows().length, 0);
  const json = JSON.stringify(saved);
  const input = $('#import-file');
  Object.defineProperty(input, 'files', { value: [{ text: async () => json }], configurable: true });
  fire(input, 'change');
  await settle();
  assert.equal(rows().length, 1);
  assert.equal($('[data-key="ratio"]', row()).value, '1');
  assert.equal($('#life-role').value, 'hard');

  // A BOM on an empty board: the wet part's rating and the polymer part's kind are guessed;
  // polymer tantalum is not an aluminium capacitor, and goes to the makers' tantalum models.
  click($('[data-act="new"]'));
  const bom = $('#bom-file');
  Object.defineProperty(bom, 'files', { value: [{ name: 'caps.csv', arrayBuffer: async () => new TextEncoder().encode(BOM).buffer }], configurable: true });
  fire(bom, 'change');
  await settle();
  assert.deepEqual(rows().map((r) => $('[data-out="ref"]', r).textContent), ['C1', 'C2']);
  const [wet, poly] = rows();
  assert.deepEqual(['hours', 'temp'].map((k) => [$(`[data-key="${k}"]`, wet).value, cell(wet, k).classList.contains('inferred')]), [['2000', true], ['105', true]]);
  assert.match($('[data-key="hours"]', wet).title, /Guessed from “CAP ALUM 100UF 20% 25V RADIAL 2000H 105C”/);
  assert.deepEqual([$('[data-key="tech"]', poly).value, cell(poly, 'tech').classList.contains('inferred')], ['polymer', true]);
  assert.equal($('[data-out="desc"]', poly).textContent, '100uF · CAP ALUM POLY 100UF 16V');
  assert.match($$('.part').find((p) => $('[data-key="ref"]', p).value === 'C2').textContent, /Aluminium polymer capacitor, maker's rate/);
  assert.match(warn(), /2 capacitor lives use guessed values/);
  const c3 = $$('.part').find((p) => $('[data-key="ref"]', p).value === 'C3');
  assert.match($('.part-kind .model', c3).textContent, /Tantalum or niobium oxide capacitor, maker's model/);
  // A 1210 ceramic chip is flagged for flex cracking, in the solder-joint panel and the summary's scope.
  assert.equal($('#smt-flex').hidden, false);
  assert.match($('#smt-flex').textContent, /C4 \(1210\) is a ceramic chip 1210 or larger.*2 mm.*5 mm/s);
  assert.match($('#summary .scope').textContent, /Flex cracking of C4 \(1210\), ceramic chips 1210 or larger, is not counted/);
  // Confirming keeps the values and the reasons; the amber goes.
  click($('[data-act="life-confirm"]', wet));
  const wetNow = rows()[0];
  assert.equal(cell(wetNow, 'hours').classList.contains('inferred'), false);
  assert.match($('[data-key="hours"]', wetNow).title, /; confirmed$/);
  assert.equal($('[data-act="life-confirm"]', wetNow).hidden, true);
  // The polymer line can be dropped from the check, and listed again.
  click($('[data-act="life-del"]', rows()[1]));
  assert.deepEqual(rows().map((r) => $('[data-out="ref"]', r).textContent), ['C1']);
  const add = $('#life-add');
  assert.deepEqual([...add.options].map((o) => o.textContent.split(':')[0]).sort(), ['C2', 'C4', 'Choose a line…']);
  add.value = [...add.options].find((o) => o.textContent.startsWith('C2')).value;
  fire(add, 'change');
  assert.deepEqual(rows().map((r) => $('[data-out="ref"]', r).textContent), ['C1', 'C2']);

  assert.deepEqual(errors, []);
});
