// Board files for the Circuit board check: drilled holes and the layer stackup from Altium ASCII
// .PcbDoc, KiCad .kicad_pcb, IPC-2581 and Excellon drill files. Pure functions, text in and data out,
// written to walk a large file once (files of 50 MB and more), reporting how far they are.
//
// parseBoardFile(text, name, onProgress) -> {
//   format,                        'Altium ASCII', 'KiCad', 'IPC-2581' or 'Excellon'
//   holes: [{ size, plated, through, kind, shape, count }],
//                                  size: finished hole diameter (slot width) in mm; plated true,
//                                  false or null (the file does not say); through: from the top
//                                  copper layer to the bottom one; kind 'via', 'pad' or 'hole';
//                                  shape 'round' or 'slot'; count: how many
//   thickness: { mm, from, detail } or null, from 'stated' or 'stack'
//   copperLayers, materials: dielectric material names, notes: [] }

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

export function parseBoardFile(text, name = '', onProgress) {
  const format = boardFormat(text, name);
  const progress = throttle(onProgress);
  switch (format) {
    case 'Altium ASCII': return parseAltium(text, progress);
    case 'KiCad': return parseKicadPcb(text, progress);
    case 'IPC-2581': return parseIpc2581(text, progress);
    case 'Excellon': return parseExcellon(text, name, progress);
    case 'Altium binary': throw new Error('This is a binary Altium .PcbDoc. In Altium, save a copy as a PCB ASCII file (File » Save Copy As, type "PCB ASCII File") and import that.');
    case 'Protel PCB':
    case 'P-CAD ASCII': throw new Error(`This is a ${format === 'Protel PCB' ? 'Protel PCB 2.8 ASCII (or older Protel)' : 'P-CAD ASCII'} file, which the page does not read. In Altium, save a copy as type "PCB ASCII File (*.PcbDoc)" (File » Save Copy As) and import that.`);
    case 'Gerber': throw new Error('This is a Gerber file (copper, mask, silkscreen or a drill drawing), not a drill file. Import the Excellon drill file from the same set instead: .drl, or .TXT from Altium.');
    case 'EIA drill': throw new Error('This is a drill file in the old EIA tape code, which the page does not read (Altium writes one as .DRL). Import the ASCII drill file beside it instead: Altium\'s drill report (.DRR) names it, usually a .TXT.');
    default: throw new Error('This is not a board file the page can read: an Altium ASCII .PcbDoc, a KiCad .kicad_pcb, an IPC-2581 .xml or an Excellon drill file.');
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
              shape: f.HOLETYPE === '2' ? 'slot' : 'round',
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

function parseIpc2581(text, progress) {
  const unitName = /<CadHeader\b[^>]*\bunits="([^"]+)"/.exec(text)?.[1] ?? 'MILLIMETER';
  const unit = { MILLIMETER: 1, INCH: 25.4, MICRON: 0.001 }[unitName.toUpperCase()] ?? 1;
  // Layers: function by name; a drill layer's span.
  const fn = new Map();
  const spans = new Map();
  for (const lm of text.matchAll(/<Layer\b([^>]*?)(\/>|>([\s\S]*?)<\/Layer>)/g)) {
    const a = attrs(lm[1]);
    if (!a.name) continue;
    fn.set(a.name, (a.layerFunction ?? '').toUpperCase());
    const span = lm[3] && /<Span\b([^>]*)\/?>/.exec(lm[3]);
    if (span) spans.set(a.name, attrs(span[1]));
  }
  const conductors = [...fn].filter(([, f]) => f === 'CONDUCTOR' || f === 'PLANE').map(([n]) => n);
  // Stackup: copper and dielectric thicknesses in sequence; solder mask and coatings are outside the laminate.
  let thickness = null;
  const layers = [...text.matchAll(/<StackupLayer\b([^>]*)>/g)].map((x) => attrs(x[1]));
  const inBoard = layers.filter((l) => ['CONDUCTOR', 'PLANE', 'DIELCORE', 'DIELPREG', 'DIELBASE', 'DIELADHV'].includes(fn.get(l.layerOrGroupRef)));
  if (inBoard.length) {
    const mm = inBoard.reduce((s, l) => s + (Number(l.thickness) || 0) * unit, 0);
    if (mm > 0) thickness = { mm: round(mm, 3), from: 'stack', detail: `${inBoard.filter((l) => ['CONDUCTOR', 'PLANE'].includes(fn.get(l.layerOrGroupRef))).length} copper layers and ${inBoard.length - inBoard.filter((l) => ['CONDUCTOR', 'PLANE'].includes(fn.get(l.layerOrGroupRef))).length} dielectric layers in the stackup` };
  }
  const materials = [...new Set([...text.matchAll(/<Property\b[^>]*\btext="([^"]*)"/g)].map((x) => x[1].trim())
    .filter((t) => /FR-?4|370\s*HR|85N|RO\s?4350|POLYIMIDE|ISOLA|ROGERS|ARLON|MEGTRON|IT-?180/i.test(t)))];
  // Holes and slots, each under the drill layer it belongs to.
  const holes = holeCounter();
  const first = conductors[0];
  const last = conductors[conductors.length - 1];
  let drill = null;
  let slots = 0;
  let n = 0;
  for (const tm of text.matchAll(/<(\/?)(LayerFeature|Hole|SlotCavity)\b([^>]*)>/g)) {
    if (tm[2] === 'LayerFeature') { drill = tm[1] ? null : attrs(tm[3]).layerRef ?? null; continue; }
    if (tm[1]) continue;
    const a = attrs(tm[3]);
    const span = drill && spans.get(drill);
    const through = !span || !first || ((span.fromLayer === first && span.toLayer === last) || (span.fromLayer === last && span.toLayer === first));
    const status = (a.platingStatus ?? '').toUpperCase();
    const plated = status === 'NONPLATED' ? false : status ? true : null;
    if (tm[2] === 'Hole') holes.add({ size: Number(a.diameter) * unit, plated, through, kind: status === 'VIA' ? 'via' : 'pad' });
    else slots++;
    if ((++n & 0xfff) === 0) progress(tm.index / text.length);
  }
  progress(1);
  return {
    format: 'IPC-2581', holes: holes.list(), thickness, copperLayers: conductors.length || null, materials,
    notes: slots ? [`${slots} slot${slots === 1 ? '' : 's'} (sizes not read)`] : [],
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
