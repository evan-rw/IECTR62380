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

// ---------------------------------------------------------------------------
// Parsing

export function parseProtel(text) {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const first = lines.find((l) => l.trim() !== '') ?? '';
  const format = /^PROTEL\s+NETLIST\s+2/i.test(first.trim()) ? 'Protel 2.0' : 'Protel';
  const components = [];
  const pins = new Map(); // designator -> { count, max }
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
      for (const node of block.slice(1)) {
        const token = node.split(/\s+/)[0];
        const dash = token.lastIndexOf('-');
        if (dash <= 0) continue;
        const ref = token.slice(0, dash);
        const pin = token.slice(dash + 1);
        const entry = pins.get(ref) ?? { count: 0, max: 0 };
        entry.count++;
        if (/^\d+$/.test(pin)) entry.max = Math.max(entry.max, Number(pin));
        pins.set(ref, entry);
      }
    }
  }

  if (!components.length) {
    throw new Error('No components found. Export the netlist in Protel or Protel 2 format.');
  }
  for (const c of components) {
    const p = pins.get(c.designator);
    c.connectedPins = p?.count ?? 0;
    c.highestPin = p?.max ?? 0;
  }
  return { format, components, nets };
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
  R: 'resistor', RN: 'resistor', RA: 'resistor', RP: 'resistor',
  L: 'inductor', FB: 'inductor', T: 'inductor',
};

// Parts with no failure rate of their own.
const MECHANICAL = new Set(['TP', 'MH', 'H', 'FID', 'FD', 'MTG', 'HOLE', 'LOGO', 'MP', 'NT']);

// Families the calculator does not model yet, for the note on an "Other" part.
const OTHER_FAMILY = {
  J: 'Connector (clause 16)', P: 'Connector (clause 16)', CN: 'Connector (clause 16)', CON: 'Connector (clause 16)',
  X: 'Connector or crystal (clause 16 or 13)', Y: 'Crystal or resonator (clause 13)', XTAL: 'Crystal or resonator (clause 13)',
  F: 'Fuse (clause 18)', FU: 'Fuse (clause 18)',
  K: 'Relay (clause 14)', RLY: 'Relay (clause 14)', RL: 'Relay (clause 14)',
  SW: 'Switch (clause 15)', S: 'Switch (clause 15)',
  BT: 'Battery (clause 19)', B: 'Battery (clause 19)',
  LED: 'LED (clause 9)', DS: 'LED or display (clauses 9, 17)',
  RV: 'Varistor or potentiometer (clauses 18, 11)', VR: 'Potentiometer or regulator',
  RT: 'Thermistor (clauses 10, 18)', TH: 'Thermistor (clauses 10, 18)',
  OK: 'Optocoupler (clause 8.6)', OC: 'Optocoupler (clause 8.6)', ISO: 'Optocoupler (clause 8.6)',
  M: 'Motor or fan (clause 19)', FAN: 'Fan (clause 19)', FL: 'Filter',
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

// Guess an IC package (Tables 17a-17b) from the footprint name.
function guessIcPackage(footprint, highestPin) {
  const fp = fpName(footprint);
  const params = {};
  const inferred = {};
  const why = `from footprint “${footprint}”`;
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
  } else if (/DFN|SON\b|MSOP|VSSOP|SOT-?23|SC-?70|TSOT/.test(fp)) {
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

const CHIP_SIZE = /(?:^|[^0-9])(0201|0402|0603|0805|1206|1210|1812|2010|2512)(?![0-9])/;
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
  [/\bCPLD|\bMAX\s?[2-9]\d{3}|\bXC95/, 'mos-cpld'],
  [/\bFPGA|\bXC[67]|\bEP[234]C|\bICE40|\bLFE/, 'mos-lca'],
  [/MICROCONTROLLER|MICROPROCESSOR|\bMCU\b|\bCPU\b|\bDSP|\bSTM32|\bSTM8|\bATMEGA|\bATTINY|\bATSAM|\bPIC\d|\bDSPIC|\bMSP430|\bNRF5|\bESP32|\bRP2040|\bLPC\d|\bMK[LV]?\d|\bS32K|\bTMS320/, 'mos-digital'],
  [/\b74(?:HC|HCT|AHC|LVC|LV|AC|ACT|ALVC|AUP|VHC)\d|\bCD4\d{3}/, 'mos-digital'],
];

const DIODE_RULES = [
  [/\bLED\b/, 'led'],
  [/ZENER|\bBZ[XTV]|\bMMSZ|\bMM3Z|\bPLVA|\bUDZ/, 'zener-lp'],
  [/\bTVS|\bSM[ABC]J|\bP[46]KE|\bP4SMA|\bSMF\d|\bESD|\bPESD|\bTPD\d|\bSP\d{4}/, 'tvs-lp'],
  [/\b1N4148|\b1N914|\bBA[SVW]\d|\bBAT\d|\bLL4148/, 'signal'],
  [/RECTIFIER|\b1N400\d|\b1N540\d|\bS[1-3][A-M]\b|\bUS1|\bES[1-3]|\bSS[1-3]\d|\bMBRS?[1-3]\d|\bB[1-3]\d0\b|\bM[1-7]\b/, 'rectifier-lp'],
];

const TRANSISTOR_RULES = [
  [/MOSFET|\bFET\b|\b2N7002|\bBSS\d|\bIRF|\bIRL|\bSI[23]\d{3}|\bAO\d{4}|\bDM[GNP]\d|\bNTR\d|\bBSH\d|\bFD[NVS]\d|\bBSC\d|\bIPB\d|\bSTP\d/, 'mos'],
  [/\bBJT\b|\bNPN\b|\bPNP\b|\b2N(?:3904|3906|2222|2907|4401|4403)|\bBC\d{3}|\bMMBT|\bPMBT|\bBC[PX]\d|\bBF[RS]\d|\bMJD|\bTIP\d|\bPBSS|\bZXT/, 'bip'],
];

const POWER_PACKAGES = new Set(['to220', 'to247', 'to218', 'd2pak', 'dpak', 'isotop', 'sot32']);

// Turn one netlist component into { model, params, inferred, source, note }
// or { skip: reason } for mechanical items.
export function classifyComponent(c) {
  const prefix = prefixOf(c.designator);
  const source = { value: c.value, footprint: c.footprint, description: c.description };
  const text = norm(`${c.value} ${c.description}`);
  const fp = fpName(c.footprint);
  if (MECHANICAL.has(prefix)) return { skip: 'mechanical' };

  let model = PREFIX_MODEL[prefix] ?? 'fixed';
  let family = OTHER_FAMILY[prefix];
  if (model === 'diode' && firstMatch(text, DIODE_RULES) === 'led') {
    model = 'fixed';
    family = OTHER_FAMILY.LED;
  }
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
    const type = firstMatch(text, DIODE_RULES);
    if (type) { params.type = type; inferred.type = why(`“${c.value || c.description}”`); }
    const pkg = guessDiscretePackage(c.footprint);
    Object.assign(params, pkg.params);
    inferred = { ...inferred, ...pkg.inferred };
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
  } else if (model === 'capacitor') {
    params.type = null;
    const both = `${text} ${fp}`;
    const type = firstMatch(both, [
      [/TANT|\bTAJ|\bT49\d|\bTPS[A-E]|CASE-?[A-E]\b/, 'tantalum-solid'],
      [/ELEC|ALUM|\bELCO|CPOL|CP-?RADIAL|\bCAPAE|RADIAL.*POL/, 'aluminium-wet'],
      [/\bC0G|\bCOG\b|\bNP0|\bNPO\b/, 'ceramic-1'],
      [/\bX[5-8][RSTP]\b|\bY5V|\bZ5U/, 'ceramic-2'],
    ]);
    if (type) {
      params.type = type;
      inferred.type = why(`“${[c.value, c.description, c.footprint].filter(Boolean).join(' ')}”`);
    } else if (CHIP_SIZE.test(fp)) {
      params.type = 'ceramic-2';
      inferred.type = `assumed class II ceramic from the chip footprint “${c.footprint}”; check the dielectric`;
    }
  } else if (model === 'resistor') {
    Object.assign(params, { type: null, power: null, rated: null, elements: 1 });
    const chip = CHIP_SIZE.exec(fp)?.[1];
    if (chip) {
      params.type = 'smd';
      inferred.type = why(`the chip footprint “${c.footprint}”`);
      params.rated = CHIP_RATING[chip];
      inferred.rated = `typical rating for a ${chip} chip; check the datasheet`;
    } else if (/AXIAL|DIN-?0[2-4]\d{2}|\bR-?PTH/.test(fp)) {
      params.type = 'film-low';
      inferred.type = `assumed low-dissipation film from the footprint “${c.footprint}”`;
    }
    if (['RN', 'RA', 'RP'].includes(prefix) || /ARRAY|NETWORK|X4\b|X8\b/.test(`${text} ${fp}`)) {
      params.type = 'smd';
      inferred.type = 'resistor array';
      params.elements = null;
    }
  } else if (model === 'inductor') {
    Object.assign(params, { l0: null, ploss: null, area: null });
  } else {
    params.fit = null;
    params.note = `${family ?? 'Part not modelled yet'}: ${[c.value, c.footprint].filter(Boolean).join(', ') || c.designator}`;
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

// Parse a netlist and return grouped part lines plus a report.
export function netlistToParts(text) {
  const parsed = parseProtel(text);
  const groups = new Map();
  const skipped = [];
  for (const c of parsed.components) {
    const cls = classifyComponent(c);
    if (cls.skip) { skipped.push(c.designator); continue; }
    const key = JSON.stringify([cls.model, cls.params, cls.inferred, cls.source]);
    const g = groups.get(key) ?? { ...cls, refs: [] };
    g.refs.push(c.designator);
    groups.set(key, g);
  }
  const lines = [...groups.values()].map((g) => ({
    ref: compressRefs(g.refs), qty: g.refs.length, model: g.model, params: g.params, inferred: g.inferred, source: g.source,
  }));
  const order = ['ic', 'transistor', 'diode', 'capacitor', 'resistor', 'inductor', 'fixed'];
  lines.sort((a, b) => order.indexOf(a.model) - order.indexOf(b.model) || a.ref.localeCompare(b.ref, 'en', { numeric: true }));
  return {
    format: parsed.format,
    components: parsed.components.length,
    nets: parsed.nets,
    skipped: compressRefs(skipped),
    skippedCount: skipped.length,
    lines,
  };
}
