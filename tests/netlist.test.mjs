import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseProtel, classifyComponent, compressRefs, expandRefs, netlistToParts, parseCapacitance } from '../assets/netlist.js';
import { computeComponent, normaliseProfile } from '../assets/models.js';

// Protel 2.0 component block in the layout gEDA/Lepton and Altium write:
// key/value line pairs, unused part fields as "*", empty library fields.
const block = (designator, footprint, value, description = '') => [
  '[', 'DESIGNATOR', designator, 'FOOTPRINT', footprint, 'PARTTYPE', value, 'DESCRIPTION', description,
  'Part Field 1', '*', 'Part Field 2', '*', 'LIBRARYFIELD1', '', 'LIBRARYFIELD2', '', ']',
].join('\r\n');

const PROTEL2 = [
  'PROTEL NETLIST 2.0',
  block('U1', 'Package_QFP:LQFP-48_7x7mm_P0.5mm', 'STM32F103C8T6', 'ARM Cortex-M3 MCU'),
  block('U2', 'SOIC-8_3.9x4.9mm_P1.27mm', '24LC256'),
  block('U3', 'SOT-223-3_TabPin2', 'LM1117-3.3'),
  block('U4', 'QFN-32-1EP_5x5mm_P0.5mm', 'ADC'),
  block('U5', 'SOIC', 'Custom'),
  block('Q1', 'SOT-23', '2N7002'),
  block('Q2', 'TO-220-3_Vertical', 'IRF540N'),
  block('D1', 'D_SOD-123', '1N4148W'),
  block('D2', 'LED_0603_1608Metric', 'LED_Green'),
  block('D3', 'D_SMB', 'SMBJ5.0A'),
  block('C1', 'C_0603_1608Metric', '100nF'),
  block('C2', 'C_0603_1608Metric', '100nF'),
  block('C3', 'C_0603_1608Metric', '100nF'),
  block('C5', 'C_0603_1608Metric', '100nF'),
  block('C4', 'C_0805_2012Metric', '10uF X7R'),
  block('C6', 'CP_Radial_D6.3mm_P2.50mm', '47uF'),
  block('C7', 'CP_Tantalum_Case-B_EIA-3528-21', '22uF'),
  block('R1', 'R_0603_1608Metric', '10k'),
  block('R2', 'R_0603_1608Metric', '10k'),
  block('RN1', 'R_Array_Convex_4x0603', '4x10k'),
  block('L1', 'L_1210_3225Metric', '10uH'),
  block('J1', 'PinHeader_1x04_P2.54mm', 'Conn_01x04'),
  block('Y1', 'Crystal_HC49', '8MHz'),
  block('TP1', 'TestPoint_Pad', 'TP'),
  block('TP2', 'TestPoint_Pad', 'TP'),
  block('MH1', 'MountingHole_3.2mm', 'MountingHole'),
  '(', 'GND', 'U1-8 VSS PWR', 'C1-2 CAPACITOR-2 PASSIVE', 'U5-14 GND PWR', ')',
  '(', 'VCC', 'U1-48 VDD PWR', 'C1-1 CAPACITOR-1 PASSIVE', 'U5-7 VCC PWR', ')',
].join('\r\n');

const byRef = (parts, ref) => parts.lines.find((l) => l.ref === ref);

test('parses Protel 2.0 blocks and nets', () => {
  const p = parseProtel(PROTEL2);
  assert.equal(p.format, 'Protel 2.0');
  assert.equal(p.components.length, 26);
  assert.equal(p.nets, 2);
  const u1 = p.components.find((c) => c.designator === 'U1');
  assert.equal(u1.footprint, 'Package_QFP:LQFP-48_7x7mm_P0.5mm');
  assert.equal(u1.value, 'STM32F103C8T6');
  assert.equal(u1.description, 'ARM Cortex-M3 MCU');
  assert.equal(u1.fields['PART FIELD 1'], '');
  assert.equal(u1.highestPin, 48);
  assert.equal(u1.connectedPins, 2);
});

test('parses Protel 1 blocks', () => {
  const p = parseProtel('[\nR1\n0805\n10k\n\n\n\n]\n[\nU1\nSO-8\nLM358\n\n\n\n]\n(\nGND\nR1-1\nU1-4\n)\n');
  assert.equal(p.format, 'Protel');
  assert.deepEqual(p.components.map((c) => [c.designator, c.footprint, c.value]), [['R1', '0805', '10k'], ['U1', 'SO-8', 'LM358']]);
  const parts = netlistToParts('[\nR1\n0805\n10k\n\n\n\n]\n[\nU1\nSO-8\nLM358\n\n\n\n]\n');
  assert.equal(byRef(parts, 'R1').params.rated, 0.125);
  assert.equal(byRef(parts, 'U1').params.package, 'so');
  assert.equal(byRef(parts, 'U1').params.pins, 8);
});

test('rejects files that are not netlists', () => {
  assert.throws(() => parseProtel('hello\nworld'), /No components found/);
  assert.throws(() => parseProtel('{"parts": []}'), /No components found/);
});

test('compresses reference lists', () => {
  assert.equal(compressRefs(['C1', 'C2', 'C3', 'C5']), 'C1–C3, C5');
  assert.equal(compressRefs(['R10', 'R2', 'R1']), 'R1, R2, R10');
  assert.equal(compressRefs(['C1', 'C2']), 'C1, C2');
  assert.equal(compressRefs(['U1']), 'U1');
  assert.equal(compressRefs(['TP1', 'MH1', 'TP2']), 'MH1, TP1, TP2');
});

test('netlist parts: what is guessed, what is missing', () => {
  const parts = netlistToParts(PROTEL2);
  assert.equal(parts.components, 26);
  assert.equal(parts.skippedCount, 3);
  assert.equal(parts.skipped, 'MH1, TP1, TP2');

  const u1 = byRef(parts, 'U1');
  assert.equal(u1.model, 'ic');
  assert.equal(u1.params.family, 'mos-digital');
  assert.equal(u1.params.package, 'pqfp-7', '7 × 7 mm LQFP maps to the fixed QFP row');
  assert.ok(u1.inferred.family && u1.inferred.package);
  assert.equal(u1.params.count, null);
  assert.equal(u1.params.power, null);

  const u2 = byRef(parts, 'U2');
  assert.deepEqual([u2.params.family, u2.params.package, u2.params.pins], ['mos-eeprom', 'so', 8]);

  const u3 = byRef(parts, 'U3');
  assert.equal(u3.params.family, null, 'LM1117 is not guessed');
  assert.equal(u3.params.package, null, 'SOT-223 has no IC package row');

  const u4 = byRef(parts, 'U4');
  assert.deepEqual([u4.params.package, u4.params.bodyW, u4.params.bodyL], ['diag-four-sides', 5, 5]);

  const u5 = byRef(parts, 'U5');
  assert.equal(u5.params.package, 'so');
  assert.equal(u5.params.pins, 14);
  assert.match(u5.inferred.pins, /highest pin number/);

  assert.deepEqual([byRef(parts, 'Q1').params.type, byRef(parts, 'Q1').params.package], ['mos-lp', 'sot23']);
  assert.deepEqual([byRef(parts, 'Q2').params.type, byRef(parts, 'Q2').params.package], ['mos-p', 'to220']);
  assert.deepEqual([byRef(parts, 'D1').params.type, byRef(parts, 'D1').params.package], ['signal', 'sod123']);
  assert.deepEqual([byRef(parts, 'D3').params.type, byRef(parts, 'D3').params.package], ['tvs-lp', 'smb']);

  const led = byRef(parts, 'D2');
  assert.equal(led.model, 'mil-opto');
  assert.equal(led.params.type, 'led');
  assert.ok(led.inferred.type);

  const caps = byRef(parts, 'C1–C3, C5');
  assert.equal(caps.qty, 4);
  assert.equal(caps.params.type, 'ceramic-2');
  assert.match(caps.inferred.type, /assumed class II/);
  assert.match(byRef(parts, 'C4').inferred.type, /X7R/);
  assert.equal(byRef(parts, 'C6').params.type, 'aluminium-wet');
  assert.equal(byRef(parts, 'C7').params.type, 'tantalum-solid');

  const r = byRef(parts, 'R1, R2');
  assert.deepEqual([r.qty, r.params.type, r.params.rated, r.params.power], [2, 'smd', 0.1, null]);
  const rn = byRef(parts, 'RN1');
  assert.deepEqual([rn.params.type, rn.params.elements], ['smd', null]);

  assert.equal(byRef(parts, 'L1').model, 'inductor');
  const j1 = byRef(parts, 'J1');
  assert.deepEqual([j1.model, j1.params.type], ['mil-connector', 'rectangular']);
  assert.match(j1.inferred.type, /PinHeader/);
  const y1 = byRef(parts, 'Y1');
  assert.deepEqual([y1.model, y1.params.freq], ['mil-crystal', 8]);
  assert.match(y1.inferred.freq, /8MHz/);
});

test('imported parts compute once their missing values are filled', () => {
  const prof = normaliseProfile({ phases: [{ tac: 40, tau: 1, n: 365, dT: 8 }] });
  const parts = netlistToParts(PROTEL2);
  const u1 = byRef(parts, 'U1');
  const before = computeComponent({ model: u1.model, qty: 1, params: u1.params }, prof);
  assert.equal(before.complete, false);
  assert.deepEqual(before.missing, ['count', 'power', 'rja']);
  const after = computeComponent({ model: u1.model, qty: 1, params: { ...u1.params, count: 1e5, power: 0.3, rja: 60 } }, prof);
  assert.equal(after.complete, true);
  assert.ok(after.fit > 0);

  const caps = byRef(parts, 'C1–C3, C5');
  assert.equal(computeComponent({ model: 'capacitor', qty: caps.qty, params: caps.params }, prof).complete, true, 'a guessed value still computes');
});

test('classification ignores designator case and reports mechanical parts', () => {
  assert.deepEqual(classifyComponent({ designator: 'fid1', footprint: '', value: '', description: '' }), { skip: 'mechanical' });
  assert.equal(classifyComponent({ designator: 'c9', footprint: '0402', value: '1nF C0G', description: '' }).params.type, 'ceramic-1');
});

test('expands reference lists back into designators', () => {
  assert.deepEqual(expandRefs('C1–C3, C5'), ['C1', 'C2', 'C3', 'C5']);
  assert.deepEqual(expandRefs('R1-R3'), ['R1', 'R2', 'R3']);
  assert.deepEqual(expandRefs('U1'), ['U1']);
  for (const refs of [['C1', 'C2', 'C3', 'C5'], ['R1', 'R2', 'R10'], ['MH1', 'TP1', 'TP2']]) {
    assert.deepEqual(expandRefs(compressRefs(refs)), refs);
  }
});

test('footprint library prefixes are ignored', () => {
  const c = (footprint) => classifyComponent({ designator: 'U9', footprint, value: '', description: '' }).params;
  assert.deepEqual([c('Package_DIP:DIP-8_W7.62mm').package, c('Package_DIP:DIP-8_W7.62mm').pins], ['pdil', 8]);
  assert.equal(c('Package_SO:SOIC-14_3.9x8.7mm_P1.27mm').pins, 14);
  const r = classifyComponent({ designator: 'R9', footprint: 'Resistor_SMD:R_0402_1005Metric', value: '1k', description: '' }).params;
  assert.equal(r.rated, 0.063);
});

test('relays, fuses, switches and optocouplers map to the MIL-HDBK-217F models', () => {
  const c = (designator, value, footprint = '') => classifyComponent({ designator, footprint, value, description: '' });
  assert.equal(c('K1', 'G5V-1').model, 'mil-relay');
  assert.deepEqual(c('F1', '500mA').params, {});
  assert.equal(c('F1', '500mA').model, 'mil-fuse');
  assert.equal(c('SW1', 'SW_Push', 'SW_PUSH_6mm').params.type, 'pushbutton');
  assert.equal(c('SW2', 'SW_DIP_x04', 'SW_DIP_SPSTx04').params.type, 'dip');
  assert.equal(c('SW3', 'SW_SPDT', 'SW_Slide').params.type, null, 'slide switches have no 217F category');
  assert.equal(c('U9', 'PC817').model, 'ic', 'an optocoupler under U stays an IC');
  assert.equal(c('ISO1', 'PC817').params.type, 'iso-transistor');
  assert.equal(c('J2', 'SMA', 'SMA_Amphenol_132134').params.type, 'rf-coax');
  assert.equal(c('J3', 'RJ45', 'RJ45_Amphenol').params.type, 'telephone');
  assert.equal(c('Y2', '32.768kHz').params.freq, 0.032768);
  assert.equal(c('X1', '16MHz').model, 'fixed', 'X is ambiguous between connector and crystal');
});

test('film, mica and trimmer capacitors go to the MIL-HDBK-217F capacitor model', () => {
  const c = (designator, value, footprint = '') => classifyComponent({ designator, footprint, value, description: '' });
  const film = c('C5', '100nF', 'Capacitor_THT:C_Rect_L7.2mm_W2.5mm_P5.00mm_FKS2_FKP2_MKS2_MKP2');
  assert.equal(film.model, 'mil-capacitor');
  assert.deepEqual(film.params, { style: 'CFR', capacitance: 0.1, stress: null });
  assert.match(film.inferred.style, /C_Rect/);
  assert.match(film.inferred.capacitance, /the value “100nF”/);
  assert.equal(c('C6', '220p MICA').params.style, 'CM');
  assert.equal(c('C7', '5p', 'Capacitor_SMD:C_Trimmer_Murata_TZB4-A').params.style, 'CV');
  assert.equal(c('C8', '100nF', 'C_0603_1608Metric').model, 'capacitor', 'chip ceramics stay on the 62380 model');
  // Capacitance values in the usual spellings.
  const values = { '100nF': 0.1, '4u7': 4.7, '10 pF': 0.00001, '2.2µF/50V': 2.2, '1n5': 0.0015, '47UF 25V': 47, '0,47u': 0.47, C0G: null, '': null };
  for (const [v, uF] of Object.entries(values)) assert.equal(parseCapacitance(v), uF, v);
});
