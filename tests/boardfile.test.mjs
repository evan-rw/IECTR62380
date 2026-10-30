// Board files (assets/boardfile.js) and their import into the Circuit board check.
// tests/fixtures/boards: test-board.kicad_pcb is a small 4-layer board written for these tests (three
// through vias, a blind via, two plated holes, a plated slot, an unplated hole, an SMD pad, and a
// dielectric made of two sub-layers); test-board.xml and test-board-*.drl are KiCad 10's own IPC-2581
// and Excellon exports of it. simplefocmini.pcbdoc is a public Altium ASCII board and DM6010_R2M2E2.PcbDoc
// a public binary one (both MIT; see THIRD_PARTY_NOTICES.md); altium-stackup.PcbDoc and pcad-test.pcb
// (P-CAD ASCII) are written for these tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPage, root } from './_page.mjs';

const { parseBoardFile, boardFormat, laminateFor } = await import(new URL('assets/boardfile.js', root).href);
const board = (name) => readFileSync(new URL(`tests/fixtures/boards/${name}`, root), 'latin1');
const boardBytes = (name) => new Uint8Array(readFileSync(new URL(`tests/fixtures/boards/${name}`, root)));
// "0.3 via plated through ×3": one line per counted hole kind, sorted.
const holes = (r) => r.holes.map((h) => `${h.size} ${h.kind}${h.shape === 'round' ? '' : ` ${h.shape}`} ${h.plated ? 'plated' : 'unplated'} ${h.through ? 'through' : 'partial'} ×${h.count}`).sort();

// A compound file ([MS-CFB]) holding `streams` ({ 'Board6/Data': bytes, … }), each under 4096 bytes and so
// in the mini stream: the header, the directory, the mini sector table, the mini stream and one FAT sector.
// `loop` sends the first stream's second mini sector back to its first.
function compoundFile(streams, { loop = false } = {}) {
  const S = 512;
  const M = 64;
  const END = 0xfffffffe;
  const NONE = 0xffffffff;
  const miniTable = [];
  const placed = [];
  let mini = new Uint8Array(0);
  for (const [path, data] of Object.entries(streams)) {
    const start = miniTable.length;
    const n = Math.max(1, Math.ceil(data.length / M));
    for (let i = 1; i <= n; i++) miniTable.push(i === n ? END : start + i);
    const grown = new Uint8Array((start + n) * M);
    grown.set(mini);
    grown.set(data, start * M);
    mini = grown;
    placed.push({ path, start, size: data.length });
  }
  if (loop) miniTable[1] = 0;
  // The root, then each storage with its stream as its child; the storages are chained to the right.
  const entries = [{ name: 'Root Entry', type: 5, child: 1 }];
  placed.forEach(({ path, start, size }, i) => {
    const [storage, name] = path.split('/');
    const id = entries.length;
    entries.push({ name: storage, type: 1, child: id + 1, right: i < placed.length - 1 ? id + 2 : NONE }, { name, type: 2, start, size });
  });
  const dirSectors = Math.ceil(entries.length / 4);
  const tableSectors = Math.ceil((miniTable.length * 4) / S);
  const miniSectors = Math.ceil(mini.length / S);
  const fatAt = dirSectors + tableSectors + miniSectors;
  Object.assign(entries[0], { start: dirSectors + tableSectors, size: mini.length });
  const out = new Uint8Array(S * (fatAt + 2));
  const dv = new DataView(out.buffer);
  const at = (sector) => S * (sector + 1);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  [[24, 0x3e], [26, 3], [28, 0xfffe], [30, 9], [32, 6]].forEach(([o, v]) => dv.setUint16(o, v, true));
  [[44, 1], [48, 0], [56, 4096], [60, dirSectors], [64, tableSectors], [68, END]].forEach(([o, v]) => dv.setUint32(o, v, true));
  for (let i = 0; i < 109; i++) dv.setUint32(76 + i * 4, i ? NONE : fatAt, true);
  entries.forEach((e, i) => {
    const o = at(0) + i * 128;
    for (let k = 0; k < e.name.length; k++) dv.setUint16(o + k * 2, e.name.charCodeAt(k), true);
    dv.setUint16(o + 64, (e.name.length + 1) * 2, true);
    out[o + 66] = e.type;
    [[68, NONE], [72, e.right ?? NONE], [76, e.child ?? NONE], [116, e.start ?? 0], [120, e.size ?? 0]].forEach(([k, v]) => dv.setUint32(o + k, v, true));
  });
  for (let i = 0; i < (tableSectors * S) / 4; i++) dv.setUint32(at(dirSectors) + i * 4, miniTable[i] ?? NONE, true);
  out.set(mini, at(dirSectors + tableSectors));
  const fat = [];
  for (const n of [dirSectors, tableSectors, miniSectors]) for (let i = 1, s = fat.length; i <= n; i++) fat.push(i === n ? END : s + i);
  fat.push(0xfffffffd);
  for (let i = 0; i < S / 4; i++) dv.setUint32(at(fatAt) + i * 4, fat[i] ?? NONE, true);
  return out;
}

// Altium's binary records, as the reader takes them: lengths in 1/10000 mil.
const join = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
const le32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); return b; };
const units = (mm) => Math.round((mm / 0.0254) * 10000);
const boardBlock = (text, flags = 0) => join(le32((text.length + 1) | (flags << 24)), new TextEncoder().encode(text), [0]);
function altiumPad(mm, { plated = true, shape = null } = {}) {
  const pad = new Uint8Array(120);
  pad[0] = 74; // Multi-Layer
  new DataView(pad.buffer).setInt32(45, units(mm), true);
  pad[60] = plated ? 1 : 0;
  const sizes = new Uint8Array(shape == null ? 0 : 596);
  if (shape != null) sizes[262] = shape;
  return join([2], le32(2), [1, 0x31], le32(0), le32(0), le32(0), le32(pad.length), pad, le32(sizes.length), sizes);
}
function altiumVia(mm, start, end) {
  const via = new Uint8Array(209);
  via[0] = 74;
  new DataView(via.buffer).setInt32(25, units(mm), true);
  [via[29], via[30]] = [start, end];
  return join([3], le32(via.length), via);
}

// KiCad's own statistics for test-board.kicad_pcb (kicad-cli pcb export stats): board thickness 1.5600 mm
// with two 0.01 mm solder masks; 3 through vias of 0.3 mm, 1 blind via of 0.2 mm (F.Cu to In1.Cu),
// 2 plated holes of 1.0 mm, 1 plated slot 0.6 × 1.8 mm, 1 unplated hole of 3.2 mm.
const TEST_BOARD = ['0.2 via plated partial ×1', '0.3 via plated through ×3', '0.6 pad slot plated through ×1', '1 pad plated through ×2', '3.2 pad unplated through ×1'];

test('each file is told by its first bytes and its name; files the page cannot read are named, with what to do', () => {
  assert.equal(boardFormat(board('test-board.kicad_pcb')), 'KiCad');
  assert.equal(boardFormat(board('test-board.xml')), 'IPC-2581');
  assert.equal(boardFormat(board('test-board-PTH.drl'), 'test-board-PTH.drl'), 'Excellon');
  assert.equal(boardFormat(board('simplefocmini.pcbdoc')), 'Altium ASCII');
  assert.equal(boardFormat(board('altium-stackup.PcbDoc')), 'Altium ASCII');
  assert.equal(boardFormat(board('pcad-test.pcb')), 'P-CAD ASCII');
  // A compound file with no Altium board in it, such as CircuitStudio's.
  assert.throws(() => parseBoardFile(compoundFile({ 'Other/Data': new Uint8Array(8) }), 'x.CSPcbDoc'), /holds no Altium board.*NC drill \(Excellon\)/);
  // The other text types on Altium's lists are named, with the one to pick instead.
  assert.throws(() => parseBoardFile('PCB FILE 6 VERSION 2.80\r\n', 'x.pcb'), /Protel PCB 2\.8 ASCII.*"PCB ASCII File \(\*\.PcbDoc\)"/);
  // P-CAD 2006's binary .pcb, as its first bytes read.
  assert.throws(() => parseBoardFile('II\x02\x04 \xb0\x00\r\n\r\n;P-CAD 2006 PCB V19.00.6667\x06\r\nP-CAD 2006 PCB Binary (Rev 6)\r\n\r\n', 'x.PCB'), /binary P-CAD \.pcb.*save a copy as an ASCII file/);
  assert.throws(() => parseBoardFile('hello', 'x.txt'), /not a board file the page can read/);
});

test('KiCad, IPC-2581 and Excellon all give KiCad\'s own hole statistics for the same board', () => {
  const kicad = parseBoardFile(board('test-board.kicad_pcb'), 'test-board.kicad_pcb');
  assert.deepEqual(holes(kicad), TEST_BOARD);
  // Excellon: one file for plated holes, one for unplated, one for the blind via's layer pair.
  const drills = ['test-board-PTH.drl', 'test-board-NPTH.drl', 'test-board-front-in1.drl'].map((f) => parseBoardFile(board(f), f));
  assert.deepEqual(drills.flatMap(holes).sort(), TEST_BOARD);
  // IPC-2581 gives slots without their sizes: counted, and said so.
  const ipc = parseBoardFile(board('test-board.xml'), 'test-board.xml');
  assert.deepEqual(holes(ipc), TEST_BOARD.filter((h) => !h.includes('slot')));
  assert.deepEqual(ipc.notes, ['1 slot (sizes not read).']);
});

test('the stackup: copper and dielectric without the solder mask, sub-layers included, and the laminate', () => {
  // 4 × 0.035 copper + (0.1 + 0.1) + 1.0 + 0.2 dielectric = 1.54 mm, KiCad's 1.56 less two 0.01 mm masks.
  for (const name of ['test-board.kicad_pcb', 'test-board.xml']) {
    const r = parseBoardFile(board(name), name);
    assert.deepEqual([r.thickness.mm, r.thickness.from, r.copperLayers, r.materials], [1.54, 'stack', 4, ['FR4']], name);
  }
  assert.equal(laminateFor(['FR4']), 'fr4');
  assert.equal(laminateFor(['2116 RC58%', 'FR4']), 'fr4', 'a prepreg glass style names no laminate');
  assert.equal(laminateFor(['Isola 370HR', 'FR-4']), null, 'two families: left to the user');
  assert.equal(laminateFor([]), null);
  // A board with no stackup gives its stated thickness.
  const stated = board('test-board.kicad_pcb').replace(/\t\t\(stackup[\s\S]*?\n\t\t\)\n/, '');
  assert.deepEqual(parseBoardFile(stated, 'x.kicad_pcb').thickness, { mm: 1.6, from: 'stated', detail: 'the board thickness in the file' });
});

test('Altium ASCII: vias in bare mils, pads with units, slots, blind vias, and the stackup old and new', () => {
  const r = parseBoardFile(board('altium-stackup.PcbDoc'), 'altium-stackup.PcbDoc');
  assert.deepEqual(holes(r), ['0.2032 via plated partial ×1', '0.3048 via plated through ×2', '0.6 pad slot plated through ×1', '1 pad plated through ×2', '3.2 pad unplated through ×1']);
  // 1.4 + 0.7 + 0.7 + 1.4 mil copper and 7.8 + 40 + 7.8 mil dielectric = 59.8 mil; the solder resist is outside.
  assert.deepEqual([r.thickness.mm, r.copperLayers, r.materials, laminateFor(r.materials)], [1.519, 4, ['Isola 370HR'], 'isola-370hr']);
  // Without Altium's newest stack (V9), the older chain LAYER1 → 39 → 40 → 32 gives the same.
  const old = parseBoardFile(board('altium-stackup.PcbDoc').replace(/^\|RECORD=Board\|V9_STACK.*\n/m, ''), 'x.PcbDoc');
  assert.deepEqual([old.thickness.mm, old.copperLayers, old.materials], [1.519, 4, ['Isola 370HR']]);
  // A genuine export (Nordic's Thingy:91) marks its 1.2 mm core DIELTYPE 2 and parts some records with a
  // lone CR: every dielectric between the outer copper layers counts, and any line ending will do.
  const type2 = board('altium-stackup.PcbDoc').replace('V9_STACK_LAYER4_DIELTYPE=0', 'V9_STACK_LAYER4_DIELTYPE=2');
  assert.equal(parseBoardFile(type2, 'x.PcbDoc').thickness.mm, 1.519);
  const crOnly = parseBoardFile(board('altium-stackup.PcbDoc').replace(/\n/g, '\r'), 'x.PcbDoc');
  assert.deepEqual([holes(crOnly), crOnly.thickness.mm], [holes(r), 1.519]);
  // SimpleFOC Mini (an EasyEDA export): holes, no stackup.
  const mini = parseBoardFile(board('simplefocmini.pcbdoc'), 'simplefocmini.pcbdoc');
  assert.deepEqual(holes(mini), ['0.3 via plated through ×8', '0.3048 via plated through ×42', '1.02 pad plated through ×3', '1.1 pad plated through ×13', '2 pad plated through ×4']);
  assert.equal(mini.thickness, null);
});

test('Excellon in inches with Altium\'s plating line, and a file that does not say', () => {
  const altium = 'M48\n;Layer_Color=9474304\n;FILE_FORMAT=2:5\nINCH,LZ\n;TYPE=PLATED\nT1F00S00C0.0118\nT2F00S00C0.0394\n%\nT01\nX012500Y004500\nX013000Y004500\nT02\nX020000Y010000\nM30\n';
  // 0.0118 in = 0.29972 mm and 0.0394 in = 1.00076 mm, kept to 0.1 µm.
  assert.deepEqual(holes(parseBoardFile(altium, 'board-Plated.TXT')), ['0.2997 hole plated through ×2', '1.0008 hole plated through ×1']);
  const unplated = altium.replace(';TYPE=PLATED', ';TYPE=NON_PLATED');
  assert.deepEqual(holes(parseBoardFile(unplated, 'board.TXT')).map((h) => h.includes('unplated')), [true, true]);
  const silent = parseBoardFile(altium.replace(';TYPE=PLATED\n', ''), 'board.drl');
  assert.deepEqual(silent.notes, ['The drill file does not say whether its holes are plated.']);
});

test('Excellon from Altium: plated and unplated tools in one header, and routed slots', () => {
  // The round holes' file lists the plated tools, then the unplated ones.
  const round = 'M48\n;FILE_FORMAT=2:5\nINCH,LZ\n;TYPE=PLATED\nT1F00S00C0.0059\nT2F00S00C0.0354\n;TYPE=NON_PLATED\nT3F00S00C0.0354\nT4F00S00C0.1181\n%\n'
    + 'T01\nX0010000Y0010000\nX0020000\nT02\nX0030000Y0020000\nT03\nX0040000Y0020000\nT04\nX0050000Y0030000\nM30\n';
  const ROUND = ['0.1499 hole plated through ×2', '0.8992 hole plated through ×1', '0.8992 hole unplated through ×1', '2.9997 hole unplated through ×1'];
  assert.deepEqual(holes(parseBoardFile(round, 'board-RoundHoles.TXT')), ROUND);
  assert.deepEqual(holes(parseBoardFile(round.replace(/\n/g, '\r'), 'board-RoundHoles.TXT')), ROUND, 'lone CR line ends');
  // Each slot is routed: G00 to its start, M15 down, G01 along (further X/Y lines continue the path), M16 up.
  const slots = 'M48\n;FILE_FORMAT=2:5\nINCH,LZ\n;TYPE=PLATED\nT4F00S00C0.0197\n;TYPE=NON_PLATED\n%\nG90\nG05\nT04\n'
    + 'G00X0007000Y0080000\nM15\nG01X0004000\nY0085000\nM16\nG00X0007000Y0110000\nM15\nG01X0004000\nM16\nM17\nM30\n';
  assert.deepEqual(holes(parseBoardFile(slots, 'board-SlotHoles.TXT')), ['0.5004 hole slot plated through ×2']);
});

// The forms below follow drill files from other tools in gerbv's test set (github.com/gerbv/gerbv).
test('Excellon from other tools: units after the header, no header, no %, patterns, Mentor\'s plating line', () => {
  // Veribest: the header names no units; M71 after it says millimetres. The name says plated.
  const veribest = 'M48\nT01C.864\nT02C1.092\n%\nG90\nM71\nG05\nT01\nX40500Y6270\nY3730\nT02\nX37000Y8960\nM30\n';
  assert.deepEqual(holes(parseBoardFile(veribest, 'ThruHolePlated.ncd')), ['0.864 hole plated through ×2', '1.092 hole plated through ×1']);
  // OrCAD: no header at all; each tool is defined where it is first used, in inches.
  const orcad = '%\nT1C0.028F200S100\nX002250Y002300\nX002400Y003850\nT2C0.034F200S100\nX003100Y004100\nM30\n';
  assert.deepEqual(holes(parseBoardFile(orcad, 'thruhole.tap')).map((h) => h.split(' ')[0] + ' ' + h.split(' ').at(-1)), ['0.7112 ×2', '0.8636 ×1']);
  // A header that ends where the first tool is chosen, with no % line; a G85 slot.
  const noPercent = 'M48\nINCH\nT4C0.05\nG05\nT4\nX2.0872Y0.6494G85X2.1463Y0.6494\nX1Y1\nM30\n';
  assert.deepEqual(holes(parseBoardFile(noPercent, 'x.drl')).map((h) => h.replace(/ (un)?plated/, '')), ['1.27 hole slot through ×1', '1.27 hole through ×1']);
  // M25 … M01 records a pattern of hits; each M02 drills it again elsewhere.
  const pattern = 'M48\nINCH,TZ\nT01C0.050\nT02C0.035\n%\nT01\nM25\nX10000Y10000\nX20000Y10000\nT02\nX15000Y15000\nM01\nM02X25000Y0\nM02X0Y25000\nM30\n';
  assert.deepEqual(holes(parseBoardFile(pattern, 'x.exc')).map((h) => h.split(' ')[0] + ' ' + h.split(' ').at(-1)), ['0.889 ×3', '1.27 ×6']);
  // Mentor's job header says what the file holds; its slots are routed.
  const mentor = '; Format  : 3.3 / Absolute / MM / Leading\n; Contents: Thru / Mill / Plated\nM48\nMETRIC,TZ\nT03C0.8000\n%\nM71\nG90\nT03\nG00X2550Y80000\nM15\nG01Y79500\nY80500\nM16\nM30\n';
  assert.deepEqual(holes(parseBoardFile(mentor, 'x.drl')), ['0.8 hole slot plated through ×1']);
  assert.deepEqual(holes(parseBoardFile(mentor.replace('/ Plated', '/ Non-Plated'), 'x.drl')), ['0.8 hole slot unplated through ×1']);
});

test('the other files in a drill set are named when turned away: Gerber artwork and EIA tape code', () => {
  assert.throws(() => parseBoardFile('*\nG04 Mass Parameters ***\n%FSLAX34Y34*%\n%MOIN*%\n', 'board.drd'), /Gerber file .*Import the Excellon drill file/);
  const eia = 'T\x07\x02\x80T\x04\x08\x80#\x01v 2  s k ';
  assert.throws(() => parseBoardFile(eia, 'board.DRL'), /EIA tape code.*\.DRR.*\.TXT/);
  assert.throws(() => parseBoardFile(eia, 'board.bin'), /not a board file the page can read/);
});

test('IPC-2581 in inches', () => {
  const xml = '<?xml version="1.0"?>\n<IPC-2581 revision="C"><Content/><Ecad><CadHeader units="INCH"/>'
    + '<Layer name="TOP" layerFunction="CONDUCTOR" side="TOP"/><Layer name="CORE" layerFunction="DIELCORE"/><Layer name="BOTTOM" layerFunction="CONDUCTOR" side="BOTTOM"/>'
    + '<Stackup overallThickness="0.062"><StackupGroup><StackupLayer layerOrGroupRef="TOP" thickness="0.0014"/><StackupLayer layerOrGroupRef="CORE" thickness="0.059"/><StackupLayer layerOrGroupRef="BOTTOM" thickness="0.0014"/></StackupGroup></Stackup>'
    + '<LayerFeature layerRef="DRILL"><Set><Hole name="H1" diameter="0.0118" platingStatus="VIA" x="0" y="0"/><Hole name="H2" diameter="0.0118" platingStatus="VIA" x="1" y="0"/></Set></LayerFeature></Ecad></IPC-2581>';
  const r = parseBoardFile(xml, 'x.xml');
  assert.deepEqual(holes(r), ['0.2997 via plated through ×2']);
  assert.equal(r.thickness.mm, 1.57);
});

test('IPC-2581 from Altium: SIGNAL copper, drill pairs in <SpanType>, a slot repeated on many layers', () => {
  // As Altium writes them: the slot is on every layer, twice on the through-hole drill layer.
  const slot = '<Set><SlotCavity name="J1-1 Hole" platingStatus="PLATED"><Outline><Polygon><PolyBegin x="5" y="6" /><PolyStepSegment x="5" y="7" /></Polygon></Outline></SlotCavity></Set>';
  const hole = (d, status, x) => `<Set><Hole name="H" diameter="${d}" platingStatus="${status}" x="${x}" y="0" /></Set>`;
  const xml = '<?xml version="1.0"?>\n<IPC-2581 revision="B"><Content/><Ecad><CadHeader units="MILLIMETER"/>'
    + '<Layer name="Top Solder" layerFunction="SOLDERMASK"/><Layer name="Top Layer" layerFunction="SIGNAL" side="TOP"/><Layer name="D1" layerFunction="DIELCORE"/>'
    + '<Layer name="Mid Layer 1" layerFunction="SIGNAL"/><Layer name="D2" layerFunction="DIELCORE"/><Layer name="Bottom Layer" layerFunction="SIGNAL" side="BOTTOM"/>'
    + '<Layer name="Drill Drawing (Top Layer - Bottom Layer)" layerFunction="DOCUMENT"/>'
    + '<Layer name="Drill Guide (Top Layer - Bottom Layer)" layerFunction="DRILL"><SpanType fromLayer="Top Layer" toLayer="Bottom Layer" /></Layer>'
    + '<Layer name="Drill Guide (Top Layer - Mid Layer 1)" layerFunction="DRILL"><SpanType fromLayer="Top Layer" toLayer="Mid Layer 1" /></Layer>'
    + '<Stackup><StackupGroup><StackupLayer layerOrGroupRef="Top Solder" thickness="0.0475"/><StackupLayer layerOrGroupRef="Top Layer" thickness="0.035"/><StackupLayer layerOrGroupRef="D1" thickness="0.1"/>'
    + '<StackupLayer layerOrGroupRef="Mid Layer 1" thickness="0.035"/><StackupLayer layerOrGroupRef="D2" thickness="1.2"/><StackupLayer layerOrGroupRef="Bottom Layer" thickness="0.035"/></StackupGroup></Stackup>'
    + `<LayerFeature layerRef="Top Layer">${slot}</LayerFeature>`
    + `<LayerFeature layerRef="Drill Drawing (Top Layer - Bottom Layer)">${slot}${hole(0.9, 'PLATED', 1)}</LayerFeature>`
    + `<LayerFeature layerRef="Drill Guide (Top Layer - Bottom Layer)">${slot}${slot}${hole(0.15, 'VIA', 1)}${hole(0.15, 'VIA', 2)}${hole(0.9, 'PLATED', 3)}</LayerFeature>`
    + `<LayerFeature layerRef="Drill Guide (Top Layer - Mid Layer 1)">${slot}${hole(0.1, 'VIA', 4)}</LayerFeature></Ecad></IPC-2581>`;
  const r = parseBoardFile(xml, 'x.cvg');
  assert.deepEqual(holes(r), ['0.1 via plated partial ×1', '0.15 via plated through ×2', '0.9 pad plated through ×1']);
  assert.deepEqual([r.thickness.mm, r.thickness.detail, r.copperLayers], [1.405, '3 copper layers and 2 dielectric layers in the stackup', 3]);
  assert.deepEqual(r.notes, ['1 slot (sizes not read).']);
});

test('P-CAD ASCII: holes from the pad and via styles, footprints counted per instance', () => {
  const text = board('pcad-test.pcb');
  const r = parseBoardFile(text, 'pcad-test.pcb');
  // Style names in any case; a footprint's own graphics, its drawing and its SMD pad left aside.
  assert.deepEqual(holes(r), ['0.2 via plated partial ×1', '0.3048 via plated through ×3', '1.016 pad plated through ×7', '3.175 pad unplated through ×1']);
  assert.deepEqual([r.format, r.copperLayers, r.thickness, r.materials, r.noStack], ['P-CAD ASCII', 4, null, [], undefined]);
  assert.deepEqual(r.notes, ['1 footprint names a pattern the file’s library does not hold; its holes are not counted.']);
  // A bare length is in the file's units; one with its own unit keeps it.
  const mm = parseBoardFile(text.replace('(fileUnits Mil)', '(fileUnits mm)'), 'x.pcb');
  assert.deepEqual(holes(mm).map((h) => h.split(' ')[0]), ['0.2', '12', '3.175', '40']);
  // P-CAD's own layer stackup is not read yet.
  const stacked = parseBoardFile(text.replace('\r\n  (multiLayer', '\r\n  (layersStackup (layerStackupData (layerStackupName "Top")))\r\n  (multiLayer'), 'x.pcb');
  assert.match(stacked.noStack, /does not read the layer stackup of a P-CAD file/);
});

test('P-CAD ASCII from Altium\'s export: no plating stated, so pad holes are of unknown plating and the report says so', () => {
  const text = board('pcad-test.pcb').replace('"P-CAD 2006 PCB" "19.02.958"', '"Design Explorer 99 SE" "6.1.0"').replace(/\s*\(isHolePlated False\)/, '');
  const r = parseBoardFile(text, 'x.PCB');
  assert.deepEqual(r.holes.map((h) => `${h.size} ${h.kind} ${h.plated}`), ['0.2 via true', '0.3048 via true', '1.016 pad null', '3.175 pad null']);
  assert.match(r.notes[0], /^The file does not say which holes are plated or which are slots \(Altium’s P-CAD export leaves both out\)/);
});

test('binary Altium .PcbDoc: Altium\'s own drill report for a public board, hole for hole', () => {
  // DM6010_R2M2E2.DRR (Altium's NC drill report, in the same repository): 60 × 0.203 mm round PTH, 4 × 0.5 mm
  // slots PTH, 5 × 0.5 mm rectangles PTH, 8 × 0.7 mm slots PTH, 2 × 0.75 mm and 2 × 1.5 mm round NPTH.
  const r = parseBoardFile(boardBytes('DM6010_R2M2E2.PcbDoc'), 'DM6010_R2M2E2.PcbDoc');
  assert.equal(r.format, 'Altium binary');
  assert.deepEqual(holes(r), ['0.2032 via plated through ×60', '0.5 pad slot plated through ×4', '0.5 pad square plated through ×5', '0.7 pad slot plated through ×8', '0.75 pad unplated through ×2', '1.5 pad unplated through ×2']);
  // The stackup from the Board6 stream, which holds the ASCII file's Board record text.
  assert.deepEqual([r.thickness.mm, r.copperLayers, r.materials], [0.972, 4, ['PP-006', 'Core-038']]);
});

test('binary Altium .PcbDoc: blind and buried vias, square holes, small streams, and damaged files', () => {
  const streams = {
    // Board6 text parted by a lone CR as in a real file; a block flagged binary is passed over.
    'Board6/Data': join(
      boardBlock('|SELECTION=FALSE|V9_STACK_LAYER0_NAME=Top Layer|V9_STACK_LAYER0_COPTHICK=1.4mil|V9_STACK_LAYER1_NAME=Core|V9_STACK_LAYER1_DIELHEIGHT=59mil|V9_STACK_LAYER1_DIELMATERIAL=FR-4\r|RECORD=Board|V9_STACK_LAYER2_NAME=Bottom Layer|V9_STACK_LAYER2_COPTHICK=1.4mil'),
      boardBlock('|V9_STACK_LAYER9_NAME=junk', 1),
    ),
    'Pads6/Data': join(altiumPad(1), altiumPad(1, { shape: 0 }), altiumPad(3.2, { plated: false }), altiumPad(0.6, { shape: 2 }), altiumPad(1.2, { shape: 1 }), altiumPad(0)),
    'Vias6/Data': join(altiumVia(0.3, 1, 32), altiumVia(0.3, 32, 1), altiumVia(0.15, 1, 2), altiumVia(0.1, 2, 3)),
  };
  const r = parseBoardFile(compoundFile(streams), 'x.PcbDoc');
  assert.deepEqual(holes(r), ['0.1 via plated partial ×1', '0.15 via plated partial ×1', '0.3 via plated through ×2', '0.6 pad slot plated through ×1', '1 pad plated through ×2', '1.2 pad square plated through ×1', '3.2 pad unplated through ×1']);
  assert.deepEqual([r.thickness.mm, r.copperLayers, r.materials], [1.57, 2, ['FR-4']]);
  assert.throws(() => parseBoardFile(compoundFile(streams, { loop: true }), 'x.PcbDoc'), /^Error: The file is damaged: a stream loops\.$/);
  assert.throws(() => parseBoardFile(boardBytes('DM6010_R2M2E2.PcbDoc').subarray(0, 4096), 'x.PcbDoc'), /^Error: The file is damaged/);
  assert.throws(() => parseBoardFile(compoundFile({ ...streams, 'Pads6/Data': join(altiumPad(1), [5, 0, 0]) }), 'x.PcbDoc'), /pads in this \.PcbDoc could not be read \(at byte 147\).*Save Copy As/);
  // The ASCII file names the same hole shapes.
  assert.deepEqual(holes(parseBoardFile('|RECORD=Pad|HOLESIZE=40mil|HOLETYPE=1|PLATED=TRUE\r\n', 'x.PcbDoc')), ['1.016 pad square plated through ×1']);
});

test('every reader reports steady progress that ends at 1', () => {
  for (const name of ['test-board.kicad_pcb', 'test-board.xml', 'test-board-PTH.drl', 'simplefocmini.pcbdoc', 'pcad-test.pcb', 'DM6010_R2M2E2.PcbDoc']) {
    const seen = [];
    parseBoardFile(name.endsWith('.PcbDoc') ? boardBytes(name) : board(name), name, (f) => seen.push(f));
    assert.ok(seen.length >= 1 && seen.at(-1) === 1 && seen.every((f, i) => f >= 0 && f <= 1 && (i === 0 || f >= seen[i - 1])), `${name}: ${seen}`);
  }
});

// ---------------------------------------------------------------------------
// On the page

const { $, $$, fire, settle, typeInto, click, choose, window } = await openPage();

async function importBoard(name, text) {
  $('#pcb-report').hidden = true;
  const input = $('#board-file');
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  Object.defineProperty(input, 'files', { value: [{ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }], configurable: true });
  fire(input, 'change');
  for (let i = 0; i < 200 && $('#pcb-report').hidden; i++) await settle(10);
}
const rows = () => $$('#pcb-holes tr[data-hole]');
const cell = (row, key) => $(`[data-cell="${key}"]`, row);

test('a board file fills the Circuit board check: plated through-hole sizes, thickness and laminate, all Guessed', async () => {
  await importBoard('test-board.kicad_pcb', board('test-board.kicad_pcb'));
  // One row per plated, round, through-hole size; the blind via, the slot and the unplated hole are left out.
  assert.deepEqual(rows().map((r) => $('input', r).value), ['0.3 mm: 3 vias', '1 mm: 2 holes']);
  assert.deepEqual(rows().map((r) => $('input', cell(r, 'drill')).value), ['0.3', '1']);
  assert.ok(rows().every((r) => cell(r, 'drill').classList.contains('inferred')));
  assert.match($('input', cell(rows()[0], 'drill')).title, /^Guessed: the finished hole size in test-board\.kicad_pcb; the drilled hole is larger by twice the plating$/);
  assert.ok(rows().every((r) => cell(r, 'plating').classList.contains('missing')), 'plating is not in board files');
  const thickness = $('#pcb .field[data-field="thickness"]');
  assert.equal($('#pcb-thickness').value, '1.54');
  assert.ok(thickness.classList.contains('inferred'));
  assert.equal($('.state-tag', thickness).textContent, 'Guessed');
  assert.match($('#pcb-thickness').title, /4 copper layers and 3 dielectric layers in the stackup of test-board\.kicad_pcb/);
  assert.equal($('#pcb-laminate').value, 'fr4');
  assert.ok($('#pcb .field[data-field="laminate"]').classList.contains('inferred'));
  const report = $('#pcb-report').textContent.replace(/\s+/g, ' ');
  assert.match(report, /Read “test-board\.kicad_pcb” \(KiCad, 4 copper layers, 1\.54 mm, FR4\)\. 2 plated hole sizes added: 0\.3 mm: 3 vias; 1 mm: 2 holes\./);
  assert.match(report, /Left out: 1 unplated hole \(no barrel to crack\); 1 blind or buried via \(the model is for through holes\); 1 plated slot \(the model is for round holes\)\./);
  assert.match(report, /Enter the plating thickness/);
  assert.equal($('[data-act="pcb-confirm-settings"]').hidden, false);
});

test('typing over a guess makes it yours; confirming keeps the reason on record', async () => {
  typeInto($('#pcb-thickness'), 1.6);
  assert.equal($('#pcb .field[data-field="thickness"]').classList.contains('inferred'), false);
  assert.equal($('#pcb-thickness').hasAttribute('title'), false);
  click($('[data-act="pcb-confirm"]', rows()[0]));
  assert.equal(cell(rows()[0], 'drill').classList.contains('inferred'), false);
  assert.ok(cell(rows()[1], 'drill').classList.contains('inferred'), 'only that row');
  click($('[data-act="pcb-confirm-settings"]'));
  assert.equal($('#pcb .field[data-field="laminate"]').classList.contains('inferred'), false);
  assert.equal($('[data-act="pcb-confirm-settings"]').hidden, true);
  await settle(300); // the page saves a quarter of a second after the last change
  const saved = JSON.parse(window.localStorage.getItem('iec62380.board.v1'));
  assert.match(saved.pcb.confirmed.laminate, /dielectric “FR4” in test-board\.kicad_pcb/);
  assert.match(saved.pcb.holes[0].confirmed.drill, /finished hole size/);
  assert.equal(saved.pcb.thickness, 1.6);
});

test('a second board file keeps a thickness you typed, says so, and replaces the hole sizes', async () => {
  choose($('#pcb-laminate'), 'arlon-85n');
  await importBoard('altium-stackup.PcbDoc', board('altium-stackup.PcbDoc'));
  assert.deepEqual(rows().map((r) => $('input', r).value), ['0.305 mm: 2 vias', '1 mm: 2 holes']);
  assert.equal($('#pcb-thickness').value, '1.6');
  assert.equal($('#pcb-laminate').value, 'arlon-85n');
  const report = $('#pcb-report').textContent.replace(/\s+/g, ' ');
  assert.match(report, /\(Altium ASCII, 4 copper layers, 1\.519 mm, Isola 370HR\)/);
  assert.match(report, /Kept your board thickness, 1\.6 mm \(the file gives 1\.519 mm\) and your laminate\./);
  click($('[data-act="dismiss-pcb-report"]'));
  assert.equal($('#pcb-report').hidden, true);
});

test('a P-CAD file from Altium\'s export: its hole sizes, with the plating and the missing stackup said in the report', async () => {
  const text = board('pcad-test.pcb').replace('"P-CAD 2006 PCB" "19.02.958"', '"Design Explorer 99 SE" "6.1.0"').replace(/\s*\(isHolePlated False\)/, '');
  await importBoard('board.PCB', text);
  assert.deepEqual(rows().map((r) => $('input', r).value), ['0.305 mm: 3 vias', '1.016 mm: 7 holes', '3.175 mm: 1 hole']);
  let report = $('#pcb-report').textContent.replace(/\s+/g, ' ');
  assert.match(report, /Read “board\.PCB” \(P-CAD ASCII, 4 copper layers\)\./);
  assert.match(report, /Left out: 1 blind or buried via/);
  assert.match(report, /The file has no layer stackup: enter the board thickness and laminate\./);
  assert.match(report, /every pad hole is taken as a plated round hole/);
  await importBoard('board2.PCB', text.replace('\r\n  (multiLayer', '\r\n  (layersStackup (layerStackupData (layerStackupName "Top")))\r\n  (multiLayer'));
  report = $('#pcb-report').textContent.replace(/\s+/g, ' ');
  assert.match(report, /The page does not read the layer stackup of a P-CAD file yet: enter the board thickness and laminate\./);
  assert.doesNotMatch(report, /The file has no layer stackup/);
});

test('a binary .PcbDoc on the page: its round plated holes, with slots, square and unplated holes left out', async () => {
  await importBoard('DM6010_R2M2E2.PcbDoc', boardBytes('DM6010_R2M2E2.PcbDoc'));
  assert.deepEqual(rows().map((r) => $('input', r).value), ['0.203 mm: 60 vias']);
  const report = $('#pcb-report').textContent.replace(/\s+/g, ' ');
  assert.match(report, /Read “DM6010_R2M2E2\.PcbDoc” \(Altium binary, 4 copper layers, 0\.972 mm, PP-006, Core-038\)\./);
  assert.match(report, /Left out: 4 unplated holes \(no barrel to crack\); 12 plated slots \(the model is for round holes\); 5 plated square holes \(the model is for round holes\)\./);
});
