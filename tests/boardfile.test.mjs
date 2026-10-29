// Board files (assets/boardfile.js) and their import into the Circuit board check.
// tests/fixtures/boards: test-board.kicad_pcb is a small 4-layer board written for these tests (three
// through vias, a blind via, two plated holes, a plated slot, an unplated hole, an SMD pad, and a
// dielectric made of two sub-layers); test-board.xml and test-board-*.drl are KiCad 10's own IPC-2581
// and Excellon exports of it. simplefocmini.pcbdoc is a public Altium ASCII board (MIT; see
// THIRD_PARTY_NOTICES.md); altium-stackup.PcbDoc is written for these tests in the same format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPage, root } from './_page.mjs';

const { parseBoardFile, boardFormat, laminateFor } = await import(new URL('assets/boardfile.js', root).href);
const board = (name) => readFileSync(new URL(`tests/fixtures/boards/${name}`, root), 'latin1');
// "0.3 via plated through ×3": one line per counted hole kind, sorted.
const holes = (r) => r.holes.map((h) => `${h.size} ${h.kind}${h.shape === 'slot' ? ' slot' : ''} ${h.plated ? 'plated' : 'unplated'} ${h.through ? 'through' : 'partial'} ×${h.count}`).sort();

// KiCad's own statistics for test-board.kicad_pcb (kicad-cli pcb export stats): board thickness 1.5600 mm
// with two 0.01 mm solder masks; 3 through vias of 0.3 mm, 1 blind via of 0.2 mm (F.Cu to In1.Cu),
// 2 plated holes of 1.0 mm, 1 plated slot 0.6 × 1.8 mm, 1 unplated hole of 3.2 mm.
const TEST_BOARD = ['0.2 via plated partial ×1', '0.3 via plated through ×3', '0.6 pad slot plated through ×1', '1 pad plated through ×2', '3.2 pad unplated through ×1'];

test('each file is told by its first bytes and its name; a binary .PcbDoc is turned away with what to do', () => {
  assert.equal(boardFormat(board('test-board.kicad_pcb')), 'KiCad');
  assert.equal(boardFormat(board('test-board.xml')), 'IPC-2581');
  assert.equal(boardFormat(board('test-board-PTH.drl'), 'test-board-PTH.drl'), 'Excellon');
  assert.equal(boardFormat(board('simplefocmini.pcbdoc')), 'Altium ASCII');
  assert.equal(boardFormat(board('altium-stackup.PcbDoc')), 'Altium ASCII');
  const binary = String.fromCharCode(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1) + '\0'.repeat(20);
  assert.throws(() => parseBoardFile(binary, 'x.PcbDoc'), /binary Altium \.PcbDoc.*Save Copy As.*PCB ASCII File/);
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
  assert.deepEqual(ipc.notes, ['1 slot (sizes not read)']);
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

test('IPC-2581 in inches', () => {
  const xml = '<?xml version="1.0"?>\n<IPC-2581 revision="C"><Content/><Ecad><CadHeader units="INCH"/>'
    + '<Layer name="TOP" layerFunction="CONDUCTOR" side="TOP"/><Layer name="CORE" layerFunction="DIELCORE"/><Layer name="BOTTOM" layerFunction="CONDUCTOR" side="BOTTOM"/>'
    + '<Stackup overallThickness="0.062"><StackupGroup><StackupLayer layerOrGroupRef="TOP" thickness="0.0014"/><StackupLayer layerOrGroupRef="CORE" thickness="0.059"/><StackupLayer layerOrGroupRef="BOTTOM" thickness="0.0014"/></StackupGroup></Stackup>'
    + '<LayerFeature layerRef="DRILL"><Set><Hole name="H1" diameter="0.0118" platingStatus="VIA" x="0" y="0"/><Hole name="H2" diameter="0.0118" platingStatus="VIA" x="1" y="0"/></Set></LayerFeature></Ecad></IPC-2581>';
  const r = parseBoardFile(xml, 'x.xml');
  assert.deepEqual(holes(r), ['0.2997 via plated through ×2']);
  assert.equal(r.thickness.mm, 1.57);
});

test('every reader reports steady progress that ends at 1', () => {
  for (const name of ['test-board.kicad_pcb', 'test-board.xml', 'test-board-PTH.drl', 'simplefocmini.pcbdoc']) {
    const seen = [];
    parseBoardFile(board(name), name, (f) => seen.push(f));
    assert.ok(seen.length >= 1 && seen.at(-1) === 1 && seen.every((f, i) => f >= 0 && f <= 1 && (i === 0 || f >= seen[i - 1])), `${name}: ${seen}`);
  }
});

// ---------------------------------------------------------------------------
// On the page

const { $, $$, fire, settle, typeInto, click, choose, window } = await openPage();

async function importBoard(name, text) {
  $('#pcb-report').hidden = true;
  const input = $('#board-file');
  Object.defineProperty(input, 'files', { value: [{ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer }], configurable: true });
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
