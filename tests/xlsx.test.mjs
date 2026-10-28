// The spreadsheet export: the .xlsx writer, read back with a zip and XML reader
// written here (not the writer's code), and the page's "Generate spreadsheet",
// whose figures must be the ones the page shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { JSDOM } from 'jsdom';

import { xlsx, columnName } from '../assets/xlsx.js';

const { DOMParser } = new JSDOM('').window;

// The files of a zip: every entry stored, its CRC checked when Node can.
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (dv.getUint32(end, true) !== 0x06054B50) end--;
  const files = {};
  let at = dv.getUint32(end + 16, true);
  for (let i = 0; i < dv.getUint16(end + 10, true); i++) {
    assert.equal(dv.getUint32(at, true), 0x02014B50, 'central directory entry');
    const [method, crc, size, nameLen, extra, comment, local] = [10, 16, 20, 28, 30, 32, 42].map((k) => (k === 16 || k === 20 || k === 42 ? dv.getUint32(at + k, true) : dv.getUint16(at + k, true)));
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    assert.equal(dv.getUint32(local, true), 0x04034B50, `local header of ${name}`);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    assert.equal(method, 0);
    if (zlib.crc32) assert.equal(zlib.crc32(data), crc, `CRC of ${name}`);
    files[name] = new TextDecoder().decode(data);
    at += 46 + nameLen + extra + comment;
  }
  return files;
}

const xml = (text, name) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  assert.equal(doc.getElementsByTagName('parsererror').length, 0, `${name} is well-formed XML`);
  return doc;
};

// Sheets by name, each as rows of values (numbers as numbers), plus the raw XML.
function readWorkbook(bytes) {
  const files = unzip(bytes);
  for (const [name, text] of Object.entries(files)) xml(text, name);
  const names = [...xml(files['xl/workbook.xml']).getElementsByTagName('sheet')].map((s) => s.getAttribute('name'));
  const sheets = {};
  names.forEach((name, i) => {
    const doc = xml(files[`xl/worksheets/sheet${i + 1}.xml`]);
    const rows = [];
    for (const c of doc.getElementsByTagName('c')) {
      const [, col, row] = /^([A-Z]+)(\d+)$/.exec(c.getAttribute('r'));
      const ci = [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const v = c.getAttribute('t') === 'inlineStr' ? c.getElementsByTagName('t')[0].textContent
        : c.getElementsByTagName('v')[0] ? Number(c.getElementsByTagName('v')[0].textContent) : null;
      (rows[Number(row) - 1] ??= [])[ci] = v;
    }
    sheets[name] = { rows: Array.from(rows, (r) => Array.from(r ?? [], (x) => x ?? null)), xml: files[`xl/worksheets/sheet${i + 1}.xml`] };
  });
  return { files, names, sheets };
}

test('xlsx: a workbook that reads back cell for cell', () => {
  const bytes = xlsx([
    { name: 'Summary', columns: [{ width: 30 }], rows: [[{ v: 'Title', style: 'title' }], ['Total', { v: 12.5, style: 'fitBold' }, 'FIT'], [], ['Text <&> "q" µ λ ≥', 'tab\there\u0001', Infinity, NaN, 0]] },
    { name: 'Parts: a/b [1]', columns: [{ width: 8 }, { width: 6, style: 'int' }], rows: [['Ref', 'Qty'], ['C1–C3', 3], ['R1', 1]], freeze: 1, filter: true },
    { name: 'Parts: a/b [1]', rows: [['again']] },
  ], { title: 'A & B' });
  const { files, names, sheets } = readWorkbook(bytes);
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
    'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml']);
  // Names lose the characters Excel forbids and stay unique.
  assert.deepEqual(names, ['Summary', 'Parts a b 1', 'Parts a b 1 2']);
  assert.deepEqual(sheets.Summary.rows, [['Title'], ['Total', 12.5, 'FIT'], [], ['Text <&> "q" µ λ ≥', 'tab\there', '∞', '—', 0]]);
  assert.deepEqual(sheets['Parts a b 1'].rows, [['Ref', 'Qty'], ['C1–C3', 3], ['R1', 1]]);
  // The header row stays in view and carries the filter, which Excel also keeps as a name.
  assert.match(sheets['Parts a b 1'].xml, /<pane ySplit="1" topLeftCell="A2"[^>]*state="frozen"\/>/);
  assert.match(sheets['Parts a b 1'].xml, /<autoFilter ref="A1:B3"\/>/);
  assert.match(files['xl/workbook.xml'], /<definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">'Parts a b 1'!\$A\$1:\$B\$3<\/definedName>/);
  // Every sheet and the styles are declared in the content types.
  for (const part of ['/xl/workbook.xml', '/xl/styles.xml', '/xl/worksheets/sheet3.xml']) assert.match(files['[Content_Types].xml'], new RegExp(`PartName="${part}"`));
  assert.match(files['docProps/core.xml'], /<dc:title>A &amp; B<\/dc:title>/);
});

test('xlsx: column names and long text', () => {
  assert.deepEqual([0, 25, 26, 51, 52, 701, 702].map(columnName), ['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
  const { sheets } = readWorkbook(xlsx([{ name: 'S', rows: [['x'.repeat(40000)]] }]));
  assert.equal(sheets.S.rows[0][0].length, 32767, "cut to Excel's cell limit");
});

// ---------------------------------------------------------------------------
// The page

// Two banks on two rails and a pull-up: the import guesses the capacitors' details,
// proposes two blocks and leaves inputs missing.
const NETLIST = `(export (version "E")
  (components
    (comp (ref "C1") (value "100n") (footprint "Capacitor_SMD:C_0603_1608Metric") (libsource (lib "Device") (part "C") (description "Unpolarized capacitor")))
    (comp (ref "C2") (value "100n") (footprint "Capacitor_SMD:C_0603_1608Metric") (libsource (lib "Device") (part "C") (description "Unpolarized capacitor")))
    (comp (ref "C3") (value "10u") (footprint "Capacitor_SMD:C_0805_2012Metric") (libsource (lib "Device") (part "C") (description "Unpolarized capacitor")))
    (comp (ref "C4") (value "10u") (footprint "Capacitor_SMD:C_0805_2012Metric") (libsource (lib "Device") (part "C") (description "Unpolarized capacitor")))
    (comp (ref "R1") (value "10k") (footprint "Resistor_SMD:R_0603_1608Metric") (libsource (lib "Device") (part "R") (description "Resistor"))))
  (nets
    (net (code "1") (name "+3V3") (node (ref "C1") (pin "1")) (node (ref "C2") (pin "1")) (node (ref "R1") (pin "1")))
    (net (code "2") (name "GND") (node (ref "C1") (pin "2")) (node (ref "C2") (pin "2")) (node (ref "C3") (pin "2")) (node (ref "C4") (pin "2")))
    (net (code "3") (name "+5V") (node (ref "C3") (pin "1")) (node (ref "C4") (pin "1")))
    (net (code "4") (name "EN") (node (ref "R1") (pin "2")))))`;

test('page: Generate spreadsheet reports the figures the page shows', async () => {
  const root = new URL('..', import.meta.url);
  const dom = new JSDOM(readFileSync(new URL('index.html', root), 'utf8'), { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  const downloads = [];
  Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, confirm: () => true, alert: () => {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLAnchorElement.prototype.click = function click() { downloads.at(-1).name = this.download; };
  URL.createObjectURL = (blob) => { downloads.push({ blob }); return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error ?? e.message));
  await import(new URL('assets/app.js', root).href);
  const { currentStructure } = await import(new URL('assets/structure-ui.js', root).href);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const generate = async () => {
    click($('[data-act="export-xlsx"]'));
    const d = downloads.at(-1);
    assert.equal(d.blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return { name: d.name, ...readWorkbook(new Uint8Array(await d.blob.arrayBuffer())) };
  };
  const value = (rows, label) => rows.find((r) => r[0] === label)?.[1];

  // The example board: every line complete, no redundancy.
  click($('[data-act="example"]'));
  await settle();
  let wb = await generate();
  assert.equal(wb.name, 'Example-board-FIT.xlsx');
  assert.deepEqual(wb.names, ['Summary', 'Parts', 'Calculation', 'Phases by part', 'Inputs', 'Mission profile', 'Structure']);
  const total = currentStructure().ev.board.fit;
  const summary = wb.sheets.Summary.rows;
  assert.equal(value(summary, 'Board failure rate'), total);
  assert.equal(value(summary, 'MTBF'), 1e9 / total);
  assert.ok(Math.abs(value(summary, 'Survival over 10 years') - Math.exp(-total * 1e-9 * 87600)) < 1e-15);
  assert.equal(value(summary, 'Part lines'), $$('.part').length);
  // Parts: each line's total is qty × each, the shares add to 1, and the totals to the board.
  const [header, ...body] = wb.sheets.Parts.rows;
  const col = (name) => header.indexOf(name);
  const lines = body.filter((r) => !/^Board/.test(r[0]));
  assert.equal(lines.length, $$('.part').length);
  for (const r of lines) assert.ok(Math.abs(r[col('λ total (FIT)')] - r[col('Qty')] * r[col('λ each (FIT)')]) < 1e-9, r[0]);
  assert.ok(Math.abs(lines.reduce((s, r) => s + r[col('Share of total')], 0) - 1) < 1e-12);
  assert.ok(Math.abs(lines.reduce((s, r) => s + r[col('λ total (FIT)')], 0) - total) < 1e-9);
  assert.equal(body.find((r) => r[0] === 'Board, all in series')[col('λ total (FIT)')], total);
  // Each line's breakdown adds up to its rate.
  const parts = header.filter((h) => / \(FIT each\)$/.test(h));
  for (const r of lines) assert.ok(Math.abs(parts.reduce((s, h) => s + (r[col(h)] ?? 0), 0) - r[col('λ each (FIT)')]) < 1e-9, r[0]);

  // An imported netlist: guessed and missing inputs, and a block accepted as 1 of 2.
  Object.defineProperty($('#netlist-file'), 'files', { value: [{ name: 'rails.net', arrayBuffer: async () => new TextEncoder().encode(NETLIST).buffer }], configurable: true });
  fire($('#netlist-file'), 'change');
  await settle();
  const row = (name) => $$('#st-tree li[role="treeitem"]').find((li) => $('.st-nm', li)?.textContent.includes(name));
  click($('.st-nm', row('C1, C2 in parallel')));
  click($('[data-st="accept"]', $('#st-inspector')));
  wb = await generate();
  const inputs = wb.sheets.Inputs.rows;
  assert.ok(inputs.some((r) => r[0] === 'C1, C2' && r[5] === 'Guessed' && r[6]), 'a guessed input with its reason');
  assert.ok(inputs.some((r) => r[5] === 'Missing'), 'a missing input');
  const partsRows = wb.sheets.Parts.rows;
  assert.ok(partsRows.some((r) => r[0] === 'C1, C2' && /guessed/.test(r[partsRows[0].indexOf('Status')])));
  const structure = wb.sheets.Structure.rows;
  assert.deepEqual(structure.find((r) => /C1, C2 in parallel/.test(r[1] ?? '')).slice(2, 5), ['Redundant, incomplete: counted in series', null, 2]);
  assert.ok(structure.some((r) => /C3, C4 in parallel/.test(r[1] ?? '') && r[2] === 'Proposed by the netlist, counted in series'));
  // The summary says the total is a lower bound while lines need input.
  assert.match(wb.sheets.Summary.rows.find((r) => /^Board failure rate/.test(r[0] ?? ''))[3], /^Lower bound/);

  // With the block complete (1 of 2, no shorts) the board figures are mission averages.
  const typeInto = (el, v) => { el.value = String(v); fire(el, 'input'); };
  typeInto($('#st-need'), 1);
  typeInto($('#st-short'), 0);
  const ev = currentStructure().ev;
  assert.ok(ev.redundancy);
  wb = await generate();
  const sum = ev.board.sfit;
  assert.ok(ev.board.fit < sum);
  const s2 = wb.sheets.Summary.rows;
  assert.equal(value(s2, 'Board failure rate, average over 10 years'), ev.board.fit);
  assert.equal(value(s2, 'Sum of part rates, all in series'), sum);
  assert.equal(value(s2, 'Mean time to failure'), ev.mttfHours);
  const p2 = wb.sheets.Parts.rows;
  const fitCol = p2[0].indexOf('λ total (FIT)');
  assert.equal(p2.find((r) => r[0] === 'Board, all in series')[fitCol], sum);
  assert.equal(p2.find((r) => r[0] === 'Board with redundancy, average over 10 years')[fitCol], ev.board.fit);
  assert.deepEqual(wb.sheets.Structure.rows.find((r) => /C1, C2 in parallel/.test(r[1] ?? '')).slice(2, 6), ['Redundant (k of n)', 1, 2, 0]);
  assert.deepEqual(errors, []);
});
