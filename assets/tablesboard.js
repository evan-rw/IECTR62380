// Circuit-board data: the plated-through-hole fatigue model (IPC-TR-579, as
// published in open papers), the copper plating properties, and a small
// laminate library from manufacturers' data sheets. Each table names its
// sources; status 'published' means taken from a paper or data sheet.

export const SOURCES_BOARD = {
  sharon2014: {
    label: 'G. Sharon, "Temperature Cycling and Fatigue in Electronics", DfR Solutions, SMTA International 2014 (equations of IPC-TR-579)',
    url: 'https://smtnet.com/library/files/upload/Temp-Cycling-and-Electronics-Fatigue.pdf',
  },
  brillhart2002: {
    label: 'M. Brillhart, M. Hu, S. Teng, "Experimental and Numerical Assessment of Plated Via Reliability", IPC APEX 2002, S12-3 (Engelmaier copper fatigue; FR-4 and copper properties)',
    url: 'https://www.electronics.org/system/files/technical_resource/E24&00025.pdf',
  },
  sharonKq: {
    label: 'G. Sharon, "Plated Through Hole Quality Factor", 2023 (IPC-TR-579 quality index bands)',
    url: 'https://www.linkedin.com/pulse/plated-through-hole-quality-factor-gil-sharon',
  },
  isola370hr: {
    label: 'Isola 370HR laminate and prepreg data sheet, revision C, April 2021',
    url: 'https://www.isola-group.com/wp-content/uploads/data-sheets/370hr.pdf',
  },
  arlon85n: {
    label: 'Arlon 85N polyimide laminate and prepreg data sheet, version 1.7, 2025',
    url: 'https://www.arlonemd.com/wp-content/uploads/2025/02/85N-v1.7.pdf',
  },
  rogers4000: {
    label: 'Rogers RO4000 laminates (RO4003C and RO4350B) data sheet',
    url: 'https://www.eurocircuits.com/content/uploads/2025/02/RO4000-Laminates-Data-sheet.pdf',
  },
};

// IPC-TR-579 plated-through-hole fatigue: barrel stress from the z-axis
// expansion mismatch (elastic, or bilinear above yield), strain range, the
// calibration K_d·10/K_Q, and Engelmaier's copper fatigue equation solved for N_f.
export const PTH_MODEL = {
  id: 'board-pth',
  title: 'Plated-through-hole barrel fatigue',
  ref: 'IPC-TR-579 model (1988), as published by Sharon (2014) and Brillhart et al. (2002)',
  status: 'published',
  sources: ['sharon2014', 'brillhart2002', 'sharonKq'],
  note: 'σ = (α_E − α_Cu)ΔT·A_E·E_E·E_Cu/(A_E·E_E + A_Cu·E_Cu) up to copper yield, bilinear above; A_E = π/4·[(h + d)² − d²], A_Cu = π/4·[d² − (d − 2t)²]; Δε_eff = Δε·K_d·10/K_Q; N_f^−0.6·D_f^0.75 + 0.9·(S_u/E_Cu)·[e^D_f/0.36]^(0.1785·log(10⁵/N_f)) = Δε_eff. The z-axis expansion is integrated across Tg. The round-robin behind it covered 0.25–0.5 mm holes in 0.75–2.25 mm boards with 20–32 µm plating, 1986–1988; it assumes elastic behaviour below yield and does not cover pads, fills or hole spacing. No published worked example with full inputs was found to check against.',
  // Calibration ranges as published.
  strainDistribution: { min: 2.5, max: 5.0 },
  qualityBands: [
    { min: 7.5, label: 'superior' }, { min: 6.0, label: 'good' }, { min: 3.5, label: 'marginal' }, { min: 0, label: 'poor' },
  ],
};

// Electroplated copper in the barrel (Brillhart et al. 2002, Table 1). Ultimate
// strength and ductility vary by plating process and are entered per board.
export const COPPER = {
  id: 'board-copper',
  title: 'Electroplated copper (barrel)',
  ref: 'Brillhart et al. (2002), Table 1',
  status: 'published',
  sources: ['brillhart2002'],
  note: 'Young\'s modulus, expansion, yield stress and tangent (plastic) modulus. Ultimate strength and ductility are not given there and depend on the plating process, so they are entered from the fabricator\'s data.',
  modulus: 124000,
  alpha: 17,
  yield: 250,
  tangent: 1170,
};

// Laminates: glass transition, z-axis expansion below and above Tg (ppm/°C), and
// z-axis modulus (MPa). Only the FR-4 entry has a published z-axis modulus; the
// others use it as a stand-in, which the page says.
export const LAMINATES = {
  id: 'board-laminates',
  title: 'Laminates: glass transition and z-axis expansion',
  ref: 'Manufacturers\' data sheets; FR-4 from Brillhart et al. (2002)',
  status: 'published',
  sources: ['brillhart2002', 'isola370hr', 'arlon85n', 'rogers4000'],
  note: 'Typical values, not guaranteed by the makers. The z-axis modulus is published only for the FR-4 entry (8.48 GPa at −55 °C, 6.76 GPa at 125 °C, interpolated to 7.7 GPa at 25 °C) and is used for the others as a stand-in. RO4350B quotes one expansion from −55 to 288 °C, above its Tg of over 280 °C.',
  rows: [
    { id: 'fr4', label: 'FR-4, standard (Tg 140 °C)', tg: 140, alpha1: 70, alpha2: 300, modulus: 7700, source: 'brillhart2002' },
    { id: 'isola-370hr', label: 'Isola 370HR, high-Tg FR-4 (Tg 180 °C)', tg: 180, alpha1: 45, alpha2: 230, modulus: 7700, modulusAssumed: true, source: 'isola370hr' },
    { id: 'arlon-85n', label: 'Arlon 85N polyimide (Tg 250 °C)', tg: 250, alpha1: 55, alpha2: 149, modulus: 7700, modulusAssumed: true, source: 'arlon85n' },
    { id: 'ro4350b', label: 'Rogers RO4350B (Tg over 280 °C)', tg: 280, alpha1: 32, alpha2: 32, modulus: 7700, modulusAssumed: true, source: 'rogers4000' },
  ],
};

export const TABLES_BOARD = [PTH_MODEL, COPPER, LAMINATES];
