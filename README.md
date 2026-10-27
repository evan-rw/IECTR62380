# IECTR62380

Online calculation for IEC TR 62380. A browser calculator that estimates the failure rate (FIT) and MTBF of an electronic board from its parts list and mission profile, following the approach of IEC TR 62380:2004 (*Reliability data handbook – Universal model for reliability prediction of electronics components, PCBs and equipment*, formerly UTE C 80-810 / RDF 2000) as described in public sources. Part families those tables do not cover use the public-domain MIL-HDBK-217F models.

**Live page:** https://evan-rw.github.io/IECTR62380/

> **The coefficients are not taken from the standard.** The mission profiles are published excerpts of it; everything else was copied from one open-source project ([Kicad-Space-Reliability](https://github.com/Eliot-Abramo/Kicad-Space-Reliability)) and has not been checked against IEC TR 62380. Each table in [`assets/tables.js`](assets/tables.js) lists its sources and how well they support it. Treat results as rough estimates: they are not suitable as evidence for an ISO 26262 or IEC 61508 safety case. (Using a purchased copy of the standard is not an option: the IEC licence does not allow it in software.)

## What it does

- **Mission profile:** one row per phase of a typical year: board ambient temperature t<sub>ac</sub>, working-time ratio τ, annual thermal cycles n and amplitude ΔT. Includes the profiles of Tables 1–2 of the standard and the automotive *motor control* and *passenger compartment* profiles of Table 11, as reproduced in TI SLOA294A.
- **Parts, IEC TR 62380 approach:** integrated circuits (die + package + electrical overstress), diodes, transistors, ceramic/tantalum/aluminium capacitors, film and SMD resistors, inductors and transformers.
- **Parts, MIL-HDBK-217F (Notice 2 where it applies):** mechanical and solid-state relays, switches, connectors, IC sockets, plated-through-hole circuit boards, quartz crystals, fuses, incandescent lamps, and optoelectronics (LEDs, optocouplers, photodetectors). One board-wide setting picks the 217F operating environment (ground benign to cannon launch). 217F rates are per operating hour, so the calculator weights them by each working phase's time share; dormant phases add nothing, unlike the 62380 models. The two methods differ in age and assumptions, so a board that mixes them is an estimate of an estimate.
- **Parts with vendor data:** a manufacturer's FIT rescaled to your mission profile, either from one temperature with the Arrhenius law, or from an IEC 62380 FIT report (die and package FIT at a stated profile, as TI publishes per part) using the 62380 formulas from TI SLOA294A. This path uses no coefficient tables at all.
- **Other parts** can be entered with a known failure rate. A part's type can be changed at any time; its reference, quantity and netlist data stay.
- **Failure modes:** each part's calculation lists how its failures split between short, open and drift (MIL-HDBK-338B Table 7.8-1, from RAC FMD-91). Marking a block redundant pre-fills its critical share with the members' short-circuit probability, marked Guessed.
- **Netlist import:** load a Protel or Protel 2.0 netlist (Altium, gEDA/Lepton and other tools export these). Parts are typed from their designators (U, C, R, Q, D, L…), identical parts are grouped into one line ("C1–C12, C15"), and test points, mounting holes and fiducials are skipped. Package, pin count, capacitor dielectric, resistor rating and some part families are worked out from footprint names and values; these are marked **Guessed** with the reason until changed or confirmed (a confirmed guess keeps its reason on record). Everything a netlist cannot hold (power, thermal resistance, voltage stress, transistor count…) is marked **Missing**, and that part is left out of the board total until it is filled in. A grouped line can be split into one line per reference when its parts run at different conditions.
- **Results:** board failure rate, MTBF, survival over the mission, and each part's share of the total. While any line is incomplete, the total is shown as a lower bound (≥) and MTBF and survival as upper bounds (≤). By default the total counts a failure of any listed part as a board failure, so parts wired in parallel still add up. A "Show the calculation" panel on every part lists each factor (π<sub>t</sub>, π<sub>n</sub>, π<sub>α</sub>, λ3, …) per phase.
- **Reliability structure:** a tree and a zoomable block diagram that edit the same nested structure. Every part starts in "Everything else, in series"; parts that back each other up go into a redundant (k-of-n) block, where you say how many must keep working and what share of their failures (shorts, say) breaks the block anyway. Blocks nest, so two series power paths can sit inside a 1-of-2 block. Select by click, Ctrl/Shift+click, a lasso on the diagram, or by typing references (C1–C8, Q1) into Find; group with P (parallel) or S (series), ungroup with U, split a line with L, and move by dragging or with M. Netlist import proposes blocks of parts of the same type wired to the same nets, such as decoupling capacitors on one rail or paralleled MOSFETs; they count in series until accepted. A redundant block has no constant failure rate, so the board figures become averages over the mission length: survival over the mission, the mission-average failure rate −ln R(T)/T, and the mean time to failure ∫R(t)dt. Boards saved with the earlier flat groups load as top-level blocks.
- Every table value can be overridden per part.
- Boards are saved in the browser and can be exported/imported as JSON, or exported as CSV.

Families of the standard not modelled yet (optocouplers, optoelectronics, relays, connectors, switches, PCBs, protection devices, batteries, fans, converters and others) are listed on the page; enter them as "Other part" in the meantime.

## How it is built

A static site with no build step: the calculator (`index.html`), a data sources page (`sources.html`) listing every table, source, model and licence, and ES modules in `assets/`.

| File | Contents |
| --- | --- |
| `assets/tables.js` | IEC TR 62380 coefficient tables, each with its sources and a `status` |
| `assets/models.js` | The IEC TR 62380 failure-rate models: pure functions, no DOM |
| `assets/tables217f.js` | MIL-HDBK-217F coefficient tables, each with its sources and a `status` |
| `assets/models217f.js` | The MIL-HDBK-217F part models |
| `assets/failuremodes.js` | Failure-mode distributions (MIL-HDBK-338B Table 7.8-1) and the part-type mapping |
| `assets/netlist.js` | Protel netlist parser, the rules that guess part details, and parallel-block proposals |
| `assets/structure.js` | Nested series and k-of-n blocks: survival, mission-average rate, mean time to failure, and the editing operations |
| `assets/structure-ui.js` | The structure editor: tree, zoomable block diagram, side panel, drag and drop, keyboard |
| `assets/app.js` | The calculator page: state, rendering, import/export |
| `assets/sources.js` | The data sources page, rendered from the same data modules |
| `tests/` | `node:test` tests for the models, the netlist import, the reliability structure and page behaviour (jsdom) |
| `THIRD_PARTY_NOTICES.md` | Licence notice for the copied coefficient values |

Run locally:

```sh
npm install        # only needed for the tests
npm test
npm run serve      # then open http://localhost:8000
```

ES modules do not load from `file://`, so open the page through a local server, not by double-clicking `index.html`.

## Publishing with GitHub Pages

In the repository on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**. The page appears at https://evan-rw.github.io/IECTR62380/ a minute or two later and updates on every push to `main`. The `.nojekyll` file makes Pages serve the files as they are.

## Improving the coefficient data

Each table in `assets/tables.js` has a `status`:

| Status | Meaning |
| --- | --- |
| `excerpt` | A published excerpt of the standard (the free preview, or a vendor note that reproduces a table) |
| `corroborated` | Two or more independent public sources give the same values |
| `single` | One source so far, not checked against the standard |
| `handbook` | A MIL-HDBK-217F table read from the handbook's own pages, with no second transcription to compare against |

To strengthen a table, find an independent public source that states the same values, such as a semiconductor vendor's functional-safety FIT report that lists its IEC 62380 parameters, or a paper that applies the model. Add it to `SOURCES`, list it on the table, and raise the status to `corroborated` once every row is covered. Correct any value the sources contradict, and run `npm test`.

Do not copy text, tables or figures from a purchased copy of the standard into this repository: the IEC licence for purchased copies does not allow it. `*.pdf` is in `.gitignore` as a backstop.

## Sources and credits

- Mission profiles (Tables 1–2) and the table of contents: the [free preview of IEC TR 62380:2004](https://cdn.standards.iteh.ai/samples/13261/98ed8ee73b204649b3da358d6417259b/IEC-TR-62380-2004.pdf) hosted by iTeh Standards. Automotive profiles (Table 11): TI [SLOA294A](https://www.ti.com/lit/pdf/sloa294), Table 6-1.
- IC, package, expansion-coefficient, overstress, discrete-package and diode/transistor/capacitor/resistor coefficients: [Kicad-Space-Reliability](https://github.com/Eliot-Abramo/Kicad-Space-Reliability) V3.3.0 by Eliot Abramo (MIT licence; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Rows from that project that are not part of the 2004 standard (for example GaN and SiC devices, extra overstress categories) were left out.
- MIL-HDBK-217F part models: [MIL-HDBK-217F](https://everyspec.com/MIL-HDBK/MIL-HDBK-0200-0299/MIL-HDBK-217F_14591/) (2 December 1991) and its [Notice 2](https://everyspec.com/MIL-HDBK/MIL-HDBK-0200-0299/MIL-HDBK-217F_NOTICE-2_14590/) (28 February 1995), both "approved for public release; distribution unlimited". Values were read from the scanned pages and cross-checked against the independent transcription in [RAMSTK](https://github.com/ReliaQualAssociates/ramstk) where it uses the same edition, or against the scan's OCR text where it does not.
- Failure modes: [MIL-HDBK-338B](https://www.klabs.org/DEI/References/design_guidelines/content/mil_specs/mil_hdbk_338b.pdf), Electronic Reliability Design Handbook (1 October 1998, public release), Table 7.8-1, which reproduces RAC's FMD-91. Generated from the handbook's text layer; each part's shares sum to 1, and one page was compared against the scan.
- IC formula: TI [SLOA294A](https://www.ti.com/lit/pdf/sloa294). MOS transistor model structure (0.3 eV, 100 °C reference): Thurlbeck & Cao, [IEEE Trans. Industry Applications 2022](https://web.engr.oregonstate.edu/~caoy2/files/IAS_thurlbeck.pdf). Tantalum capacitor equation: [Micromachines 2023, 14(1):221](https://pmc.ncbi.nlm.nih.gov/articles/PMC9866997/).

IEC TR 62380 was withdrawn and replaced by IEC 61709:2017, which uses a different method (converting a known reference failure rate to operating conditions). TR 62380 is still referenced by ISO 26262-11:2018 for semiconductor failure rates. This project is not affiliated with the IEC.

## Licence

GNU Affero General Public License v3.0; see [LICENSE](LICENSE).
