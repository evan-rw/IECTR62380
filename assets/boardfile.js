// Board files for the Circuit board check: drilled holes and the layer stackup from Altium .PcbDoc
// (binary or ASCII), KiCad .kicad_pcb, IPC-2581, P-CAD ASCII .pcb and Excellon drill files. Pure
// functions, file in and data out, written to walk a large file once (files of 50 MB and more), reporting
// how far they are.
//
// parseBoardFile(bytes or text, name, onProgress) -> {
//   format,                        'Altium binary', 'Altium ASCII', 'KiCad', 'IPC-2581', 'P-CAD ASCII'
//                                  or 'Excellon'
//   holes: [{ size, plated, through, kind, shape, count }],
//                                  size: finished hole diameter (slot width) in mm; plated true,
//                                  false or null (the file does not say); through: from the top
//                                  copper layer to the bottom one; kind 'via', 'pad' or 'hole';
//                                  shape 'round', 'square' or 'slot'; count: how many
//   thickness: { mm, from, detail } or null, from 'stated' or 'stack'
//   copperLayers, materials: dielectric material names, notes: [],
//   noStack: what to say instead of "no layer stackup" when thickness is null (optional) }

import { isCompoundFile, readCompoundFile } from './compoundfile.js';
import { decodeText } from './readfile.js';

const MIL = 0.0254;
const round = (x, d = 4) => +x.toFixed(d);

// A length with an optional unit; a bare number is in `bare` units (mm per unit).
function lengthMm(value, bare = MIL) {
  const m = /^\s*(-?\d*\.?\d+(?:e-?\d+)?)\s*(mil|mm|um|µm|in|inch)?\s*$/i.exec(String(value ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  return n * (unit === 'mil' ? MIL : unit === 'mm' ? 1 : unit === 'um' || unit === 'µm' ? 0.001 : unit === 'in' || unit === 'inch' ? 25.4 : bare);
}

// Holes counted by size, plating, reach, kind and shape.
function holeCounter() {
  const map = new Map();
  return {
    add(h, n = 1) {
      if (!(h.size > 0) || !(n > 0)) return;
      const hole = { size: round(h.size), plated: h.plated ?? null, through: h.through !== false, kind: h.kind ?? 'hole', shape: h.shape ?? 'round' };
      const key = JSON.stringify(hole);
      const seen = map.get(key);
      if (seen) seen.count += n; else map.set(key, { ...hole, count: n });
    },
    list: () => [...map.values()].sort((a, b) => a.size - b.size || a.kind.localeCompare(b.kind)),
  };
}

// Calls onProgress at most every `step` of the way, so a large file does not flood the page.
function throttle(onProgress, step = 0.005) {
  if (!onProgress) return () => {};
  let last = -1;
  return (f) => { if (f - last >= step || f >= 1) { last = f; onProgress(Math.min(1, f)); } };
}

// ---------------------------------------------------------------------------
// Which format

export function boardFormat(text, name = '') {
  const head = text.slice(0, 4096).replace(/^﻿/, '').trimStart();
  if (head.charCodeAt(0) === 0xd0 && head.charCodeAt(1) === 0xcf) return 'Altium binary';
  if (/P-CAD [^\n]*PCB Binary/.test(head.slice(0, 512))) return 'P-CAD binary';
  if (/^\|RECORD=/.test(head) || /\|KIND=Protel_Advanced_PCB/.test(head)) return 'Altium ASCII';
  // Other text types on Altium's Save Copy As and Export lists, named so the message can say which to pick.
  if (/^PCB FILE \d/.test(head)) return 'Protel PCB';
  if (/^ACCEL_ASCII\b/.test(head)) return 'P-CAD ASCII';
  if (/^\(kicad_pcb\b/.test(head)) return 'KiCad';
  if (/^<\?xml/.test(head) && /<IPC-2581\b/.test(head)) return 'IPC-2581';
  if (/^(?:;[^\n]*\n\s*)*M48\b/m.test(head) || (/\.(drl|xln|exc|drd|txt|nc|ncd|cnc|tap)$/i.test(name) && /^T\d+[^\n]*C[\d.]+/m.test(head))) return 'Excellon';
  // Files that come in the same set as the drill file, named so the message can say which to take instead.
  if (/%FS[LTD]?[AI]/.test(head) || /^G04 /m.test(head)) return 'Gerber';
  if (/\.(drl|drd)$/i.test(name) && /[\x01-\x08\x0e-\x1a]/.test(head.slice(0, 512))) return 'EIA drill';
  return null;
}

// The file's bytes as read, or its text.
export function parseBoardFile(file, name = '', onProgress) {
  const progress = throttle(onProgress);
  if (typeof file !== 'string' && isCompoundFile(file)) return parseAltiumBinary(file, progress);
  const text = typeof file === 'string' ? file : decodeText(file);
  const format = boardFormat(text, name);
  switch (format) {
    case 'Altium ASCII': return parseAltium(text, progress);
    case 'KiCad': return parseKicadPcb(text, progress);
    case 'IPC-2581': return parseIpc2581(text, progress);
    case 'P-CAD ASCII': return parsePcad(text, progress);
    case 'Excellon': return parseExcellon(text, name, progress);
    case 'Altium binary': throw new Error('A binary .PcbDoc has to be read as bytes, not as text.');
    case 'P-CAD binary': throw new Error('This is a binary P-CAD .pcb. In P-CAD PCB, save a copy as an ASCII file (File » Save As, ASCII type) and import that.');
    case 'Protel PCB': throw new Error('This is a Protel PCB 2.8 ASCII (or older Protel) file, which the page does not read. In Altium, save a copy as type "PCB ASCII File (*.PcbDoc)" (File » Save Copy As) and import that.');
    case 'Gerber': throw new Error('This is a Gerber file (copper, mask, silkscreen or a drill drawing), not a drill file. Import the Excellon drill file from the same set instead: .drl, or .TXT from Altium.');
    case 'EIA drill': throw new Error('This is a drill file in the old EIA tape code, which the page does not read (Altium writes one as .DRL). Import the ASCII drill file beside it instead: Altium\'s drill report (.DRR) names it, usually a .TXT.');
    default: throw new Error('This is not a board file the page can read: an Altium .PcbDoc, a KiCad .kicad_pcb, an IPC-2581 .xml, a P-CAD ASCII .pcb or an Excellon drill file.');
  }
}

// ---------------------------------------------------------------------------
// Altium ASCII .PcbDoc: one record per line, |RECORD=Kind|KEY=value|…

function recordFields(line, into = {}) {
  for (const part of line.split('|')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      const key = part.slice(0, eq).toUpperCase();
      if (!(key in into)) into[key] = part.slice(eq + 1);
    }
  }
  return into;
}

const ALTIUM_TOP = new Set(['TOP', 'TOP LAYER', '1']);
const ALTIUM_BOTTOM = new Set(['BOTTOM', 'BOTTOM LAYER', '32']);

function parseAltium(text, progress) {
  const board = {};
  const holes = holeCounter();
  const len = text.length;
  // Lines end in CR LF, but a genuine export also parts some records with a lone CR.
  const eol = /[\r\n]/g;
  let pos = 0;
  let lines = 0;
  while (pos < len) {
    eol.lastIndex = pos;
    const end = eol.exec(text)?.index ?? len;
    if (text.startsWith('|RECORD=', pos)) {
      const bar = text.indexOf('|', pos + 8);
      const kind = text.slice(pos + 8, bar < 0 || bar > end ? end : bar).trim();
      if (kind === 'Board' || kind === 'Via' || kind === 'Pad') {
        const line = text.slice(pos, end);
        if (kind === 'Board') recordFields(line, board);
        else {
          const f = recordFields(line);
          if (kind === 'Via') {
            const start = (f.STARTLAYER ?? 'TOP').toUpperCase();
            const stop = (f.ENDLAYER ?? 'BOTTOM').toUpperCase();
            holes.add({ size: lengthMm(f.HOLESIZE), plated: true, through: ALTIUM_TOP.has(start) && ALTIUM_BOTTOM.has(stop), kind: 'via' });
          } else {
            holes.add({
              size: lengthMm(f.HOLESIZE),
              plated: (f.PLATED ?? 'TRUE').toUpperCase() !== 'FALSE',
              through: true,
              kind: 'pad',
              shape: ALTIUM_HOLE_SHAPES[f.HOLETYPE] ?? 'round',
            });
          }
        }
      }
    }
    pos = end + 1;
    if ((++lines & 0x3ff) === 0) progress(pos / len);
  }
  progress(1);
  return { format: 'Altium ASCII', holes: holes.list(), ...altiumStack(board), notes: [] };
}

// ---------------------------------------------------------------------------
// Binary Altium .PcbDoc: a compound file (compoundfile.js) whose Board6, Pads6 and Vias6 storages each
// hold a Data stream. Board6's is the ASCII file's Board record text; pads and vias are binary records
// with lengths as int32 in 1/10000 mil. The offsets are those KiCad reads (pcbnew/pcb_io/altium/
// altium_parser_pcb.cpp) and tscircuit/altiumts agrees with; checked against Altium's own drill reports
// for 7 boards (3,770 holes, blind, buried and micro vias among them).

const ALTIUM_UNIT = MIL / 10000;
const ALTIUM_HOLE_SHAPES = { 0: 'round', 1: 'square', 2: 'slot' };

function parseAltiumBinary(bytes, progress) {
  const file = readCompoundFile(bytes);
  const data = (storage) => file.stream(`${storage}/Data`) ?? new Uint8Array(0);
  const boardData = file.stream('Board6/Data');
  if (!boardData) throw new Error('This binary file holds no Altium board. A CircuitStudio or CircuitMaker board is stored differently: import its NC drill (Excellon) files instead.');
  const unreadable = (what, at) => {
    throw new Error(`The ${what} in this .PcbDoc could not be read (at byte ${at}): the file may be damaged or from an Altium version the page does not know. In Altium, save a copy as a PCB ASCII file (File » Save Copy As) and import that.`);
  };
  const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  // Board6: text blocks, each after its length (a set top byte marks a binary block), parted by a lone
  // CR as the ASCII file's Board records are.
  const board = {};
  const bv = view(boardData);
  for (let o = 0; o + 4 <= boardData.length;) {
    const head = bv.getUint32(o, true);
    const end = Math.min(o + 4 + (head & 0xffffff), boardData.length);
    if (!(head >>> 24)) for (const line of new TextDecoder('windows-1252').decode(boardData.subarray(o + 4, end)).split(/[\r\n\0]+/)) recordFields(line, board);
    o = end;
  }
  progress(0.3);
  const holes = holeCounter();
  // Pads6: a 2, then six parts, each after its length. Part 5 is the pad: hole size at 45 (0 for a
  // surface-mount pad), plated at 60. Part 6 holds the hole shape at 262, or is empty for a round hole.
  // A drilled pad goes through the board.
  const pads = data('Pads6');
  const pv = view(pads);
  for (let o = 0; o < pads.length;) {
    if (pads[o] !== 2) unreadable('pads', o);
    const at = o;
    const parts = [];
    for (let k = 0, p = o + 1; k < 6; k++) {
      if (p + 4 > pads.length) unreadable('pads', at);
      const n = pv.getUint32(p, true);
      if (p + 4 + n > pads.length) unreadable('pads', at);
      parts.push([p + 4, n]);
      p += 4 + n;
      o = p;
    }
    const [pad, padLength] = parts[4];
    const [shape, shapeLength] = parts[5];
    if (padLength < 61) unreadable('pads', at);
    holes.add({
      size: pv.getInt32(pad + 45, true) * ALTIUM_UNIT,
      plated: pads[pad + 60] !== 0,
      through: true,
      kind: 'pad',
      shape: shapeLength > 262 ? ALTIUM_HOLE_SHAPES[pads[shape + 262]] ?? 'round' : 'round',
    });
  }
  progress(0.6);
  // Vias6: a 3 and one part after its length: hole size at 25, the start and end layers at 29 and 30
  // (1 the top, 32 the bottom). Every via is plated.
  const vias = data('Vias6');
  const vv = view(vias);
  for (let o = 0; o < vias.length;) {
    if (vias[o] !== 3 || o + 5 > vias.length) unreadable('vias', o);
    const n = vv.getUint32(o + 1, true);
    const via = o + 5;
    if (n < 31 || via + n > vias.length) unreadable('vias', o);
    const [start, end] = [vias[via + 29], vias[via + 30]];
    holes.add({ size: vv.getInt32(via + 25, true) * ALTIUM_UNIT, plated: true, through: Math.min(start, end) === 1 && Math.max(start, end) === 32, kind: 'via' });
    o = via + n;
  }
  progress(1);
  return { format: 'Altium binary', holes: holes.list(), ...altiumStack(board), notes: [] };
}

// The stackup: Altium's newest form (V9_STACK_LAYERn_, physical order, top to bottom) when present,
// else the older chain LAYER1 → LAYERnNEXT → … → LAYER32.
function altiumStack(b) {
  const copper = [];
  const dielectric = [];
  if (`V9_STACK_LAYER0_NAME` in b) {
    // Every dielectric between the outer copper layers is the laminate, whatever its DIELTYPE (a genuine
    // export marks its 1.2 mm core 2); solder resist and any top or bottom dielectric lie outside them.
    let below = [];
    for (let i = 0; `V9_STACK_LAYER${i}_NAME` in b; i++) {
      const g = (k) => b[`V9_STACK_LAYER${i}_${k}`];
      const cu = lengthMm(g('COPTHICK'));
      if (cu > 0) {
        if (copper.length) dielectric.push(...below);
        copper.push(cu);
        below = [];
      } else if (lengthMm(g('DIELHEIGHT')) > 0) below.push({ mm: lengthMm(g('DIELHEIGHT')), material: g('DIELMATERIAL') ?? '' });
    }
  } else if ('LAYER1NAME' in b) {
    const seen = new Set();
    for (let id = '1'; id && id !== '0' && !seen.has(id); id = b[`LAYER${id}NEXT`]) {
      seen.add(id);
      const cu = lengthMm(b[`LAYER${id}COPTHICK`]);
      if (cu > 0) copper.push(cu);
      // The dielectric under a layer, unless it is the last one.
      const next = b[`LAYER${id}NEXT`];
      if (next && next !== '0' && lengthMm(b[`LAYER${id}DIELHEIGHT`]) > 0) dielectric.push({ mm: lengthMm(b[`LAYER${id}DIELHEIGHT`]), material: b[`LAYER${id}DIELMATERIAL`] ?? '' });
    }
  }
  if (!copper.length) return { thickness: null, copperLayers: null, materials: [] };
  const mm = copper.reduce((s, x) => s + x, 0) + dielectric.reduce((s, d) => s + d.mm, 0);
  return {
    thickness: { mm: round(mm, 3), from: 'stack', detail: `${copper.length} copper layers and ${dielectric.length} dielectric layer${dielectric.length === 1 ? '' : 's'} in the stackup` },
    copperLayers: copper.length,
    materials: [...new Set(dielectric.map((d) => d.material).filter(Boolean))],
  };
}

// ---------------------------------------------------------------------------
// KiCad .kicad_pcb: s-expressions. Only the forms that matter are read, so an 85 MB board is one pass.

// The index of the parenthesis that closes the form opening at `start`, minding quoted strings.
function formEnd(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 34) { // a quoted string: skip to its end
      for (i++; i < text.length && text.charCodeAt(i) !== 34; i++) if (text.charCodeAt(i) === 92) i++;
    } else if (c === 40) depth++;
    else if (c === 41 && --depth === 0) return i;
  }
  return text.length - 1;
}

function sexpr(text) {
  const tokens = text.match(/\(|\)|"(?:[^"\\]|\\.)*"|[^\s()"]+/g) ?? [];
  let i = 0;
  const read = () => {
    const t = tokens[i++];
    if (t !== '(') return t[0] === '"' ? t.slice(1, -1).replace(/\\(.)/g, '$1') : t;
    const list = [];
    while (i < tokens.length && tokens[i] !== ')') list.push(read());
    i++;
    return list;
  };
  return tokens.length ? read() : null;
}

function parseKicadPcb(text, progress) {
  const notes = [];
  const holes = holeCounter();
  // The board thickness as stated, from (general (thickness 1.6)).
  let thickness = null;
  const general = text.indexOf('(general');
  if (general >= 0) {
    const m = /\(thickness\s+([\d.]+)/.exec(text.slice(general, formEnd(text, general) + 1));
    if (m) thickness = { mm: Number(m[1]), from: 'stated', detail: 'the board thickness in the file' };
  }
  let copperLayers = null;
  let materials = [];
  const stackup = text.indexOf('(stackup');
  if (stackup >= 0) {
    const layers = (sexpr(text.slice(stackup, formEnd(text, stackup) + 1)) ?? []).filter((x) => Array.isArray(x) && x[0] === 'layer');
    const prop = (layer, key) => layer.find((x) => Array.isArray(x) && x[0] === key)?.[1];
    const copper = layers.filter((l) => prop(l, 'type') === 'copper');
    const dielectric = layers.filter((l) => ['core', 'prepreg'].includes(prop(l, 'type')));
    copperLayers = copper.length || null;
    materials = [...new Set(dielectric.map((l) => prop(l, 'material')).filter(Boolean))];
    // The barrel spans copper and dielectric; the stated thickness also counts the solder mask. A
    // dielectric built from sub-layers carries one (thickness) for each.
    const own = (l) => l.filter((x) => Array.isArray(x) && x[0] === 'thickness').reduce((s, x) => s + (Number(x[1]) || 0), 0);
    const mm = [...copper, ...dielectric].reduce((s, l) => s + own(l), 0);
    if (mm > 0) thickness = { mm: round(mm, 3), from: 'stack', detail: `${copper.length} copper layers and ${dielectric.length} dielectric layer${dielectric.length === 1 ? '' : 's'} in the stackup` };
  }
  const re = /\((via|pad)[\s)]/g;
  let m;
  let n = 0;
  while ((m = re.exec(text))) {
    const end = formEnd(text, m.index);
    const form = text.slice(m.index, end + 1);
    re.lastIndex = end + 1;
    if (m[1] === 'via') {
      const drill = /\(drill\s+([\d.]+)/.exec(form);
      const partial = /^\(via\s+(blind|micro|buried)\b/.test(form) || /\(type\s+(blind|micro|buried)\)/.test(form);
      if (drill) holes.add({ size: Number(drill[1]), plated: true, through: !partial, kind: 'via' });
    } else {
      const type = /^\(pad\s+(?:"(?:[^"\\]|\\.)*"|[^\s()]+)\s+(thru_hole|np_thru_hole)\b/.exec(form)?.[1];
      const drill = type && /\(drill\s+(oval\s+)?([\d.]+)(?:\s+([\d.]+))?/.exec(form);
      if (drill) {
        const oval = Boolean(drill[1]) && drill[3] && Number(drill[3]) !== Number(drill[2]);
        holes.add({ size: oval ? Math.min(Number(drill[2]), Number(drill[3])) : Number(drill[2]), plated: type === 'thru_hole', through: true, kind: 'pad', shape: oval ? 'slot' : 'round' });
      }
    }
    if ((++n & 0xfff) === 0) progress(m.index / text.length);
  }
  progress(1);
  return { format: 'KiCad', holes: holes.list(), thickness, copperLayers, materials, notes };
}

// ---------------------------------------------------------------------------
// IPC-2581 (XML)

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));

// Copper layer functions: KiCad writes CONDUCTOR, Altium SIGNAL.
const IPC_COPPER = new Set(['CONDUCTOR', 'SIGNAL', 'PLANE', 'MIXED']);
const IPC_DIELECTRIC = new Set(['DIELCORE', 'DIELPREG', 'DIELBASE', 'DIELADHV']);

function parseIpc2581(text, progress) {
  const unitName = /<CadHeader\b[^>]*\bunits="([^"]+)"/.exec(text)?.[1] ?? 'MILLIMETER';
  const unit = { MILLIMETER: 1, INCH: 25.4, MICRON: 0.001 }[unitName.toUpperCase()] ?? 1;
  // Layers: function by name; a drill layer's span (<Span> from KiCad, <SpanType> from Altium).
  const fn = new Map();
  const spans = new Map();
  for (const lm of text.matchAll(/<Layer\b([^>]*?)(\/>|>([\s\S]*?)<\/Layer>)/g)) {
    const a = attrs(lm[1]);
    if (!a.name) continue;
    fn.set(a.name, (a.layerFunction ?? '').toUpperCase());
    const span = lm[3] && /<Span(?:Type)?\b([^>]*)\/?>/.exec(lm[3]);
    if (span) spans.set(a.name, attrs(span[1]));
  }
  const conductors = [...fn].filter(([, f]) => IPC_COPPER.has(f)).map(([n]) => n);
  // Stackup: copper and dielectric thicknesses in sequence; solder mask and coatings are outside the laminate.
  let thickness = null;
  const layers = [...text.matchAll(/<StackupLayer\b([^>]*)>/g)].map((x) => attrs(x[1]));
  const copper = layers.filter((l) => IPC_COPPER.has(fn.get(l.layerOrGroupRef)));
  const dielectric = layers.filter((l) => IPC_DIELECTRIC.has(fn.get(l.layerOrGroupRef)));
  if (copper.length + dielectric.length) {
    const mm = [...copper, ...dielectric].reduce((s, l) => s + (Number(l.thickness) || 0) * unit, 0);
    if (mm > 0) thickness = { mm: round(mm, 3), from: 'stack', detail: `${copper.length} copper layers and ${dielectric.length} dielectric layer${dielectric.length === 1 ? '' : 's'} in the stackup` };
  }
  const materials = [...new Set([...text.matchAll(/<Property\b[^>]*\btext="([^"]*)"/g)].map((x) => x[1].trim())
    .filter((t) => /FR-?4|370\s*HR|85N|RO\s?4350|POLYIMIDE|ISOLA|ROGERS|ARLON|MEGTRON|IT-?180/i.test(t)))];
  // Holes and slots, each under the drill layer it belongs to: KiCad puts slots on a ROUT layer. Altium
  // repeats each slot on every other layer, drill layers included, so a slot counts once per place.
  const holes = holeCounter();
  const first = conductors[0];
  const last = conductors[conductors.length - 1];
  const drills = new Set([...fn].filter(([, f]) => f === 'DRILL' || f === 'ROUT').map(([name]) => name));
  let layer = null;
  const slotsAt = new Set();
  let n = 0;
  for (const tm of text.matchAll(/<(\/?)(LayerFeature|Hole|SlotCavity)\b([^>]*)>/g)) {
    if (tm[2] === 'LayerFeature') { layer = tm[1] ? null : attrs(tm[3]).layerRef ?? null; continue; }
    if (tm[1] || (drills.size && !drills.has(layer))) continue;
    const a = attrs(tm[3]);
    const span = layer && spans.get(layer);
    const through = !span || !first || ((span.fromLayer === first && span.toLayer === last) || (span.fromLayer === last && span.toLayer === first));
    const status = (a.platingStatus ?? '').toUpperCase();
    const plated = status === 'NONPLATED' ? false : status ? true : null;
    if (tm[2] === 'Hole') holes.add({ size: Number(a.diameter) * unit, plated, through, kind: status === 'VIA' ? 'via' : 'pad' });
    else slotsAt.add(/<PolyBegin\b[^>]*>/.exec(text.slice(tm.index, tm.index + 1000))?.[0] ?? tm.index);
    if ((++n & 0xfff) === 0) progress(tm.index / text.length);
  }
  const slots = slotsAt.size;
  progress(1);
  return {
    format: 'IPC-2581', holes: holes.list(), thickness, copperLayers: conductors.length || null, materials,
    notes: slots ? [`${slots} slot${slots === 1 ? '' : 's'} (sizes not read).`] : [],
  };
}

// ---------------------------------------------------------------------------
// P-CAD ASCII .pcb (ACCEL_ASCII), from P-CAD itself or from Altium's P-CAD export: s-expressions whose
// keywords may be in any case. Strings have no escapes (a Windows path can end in a backslash). A length is
// in the file's units unless it carries its own, joined (30mil) or apart (0.2 mm). A hole's size, plating
// and layer span belong to the pad or via style it names; a footprint (pattern) places its pads once for
// each instance on the board.

// The forms kept whole, by where they sit; everything else is passed over as it streams by.
const PCAD_KEEP = new Map([
  ['asciiheader', new Set(['fileunits', 'program'])],
  ['library', new Set(['padstyledef', 'viastyledef', 'patterndef', 'patterndefextended'])],
  ['pcbdesign', new Set(['layerdef', 'layersstackup'])],
  ['pcbdesign multilayer', new Set(['pattern', 'pad', 'via'])],
]);

// [path, form] for each kept form; a form is [keyword, ...values and forms], strings unquoted.
function pcadForms(text, progress) {
  const token = /[()]|"[^"]*"|[^\s()"]+/g;
  const stack = []; // { mode: 'path' | 'keep' | 'skip', kw, list }
  const kept = [];
  let opening = false;
  let n = 0;
  const begin = (kw) => {
    const parent = stack[stack.length - 1];
    const k = kw.toLowerCase();
    let frame = { mode: 'skip' };
    if (!parent) frame = { mode: 'path', kw: k };
    else if (parent.mode === 'keep') {
      // A footprint's drawing is not needed.
      if (k !== 'layercontents') { frame = { mode: 'keep', list: [kw] }; parent.list.push(frame.list); }
    } else if (parent.mode === 'path') {
      const path = stack.map((f) => f.kw).join(' ');
      if (PCAD_KEEP.get(path)?.has(k)) { frame = { mode: 'keep', list: [kw] }; kept.push([path, frame.list]); }
      else if (stack.length < 2) frame = { mode: 'path', kw: k };
    }
    stack.push(frame);
  };
  for (let m; (m = token.exec(text));) {
    const t = m[0];
    if (t === '(') {
      if (opening) begin('');
      opening = true;
    } else if (t === ')') {
      if (opening) begin('');
      opening = false;
      stack.pop();
    } else if (opening) {
      begin(t);
      opening = false;
    } else if (stack[stack.length - 1]?.mode === 'keep') stack[stack.length - 1].list.push(t[0] === '"' ? t.slice(1, -1) : t);
    if ((++n & 0x3ffff) === 0) progress(m.index / text.length);
  }
  return kept;
}

const isForm = (x, k) => Array.isArray(x) && x[0].toLowerCase() === k;
const formIn = (form, k) => form.find((x) => isForm(x, k));
const formsIn = (form, k) => form.filter((x) => isForm(x, k));
const valueIn = (form, k) => formIn(form, k)?.slice(1).filter((x) => typeof x === 'string').join(' ');
const nameKey = (x) => String(x ?? '').trim().toUpperCase();

function parsePcad(text, progress) {
  const kept = pcadForms(text, progress);
  const at = (path, k) => kept.filter(([p, f]) => p === path && f[0].toLowerCase() === k).map(([, f]) => f);
  const unit = { mil: MIL, mm: 1, in: 25.4, inch: 25.4 }[String(at('asciiheader', 'fileunits')[0]?.[1] ?? 'mil').toLowerCase()] ?? MIL;
  const program = String(at('asciiheader', 'program')[0]?.[1] ?? '');
  // Pad and via styles. Layer 1 is the top copper and layer 2 the bottom, so a hole from 1 to 2 goes through.
  const styles = { pad: new Map(), via: new Map() };
  for (const kind of ['pad', 'via']) {
    for (const f of at('library', `${kind}styledef`)) {
      const start = Number(valueIn(f, 'startrange'));
      const end = Number(valueIn(f, 'endrange'));
      const plated = valueIn(f, 'isholeplated')?.toLowerCase();
      styles[kind].set(nameKey(f[1]), {
        size: lengthMm(valueIn(f, 'holediam'), unit) ?? 0,
        plated: plated === 'false' ? false : plated === 'true' ? true : undefined,
        through: !(start > 0 && end > 0) || (Math.min(start, end) === 1 && Math.max(start, end) === 2),
      });
    }
  }
  // Each footprint's pads and vias by style, for each of its graphics ('' for the older form without).
  const tally = (multi) => {
    const t = { pad: new Map(), via: new Map() };
    for (const kind of ['pad', 'via']) for (const x of formsIn(multi ?? [], kind)) {
      const s = nameKey(valueIn(x, `${kind}styleref`));
      t[kind].set(s, (t[kind].get(s) ?? 0) + 1);
    }
    return t;
  };
  const patterns = new Map();
  const defs = [...at('library', 'patterndef'), ...at('library', 'patterndefextended')].map((f) => {
    const graphics = new Map();
    if (formIn(f, 'multilayer')) graphics.set('', tally(formIn(f, 'multilayer')));
    for (const g of formsIn(f, 'patterngraphicsdef')) graphics.set(nameKey(valueIn(g, 'patterngraphicsnamedef')), tally(formIn(g, 'multilayer')));
    return [f, graphics];
  });
  // An instance names its footprint as the library does, or (older files) by the original name.
  for (const [f, graphics] of defs) if (!patterns.has(nameKey(f[1]))) patterns.set(nameKey(f[1]), graphics);
  for (const [f, graphics] of defs) if (valueIn(f, 'originalname') && !patterns.has(nameKey(valueIn(f, 'originalname')))) patterns.set(nameKey(valueIn(f, 'originalname')), graphics);
  // The board: footprints, free pads and vias.
  const used = { pad: new Map(), via: new Map() };
  const use = (kind, style, n) => used[kind].set(style, (used[kind].get(style) ?? 0) + n);
  let unknownPatterns = 0;
  for (const kind of ['pad', 'via']) for (const x of at('pcbdesign multilayer', kind)) use(kind, nameKey(valueIn(x, `${kind}styleref`)), 1);
  for (const x of at('pcbdesign multilayer', 'pattern')) {
    const graphics = patterns.get(nameKey(valueIn(x, 'patternref')));
    if (!graphics) { unknownPatterns++; continue; }
    const t = graphics.get(nameKey(valueIn(x, 'patterngraphicsnameref'))) ?? graphics.values().next().value;
    for (const kind of ['pad', 'via']) for (const [style, n] of t?.[kind] ?? []) use(kind, style, n);
  }
  // P-CAD marks an unplated hole (isHolePlated False). Altium's P-CAD export never does, so there the
  // plating is unknown.
  const fromPcad = /P-CAD/i.test(program) || [...styles.pad.values()].some((s) => s.plated !== undefined);
  const holes = holeCounter();
  let unknownStyles = 0;
  for (const kind of ['pad', 'via']) {
    for (const [name, n] of used[kind]) {
      const s = styles[kind].get(name);
      if (!s) { unknownStyles += n; continue; }
      holes.add({ size: s.size, plated: kind === 'via' ? true : s.plated ?? (fromPcad ? true : null), through: s.through, kind }, n);
    }
  }
  const signal = at('pcbdesign', 'layerdef').filter((f) => /^(signal|plane)$/i.test(valueIn(f, 'layertype') ?? ''));
  const notes = [];
  if (!fromPcad && holes.list().some((h) => h.kind === 'pad')) notes.push('The file does not say which holes are plated or which are slots (Altium’s P-CAD export leaves both out), so every pad hole is taken as a plated round hole: remove any mounting-hole sizes that are not plated.');
  if (unknownPatterns) notes.push(`${unknownPatterns === 1 ? '1 footprint names a pattern' : `${unknownPatterns} footprints name patterns`} the file’s library does not hold; ${unknownPatterns === 1 ? 'its' : 'their'} holes are not counted.`);
  if (unknownStyles) notes.push(`${unknownStyles === 1 ? '1 pad or via names a style' : `${unknownStyles} pads or vias name styles`} the file’s library does not hold; ${unknownStyles === 1 ? 'its hole is' : 'their holes are'} not counted.`);
  progress(1);
  return {
    format: 'P-CAD ASCII', holes: holes.list(), thickness: null, copperLayers: signal.length || null, materials: [], notes,
    ...(at('pcbdesign', 'layersstackup').length ? { noStack: 'The page does not read the layer stackup of a P-CAD file yet: enter the board thickness and laminate.' } : {}),
  };
}

// ---------------------------------------------------------------------------
// Excellon drill file: a tool table, then one line per hole (or slot)

function parseExcellon(text, name, progress) {
  const lines = text.split(/\r\n|\r|\n/);
  // Tool sizes are in the header's units; a header that names none takes the first M71 (mm) or M72 (inch)
  // after it (Veribest), else Excellon's default, inches.
  let headerUnit = null;
  let bodyUnit = null;
  let filePlated = /NPTH|NON.?PLATED/i.test(name) ? false : /PTH|PLATED/i.test(name) ? true : null;
  let fileThrough = true;
  const tools = new Map(); // T number -> { c: size in the file's units, plated, kind }
  let pending = null; // a tool attribute comment applies to the next tool definition
  let typePlated = null; // Altium's ;TYPE=PLATED or ;TYPE=NON_PLATED, for the tools defined after it
  let header = true;
  let tool = null;
  let routing = false; // G00 starts route mode, where M15 plunges for a slot and X/Y lines are its path; G05 ends it
  let pattern = null; // the hits from M25 to M01, which each M02 repeats
  let recording = false;
  const hits = new Map();
  const add = (t, slot, n = 1) => {
    const key = `${t}|${slot ? 'slot' : 'round'}`;
    hits.set(key, (hits.get(key) ?? 0) + n);
    if (recording) pattern.push([t, slot, n]);
  };
  const define = (t, c) => {
    tools.set(t, { c, ...(typePlated == null ? {} : { plated: typePlated }), ...(pending ?? {}) });
    pending = null;
  };
  for (let i = 0; i < lines.length; i++) {
    if ((i & 0x3fff) === 0) progress(i / lines.length);
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith(';')) {
      const ff = /TF\.FileFunction,(Plated|NonPlated),\d+,\d+,(\w+)/i.exec(line);
      if (ff) { filePlated = ff[1].toLowerCase() === 'plated'; fileThrough = /^N?PTH$/i.test(ff[2]); }
      if (/TYPE=NON_PLATED/i.test(line)) filePlated = typePlated = false;
      else if (/TYPE=PLATED/i.test(line)) filePlated = typePlated = true;
      // Mentor's job header: "; Contents: Thru / Mill / Plated".
      const contents = /^;\s*Contents:.*?\b(Non-?Plated|Plated)\b/i.exec(line);
      if (contents) filePlated = !/^non/i.test(contents[1]);
      const af = /TA\.AperFunction,(Plated|NonPlated),\w+,(\w+)/i.exec(line);
      if (af) pending = { plated: af[1].toLowerCase() === 'plated', kind: /Via/i.test(af[2]) ? 'via' : 'pad' };
      continue;
    }
    if (/^M48\b/.test(line)) { header = true; continue; }
    // A header ends with % or M95, or, in some files, where a tool is chosen or a hole drilled.
    if (header && /^(T\d+\s*$|[XY]|G0[05]\b)/i.test(line)) header = false;
    if (header) {
      if (/^(METRIC|M71)\b/i.test(line)) headerUnit = 1;
      else if (/^(INCH|M72)\b/i.test(line)) headerUnit = 25.4;
      const def = /^T(\d+)[^C]*C(\d*\.?\d+)/i.exec(line);
      if (def) define(Number(def[1]), Number(def[2]));
      if (line === '%' || /^M95\b/.test(line)) header = false;
      continue;
    }
    if (bodyUnit == null && /^M7[12]\b/.test(line)) bodyUnit = line.startsWith('M71') ? 1 : 25.4;
    // A tool chosen by number, or (OrCAD, with no header) defined where it is first used.
    const sel = /^T(\d+)(?:[^C]*C(\d*\.?\d+))?/i.exec(line);
    if (sel) {
      tool = Number(sel[1]);
      if (sel[2] && !tools.has(tool)) define(tool, Number(sel[2]));
      continue;
    }
    if (/^M25\b/.test(line)) { pattern = []; recording = true; continue; }
    if (/^M0?1\b/.test(line)) { recording = false; continue; }
    if (/^M02(?!\d)/.test(line)) { // M02X…Y…: the pattern again, moved
      recording = false;
      for (const [t, slot, n] of pattern ?? []) add(t, slot, n);
      continue;
    }
    if (/^G00/i.test(line)) routing = true;
    else if (/^G05\b/i.test(line)) routing = false;
    const repeat = /^R(\d+)/.exec(line);
    if (tool == null) continue;
    if (routing) { if (/^M15\b/.test(line)) add(tool, true); }
    else if (repeat) add(tool, false, Number(repeat[1]));
    else if (/^[XY]/i.test(line)) add(tool, /G85/i.test(line));
  }
  const unit = headerUnit ?? bodyUnit ?? 25.4;
  const holes = holeCounter();
  for (const [key, n] of hits) {
    const [t, shape] = key.split('|');
    const def = tools.get(Number(t));
    if (def) holes.add({ size: def.c * unit, plated: def.plated ?? filePlated, through: fileThrough, kind: def.kind ?? 'hole', shape }, n);
  }
  progress(1);
  const unknown = filePlated === null && [...tools.values()].some((t) => t.plated == null);
  return {
    format: 'Excellon', holes: holes.list(), thickness: null, copperLayers: null, materials: [],
    notes: unknown ? ['The drill file does not say whether its holes are plated.'] : [],
  };
}

// ---------------------------------------------------------------------------
// The calculator's laminate for the stackup's dielectric material, if the name says which.

// Names that are no laminate family (a prepreg's glass style, "2116 RC58%") are passed over.
export function laminateFor(materials) {
  const ids = new Set(materials.map((m) => (/370\s*HR/i.test(m) ? 'isola-370hr' : /85N/i.test(m) ? 'arlon-85n' : /RO\s?4350/i.test(m) ? 'ro4350b' : /FR-?4/i.test(m) ? 'fr4' : null)).filter(Boolean));
  return ids.size === 1 ? [...ids][0] : null;
}
