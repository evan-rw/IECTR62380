// Makers' failure-rate models for tantalum, niobium oxide and ceramic
// capacitors, and the board-flex limits of ceramic chips. Each tantalum curve is
// one maker's (or NASA's) published model, offered as a choice because they
// disagree by up to 1000 × at derated voltage; the ceramic life-test method is
// corroborated.

export const SOURCES_MAKER = {
  kemT52x: {
    label: 'KEMET (YAGEO), "KEMET Organic Capacitor (KO-CAP) T52X/T530 Polymer Electrolytic Capacitors", data sheet T2076, 2026-09-09, p. 7',
    url: 'https://content.kemet.com/datasheets/KEM_T2076_T52X-530.pdf',
  },
  kemT599an: {
    label: 'KEMET (YAGEO), "T599 Tantalum Polymer Capacitors in Automotive Designs" application note, 2020 (revised 2025-11-13), pp. 3–4',
    url: 'https://www.tti.com/content/dam/tti-commons/supplier/kemet/doc/kemet-t599-tantalum-capacitor-automotive-application-note.pdf',
  },
  kemT599web: {
    label: 'KEMET, "T599 Tantalum Polymer Capacitors in Automotive Designs" web page, FIT tables for two mission profiles (archived copy)',
    url: 'https://web.archive.org/web/20250731151318/https://www.kemet.com/en/us/technical-resources/t599-tantalum-polymer-capacitors-in-automotive-designs.html',
  },
  kemT59x: {
    label: 'KEMET (YAGEO), T59X automotive polymer tantalum capacitors, data sheet T2073, 2025-11-03, p. 5',
    url: 'https://content.kemet.com/datasheets/KEM_T2073_T59X.pdf',
  },
  vis40292: {
    label: 'Vishay, J. Rhan, "Derating Tantalum Capacitors Depends On The Cathode System", white paper 40292, rev. 19-Jul-2024, pp. 1–2 (Fig. 1)',
    url: 'https://www.vishay.com/docs/40292/deratantcapsdeponcathsys.pdf',
  },
  vis40246: {
    label: 'Vishay, I. Litvachuck, "Solid Tantalum Capacitors (With MnO2 Electrolyte) Voltage Derating", technical note 40246, rev. 07-Sep-2022, pp. 1–3',
    url: 'https://www.vishay.com/docs/40246/tantcapsvoltderautoindapp.pdf',
  },
  nasaPtc: {
    label: 'A. Teverovsky, "Guidelines for Screening, Lot Acceptance, and Derating for Polymer Tantalum Capacitors", NASA/TM-20220019033, 2023, PDF pp. 12, 21–22',
    url: 'https://ntrs.nasa.gov/api/citations/20220019033/downloads/20220019033-Teverovsky-2023-NASA-TP-Guidelines-Screening-PTC_v3.pdf',
  },
  nasaPcns: {
    label: 'Y. Eidelman, Y. Zlatopolsky (Vishay) and A. Teverovsky (NASA), "Acceleration Factors for Reliability Assessment of Polymer Tantalum Capacitors", PCNS 2021, pp. 1–9',
    url: 'https://ntrs.nasa.gov/api/citations/20210017867/downloads/Teverovsky-2021-PCNS-Paper-Polymer.pdf',
  },
  nasaRams: {
    label: 'A. Teverovsky, "Degradation of Leakage Currents and Reliability Prediction for Tantalum Capacitors", RAMS 2016, Table 1',
    url: 'https://ntrs.nasa.gov/citations/20160001192',
  },
  avxRmtant: {
    label: 'C. Reynolds (KYOCERA AVX), "Reliability Management of Tantalum Capacitors", technical paper, p. 3, Graphs 2a–2c (each caption sits under the next graph; the axes identify them)',
    url: 'https://www.kyocera-avx.com/docs/techinfo/Tantalum-NiobiumCapacitors/rmtant.pdf',
  },
  avxDerating: {
    label: 'T. Zedníček and J. Gill (KYOCERA AVX), "Voltage Derating Rules for Solid Tantalum and Niobium Capacitors", technical paper, CARTS Europe 2003, pp. 5–6',
    url: 'https://www.kyocera-avx.com/docs/techinfo/Tantalum-NiobiumCapacitors/voltaged.pdf',
  },
  avxCat: {
    label: 'KYOCERA AVX, "Polymer, Tantalum and Niobium Oxide Capacitors" catalogue (2022), Technical Summary and Application Guidelines, section 3, pp. 250–251 (Figs. 2a, 3 and 4, and the worked example)',
    url: 'https://www.farnell.com/datasheets/3895857.pdf',
  },
  kemFitMan: {
    label: 'J. D. Prymak (KEMET), "FIT Calculator Software" manual, version 3.5, March 2012, p. 5 (archived copy)',
    url: 'https://web.archive.org/web/20250731052213/https://www.kemet.com/content/dam/kemet/lightning/tools/FIT-Calculator-Software-3.5.31.pdf',
  },
  avxNoj: {
    label: 'KYOCERA AVX, "OxiCap NOJ Series" data sheet TDS-PTNO-0020 rev. 2, p. 1 ("Reliability")',
    url: 'https://datasheets.kyocera-avx.com/NOJ.pdf',
  },
  avxNos: {
    label: 'KYOCERA AVX, "OxiCap NOS Series" data sheet TDS-PTNO-0022 rev. 2, p. 1 ("Reliability")',
    url: 'https://datasheets.kyocera-avx.com/NOS.pdf',
  },
  panPoscap: {
    label: 'Panasonic Industry, "Conductive Polymer Tantalum Solid Capacitors (POSCAP) Technical guide", revision 2026-04-01, p. 4, Table 4-1 (sent by e-mail on request)',
    url: 'https://industrial.panasonic.com/ww/ds/library/POSCAP_TechnicalGuide',
  },
  knowles: {
    label: 'Knowles (Syfer), "Quality & Reliability Data", application note AN0004, issue 12, 2018, pp. 5–7',
    url: 'https://www.knowlescapacitors.com/getmedia/56d014a3-7fce-454a-bdaf-146b89dd38cd/an0004',
  },
  samsungFaq: {
    label: 'Samsung Electro-Mechanics, FAQ "How does Samsung Electro-Mechanics estimate the lifetime of MLCCs"',
    url: 'https://www.samsungsem.com/global/support/contact-us/faq.do?category=&searchInput=MTTF&page=1',
  },
  murataFaq: {
    label: 'Murata, FAQ "Are there any methods for estimating the lifetime of a capacitor?" (ceramic capacitors, qlty/0010)',
    url: 'https://www.murata.com/en-global/support/faqs/capacitor/ceramiccapacitor/qlty/0010',
  },
  avxRawal: {
    label: 'B. S. Rawal and N. H. Chan (AVX), "Conduction and Failure Mechanisms in Barium Titanate Based Ceramics Under Highly Accelerated Conditions", KYOCERA AVX technical paper, p. 4',
    url: 'https://www.kyocera-avx.com/docs/techinfo/CeramicCapacitors/barium.pdf',
  },
  nasaLiu: {
    label: 'D. Liu and M. Sampson, "Reliability Evaluation of BME MLCCs for Potential Space Applications", CARTS 2011, pp. 14–15',
    url: 'https://ntrs.nasa.gov/api/citations/20110008356/downloads/20110008356.pdf',
  },
  nasaMlcc: {
    label: 'A. Teverovsky, "Guidelines for Selection, Screening and Qualification of Low-Voltage Commercial MLCCs for Space Programs", rev. A, NASA, pp. 3, 12',
    url: 'https://ntrs.nasa.gov/api/citations/20130000834/downloads/20130000834.pdf',
  },
  nims: {
    label: 'NIMS, VAMAS TWA24, "Standardization Activities of Reliability Evaluation Methods for MLCCs", Materials Standardization Activities Report 2023, Table 1',
    url: 'https://www.nims.go.jp/vamas/en/news/gfilkv0000000023-att/en_topics_adachi.pdf',
  },
  vis45261: {
    label: 'Vishay, B. Ward, "Reliability of Lead (Pb)-Bearing Vishay Automotive Grade MLCCs", white paper 45261, rev. 16-Mar-2021, Table 1',
    url: 'https://www.vishay.com/docs/45261/relofpbbearingvisagmlccs.pdf',
  },
  kyoFlex: {
    label: 'KYOCERA, "Soft Termination MLCC Solves the Substrate Warping Crack Problem" (FLEXITERM)',
    url: 'https://ele.kyocera.com/en/technical/kavx_resinele',
  },
  tdkSoft: {
    label: 'TDK Electronics, "Soft-termination MLCCs with high flex cracking resistance", 2014',
    url: 'https://www.tdk-electronics.tdk.com/en/374108/tech-library/articles/products-technologies/products-technologies/soft-termination-mlccs-with-high-flex-cracking-resistance/980870',
  },
  samsungBend: {
    label: 'Samsung Electro-Mechanics, "MLCC with a High Tolerance to Mechanical Stress" (high bending strength)',
    url: 'https://www.samsungsem.com/global/product/passive-component/mlcc/high-bending-strength.do',
  },
  nasaCrack: {
    label: 'A. Teverovsky, "Cracking Problems in Low-Voltage Chip Ceramic Capacitors", NEPP, 2019, pp. 30–31',
    url: 'https://ntrs.nasa.gov/api/citations/20190001592/downloads/20190001592.pdf',
  },
  avxCracks: {
    label: 'J. Maxwell (KYOCERA AVX), "Cracks: The Hidden Defect", technical paper, p. 8',
    url: 'https://www.kyocera-avx.com/docs/techinfo/CeramicCapacitors/cracks.pdf',
  },
  murataLayout: {
    label: 'Murata, "What kind of layout helps prevent chip MLCCs from cracking?"',
    url: 'https://article.murata.com/en-eu/article/layout-helps-prevent-chip-mlcc-from-cracking',
  },
  tiSnaa391: {
    label: 'Texas Instruments, "High Reliable BAW Oscillator MTBF and FIT Rate Calculations", application note SNAA391, June 2023, pp. 2–4',
    url: 'https://www.ti.com/lit/pdf/snaa391',
  },
  sitimeAn10025: {
    label: 'SiTime, "Reliability Calculations for SiTime Oscillators", application note SiT-AN10025 rev. 2.0, March 2015, pp. 2–3',
    url: 'https://www.sitime.com/sites/default/files/hiddenresources/AN10025-SiTime-Reliability-Calculations_SIT.pdf',
  },
  sitimeRr32: {
    label: 'SiTime, reliability report RR-32 rev. A13 (SiT1408, SiT1602, SiT8008), February 2022, p. 1',
    url: 'https://www.sitime.com/sites/default/files/RR32-SiT1408-SiT1602-SiT8008-Product-Qualification-Report.pdf',
  },
  vishay72559: {
    label: 'Vishay Siliconix, "Silicon Technology Reliability", document 72559, revision 29-Jul-08',
    url: 'https://www.vishay.com/docs/72559/72559.pdf',
  },
};

// ---------------------------------------------------------------------------
// Tantalum

// KEMET polymer: MIL-HDBK-217F Notice 2's CWR model as KEMET applies it to its
// polymer parts, with π_V = (S/vRef)^17 + 1 and π_Q = piQ; π_T below tRoom uses tRoom.
export const TANT_KEMET = {
  id: 'tant-kemet',
  title: 'Polymer tantalum: KEMET\'s FIT method (MIL-HDBK-217F CWR, changed for polymer)',
  ref: 'KEMET T599 application note, pp. 3–4, and the T599 web page\'s FIT tables',
  status: 'published',
  sources: ['kemT599an', 'kemT599web', 'kemFitMan', 'kemT52x', 'kemT59x'],
  note: 'KEMET estimates a polymer tantalum part\'s FIT with MIL-HDBK-217F Notice 2\'s chip-tantalum (CWR) model, λ = λ_b·π_T·π_C·π_V·π_SR·π_Q·π_E with λ_b 0.00005, π_T from 0.15 eV, π_C = C^0.23 and the π_SR bands, changed in two places: π_V = (S/0.8)^17 + 1 instead of (S/0.6)^17 + 1, "because the dielectric quality … is so much better" (FIT calculator manual), and π_Q = √0.5 = 0.707 for KEMET\'s 0.5 %/1000 h established rate. Below 23 °C the 23 °C factor is used ("use RT calculation"). KEMET assumes ground, benign (π_E 1); this page uses the board\'s MIL-HDBK-217F environment, as for the other 217F parts. It reproduces KEMET\'s printed mission-profile example, 0.574 FIT, and its older one, 0.900 FIT, within 0.6 % (that table used 20 °C as room temperature). KEMET\'s data-sheet factor (U_C/U_A)¹⁶ × Arrhenius 1.4 eV stretches the 2000 h qualification life; it is not a failure-rate model, and dividing the 0.5 %/1000 h rate by it, as this page did before, gave from 3 × more to 37 × less than KEMET\'s own FIT.',
  vRef: 0.8,
  piQ: 0.707,
  tRoom: 23,
};

// Vishay MnO2 nomograph: log10 F = a + b·T + c·(V/V_R), F × 1 %/1000 h.
export const TANT_VISHAY = {
  id: 'tant-vishay',
  title: 'MnO₂ tantalum: Vishay\'s correction-factor nomograph',
  ref: 'Vishay white paper 40292, Fig. 1; technical note 40246, p. 3',
  status: 'chart',
  sources: ['vis40292', 'vis40246', 'nasaRams', 'kemFitMan'],
  note: 'The nomograph is vector artwork, so its scales were measured exactly: log10 F = −10.864 + 0.0525·T + 6.421·V/V_R, about ±5 % from tick placement. It reproduces the paper\'s own reading at 40 °C and 60 % of V_R ("about 0.00001") and its 125 °C line at 2/3 V_R. Base 1 %/1000 h for commercial parts at 85 °C, rated voltage and 1 Ω per volt of series resistance (note 40246). Vishay publishes no factor for less series resistance, and says power-on surge failures, the commonest, are not in the rate. It is close to NASA\'s fit of KEMET\'s MnO₂ data (B = 14.7 and 1.17 eV; the chart gives 14.8 and about 1.1 eV), so it is the legacy industry curve rather than Vishay\'s alone. Vishay\'s online calculator uses MIL-HDBK-217F instead. Read only between 25 and 125 °C; below 25 °C the 25 °C value is used. The rating is V_R up to 85 °C, falling linearly to 2/3 V_R at 125 °C, as KEMET also states.',
  base: 1,
  a: -10.8639,
  b: 0.0525,
  c: 6.4208,
  tMin: 25,
  tMax: 125,
  uMin: 0.1,
};

// KYOCERA AVX catalogue model (2022): F = F_V × F_T × F_R × F_B. F_V and F_T are
// read from the catalogue's vector charts against their gridlines (log10 F_V =
// a + b·V/V_R; F_T as [°C, log10 F_T] points, interpolated), F_R is its printed
// table [Ω/V, F_R], interpolated log-log. Used as drawn, as AVX's example does.
export const TANT_AVX = {
  id: 'tant-avx',
  title: 'Tantalum and niobium oxide: KYOCERA AVX\'s catalogue factors',
  ref: 'KYOCERA AVX catalogue (2022), Technical Summary section 3, Figs. 2a, 3 and 4',
  status: 'chart',
  sources: ['avxCat', 'avxNoj', 'avxNos', 'avxDerating', 'avxRmtant', 'kemFitMan'],
  note: 'F = F_V × F_T × F_R × F_B (KYOCERA AVX). The voltage and temperature charts are vector drawings, read against their own gridlines: log10 F_V = −4.191 + 4.152·V/V_R, one line for tantalum and niobium oxide, and an F_T curve each for tantalum, NOJ and NOS. F_R is AVX\'s printed table, 1.0 at 0.1 Ω/V down to 0.07 at 3 Ω/V, interpolated log-log. Used as drawn, they reproduce the catalogue\'s worked example (0.071 against 0.068 %/1000 h; its F_V of 0.08 is printed to one figure) and the voltage factors in AVX\'s 2003 paper (0.13 and 0.0077 against 0.12 and 0.007). The charts are for a "typical component", so at V_R, 85 °C and 0.1 Ω/V they give 0.91 × F_B. F_B, at 85 °C, V_R and 0.1 Ω/V: 1.0 %/1000 h for TAJ, TPS, TPM, TCJ, TCO, TCQ, TCM, TCN, J-CAP and TAC (TCJ to J-CAP are polymer); 0.5 for TMJ, TRJ, TRM, THJ and NOJ; 0.2 for NOS and NOM. TLJ, TLN, TLC and NLJ state theirs at half the rated voltage, so they are not covered. Below 20 °C the 20 °C value is used; outside 0.1–3 Ω/V the nearer end of the table is used, and AVX gives no factor below 0.1 Ω/V, where it says many circuits are, so the rate there may be higher. Voltage limits: tantalum V_R up to 85 °C, falling linearly to 2/3 V_R at 125 °C (KEMET states the line, AVX the end points); niobium oxide V_R up to 85 °C, about 2/3 V_R at 105 °C and, for NOS, about 1/2 V_R at 125 °C (the data sheets\' category voltages; the 6.3 V parts are rated 4 V at 105 °C, a little lower). AVX\'s 2003 paper says niobium oxide depends less on voltage than tantalum, but the 2022 catalogue draws one voltage line for both. The 2001 charts in Reynolds\' paper are older and differ: a steeper F_T and a lower F_R between 0.2 and 1 Ω/V.',
  fv: { a: -4.1911, b: 4.1518, uMin: 0.12 },
  ft: {
    tantalum: [[19.8, -1.349], [45.0, -0.929], [70.2, -0.424], [81.9, -0.103], [97.6, 0.413], [110.5, 0.843], [130.7, 1.543], [140.0, 1.853], [199.5, 3.76]],
    NOJ: [[20.0, -1.291], [29.9, -1.103], [40.3, -0.975], [60.0, -0.705], [69.7, -0.533], [80.0, -0.224], [90.1, 0.275], [105.5, 1.388]],
    // NOS follows the NOJ curve up to about 91 °C.
    NOS: [[20.0, -1.291], [29.9, -1.103], [40.3, -0.975], [60.0, -0.705], [69.7, -0.533], [80.0, -0.224], [90.1, 0.275], [91.2, 0.316], [100.3, 0.757], [105.1, 1.027], [109.9, 1.308], [119.9, 1.812], [125.3, 2.102]],
  },
  fr: [[0.1, 1.0], [0.2, 0.8], [0.4, 0.6], [0.6, 0.4], [0.8, 0.3], [1.0, 0.2], [2.0, 0.1], [3.0, 0.07]],
  tMax: 125,
  // Niobium oxide series: base rate, top of the rating, and the voltage limit as [°C, fraction of V_R].
  nbo: {
    NOJ: { base: 0.5, tMax: 105, limit: [[85, 1], [105, 2 / 3]] },
    NOS: { base: 0.2, tMax: 125, limit: [[85, 1], [105, 2 / 3], [125, 1 / 2]] },
  },
};

// NASA conservative polymer values: AF_V = exp[B(u_ref − u)], Arrhenius E_a.
export const TANT_NASA = {
  id: 'tant-nasa',
  title: 'Polymer tantalum: NASA\'s conservative values on the maker\'s rate',
  ref: 'NASA/TM-20220019033, equations 3–5 and p. 21 (PDF)',
  status: 'published',
  sources: ['nasaPtc', 'nasaPcns', 'panPoscap'],
  note: 'NASA scales a polymer tantalum rate with an exponential voltage law, exp[B·(u_ref − u)] with u = V/V_R, and Arrhenius in temperature, and recommends B = 7 and E_a = 0.7 eV for conservative estimates. Its measured values are B = 10.9 ± 0.8 and 0.7–1.35 eV, so these give a higher rate than measured. The maker\'s rate and the voltage and temperature it is stated at are entered: for example 0.5 %/1000 h at the category voltage and temperature (KEMET), 0.5 %/1000 h at rated voltage and 105 °C, or 85 °C for some series (Panasonic POSCAP; 1.0 % for some small cases, listed per series in its Table 4-1), or 1 %/1000 h at 105 °C and rated voltage (Vishay T55). Panasonic publishes no voltage or temperature law of its own. NASA also limits chip polymer parts to 0.6 V_R and 85 °C case.',
  b: 7,
  ea: 0.7,
};

// ---------------------------------------------------------------------------
// Ceramic (MLCC) life test

export const MLCC_ACCEL = {
  id: 'mlcc-accel',
  title: 'Ceramic capacitors: life-test acceleration (V_test/V)^n · Arrhenius',
  ref: 'Prokopowicz–Vaskas form, as the makers print it',
  status: 'corroborated',
  sources: ['murataFaq', 'samsungFaq', 'knowles', 'avxRawal', 'nasaLiu', 'nims'],
  note: 'AF = (V_test/V)^n · exp[(E_a/k)(1/T − 1/T_test)] with T in kelvin (Murata, Samsung Electro-Mechanics, Knowles, AVX, NASA, the NIMS round robin). Kelvin = °C + 273.15, which reproduces every cell of Knowles\' FIT tables; Samsung\'s example uses whole kelvins and comes out 0.25 % lower.',
};

export const MLCC_BOUND = {
  id: 'mlcc-bound',
  title: 'Failure rate from a life test: 60 % upper bound, χ²(0.60, 2r + 2)/2',
  ref: 'Knowles AN0004 p. 5; Samsung FAQ (MIL-STD-690, JIS C 5003)',
  status: 'corroborated',
  sources: ['knowles', 'samsungFaq'],
  note: 'λ = χ²(0.60, 2r + 2) / (2 · device-hours · AF) for r failures in the test: 0.917 failures counted when none failed. Knowles and Samsung print it; Murata\'s silicon capacitors and TDK (not read directly) use the same 60 % level.',
  confidence: 0.6,
};

export const MLCC_PME = {
  id: 'mlcc-pme',
  title: 'Precious-metal-electrode parts: n = 3, E_a = 1.0 eV',
  ref: 'Values published for PME ceramic capacitors',
  status: 'corroborated',
  sources: ['avxRawal', 'nasaLiu', 'nasaMlcc', 'knowles', 'murataFaq'],
  note: 'n ≈ 3: "normally accepted in the industry" (AVX), measured 2.8–3.0 on PME parts (NASA), Murata\'s example; Knowles uses 2.7. E_a ≈ 1 eV: NASA 0.99–1.01 and 0.9–1, Knowles 1.0, AVX 0.9. Base-metal (nickel) parts, now the common kind, have no agreed values: n 2.1–2.5 and 1.2–1.3 eV from six makers testing one part (NIMS), n 4–9 and 1–1.8 eV (NASA). Those are entered; a smaller n or E_a gives the higher, more cautious rate.',
  n: 3,
  ea: 1.0,
};

// ---------------------------------------------------------------------------
// Board flex

export const FLEX = {
  id: 'mlcc-flex',
  title: 'Flex cracking: ceramic chips 1210 and larger',
  ref: 'Board-flex test limits and makers\' guidance',
  status: 'published',
  sources: ['vis45261', 'nasaMlcc', 'kyoFlex', 'tdkSoft', 'samsungBend', 'nasaCrack', 'avxCracks', 'murataLayout'],
  note: 'Standard terminations are tested to 2 mm of bend over a 90 mm span, the AEC-Q200-005 board-flex test (as Vishay and NASA cite it; KYOCERA AVX); soft or flexible terminations to 5 mm (TDK, KYOCERA AVX, Samsung). Larger chips crack more easily, and NASA reports a rule of thumb against ceramic chips 1210 and larger; that size limit is one source. Cracks come from depanelling, screws, connectors and test fixtures (AVX, NASA, Murata), and no failure-rate model counts them, so the page flags these parts rather than adding a rate.',
  sizes: ['1210', '1808', '1812', '1825', '2220', '2225'],
};

// ---------------------------------------------------------------------------
// Semiconductor life test (HTOL): oscillators, ICs, modules

export const LIFE_TEST = {
  id: 'life-test',
  title: 'Failure rate from a maker\'s high-temperature life test (HTOL): χ² bound and Arrhenius',
  ref: 'The JESD85 method as TI, SiTime and Vishay Siliconix print it',
  status: 'corroborated',
  sources: ['tiSnaa391', 'sitimeAn10025', 'vishay72559', 'sitimeRr32'],
  note: 'λ = χ²(CL, 2r + 2) / (2 · device-hours · AF_T · AF_V) · 10⁹, AF_T = exp[(E_a/k)(1/T − 1/T_test)], kelvin = °C + 273.15. TI prints it at 60 % confidence and 0.7 eV: 7,859 BAW oscillators for 1,000 h at 125 °C with no failures give 1.5 FIT at 55 °C and 0.3 FIT at 35 °C. Vishay Siliconix uses the same 60 % and 0.7 eV. SiTime uses 90 % and a gate-oxide voltage factor (1.04 for 3.6 V against 3.3 V): 3,307,000 device-hours at a 130 °C junction give 0.88 FIT at 30 °C, reproduced here to 1 % (SiTime rounds k to 8.63 × 10⁻⁵ and uses +273). Device-hours are entered rather than a quoted FIT, because quoted figures can rest on data the report does not show: SiTime\'s RR-32 quotes 0.65 FIT for a group whose own hours give 2–3 FIT.',
  confidences: [0.6, 0.9],
  ea: 0.7,
};

export const TABLES_MAKER = [TANT_KEMET, TANT_VISHAY, TANT_AVX, TANT_NASA, MLCC_ACCEL, MLCC_BOUND, MLCC_PME, FLEX, LIFE_TEST];
