import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FAILURE_MODES, deviceTypeFor, failureModesFor, suggestedShortShare } from '../assets/failuremodes.js';
import { MODELS } from '../assets/models.js';
import { IC_FAMILIES, DIODES, TRANSISTORS, CAPACITORS, RESISTORS } from '../assets/tables.js';
import { SWITCHES, OPTOELECTRONICS, CAPACITORS_217F, RESISTORS_217F, INDUCTIVE_217F } from '../assets/tables217f.js';

test('every device\'s mode probabilities sum to 1', () => {
  assert.equal(FAILURE_MODES.size, 88);
  for (const [device, modes] of FAILURE_MODES) {
    const sum = modes.reduce((s, [, a]) => s + a, 0);
    assert.ok(Math.abs(sum - 1) <= 0.021, `${device}: ${sum}`);
  }
});

test('rows checked against the scanned page 7-194', () => {
  assert.deepEqual(FAILURE_MODES.get('Capacitor, Ceramic'), [['Short', 0.49], ['Change in Value', 0.29], ['Open', 0.22]]);
  assert.deepEqual(FAILURE_MODES.get('Connector/Connection'), [['Open', 0.61], ['Poor Contact/Intermittent', 0.23], ['Short', 0.16]]);
  assert.deepEqual(FAILURE_MODES.get('Diode, Rectifier'), [['Short', 0.51], ['Open', 0.29], ['Parameter Change', 0.2]]);
});

test('every part type maps to a device row that exists', () => {
  const cases = [
    ...IC_FAMILIES.rows.map((r) => ['ic', { family: r.id, eos: 'none' }]),
    ['ic', { family: 'mos-digital', eos: 'computer' }],
    ...DIODES.rows.map((r) => ['diode', { type: r.id }]),
    ...TRANSISTORS.rows.map((r) => ['transistor', { type: r.id }]),
    ...CAPACITORS.rows.map((r) => ['capacitor', { type: r.id }]),
    ...RESISTORS.rows.map((r) => ['resistor', { type: r.id, elements: 1 }]),
    ['resistor', { type: 'smd', elements: 8 }],
    ...SWITCHES.types.map((r) => ['mil-switch', { type: r.id }]),
    ...OPTOELECTRONICS.types.map((r) => ['mil-opto', { type: r.id }]),
    ...CAPACITORS_217F.styles.map((r) => ['mil-capacitor', { style: r.id }]),
    ...RESISTORS_217F.styles.map((r) => ['mil-resistor', { style: r.id }]),
    ...INDUCTIVE_217F.kinds.map((r) => ['mil-inductive', { kind: r.id }]),
    ...Object.keys(MODELS).filter((m) => !['ic', 'diode', 'transistor', 'capacitor', 'resistor', 'mil-switch', 'mil-opto', 'mil-capacitor', 'mil-resistor', 'mil-inductive'].includes(m)).map((m) => [m, {}]),
  ];
  for (const [model, p] of cases) {
    const device = deviceTypeFor(model, p);
    if (device !== null) assert.ok(FAILURE_MODES.has(device), `${model} ${JSON.stringify(p)} → ${device}`);
  }
  assert.equal(deviceTypeFor('ic', { family: 'mos-dram', eos: 'none' }), 'Microcircuit, Memory, MOS');
  assert.equal(deviceTypeFor('ic', { family: 'bip-linear', eos: 'none' }), 'Microcircuit, Linear');
  assert.equal(deviceTypeFor('ic', { family: 'mos-digital', eos: 'computer' }), 'Microcircuit, Interface');
  assert.equal(deviceTypeFor('resistor', { type: 'smd', elements: 4 }), 'Resistor, Network');
  assert.equal(deviceTypeFor('mil-crystal', {}), null, 'the table has no crystal row');
  assert.equal(deviceTypeFor('mil-capacitor', { style: 'CFR' }), 'Capacitor, Plastic');
  assert.equal(deviceTypeFor('mil-capacitor', { style: 'CL' }), 'Capacitor, Tantalum, Electrolytic');
  assert.equal(deviceTypeFor('mil-capacitor', { style: 'CV' }), null, 'the table has no ceramic trimmer row');
  assert.equal(deviceTypeFor('mil-resistor', { style: 'RW' }), 'Resistor, Wirewound');
  assert.equal(deviceTypeFor('mil-resistor', { style: 'RJ' }), 'Resistor, Variable');
  assert.equal(deviceTypeFor('mil-resistor', { style: 'RTH' }), null, 'the table has no thermistor row');
  assert.equal(deviceTypeFor('mil-inductive', { kind: 'flyback' }), 'Transformer');
  assert.equal(deviceTypeFor('mil-inductive', { kind: 'coil-fixed' }), 'Coil');
  assert.equal(deviceTypeFor('fixed', {}), null);
});

test('suggested short share: weighted by failure rate, or not offered', () => {
  const cer = { model: 'capacitor', params: { type: 'ceramic-2' } };
  const alu = { model: 'capacitor', params: { type: 'aluminium-wet' } };
  assert.deepEqual(suggestedShortShare([{ ...cer, fit: 1 }, { ...cer, fit: 1 }]), { pct: 49, devices: ['Capacitor, Ceramic'] });
  // (1 × 0.49 + 3 × 0.53) / 4
  assert.equal(suggestedShortShare([{ ...cer, fit: 1 }, { ...alu, fit: 3 }]).pct, 52);
  // Unknown rates: equal weights.
  assert.equal(suggestedShortShare([{ ...cer, fit: 0 }, { ...alu, fit: 3 }]).pct, 51);
  // A member with no row, or a device with no "Short" mode, means no suggestion.
  assert.equal(suggestedShortShare([{ ...cer, fit: 1 }, { model: 'mil-crystal', params: {}, fit: 1 }]), null);
  assert.equal(failureModesFor('mil-switch', { type: 'reed' }), null);
  assert.equal(suggestedShortShare([]), null);
});
