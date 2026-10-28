import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDelimited, splitDesignators, parseBom, bomToParts, mergeBom } from '../assets/bom.js';
import { MODELS } from '../assets/models.js';

// An Altium-style export: a title row, quoted cells with commas, CRLF line ends.
const ALTIUM = [
  '"Bill of Materials for Demo.PrjPcb"',
  '"Comment","Description","Designator","Footprint","Manufacturer","Manufacturer Part Number","Quantity"',
  '"100nF","CAP CER 0.1UF 50V X7R 0603","C1, C2, C3","C0603","Murata","GRM188R71H104KA93D","3"',
  '"100n","CAP FILM 0.1UF 63V, polyester","C4","C_Rect","WIMA","MKS2C031001A00KSSD","1"',
  '"100uF","CAP ALUM POLY 100UF 16V","C5","CASE_D","Panasonic","16SVPF100M","1"',
  '"DNP","CAP CER 1UF 25V X5R 0603","C9","C0603","","","1"',
  '"10k","RES SMD 10K OHM 1% 1/10W 0603","R1-R3","R0603","Yageo","RC0603FR-0710KL","2"',
  '"0R1","RES 0.1 OHM 1% 1/4W 1206","R4","","","","1"',
  '"10uH","IND FIXED 10UH 1A","L1","","","","1"',
  '"STM32F103C8T6","IC MCU 32BIT 64KB FLASH 48LQFP","U1","LQFP-48","ST","STM32F103C8T6","1"',
  '"TP","Test point","TP1","","","","1"',
  '"","PCB, 4 layers","","","","",""',
].join('\r\n');

test('delimited text: quotes, doubled quotes, separators and a byte-order mark', () => {
  const { delim, rows } = parseDelimited('﻿a,"b, c","say ""hi"""\r\n\r\n1,2,3\n');
  assert.equal(delim, ',');
  assert.deepEqual(rows, [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
  assert.equal(parseDelimited('Ref\tValue\nC1\t1u').delim, '\t');
  assert.equal(parseDelimited('Ref;Value\nC1;1u').delim, ';');
});

test('designators as BOMs write them', () => {
  assert.deepEqual(splitDesignators('C1, C2'), ['C1', 'C2']);
  assert.deepEqual(splitDesignators('C1-C3'), ['C1', 'C2', 'C3']);
  assert.deepEqual(splitDesignators('C1 – C3, c7'), ['C1', 'C2', 'C3', 'C7']);
  assert.deepEqual(splitDesignators('R1;R2 R5'), ['R1', 'R2', 'R5']);
  assert.deepEqual(splitDesignators(''), []);
  assert.deepEqual(splitDesignators('TA-101, R1 - R2'), ['TA-101', 'R1', 'R2'], 'a dash inside a designator is not a range');
});

test('reading a BOM: header after a title row, not-fitted rows, quantity checks', () => {
  const bom = parseBom(ALTIUM);
  assert.deepEqual(bom.columns, {
    designator: 'Designator', quantity: 'Quantity', mpn: 'Manufacturer Part Number', manufacturer: 'Manufacturer',
    description: 'Description', value: 'Comment', footprint: 'Footprint',
  });
  assert.equal(bom.items.length, 8, 'C9 is not fitted and the PCB row has no designator');
  assert.deepEqual(bom.notFitted, ['C9']);
  assert.deepEqual(bom.quantityMismatch, ['R1–R3'], 'three designators, quantity 2');
  assert.equal(bom.noDesignator, 1, 'the PCB row');
  assert.throws(() => parseBom('Part,Value\nfoo,1'), /No designator column/);
  // A DNP column marks parts not fitted; KiCad-style tab-separated export.
  const kicad = parseBom('Reference\tValue\tFootprint\tMPN\tDNP\nC1\t1u\tC_0402\tCL05A105KA5NQNC\t\nC2\t1u\tC_0402\tCL05A105KA5NQNC\tDNP\n');
  assert.deepEqual(kicad.items.map((i) => [i.refs, i.mpn]), [[['C1'], 'CL05A105KA5NQNC']]);
  assert.deepEqual(kicad.notFitted, ['C2']);
});

test('a BOM alone builds the parts, guessing from distributor descriptions', () => {
  const r = bomToParts(ALTIUM);
  const line = (ref) => r.lines.find((l) => l.ref === ref);
  const caps = line('C1–C3');
  assert.deepEqual([caps.model, caps.params.type], ['capacitor', 'ceramic-2']);
  assert.match(caps.inferred.type, /X7R/);
  assert.deepEqual(caps.source, { value: '100nF', footprint: 'C0603', description: 'CAP CER 0.1UF 50V X7R 0603', mpn: 'GRM188R71H104KA93D', manufacturer: 'Murata' });
  // Film goes to the 217F capacitor model, with the capacitance from the value.
  assert.deepEqual([line('C4').model, line('C4').params.style, line('C4').params.capacitance], ['mil-capacitor', 'CFR', 0.1]);
  // An aluminium polymer capacitor has no failure-rate model: the maker's rate is entered.
  assert.deepEqual([line('C5').model, line('C5').params.fit], ['fixed', null]);
  assert.equal(line('C5').params.note, 'Aluminium polymer capacitor, maker\'s rate: 100uF, CASE_D');
  // The stated rating beats the typical one for the chip size.
  const res = line('R1–R3');
  assert.deepEqual([res.model, res.params.type, res.params.rated], ['resistor', 'smd', 0.1]);
  assert.match(res.inferred.type, /chip footprint “R0603”/);
  // With no footprint column entry, the chip size comes from the description.
  assert.deepEqual([line('R4').params.type, line('R4').params.rated], ['smd', 0.25]);
  assert.match(line('R4').inferred.type, /chip size in “RES 0.1 OHM/);
  assert.deepEqual([line('L1').model, line('L1').params.kind], ['mil-inductive', 'coil-fixed']);
  assert.equal(line('U1').model, 'ic');
  assert.equal(r.lines.some((l) => l.ref.includes('C9')), false, 'not fitted');
  assert.equal(r.skipped, 'TP1');
  assert.equal(r.parts, 11);
});

test('a BOM after a netlist: part numbers added, guesses improved, edits kept, lines split', () => {
  let n = 0;
  const id = () => `s${n++}`;
  const defaultsOf = (m) => MODELS[m].defaults;
  const part = (ref, qty, model, params, extra = {}) => ({
    id: id(), ref, qty, model, params: { ...structuredClone(MODELS[model].defaults), ...params }, inferred: {}, confirmed: {}, source: null, ...extra,
  });
  const parts = [
    // As the netlist import leaves them: guesses from chip footprints only.
    part('C1–C4', 4, 'capacitor', { type: 'ceramic-2' }, { inferred: { type: 'assumed class II ceramic from the chip footprint “C_0603”' }, source: { value: '100nF', footprint: 'C_0603' } }),
    part('R1, R2', 2, 'resistor', { type: 'smd', power: 0.01, rated: 0.1, elements: 1 }, { inferred: { type: 'from the chip footprint', rated: 'typical rating for a 0603 chip; check the datasheet' } }),
    part('C6', 1, 'capacitor', { type: 'ceramic-2', rise: 10 }),
    part('C7', 1, 'capacitor', { type: 'ceramic-2' }, { inferred: { type: 'assumed class II ceramic' } }),
    part('U2', 1, 'ic', {}),
  ];
  const bom = parseBom([
    'Designator,Description,Manufacturer Part Number,Manufacturer',
    '"C1, C2, C3",CAP CER 0.1UF 50V X7R 0603,GRM188R71H104KA93D,Murata',
    'C4,CAP CER 100PF 50V C0G 0603,GRM1885C1H101JA01D,Murata',
    '"R1, R2",RES SMD 10K OHM 1% 1/8W 0603,RC0603FR-0710KL,Yageo',
    'C6,CAP FILM 0.1UF 63V,MKS2,WIMA',
    'C7,CAP FILM 0.1UF 63V,MKS2,WIMA',
    'C5,CAP CER 1UF,X,Y',
  ].join('\n'));
  const { parts: out, report } = mergeBom(parts, bom, defaultsOf, id);
  const line = (ref) => out.find((p) => p.ref === ref);
  // C1–C4 is split: C4 has a different BOM row, and turns out to be C0G.
  assert.equal(report.split, 1);
  assert.deepEqual(out.map((p) => p.ref), ['C1–C3', 'C4', 'R1, R2', 'C6', 'C7', 'U2']);
  assert.deepEqual([line('C1–C3').qty, line('C1–C3').params.type, line('C1–C3').source.mpn], [3, 'ceramic-2', 'GRM188R71H104KA93D']);
  assert.match(line('C1–C3').inferred.type, /X7R/);
  assert.deepEqual([line('C4').qty, line('C4').params.type], [1, 'ceramic-1']);
  assert.equal(line('C1–C3').source.value, '100nF', 'netlist values are kept');
  // The stated rating replaces the typical guess; the power the user typed is kept.
  assert.deepEqual([line('R1, R2').params.rated, line('R1, R2').params.power], [0.125, 0.01]);
  // C6 was edited by the user, so it keeps its part type; C7 was not, so it becomes a 217F film capacitor.
  assert.equal(line('C6').model, 'capacitor');
  assert.equal(line('C6').source.mpn, 'MKS2');
  assert.deepEqual([line('C7').model, line('C7').params.style], ['mil-capacitor', 'CFR']);
  assert.deepEqual([report.kept, report.retyped], [1, 1]);
  assert.equal(report.unmatched, 'C5');
  assert.equal(report.notInBom, 'U2');
  assert.equal(report.matched, 5);
});
