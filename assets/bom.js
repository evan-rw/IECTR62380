// Bill-of-materials import: a CSV, tab- or semicolon-separated export from
// Altium, KiCad, OrCAD or a distributor's BOM tool. Each row's designators
// are matched to the board's parts, or, on an empty board, build its parts.
// Manufacturer part numbers and distributor-style descriptions ("CAP CER
// 0.1UF 50V X7R 0603") feed the same guessing rules as the netlist import.

import { classifyComponent, compressRefs, expandRefs, groupLines } from './netlist.js';

// Header names, compared in lower case with spaces, dots and punctuation removed.
const COLUMNS = {
  designator: ['designator', 'designators', 'reference', 'references', 'ref', 'refs', 'refdes', 'partreference', 'referencedesignator', 'referencedesignators', 'location', 'position'],
  quantity: ['quantity', 'qty', 'qnty', 'count'],
  mpn: ['mpn', 'manufacturerpartnumber', 'mfrpartnumber', 'mfrpart', 'manufacturerpart', 'mfrpn', 'mfgpartnumber', 'mfgpn', 'partnumber', 'manufacturerpartnumber1', 'mfrpartno', 'manufacturerpartno'],
  manufacturer: ['manufacturer', 'mfr', 'mfg', 'manufacturername', 'manufacturer1', 'vendor'],
  description: ['description', 'desc', 'partdescription', 'detaileddescription'],
  value: ['value', 'comment', 'val', 'partvalue'],
  footprint: ['footprint', 'package', 'pcbfootprint', 'footprintname', 'case', 'casepackage', 'packagecase'],
};
const NOT_FITTED = /^(DNP|DNF|DNI|NF|NC|NOT FITTED|NOT POPULATED|DO NOT (FIT|POPULATE|PLACE)|NO ?POP|NO|FALSE|0)$/i;
const FITTED_COLUMNS = ['dnp', 'dnf', 'populate', 'fitted', 'fit', 'mount', 'populated', 'install', 'variant'];

const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Split delimited text into rows of cells, honouring double quotes.
export function parseDelimited(text) {
  const src = String(text).replace(/^﻿/, '');
  const first = src.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const counts = [',', '\t', ';'].map((d) => [d, first.split(d).length]);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return { delim, rows: rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean)) };
}

// Designators as written in BOMs: "C1, C2", "C1 C2", "C1-C3", "C1–C3", "C1;C2".
export function splitDesignators(text) {
  // A dash after a digit is a range (R1-R5, C9 – C11); one inside a name is not (KiCad's TA-101).
  const tokens = String(text ?? '').replace(/(\d)\s*[–-]\s*(?=[A-Za-z_]*\d)/g, '$1–').split(/[\s,;]+/).filter(Boolean);
  return tokens.flatMap((t) => expandRefs(t)).map((r) => r.toUpperCase());
}

// Find the header row and the columns this importer understands.
export function parseBom(text) {
  const { delim, rows } = parseDelimited(text);
  let headerAt = -1;
  let columns = null;
  for (let i = 0; i < Math.min(rows.length, 20) && headerAt < 0; i++) {
    const keys = rows[i].map(key);
    const found = {};
    for (const [name, aliases] of Object.entries(COLUMNS)) {
      const at = keys.findIndex((k) => aliases.includes(k));
      if (at >= 0) found[name] = at;
    }
    if (found.designator != null) { headerAt = i; columns = found; }
  }
  if (headerAt < 0) throw new Error('No designator column found. The BOM needs a column such as “Designator” or “Reference”.');
  const header = rows[headerAt];
  const fittedAt = header.map(key).findIndex((k) => FITTED_COLUMNS.includes(k));
  const cell = (r, name) => (columns[name] != null ? r[columns[name]] ?? '' : '');
  const items = [];
  const notFitted = [];
  const quantityMismatch = [];
  let noDesignator = 0;
  for (const r of rows.slice(headerAt + 1)) {
    const refs = splitDesignators(cell(r, 'designator'));
    if (!refs.length) { noDesignator++; continue; }
    const fittedCell = fittedAt >= 0 ? r[fittedAt] ?? '' : '';
    const dnpColumn = fittedAt >= 0 && ['dnp', 'dnf'].includes(key(header[fittedAt]));
    const marked = dnpColumn ? /^(1|YES|Y|TRUE|X|DNP|DNF)$/i.test(fittedCell) : NOT_FITTED.test(fittedCell);
    if (marked || [cell(r, 'value'), cell(r, 'description')].some((v) => /^(DNP|DNF|NOT FITTED)$/i.test(v))) {
      notFitted.push(...refs);
      continue;
    }
    const qty = Number(cell(r, 'quantity'));
    if (cell(r, 'quantity') !== '' && Number.isFinite(qty) && qty !== refs.length) quantityMismatch.push(compressRefs(refs));
    items.push({
      refs,
      quantity: Number.isFinite(qty) && cell(r, 'quantity') !== '' ? qty : null,
      mpn: cell(r, 'mpn'),
      manufacturer: cell(r, 'manufacturer'),
      description: cell(r, 'description'),
      value: cell(r, 'value'),
      footprint: cell(r, 'footprint'),
    });
  }
  return {
    delim,
    columns: Object.fromEntries(Object.entries(columns).map(([name, at]) => [name, header[at]])),
    items,
    notFitted,
    quantityMismatch,
    noDesignator,
  };
}

// The same guessing as the netlist import, with the MPN added to the text it reads. The
// manufacturer is left out: names such as "Samsung Electro-Mechanics" read as a part type.
function classify(designator, item) {
  const cls = classifyComponent({
    designator,
    value: item.value,
    footprint: item.footprint,
    description: [item.description, item.mpn].filter(Boolean).join(' '),
  });
  if (cls.skip) return cls;
  const source = { value: item.value, footprint: item.footprint, description: item.description, mpn: item.mpn, manufacturer: item.manufacturer };
  return { ...cls, source: Object.fromEntries(Object.entries(source).filter(([, v]) => v)) };
}

// An empty board: build its parts from the BOM alone.
export function bomToParts(text) {
  const bom = parseBom(text);
  const classified = [];
  const skipped = [];
  for (const item of bom.items) {
    for (const designator of item.refs) {
      const cls = classify(designator, item);
      if (cls.skip) skipped.push(designator);
      else classified.push({ designator, cls });
    }
  }
  return { ...bom, lines: groupLines(classified), skipped: compressRefs(skipped), skippedCount: skipped.length, parts: classified.length };
}

// A board with parts: add each BOM row's part number, manufacturer and description
// to the lines it covers, and redo the guesses with them. Values the user typed or
// confirmed are kept. A line whose designators fall in different BOM rows is split.
// parts: the board's part lines; defaultsOf(model) gives a model's default params;
// newId() names split lines. Returns the new list and what happened.
export function mergeBom(parts, bom, defaultsOf, newId) {
  const rowOf = new Map();
  bom.items.forEach((item, i) => item.refs.forEach((r) => rowOf.set(r, i)));
  const used = new Set();
  const notInBom = [];
  const report = { matched: 0, split: 0, improved: 0, retyped: 0, kept: 0 };
  const out = [];
  for (const part of parts) {
    const refs = expandRefs(part.ref);
    if (refs.length !== part.qty) { out.push(part); continue; }
    const byRow = new Map();
    for (const r of refs) {
      const row = rowOf.get(r.toUpperCase()) ?? null;
      if (row != null) used.add(r.toUpperCase());
      byRow.set(row, [...(byRow.get(row) ?? []), r]);
    }
    notInBom.push(...(byRow.get(null) ?? []));
    if (byRow.size === 1 && byRow.has(null)) { out.push(part); continue; }
    if (byRow.size > 1) report.split++;
    for (const [row, groupRefs] of byRow) {
      const line = byRow.size === 1 ? part : {
        ...structuredClone(part), id: newId(), ref: compressRefs(groupRefs), qty: groupRefs.length,
      };
      if (row != null) {
        report.matched++;
        const what = enrich(line, bom.items[row], defaultsOf);
        if (what) report[what]++;
      }
      out.push(line);
    }
  }
  const unmatched = bom.items.flatMap((item) => item.refs).filter((r) => !used.has(r));
  return {
    parts: out,
    report: { ...report, unmatched: compressRefs(unmatched), unmatchedCount: unmatched.length, notInBom: compressRefs(notInBom), notInBomCount: notInBom.length },
  };
}

// Merge one BOM row into a line; returns 'retyped', 'improved', 'kept' or null.
function enrich(line, item, defaultsOf) {
  const designator = expandRefs(line.ref)[0];
  const merged = {
    value: line.source?.value || item.value,
    footprint: line.source?.footprint || item.footprint,
    description: item.description || line.source?.description,
    mpn: item.mpn,
    manufacturer: item.manufacturer,
  };
  line.source = Object.fromEntries(Object.entries({ ...line.source, ...merged }).filter(([, v]) => v));
  const cls = classify(designator, { ...item, value: merged.value, footprint: merged.footprint });
  if (cls.skip) return null;
  line.inferred = line.inferred ?? {};
  line.confirmed = line.confirmed ?? {};
  const defaults = defaultsOf(line.model) ?? {};
  // A value the user set: not a default, not a guess, not a confirmed guess.
  const typed = Object.keys(line.params).filter((k) => line.params[k] != null && !(k in line.inferred) && !(k in line.confirmed) && line.params[k] !== defaults[k]);
  if (cls.model !== line.model) {
    if (typed.length) return 'kept';
    line.model = cls.model;
    line.params = { ...structuredClone(defaultsOf(cls.model) ?? {}), ...cls.params };
    line.inferred = { ...cls.inferred };
    line.confirmed = {};
    return 'retyped';
  }
  let changed = false;
  for (const [k, v] of Object.entries(cls.params)) {
    if (v == null || k in line.confirmed || typed.includes(k)) continue;
    if (line.params[k] === v && !(k in line.inferred)) continue;
    if (line.params[k] !== v || (cls.inferred[k] && line.inferred[k] !== cls.inferred[k])) changed = true;
    line.params[k] = v;
    if (cls.inferred[k]) line.inferred[k] = cls.inferred[k];
  }
  return changed ? 'improved' : null;
}
