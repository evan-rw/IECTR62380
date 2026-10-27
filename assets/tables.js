// Coefficient tables for the IEC TR 62380:2004 models.
//
// None of these values were taken from the standard: the IEC's licence for
// purchased copies does not allow using them in software. Apart from the
// mission profiles, which are published excerpts of the standard, they were
// copied from one open-source project (Kicad-Space-Reliability) and have not
// been checked against the standard. Each table's `ref` names the table of
// the standard that the source says the values correspond to.
//
// Raise a table to 'corroborated' only when a second, independent public
// source (a vendor reliability report, a paper) gives the same values, and
// add that source to its list.

export const STATUS = {
  excerpt: 'Published excerpt of the standard',
  corroborated: 'Two or more independent sources agree',
  single: 'Single source, not checked against the standard',
  // MIL-HDBK-217F tables read from the handbook itself, without a second transcription to compare against.
  handbook: 'Read from the handbook',
  // Circuit-board data: a published model, or a manufacturer's data sheet.
  published: 'From a published paper or data sheet',
};

export const SOURCES = {
  iecPreview: {
    label: 'IEC TR 62380:2004 free preview, hosted by iTeh Standards (front matter, Tables 1–2)',
    url: 'https://cdn.standards.iteh.ai/samples/13261/98ed8ee73b204649b3da358d6417259b/IEC-TR-62380-2004.pdf',
  },
  kicad: {
    label: 'Kicad-Space-Reliability v3.3.0, plugins/reliability_math.py (MIT licence)',
    url: 'https://github.com/Eliot-Abramo/Kicad-Space-Reliability',
  },
  tiSloa294: {
    label: 'TI SLOA294A, "Understanding Functional Safety FIT Base Failure Rate Estimates per IEC 62380 and SN 29500"',
    url: 'https://www.ti.com/lit/pdf/sloa294',
  },
  pmcTantalum: {
    label: 'Micromachines 2023, 14(1):221, eq. (3): tantalum capacitor model',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9866997/',
  },
  thurlbeck: {
    label: 'Thurlbeck & Cao, "A Mission Profile Based Reliability Modeling Framework for Fault-tolerant Electric Propulsion", IEEE Trans. Industry Applications, 2022 (author copy)',
    url: 'https://web.engr.oregonstate.edu/~caoy2/files/IAS_thurlbeck.pdf',
  },
};

// Activation energies expressed as Ea/k in kelvin, as the standard writes them
// in its exp{A × [1/T_ref − 1/(273 + t)]} temperature factors.
export const EA = {
  MOS: 3480, // 0.30 eV
  BIPOLAR: 4640, // 0.40 eV
  CAP_CERAMIC: 1160, // 0.10 eV
  CAP_TANTALUM: 1740, // 0.15 eV
  RESISTOR: 1740, // 0.15 eV
};

// Mission profiles. Each phase: board ambient temperature t_ac (°C), working
// time ratio tau (0 for a dormant phase), annual thermal cycles n, cycle
// amplitude dT (°C), and addRise — whether the cycle amplitude also includes
// one third of the part's own temperature rise (the "ΔTj/3 +" entries).
// A phase with tau 0 adds thermal cycles only; its tac is not used.
const AUTOMOTIVE = (temps, swings) => [
  ...temps.map(([tac, tau]) => ({ name: `Working at ${tac} °C`, tac, tau, n: 0, dT: 0, addRise: false })),
  { name: 'Night starts', tac: null, tau: 0, n: 670, dT: swings[0], addRise: true },
  { name: 'Daytime starts', tac: null, tau: 0, n: 1340, dT: swings[1], addRise: true },
  { name: 'Days not used', tac: null, tau: 0, n: 30, dT: 10, addRise: false },
];

export const MISSION_PROFILES = {
  id: 'missionProfiles',
  title: 'Mission profiles',
  ref: 'Tables 1, 2 and 11',
  status: 'excerpt',
  sources: ['iecPreview', 'tiSloa294'],
  note: 'Tables 1–2 are in the free preview. The automotive rows of Table 11 are reproduced in TI SLOA294A, Table 6-1. Tables 9–10 (telecom, avionics) are not publicly available and are not included.',
  rows: [
    {
      id: 'auto-motor',
      label: 'Automotive: motor control',
      ref: 'Table 11, via TI SLOA294A Table 6-1',
      phases: AUTOMOTIVE([[32, 0.020], [60, 0.015], [85, 0.023]], [55, 45]),
    },
    {
      id: 'auto-cabin',
      label: 'Automotive: passenger compartment',
      ref: 'Table 11, via TI SLOA294A Table 6-1',
      phases: AUTOMOTIVE([[27, 0.006], [30, 0.046], [85, 0.006]], [30, 20]),
    },
    {
      id: 'leo-onoff',
      label: 'Spatial: low earth orbit (LEO), on/off cycling',
      ref: 'Table 1',
      phases: [{ name: 'Orbit, working', tac: 40, tau: 0.15, n: 5256, dT: 7, addRise: true }],
    },
    {
      id: 'leo-permanent',
      label: 'Spatial: low earth orbit (LEO), permanent working',
      ref: 'Table 1',
      phases: [{ name: 'Orbit', tac: 40, tau: 1, n: 5256, dT: 3, addRise: false }],
    },
    {
      id: 'geo-permanent',
      label: 'Spatial: geostationary orbit (GEO), permanent working',
      ref: 'Table 1',
      phases: [{ name: 'Orbit', tac: 40, tau: 1, n: 365, dT: 8, addRise: false }],
    },
    {
      id: 'military-radio',
      label: 'Military: portable radio',
      ref: 'Table 2',
      phases: [
        { name: 'Switched on (36 per year)', tac: 26, tau: 0.01, n: 36, dT: 15, addRise: true },
        { name: 'Dormant', tac: 26, tau: 0, n: 365, dT: 8, addRise: false },
      ],
    },
  ],
};

// λ1 (per transistor) and λ2 (technology) for integrated circuit families.
// N, the transistor count, is `count × nPer`, where count is in `unit`.
export const IC_FAMILIES = {
  id: 'icFamilies',
  title: 'λ1 and λ2 for integrated circuit families',
  ref: 'Table 16',
  status: 'single',
  sources: ['kicad'],
  rows: [
    { id: 'mos-digital', group: 'MOS standard circuits', label: 'Digital circuits, microprocessors, DSPs', l1: 3.4e-6, l2: 1.7, ea: EA.MOS, tRef: 328, unit: 'gates', nPer: 4 },
    { id: 'mos-linear', group: 'MOS standard circuits', label: 'Linear circuits', l1: 1.0e-2, l2: 4.2, ea: EA.MOS, tRef: 328, unit: 'transistors', nPer: 1 },
    { id: 'mos-diglin', group: 'MOS standard circuits', label: 'Digital/linear (telecom, ADC/DAC, RAMDAC)', l1: 2.7e-4, l2: 20, ea: EA.MOS, tRef: 328, unit: 'transistors', nPer: 1 },
    { id: 'mos-rom', group: 'MOS standard circuits', label: 'ROM', l1: 1.7e-7, l2: 8.8, ea: EA.MOS, tRef: 328, unit: 'bits', nPer: 1 },
    { id: 'mos-dram', group: 'MOS standard circuits', label: 'DRAM, VideoRAM, AudioRAM', l1: 1.0e-7, l2: 5.6, ea: EA.MOS, tRef: 328, unit: 'bits', nPer: 1 },
    { id: 'mos-sram-fast', group: 'MOS standard circuits', label: 'High-speed SRAM, FIFO (mixed MOS)', l1: 1.7e-7, l2: 8.8, ea: EA.MOS, tRef: 328, unit: 'bits', nPer: 4 },
    { id: 'mos-sram-low', group: 'MOS standard circuits', label: 'Low-consumption SRAM (CMOS)', l1: 1.7e-7, l2: 8.8, ea: EA.MOS, tRef: 328, unit: 'bits', nPer: 6 },
    { id: 'mos-sram-dual', group: 'MOS standard circuits', label: 'Dual-access SRAM', l1: 1.7e-7, l2: 8.8, ea: EA.MOS, tRef: 328, unit: 'bits', nPer: 8 },
    { id: 'mos-eprom', group: 'MOS standard circuits', label: 'EPROM, UVPROM, REPROM, OTP, Flash (block erase)', l1: 2.6e-7, l2: 34, ea: EA.MOS, tRef: 328, unit: 'bits', nPer: 1 },
    { id: 'mos-eeprom', group: 'MOS standard circuits', label: 'EEPROM, Flash EEPROM', l1: 6.5e-7, l2: 16, ea: EA.MOS, tRef: 328, unit: 'bits', nPer: 2 },
    { id: 'asic-stdcell', group: 'MOS ASIC circuits', label: 'Standard cell, full custom', l1: 1.2e-5, l2: 10, ea: EA.MOS, tRef: 328, unit: 'gates', nPer: 4 },
    { id: 'asic-gate-array', group: 'MOS ASIC circuits', label: 'Gate arrays', l1: 2.0e-5, l2: 10, ea: EA.MOS, tRef: 328, unit: 'gates', nPer: 4 },
    { id: 'mos-lca', group: 'MOS ASIC circuits', label: 'LCA / FPGA (RAM-based configuration)', l1: 4.0e-5, l2: 8.8, ea: EA.MOS, tRef: 328, unit: 'gates', nPer: 40 },
    { id: 'mos-pld', group: 'MOS ASIC circuits', label: 'PLD (PAL, GAL)', l1: 1.2e-3, l2: 16, ea: EA.MOS, tRef: 328, unit: 'grid points', nPer: 3 },
    { id: 'mos-cpld', group: 'MOS ASIC circuits', label: 'CPLD, EPLD, FPGA (flash or antifuse)', l1: 2.0e-5, l2: 34, ea: EA.MOS, tRef: 328, unit: 'macrocells', nPer: 100 },
    { id: 'bip-digital', group: 'Bipolar circuits', label: 'Digital circuits', l1: 6.0e-4, l2: 1.7, ea: EA.BIPOLAR, tRef: 328, unit: 'gates', nPer: 3 },
    { id: 'bip-linear', group: 'Bipolar circuits', label: 'Linear circuits', l1: 2.2e-2, l2: 3.3, ea: EA.BIPOLAR, tRef: 328, unit: 'transistors', nPer: 1 },
    { id: 'bip-mmic', group: 'Bipolar circuits', label: 'MMIC', l1: 1.0, l2: 3.3, ea: EA.BIPOLAR, tRef: 328, unit: 'transistors', nPer: 1 },
    { id: 'bip-lowv', group: 'Bipolar circuits', label: 'Linear/digital, low voltage (< 30 V)', l1: 2.7e-3, l2: 20, ea: EA.BIPOLAR, tRef: 328, unit: 'transistors', nPer: 1 },
    { id: 'bip-highv', group: 'Bipolar circuits', label: 'Linear/digital, high voltage (≥ 30 V)', l1: 2.7e-2, l2: 20, ea: EA.BIPOLAR, tRef: 328, unit: 'transistors', nPer: 1 },
    { id: 'bip-sram', group: 'Bipolar circuits', label: 'Static RAM', l1: 3.0e-4, l2: 1.7, ea: EA.BIPOLAR, tRef: 328, unit: 'bits', nPer: 2.5 },
    { id: 'bip-prom', group: 'Bipolar circuits', label: 'PROM', l1: 1.5e-4, l2: 32, ea: EA.BIPOLAR, tRef: 328, unit: 'bits', nPer: 1.2 },
    { id: 'bip-pla', group: 'Bipolar circuits', label: 'One-time programmable logic array (AND/OR)', l1: 1.5e-4, l2: 32, ea: EA.BIPOLAR, tRef: 328, unit: 'grid points', nPer: 1.6 },
    { id: 'bip-gate-array', group: 'Bipolar circuits', label: 'Gate arrays', l1: 1.0e-3, l2: 10, ea: EA.BIPOLAR, tRef: 328, unit: 'gates', nPer: 3 },
    { id: 'bicmos-digital', group: 'BiCMOS circuits', label: 'Digital circuits', l1: 1.0e-6, l2: 1.7, ea: EA.MOS, tRef: 328, unit: 'gates', nPer: 4 },
    { id: 'bicmos-lowv', group: 'BiCMOS circuits', label: 'Linear/digital, low voltage (< 6 V)', l1: 2.7e-4, l2: 20, ea: EA.MOS, tRef: 328, unit: 'transistors', nPer: 1 },
    { id: 'bicmos-highv', group: 'BiCMOS circuits', label: 'Linear/digital, high voltage (≥ 6 V), smart power', l1: 2.7e-3, l2: 20, ea: EA.BIPOLAR, tRef: 328, unit: 'transistors', nPer: 1 },
    { id: 'bicmos-sram', group: 'BiCMOS circuits', label: 'Static RAM', l1: 6.8e-7, l2: 8.8, ea: EA.MOS, tRef: 328, unit: 'bits', nPer: 4 },
    { id: 'bicmos-gate-array', group: 'BiCMOS circuits', label: 'Gate arrays', l1: 6.4e-5, l2: 10, ea: EA.MOS, tRef: 328, unit: 'gates', nPer: 4 },
    { id: 'gaas-digital-on', group: 'Gallium arsenide', label: 'Digital, normally-on transistors only', l1: 2.5, l2: 25, ea: EA.MOS, tRef: 373, unit: 'gates', nPer: 5 },
    { id: 'gaas-digital-mixed', group: 'Gallium arsenide', label: 'Digital, normally-off and normally-on', l1: 4.5e-4, l2: 16, ea: EA.BIPOLAR, tRef: 373, unit: 'gates', nPer: 3 },
    { id: 'gaas-mmic-low', group: 'Gallium arsenide', label: 'MMIC, low noise / low power (< 100 mW)', l1: 2.0, l2: 20, ea: EA.MOS, tRef: 373, unit: 'transistors', nPer: 1 },
    { id: 'gaas-mmic-power', group: 'Gallium arsenide', label: 'MMIC, power (> 100 mW)', l1: 4.0, l2: 40, ea: EA.BIPOLAR, tRef: 373, unit: 'transistors', nPer: 1 },
  ],
};

// λ3 for IC packages. kind 'pins': coef × S^exp; 'linear': offset + coef × S;
// 'fixed': value; 'diagonal': coef × D^exp with D the body diagonal in mm.
// The fixed QFP/BGA values agree with the diagonal formulas to within ~5%
// (checked in tests/models.test.mjs), which is some evidence the two came
// from the same original table.
export const IC_PACKAGES = {
  id: 'icPackages',
  title: 'λ3 for integrated circuit packages',
  ref: 'Tables 17a–17b',
  status: 'single',
  sources: ['kicad'],
  rows: [
    { id: 'pdil', group: 'Through-hole (by pin count S)', label: 'PDIL (plastic DIP)', kind: 'linear', offset: 9, coef: 0.09 },
    { id: 'cdil', group: 'Through-hole (by pin count S)', label: 'CDIL (ceramic DIP)', kind: 'linear', offset: 9, coef: 0.09 },
    { id: 'pga', group: 'Through-hole (by pin count S)', label: 'PGA (plastic or ceramic)', kind: 'linear', offset: 9, coef: 0.09 },
    { id: 'so', group: 'Surface mount (by pin count S)', label: 'SO, SOIC (1.27 mm pitch)', kind: 'pins', coef: 0.012, exp: 1.65 },
    { id: 'soj', group: 'Surface mount (by pin count S)', label: 'SOJ (1.27 mm pitch)', kind: 'pins', coef: 0.023, exp: 1.5 },
    { id: 'vsop', group: 'Surface mount (by pin count S)', label: 'VSOP (0.76 mm pitch)', kind: 'pins', coef: 0.011, exp: 1.47 },
    { id: 'ssop', group: 'Surface mount (by pin count S)', label: 'SSOP (0.65 mm pitch)', kind: 'pins', coef: 0.013, exp: 1.35 },
    { id: 'tssop', group: 'Surface mount (by pin count S)', label: 'TSSOP (0.65 mm pitch)', kind: 'pins', coef: 0.011, exp: 1.4 },
    { id: 'tsop1-055', group: 'Surface mount (by pin count S)', label: 'TSOP I (0.55 mm pitch)', kind: 'pins', coef: 0.54, exp: 0.4 },
    { id: 'tsop1-050', group: 'Surface mount (by pin count S)', label: 'TSOP I (0.5 mm pitch)', kind: 'pins', coef: 1.0, exp: 0.36 },
    { id: 'tsop2-080', group: 'Surface mount (by pin count S)', label: 'TSOP II (0.8 mm pitch)', kind: 'pins', coef: 0.04, exp: 1.2 },
    { id: 'tsop2-065', group: 'Surface mount (by pin count S)', label: 'TSOP II (0.65 mm pitch)', kind: 'pins', coef: 0.042, exp: 1.1 },
    { id: 'tsop2-050', group: 'Surface mount (by pin count S)', label: 'TSOP II (0.5 mm pitch)', kind: 'pins', coef: 0.075, exp: 0.9 },
    { id: 'tsop2-040', group: 'Surface mount (by pin count S)', label: 'TSOP II (0.4 mm pitch)', kind: 'pins', coef: 0.13, exp: 0.7 },
    { id: 'plcc', group: 'Surface mount (by pin count S)', label: 'PLCC (1.27 mm pitch)', kind: 'pins', coef: 0.021, exp: 1.57 },
    { id: 'pqfp-5', group: 'QFP (by body size)', label: 'PQFP / TQFP 5 × 5 mm', kind: 'fixed', value: 1.3, body: [5, 5] },
    { id: 'pqfp-7', group: 'QFP (by body size)', label: 'PQFP / TQFP 7 × 7 mm', kind: 'fixed', value: 2.5, body: [7, 7] },
    { id: 'pqfp-10', group: 'QFP (by body size)', label: 'PQFP / TQFP 10 × 10 mm', kind: 'fixed', value: 4.1, body: [10, 10] },
    { id: 'pqfp-14', group: 'QFP (by body size)', label: 'PQFP / TQFP 14 × 14 mm', kind: 'fixed', value: 7.2, body: [14, 14] },
    { id: 'pqfp-14x20', group: 'QFP (by body size)', label: 'PQFP 14 × 20 mm', kind: 'fixed', value: 10.2, body: [14, 20] },
    { id: 'pqfp-20', group: 'QFP (by body size)', label: 'PQFP 20 × 20 mm', kind: 'fixed', value: 12.0, body: [20, 20] },
    { id: 'pqfp-28', group: 'QFP (by body size)', label: 'PQFP 28 × 28 mm', kind: 'fixed', value: 23.0, body: [28, 28] },
    { id: 'pqfp-32', group: 'QFP (by body size)', label: 'PQFP 32 × 32 mm', kind: 'fixed', value: 29.0, body: [32, 32] },
    { id: 'pqfp-40', group: 'QFP (by body size)', label: 'PQFP 40 × 40 mm', kind: 'fixed', value: 42.0, body: [40, 40] },
    { id: 'pbga-13x15', group: 'BGA (by body size)', label: 'PBGA 13 × 15 mm', kind: 'fixed', value: 11.4, body: [13, 15] },
    { id: 'pbga-17x19', group: 'BGA (by body size)', label: 'PBGA 17 × 19 mm', kind: 'fixed', value: 16.6, body: [17, 19] },
    { id: 'pbga-23', group: 'BGA (by body size)', label: 'PBGA 23 × 23 mm', kind: 'fixed', value: 26.6, body: [23, 23] },
    { id: 'pbga-27', group: 'BGA (by body size)', label: 'PBGA 27 × 27 mm', kind: 'fixed', value: 33.0, body: [27, 27] },
    { id: 'pbga-35', group: 'BGA (by body size)', label: 'PBGA 35 × 35 mm', kind: 'fixed', value: 51.3, body: [35, 35] },
    { id: 'sbga-27', group: 'BGA (by body size)', label: 'SBGA 27 × 27 mm', kind: 'fixed', value: 33.0, body: [27, 27] },
    { id: 'sbga-42', group: 'BGA (by body size)', label: 'SBGA 42.5 × 42.5 mm', kind: 'fixed', value: 71.0, body: [42.5, 42.5] },
    { id: 'diag-two-rows', group: 'Any SMD package (by body diagonal D)', label: 'Leads on two sides (SO, TSOP, …)', kind: 'diagonal', coef: 0.024, exp: 1.68 },
    { id: 'diag-four-sides', group: 'Any SMD package (by body diagonal D)', label: 'Leads on four sides (QFP, PLCC, QFN, …)', kind: 'diagonal', coef: 0.048, exp: 1.68 },
    { id: 'diag-matrix', group: 'Any SMD package (by body diagonal D)', label: 'Area array (BGA, CSP, …)', kind: 'diagonal', coef: 0.073, exp: 1.68 },
  ],
};

// Thermal expansion coefficients (ppm/°C) for π_α = 0.06 × |α_S − α_C|^1.68.
export const CTE_SUBSTRATES = {
  id: 'cteSubstrates',
  title: 'Thermal expansion coefficient α_S of the board substrate',
  ref: 'Table 14',
  status: 'single',
  sources: ['kicad'],
  rows: [
    { id: 'fr4', label: 'Epoxy glass (FR4, G-10)', alpha: 16 },
    { id: 'ptfe', label: 'PTFE glass', alpha: 20 },
    { id: 'polyimide-aramid', label: 'Polyimide aramid', alpha: 6.5 },
    { id: 'cic', label: 'Copper/Invar/copper (20/60/20)', alpha: 5.4 },
  ],
};

export const CTE_PACKAGES = {
  id: 'ctePackages',
  title: 'Thermal expansion coefficient α_C of the component package',
  ref: 'Table 14',
  status: 'single',
  sources: ['kicad'],
  rows: [
    { id: 'plastic', label: 'Plastic (epoxy) package', alpha: 21.5 },
    { id: 'ceramic', label: 'Ceramic (alumina) package', alpha: 6.5 },
  ],
};

// λ_EOS for interface circuits, by application. π_I = 1 for a circuit
// connected to the outside world, 0 otherwise (first row).
export const EOS = {
  id: 'eos',
  title: 'λ_EOS for interface circuits',
  ref: 'Clause 7.3 (interface circuits)',
  status: 'single',
  sources: ['kicad'],
  rows: [
    { id: 'none', label: 'Not an interface circuit (π_I = 0)', fit: 0 },
    { id: 'computer', label: 'Computer', fit: 10 },
    { id: 'telecom-switching', label: 'Telecom: switching', fit: 15 },
    { id: 'telecom-transmitting', label: 'Telecom: transmitting', fit: 40 },
    { id: 'telecom-access', label: 'Telecom: access, subscriber cards', fit: 70 },
    { id: 'telecom-subscriber', label: 'Telecom: subscriber equipment', fit: 100 },
    { id: 'railways-payphone', label: 'Railways, payphone', fit: 100 },
    { id: 'avionics', label: 'Civilian avionics (on-board calculators)', fit: 20 },
    { id: 'power-supply', label: 'Power supply, converters', fit: 40 },
  ],
};

// λ_B, the package base failure rate for discrete semiconductors.
export const DISCRETE_PACKAGES = {
  id: 'discretePackages',
  title: 'λ_B for discrete semiconductor packages',
  ref: 'Table 18',
  status: 'single',
  sources: ['kicad'],
  rows: [
    { id: 'to18', group: 'Through-hole', label: 'TO-18', lb: 1.0 },
    { id: 'to39', group: 'Through-hole', label: 'TO-39', lb: 2.0 },
    { id: 'to92', group: 'Through-hole', label: 'TO-92', lb: 1.0 },
    { id: 'sot32', group: 'Through-hole', label: 'SOT-32 (TO-126)', lb: 5.3 },
    { id: 'sot82', group: 'Through-hole', label: 'SOT-82', lb: 5.3 },
    { id: 'to220', group: 'Through-hole', label: 'TO-220', lb: 5.7 },
    { id: 'to218', group: 'Through-hole', label: 'TO-218 (SOT-93)', lb: 6.9 },
    { id: 'to247', group: 'Through-hole', label: 'TO-247', lb: 6.9 },
    { id: 'isotop', group: 'Through-hole', label: 'ISOTOP', lb: 20.0 },
    { id: 'do220', group: 'Through-hole', label: 'DO-220', lb: 5.7 },
    { id: 'do34', group: 'Through-hole', label: 'DO-34 (DO-204AG)', lb: 2.5 },
    { id: 'do35', group: 'Through-hole', label: 'DO-35 (DO-204AH)', lb: 2.5 },
    { id: 'do41-glass', group: 'Through-hole', label: 'DO-41 (DO-204AL), glass', lb: 2.5 },
    { id: 'do41-plastic', group: 'Through-hole', label: 'DO-41 (DO-204AL), plastic', lb: 1.0 },
    { id: 'f126', group: 'Through-hole', label: 'F 126', lb: 1.0 },
    { id: 'sot23', group: 'Surface mount', label: 'SOT-23', lb: 1.0 },
    { id: 'sot143', group: 'Surface mount', label: 'SOT-143', lb: 1.0 },
    { id: 'sot223', group: 'Surface mount', label: 'SOT-223', lb: 3.4 },
    { id: 'sot323', group: 'Surface mount', label: 'SOT-323', lb: 0.8 },
    { id: 'sot343', group: 'Surface mount', label: 'SOT-343', lb: 0.8 },
    { id: 'sot346', group: 'Surface mount', label: 'SOT-346', lb: 1.0 },
    { id: 'sot363', group: 'Surface mount', label: 'SOT-363', lb: 0.8 },
    { id: 'sot457', group: 'Surface mount', label: 'SOT-457', lb: 1.1 },
    { id: 'sot89', group: 'Surface mount', label: 'SOT-89', lb: 2.0 },
    { id: 'dpak', group: 'Surface mount', label: 'DPAK (SOT-428)', lb: 5.1 },
    { id: 'd2pak', group: 'Surface mount', label: 'D2PAK', lb: 5.7 },
    { id: 'micromelf', group: 'Surface mount', label: 'MicroMELF', lb: 2.5 },
    { id: 'minimelf', group: 'Surface mount', label: 'MiniMELF (SOD-80)', lb: 2.5 },
    { id: 'melf', group: 'Surface mount', label: 'MELF', lb: 5.0 },
    { id: 'sod110', group: 'Surface mount', label: 'SOD-110', lb: 0.8 },
    { id: 'sod123', group: 'Surface mount', label: 'SOD-123', lb: 1.0 },
    { id: 'sod323', group: 'Surface mount', label: 'SOD-323', lb: 0.7 },
    { id: 'sod523', group: 'Surface mount', label: 'SOD-523', lb: 0.5 },
    { id: 'sma', group: 'Surface mount', label: 'SMA (DO-214AC)', lb: 1.8 },
    { id: 'smb', group: 'Surface mount', label: 'SMB (DO-214AA)', lb: 2.4 },
    { id: 'smc', group: 'Surface mount', label: 'SMC (DO-214AB)', lb: 5.1 },
    { id: 'sod15', group: 'Surface mount', label: 'SOD-15', lb: 5.1 },
  ],
};

// λ0 for diodes, defined at t_j = 40 °C: π_t = exp{4640 × [1/313 − 1/(273 + t_j)]}.
export const DIODES = {
  id: 'diodes',
  title: 'λ0 for low-power and power diodes',
  ref: 'Clauses 8.2–8.3',
  status: 'single',
  sources: ['kicad'],
  rows: [
    { id: 'signal', group: 'Low power (8.2)', label: 'Signal, PIN, Schottky (up to 1 A)', l0: 0.07 },
    { id: 'rectifier-lp', group: 'Low power (8.2)', label: 'Recovery, rectifier, Schottky (1 A to 3 A)', l0: 0.1 },
    { id: 'zener-lp', group: 'Low power (8.2)', label: 'Zener regulator (up to 1.5 W)', l0: 0.4 },
    { id: 'tvs-lp', group: 'Low power (8.2)', label: 'Transient voltage suppressor (up to 5 kW peak)', l0: 2.3 },
    { id: 'trigger-lp', group: 'Low power (8.2)', label: 'Trigger', l0: 2.0 },
    { id: 'gaas-lp', group: 'Low power (8.2)', label: 'GaAs (up to 0.1 W)', l0: 0.3 },
    { id: 'rectifier-p', group: 'Power (8.3)', label: 'Rectifier, fast recovery, Schottky (above 3 A)', l0: 0.7 },
    { id: 'zener-p', group: 'Power (8.3)', label: 'Zener regulator (above 1.5 W)', l0: 0.7 },
    { id: 'tvs-p', group: 'Power (8.3)', label: 'Transient voltage suppressor (power)', l0: 0.7 },
    { id: 'trigger-p', group: 'Power (8.3)', label: 'Trigger (power)', l0: 3.0 },
    { id: 'gaas-p', group: 'Power (8.3)', label: 'GaAs (above 0.1 W)', l0: 1.0 },
  ],
};

// λ0 for silicon transistors; π_t referenced to t_j = 100 °C (373 K).
export const TRANSISTORS = {
  id: 'transistors',
  title: 'λ0 for low-power and power transistors',
  ref: 'Clauses 8.4–8.5',
  status: 'single',
  sources: ['kicad', 'thurlbeck'],
  note: 'Thurlbeck & Cao (2022) independently give the MOS activation energy (0.3 eV) and the 100 °C reference temperature. The λ0 values have a single source.',
  rows: [
    { id: 'bip-lp', group: 'Low power (8.4)', label: 'Silicon bipolar (up to 5 W)', l0: 0.75, ea: EA.BIPOLAR },
    { id: 'mos-lp', group: 'Low power (8.4)', label: 'Silicon MOS (up to 5 W)', l0: 0.75, ea: EA.MOS },
    { id: 'bip-p', group: 'Power (8.5)', label: 'Silicon bipolar (above 5 W)', l0: 2.0, ea: EA.BIPOLAR },
    { id: 'mos-p', group: 'Power (8.5)', label: 'Silicon MOS (above 5 W)', l0: 2.0, ea: EA.MOS },
  ],
};

// Capacitors: λ = λ0 × [Σ π_t·τ_i/(τ_on+τ_off) + k × Σ π_n·ΔT_i^0.68].
export const CAPACITORS = {
  id: 'capacitors',
  title: 'λ0, cycling coefficient k and temperature factor for capacitors',
  ref: 'Clause 10',
  status: 'single',
  sources: ['kicad', 'pmcTantalum'],
  note: 'Equation (3) of the Micromachines paper states the same tantalum λ0 = 0.4 and k = 3.8 × 10⁻³, but its worked example does not follow it, so it is weak support. Film capacitors (10.1), aluminium solid and polymer (10.6–10.7), variable ceramic (10.8) and NTC thermistors (10.9) are pending.',
  rows: [
    { id: 'ceramic-1', label: 'Ceramic, class I (defined temperature coefficient)', clause: '10.2', l0: 0.05, k: 3.3e-3, ea: EA.CAP_CERAMIC, tRef: 303 },
    { id: 'ceramic-2', label: 'Ceramic, class II', clause: '10.3', l0: 0.15, k: 3.3e-3, ea: EA.CAP_CERAMIC, tRef: 303 },
    { id: 'tantalum-solid', label: 'Tantalum, solid electrolyte', clause: '10.4', l0: 0.4, k: 3.8e-3, ea: EA.CAP_TANTALUM, tRef: 303 },
    { id: 'aluminium-wet', label: 'Aluminium, non-solid electrolyte (life expectancy not checked)', clause: '10.5', l0: 1.3, k: 1.4e-3, ea: EA.BIPOLAR, tRef: 313 },
  ],
};

// Resistors: t_R = t_ac + rise × (P / P_rated); λ0 is per resistive element.
export const RESISTORS = {
  id: 'resistors',
  title: 'λ0, cycling coefficient k and self-heating for resistors',
  ref: 'Clause 11',
  status: 'single',
  sources: ['kicad'],
  note: 'Carbon composition (11.2), high-dissipation film (11.3), wirewound (11.4–11.5) and cermet potentiometers (11.7) are pending.',
  rows: [
    { id: 'film-low', label: 'Fixed film, low dissipation (RS, RC, MiniMELF)', clause: '11.1', l0: 0.1, k: 1.4e-3, rise: 85 },
    { id: 'smd', label: 'Surface mount, low dissipation, and resistor arrays', clause: '11.6', l0: 0.01, k: 3.3e-3, rise: 55 },
  ],
};

// Inductors and transformers: t_R = t_ac + 8.2 × P_loss / S (S in dm²).
// No λ0 values are included: the public sources disagree, so λ0 is entered.
export const INDUCTORS = {
  id: 'inductors',
  title: 'Cycling coefficient and self-heating for inductors and transformers',
  ref: 'Clause 12',
  status: 'single',
  sources: ['kicad'],
  note: 'No λ0 values are included; enter one from a datasheet or vendor data, or use the MIL-HDBK-217F inductor, choke or transformer model, which has its own base rates.',
  k: 7e-3,
  riseCoef: 8.2,
};

export const ALL_TABLES = [
  MISSION_PROFILES, IC_FAMILIES, IC_PACKAGES, CTE_SUBSTRATES, CTE_PACKAGES, EOS,
  DISCRETE_PACKAGES, DIODES, TRANSISTORS, CAPACITORS, RESISTORS, INDUCTORS,
];
