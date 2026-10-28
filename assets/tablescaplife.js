// Aluminium electrolytic capacitor life: the makers' published wear-out rules
// for wet (non-solid), conductive polymer and hybrid capacitors. A rule is
// 'corroborated' when three or more makers publish it independently; 'maker'
// is one maker's rule, used here for every maker's parts.

export const SOURCES_CAPLIFE = {
  nccTn: {
    label: 'Nippon Chemi-Con, "Technical Note" (aluminium electrolytic capacitors), CAT. No. E1001A, 2026, pp. 6–8',
    url: 'https://www.chemi-con.co.jp/products/relatedfiles/capacitor/catalog/al-technote-e.pdf',
  },
  nccCp: {
    label: 'Nippon Chemi-Con, "Lifetime Estimation of Conductive Polymer Aluminum Solid Capacitors", CAT. No. E1001A, 2026',
    url: 'https://www.chemi-con.co.jp/products/relatedfiles/capacitor/catalog/al-lifetimecp-e.pdf',
  },
  nccHy: {
    label: 'Nippon Chemi-Con, "Lifetime Estimation of Conductive Polymer Hybrid Aluminum Electrolytic Capacitors", CAT. No. E1001A, 2026',
    url: 'https://www.chemi-con.co.jp/products/relatedfiles/capacitor/catalog/al-lifetimehybrid-e.pdf',
  },
  nccPxy: {
    label: 'Nippon Chemi-Con, PXY series (conductive polymer) data sheet, 2026 catalogue',
    url: 'https://www.chemi-con.co.jp/products/relatedfiles/capacitor/catalog/PXYRA-e.PDF',
  },
  nccHxd: {
    label: 'Nippon Chemi-Con, HXD series (hybrid) data sheet, 2026 catalogue',
    url: 'https://www.chemi-con.co.jp/products/relatedfiles/capacitor/catalog/HXDRA-e.PDF',
  },
  nicTn: {
    label: 'Nichicon, "General Descriptions of Aluminum Electrolytic Capacitors", Technical Notes CAT.8101E, pp. 20–24',
    url: 'https://www.nichicon.co.jp/english/products/pdf/aluminum-e.pdf',
  },
  nicFp: {
    label: 'Nichicon (FPCAP), "FPCAP Technical Guide" (functional polymer capacitors), 2013, p. 56',
    url: 'https://www.nichicon.co.jp/english/products/pdf/2013fpcap_catalog_05.pdf',
  },
  nicPc: {
    label: 'Nichicon, "Conductive Polymer Aluminum Solid Electrolytic Capacitors" catalogue, CAT.8100L, 2022',
    url: 'https://www.nichicon.co.jp/english/products/pdf_x/Conductive_Polymer_Aluminum_Solid_Electrolytic_Capacitors_E.pdf',
  },
  nicHy: {
    label: 'Nichicon, "Conductive Polymer Hybrid Aluminum Electrolytic Capacitors" catalogue, 2024',
    url: 'https://www.nichicon.com/getmedia/bf6a4a11-1a12-49ef-a02a-dfd185bc6e42/e-hybrid_aluminum.pdf',
  },
  rubTn: {
    label: 'Rubycon, "Aluminum Electrolytic Capacitor – Technical Notes", doc. 3925-1e, 2023, pp. 20–25',
    url: 'https://www.rubycon.co.jp/wp-content/uploads/products-aluminum/al-technical-note_en.pdf',
  },
  rubHy: {
    label: 'Rubycon, PZ-CAP conductive polymer hybrid catalogue, 2025, pp. 33–35',
    url: 'https://www.rubycon.co.jp/wp-content/uploads/catalog/hybrid-catalog.pdf',
  },
  cdeRel: {
    label: 'S. G. Parler, "Reliability of CDE Aluminum Electrolytic Capacitors", Cornell Dubilier, 2004, pp. 2 and 8',
    url: 'https://www.cde.com/resources/technical-papers/reliability.pdf',
  },
  cdeAg: {
    label: 'Cornell Dubilier, "Aluminum Electrolytic Capacitor Application Guide", R2, 2025, pp. 12–14',
    url: 'https://www.cde.com/resources/technical-papers/KNO_CD_AEappGuide_R2.pdf',
  },
  kemEsc: {
    label: 'KEMET, ESC radial aluminium electrolytic capacitors, data sheet A4006, 2026, pp. 5, 16',
    url: 'https://content.kemet.com/datasheets/KEM_A4006_ESC.pdf',
  },
  kemA758: {
    label: 'KEMET, A758 solid polymer aluminium capacitors, data sheet A4069, 2026, pp. 5, 9',
    url: 'https://content.kemet.com/datasheets/KEM_A4069_A758.pdf',
  },
  visIntro: {
    label: 'Vishay BCcomponents, "Introduction" (aluminium capacitors), doc. 28356, 2026, pp. 8–10',
    url: 'https://www.vishay.com/docs/28356/alucapsintrobcc.pdf',
  },
  vis136: {
    label: 'Vishay BCcomponents, 136 RVI data sheet, doc. 28321, 2021, p. 10',
    url: 'https://www.vishay.com/docs/28321/136rvi.pdf',
  },
  vis180: {
    label: 'Vishay BCcomponents, 180 CPS conductive polymer capacitors, doc. 28415, 2024, pp. 7–8',
    url: 'https://www.vishay.com/docs/28415/180cps.pdf',
  },
  vis182: {
    label: 'Vishay BCcomponents, 182 CPHZ hybrid capacitors, doc. 28433, 2023, p. 5',
    url: 'https://www.vishay.com/docs/28433/182cphz.pdf',
  },
  visOscon: {
    label: 'Vishay, "Reliability, Vishay OS-CON", doc. 90017, 2014',
    url: 'https://www.vishay.com/docs/90017/reliabilityoscon.pdf',
  },
  panEuPoly: {
    label: 'Panasonic Industry Europe, polymer capacitors brochure, 2025, p. 2',
    url: 'https://industry.panasonic.eu/storage/custom-upload/Components/Capacitors/Polymer%20capacitors/Polymer_Capacitor_4p.pdf',
  },
  nasaApc: {
    label: 'A. Teverovsky, "Evaluation of Aluminum Polymer Capacitors for Space Applications", NASA/TM—20240011830, 2024',
    url: 'https://nepp.nasa.gov/docs/tasks/005a-APC-Aluminum-Polymer-Capacitors/NASA-TM-2024-Teverovsky-Paper-Aluminum-Polymer-Capacitors-20240011830.pdf',
  },
};

// Life L = L0 · base^((T0 − Ta)/step + (ΔT_rated − ΔT)/rippleStep): rated life
// L0 at rated temperature T0, ambient Ta, ripple self-heating ΔT and, when the
// rated life includes rated ripple, its rise ΔT_rated.
export const LIFE_RULES = {
  id: 'caplife-temperature',
  title: 'Aluminium capacitor life: temperature rules',
  ref: 'Makers\' life formulas for wet, polymer and hybrid capacitors',
  status: 'corroborated',
  sources: ['nccTn', 'nicTn', 'rubTn', 'cdeAg', 'kemEsc', 'visIntro', 'panEuPoly', 'nicFp', 'kemA758', 'vis180', 'visOscon', 'nccHy', 'rubHy', 'vis182'],
  note: 'Wet: life doubles for every 10 °C cooler (Chemi-Con, Nichicon, Rubycon, Cornell Dubilier, KEMET, Vishay). Polymer: life ×10 for every 20 °C cooler (Panasonic, Nichicon, KEMET, Vishay). Hybrid: life doubles for every 10 °C cooler (Chemi-Con, Rubycon, Panasonic, Vishay). Chemi-Con uses 1.7 instead of 2 for its smallest hybrid cases, and Vishay\'s nomograms give more life than the 10 °C rule at low temperature. Voltage below the rating has no effect on small low-voltage parts (Chemi-Con, Nichicon, Rubycon); Cornell Dubilier and Rubycon publish voltage factors for large high-voltage parts, which are not included.',
  rules: {
    wet: { label: 'Wet (non-solid) electrolyte', base: 2, step: 10, rippleStep: 5 },
    polymer: { label: 'Conductive polymer (solid)', base: 10, step: 20, rippleStep: 20 },
    hybrid: { label: 'Hybrid (polymer and liquid)', base: 2, step: 10, rippleStep: 10 },
  },
};

export const POLYMER_SLOW = {
  id: 'caplife-polymer-slow',
  title: 'Polymer capacitors: the slower rule (×2 per 10 °C)',
  ref: 'Nippon Chemi-Con\'s polymer life formula; NASA measurements',
  status: 'maker',
  sources: ['nccCp', 'nasaApc'],
  note: 'Chemi-Con halves polymer life for every 10 °C, with ripple heating counted like ambient. NASA measured an activation energy of about 0.73 eV, which is closer to this rule than to ×10 per 20 °C. Running 20 °C below the rating, this rule gives 4 × the rated life where the majority rule gives 10 ×. Offered as an option.',
  rule: { base: 2, step: 10, rippleStep: 10 },
};

export const LIFE_LIMITS = {
  id: 'caplife-limits',
  title: 'Where the rules apply: 40 °C floor, 15-year cap',
  ref: 'Makers\' stated limits of their life formulas',
  status: 'corroborated',
  sources: ['nccTn', 'nicTn', 'kemEsc', 'rubTn', 'rubHy', 'nccCp', 'visOscon'],
  note: 'Below 40 °C ambient the life is worked out at 40 °C (Chemi-Con, Nichicon, KEMET; Rubycon for hybrids). A calculated life over 15 years is taken as 15 years, because the seal ages (Chemi-Con, Nichicon, Rubycon; Vishay for OS-CON). Both limits are applied to all three kinds here; for polymer parts each is stated by two makers.',
  floor: 40,
  capYears: 15,
};

export const RIPPLE_RISE = {
  id: 'caplife-ripple',
  title: 'Ripple self-heating: ΔT = ΔT₀·(I/I_rated)²',
  ref: 'Makers\' ripple heating rules',
  status: 'corroborated',
  sources: ['nccTn', 'nicTn', 'rubTn', 'nicFp', 'nccCp', 'nccHy', 'rubHy'],
  note: 'The core rises by ΔT₀ at the rated ripple current (frequency-corrected with the catalogue multiplier) and with the square of the current (Chemi-Con, Nichicon, Rubycon). ΔT₀ is per series and few makers print it: Nichicon gives about 5 °C for 105 °C snap-in parts, and about 20 °C (cans) or 10 °C (moulded chips) for polymer; Chemi-Con 20 °C for polymer. For polymer and hybrid parts the rise counts like ambient (Nichicon, Chemi-Con, Rubycon).',
};

export const RIPPLE_WET = {
  id: 'caplife-ripple-wet',
  title: 'Wet capacitors: ripple heating halves life every 5 °C',
  ref: 'Nippon Chemi-Con Technical Note, equations 17 and 18',
  status: 'maker',
  sources: ['nccTn', 'cdeAg', 'rubTn'],
  note: 'Makers agree that ripple heating shortens a wet capacitor\'s life more than the same rise in ambient, but not by how much: Chemi-Con halves life every 5 °C, Cornell Dubilier every 6.7 °C (the rise × 1.5), Rubycon uses a curve that steepens with the rise, and Nichicon\'s constant is not published. Chemi-Con\'s, the harshest, is used.',
};

export const END_OF_LIFE = {
  id: 'caplife-end',
  title: 'End of life: the drift limits behind a rated life',
  ref: 'Makers\' endurance test criteria',
  status: 'corroborated',
  sources: ['kemEsc', 'vis136', 'nccPxy', 'nicPc', 'kemA758', 'nccHxd', 'nicHy', 'vis182'],
  note: 'Typical endurance limits: wet, capacitance within ±20 % and tan δ up to 2 × its limit (KEMET, Vishay); polymer, capacitance within ±20 % and ESR up to 1.5 × (Chemi-Con, Nichicon, KEMET); hybrid, capacitance within ±30 % and ESR up to 2 × (Chemi-Con, Nichicon, Vishay). Each series states its own.',
  criteria: {
    wet: 'capacitance within ±20 %, tan δ up to 2 × its limit',
    polymer: 'capacitance within ±20 %, ESR up to 1.5 × its limit',
    hybrid: 'capacitance within ±30 %, ESR up to 2 × its limit',
  },
};

// From a life to a rate: the spread of wear-out times around the calculated life.
export const WEAROUT = {
  id: 'caplife-wearout',
  title: 'Wear-out spread: normal, mean 1.2 × the life, deviation 0.1 × the life',
  ref: 'Cornell Dubilier reliability paper, pp. 2 and 8',
  status: 'maker',
  sources: ['cdeRel', 'nicTn'],
  note: 'Cornell Dubilier models the time to wear-out as normal, with mean 1.2 L and standard deviation 0.1 L for a calculated life L, so that no more than 10 % have worn out by L and about 1 % by 0.9 L. Nichicon\'s one published life test is similarly steep (Weibull shape 11.7). The share worn out by the end of the mission, F, counts as the average rate −ln(1 − F)/T over the mission length T, so the board\'s survival over the mission comes out right. Used for wet, polymer and hybrid parts alike; no maker publishes the spread for polymer or hybrid parts. The MIL-HDBK-217F 16.2 averaging used for solder joints is not used here: it assumes a gradual wear-out and would charge thousands of FIT to a capacitor whose life comfortably exceeds the mission.',
  meanFactor: 1.2,
  sdFactor: 0.1,
};

export const TABLES_CAPLIFE = [LIFE_RULES, POLYMER_SLOW, LIFE_LIMITS, RIPPLE_RISE, RIPPLE_WET, END_OF_LIFE, WEAROUT];
