// Protel netlist import: parse Protel 1 / Protel 2.0 netlists and turn their
// components into parts, guessing what the netlist implies and leaving the
// rest blank. Pure functions, no DOM.
//
// Protel 2.0 (Altium, OrCAD "protel2", gEDA "protelII"):
//   PROTEL NETLIST 2.0
//   [                      component block: KEY line, then value line
//   DESIGNATOR / C1 / FOOTPRINT / C_0603 / PARTTYPE / 100nF / DESCRIPTION / …
//   ]
//   (                      net block: name, then "REF-PIN [pin name] [type]"
//   GND
//   C1-2 CAPACITOR-2 PASSIVE
//   )
// Protel 1 uses the same brackets, with designator, footprint and value on
// the first three lines of each component block.

import { IC_PACKAGES } from './tables.js';
import { aluminiumKindOf } from './caplife.js';

// ---------------------------------------------------------------------------
// Parsing

export function parseProtel(text) {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const first = lines.find((l) => l.trim() !== '') ?? '';
  const format = /^PROTEL\s+NETLIST\s+2/i.test(first.trim()) ? 'Protel 2.0' : 'Protel';
  const components = [];
  const pins = new Map(); // designator -> { count, max, nets }
  let nets = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('[')) {
      const block = [];
      for (i++; i < lines.length && lines[i].trim() !== ']'; i++) block.push(lines[i].trim());
      if (line !== '[') continue; // a header block such as "[DSN"
      const comp = parseComponentBlock(block);
      if (comp) components.push(comp);
    } else if (line === '(') {
      const block = [];
      for (i++; i < lines.length && lines[i].trim() !== ')'; i++) block.push(lines[i].trim());
      nets++;
      const net = block[0] ?? '';
      for (const node of block.slice(1)) {
        const token = node.split(/\s+/)[0];
        const dash = token.lastIndexOf('-');
        if (dash <= 0) continue;
        const ref = token.slice(0, dash);
        const pin = token.slice(dash + 1);
        const entry = pins.get(ref) ?? { count: 0, max: 0, nets: new Set() };
        entry.count++;
        entry.nets.add(net);
        if (/^\d+$/.test(pin)) entry.max = Math.max(entry.max, Number(pin));
        pins.set(ref, entry);
      }
    }
  }

  if (!components.length) {
    throw new Error('No components found. Export the netlist in KiCad, Protel or Protel 2 format.');
  }
  for (const c of components) {
    const p = pins.get(c.designator);
    c.connectedPins = p?.count ?? 0;
    c.highestPin = p?.max ?? 0;
    c.nets = p ? [...p.nets].sort() : [];
  }
  return { format, components, nets };
}

// KiCad's own netlist (Eeschema's default export, an s-expression starting "(export"):
// each component with its fields, symbol and DNP flag, and every net's nodes.
function readSexpr(text) {
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

export const isKicadNetlist = (text) => /^\s*\(export\b/.test(text.replace(/^\uFEFF/, ''));

export function parseKicad(text) {
  const root = readSexpr(text.replace(/^\uFEFF/, ''));
  if (!Array.isArray(root) || root[0] !== 'export') throw new Error('This is not a KiCad netlist.');
  const items = (list, key) => (list ?? []).filter((x) => Array.isArray(x) && x[0] === key);
  const one = (list, key) => items(list, key)[0];
  const val = (list, key) => { const x = one(list, key); return x && typeof x[1] === 'string' ? x[1] : ''; };
  const components = [];
  for (const comp of items(one(root, 'components'), 'comp')) {
    const fields = {};
    for (const f of items(one(comp, 'fields'), 'field')) {
      const name = val(f, 'name');
      if (name) fields[name] = f.find((x, k) => k > 0 && typeof x === 'string') ?? '';
    }
    const field = (re) => Object.entries(fields).find(([k]) => re.test(k.replace(/[\s._-]/g, '')))?.[1] ?? '';
    const mpn = field(/^(MPN|MFRPN|MFRPARTNUMBER|MFRPARTNO|MANUFACTURERPARTNUMBER|MFGPN|PARTNUMBER)$/i);
    const manufacturer = field(/^(MANUFACTURER|MFR|MFG|MANUFACTURERNAME)$/i);
    const lib = one(comp, 'libsource');
    const description = val(comp, 'description') || val(lib, 'description');
    const props = new Set(items(comp, 'property').map((p) => val(p, 'name')));
    components.push({
      designator: val(comp, 'ref'),
      value: val(comp, 'value'),
      footprint: val(comp, 'footprint'),
      // As for a BOM, the part number is read for clues and the manufacturer is not.
      description: [description, mpn].filter(Boolean).join(' '),
      source: { description, mpn, manufacturer },
      symbol: lib ? `${val(lib, 'lib')}:${val(lib, 'part')}` : '',
      fields,
      dnp: props.has('dnp'),
      offBoard: props.has('exclude_from_board'),
    });
  }
  if (!components.length) throw new Error('No components found in the KiCad netlist.');
  const pins = new Map();
  let nets = 0;
  for (const net of items(one(root, 'nets'), 'net')) {
    nets++;
    const name = val(net, 'name');
    for (const node of items(net, 'node')) {
      const ref = val(node, 'ref');
      const pin = val(node, 'pin');
      const entry = pins.get(ref) ?? { count: 0, max: 0, nets: new Set() };
      entry.count++;
      entry.nets.add(name);
      if (/^\d+$/.test(pin)) entry.max = Math.max(entry.max, Number(pin));
      pins.set(ref, entry);
    }
  }
  for (const c of components) {
    const p = pins.get(c.designator);
    c.connectedPins = p?.count ?? 0;
    c.highestPin = p?.max ?? 0;
    c.nets = p ? [...p.nets].sort() : [];
  }
  return { format: 'KiCad', components, nets };
}

function parseComponentBlock(block) {
  const clean = (v) => (v == null || v === '*' ? '' : v);
  if (/^DESIGNATOR$/i.test(block[0] ?? '')) {
    const fields = {};
    for (let k = 0; k + 1 < block.length; k += 2) fields[block[k].toUpperCase()] = clean(block[k + 1]);
    if (!fields.DESIGNATOR) return null;
    return {
      designator: fields.DESIGNATOR,
      footprint: fields.FOOTPRINT ?? '',
      value: fields.PARTTYPE ?? fields.COMMENT ?? '',
      description: fields.DESCRIPTION ?? '',
      fields,
    };
  }
  if (!block[0]) return null;
  return { designator: block[0], footprint: clean(block[1]), value: clean(block[2]), description: '', fields: {} };
}

// ---------------------------------------------------------------------------
// Classification: designator prefix -> part type; footprint/value -> details

const PREFIX_MODEL = {
  U: 'ic', IC: 'ic', N: 'ic', AR: 'ic',
  D: 'diode', CR: 'diode', Z: 'diode', ZD: 'diode', DZ: 'diode', VD: 'diode', TVS: 'diode',
  Q: 'transistor', VT: 'transistor',
  C: 'capacitor', CE: 'capacitor', CT: 'capacitor',
  R: 'resistor', RN: 'resistor', RA: 'resistor', RP: 'resistor', RR: 'resistor',
  L: 'inductor', FB: 'inductor', T: 'inductor',
  // MIL-HDBK-217F models
  K: 'mil-relay', RLY: 'mil-relay', RL: 'mil-relay',
  J: 'mil-connector', P: 'mil-connector', CN: 'mil-connector', CON: 'mil-connector',
  Y: 'mil-crystal', XTAL: 'mil-crystal',
  F: 'mil-fuse', FU: 'mil-fuse',
  SW: 'mil-switch', S: 'mil-switch',
  LED: 'mil-opto', OK: 'mil-opto', OC: 'mil-opto', ISO: 'mil-opto',
};

// Parts with no failure rate of their own.
const MECHANICAL = new Set(['TP', 'MH', 'H', 'FID', 'FD', 'MTG', 'HOLE', 'LOGO', 'MP', 'NT', 'FTG', 'NUT', 'SCREW', 'WASHER', 'STANDOFF', 'SPACER']);
// Hardware named by its value or footprint, for a designator with no electrical meaning (M702 "M.2 Screw").
const MECHANICAL_TEXT = /MOUNTING-?HOLE|FIDUCIAL|WASHER|STANDOFF|SPACER|PLATED-?HOLE|TEST-?POINT|\bSCREW\b|\bNUT\b/;
// Footprints that only a connector or jumper has, whatever the designator (CT101 on a pin header).
const CONNECTOR_FOOTPRINT = /PIN-?HEADER|PIN-?SOCKET|^CONN|CONNECTOR|TERMINAL-?BLOCK/;
// An LED footprint: KiCad's LED_SMD:LED_0603…, easyeda's LED-SMD_…, Kingbright's Duo_LED_….
const LED_FOOTPRINT = /(?:^|[-\s])LED(?:[-\d]|$)/;
// Part kind from the footprint library and name, for a designator that names none
// (ABRT_SW101, OSC1, LED_RST101) or the ambiguous X (crystal or connector). KiCad's standard libraries
// (Resistor_SMD, Crystal, Connector_Dsub, Button_Switch_SMD, …) and most others say it.
const FOOTPRINT_KINDS = [
  [CONNECTOR_FOOTPRINT, 'mil-connector'],
  [/^USB|\sUSB|^DSUB|\sDSUB|^DB-?\d|^JST|^HDR-|^U-?FL/, 'mil-connector'],
  [LED_FOOTPRINT, 'mil-opto'],
  [/CRYSTAL|^XTAL|OSCILLATOR|^OSC-/, 'mil-crystal'],
  [/BUTTON-?SWITCH|^SW-|^KEY-|^BUTTON|\sSW-/, 'mil-switch'],
  [/^FUSE|\sFUSE|^F\d{4}\b/, 'mil-fuse'],
  [/^RELAY|\sRELAY/, 'mil-relay'],
  [/^XFMR|TRANSFORMER/, 'inductor'],
  [/^RESISTOR|\sRESISTOR|^R-ARRAY|^R-\d{4}|^RESC\d/, 'resistor'],
  [/^CAPACITOR|\sCAPACITOR|^C-\d{4}|^CP-|^CAPC\d/, 'capacitor'],
  [/^INDUCTOR|\sINDUCTOR|^L-\d{4}|^INDC\d/, 'inductor'],
];
// …from a KiCad symbol (Device:R, Device:LED, Connector_Generic:Conn_01x04, Mechanical:MountingHole)…
const SYMBOL_KINDS = [
  [/^MECHANICAL:/, 'mechanical'],
  [/^CONNECTOR(?:-GENERIC)?(?:-\w+)?:|^JUMPER:/, 'mil-connector'],
  [/^SWITCH:/, 'mil-switch'],
  [/^RELAY/, 'mil-relay'],
  [/^TRANSFORMER|:TRANSFORMER/, 'inductor'],
  [/:LED/, 'mil-opto'],
  [/:CRYSTAL|:RESONATOR/, 'mil-crystal'],
  [/:FUSE/, 'mil-fuse'],
  [/^DEVICE:R(?:-|$)/, 'resistor'],
  [/^DEVICE:CP?(?:-|$)/, 'capacitor'],
  [/^DEVICE:(?:L|FERRITE-BEAD)(?:-|$)/, 'inductor'],
  [/^DEVICE:D(?:-|$)/, 'diode'],
  [/^DEVICE:Q-/, 'transistor'],
];
// …and from the value, when neither says anything.
const VALUE_KINDS = [
  [/^LED|\bLED\b/, 'mil-opto'],
  [/\d\s*[MK]HZ|^OSC-/, 'mil-crystal'],
  [/^SW-?PUSH|PUSH-?BUTTON|^SWITCH/, 'mil-switch'],
  [/^XFMR|TRANSFORMER/, 'inductor'],
  [/^CONN-|^CONN$|^DB\d+$/, 'mil-connector'],
];

// Families the calculator does not model yet, for the note on an "Other" part.
const OTHER_FAMILY = {
  X: 'Connector or crystal: choose Connector or Quartz crystal instead if you know which',
  BT: 'Battery (62380 clause 19)', B: 'Battery (62380 clause 19)',
  DS: 'LED or display (62380 clauses 9, 17)',
  RV: 'Varistor or potentiometer (62380 clauses 18, 11)', VR: 'Potentiometer or regulator',
  RT: 'Thermistor (62380 clauses 10, 18)', TH: 'Thermistor (62380 clauses 10, 18)',
  M: 'Motor or fan (62380 clause 19)', FAN: 'Fan (62380 clause 19)', FL: 'Filter',
};

const prefixOf = (designator) => (/^[A-Za-z_]+/.exec(designator)?.[0] ?? '').toUpperCase();
const norm = (s) => String(s ?? '').toUpperCase().replace(/_/g, '-');
// Footprint name without a library prefix such as "Package_DIP:".
const fpName = (footprint) => norm(String(footprint ?? '').split(':').pop());
const fmtMm = (x) => String(+x.toFixed(2));

// Body size written into the footprint name, e.g. "QFN-32_5x5mm" or "LQFP-64_10x10mm".
function bodySize(footprint) {
  const m = /(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)\s*(?:MM)?/i.exec(footprint);
  if (!m) return null;
  const w = Number(m[1]);
  const l = Number(m[2]);
  return w > 0 && l > 0 && w < 100 && l < 100 ? [w, l] : null;
}

const IC_PIN_PACKAGES = [
  { re: /\b(?:CDIP|CDIL)-?(\d+)?/, id: 'cdil' },
  { re: /\b(?:P?DIP|DIL|PDIL)-?(\d+)?/, id: 'pdil' },
  { re: /\bPGA-?(\d+)?/, id: 'pga' },
  { re: /\bSOJ-?(\d+)?/, id: 'soj' },
  { re: /\bH?TSSOP-?(\d+)?/, id: 'tssop' },
  { re: /\b(?:SSOP|QSOP)-?(\d+)?/, id: 'ssop' },
  { re: /\bVSOP-?(\d+)?/, id: 'vsop' },
  { re: /\bPLCC-?(\d+)?/, id: 'plcc' },
  { re: /\b(?:SOIC|SOP)-?(\d+)?/, id: 'so' },
  { re: /\bSO-?(\d+)/, id: 'so' }, // digits required, so SOT and SOD don't match
];

// IPC-7351 land-pattern names give the pitch first, then sizes in hundredths of a
// millimetre, then the pin count: SOIC127P600X175-8N is an 8-pin SOIC, not a 127-pin
// one; QFN50P400X400X80-25N has a 4 × 4 mm body; BGA96C80P9X16_750X1350X120 has 96
// balls in a 9 × 16 grid on a 7.5 × 13.5 mm body.
function ipcIcPackage(fp) {
  let m = /^(?:SOIC|SOP)(\d+)P(\d+)X\d+-(\d+)N?/.exec(fp);
  if (m) {
    const [pitch, span] = [Number(m[1]) / 100, Number(m[2]) / 100];
    return { package: pitch >= 1.2 ? 'so' : span >= 6 ? 'tssop' : 'diag-two-rows', pins: Number(m[3]) };
  }
  m = /^(QFN|DFN|SON)\d+P(\d+)X(\d+)(?:X\d+)?-(\d+)N?/.exec(fp);
  if (m) return { package: m[1] === 'QFN' ? 'diag-four-sides' : 'diag-two-rows', pins: Number(m[4]), body: [Number(m[2]) / 100, Number(m[3]) / 100] };
  m = /^SOT\d+P\d+X\d+-(\d+)N?/.exec(fp);
  if (m) return { package: 'diag-two-rows', pins: Number(m[1]) };
  m = /^BGA(\d+)C\d+P\d+X\d+-(\d+)X(\d+)/.exec(fp);
  if (m) return { package: 'diag-matrix', pins: Number(m[1]), body: [Number(m[2]) / 100, Number(m[3]) / 100] };
  return null;
}

// Guess an IC package (Tables 17a-17b) from the footprint name.
function guessIcPackage(footprint, highestPin) {
  const fp = fpName(footprint);
  const params = {};
  const inferred = {};
  const why = `from footprint “${footprint}”`;
  const ipc = ipcIcPackage(fp);
  if (ipc) {
    params.package = ipc.package;
    params.pins = ipc.pins;
    inferred.package = `${why} (IPC-7351 name)`;
    inferred.pins = why;
    if (ipc.body && ipc.package.startsWith('diag')) {
      [params.bodyW, params.bodyL] = ipc.body;
      inferred.bodyW = why;
      inferred.bodyL = why;
    }
    return { params, inferred };
  }
  const body = bodySize(fp);

  for (const { re, id } of IC_PIN_PACKAGES) {
    const m = re.exec(fp);
    if (!m) continue;
    params.package = id;
    inferred.package = why;
    if (m[1]) {
      params.pins = Number(m[1]);
      inferred.pins = why;
    } else if (highestPin > 0) {
      params.pins = highestPin;
      inferred.pins = 'from the highest pin number in the netlist';
    }
    return { params, inferred };
  }

  const fixedRow = (prefix) => body && IC_PACKAGES.rows.find((r) => r.kind === 'fixed' && r.id.startsWith(prefix)
    && ((r.body[0] === body[0] && r.body[1] === body[1]) || (r.body[0] === body[1] && r.body[1] === body[0])));
  const diagonal = (id) => {
    params.package = id;
    inferred.package = why;
    if (body) {
      [params.bodyW, params.bodyL] = body;
      inferred.bodyW = why;
      inferred.bodyL = why;
    }
  };

  if (/[LTPM]?QFP/.test(fp)) {
    const row = fixedRow('pqfp');
    if (row) { params.package = row.id; inferred.package = `${why} (${fmtMm(body[0])} × ${fmtMm(body[1])} mm body)`; } else diagonal('diag-four-sides');
  } else if (/BGA/.test(fp)) {
    const row = fixedRow('pbga');
    if (row) { params.package = row.id; inferred.package = `${why} (${fmtMm(body[0])} × ${fmtMm(body[1])} mm body)`; } else diagonal('diag-matrix');
  } else if (/QFN|MLF|LGA/.test(fp)) {
    diagonal('diag-four-sides');
  } else if (/DFN|SON\b|MSOP|VSSOP|SOT-?(?:23|353|363|553|563|583|5|6)\b|SC-?70|SC-?88|TSOT/.test(fp)) {
    diagonal('diag-two-rows');
  }
  return { params, inferred };
}

const DISCRETE_PATTERNS = [
  [/\bSOT-?223\b/, 'sot223'], [/\bSOT-?363\b|\bSC-?70-?6\b|\bSC-?88\b/, 'sot363'], [/\bSOT-?323\b|\bSC-?70\b/, 'sot323'],
  [/\bSOT-?343\b/, 'sot343'], [/\bSOT-?346\b|\bSC-?59\b/, 'sot346'], [/\bSOT-?457\b|\bSC-?74\b/, 'sot457'],
  [/\bSOT-?143\b/, 'sot143'], [/\bSOT-?89\b/, 'sot89'], [/\bSOT-?23\b/, 'sot23'],
  [/\bD2PA?K\b|\bTO-?263\b/, 'd2pak'], [/\bDPA?K\b|\bTO-?252\b|\bSOT-?428\b/, 'dpak'],
  [/\bTO-?220\b/, 'to220'], [/\bTO-?247\b/, 'to247'], [/\bTO-?218\b|\bSOT-?93\b/, 'to218'], [/\bTO-?126\b|\bSOT-?32\b/, 'sot32'],
  [/\bTO-?92\b/, 'to92'], [/\bTO-?18\b/, 'to18'], [/\bTO-?39\b|\bTO-?5\b/, 'to39'], [/\bISOTOP\b/, 'isotop'],
  [/\bSOD-?123/, 'sod123'], [/\bSOD-?323/, 'sod323'], [/\bSOD-?523/, 'sod523'], [/\bSOD-?110/, 'sod110'],
  [/\bMICRO-?MELF/, 'micromelf'], [/\bMINI-?MELF|\bSOD-?80\b|\bLL-?34\b/, 'minimelf'], [/\bMELF\b|\bLL-?41\b/, 'melf'],
  [/\bSMC\b|\bDO-?214AB/, 'smc'], [/\bSMB\b|\bDO-?214AA/, 'smb'], [/\bSMA\b|\bDO-?214AC/, 'sma'],
  [/\bDO-?35\b|\bDO-?204AH/, 'do35'], [/\bDO-?34\b|\bDO-?204AG/, 'do34'], [/\bDO-?41\b|\bDO-?204AL/, 'do41-plastic'], [/\bDO-?220/, 'do220'],
];

function guessDiscretePackage(footprint) {
  const fp = fpName(footprint);
  for (const [re, id] of DISCRETE_PATTERNS) {
    if (re.test(fp)) {
      const note = id === 'do41-plastic' ? ' (plastic body assumed)' : '';
      return { params: { package: id }, inferred: { package: `from footprint “${footprint}”${note}` } };
    }
  }
  return { params: {}, inferred: {} };
}

// Capacitors routed to the MIL-HDBK-217F model, with the closest style.
const CAP_217F_RULES = [
  [/\bMK[TPS]|FILM|POLYPROP|POLYEST|POLYCARB|C-RECT|\bWIMA/, 'CFR'],
  [/MICA/, 'CM'],
  [/TRIM|VARIABLE/, 'CV'],
];

// Capacitance in µF from a value such as "100nF", "4u7", "10 pF" or "2.2µF/50V".
export function parseCapacitance(value) {
  const m = /(\d+(?:[.,]\d+)?)\s*([PNUΜµ])(\d*)/.exec(norm(value));
  if (!m) return null;
  const n = Number(`${m[1].replace(',', '.')}${m[3] ? (m[1].includes('.') || m[1].includes(',') ? m[3] : `.${m[3]}`) : ''}`);
  const scale = { P: 1e-6, N: 1e-3, U: 1, Μ: 1, µ: 1 }[m[2]];
  return Number.isFinite(n) && n > 0 ? +(n * scale).toPrecision(6) : null;
}

const CHIP_SIZE = /(?:^|[^0-9])(0201|0402|0603|0805|1206|1210|1812|2010|2512)(?![0-9])/;
// IPC-7351 chip names are metric: RESC1608X55N is an 0603 resistor, CAPC1005X55N an 0402 capacitor.
const IPC_CHIP = /^(?:RES|CAP|IND)C(\d{4})X/;
const METRIC_CHIP = { '0603': '0201', 1005: '0402', 1608: '0603', 2012: '0805', 3216: '1206', 3225: '1210', 4532: '1812', 5025: '2010', 6332: '2512' };
const chipOf = (fp) => METRIC_CHIP[IPC_CHIP.exec(fp)?.[1]] ?? CHIP_SIZE.exec(fp)?.[1] ?? null;
const CHIP_RATING = { '0201': 0.05, '0402': 0.063, '0603': 0.1, '0805': 0.125, '1206': 0.25, '1210': 0.5, '1812': 0.75, '2010': 0.75, '2512': 1 };

function firstMatch(text, rules) {
  for (const [re, value] of rules) if (re.test(text)) return value;
  return null;
}

const IC_FAMILY_RULES = [
  [/EEPROM|\b24(?:LC|AA|C)\d|\b25(?:LC|AA)\d|\bAT24|\bM24\d/, 'mos-eeprom'],
  [/FLASH|\bW25Q|\bMX25|\bS25FL|\bSST2[56]|\b29[FL]\d/, 'mos-eprom'],
  [/\bDDR|SDRAM|\bDRAM/, 'mos-dram'],
  [/\bSRAM/, 'mos-sram-low'],
  // Altera MAX families are written "MAX 7000" or EPM…; Maxim's MAX3232-style numbers are not CPLDs.
  [/\bCPLD|\bMAX\s(?:[2-9]\d{3}|II|V|10)\b|\bEPM\d|\bXC95/, 'mos-cpld'],
  [/\bFPGA|\bXC[67]|\bEP[234]C|\bICE40|\bLFE/, 'mos-lca'],
  [/MICROCONTROLLER|MICROPROCESSOR|\bMCU\b|\bCPU\b|\bDSP|\bSTM32|\bSTM8|\bATMEGA|\bATTINY|\bATSAM|\bPIC\d|\bDSPIC|\bMSP430|\bNRF5|\bESP32|\bRP2040|\bLPC\d|\bMK[LV]?\d|\bS32K|\bTMS320/, 'mos-digital'],
  [/\b74(?:HC|HCT|AHC|LVC|LV|AC|ACT|ALVC|AUP|VHC)\d|\bCD4\d{3}/, 'mos-digital'],
];

const DIODE_RULES = [
  [/\bLED\b/, 'led'],
  [/ZENER|\bBZ[XTV]|\bMMSZ|\bMM3Z|\bPLVA|\bUDZ/, 'zener-lp'],
  [/\bTVS|\bSM[ABC]J|\bP[46]KE|\bP4SMA|\bSMF\d|ESD|\bTPD\d|\bSP\d{4}|\bRCLAMP|\bPUSB|\bSM712|\bD\dV\d|TRANSIL/, 'tvs-lp'],
  [/\b1N4148|\b1N914|\bBA[SVW]\d|\bBAT\d|\bLL4148|SMALL SIGNAL|\bRB5\d\d/, 'signal'],
  [/RECTIFIER|\b1N400\d|\b1N540\d|\b1N58\d\d|\bB58\d\d|\bS[1-3][A-M]\b|\bUS1|\bES[1-3]|\bSS[1-3]\d|\bMBRS?[1-3]\d|\bB[1-3]\d0\b|\bM[1-7]\b/, 'rectifier-lp'],
];

const TRANSISTOR_RULES = [
  [/MOSFET|\bFET\b|\b2N7002|\bBSS\d|\bIRF|\bIRL|\bSI[23]\d{3}|\bAO\d{4}|\bDM[GNP]\d|\bNTR\d|\bBSH\d|\bFD[NVS]\d|\bBSC\d|\bIPB\d|\bSTP\d/, 'mos'],
  [/\bBJT\b|\bNPN\b|\bPNP\b|\b2N(?:3904|3906|2222|2907|4401|4403)|\bBC\d{3}|\bMMBT|\bPMBT|\bBC[PX]\d|\bBF[RS]\d|\bMJD|\bTIP\d|\bPBSS|\bZXT/, 'bip'],
];

const CONNECTOR_RULES = [
  [/\bSMA\b|\bBNC\b|U-?FL|\bMMCX|\bMCX\b|\bSMB-?CONN|COAX/, 'rf-coax'],
  [/CARD-?EDGE|\bPCIE|\bM\.2\b/, 'card-edge'],
  [/\bRJ-?(?:11|12|45)\b|MODULAR/, 'telephone'],
  [/PIN-?HEADER|\bHEADER|\bIDC\b|\bJST|\bMOLEX|\bUSB|\bHDMI|D-?SUB|\bDB-?\d|CONN-\d|\bFFC|\bFPC/, 'rectangular'],
  [/\bM8\b|\bM12\b|CIRCULAR|\bDIN-?\d/, 'circular'],
];

const SWITCH_RULES = [
  [/PUSH|TACT|BUTTON|\bSKQG|\bTL\d{4}/, 'pushbutton'],
  [/DIP-?SW|SW-?DIP/, 'dip'],
  [/TOGGLE/, 'toggle'],
  [/ROCKER/, 'rocker'],
  [/\bREED/, 'reed'],
  [/THUMB/, 'thumbwheel'],
  [/ROTARY/, 'rotary'],
];

const OPTO_RULES = [
  [/\bPC8\d\d|\bLTV|\bEL8\d\d|\b4N\d\d|\bCNY1\d|\bTLP\d|\bH11A|\bSFH6/, 'iso-transistor'],
  [/\b6N13[89]|\bH11B|\b4N3[23]/, 'iso-darlington'],
];

const POWER_PACKAGES = new Set(['to220', 'to247', 'to218', 'd2pak', 'dpak', 'isotop', 'sot32']);
const SIGNAL_PACKAGES = new Set(['do35', 'do34', 'sod523', 'sod323', 'sod110', 'sot23', 'minimelf', 'micromelf']);
const RECTIFIER_PACKAGES = new Set(['do41-plastic', 'sma', 'smb', 'smc', 'do220']);

// Turn one netlist component into { model, params, inferred, source, note }
// or { skip: reason } for mechanical items.
export function classifyComponent(c) {
  const prefix = prefixOf(c.designator);
  const source = { value: c.value, footprint: c.footprint, description: c.description };
  const text = norm(`${c.value} ${c.description}`);
  const fp = fpName(c.footprint);
  // The footprint library, e.g. "Capacitor_Tantalum_SMD" in "Capacitor_Tantalum_SMD:CP_EIA-3528-21_Kemet-B".
  const lib = String(c.footprint ?? '').includes(':') ? norm(String(c.footprint).split(':')[0]) : '';
  const fpAll = `${lib} ${fp}`.trim();
  const sym = norm(c.symbol);
  if (MECHANICAL.has(prefix)) return { skip: 'mechanical' };

  let model = PREFIX_MODEL[prefix] ?? 'fixed';
  const family = OTHER_FAMILY[prefix];
  if (!PREFIX_MODEL[prefix]) {
    const kind = firstMatch(sym, SYMBOL_KINDS) ?? firstMatch(fpAll, FOOTPRINT_KINDS) ?? firstMatch(norm(c.value), VALUE_KINDS);
    if (kind === 'mechanical') return { skip: 'mechanical' };
    if (kind) model = kind;
    // Hardware only when nothing names an electrical part: a DSUB footprint can end in "…MountingHolesOffset9.12mm".
    else if (MECHANICAL_TEXT.test(`${text} ${fp}`) && !/TERMINAL/.test(`${text} ${fp}`)) return { skip: 'mechanical' };
  }
  if (['capacitor', 'resistor', 'inductor', 'diode'].includes(model) && CONNECTOR_FOOTPRINT.test(fp)) model = 'mil-connector';
  // T is a transformer or a transistor; the part number tells which.
  if (prefix === 'T' && firstMatch(text, TRANSISTOR_RULES)) model = 'transistor';
  if (model === 'diode' && (firstMatch(text, DIODE_RULES) === 'led' || LED_FOOTPRINT.test(fpAll) || /:LED/.test(sym))) model = 'mil-opto';
  // Film, mica and trimmer capacitors have no IEC TR 62380 model here: use the 217F one.
  const capStyle = model === 'capacitor' ? firstMatch(`${text} ${fp}`, CAP_217F_RULES) : null;
  if (capStyle) model = 'mil-capacitor';
  // Wirewound resistors, potentiometers and thermistors: the 217F resistor model.
  let resStyle = null;
  if (model === 'resistor' && /WIREWOUND|\bWW\b|R-WW|\bWIRE\b/.test(`${text} ${fp}`)) resStyle = 'RW';
  else if (['RV', 'VR', 'POT'].includes(prefix) && /POT|TRIM|\bR-?POT|CERMET/.test(`${prefix} ${text} ${fp}`)) resStyle = 'RJ';
  else if (['RT', 'TH', 'NTC', 'PTC'].includes(prefix) && !/FUSE|POLY/.test(text)) resStyle = 'RTH';
  if (resStyle) model = 'mil-resistor';
  // The IEC TR 62380 inductor model here has no base rates; the 217F one does.
  if (model === 'inductor') model = 'mil-inductive';
  // Aluminium polymer and hybrid capacitors have no failure-rate model: the maker's
  // rate is entered, and their wear-out is checked under Electrolytic capacitor life.
  const alKind = model === 'capacitor' ? aluminiumKindOf(`${text} ${fp}`) : null;
  if (alKind === 'polymer' || alKind === 'hybrid') model = 'fixed';
  // Polymer tantalum has no IEC TR 62380 model here: the makers' models, with the choice left to the user.
  if (model === 'capacitor' && /POLYMER|POSCAP|KO-?CAP/.test(`${text} ${fp}`)) model = 'tantalum-maker';
  // Niobium oxide (KYOCERA AVX OxiCap): AVX's catalogue model, under the same part type.
  const nboSeries = /\bNO([JS])[A-EPRTVWY]\d{3}/.exec(`${text} ${fp}`)?.[1];
  const niobium = model === 'capacitor' && (nboSeries || /NIOB|OXICAP/.test(`${text} ${fp}`));
  if (niobium) model = 'tantalum-maker';
  const params = {};
  let inferred = {};
  const why = (what) => `from ${what}`;

  if (model === 'ic') {
    Object.assign(params, { family: null, count: null, power: null, rja: null, package: null });
    const fam = firstMatch(text, IC_FAMILY_RULES);
    if (fam) { params.family = fam; inferred.family = why(`“${c.value || c.description}”`); }
    const pkg = guessIcPackage(c.footprint, c.highestPin);
    Object.assign(params, pkg.params);
    inferred = { ...inferred, ...pkg.inferred };
  } else if (model === 'diode') {
    Object.assign(params, { type: null, power: null, rja: null, package: null });
    const type = firstMatch(text, DIODE_RULES) ?? firstMatch(sym, DIODE_RULES);
    if (type) { params.type = type; inferred.type = why(firstMatch(text, DIODE_RULES) ? `“${[c.value, c.description].filter(Boolean).join(' ')}”` : `the symbol ${c.symbol}`); }
    const pkg = guessDiscretePackage(c.footprint);
    Object.assign(params, pkg.params);
    inferred = { ...inferred, ...pkg.inferred };
    // A Schottky named only as such: a small-signal or a rectifier part by its package.
    if (!type && /SCHOTTKY/.test(`${text} ${sym}`) && pkg.params.package) {
      const sized = SIGNAL_PACKAGES.has(pkg.params.package) ? 'signal' : RECTIFIER_PACKAGES.has(pkg.params.package) ? 'rectifier-lp' : null;
      if (sized) { params.type = sized; inferred.type = `a Schottky diode in a ${pkg.params.package} package`; }
    }
  } else if (model === 'transistor') {
    Object.assign(params, { type: null, stress: null, power: null, rja: null, package: null });
    const pkg = guessDiscretePackage(c.footprint);
    Object.assign(params, pkg.params);
    inferred = { ...inferred, ...pkg.inferred };
    const tech = firstMatch(text, TRANSISTOR_RULES);
    if (tech) {
      const power = POWER_PACKAGES.has(params.package);
      params.type = `${tech}-${power ? 'p' : 'lp'}`;
      inferred.type = `${why(`“${c.value || c.description}”`)}${power ? ' and a power package' : ''}`;
    }
  } else if (model === 'mil-resistor') {
    Object.assign(params, { style: resStyle, power: null });
    inferred.style = why(`“${[c.designator, c.value, c.footprint].filter(Boolean).join(' ')}”`);
  } else if (model === 'mil-capacitor') {
    Object.assign(params, { style: capStyle, capacitance: null, stress: null });
    inferred.style = why(`“${[c.value, c.description, c.footprint].filter(Boolean).join(' ')}”`);
    const cap = parseCapacitance(c.value);
    if (cap != null) { params.capacitance = cap; inferred.capacitance = why(`the value “${c.value}”`); }
  } else if (model === 'tantalum-maker') {
    Object.assign(params, { curve: null, v: null });
    if (niobium) {
      params.curve = 'avx-nbo';
      inferred.curve = why(`“${c.value || c.description}”`);
      params.series = nboSeries ? `NO${nboSeries}` : null;
      const partNumber = [c.description, c.value, c.footprint].find((x) => x && /NO[JS][A-EPRTVWY]\d{3}/i.test(x));
      if (nboSeries) inferred.series = why(`the part number in “${partNumber}”`);
    }
  } else if (model === 'capacitor') {
    params.type = null;
    const both = `${text} ${fpAll}`;
    const type = firstMatch(both, [
      // KiCad's tantalum chips are CP_EIA-3528-21_Kemet-B and the like, in Capacitor_Tantalum_SMD.
      [/TANT|\bTAJ|\bT49\d|\bTPS[A-E]|CASE-?[A-E]\b|CP-?EIA-?\d{4}/, 'tantalum-solid'],
      // …and its electrolytics CP_Radial, CP_Axial and CP_Elec.
      [/\bELEC(?:TROLYTIC)?\b|ALUM|\bELCO|CPOL|CP-?RADIAL|CP-?AXIAL|CP-?ELEC|\bCAPAE|RADIAL.*POL/, 'aluminium-wet'],
      [/\bC0G|\bCOG\b|\bNP0|\bNPO\b/, 'ceramic-1'],
      [/\bX[5-8][RSTP]\b|\bY5V|\bZ5U/, 'ceramic-2'],
    ]);
    const chipText = chipOf(fp) ? `the chip footprint “${c.footprint}”` : CHIP_SIZE.test(text) ? `the chip size in “${c.description || c.value}”` : null;
    if (type) {
      params.type = type;
      inferred.type = why(`“${[c.value, c.description, c.footprint].filter(Boolean).join(' ')}”`);
    } else if (chipText) {
      params.type = 'ceramic-2';
      inferred.type = `assumed class II ceramic from ${chipText}; check the dielectric`;
    }
  } else if (model === 'resistor') {
    Object.assign(params, { type: null, power: null, rated: null, elements: 1 });
    const chip = chipOf(fp) ?? CHIP_SIZE.exec(text)?.[1];
    if (chip) {
      params.type = 'smd';
      inferred.type = why(chipOf(fp) ? `the chip footprint “${c.footprint}”` : `the chip size in “${c.description || c.value}”`);
      params.rated = CHIP_RATING[chip];
      inferred.rated = `typical rating for a ${chip} chip; check the datasheet`;
    } else if (/AXIAL|DIN-?0[2-4]\d{2}|\bR-?PTH/.test(fp)) {
      params.type = 'film-low';
      inferred.type = `assumed low-dissipation film from the footprint “${c.footprint}”`;
    }
    // A stated rating, such as "1/10W" or "0.25W", beats the typical one for the chip size.
    const watts = /(?:^|[^\d.])(\d+)\/(\d+)\s*W\b/.exec(text) ?? /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(M?)W\b/.exec(text);
    if (watts) {
      const w = watts[0].includes('/') ? Number(watts[1]) / Number(watts[2]) : Number(watts[1]) / (watts[2] ? 1000 : 1);
      if (w > 0) { params.rated = +w.toPrecision(4); inferred.rated = why(`“${c.description || c.value}”`); }
    }
    if (['RN', 'RA', 'RP', 'RR'].includes(prefix) || /ARRAY|NETWORK|X4\b|X8\b/.test(`${text} ${fp}`)) {
      params.type = 'smd';
      inferred.type = 'resistor array';
      // "9x1K", "8x10K": the number of resistors.
      const n = /^(\d+)\s*X\s*\d/.exec(norm(c.value))?.[1];
      params.elements = n ? Number(n) : null;
      if (n) inferred.elements = why(`the value “${c.value}”`);
    }
  } else if (model === 'mil-inductive') {
    // Coils and beads are fixed inductors or chokes; a transformer's type cannot be told from the netlist.
    Object.assign(params, { kind: null, dT: null });
    if (prefix !== 'T') {
      params.kind = 'coil-fixed';
      inferred.kind = prefix === 'FB' ? 'a ferrite bead, taken as a fixed choke' : why(`the designator ${c.designator}`);
    }
  } else if (model === 'mil-relay') {
    Object.assign(params, { application: null, stress: null, cycles: null });
  } else if (model === 'mil-connector') {
    params.type = null;
    const type = firstMatch(`${text} ${fp}`, CONNECTOR_RULES);
    if (type) { params.type = type; inferred.type = why(`“${[c.value, c.footprint].filter(Boolean).join(', ')}”`); }
  } else if (model === 'mil-crystal') {
    params.freq = null;
    const m = /(\d+(?:\.\d+)?)\s*(MHZ|KHZ|M\b|K\b)/.exec(norm(c.value).replace(/-/g, ' '));
    if (m) {
      params.freq = Number(m[1]) / (m[2].startsWith('K') ? 1000 : 1);
      inferred.freq = why(`the value “${c.value}”`);
    }
  } else if (model === 'mil-switch') {
    Object.assign(params, { type: null, stress: null });
    const type = firstMatch(`${text} ${fp}`, SWITCH_RULES);
    if (type) { params.type = type; inferred.type = why(`“${[c.value, c.footprint].filter(Boolean).join(', ')}”`); }
  } else if (model === 'mil-opto') {
    Object.assign(params, { type: null, power: null, rja: null });
    const ledSymbol = /:LED/.test(sym) && !/\bLED\b/.test(text);
    const type = prefix === 'LED' || /\bLED\b/.test(text) || LED_FOOTPRINT.test(fpAll) || ledSymbol ? 'led' : firstMatch(text, OPTO_RULES);
    if (type) { params.type = type; inferred.type = ledSymbol ? why(`the symbol ${c.symbol}`) : why(`“${c.value || c.designator}”`); }
  } else if (model === 'mil-fuse') {
    // No inputs beyond the board's environment.
  } else {
    params.fit = null;
    const what = alKind ? `Aluminium ${alKind} capacitor, maker's rate` : family ?? 'Part not modelled yet';
    params.note = `${what}: ${[c.value, c.footprint].filter(Boolean).join(', ') || c.designator}`;
  }
  return { model, params, inferred, source };
}

// ---------------------------------------------------------------------------
// Grouping identical parts into lines

const refKey = (ref) => {
  const m = /^(.*?)(\d+)$/.exec(ref);
  return m ? [m[1], Number(m[2])] : [ref, -1];
};

// "C1, C2, C3, C5" -> "C1–C3, C5"
export function compressRefs(refs) {
  const sorted = [...refs].sort((a, b) => {
    const [pa, na] = refKey(a);
    const [pb, nb] = refKey(b);
    return pa === pb ? na - nb : pa.localeCompare(pb);
  });
  const out = [];
  for (let i = 0; i < sorted.length;) {
    const [p, n] = refKey(sorted[i]);
    let j = i;
    while (j + 1 < sorted.length && n >= 0) {
      const [pn, nn] = refKey(sorted[j + 1]);
      if (pn !== p || nn !== n + (j + 1 - i)) break;
      j++;
    }
    if (j - i >= 2) out.push(`${sorted[i]}–${sorted[j]}`);
    else for (let k = i; k <= j; k++) out.push(sorted[k]);
    i = j + 1;
  }
  return out.join(', ');
}

// "C1–C3, C5" -> ["C1", "C2", "C3", "C5"]; the inverse of compressRefs.
export function expandRefs(text) {
  const out = [];
  for (const token of String(text).split(',').map((t) => t.trim()).filter(Boolean)) {
    const m = /^(.*?)(\d+)\s*[–-]\s*(?:\1)?(\d+)$/.exec(token);
    const [from, to] = m ? [Number(m[2]), Number(m[3])] : [];
    if (m && to >= from && to - from < 10000) for (let n = from; n <= to; n++) out.push(`${m[1]}${n}`);
    else out.push(token);
  }
  return out;
}

const LINE_ORDER = ['ic', 'transistor', 'diode', 'capacitor', 'mil-capacitor', 'tantalum-maker', 'ceramic-test', 'resistor', 'mil-resistor', 'inductor', 'mil-inductive', 'mil-opto', 'mil-relay', 'mil-ssr',
  'mil-switch', 'mil-connector', 'mil-socket', 'mil-crystal', 'mil-fuse', 'mil-lamp', 'mil-pwb', 'fixed'];

// Group classified parts ([{ designator, cls }]) with identical results into lines.
export function groupLines(classified) {
  const groups = new Map();
  for (const { designator, cls } of classified) {
    const key = JSON.stringify([cls.model, cls.params, cls.inferred, cls.source]);
    const g = groups.get(key) ?? { ...cls, refs: [] };
    g.refs.push(designator);
    groups.set(key, g);
  }
  const lines = [...groups.values()].map((g) => ({
    ref: compressRefs(g.refs), qty: g.refs.length, model: g.model, params: g.params, inferred: g.inferred, source: g.source,
  }));
  lines.sort((a, b) => LINE_ORDER.indexOf(a.model) - LINE_ORDER.indexOf(b.model) || a.ref.localeCompare(b.ref, 'en', { numeric: true }));
  return lines;
}

// Parse a netlist and return grouped part lines plus a report.
export function netlistToParts(text) {
  const parsed = isKicadNetlist(text) ? parseKicad(text) : parseProtel(text);
  const classified = [];
  const parallel = new Map();
  const skipped = [];
  const notFitted = [];
  for (const c of parsed.components) {
    // Symbols that are not on the board (simulation sources, sheet notes) are not parts.
    if (c.offBoard) continue;
    if (c.dnp) { notFitted.push(c.designator); continue; }
    const cls = classifyComponent(c);
    if (cls.skip) { skipped.push(c.designator); continue; }
    if (c.source) cls.source = Object.fromEntries(Object.entries({ value: c.value, footprint: c.footprint, ...c.source }).filter(([, v]) => v));
    classified.push({ designator: c.designator, cls });
    // Parts of the same type connected to exactly the same nets are wired in parallel.
    if (c.nets.length >= 2 && cls.model !== 'fixed' && cls.model !== 'ic') {
      const pkey = JSON.stringify([cls.model, c.nets]);
      const pg = parallel.get(pkey) ?? { nets: c.nets, refs: [] };
      pg.refs.push(c.designator);
      parallel.set(pkey, pg);
    }
  }
  const lines = groupLines(classified);
  return {
    format: parsed.format,
    components: parsed.components.length,
    nets: parsed.nets,
    skipped: compressRefs(skipped),
    skippedCount: skipped.length,
    notFitted: compressRefs(notFitted),
    notFittedCount: notFitted.length,
    lines,
    groups: [...parallel.values()].filter((g) => g.refs.length >= 2).map((g) => ({
      refs: compressRefs(g.refs),
      nets: g.nets,
      mode: 'series',
      need: null,
      shortPct: null,
      proposed: `wired in parallel: same part type connected to the same nets (${g.nets.join(', ')})`,
    })),
  };
}
