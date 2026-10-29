import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseProtel, parseKicad, classifyComponent, compressRefs, expandRefs, netlistToParts, parseCapacitance } from '../assets/netlist.js';
import { bomToParts } from '../assets/bom.js';
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
  assert.deepEqual([rn.params.type, rn.params.elements], ['smd', 4], 'four resistors, from the value “4x10k”');
  assert.match(rn.inferred.elements, /4x10k/);

  const l1 = byRef(parts, 'L1');
  assert.deepEqual([l1.model, l1.params.kind, l1.params.dT], ['mil-inductive', 'coil-fixed', null], 'inductors use the 217F model, which has base rates');
  assert.match(l1.inferred.kind, /designator L1/);
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
  assert.equal(c('X1', '16MHz').model, 'mil-crystal', 'a frequency settles X');
  assert.equal(c('X2', '').model, 'fixed', 'otherwise X is ambiguous between connector and crystal');
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

test('wirewound resistors, potentiometers and thermistors go to the MIL-HDBK-217F resistor model', () => {
  const c = (designator, value, footprint = '') => classifyComponent({ designator, footprint, value, description: '' });
  const ww = c('R9', '0R1 5W wirewound', 'R_Axial_Power_L25.0mm');
  assert.equal(ww.model, 'mil-resistor');
  assert.deepEqual(ww.params, { style: 'RW', power: null });
  assert.equal(c('RV1', '10k', 'Potentiometer_Bourns_3296W_Vertical').params.style, 'RJ');
  assert.equal(c('TH1', '10k NTC').params.style, 'RTH');
  assert.equal(c('RT1', 'PTC polyfuse').model, 'fixed', 'a resettable fuse is not a thermistor');
  assert.equal(c('RV2', 'S14K275 varistor').model, 'fixed', 'varistors are not modelled');
  assert.equal(c('R1', '10k', 'R_0603_1608Metric').model, 'resistor', 'chip resistors stay on the 62380 model');
});

// Parts from KiCad's own demo projects (KiCad 10.0.7) that were classified wrongly.
test('KiCad demo parts: the part type follows the part, not a stray word or prefix', () => {
  const c = (designator, value, footprint = '', description = '') => classifyComponent({ designator, footprint, value, description });
  // A manufacturer name is not read as a part type (jetson-agx-thor-baseboard C7, C26).
  const csv = [
    'Refs,Value,Footprint,Qty,Description,Manufacturer,MPN',
    'C7,C_22u_16V_0603,antmicro-footprints:C_0603_1608Metric_EIA,1,SMD Multilayer Ceramic Capacitor,Samsung Electro-Mechanics,CL10A226MO7JZNC',
    'C8,100nF,C_0402_1005Metric,1,"CAP CER 0.1UF 16V X7R 0402",Murata Electronics,GRM155R71C104KA88D',
    'C9,100uF,CP_Radial_D6.3mm_P2.50mm,1,"CAP ALUM 100UF 20% 16V RADIAL",Panasonic Electronic Components,EEU-FR1C101',
    'C10,10uF,C_0805_2012Metric,1,Electrolytic capacitor,,',
  ].join('\n');
  const type = (ref) => bomToParts(csv).lines.find((l) => l.ref === ref).params.type;
  assert.equal(type('C7'), 'ceramic-2', 'assumed from the chip footprint, not aluminium from "Electro"');
  assert.equal(type('C8'), 'ceramic-2');
  assert.equal(type('C9'), 'aluminium-wet');
  assert.equal(type('C10'), 'aluminium-wet');
  // The keyword itself: "Electronics" in a netlist description is not "electrolytic".
  assert.equal(c('C11', '100nF', 'C_0402_1005Metric', 'Murata Electronics X7R').params.type, 'ceramic-2');
  // The manufacturer: Littelfuse makes NTC thermistors, and its name holds "fuse".
  const ntc = bomToParts('Refs,Value,Footprint,Qty,Description,Manufacturer,MPN\nRT1,10k NTC,R_0603_1608Metric,1,NTC thermistor 10k,Littelfuse,0603N103F').lines[0];
  assert.deepEqual([ntc.model, ntc.params.style], ['mil-resistor', 'RTH']);
  // T is a transformer unless the part number is a transistor's (vme-wren T2, T5).
  assert.deepEqual([c('T2', 'BSS138LT1G', 'SOT95P240X110-3N').model, c('T2', 'BSS138LT1G', 'SOT95P240X110-3N').params.type], ['transistor', 'mos-lp']);
  assert.equal(c('T5', 'FDV301N', 'SOT95P240X110-3N').model, 'transistor');
  assert.equal(c('T1', 'ADT2-1T', 'XFMR_MINI-CIRCUITS_CD542').model, 'mil-inductive');
  // Maxim's MAX3430 is a transceiver, not an Altera MAX CPLD (vme-wren IC26).
  assert.equal(c('IC26', 'MAX3430ESA', 'SOIC127P600X175-8N').params.family, null);
  assert.equal(c('U1', 'EPM7128STC100', 'TQFP-100_14x14mm_P0.5mm').params.family, 'mos-cpld');
  assert.equal(c('U2', 'CPLD', '', 'MAX 7000 CPLD').params.family, 'mos-cpld');
  // A pin header or connector footprint is a connector, whatever the designator (kit-dev-coldfire CT101, openair-max CE1).
  assert.equal(c('CT101', 'JUMPER', 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical').model, 'mil-connector');
  assert.equal(c('CE1', 'HC-1.25-8PWT', 'easyeda2kicad:CONN-SMD_HC-1.25-8PWT').model, 'mil-connector');
  // Hardware named by its value or footprint is mechanical (cm5_minima M702, M705; vme-wren B1, NUT5, SCREW1, WASHER1, FTG1).
  assert.deepEqual(c('M702', 'M.2 Solder Nut', 'MountingHole:MountingHole_3mm_Pad'), { skip: 'mechanical' });
  assert.deepEqual(c('M705', 'M.2 Screw'), { skip: 'mechanical' });
  assert.deepEqual(c('B1', 'PLATED_HOLE2.7_PAD5.0', 'MTG270_500'), { skip: 'mechanical' });
  for (const ref of ['NUT5', 'SCREW1', 'WASHER1', 'FTG1']) assert.deepEqual(c(ref, 'BOSSARD_BN628-1241427_v'), { skip: 'mechanical' }, ref);
  // …but only for a designator with no electrical meaning: a connector with mounting holes stays a connector (jetson J18).
  assert.equal(c('J18', 'ASP-218650-01_mounting_holes', 'ASP-218650-01_mounting_holes', 'FMC connector').model, 'mil-connector');
  assert.equal(c('TB1', 'Screw terminal 2P', 'TerminalBlock_Phoenix_MKDS-1,5-2').model, 'mil-connector', 'a screw terminal is a connector, not hardware');
  assert.equal(c('M1', 'Fan 12V').model, 'fixed');
});

test('KiCad demo parts: the footprint names the part when the designator does not', () => {
  const c = (designator, value, footprint = '', description = '') => classifyComponent({ designator, footprint, value, description });
  const kind = (...a) => c(...a).model;
  // Designators that name no part kind (kit-dev-coldfire, vme-wren, cm5_minima, openair-max).
  assert.equal(kind('ABRT_SW101', 'SW_PUSH', 'kit-dev-coldfire:SW_PUSH_SMALL'), 'mil-switch');
  assert.equal(c('LED_RST101', 'LED_RED', 'LED_SMD:LED_1206_3216Metric').params.type, 'led');
  assert.equal(kind('RCAN201', 'R', 'Resistor_SMD:R_0805_2012Metric'), 'resistor');
  assert.equal(kind('BDM_PORT101', 'CONN_13X2', 'Connector_PinHeader_2.54mm:PinHeader_2x13_P2.54mm_Vertical'), 'mil-connector');
  // The full KiCad name ends in "MountingHolesOffset": still a connector, not hardware.
  assert.equal(kind('UARTCAN201', 'DB9', 'Connector_Dsub:DSUB-9_Female_Horizontal_P2.77x2.84mm_EdgePinOffset7.70mm_Housed_MountingHolesOffset9.12mm'), 'mil-connector');
  assert.equal(kind('USB701', 'TYPEC-305-ACP16H458', 'USB-C-SMD_TYPEC-305-ACP16H458'), 'mil-connector');
  assert.equal(kind('OSC1', 'OSC_50MHZ_EPSON_SG-8018CE', 'OSC_EPSON_SG-8018CE'), 'life-test', 'an oscillator module, not a bare crystal');
  assert.equal(kind('TR1', 'XFMR_MINI-CIRCUITS_ADT2-1T', 'XFMR_MINI-CIRCUITS_CD542'), 'mil-inductive');
  assert.equal(kind('TR2', 'ADT2-1T', 'XFMR_MINI-CIRCUITS_CD542'), 'mil-inductive', 'from the footprint alone');
  assert.equal(kind('LV101', 'DS1818', 'Package_TO_SOT_THT:TO-92'), 'fixed', 'a TO-92 can be a transistor or an IC: left to the user');
  // X: a crystal or a connector once the footprint or value says which (interf_u, openair-max, tiny_tapeout).
  assert.equal(kind('X1', '8MHz', 'Crystal:Crystal_HC18-U_Horizontal'), 'mil-crystal');
  assert.equal(kind('X1', 'SMD-5032_2P 14.7456MHZ 20PF', 'OSC-SMD_L5.0-W3.2'), 'mil-crystal');
  assert.equal(kind('X3', 'HDMI', 'Connector_Video:HDMI_A_Molex_208658-1001_Horizontal'), 'mil-connector');
  // LEDs under D by their footprint (cm5_minima D605, tiny_tapeout D1, stickhub D15).
  for (const [value, fp] of [['GREEN', 'LED-SMD_L1.7-W0.6-RD'], ['Yellow', 'LED_SMD:LED_0603_1608Metric'], ['USB', 'Duo_LED_1.6x0.8_Kingbright_APHB1608']]) {
    assert.deepEqual([c('D1', value, fp).model, c('D1', value, fp).params.type], ['mil-opto', 'led'], fp);
  }
  // ESD and TVS families, and Schottkys (cm5_minima, vme-wren, stickhub, jetson, openair-max, pic_programmer).
  for (const v of ['RCLAMP0502BA', 'PUSB3F96X', '0402ESDA-MLP', 'SM712.TCT']) assert.equal(c('D1', v).params.type, 'tvs-lp', v);
  assert.equal(c('D24', '5V', 'D_0402', 'D5V0H1B2LP-7B').params.type, 'tvs-lp');
  assert.equal(c('D1', 'RB521S30T1G', 'D_SOD-523', 'Small Signal Schottky Diode, Single, 30 V, 200 mA').params.type, 'signal');
  assert.equal(c('D4', 'B5817W_C7420328', 'SOD-123_L2.7-W1.6-LS3.7-FD').params.type, 'rectifier-lp');
  assert.deepEqual([c('D10', 'SCHOTTKY', 'Diode_THT:D_DO-35_SOD27_P12.70mm_Horizontal').params.type, c('D11', 'SCHOTTKY', 'Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal').params.type], ['signal', 'rectifier-lp']);
  // Capacitors from KiCad's footprint names (complex_hierarchy C101, cm5_minima C702).
  assert.equal(c('C101', '47uF/63V', 'Capacitor_THT:CP_Axial_L11.0mm_D6.0mm_P18.00mm_Horizontal').params.type, 'aluminium-wet');
  assert.equal(c('C702', '100uF', 'Capacitor_Tantalum_SMD:CP_EIA-3528-21_Kemet-B').params.type, 'tantalum-solid');
  assert.equal(c('C56', '4.7uF', 'CP_EIA-3528-21_Kemet-B_Pad1.50x2.35mm_HandSolder').params.type, 'tantalum-solid', 'without the library name too (video C56)');
  // Resistor arrays and their element count (interf_u RR1, video RR1).
  assert.deepEqual([kind('RR1', '9x1K', 'Resistor_THT:R_Array_SIP10'), c('RR1', '9x1K', 'Resistor_THT:R_Array_SIP10').params.elements], ['resistor', 9]);
  // IPC-7351 names: pins and bodies from the name, not the pitch (multichannel IC1, vme-wren IC3, IC5, IC20, IC33).
  const pkg = (fp) => { const p = c('U1', '', fp).params; return [p.package, p.pins, p.bodyW, p.bodyL]; };
  assert.deepEqual(pkg('SOIC127P600X175-8N'), ['so', 8, undefined, undefined]);
  assert.deepEqual(pkg('SOP65P640X120-24N'), ['tssop', 24, undefined, undefined]);
  assert.deepEqual(pkg('SOP65P400X130-8N'), ['diag-two-rows', 8, undefined, undefined]);
  assert.deepEqual(pkg('QFN50P400X400X80-25N-S280'), ['diag-four-sides', 25, 4, 4]);
  assert.deepEqual(pkg('BGA96C80P9X16_750X1350X120'), ['diag-matrix', 96, 7.5, 13.5]);
  assert.deepEqual(pkg('SOT65P210X110-6N'), ['diag-two-rows', 6, undefined, undefined]);
  // …and chip passives: RESC1608 is metric for an 0603 resistor.
  assert.deepEqual([c('R5', '10k', 'RESC1608X55N').params.type, c('R5', '10k', 'RESC1608X55N').params.rated], ['smd', 0.1]);
});

// A small KiCad netlist in Eeschema's s-expression format, as KiCad 10 writes it.
const KICAD = `(export (version "E")
  (design (source "demo.kicad_sch") (tool "Eeschema 10.0.7"))
  (components
    (comp (ref "R1") (value "10k") (footprint "Resistor_SMD:R_0603_1608Metric")
      (description "Resistor")
      (fields (field (name "MPN") "RC0603FR-0710KL") (field (name "Manufacturer") "Yageo"))
      (libsource (lib "Device") (part "R") (description "Resistor")))
    (comp (ref "C1") (value "22u") (footprint "Capacitor_SMD:C_0805_2012Metric")
      (fields (field (name "Manufacturer") "Samsung Electro-Mechanics") (field (name "MPN") "CL21A226MAQNNNE"))
      (libsource (lib "Device") (part "C") (description "Unpolarized capacitor")))
    (comp (ref "C2") (value "22u") (footprint "Capacitor_SMD:C_0805_2012Metric")
      (fields (field (name "Manufacturer") "Samsung Electro-Mechanics") (field (name "MPN") "CL21A226MAQNNNE"))
      (libsource (lib "Device") (part "C") (description "Unpolarized capacitor")))
    (comp (ref "STATUS1") (value "GREEN") (footprint "my_lib:0603_light")
      (libsource (lib "Device") (part "LED") (description "Light emitting diode")))
    (comp (ref "D1") (value "15V") (footprint "Diode_SMD:D_SOD-323")
      (libsource (lib "Device") (part "D_Zener") (description "")))
    (comp (ref "U1") (value "LM358 \\"dual\\"") (footprint "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm")
      (libsource (lib "Amplifier_Operational") (part "LM358") (description "Dual operational amplifier")))
    (comp (ref "R2") (value "0R") (footprint "Resistor_SMD:R_0603_1608Metric")
      (libsource (lib "Device") (part "R") (description "Resistor"))
      (property (name "dnp")))
    (comp (ref "RT1") (value "10k NTC") (footprint "Resistor_SMD:R_0603_1608Metric")
      (fields (field (name "Manufacturer") "Littelfuse") (field (name "MPN") "0603N103F"))
      (libsource (lib "Device") (part "Thermistor_NTC") (description "Temperature dependent resistor")))
    (comp (ref "MK1") (value "MountingHole") (footprint "MountingHole:MountingHole_3.2mm_M3")
      (libsource (lib "Mechanical") (part "MountingHole") (description "Mounting hole")))
    (comp (ref "V1") (value "5V") (footprint "")
      (libsource (lib "Simulation_SPICE") (part "VDC") (description "Voltage source"))
      (property (name "exclude_from_board"))))
  (nets
    (net (code "1") (name "+5V") (class "Default")
      (node (ref "C1") (pin "1") (pintype "passive")) (node (ref "C2") (pin "1") (pintype "passive"))
      (node (ref "U1") (pin "8") (pintype "power_in")) (node (ref "R1") (pin "1") (pintype "passive")))
    (net (code "2") (name "GND") (class "Default")
      (node (ref "C1") (pin "2") (pintype "passive")) (node (ref "C2") (pin "2") (pintype "passive"))
      (node (ref "U1") (pin "4") (pintype "power_in")) (node (ref "D1") (pin "2") (pintype "passive")))
    (net (code "3") (name "/LED") (class "Default")
      (node (ref "R1") (pin "2") (pintype "passive")) (node (ref "STATUS1") (pin "2") (pintype "passive")))))`;

test('KiCad netlists: parts, fields, symbols, DNP and nets', () => {
  const parsed = parseKicad(KICAD);
  assert.equal(parsed.format, 'KiCad');
  assert.equal(parsed.nets, 3);
  const u1 = parsed.components.find((c) => c.designator === 'U1');
  assert.equal(u1.value, 'LM358 "dual"', 'escaped quotes');
  assert.deepEqual([u1.highestPin, u1.nets], [8, ['+5V', 'GND']]);
  assert.equal(parsed.components.find((c) => c.designator === 'R1').source.mpn, 'RC0603FR-0710KL');

  const r = netlistToParts(KICAD);
  assert.deepEqual([r.components, r.nets, r.skipped, r.notFitted], [10, 3, 'MK1', 'R2']);
  const line = (ref) => r.lines.find((l) => l.ref === ref);
  assert.equal(r.lines.some((l) => l.ref.includes('V1')), false, 'a symbol not on the board is not a part');
  // The manufacturer is kept for the part, but not read for its type.
  assert.deepEqual([line('C1, C2').model, line('C1, C2').params.type, line('C1, C2').source.manufacturer], ['capacitor', 'ceramic-2', 'Samsung Electro-Mechanics']);
  assert.equal(line('R1').source.mpn, 'RC0603FR-0710KL');
  assert.deepEqual([line('RT1').model, line('RT1').params.style], ['mil-resistor', 'RTH'], 'Littelfuse is not a fuse');
  // The symbol names what the designator and footprint do not: an LED, a Zener.
  assert.deepEqual([line('STATUS1').model, line('STATUS1').params.type], ['mil-opto', 'led']);
  assert.equal(line('D1').params.type, 'zener-lp');
  assert.match(line('D1').inferred.type, /symbol Device:D_Zener/);
  assert.deepEqual([line('U1').params.package, line('U1').params.pins], ['so', 8]);
  // C1 and C2 sit on the same two nets: proposed as a parallel block.
  assert.deepEqual(r.groups.map((g) => [g.refs, g.nets]), [['C1, C2', ['+5V', 'GND']]]);
  assert.throws(() => netlistToParts('(export (version "E") (components))'), /No components found in the KiCad netlist/);
});
