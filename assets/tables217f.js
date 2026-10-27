// Coefficient tables for the MIL-HDBK-217F part models.
//
// MIL-HDBK-217F (2 December 1991) and its Notice 2 (28 February 1995) are US
// Department of Defense handbooks, "Distribution Statement A: approved for
// public release; distribution unlimited". Values were read from the scanned
// pages (Notice 2 where it supersedes a page) and checked against RAMSTK's
// independent transcription where RAMSTK uses the same edition, or against
// the scan's OCR text where it does not. Rates are failures per 10^6
// operating hours; the models convert them to FIT.

// Operating environments, in the handbook's column order. Every π_E list
// below follows this order.
export const ENVIRONMENTS = [
  { id: 'GB', label: 'Ground, benign (G_B)' },
  { id: 'GF', label: 'Ground, fixed (G_F)' },
  { id: 'GM', label: 'Ground, mobile (G_M)' },
  { id: 'NS', label: 'Naval, sheltered (N_S)' },
  { id: 'NU', label: 'Naval, unsheltered (N_U)' },
  { id: 'AIC', label: 'Airborne, inhabited, cargo (A_IC)' },
  { id: 'AIF', label: 'Airborne, inhabited, fighter (A_IF)' },
  { id: 'AUC', label: 'Airborne, uninhabited, cargo (A_UC)' },
  { id: 'AUF', label: 'Airborne, uninhabited, fighter (A_UF)' },
  { id: 'ARW', label: 'Airborne, rotary winged (A_RW)' },
  { id: 'SF', label: 'Space, flight (S_F)' },
  { id: 'MF', label: 'Missile, flight (M_F)' },
  { id: 'ML', label: 'Missile, launch (M_L)' },
  { id: 'CL', label: 'Cannon, launch (C_L)' },
];

export const SOURCES_217F = {
  mil217f: {
    label: 'MIL-HDBK-217F, Reliability Prediction of Electronic Equipment, 2 December 1991 (public release)',
    url: 'https://everyspec.com/MIL-HDBK/MIL-HDBK-0200-0299/MIL-HDBK-217F_14591/',
  },
  mil217fN2: {
    label: 'MIL-HDBK-217F Notice 2, 28 February 1995 (public release)',
    url: 'https://everyspec.com/MIL-HDBK/MIL-HDBK-0200-0299/MIL-HDBK-217F_NOTICE-2_14590/',
  },
  ramstk: {
    label: 'RAMSTK (ReliaQual Associates), MIL-HDBK-217F constants, used as an independent cross-check',
    url: 'https://github.com/ReliaQualAssociates/ramstk',
  },
};

// Load stress factor π_L shared by relays and switches; S = operating load
// current / rated resistive load current.
export const LOAD_TYPES = [
  { id: 'resistive', label: 'Resistive', divisor: 0.8 },
  { id: 'inductive', label: 'Inductive', divisor: 0.4 },
  { id: 'lamp', label: 'Lamp', divisor: 0.2 },
];

export const RELAY_MECHANICAL = {
  id: 'mil-relay',
  title: 'Relays, mechanical',
  ref: 'MIL-HDBK-217F Notice 2, section 13.1',
  status: 'corroborated',
  sources: ['mil217fN2', 'ramstk'],
  note: 'π_C, π_F and π_E agree with RAMSTK. π_Q follows Notice 2 (eight levels, commercial 2.9); RAMSTK still has the 1991 table.',
  // λ_b = 0.0059·exp(−Ea/k·[1/(T+273) − 1/298]) with Ea 0.19 eV (85 °C rated) or 0.17 eV (125 °C rated).
  ratings: [
    { id: '85', label: 'Rated 85 °C', ea: 0.19 },
    { id: '125', label: 'Rated 125 °C', ea: 0.17 },
  ],
  contactForms: [
    { id: 'SPST', piC: 1.0 }, { id: 'DPST', piC: 1.5 }, { id: 'SPDT', piC: 1.75 },
    { id: '3PST', piC: 2.0 }, { id: '4PST', piC: 2.5 }, { id: 'DPDT', piC: 3.0 },
    { id: '3PDT', piC: 4.25 }, { id: '4PDT', piC: 5.5 }, { id: '6PDT', piC: 8.0 },
  ],
  quality: [
    { id: 'R', label: 'R', piQ: 0.10 }, { id: 'P', label: 'P', piQ: 0.30 }, { id: 'X', label: 'X', piQ: 0.45 },
    { id: 'U', label: 'U', piQ: 0.60 }, { id: 'M', label: 'M', piQ: 1.0 }, { id: 'L', label: 'L', piQ: 1.5 },
    { id: 'milspec', label: 'MIL-SPEC, non-established reliability', piQ: 1.5 },
    { id: 'commercial', label: 'Commercial', piQ: 2.9 },
  ],
  // Application and construction factor π_F: [contact rating, application, construction, π_F].
  application: [
    ['Signal current (low mV, mA)', 'Dry circuit', 'Armature (long)', 4],
    ['Signal current (low mV, mA)', 'Dry circuit', 'Dry reed', 6],
    ['Signal current (low mV, mA)', 'Dry circuit', 'Mercury wetted', 1],
    ['Signal current (low mV, mA)', 'Dry circuit', 'Magnetic latching', 4],
    ['Signal current (low mV, mA)', 'Dry circuit', 'Balanced armature', 7],
    ['Signal current (low mV, mA)', 'Dry circuit', 'Solenoid', 7],
    ['0–5 A', 'General purpose', 'Armature (long)', 3],
    ['0–5 A', 'General purpose', 'Balanced armature', 5],
    ['0–5 A', 'General purpose', 'Solenoid', 6],
    ['0–5 A', 'Sensitive (0–100 mW)', 'Armature (long and short)', 5],
    ['0–5 A', 'Sensitive (0–100 mW)', 'Mercury wetted', 2],
    ['0–5 A', 'Sensitive (0–100 mW)', 'Magnetic latching', 6],
    ['0–5 A', 'Sensitive (0–100 mW)', 'Meter movement', 100],
    ['0–5 A', 'Sensitive (0–100 mW)', 'Balanced armature', 10],
    ['0–5 A', 'Polarized', 'Armature (short)', 10],
    ['0–5 A', 'Polarized', 'Meter movement', 100],
    ['0–5 A', 'Vibrating reed', 'Dry reed', 6],
    ['0–5 A', 'Vibrating reed', 'Mercury wetted', 1],
    ['0–5 A', 'High speed', 'Armature (balanced and short)', 25],
    ['0–5 A', 'High speed', 'Dry reed', 6],
    ['0–5 A', 'Thermal time delay', 'Bimetal', 10],
    ['0–5 A', 'Electronic time delay, non-thermal', '—', 9],
    ['0–5 A', 'Latching, magnetic', 'Dry reed', 10],
    ['0–5 A', 'Latching, magnetic', 'Mercury wetted', 5],
    ['0–5 A', 'Latching, magnetic', 'Balanced armature', 5],
    ['5–20 A', 'High voltage', 'Vacuum (glass)', 20],
    ['5–20 A', 'High voltage', 'Vacuum (ceramic)', 5],
    ['5–20 A', 'Medium power', 'Armature (long and short)', 3],
    ['5–20 A', 'Medium power', 'Mercury wetted', 1],
    ['5–20 A', 'Medium power', 'Magnetic latching', 2],
    ['5–20 A', 'Medium power', 'Mechanical latching', 3],
    ['5–20 A', 'Medium power', 'Balanced armature', 2],
    ['5–20 A', 'Medium power', 'Solenoid', 2],
    ['25–600 A', 'Contactors (high current)', 'Armature (short)', 7],
    ['25–600 A', 'Contactors (high current)', 'Mechanical latching', 12],
    ['25–600 A', 'Contactors (high current)', 'Balanced armature', 10],
    ['25–600 A', 'Contactors (high current)', 'Solenoid', 5],
  ].map(([rating, use, construction, piF], i) => ({ id: `f${i}`, group: `${rating}: ${use}`, label: `${construction} (π_F ${piF})`, piF })),
  piE: [1.0, 2.0, 15, 8.0, 27, 7.0, 9.0, 11, 12, 46, 0.50, 25, 66, null],
};

export const RELAY_SOLID_STATE = {
  id: 'mil-ssr',
  title: 'Relays, solid state and time delay',
  ref: 'MIL-HDBK-217F Notice 2, section 13.2',
  status: 'corroborated',
  sources: ['mil217fN2', 'ramstk'],
  note: 'π_E agrees with RAMSTK. Notice 2 gives λ_b = 0.029 for all three types.',
  types: [
    { id: 'ss', label: 'Solid state', lb: 0.029 },
    { id: 'ss-delay', label: 'Solid state, time delay', lb: 0.029 },
    { id: 'hybrid', label: 'Hybrid', lb: 0.029 },
  ],
  quality: [{ id: 'milspec', label: 'MIL-SPEC', piQ: 1.0 }, { id: 'commercial', label: 'Commercial', piQ: 1.9 }],
  piE: [1.0, 3.0, 12, 6.0, 17, 12, 19, 21, 32, 23, 0.40, 12, 33, 590],
};

export const SWITCHES = {
  id: 'mil-switch',
  title: 'Switches',
  ref: 'MIL-HDBK-217F Notice 2, section 14.1',
  status: 'handbook',
  sources: ['mil217fN2'],
  note: 'Read from the Notice 2 page and checked against its OCR text (13 of 14 base rates; "Pressure 2.8" from the image only). RAMSTK implements the older 1991 switch model, so it cannot cross-check this one.',
  types: [
    { id: 'centrifugal', label: 'Centrifugal', lb: 3.4 },
    { id: 'dip', label: 'Dual-in-line package (DIP)', lb: 0.00012 },
    { id: 'limit', label: 'Limit', lb: 4.3 },
    { id: 'liquid-level', label: 'Liquid level', lb: 2.3 },
    { id: 'microwave', label: 'Microwave (waveguide)', lb: 1.7 },
    { id: 'pressure', label: 'Pressure', lb: 2.8 },
    { id: 'pushbutton', label: 'Pushbutton', lb: 0.10, contacts: true },
    { id: 'reed', label: 'Reed', lb: 0.0010 },
    { id: 'rocker', label: 'Rocker', lb: 0.023 },
    { id: 'rotary', label: 'Rotary', lb: 0.11 },
    { id: 'sensitive', label: 'Sensitive', lb: 0.49 },
    { id: 'thermal', label: 'Thermal', lb: 0.031 },
    { id: 'thumbwheel', label: 'Thumbwheel', lb: 0.18 },
    { id: 'toggle', label: 'Toggle', lb: 0.10, contacts: true },
  ],
  // π_C = (number of contacts)^0.33, toggle and pushbutton only.
  contactForms: [
    { id: 'SPST', contacts: 1 }, { id: 'DPST', contacts: 2 }, { id: 'SPDT', contacts: 2 },
    { id: '3PST', contacts: 3 }, { id: '4PST', contacts: 4 }, { id: 'DPDT', contacts: 4 },
    { id: '3PDT', contacts: 6 }, { id: '4PDT', contacts: 8 }, { id: '6PDT', contacts: 12 },
  ],
  quality: [{ id: 'milspec', label: 'MIL-SPEC', piQ: 1 }, { id: 'lower', label: 'Lower', piQ: 2 }],
  piE: [1.0, 3.0, 18, 8.0, 29, 10, 18, 13, 22, 46, 0.50, 25, 67, 1200],
};

export const CONNECTORS = {
  id: 'mil-connector',
  title: 'Connectors, general',
  ref: 'MIL-HDBK-217F Notice 2, section 15.1',
  status: 'handbook',
  sources: ['mil217fN2', 'ramstk'],
  note: 'Base rates and gauge coefficients read from the page and confirmed by its OCR text. π_E, π_K and four gauge coefficients also agree with RAMSTK; RAMSTK uses the older 1991 base-rate model.',
  // λ_b is for a mated pair; dT is a fixed insert temperature rise where the handbook gives one.
  types: [
    { id: 'circular', label: 'Circular / cylindrical', lb: 0.0010 },
    { id: 'card-edge', label: 'Card edge (PCB)', lb: 0.040 },
    { id: 'hexagonal', label: 'Hexagonal', lb: 0.15 },
    { id: 'rack-panel', label: 'Rack and panel', lb: 0.021 },
    { id: 'rectangular', label: 'Rectangular', lb: 0.046 },
    { id: 'rf-coax', label: 'RF coaxial', lb: 0.00041, dT: 5 },
    { id: 'rf-coax-power', label: 'RF coaxial, high power', lb: 0.00041, dT: 50 },
    { id: 'telephone', label: 'Telephone', lb: 0.0075 },
    { id: 'power', label: 'Power', lb: 0.0070 },
    { id: 'triaxial', label: 'Triaxial', lb: 0.0036 },
  ],
  // Insert temperature rise ΔT = k·i^1.85 (i = amperes per contact), by contact gauge (AWG).
  gauges: [
    { id: '32', k: 3.256 }, { id: '30', k: 2.856 }, { id: '28', k: 2.286 }, { id: '24', k: 1.345 },
    { id: '22', k: 0.989 }, { id: '20', k: 0.640 }, { id: '18', k: 0.429 }, { id: '16', k: 0.274 }, { id: '12', k: 0.100 },
  ],
  // Mating/unmating cycles per 1000 hours: upper bound and π_K.
  piK: [[0.05, 1.0], [0.5, 1.5], [5, 2.0], [50, 3.0], [Infinity, 4.0]],
  quality: [{ id: 'milspec', label: 'MIL-SPEC', piQ: 1 }, { id: 'lower', label: 'Lower', piQ: 2 }],
  piE: [1.0, 1.0, 8.0, 5.0, 13, 3.0, 5.0, 8.0, 12, 19, 0.50, 10, 27, 490],
};

export const SOCKETS = {
  id: 'mil-socket',
  title: 'Connectors, sockets',
  ref: 'MIL-HDBK-217F Notice 2, section 15.2',
  status: 'handbook',
  sources: ['mil217fN2', 'ramstk'],
  note: 'π_E agrees with RAMSTK; base rates and π_Q from the Notice 2 page. π_P = exp(((N − 1)/10)^0.39) reproduces the page\'s table.',
  types: [
    { id: 'dip', label: 'Dual-in-line package', lb: 0.00064 },
    { id: 'sip', label: 'Single-in-line package', lb: 0.00064 },
    { id: 'chip-carrier', label: 'Chip carrier', lb: 0.00064 },
    { id: 'pga', label: 'Pin grid array', lb: 0.00064 },
    { id: 'relay', label: 'Relay', lb: 0.037 },
    { id: 'transistor', label: 'Transistor', lb: 0.0051 },
    { id: 'tube', label: 'Electron tube, CRT', lb: 0.011 },
  ],
  quality: [{ id: 'milspec', label: 'MIL-SPEC', piQ: 0.3 }, { id: 'lower', label: 'Lower', piQ: 1.0 }],
  piE: [1.0, 3.0, 14, 6.0, 18, 8.0, 12, 11, 13, 25, 0.50, 14, 36, 650],
};

export const PTH_BOARDS = {
  id: 'mil-pwb',
  title: 'Interconnection assemblies with plated through holes',
  ref: 'MIL-HDBK-217F Notice 2, section 16.1',
  status: 'handbook',
  sources: ['mil217fN2', 'ramstk'],
  note: 'π_E agrees with RAMSTK. Notice 2 lowered λ_b to 0.000017 (0.00011 for discrete wiring); RAMSTK still has the 1991 values. The handbook applies this model to leaded parts in plated through holes; surface-mount boards need its section 16.2, which is not included.',
  technologies: [
    { id: 'pcb', label: 'Printed wiring assembly with PTHs', lb: 0.000017 },
    { id: 'discrete', label: 'Discrete wiring, electroless PTH (≤ 2 levels)', lb: 0.00011 },
  ],
  quality: [
    { id: 'milspec', label: 'MIL-SPEC or IPC Level 3', piQ: 1 },
    { id: 'lower', label: 'Lower', piQ: 2 },
  ],
  piE: [1.0, 2.0, 7.0, 5.0, 13, 5.0, 8.0, 16, 28, 19, 0.50, 10, 27, 500],
};

export const CRYSTALS = {
  id: 'mil-crystal',
  title: 'Quartz crystals',
  ref: 'MIL-HDBK-217F, section 19.1',
  status: 'corroborated',
  sources: ['mil217f', 'ramstk'],
  quality: [{ id: 'milspec', label: 'MIL-SPEC', piQ: 1.0 }, { id: 'lower', label: 'Lower', piQ: 2.1 }],
  piE: [1.0, 3.0, 10, 6.0, 16, 12, 17, 22, 28, 23, 0.50, 13, 32, 500],
};

export const FUSES = {
  id: 'mil-fuse',
  title: 'Fuses',
  ref: 'MIL-HDBK-217F, section 22.1',
  status: 'corroborated',
  sources: ['mil217f', 'ramstk'],
  lb: 0.010,
  piE: [1.0, 2.0, 8.0, 5.0, 11, 9.0, 12, 15, 18, 16, 0.90, 10, 21, 230],
};

export const LAMPS = {
  id: 'mil-lamp',
  title: 'Lamps, incandescent',
  ref: 'MIL-HDBK-217F, section 20.1',
  status: 'corroborated',
  sources: ['mil217f', 'ramstk'],
  applications: [{ id: 'ac', label: 'Alternating current', piA: 1.0 }, { id: 'dc', label: 'Direct current', piA: 3.3 }],
  piE: [1.0, 2.0, 3.0, 3.0, 4.0, 4.0, 4.0, 5.0, 6.0, 5.0, 0.70, 4.0, 6.0, 27],
};

export const OPTOELECTRONICS = {
  id: 'mil-opto',
  title: 'Optoelectronics: detectors, isolators, emitters',
  ref: 'MIL-HDBK-217F, section 6.11',
  status: 'corroborated',
  sources: ['mil217f', 'ramstk'],
  note: 'π_Q and π_E agree with RAMSTK. Notice 2 did not change this section.',
  types: [
    { id: 'phototransistor', group: 'Photodetectors', label: 'Phototransistor', lb: 0.0055 },
    { id: 'photodiode', group: 'Photodetectors', label: 'Photodiode', lb: 0.0040 },
    { id: 'iso-diode', group: 'Optoisolators', label: 'Photodiode output, single', lb: 0.0025 },
    { id: 'iso-transistor', group: 'Optoisolators', label: 'Phototransistor output, single', lb: 0.013 },
    { id: 'iso-darlington', group: 'Optoisolators', label: 'Photodarlington output, single', lb: 0.013 },
    { id: 'iso-lsr', group: 'Optoisolators', label: 'Light-sensitive resistor, single', lb: 0.0064 },
    { id: 'iso-diode-dual', group: 'Optoisolators', label: 'Photodiode output, dual', lb: 0.0033 },
    { id: 'iso-transistor-dual', group: 'Optoisolators', label: 'Phototransistor output, dual', lb: 0.017 },
    { id: 'iso-darlington-dual', group: 'Optoisolators', label: 'Photodarlington output, dual', lb: 0.017 },
    { id: 'iso-lsr-dual', group: 'Optoisolators', label: 'Light-sensitive resistor, dual', lb: 0.0086 },
    { id: 'irled', group: 'Emitters', label: 'Infrared LED', lb: 0.0013 },
    { id: 'led', group: 'Emitters', label: 'LED', lb: 0.00023 },
  ],
  quality: [
    { id: 'jantxv', label: 'JANTXV', piQ: 0.70 }, { id: 'jantx', label: 'JANTX', piQ: 1.0 }, { id: 'jan', label: 'JAN', piQ: 2.4 },
    { id: 'lower', label: 'Lower', piQ: 5.5 }, { id: 'plastic', label: 'Plastic', piQ: 8.0 },
  ],
  piE: [1.0, 2.0, 8.0, 5.0, 12, 4.0, 6.0, 6.0, 8.0, 17, 0.50, 9.0, 24, 450],
};

export const CAPACITORS_217F = {
  id: 'mil-capacitor',
  title: 'Capacitors',
  ref: 'MIL-HDBK-217F Notice 2, section 10.1',
  status: 'handbook',
  sources: ['mil217fN2'],
  note: 'One model for every capacitor style, from the Notice 2 pages, which replace sections 10.1–10.20 of the 1991 edition. Each style names the columns of the π_T, π_C and π_V tables it uses; the tables are the printed values of the formulas used here. π_T applies up to the capacitor\'s temperature rating. Commercial parts take π_Q = 10, so these rates are typically well above the IEC TR 62380 capacitor rates.',
  // Styles in the page's order. t, c, v: the π_T, π_C and π_V columns; sr: uses the π_SR table.
  // fm: the MIL-HDBK-338B failure-mode row.
  styles: [
    { id: 'CP', spec: '25', group: 'Paper and plastic film', desc: 'Paper, DC, hermetic metal case', lb: 0.00037, t: 1, c: 1, v: 1, fm: 'Capacitor, Paper' },
    { id: 'CA', spec: '12889', group: 'Paper and plastic film', desc: 'Paper, RFI bypass, AC and DC, hermetic metal case', lb: 0.00037, t: 1, c: 1, v: 1, fm: 'Capacitor, Paper' },
    { id: 'CZ', name: 'CZ, CZR', spec: '11693', group: 'Paper and plastic film', desc: 'Feed-through, RFI, AC and DC, hermetic metal case', lb: 0.00037, t: 1, c: 1, v: 1, fm: 'Capacitor, Paper' },
    { id: 'CQ', name: 'CQ, CQR', spec: '19978', group: 'Paper and plastic film', desc: 'Plastic or paper-plastic, hermetic case', lb: 0.00051, t: 1, c: 1, v: 1, fm: 'Capacitor, Plastic' },
    { id: 'CH', spec: '18312', group: 'Paper and plastic film', desc: 'Metallised paper or plastic film, DC, hermetic metal case', lb: 0.00037, t: 1, c: 1, v: 1, fm: 'Capacitor, Plastic' },
    { id: 'CHR', spec: '39022', group: 'Paper and plastic film', desc: 'Metallised paper or plastic film, established reliability', lb: 0.00051, t: 1, c: 1, v: 1, fm: 'Capacitor, Plastic' },
    { id: 'CFR', spec: '55514', group: 'Paper and plastic film', desc: 'Plastic or metallised plastic film, DC, non-metal case', lb: 0.00051, t: 1, c: 1, v: 1, fm: 'Capacitor, Plastic' },
    { id: 'CRH', spec: '83421', group: 'Paper and plastic film', desc: 'Supermetallised plastic film, hermetic metal case', lb: 0.00051, t: 1, c: 1, v: 1, fm: 'Capacitor, Plastic' },
    { id: 'CM', spec: '5', group: 'Mica and glass', desc: 'Mica', lb: 0.00076, t: 2, c: 1, v: 2, fm: 'Capacitor, Mica/Glass' },
    { id: 'CMR', spec: '39001', group: 'Mica and glass', desc: 'Mica, established reliability', lb: 0.00076, t: 2, c: 1, v: 2, fm: 'Capacitor, Mica/Glass' },
    { id: 'CB', spec: '10950', group: 'Mica and glass', desc: 'Mica, button style', lb: 0.00076, t: 2, c: 1, v: 2, fm: 'Capacitor, Mica/Glass' },
    { id: 'CY', spec: '11272', group: 'Mica and glass', desc: 'Glass', lb: 0.00076, t: 2, c: 1, v: 2, fm: 'Capacitor, Mica/Glass' },
    { id: 'CYR', spec: '23269', group: 'Mica and glass', desc: 'Glass, established reliability', lb: 0.00076, t: 2, c: 1, v: 2, fm: 'Capacitor, Mica/Glass' },
    { id: 'CK', spec: '11015', group: 'Ceramic', desc: 'Ceramic, general purpose', lb: 0.00099, t: 2, c: 1, v: 3, fm: 'Capacitor, Ceramic' },
    { id: 'CKR', spec: '39014', group: 'Ceramic', desc: 'Ceramic, general purpose, established reliability', lb: 0.00099, t: 2, c: 1, v: 3, fm: 'Capacitor, Ceramic' },
    { id: 'CC', name: 'CC, CCR', spec: '20', group: 'Ceramic', desc: 'Ceramic, temperature compensating', lb: 0.00099, t: 2, c: 1, v: 3, fm: 'Capacitor, Ceramic' },
    { id: 'CDR', spec: '55681', group: 'Ceramic', desc: 'Ceramic chip, multilayer, established reliability', lb: 0.0020, t: 2, c: 1, v: 3, fm: 'Capacitor, Ceramic' },
    { id: 'CSR', spec: '39003', group: 'Tantalum', desc: 'Tantalum, solid electrolyte, established reliability', lb: 0.00040, t: 1, c: 2, v: 4, sr: true, fm: 'Capacitor, Tantalum' },
    { id: 'CWR', spec: '55365', group: 'Tantalum', desc: 'Tantalum chip, established reliability', lb: 0.00005, t: 1, c: 2, v: 4, sr: true, fm: 'Capacitor, Tantalum' },
    { id: 'CL', spec: '3965', group: 'Tantalum', desc: 'Tantalum, non-solid electrolyte', lb: 0.00040, t: 1, c: 2, v: 4, fm: 'Capacitor, Tantalum, Electrolytic' },
    { id: 'CLR', spec: '39006', group: 'Tantalum', desc: 'Tantalum, non-solid electrolyte, established reliability', lb: 0.00040, t: 1, c: 2, v: 4, fm: 'Capacitor, Tantalum, Electrolytic' },
    { id: 'CRL', spec: '83500', group: 'Tantalum', desc: 'Tantalum cathode, non-solid electrolyte', lb: 0.00040, t: 1, c: 2, v: 4, fm: 'Capacitor, Tantalum, Electrolytic' },
    { id: 'CU', name: 'CU, CUR', spec: '39018', group: 'Aluminium', desc: 'Aluminium oxide electrolytic', lb: 0.00012, t: 2, c: 2, v: 1, fm: 'Capacitor, Aluminum, Electrolytic' },
    { id: 'CE', spec: '62', group: 'Aluminium', desc: 'Aluminium electrolytic, dry electrolyte, polarised, DC', lb: 0.00012, t: 2, c: 2, v: 1, fm: 'Capacitor, Aluminum, Electrolytic' },
    { id: 'CV', spec: '81', group: 'Variable', desc: 'Variable ceramic (trimmer)', lb: 0.0079, t: 1, c: 1, v: 5, fm: null },
    { id: 'PC', spec: '14409', group: 'Variable', desc: 'Variable, piston (tubular trimmer)', lb: 0.0060, t: 2, c: 1, v: 5, fm: 'Capacitor, Variable, Piston' },
    { id: 'CT', spec: '92', group: 'Variable', desc: 'Variable, air dielectric (trimmer)', lb: 0.0000072, t: 2, c: 1, v: 5, fm: null },
    { id: 'CG', spec: '23183', group: 'Variable', desc: 'Fixed or variable, vacuum', lb: 0.0060, t: 1, c: 1, v: 5, fm: null },
  ],
  // π_T = exp(−Ea/k·[1/(T+273) − 1/298]); T is the capacitor's ambient temperature.
  ea: { 1: 0.15, 2: 0.35 },
  // π_C = C^x, C in µF.
  capExponent: { 1: 0.09, 2: 0.23 },
  // π_V = (S/a)^n + 1; S = (DC voltage + peak AC voltage) / rated voltage.
  voltage: { 1: [0.6, 5], 2: [0.6, 10], 3: [0.6, 3], 4: [0.6, 17], 5: [0.5, 3] },
  // π_SR by circuit resistance CR in Ω/V: upper bound of each band (inclusive) and π_SR.
  seriesResistance: [[0.1, 3.3], [0.2, 2.7], [0.4, 2.0], [0.6, 1.3], [0.8, 1.0], [Infinity, 0.66]],
  quality: [
    { id: 'D', label: 'D (established reliability)', piQ: 0.001 },
    { id: 'C', label: 'C (established reliability)', piQ: 0.01 },
    { id: 'S', label: 'S or B (established reliability)', piQ: 0.03 },
    { id: 'R', label: 'R (established reliability)', piQ: 0.1 },
    { id: 'P', label: 'P (established reliability)', piQ: 0.3 },
    { id: 'M', label: 'M (established reliability)', piQ: 1.0 },
    { id: 'L', label: 'L (established reliability)', piQ: 1.5 },
    { id: 'non-er', label: 'Non-established reliability (most two-letter styles)', piQ: 3.0 },
    { id: 'commercial', label: 'Commercial or unknown screening', piQ: 10 },
  ],
  piE: [1.0, 10, 20, 7.0, 15, 12, 15, 25, 30, 40, 0.50, 20, 50, 570],
};

export const RESISTORS_217F = {
  id: 'mil-resistor',
  title: 'Resistors',
  ref: 'MIL-HDBK-217F Notice 2, section 9.1',
  status: 'handbook',
  sources: ['mil217fN2'],
  note: 'One model for every resistor style, from the Notice 2 pages, which replace sections 9.0–9.17 of the 1991 edition. Each style names the π_T and π_S columns it uses; power-film resistors (RD) and thermistors (RTH) have no temperature factor, networks (RZ) and thermistors no stress factor. The page\'s π_P row printed as 0.13 W is 1/8 W. Commercial parts take π_Q = 10, so these rates are typically far above the IEC TR 62380 resistor rates.',
  // Styles in the page's order. t, s: the π_T and π_S columns (null: the factor is 1).
  // fm: the MIL-HDBK-338B failure-mode row.
  styles: [
    { id: 'RC', spec: '11', group: 'Composition', desc: 'Composition, insulated', lb: 0.0017, t: 1, s: 2, fm: 'Resistor, Composition' },
    { id: 'RCR', spec: '39008', group: 'Composition', desc: 'Composition, insulated, established reliability', lb: 0.0017, t: 1, s: 2, fm: 'Resistor, Composition' },
    { id: 'RL', spec: '22684', group: 'Film', desc: 'Film, insulated', lb: 0.0037, t: 2, s: 1, fm: 'Resistor, Film' },
    { id: 'RLR', spec: '39017', group: 'Film', desc: 'Film, insulated, established reliability', lb: 0.0037, t: 2, s: 1, fm: 'Resistor, Film' },
    { id: 'RNR', name: 'RN (R, C or N)', spec: '55182', group: 'Film', desc: 'Film, established reliability', lb: 0.0037, t: 2, s: 1, fm: 'Resistor, Film' },
    { id: 'RM', spec: '55342', group: 'Film', desc: 'Film chip, established reliability', lb: 0.0037, t: 2, s: 1, fm: 'Resistor, Film' },
    { id: 'RN', spec: '10509', group: 'Film', desc: 'Film, high stability', lb: 0.0037, t: 2, s: 1, fm: 'Resistor, Film' },
    { id: 'RD', spec: '11804', group: 'Film', desc: 'Film, power type', lb: 0.0037, t: null, s: 1, fm: 'Resistor, Film' },
    { id: 'RZ', spec: '83401', group: 'Film', desc: 'Network, film (one package)', lb: 0.0019, t: 1, s: null, fm: 'Resistor, Network' },
    { id: 'RB', spec: '93', group: 'Wirewound', desc: 'Wirewound, accurate', lb: 0.0024, t: 2, s: 1, fm: 'Resistor, Wirewound' },
    { id: 'RBR', spec: '39005', group: 'Wirewound', desc: 'Wirewound, accurate, established reliability', lb: 0.0024, t: 2, s: 1, fm: 'Resistor, Wirewound' },
    { id: 'RW', spec: '26', group: 'Wirewound', desc: 'Wirewound, power type', lb: 0.0024, t: 2, s: 2, fm: 'Resistor, Wirewound' },
    { id: 'RWR', spec: '39007', group: 'Wirewound', desc: 'Wirewound, power type, established reliability', lb: 0.0024, t: 2, s: 2, fm: 'Resistor, Wirewound' },
    { id: 'RE', spec: '18546', group: 'Wirewound', desc: 'Wirewound, power type, chassis mounted', lb: 0.0024, t: 2, s: 2, fm: 'Resistor, Wirewound' },
    { id: 'RER', spec: '39009', group: 'Wirewound', desc: 'Wirewound, power type, chassis mounted, established reliability', lb: 0.0024, t: 2, s: 2, fm: 'Resistor, Wirewound' },
    { id: 'RTH', spec: '23648', group: 'Thermistor', desc: 'Thermistor, insulated', lb: 0.0019, t: null, s: null, fm: null },
    { id: 'RT', spec: '27208', group: 'Variable', desc: 'Variable wirewound, lead-screw', lb: 0.0024, t: 2, s: 1, fm: 'Resistor, Variable' },
    { id: 'RTR', spec: '39015', group: 'Variable', desc: 'Variable wirewound, lead-screw, established reliability', lb: 0.0024, t: 2, s: 1, fm: 'Resistor, Variable' },
    { id: 'RR', spec: '12934', group: 'Variable', desc: 'Variable wirewound, precision', lb: 0.0024, t: 2, s: 1, fm: 'Resistor, Variable' },
    { id: 'RA', spec: '19', group: 'Variable', desc: 'Variable wirewound, low operating temperature', lb: 0.0024, t: 1, s: 1, fm: 'Resistor, Variable' },
    { id: 'RK', spec: '39002', group: 'Variable', desc: 'Variable wirewound, semi-precision', lb: 0.0024, t: 1, s: 1, fm: 'Resistor, Variable' },
    { id: 'RP', spec: '22', group: 'Variable', desc: 'Wirewound, power type', lb: 0.0024, t: 2, s: 1, fm: 'Resistor, Variable' },
    { id: 'RJ', spec: '22097', group: 'Variable', desc: 'Variable non-wirewound (cermet trimmer)', lb: 0.0037, t: 2, s: 1, fm: 'Resistor, Variable' },
    { id: 'RJR', spec: '39035', group: 'Variable', desc: 'Variable non-wirewound, established reliability', lb: 0.0037, t: 2, s: 1, fm: 'Resistor, Variable' },
    { id: 'RV', spec: '94', group: 'Variable', desc: 'Variable composition', lb: 0.0037, t: 2, s: 1, fm: 'Resistor, Variable' },
    { id: 'RQ', spec: '39023', group: 'Variable', desc: 'Variable non-wirewound, precision', lb: 0.0037, t: 1, s: 1, fm: 'Resistor, Variable' },
    { id: 'RVC', spec: '23285', group: 'Variable', desc: 'Variable non-wirewound', lb: 0.0037, t: 1, s: 1, fm: 'Resistor, Variable' },
  ],
  // π_T = exp(−Ea/k·[1/(T+273) − 1/298]); T is the resistor's case temperature.
  ea: { 1: 0.2, 2: 0.08 },
  // π_P = P^0.39, P the dissipated power in watts.
  powerExponent: 0.39,
  // π_S = a·e^(b·S), S = dissipated power / rated power.
  stress: { 1: [0.71, 1.1], 2: [0.54, 2.04] },
  quality: [
    { id: 'S', label: 'S (established reliability)', piQ: 0.03 },
    { id: 'R', label: 'R (established reliability)', piQ: 0.1 },
    { id: 'P', label: 'P (established reliability)', piQ: 0.3 },
    { id: 'M', label: 'M (established reliability)', piQ: 1.0 },
    { id: 'non-er', label: 'Non-established reliability (most two-letter styles)', piQ: 3.0 },
    { id: 'commercial', label: 'Commercial or unknown screening', piQ: 10 },
  ],
  piE: [1.0, 4.0, 16, 12, 42, 18, 23, 31, 43, 63, 0.50, 37, 87, 1728],
};

export const TABLES_217F = [
  RELAY_MECHANICAL, RELAY_SOLID_STATE, SWITCHES, CONNECTORS, SOCKETS, PTH_BOARDS,
  CRYSTALS, FUSES, LAMPS, OPTOELECTRONICS, CAPACITORS_217F, RESISTORS_217F,
];
