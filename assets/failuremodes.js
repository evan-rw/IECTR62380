// Failure mode distributions: how a part's failures split between modes
// (short, open, drift…). From MIL-HDBK-338B (1 October 1998, "approved for
// public release; distribution is unlimited"), Table 7.8-1, which reproduces
// the Reliability Analysis Center's FMD-91. Generated from the handbook's text
// layer; each device's probabilities sum to 1 within ±0.02, and page 7-194
// was compared against a rendering of the scan.

import { CAPACITORS_217F, RESISTORS_217F } from './tables217f.js';

export const FAILURE_MODE_SOURCE = {
  label: 'MIL-HDBK-338B, Electronic Reliability Design Handbook, Table 7.8-1 (from RAC FMD-91), public release',
  url: 'https://www.klabs.org/DEI/References/design_guidelines/content/mil_specs/mil_hdbk_338b.pdf',
};

// [device type, [[failure mode, probability α], ...]]
export const FAILURE_MODES = new Map([
  ["Accumulator", [["Leaking", 0.47], ["Seized", 0.23], ["Worn", 0.2], ["Contaminated", 0.1]]],
  ["Actuator", [["Spurious Position Change", 0.36], ["Binding", 0.27], ["Leaking", 0.22], ["Seized", 0.15]]],
  ["Alarm", [["False Indication", 0.48], ["Failure to Operate", 0.29], ["Spurious Operation", 0.18], ["Degraded Alarm", 0.05]]],
  ["Antenna", [["No Transmission", 0.54], ["Signal Leakage", 0.21], ["Spurious Transmission", 0.25]]],
  ["Battery, Lithium", [["Degraded Output", 0.78], ["Startup Delay", 0.14], ["Short", 0.06], ["Open", 0.02]]],
  ["Battery, Lead Acid", [["Degraded Output", 0.7], ["Short", 0.2], ["Intermittent Output", 0.1]]],
  ["Battery, Ni-Cd", [["Degraded Output", 0.72], ["No Output", 0.28]]],
  ["Bearing", [["Binding/Sticking", 0.5], ["Excessive Play", 0.43], ["Contaminated", 0.07]]],
  ["Belt", [["Excessive Wear", 0.75], ["Broken", 0.25]]],
  ["Brake", [["Excessive Wear", 0.56], ["Leaking", 0.23], ["Scored", 0.11], ["Corroded", 0.05], ["Loose", 0.05]]],
  ["Bushing", [["Excessive Wear", 0.85], ["Loose", 0.11], ["Cracked", 0.04]]],
  ["Cable", [["Short", 0.45], ["Excessive Wear", 0.36], ["Open", 0.19]]],
  ["Capacitor, Aluminum, Electrolytic", [["Short", 0.53], ["Open", 0.35], ["Electrolyte Leak", 0.1], ["Decrease in Capacitance", 0.02]]],
  ["Capacitor, Ceramic", [["Short", 0.49], ["Change in Value", 0.29], ["Open", 0.22]]],
  ["Capacitor, Mica/Glass", [["Short", 0.72], ["Change in Value", 0.15], ["Open", 0.13]]],
  ["Capacitor, Paper", [["Short", 0.63], ["Open", 0.37]]],
  ["Capacitor, Plastic", [["Open", 0.42], ["Short", 0.4], ["Change in Value", 0.18]]],
  ["Capacitor, Tantalum", [["Short", 0.57], ["Open", 0.32], ["Change in Value", 0.11]]],
  ["Capacitor, Tantalum, Electrolytic", [["Short", 0.69], ["Open", 0.17], ["Change in Value", 0.14]]],
  ["Capacitor, Variable, Piston", [["Change in Value", 0.6], ["Short", 0.3], ["Open", 0.1]]],
  ["Circuit Breaker", [["Opens Without Stimuli", 0.51], ["Does Not Open", 0.49]]],
  ["Clutch", [["Binding/Sticking", 0.56], ["Slippage", 0.24], ["No Movement", 0.2]]],
  ["Coil", [["Short", 0.42], ["Open", 0.42], ["Change in Value", 0.16]]],
  ["Connector/Connection", [["Open", 0.61], ["Poor Contact/Intermittent", 0.23], ["Short", 0.16]]],
  ["Counter Assembly", [["Inaccurate Count", 0.91], ["Seized", 0.09]]],
  ["Diode, General", [["Short", 0.49], ["Open", 0.36], ["Parameter Change", 0.15]]],
  ["Diode, Rectifier", [["Short", 0.51], ["Open", 0.29], ["Parameter Change", 0.2]]],
  ["Diode, SCR", [["Short", 0.98], ["Open", 0.02]]],
  ["Diode, Small Signal", [["Parameter Change", 0.58], ["Open", 0.24], ["Short", 0.18]]],
  ["Diode, Thyristor", [["Failed Off", 0.45], ["Short", 0.4], ["Open", 0.1], ["Failed On", 0.05]]],
  ["Diode, Triac", [["Failed Off", 0.9], ["Failed On", 0.1]]],
  ["Diode, Zener, Voltage Reference", [["Parameter Change", 0.69], ["Open", 0.18], ["Short", 0.13]]],
  ["Diode, Zener, Voltage Regulator", [["Open", 0.45], ["Parameter Change", 0.35], ["Short", 0.2]]],
  ["Electric Motor, AC", [["Winding Failure", 0.31], ["Bearing Failure", 0.28], ["Fails to Run, After Start", 0.23], ["Fails to Start", 0.18]]],
  ["Fuse", [["Fails to Open", 0.49], ["Slow to Open", 0.43], ["Premature Open", 0.08]]],
  ["Gear", [["Excessive Wear", 0.54], ["Binding/Sticking", 0.46]]],
  ["Generator", [["Degraded Output", 0.6], ["No Output", 0.22], ["Fails to Run, After Start", 0.09], ["Loss of Control", 0.09]]],
  ["Hybrid Device", [["Open Circuit", 0.51], ["Degraded Output", 0.26], ["Short Circuit", 0.17], ["No Output", 0.06]]],
  ["Injector", [["Corroded", 0.87], ["Deformed", 0.08], ["Cracked/Fractured", 0.05]]],
  ["Keyboard Assembly", [["Spring Failure", 0.32], ["Contact Failure", 0.3], ["Connection Failure", 0.3], ["Lock-up", 0.08]]],
  ["Lamp/Light", [["No Illumination", 0.67], ["Loss of Illumination", 0.33]]],
  ["Liquid Crystal Display", [["Dim Rows", 0.39], ["Blank Display", 0.22], ["Flickering Rows", 0.2], ["Missing Elements", 0.19]]],
  ["Mechanical Filter", [["Leaking", 0.67], ["Clogged", 0.33]]],
  ["Meter", [["Faulty Indication", 0.51], ["Unable to Adjust", 0.23], ["Open", 0.14], ["No Indication", 0.12]]],
  ["Microcircuit, Digital, Bipolar", [["Output Stuck High", 0.28], ["Output Stuck Low", 0.28], ["Input Open", 0.22], ["Output Open", 0.22]]],
  ["Microcircuit, Digital, MOS", [["Input Open", 0.36], ["Output Open", 0.36], ["Supply Open", 0.12], ["Output Stuck Low", 0.09], ["Output Stuck High", 0.08]]],
  ["Microcircuit, Interface", [["Output Stuck Low", 0.58], ["Output Open", 0.16], ["Input Open", 0.16], ["Supply Open", 0.1]]],
  ["Microcircuit, Linear", [["Improper Output", 0.77], ["No Output", 0.23]]],
  ["Microcircuit, Memory, Bipolar", [["Slow Transfer of Data", 0.79], ["Data Bit Loss", 0.21]]],
  ["Microcircuit, Memory, MOS", [["Data Bit Loss", 0.34], ["Short", 0.26], ["Open", 0.23], ["Slow Transfer of Data", 0.17]]],
  ["Microwave Amplifier", [["No Output", 0.9], ["Limited Voltage Gain", 0.1]]],
  ["Microwave, Connector", [["High Insertion Loss", 0.8], ["Open", 0.2]]],
  ["Microwave Detector", [["Power Loss", 0.9], ["No Output", 0.1]]],
  ["Microwave, Diode", [["Open", 0.6], ["Parameter Change", 0.28], ["Short", 0.12]]],
  ["Microwave Filter", [["Center Frequency Drift", 0.8], ["No Output", 0.2]]],
  ["Microwave Mixer", [["Power Decrease", 0.9], ["Loss of Intermediate Frequency", 0.1]]],
  ["Microwave Modulator", [["Power Loss", 0.9], ["No Output", 0.1]]],
  ["Microwave Oscillator", [["No Output", 0.8], ["Untuned Frequency", 0.1], ["Reduced Power", 0.1]]],
  ["Microwave VCO", [["No Output", 0.8], ["Untuned Frequency", 0.15], ["Reduced Power", 0.05]]],
  ["Optoelectronic LED", [["Open", 0.7], ["Short", 0.3]]],
  ["Optoelectronic Sensor", [["Short", 0.5], ["Open", 0.5]]],
  ["Power Supply", [["No Output", 0.52], ["Incorrect Output", 0.48]]],
  ["Printed Wiring Assembly", [["Open", 0.76], ["Short", 0.24]]],
  ["Pump, Centrifugal", [["No Output", 0.67], ["Degraded Output", 0.33]]],
  ["Pump, Hydraulic", [["Leaking", 0.82], ["Improper Flow", 0.12], ["No Flow", 0.06]]],
  ["Relay", [["Fails to Trip", 0.55], ["Spurious Trip", 0.26], ["Short", 0.19]]],
  ["Resistor, Composition", [["Parameter Change", 0.66], ["Open", 0.31], ["Short", 0.03]]],
  ["Resistor, Film", [["Open", 0.59], ["Parameter Change", 0.36], ["Short", 0.05]]],
  ["Resistor, Wirewound", [["Open", 0.65], ["Parameter Change", 0.26], ["Short", 0.09]]],
  ["Resistor, Network", [["Open", 0.92], ["Short", 0.08]]],
  ["Resistor, Variable", [["Open", 0.53], ["Erratic Output", 0.4], ["Short", 0.07]]],
  ["Rotary Switch", [["Improper Output", 0.53], ["Contact Failure", 0.47]]],
  ["Software", [["Design Changes", 0.46], ["Design Errors", 0.41], ["User Error", 0.07], ["Documentation Error", 0.06]]],
  ["Solenoid", [["Short", 0.52], ["Slow Movement", 0.43], ["Open", 0.05]]],
  ["Switch, Push-button", [["Open", 0.6], ["Sticking", 0.33], ["Short", 0.07]]],
  ["Switch, Thermal", [["Parameter Change", 0.63], ["Open", 0.27], ["No Control", 0.08], ["Short", 0.02]]],
  ["Switch, Toggle", [["Open", 0.65], ["Sticking", 0.19], ["Short", 0.16]]],
  ["Synchro", [["Winding Failure", 0.45], ["Bearing Failure", 0.33], ["Brush Failure", 0.22]]],
  ["Transducer", [["Out of Tolerance", 0.68], ["False Response", 0.15], ["Open", 0.12], ["Short", 0.05]]],
  ["Transformer", [["Open", 0.42], ["Short", 0.42], ["Parameter Change", 0.16]]],
  ["Transistor, Bipolar", [["Short", 0.73], ["Open", 0.27]]],
  ["Transistor, FET", [["Short", 0.51], ["Output Low", 0.22], ["Parameter Change", 0.17], ["Open", 0.05], ["Output High", 0.05]]],
  ["Transistor, GaAs FET", [["Open", 0.61], ["Short", 0.26], ["Parameter Change", 0.13]]],
  ["Transistor, R.F.", [["Parameter Change", 0.5], ["Short", 0.4], ["Open", 0.1]]],
  ["Tube, Traveling Wave", [["Reduced Output Power", 0.71], ["High Helix Current", 0.11], ["Gun Failure", 0.09], ["Open Helix", 0.09]]],
  ["Valve, Hydraulic", [["Leaking", 0.77], ["Stuck Closed", 0.12], ["Stuck Open", 0.11]]],
  ["Valve, Pneumatic", [["Leaking", 0.28], ["Stuck Open", 0.2], ["Stuck Closed", 0.2], ["Spurious Opening", 0.16], ["Spurious Closing", 0.16]]],
  ["Valve, Relief", [["Premature Open", 0.77], ["Leaking", 0.23]]],
]);

// The 338B device type that best matches one of the calculator's parts, or
// null when the table has no matching row.
const IC_DEVICE = (family) => {
  if (/^gaas/.test(family)) return null;
  if (/^(mos|bicmos)-(rom|dram|sram|eprom|eeprom)/.test(family)) return 'Microcircuit, Memory, MOS';
  if (/^bip-(sram|prom|pla)/.test(family)) return 'Microcircuit, Memory, Bipolar';
  if (/^(mos-linear|mos-diglin|bip-linear|bip-mmic|bip-lowv|bip-highv|bicmos-lowv|bicmos-highv)$/.test(family)) return 'Microcircuit, Linear';
  if (/^bip-/.test(family)) return 'Microcircuit, Digital, Bipolar';
  return 'Microcircuit, Digital, MOS';
};

export function deviceTypeFor(model, p = {}) {
  switch (model) {
    case 'ic': return p.eos && p.eos !== 'none' ? 'Microcircuit, Interface' : p.family ? IC_DEVICE(p.family) : null;
    case 'diode':
      return { signal: 'Diode, Small Signal', 'rectifier-lp': 'Diode, Rectifier', 'rectifier-p': 'Diode, Rectifier',
        'zener-lp': 'Diode, Zener, Voltage Regulator', 'zener-p': 'Diode, Zener, Voltage Regulator',
        'gaas-lp': 'Microwave, Diode', 'gaas-p': 'Microwave, Diode' }[p.type] ?? (p.type ? 'Diode, General' : null);
    case 'transistor': return p.type ? (p.type.startsWith('bip') ? 'Transistor, Bipolar' : 'Transistor, FET') : null;
    case 'capacitor':
      return { 'ceramic-1': 'Capacitor, Ceramic', 'ceramic-2': 'Capacitor, Ceramic', 'tantalum-solid': 'Capacitor, Tantalum',
        'aluminium-wet': 'Capacitor, Aluminum, Electrolytic' }[p.type] ?? null;
    case 'resistor': return p.type ? (p.elements > 1 ? 'Resistor, Network' : 'Resistor, Film') : null;
    case 'inductor': return 'Coil';
    case 'mil-relay': case 'mil-ssr': return 'Relay';
    case 'mil-switch':
      return { pushbutton: 'Switch, Push-button', toggle: 'Switch, Toggle', rotary: 'Rotary Switch', thermal: 'Switch, Thermal' }[p.type] ?? null;
    case 'mil-connector': case 'mil-socket': return 'Connector/Connection';
    case 'mil-pwb': return 'Printed Wiring Assembly';
    case 'mil-fuse': return 'Fuse';
    case 'mil-lamp': return 'Lamp/Light';
    case 'mil-opto': return p.type ? (/led$/.test(p.type) ? 'Optoelectronic LED' : 'Optoelectronic Sensor') : null;
    case 'mil-capacitor': return CAPACITORS_217F.styles.find((r) => r.id === p.style)?.fm ?? null;
    case 'mil-resistor': return RESISTORS_217F.styles.find((r) => r.id === p.style)?.fm ?? null;
    default: return null;
  }
}

export function failureModesFor(model, p) {
  const device = deviceTypeFor(model, p);
  return device && FAILURE_MODES.has(device) ? { device, modes: FAILURE_MODES.get(device) } : null;
}

// Suggested share of failures that break a redundant group: the short-circuit
// probability, weighted by each member's failure rate (equally if the rates
// are not known yet). members: [{ model, params, fit }]. Null if any member
// has no row or no "Short" mode, since a guess would then be invented.
export function suggestedShortShare(members) {
  if (!members.length) return null;
  const known = members.every((m) => m.fit > 0);
  let weight = 0;
  let short = 0;
  const devices = new Set();
  for (const m of members) {
    const fm = failureModesFor(m.model, m.params);
    const alpha = fm?.modes.find(([mode]) => mode === 'Short')?.[1];
    if (alpha == null) return null;
    const w = known ? m.fit : 1;
    weight += w;
    short += w * alpha;
    devices.add(fm.device);
  }
  const pct = Math.round((1000 * short) / weight) / 10;
  return { pct, devices: [...devices] };
}
