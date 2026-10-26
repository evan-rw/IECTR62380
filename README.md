# IECTR62380

Online calculation for IEC TR 62380. A browser calculator that predicts the failure rate (FIT) and MTBF of an electronic board from its parts list and mission profile, using the models of IEC TR 62380:2004 (*Reliability data handbook – Universal model for reliability prediction of electronics components, PCBs and equipment*, formerly UTE C 80-810 / RDF 2000).

**Live page:** https://evan-rw.github.io/IECTR62380/

> **The coefficient tables are inferred from public sources, not taken from the standard** (the IEC's licence for purchased copies does not allow using them in software). Each table in [`assets/tables.js`](assets/tables.js) lists its sources and how well they support it. Treat results as estimates.

## What it does

- **Mission profile:** one row per phase of a typical year: board ambient temperature t<sub>ac</sub>, working-time ratio τ, annual thermal cycles n and amplitude ΔT. Includes the profiles from Tables 1–2 of the standard.
- **Parts:** integrated circuits (die + package + electrical overstress), diodes, transistors, ceramic/tantalum/aluminium capacitors, film and SMD resistors, inductors and transformers. Any other part can be entered with a known failure rate.
- **Netlist import:** load a Protel or Protel 2.0 netlist (Altium, gEDA/Lepton and other tools export these). Parts are typed from their designators (U, C, R, Q, D, L…), identical parts are grouped into one line ("C1–C12, C15"), and test points, mounting holes and fiducials are skipped. Package, pin count, capacitor dielectric, resistor rating and some part families are worked out from footprint names and values; these are marked **Guessed** with the reason until changed or confirmed. Everything a netlist cannot hold (power, thermal resistance, voltage stress, transistor count…) is marked **Missing**, and that part is left out of the board total until it is filled in.
- **Results:** board failure rate, MTBF, survival over the mission, and each part's share of the total. A "Show the calculation" panel on every part lists each factor (π<sub>t</sub>, π<sub>n</sub>, π<sub>α</sub>, λ3, …) per phase.
- Every table value can be overridden per part.
- Boards are saved in the browser and can be exported/imported as JSON, or exported as CSV.

Families of the standard not modelled yet (optocouplers, optoelectronics, relays, connectors, switches, PCBs, protection devices, batteries, fans, converters and others) are listed on the page; enter them as "Other part" in the meantime.

## How it is built

A static site with no build step: `index.html` plus ES modules in `assets/`.

| File | Contents |
| --- | --- |
| `assets/tables.js` | Every coefficient table, each with its source and a `verified` flag |
| `assets/models.js` | The failure-rate models: pure functions, no DOM |
| `assets/netlist.js` | Protel netlist parser and the rules that guess part details |
| `assets/app.js` | The page: state, rendering, import/export |
| `tests/` | `node:test` tests for the models, the netlist import and page behaviour (jsdom) |

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
| `preview` | Taken from the publisher's free preview of the standard |
| `corroborated` | Two or more independent public sources give the same values |
| `single` | One public source so far |

To strengthen a table, find an independent public source that states the same values, such as a semiconductor vendor's functional-safety FIT report that lists its IEC 62380 parameters, or a paper that applies the model. Add it to `SOURCES`, list it on the table, and raise the status to `corroborated` once every row is covered. Correct any value the sources contradict, and run `npm test`.

Do not copy text, tables or figures from a purchased copy of the standard into this repository: the IEC licence for purchased copies does not allow it. `*.pdf` is in `.gitignore` as a backstop.

## Sources and credits

- Mission profiles (Tables 1–2) and the table of contents: the publisher's free preview of IEC TR 62380:2004.
- IC, package, expansion-coefficient, overstress, discrete-package and diode/transistor/capacitor/resistor coefficients: [Kicad-Space-Reliability](https://github.com/Eliot-Abramo/Kicad-Space-Reliability) by Eliot Abramo (MIT licence). Rows from that project that are not part of the 2004 standard (for example GaN and SiC devices, extra overstress categories) were left out.
- Model structure for ICs: TI application report [SLOA294A](https://www.ti.com/lit/pdf/sloa294). Tantalum capacitor equation: [Micromachines 2023, 14(1):221](https://pmc.ncbi.nlm.nih.gov/articles/PMC9866997/).

IEC TR 62380 was withdrawn and replaced by IEC 61709:2017, which uses a different method (converting a known reference failure rate to operating conditions). TR 62380 is still referenced by ISO 26262-11:2018 for semiconductor failure rates. This project is not affiliated with the IEC.

## Licence

GNU Affero General Public License v3.0; see [LICENSE](LICENSE).
