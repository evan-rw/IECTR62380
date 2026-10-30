import {
  MODELS, MODEL_GROUPS, computeBoard, profileIssues, mtbfHours, reliability, byId, fieldLabel, clauseOf,
} from './models.js';
import { ENVIRONMENTS, SMT_217F } from './tables217f.js';
import { MISSION_PROFILES } from './tables.js';
import { netlistToParts, expandRefs, compressRefs } from './netlist.js';
import { ROOT, sanitizeStructure, migrateGroups, meanTimeToFailure, members as structureMembers, label as structureLabel } from './structure.js';
import { evaluateSmt, chipCandidates, flexRisks } from './smt.js';
import { evaluateBoard, laminateOf, qualityBand } from './pth.js';
import { LAMINATES, PTH_MODEL, SOURCES_BOARD } from './tablesboard.js';
import { mountStructure, refreshStructure, currentStructure, resetStructureView } from './structure-ui.js';
import { parseBom, bomToParts, mergeBom } from './bom.js';
import { failureModesFor } from './failuremodes.js';
import { evaluateCapLife, withLife, lifeInputs, LIFE_KEYS, TECHS, typeTech } from './caplife.js';
import { LIFE_RULES, END_OF_LIFE } from './tablescaplife.js';
import { VENDOR_MTBF } from './tablesmaker.js';
import { initTooltips } from './tooltip.js';
import { openProgress } from './progress.js';
import { readBytes, decodeText, READ_SHARE } from './readfile.js';
import { parseBoardFile, laminateFor } from './boardfile.js';
import { esc } from './html.js';
import { xlsx } from './xlsx.js';
import { boardSheets } from './report.js';

const STORAGE_KEY = 'iec62380.board.v1';
// "Remember this board on this computer": when it is off, the board is never written and its saved
// copy is deleted, so it lasts only while the tab is open. The choice itself holds no board data.
const REMEMBER_KEY = 'iec62380.remember';
const FORMAT = 'iec62380-board';
const REF_PREFIX = {
  ic: 'U', diode: 'D', transistor: 'Q', capacitor: 'C', resistor: 'R', inductor: 'L', fixed: 'X',
  'mil-relay': 'K', 'mil-ssr': 'K', 'mil-switch': 'SW', 'mil-connector': 'J', 'mil-socket': 'XU',
  'mil-pwb': 'PCB', 'mil-crystal': 'Y', 'mil-fuse': 'F', 'mil-lamp': 'DS', 'mil-opto': 'D', 'mil-capacitor': 'C', 'mil-resistor': 'R', 'mil-inductive': 'L', vendor: 'U',
  'tantalum-maker': 'C', 'ceramic-test': 'C', 'life-test': 'U',
};

const $ = (sel, root = document) => root.querySelector(sel);
const clone = (x) => JSON.parse(JSON.stringify(x));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (s) => (s === '' || s == null || !Number.isFinite(Number(s)) ? null : Number(s));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

let seq = 0;
const newId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

const nf = new Intl.NumberFormat('en', { maximumSignificantDigits: 3 });
const nf2 = new Intl.NumberFormat('en', { maximumSignificantDigits: 2 });
function fmt(x, format = nf) {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  if (Math.abs(x) < 0.001) return x.toExponential(format === nf ? 2 : 1);
  return format.format(x);
}
// Headline figures: two significant digits, since the inputs justify no more.
const fmt2 = (x) => fmt(x, nf2);

// ---------------------------------------------------------------------------
// Board state. A part is { id, ref, qty, model, params, inferred, confirmed,
// source, open }: `inferred` maps a parameter to the reason it was guessed;
// "Confirm guesses" moves those reasons to `confirmed` so the record stays;
// editing a value removes it from both. `source` keeps what the netlist said.

function makePart(model, ref, qty = 1, params = {}, extra = {}) {
  return { id: newId(), ref, qty, model, params: { ...clone(MODELS[model].defaults), ...params }, inferred: {}, confirmed: {}, source: null, open: false, ...extra };
}

function presetProfile(id, env217f = 'GB') {
  const row = byId(MISSION_PROFILES, id);
  return { preset: row.id, phases: clone(row.phases), tauOff: null, env217f };
}

// Surface-mount check (MIL-HDBK-217F 16.2): board settings and candidate devices.
const emptySmt = () => ({ include: true, substrate: null, cycling: 'profile', equipment: null, devices: [] });
// Circuit board (plated-hole fatigue): laminate, plating, assembly and hole sizes.
const PCB_NUMBERS = ['thickness', 'ductility', 'strength', 'kq', 'kd', 'reflows', 'reflowPeak'];
const emptyPcb = () => ({
  include: true, laminate: null, custom: { tg: null, alpha1: null, alpha2: null, modulus: null },
  ...Object.fromEntries(PCB_NUMBERS.map((k) => [k, null])), holes: [], inferred: {}, confirmed: {},
});
// Board settings and hole cells a board file can fill in, marked Guessed with where they came from.
const PCB_GUESSED = ['thickness', 'laminate'];
const HOLE_GUESSED = ['drill'];

// Electrolytic capacitor life: whether drift is a failure by default, and the polymer rule.
const emptyCapLife = () => ({ defaultRole: null, polymerRule: 'majority' });

function emptyBoard() {
  return {
    format: FORMAT, version: 2, title: 'Untitled board', years: 10, profile: presetProfile('geo-permanent'), parts: [],
    structure: { kind: 'block', id: ROOT, children: [] }, smt: emptySmt(), pcb: emptyPcb(), caplife: emptyCapLife(),
  };
}

function sanitizeCapLife(raw) {
  return {
    defaultRole: ['drift', 'hard'].includes(raw?.defaultRole) ? raw.defaultRole : null,
    polymerRule: raw?.polymerRule === 'slow' ? 'slow' : 'majority',
  };
}

// A line's life inputs; anything not entered is guessed or left blank.
const LIFE_CHOICES = { tech: TECHS, rated: ['dc', 'ripple'], ripple: ['none', 'ratio', 'rise'], role: ['default', 'drift', 'hard'] };
function sanitizeLife(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [k, opts] of Object.entries(LIFE_CHOICES)) if (opts.includes(raw[k])) out[k] = raw[k];
  for (const k of ['hours', 'temp', 'ratio', 'rise', 'rise0']) if (isNum(raw[k])) out[k] = raw[k];
  if (typeof raw.listed === 'boolean') out.listed = raw.listed;
  const confirmed = Object.fromEntries(Object.entries(raw.confirmed ?? {}).filter(([k, v]) => LIFE_KEYS.includes(k) && typeof v === 'string'));
  if (Object.keys(confirmed).length) out.confirmed = confirmed;
  return Object.keys(out).length ? out : null;
}

function sanitizePcb(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const num = (v) => (isNum(v) ? v : null);
  return {
    include: s.include !== false,
    laminate: s.laminate === 'custom' || LAMINATES.rows.some((r) => r.id === s.laminate) ? s.laminate : null,
    custom: Object.fromEntries(['tg', 'alpha1', 'alpha2', 'modulus'].map((k) => [k, num(s.custom?.[k])])),
    ...Object.fromEntries(PCB_NUMBERS.map((k) => [k, num(s[k])])),
    holes: (Array.isArray(s.holes) ? s.holes : []).map((h) => ({
      label: str(h?.label), drill: num(h?.drill), plating: num(h?.plating),
      inferred: reasons(h?.inferred, HOLE_GUESSED), confirmed: reasons(h?.confirmed, HOLE_GUESSED),
    })),
    inferred: reasons(s.inferred, PCB_GUESSED), confirmed: reasons(s.confirmed, PCB_GUESSED),
  };
}

// The reasons kept for guessed values: text, for the keys that can be guessed.
function reasons(raw, keys) {
  return Object.fromEntries(Object.entries(raw && typeof raw === 'object' ? raw : {}).filter(([k, v]) => keys.includes(k) && typeof v === 'string'));
}

function sanitizeSmt(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const pick = (rows, id) => (rows.some((r) => r.id === id) ? id : null);
  const num = (v) => (isNum(v) ? v : null);
  return {
    include: s.include !== false,
    substrate: pick(SMT_217F.substrates, s.substrate),
    cycling: s.cycling === 'handbook' ? 'handbook' : 'profile',
    equipment: pick(SMT_217F.equipment, s.equipment),
    devices: (Array.isArray(s.devices) ? s.devices : []).map((d) => ({
      label: str(d?.label), lead: pick(SMT_217F.leads, d?.lead), body: pick(SMT_217F.bodies, d?.body),
      d: num(d?.d), h: num(d?.h), rise: num(d?.rise),
      ...(typeof d?.auto === 'string' ? { auto: d.auto } : {}),
      inferred: Object.fromEntries(Object.entries(d?.inferred ?? {}).filter(([k, v]) => ['lead', 'body', 'd', 'h', 'rise'].includes(k) && typeof v === 'string')),
      confirmed: Object.fromEntries(Object.entries(d?.confirmed ?? {}).filter(([k, v]) => ['lead', 'body', 'd', 'h', 'rise'].includes(k) && typeof v === 'string')),
    })),
  };
}

function exampleBoard() {
  return {
    ...emptyBoard(),
    title: 'Example board',
    parts: [
      makePart('ic', 'U1', 1, { family: 'mos-digital', count: 50000, package: 'pqfp-14', power: 0.8, rja: 35 }, { open: true }),
      makePart('ic', 'U2', 1, { family: 'mos-eeprom', count: 256 * 1024, package: 'so', pins: 8, power: 0.01, rja: 120 }),
      makePart('ic', 'U3', 1, { family: 'bip-linear', count: 40, package: 'so', pins: 8, power: 0.05, rja: 120, eos: 'computer' }),
      makePart('transistor', 'Q1–Q2', 2, { type: 'mos-lp', stress: 0.4, power: 0.1, rja: 300, package: 'sot23' }),
      makePart('diode', 'D1–D4', 4, { type: 'signal', power: 0.02, rja: 300, package: 'sod123' }),
      makePart('capacitor', 'C1–C20', 20, { type: 'ceramic-2' }),
      makePart('capacitor', 'C21', 1, { type: 'tantalum-solid', rise: 3 }),
      makePart('resistor', 'R1–R30', 30, { type: 'smd', power: 0.01, rated: 0.1 }),
    ],
  };
}

const str = (v) => (v == null ? '' : String(v));

// Accept a parsed JSON board, keeping only known models and known parameters.
function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.parts) || !Array.isArray(raw.profile?.phases)) {
    throw new Error('This file is not a board exported from this calculator.');
  }
  const skipped = [];
  const parts = [];
  for (const p of raw.parts) {
    const model = MODELS[p?.model];
    if (!model) { skipped.push(String(p?.model)); continue; }
    const params = clone(model.defaults);
    const inferred = {};
    const confirmed = {};
    for (const key of Object.keys(params)) {
      const v = p.params?.[key];
      if (v === null || typeof v === 'number' || typeof v === 'string') params[key] = v;
      if (typeof p.inferred?.[key] === 'string') inferred[key] = p.inferred[key];
      if (typeof p.confirmed?.[key] === 'string') confirmed[key] = p.confirmed[key];
    }
    const source = p.source && typeof p.source === 'object'
      ? Object.fromEntries(['value', 'footprint', 'description', 'mpn', 'manufacturer'].filter((k) => p.source[k]).map((k) => [k, str(p.source[k])]))
      : null;
    const life = sanitizeLife(p.life);
    parts.push({
      id: newId(), ref: str(p.ref), qty: isNum(p.qty) ? p.qty : 1, model: p.model, params, inferred, confirmed, source,
      ...(life ? { life } : {}), open: Boolean(p.open), advOpen: Boolean(p.advOpen), traceOpen: Boolean(p.traceOpen),
    });
  }
  const phases = raw.profile.phases.map((ph) => ({
    name: str(ph?.name),
    tac: isNum(ph?.tac) ? ph.tac : null,
    tau: isNum(ph?.tau) ? ph.tau : 0,
    n: isNum(ph?.n) ? ph.n : 0,
    dT: isNum(ph?.dT) ? ph.dT : 0,
    addRise: Boolean(ph?.addRise),
  }));
  const preset = MISSION_PROFILES.rows.some((r) => r.id === raw.profile.preset) ? raw.profile.preset : null;
  // Version 1 kept a flat list of groups; version 2 a nested structure.
  const structure = sanitizeStructure(raw.structure ?? migrateGroups(raw.groups));
  return {
    board: {
      format: FORMAT, version: 2,
      title: str(raw.title) || 'Untitled board',
      years: isNum(raw.years) ? raw.years : 10,
      profile: {
        preset, phases, tauOff: isNum(raw.profile.tauOff) ? raw.profile.tauOff : null,
        env217f: ENVIRONMENTS.some((e) => e.id === raw.profile.env217f) ? raw.profile.env217f : 'GB',
      },
      parts,
      structure,
      smt: sanitizeSmt(raw.smt),
      pcb: sanitizePcb(raw.pcb),
      caplife: sanitizeCapLife(raw.caplife),
    },
    skipped,
  };
}

function exportable(board) {
  return {
    format: FORMAT, version: 2, title: board.title, years: board.years,
    profile: board.profile,
    parts: board.parts.map(({ ref, qty, model, params, inferred, confirmed, source, life }) => ({
      ref, qty, model, params,
      ...(Object.keys(inferred ?? {}).length ? { inferred } : {}),
      ...(Object.keys(confirmed ?? {}).length ? { confirmed } : {}),
      ...(source ? { source } : {}),
      ...(life ? { life } : {}),
    })),
    structure: board.structure,
    smt: board.smt,
    pcb: board.pcb,
    caplife: board.caplife,
  };
}

function readRemember() {
  try { return localStorage.getItem(REMEMBER_KEY) !== 'no'; } catch { return true; }
}
let remember = readRemember();
// Changed since the page opened or the last Export JSON: closing the tab then loses work when nothing is remembered.
let changedSinceKept = false;

function load() {
  if (!remember) return null;
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? sanitize(JSON.parse(s)).board : null;
  } catch {
    return null;
  }
}

let saveTimer = null;
function writeNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!remember) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode or storage blocked */ }
}
function save() {
  changedSinceKept = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 250);
}
// Going to the data sources page must not lose the last keystrokes.
window.addEventListener('pagehide', () => { if (saveTimer) writeNow(); });
window.addEventListener('beforeunload', (e) => {
  if (!remember && changedSinceKept && state.parts.length) e.preventDefault();
});
function setRemember(on) {
  remember = on;
  try {
    if (on) localStorage.removeItem(REMEMBER_KEY);
    else { localStorage.setItem(REMEMBER_KEY, 'no'); localStorage.removeItem(STORAGE_KEY); }
  } catch { /* storage blocked: nothing was saved either */ }
  if (on) writeNow();
  showRemember();
}
function showRemember() {
  $('#remember').checked = remember;
  $('#remember-note').hidden = remember;
}
// Another tab changing the choice applies here too, so this tab cannot write the board back.
window.addEventListener('storage', (e) => {
  if (e.key !== REMEMBER_KEY && e.key !== null) return;
  remember = readRemember();
  showRemember();
});

let state = load() ?? exampleBoard();
const findPart = (id) => state.parts.find((p) => p.id === id);
const guessCount = (part) => Object.keys(part.inferred ?? {}).length;
const canSplit = (part) => part.qty > 1 && expandRefs(part.ref).length === part.qty;
const currentBlock = (id) => currentStructure().rt?.nodes.get(id);

// ---------------------------------------------------------------------------
// Rendering

function optionsHTML(opts, selected) {
  let html = selected == null || selected === '' ? '<option value="" selected>Choose…</option>' : '';
  let group = null;
  for (const o of opts) {
    if (o.group !== group) {
      if (group) html += '</optgroup>';
      if (o.group) html += `<optgroup label="${esc(o.group)}">`;
      group = o.group;
    }
    html += `<option value="${esc(o.value)}"${o.value === selected ? ' selected' : ''}>${esc(o.label)}</option>`;
  }
  if (group) html += '</optgroup>';
  return html;
}

function fieldHTML(part, f, p) {
  if (f.show && !f.show(p)) return '';
  const label = fieldLabel(f, p);
  const help = typeof f.help === 'function' ? f.help(p) : f.help;
  const guess = part.inferred?.[f.key];
  const confirmedGuess = part.confirmed?.[f.key];
  const id = `${part.id}-${f.key}`;
  const data = `data-bind="part" data-id="${part.id}" data-key="${f.key}"`;
  let control;
  if (f.type === 'select') {
    control = `<select id="${id}" ${data}>${optionsHTML(f.options, p[f.key])}</select>`;
  } else if (f.type === 'text') {
    control = `<input id="${id}" type="text" ${data} value="${esc(p[f.key])}">`;
  } else {
    const attrs = [
      f.min != null ? `min="${f.min}"` : '', f.max != null ? `max="${f.max}"` : '',
      `step="${f.step ?? 'any'}"`, f.optional ? 'placeholder="table value"' : '',
    ].join(' ');
    control = `<input id="${id}" type="number" inputmode="decimal" ${attrs} ${data} value="${esc(p[f.key] ?? '')}">`;
  }
  const unit = f.unit ? ` <span class="unit">(${esc(f.unit)})</span>` : '';
  const helpHTML = help ? `<p class="help" data-help-key="${f.key}">${esc(help)}</p>` : '';
  const guessHTML = guess ? `<p class="guess" data-guess-for="${f.key}">Guessed ${esc(guess)}.</p>`
    : confirmedGuess ? `<p class="guess confirmed" data-confirmed-for="${f.key}">Guessed ${esc(confirmedGuess)}; confirmed.</p>` : '';
  return `<div class="field${f.wide ? ' wide' : ''}" data-field="${f.key}"><label for="${id}">${esc(label)}${unit}<span class="state-tag"></span></label>${control}${guessHTML}${helpHTML}</div>`;
}

function sourceHTML(source) {
  if (!source) return '';
  const bits = [['Value', source.value], ['Footprint', source.footprint], ['Description', source.description], ['Manufacturer', source.manufacturer], ['MPN', source.mpn]]
    .filter(([, v]) => v).map(([k, v]) => `${k}: <b>${esc(v)}</b>`);
  return bits.length ? `<p class="source-line">Imported. ${bits.join(' · ')}</p>` : '';
}

function partHTML(part) {
  const model = MODELS[part.model];
  const p = { ...model.defaults, ...part.params };
  // A closed card is only its head: its fields are built when it is opened, which keeps
  // a large board's page small (a 500-line board had 88 000 elements, most of them hidden).
  const main = part.open ? model.fields.filter((f) => !f.advanced).map((f) => fieldHTML(part, f, p)).join('') : '';
  const adv = part.open ? model.fields.filter((f) => f.advanced).map((f) => fieldHTML(part, f, p)).join('') : '';
  return `
    <article class="part${part.open ? ' is-open' : ''}" data-part="${part.id}">
      <div class="part-head">
        <div class="ref"><label class="visually-hidden" for="${part.id}-ref">Reference</label>
          <input id="${part.id}-ref" type="text" value="${esc(part.ref)}" data-bind="part" data-id="${part.id}" data-key="ref" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>
        <div class="part-kind"><div class="model">${esc(model.label)} <span class="flags" data-out="flags"></span></div><div class="desc" data-out="desc"></div><div class="refs-full" data-out="refs"></div></div>
        <div class="qty"><label class="visually-hidden" for="${part.id}-qty">Quantity</label>
          <input id="${part.id}-qty" type="number" min="0" step="1" inputmode="numeric" value="${esc(part.qty)}" data-bind="part" data-id="${part.id}" data-key="qty" title="Quantity"></div>
        <div class="part-fit" data-out="fit"></div>
        <div class="part-actions">
          <button type="button" class="icon" data-act="toggle" data-id="${part.id}" aria-expanded="${part.open}" aria-controls="${part.id}-body">${part.open ? 'Close' : 'Edit'}</button>
          ${canSplit(part) ? `<button type="button" class="icon part-more" data-act="split" data-id="${part.id}" title="One line per reference, so each can have its own values">Split</button>` : ''}
          <button type="button" class="icon part-more" data-act="dup" data-id="${part.id}" title="Duplicate">Copy</button>
          <button type="button" class="icon part-more" data-act="del" data-id="${part.id}" title="Remove" aria-label="Remove ${esc(part.ref)}">✕</button>
        </div>
      </div>
      <div class="part-body" id="${part.id}-body"${part.open ? '' : ' hidden'}>${part.open ? `
        ${sourceHTML(part.source)}
        <div class="field model-field"><label for="${part.id}-model">Part type</label>
          <select id="${part.id}-model" data-bind="part-model" data-id="${part.id}">${optionsHTML(modelOptions(), part.model)}</select></div>
        <div class="fields">${main}</div>
        ${guessCount(part) ? `<p class="guess-bar">Amber fields were guessed from the netlist. <button type="button" data-act="confirm-guesses" data-id="${part.id}">Confirm guesses</button></p>` : ''}
        ${adv ? `<details class="advanced" data-id="${part.id}" data-open-key="advOpen"${part.advOpen ? ' open' : ''}><summary>Override table values</summary><div class="fields">${adv}</div></details>` : ''}
        <ul class="part-errors" data-out="errors"></ul>
        <ul class="part-notices" data-out="notices"></ul>
        <details class="trace" data-id="${part.id}" data-open-key="traceOpen"${part.traceOpen ? ' open' : ''}><summary>Show the calculation</summary><div class="trace-body" data-out="trace"></div></details>
        <p class="status-line">${esc(clauseOf(model))}. ${esc(model.status)}</p>
        <div class="part-foot">${canSplit(part) ? `<button type="button" data-act="split" data-id="${part.id}">Split line</button>` : ''}<button type="button" data-act="dup" data-id="${part.id}">Copy line</button><button type="button" class="part-remove" data-act="del" data-id="${part.id}">Remove line</button></div>` : ''}
      </div>
    </article>`;
}

function failureModesHTML(fm) {
  if (!fm) return '';
  const modes = fm.modes.map(([mode, a]) => `${esc(mode)} ${Math.round(a * 100)}%`).join(' · ');
  return `<p class="help">Failure modes of ${esc(fm.device.toLowerCase())}: ${modes} <span class="unit">(MIL-HDBK-338B Table 7.8-1)</span></p>`;
}

function traceHTML(r, phases, fm) {
  if (!r.complete) return `<p class="help">Fill in the missing values to see the calculation.</p>${failureModesHTML(fm)}`;
  const breakdown = r.parts.map(([label, v]) => `<span>${esc(label)}: ${fmt(v)} FIT</span>`).join('');
  const values = r.values.length
    ? `<dl class="values">${r.values.map(([k, v, note]) => `<dt>${esc(k)}</dt><dd>${esc(v)}${note ? `<span class="note">${esc(note)}</span>` : ''}</dd>`).join('')}</dl>`
    : '';
  const name = (i) => esc(phases[i]?.name || `Phase ${i + 1}`);
  const op = r.operating.length
    ? `<div class="table-scroll"><table class="trace-table"><caption>Working phases</caption><thead><tr><th>Phase</th><th class="num">${esc(r.tempLabel)} °C</th><th class="num">${esc(r.operatingLabel ?? 'π_t')}</th><th class="num">τ</th></tr></thead><tbody>${
      r.operating.map((o) => `<tr><td>${name(o.phase)}</td><td class="num">${fmt(o.t)}</td><td class="num">${fmt(o.piT)}</td><td class="num">${fmt(o.tau)}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  const cyc = r.cycling.length
    ? `<div class="table-scroll"><table class="trace-table"><caption>Thermal cycles</caption><thead><tr><th>Phase</th><th class="num">n</th><th class="num">π_n</th><th class="num">ΔT °C</th><th class="num">π_n·ΔT^0.68</th></tr></thead><tbody>${
      r.cycling.map((c) => `<tr><td>${name(c.phase)}</td><td class="num">${fmt(c.n)}</td><td class="num">${fmt(c.piN)}</td><td class="num">${fmt(c.dT)}</td><td class="num">${fmt(c.term)}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  return `<div class="breakdown">${breakdown}</div>${values}${op}${cyc}${failureModesHTML(fm)}`;
}

function renderBoardBar() {
  $('#title').value = state.title;
  $('#years').value = state.years ?? '';
}

function renderPresets() {
  const opts = [{ value: '', label: 'Custom profile' }, ...MISSION_PROFILES.rows.map((r) => ({ value: r.id, label: `${r.label} (${r.ref})` }))];
  $('#preset').innerHTML = optionsHTML(opts, state.profile.preset ?? '').replace('<option value="" selected>Choose…</option>', '');
}

function renderPhases() {
  $('#phases').innerHTML = state.profile.phases.map((ph, i) => {
    const d = (key) => `data-bind="phase" data-i="${i}" data-key="${key}"`;
    // t_ac can be negative: no inputmode there, since the iOS decimal keypad has no minus key.
    const num = (key, label, attrs = '', mode = 'decimal') => `<td><input type="number" step="any"${mode ? ` inputmode="${mode}"` : ''} ${attrs} aria-label="${label}, phase ${i + 1}" value="${esc(ph[key] ?? '')}" placeholder="—" ${d(key)}></td>`;
    return `<tr>
      <td><input type="text" aria-label="Phase ${i + 1} name" value="${esc(ph.name)}" ${d('name')}></td>
      ${num('tac', 't_ac', '', '')}${num('tau', 'τ', 'min="0" max="1"')}${num('n', 'n', 'min="0"')}${num('dT', 'ΔT', 'min="0"')}
      <td class="check"><label><input type="checkbox" aria-label="Add a third of the part's temperature rise, phase ${i + 1}"${ph.addRise ? ' checked' : ''} ${d('addRise')}></label></td>
      <td><button type="button" class="icon" data-act="del-phase" data-i="${i}" title="Remove phase" aria-label="Remove phase ${i + 1}"${state.profile.phases.length < 2 ? ' disabled' : ''}>✕</button></td>
    </tr>`;
  }).join('');
  $('#tau-off').value = state.profile.tauOff ?? '';
  $('#preset').value = state.profile.preset ?? '';
  $('#env217f').innerHTML = optionsHTML(ENVIRONMENTS.map((e) => ({ value: e.id, label: e.label })), state.profile.env217f ?? 'GB');
  renderProfileUndo();
}

// The last part line removed, for Undo, until the list changes again.
let removedLine = null;
function forgetRemoved() {
  removedLine = null;
  $('#parts-undo').hidden = true;
}

// One step back after a preset replaced a hand-made profile: an arrow key on the
// closed preset list is enough to replace it.
let undoProfile = null;
function renderProfileUndo() {
  const bar = $('#profile-undo');
  bar.hidden = !undoProfile;
  bar.innerHTML = undoProfile ? `Loaded a profile from the standard in place of your ${plural(undoProfile.phases.length, 'phase')}. <button type="button" data-act="undo-profile">Undo</button>` : '';
}

// Part types grouped by method, for the Add part list and each part's type select.
const modelOptions = () => Object.entries(MODELS)
  .sort(([, a], [, b]) => MODEL_GROUPS.indexOf(a.group) - MODEL_GROUPS.indexOf(b.group))
  .map(([id, m]) => ({ value: id, label: m.label.replace(/ \(MIL-HDBK-217F\)$/, ''), group: m.group }));

function renderAddModel() {
  $('#add-model').innerHTML = optionsHTML(modelOptions(), 'ic');
}

function renderParts() {
  $('#parts').innerHTML = state.parts.length
    ? state.parts.map(partHTML).join('')
    : '<p class="empty">No parts yet. Import a netlist, or choose a part type and add it.</p>';
  applyFind();
}

function rerenderPart(part, focusKey) {
  const el = $(`[data-part="${part.id}"]`);
  if (!el) return;
  el.outerHTML = partHTML(part);
  applyFind();
  if (focusKey) $(`[data-id="${part.id}"][data-key="${focusKey}"]`)?.focus();
}

// IC families, one row per part number. The importer guesses most families from the name or what
// the part does, and a board holds many lines of the same parts, so they are reviewed here at once.
const IC_FAMILY_OPTIONS = MODELS.ic.fields.find((f) => f.key === 'family').options;
function icGroups() {
  const groups = new Map();
  for (const part of state.parts) {
    if (part.model !== 'ic') continue;
    const pn = (part.source?.mpn || part.source?.value || '').trim();
    const key = pn ? pn.toUpperCase() : `#${part.id}`;
    if (!groups.has(key)) groups.set(key, { key, pn, parts: [] });
    groups.get(key).parts.push(part);
  }
  // Rows that need a choice first, then the guesses, then the rest.
  const rank = (g) => (g.parts.some((p) => !p.params.family) ? 0 : g.parts.some((p) => p.inferred?.family) ? 1 : 2);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.pn.localeCompare(b.pn, 'en', { numeric: true }));
}

function icRowHTML(g) {
  const fams = new Set(g.parts.map((p) => p.params.family ?? ''));
  const family = fams.size === 1 ? [...fams][0] : null; // null: the lines differ
  const missing = fams.has('');
  const guess = g.parts.find((p) => p.inferred?.family)?.inferred.family;
  const confirmed = g.parts.find((p) => p.confirmed?.family)?.confirmed.family;
  const why = family === null ? 'The lines differ; a choice here sets them all.'
    : missing ? 'Nothing in the name, description or symbol says.'
    : guess ? `Guessed: ${guess}` : confirmed ? `Confirmed: ${confirmed}` : 'Your choice.';
  const label = g.pn || g.parts[0].ref;
  const id = `ic-family-${g.parts[0].id}`;
  // R_JA has no guess: it is read from the data sheet and typed once for the part number.
  const rjas = new Set(g.parts.map((p) => p.params.rja ?? ''));
  const rja = rjas.size === 1 ? [...rjas][0] : null;
  const rjaMissing = rjas.has('');
  const rjaCell = `<td${rjaMissing ? ' class="missing"' : ''}><label class="visually-hidden" for="ic-rja-${g.parts[0].id}">R_JA of ${esc(label)}, °C/W</label><input id="ic-rja-${g.parts[0].id}" type="number" min="0" step="any" inputmode="decimal" data-bind="ic-rja" data-ic-key="${esc(g.key)}" value="${rja == null ? '' : esc(rja)}"${rja === null ? ' placeholder="differs"' : ''} aria-invalid="${rjaMissing}"></td>`;
  const opts = family === null
    ? `<option value="" selected>(differs between lines)</option>${optionsHTML(IC_FAMILY_OPTIONS, '-')}`
    : optionsHTML(IC_FAMILY_OPTIONS, family);
  return `<tr data-ic-key="${esc(g.key)}">
    <th scope="row">${esc(label)}</th>
    <td>${esc(g.parts.map((p) => p.ref).join(', '))}</td>
    <td class="num">${g.parts.reduce((s, p) => s + (p.qty ?? 0), 0)}</td>
    <td class="${missing ? 'missing' : guess ? 'inferred' : ''}"><label class="visually-hidden" for="${id}">Family of ${esc(label)}</label><select id="${id}" data-bind="ic-family" data-ic-key="${esc(g.key)}" aria-invalid="${missing}">${opts}</select></td>
    ${rjaCell}
    <td class="help">${esc(why)}</td>
    <td>${guess ? `<button type="button" data-act="ic-confirm" data-ic-key="${esc(g.key)}">Confirm</button>` : ''}</td>
  </tr>`;
}

function renderIcFamilies() {
  const groups = icGroups();
  $('#ic-review').hidden = !groups.length;
  if (!groups.length) return;
  const missing = groups.filter((g) => g.parts.some((p) => !p.params.family)).length;
  const guessed = groups.filter((g) => g.parts.some((p) => p.inferred?.family)).length;
  const noRja = groups.filter((g) => g.parts.some((p) => p.params.rja == null)).length;
  const families = [missing && `${missing} missing`, guessed && `${guessed} guessed`].filter(Boolean).join(', ');
  putText($('#ic-review-summary'), `ICs by part number: ${groups.length}${families ? `; family ${families}` : ''}${noRja ? `; R_JA missing on ${noRja}` : ''}`);
  setHTML($('#ic-families'), groups.map(icRowHTML).join(''));
  $('[data-act="ic-confirm-all"]').hidden = !guessed;
}
const icGroupOf = (key) => icGroups().find((g) => g.key === key);
const focusIcRow = (key, what) => [...document.querySelectorAll(`#ic-families ${what}`)].find((el) => el.dataset.icKey === key)?.focus();

// A guessed family becomes the line's own, with the reason kept on record.
function confirmIcFamily(part) {
  if (!part.inferred?.family) return;
  part.confirmed = { ...part.confirmed, family: part.inferred.family };
  delete part.inferred.family;
  rerenderPart(part);
}

// Find a line: a designator matches whole, also inside a range (C7 finds C6–C8 but not C17);
// other text matches the start of the imported value or part number.
function partMatches(part, tokens) {
  const refs = new Set(expandRefs(part.ref).map((r) => r.toLowerCase()));
  const texts = [part.source?.value, part.source?.mpn].filter(Boolean).map((t) => t.toLowerCase());
  return tokens.some((t) => refs.has(t) || texts.some((x) => x.startsWith(t)));
}
function applyFind() {
  const tokens = ($('#parts-find')?.value ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  for (const el of document.querySelectorAll('#parts > .part')) {
    const part = findPart(el.dataset.part);
    el.hidden = tokens.length > 0 && Boolean(part) && !partMatches(part, tokens);
  }
}
document.addEventListener('input', (e) => { if (e.target.id === 'parts-find') applyFind(); });

// Enter in a part's field goes to the next Missing field, opening the next line that needs input.
document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || el.dataset?.bind !== 'part' || el.tagName !== 'INPUT') return;
  e.preventDefault();
  const card = el.closest('.part');
  const following = (x) => el.compareDocumentPosition(x) & 4;
  const next = [...card.querySelectorAll('.field.missing input, .field.missing select')].find(following);
  if (next) { next.focus(); return; }
  const cards = [...document.querySelectorAll('#parts > .part:not([hidden])')];
  const i = cards.indexOf(card);
  const target = [...cards.slice(i + 1), ...cards.slice(0, i)].find((c) => c.classList.contains('needs-input'));
  if (!target) return;
  const part = findPart(target.dataset.part);
  if (!part.open) { part.open = true; rerenderPart(part); repaintPart(part); save(); }
  const fresh = $(`[data-part="${part.id}"]`);
  (fresh.querySelector('.field.missing input, .field.missing select') ?? $(`[data-act="toggle"][data-id="${part.id}"]`)).focus();
  fresh.scrollIntoView?.({ block: 'nearest' });
});

// ---------------------------------------------------------------------------
// Circuit board: plated-hole fatigue

function pcbHoleHTML(h, i) {
  const data = (key) => `data-bind="pcb-hole" data-i="${i}" data-key="${key}"`;
  const num = (key, label) => `<input type="number" min="0" step="any" inputmode="decimal" aria-label="${label}" ${data(key)} value="${h[key] ?? ''}">`;
  return `<tr data-hole="${i}">
    <td><input type="text" aria-label="Hole size" ${data('label')} value="${esc(h.label)}" placeholder="e.g. 0.3 mm vias"></td>
    <td data-cell="drill">${num('drill', 'Drill diameter, mm')}</td>
    <td data-cell="plating">${num('plating', 'Plating thickness, µm')}</td>
    <td class="num" data-out="used"></td>
    <td class="num" data-out="life"></td>
    <td class="num" data-out="fit"></td>
    <td class="life-acts"><button type="button" class="icon" data-act="pcb-confirm" data-i="${i}" aria-label="Confirm the guessed values of ${esc(h.label || 'this hole size')}"${Object.keys(h.inferred ?? {}).length ? '' : ' hidden'}>✓</button><button type="button" class="icon" data-act="pcb-del" data-i="${i}" aria-label="Remove ${esc(h.label || 'hole size')}">✕</button></td>
  </tr>`;
}

function renderPcb() {
  const s = state.pcb;
  $('#pcb-laminate').innerHTML = optionsHTML([
    ...LAMINATES.rows.map((r) => ({ value: r.id, label: r.label })),
    { value: 'custom', label: 'Custom laminate (enter its values)' },
  ], s.laminate);
  for (const k of PCB_NUMBERS) $(`#pcb-${k}`).value = s[k] ?? '';
  for (const k of ['tg', 'alpha1', 'alpha2', 'modulus']) $(`#pcb-custom-${k}`).value = s.custom[k] ?? '';
  $('#pcb-include').checked = s.include;
  $('#pcb-holes').innerHTML = s.holes.length
    ? s.holes.map(pcbHoleHTML).join('')
    : '<tr><td colspan="7" class="empty">No hole sizes yet. Add the smallest vias and the through holes for leaded parts; the smallest usually wear out first.</td></tr>';
}

// Board-level settings a check is missing, by name ("plating quality K_Q").
const settingsMissing = (problems) => problems.filter((p) => p.startsWith('Missing'))
  .map((p) => p.replace(/^Missing(?: for the custom laminate)?: /, '').replace(/\.$/, ''));
// A missing control says so in words and to assistive technology, as part cards do.
function markMissing(wrap, control, missing) {
  wrap?.classList.toggle('missing', missing);
  const tag = wrap?.querySelector?.('.state-tag');
  if (tag) tag.textContent = missing ? 'Missing' : '';
  control?.setAttribute('aria-invalid', String(missing));
}
// A value filled in from a file is Guessed, in amber, with where it came from, until changed or confirmed.
function markGuessed(wrap, control, reason) {
  wrap?.classList.toggle('inferred', Boolean(reason));
  const tag = wrap?.querySelector?.('.state-tag');
  if (tag && reason) tag.textContent = 'Guessed';
  if (reason) control?.setAttribute('title', `Guessed: ${reason}`);
  else if (control?.getAttribute('title')?.startsWith('Guessed: ')) control.removeAttribute('title');
}

function updatePcb(ev) {
  const s = state.pcb;
  const active = s.holes.length > 0;
  $('#pcb-custom').hidden = s.laminate !== 'custom';
  const lam = laminateOf(s);
  $('#pcb-laminate-note').innerHTML = lam && lam.id !== 'custom'
    ? `Tg ${lam.tg} °C; z-axis expansion ${lam.alpha1} ppm/°C below Tg, ${lam.alpha2} above; z-axis modulus ${lam.modulus / 1000} GPa${lam.modulusAssumed ? ' (the FR-4 value, as a stand-in)' : ''}. From ${esc(SOURCES_BOARD[lam.source].label)}.`
    : '';
  const missingKeys = new Set(active ? [
    ...(!s.laminate ? ['laminate'] : []),
    ...PCB_NUMBERS.filter((k) => !isNum(s[k]) || (k !== 'reflows' && k !== 'reflowPeak' && !(s[k] > 0)) || (k === 'kq' && s[k] > 10)),
    ...(s.laminate === 'custom' ? ['tg', 'alpha1', 'alpha2', 'modulus'].filter((k) => !isNum(s.custom[k])).map((k) => `custom-${k}`) : []),
  ] : []);
  for (const el of document.querySelectorAll('#pcb .pcb-settings .field')) {
    const control = el.querySelector('input, select');
    markMissing(el, control, missingKeys.has(el.dataset.field));
    markGuessed(el, control, missingKeys.has(el.dataset.field) ? null : s.inferred?.[el.dataset.field]);
  }
  $('[data-act="pcb-confirm-settings"]').hidden = !Object.keys(s.inferred ?? {}).length;
  $('#pcb-kq-band').textContent = s.kq > 0 && s.kq <= 10 ? `Yours is ${qualityBand(s.kq)}.` : '';
  ev.holes.forEach((r, i) => {
    const row = $(`#pcb-holes [data-hole="${i}"]`);
    if (!row) return;
    for (const key of ['drill', 'plating']) {
      const cell = $(`[data-cell="${key}"]`, row);
      const missing = (r.missing ?? []).includes(key);
      markMissing(cell, $('input', cell), missing);
      markGuessed(cell, $('input', cell), missing ? null : s.holes[i]?.inferred?.[key]);
    }
    row.classList.toggle('worst', ev.worst === r);
    row.classList.toggle('cracked', Boolean(r.cracked));
    $('[data-out="used"]', row).textContent = r.complete && r.assembly ? `${Math.min(100, Math.round(r.used * 100))} %` : r.complete ? '0 %' : '—';
    $('[data-out="life"]', row).textContent = r.complete && !r.cracked ? (Number.isFinite(r.alphaHours) ? `${fmt2(r.alphaHours / 8760)} y` : '∞') : r.cracked ? 'cracks' : '—';
    // A row waiting only for the board settings is not itself missing anything.
    $('[data-out="fit"]', row).innerHTML = r.complete && !r.cracked ? fmt(r.fit) : r.cracked ? '<span class="bad">Cracks</span>'
      : (r.missing ?? []).length ? '<span class="bad">Missing</span>' : '<span class="muted" title="Waiting for the board settings above">—</span>';
    if (r.complete) {
      row.title = [...(r.assembly ? [r.assembly] : []), ...r.field]
        .map((l) => `${l.label} (${fmt(l.tLow)} to ${fmt(l.tHigh)} °C): ${fmt2(l.nf)} cycles to failure, effective strain ${(l.strainEff * 100).toFixed(2)} %`).join('; ');
    }
  });
  const lines = [];
  if (ev.worst) {
    const w = ev.worst;
    lines.push(`Weakest: <b>${esc(w.hole.label || 'unnamed hole size')}</b>, ${w.assembly ? `assembly uses ${Math.round(w.used * 100)} % of its life, ` : ''}characteristic life ${Number.isFinite(w.alphaHours) ? `${fmt2(w.alphaHours / 8760)} years` : 'unlimited'}, <b>${fmt(w.fit)} FIT</b> averaged over the ${fmt(state.years)}-year design life. ${s.include ? 'Added to the board total.' : 'Not added to the board total.'}`);
  }
  if (active && !ev.conditions.field.length) lines.push('The mission profile has no thermal cycles (n and ΔT), so only the assembly reflows wear the holes.');
  const pcbSettings = settingsMissing(ev.conditions.problems);
  if (active && pcbSettings.length) lines.unshift(`The board settings above need input: ${esc(pcbSettings.join(', '))} (marked Missing).`);
  const ownHoles = ev.holes.filter((r) => (r.missing ?? []).length).length;
  if (ownHoles) lines.push(`${plural(ownHoles, 'hole size needs', 'hole sizes need')} input (marked Missing).`);
  const pcbOther = ev.problems.filter((p) => !p.startsWith('Missing'));
  $('#pcb-result').innerHTML = (lines.length ? `<p>${lines.join(' ')}</p>` : '')
    + (active && pcbOther.length ? `<ul class="problems">${pcbOther.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '');
}

// ---------------------------------------------------------------------------
// Surface-mount solder joints

const SMT_FIELDS = ['lead', 'body', 'd', 'h', 'rise'];

function smtRowHTML(d, i) {
  const data = (key) => `data-bind="smt-dev" data-i="${i}" data-key="${key}"`;
  const tip = (key) => (d.inferred?.[key] ? ` title="Guessed: ${esc(d.inferred[key])}"` : '');
  const num = (key, label) => `<input type="number" min="0" step="any" inputmode="decimal" aria-label="${label}" ${data(key)} value="${d[key] ?? ''}"${tip(key)}>`;
  const leaded = d.lead && d.lead !== 'leadless';
  return `<tr data-smt="${i}">
    <td><input type="text" aria-label="Devices" ${data('label')} value="${esc(d.label)}" placeholder="e.g. U3 (QFN-48)"></td>
    <td data-cell="lead"><select aria-label="Leads" ${data('lead')}${tip('lead')}>${optionsHTML(SMT_217F.leads.map((r) => ({ value: r.id, label: r.label })), d.lead)}</select></td>
    <td data-cell="body"><select aria-label="Body" ${data('body')}${tip('body')}>${optionsHTML(SMT_217F.bodies.map((r) => ({ value: r.id, label: `${r.label} (α ${r.alphaCC})` })), d.body)}</select></td>
    <td data-cell="d">${num('d', 'Centre to furthest joint, mm')}</td>
    <td data-cell="h">${leaded ? '<span class="muted">8 mils</span>' : num('h', 'Solder joint height, mm')}</td>
    <td data-cell="rise">${num('rise', 'Temperature rise from its own power, °C')}</td>
    <td class="num" data-out="life"></td>
    <td class="num" data-out="fit"></td>
    <td class="life-acts"><button type="button" class="icon" data-act="smt-confirm" data-i="${i}" title="Confirm the guessed values" aria-label="Confirm the guessed values of ${esc(d.label || 'this device')}"${Object.keys(d.inferred ?? {}).length ? '' : ' hidden'}>✓</button><button type="button" class="icon" data-act="smt-del" data-i="${i}" aria-label="Remove ${esc(d.label || 'device')}">✕</button></td>
  </tr>`;
}

function renderSmt() {
  const s = state.smt;
  $('#smt-substrate').innerHTML = optionsHTML(SMT_217F.substrates.map((r) => ({ value: r.id, label: `${r.label} (α ${r.alphaS})` })), s.substrate);
  $('#smt-cycling').value = s.cycling;
  $('#smt-equipment').innerHTML = optionsHTML(SMT_217F.equipment.map((r) => ({ value: r.id, label: `${r.label} (${r.cr} cycles/h)` })), s.equipment);
  $('#smt-include').checked = s.include;
  $('#smt-devices').innerHTML = s.devices.length
    ? s.devices.map(smtRowHTML).join('')
    : '<tr><td colspan="9" class="empty">No devices yet. Fill from chip parts, or add the largest leadless and ceramic packages (QFN, BGA, large chip capacitors).</td></tr>';
}

// Outputs only, so typing is not interrupted.
function updateSmt(smt) {
  const s = state.smt;
  $('#smt-equipment-field').hidden = s.cycling !== 'handbook';
  markMissing($('#smt-substrate').closest('.field'), $('#smt-substrate'), !s.substrate && s.devices.length > 0);
  smt.devices.forEach((r, i) => {
    const row = $(`#smt-devices [data-smt="${i}"]`);
    if (!row) return;
    for (const key of SMT_FIELDS) {
      const cell = $(`[data-cell="${key}"]`, row);
      if (cell) markMissing(cell, $('input, select', cell), (r.missing ?? []).includes(key));
      cell?.classList.toggle('inferred', Boolean(s.devices[i].inferred?.[key]));
    }
    const worst = smt.worst === r;
    row.classList.toggle('worst', worst);
    $('[data-out="life"]', row).textContent = r.complete ? (Number.isFinite(r.alphaHours) ? `${fmt2(r.alphaHours / 8760)} y` : '∞') : '—';
    $('[data-out="fit"]', row).innerHTML = r.complete ? fmt(r.fit)
      : (r.missing ?? []).length ? '<span class="bad">Missing</span>' : '<span class="muted" title="Waiting for the settings above">—</span>';
    if (r.complete) row.title = r.perLoad.map((l) => `${l.label}: ${fmt2(l.nf)} cycles to failure`).join('; ');
  });
  const lines = [];
  if (smt.worst) {
    const w = smt.worst;
    lines.push(`Weakest link: <b>${esc(w.device.label || 'unnamed device')}</b>, characteristic life ${Number.isFinite(w.alphaHours) ? `${fmt2(w.alphaHours / 8760)} years` : 'unlimited'}, <b>${fmt(w.fit)} FIT</b> averaged over the ${fmt(state.years)}-year design life (ECF ${w.ecf}). ${s.include ? 'Added to the board total.' : 'Not added to the board total.'}`);
  }
  const smtSettings = settingsMissing(smt.conditions.problems);
  if (s.devices.length && smtSettings.length) lines.unshift(`The settings above need input: ${esc(smtSettings.join(', '))} (marked Missing).`);
  const ownDevices = smt.devices.filter((r) => (r.missing ?? []).length).length;
  if (ownDevices) lines.push(`${plural(ownDevices, 'device needs', 'devices need')} input (marked Missing) before ${ownDevices > 1 ? 'they count' : 'it counts'}.`);
  const smtOther = smt.problems.filter((p) => !p.startsWith('Missing'));
  $('#smt-result').innerHTML = (lines.length ? `<p>${lines.join(' ')}</p>` : '')
    + (s.devices.length && smtOther.length ? `<ul class="problems">${smtOther.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '');
}

// Large ceramic chips crack when the board bends; no model counts it, so the page says so.
const flexText = (flex) => flex.map((f) => `${f.ref} (${f.code})`).join(', ');
function updateFlex(flex) {
  const note = $('#smt-flex');
  note.hidden = !flex.length;
  note.innerHTML = flex.length
    ? `<b>Flex cracking:</b> ${esc(flexText(flex))} ${flex.length > 1 ? 'are ceramic chips' : 'is a ceramic chip'} 1210 or larger. Ceramic chips crack when the board bends, from depanelling, screws, connectors or test fixtures, and the larger the chip the sooner; no failure rate here counts it. Standard terminations are tested to 2 mm of bend over a 90 mm span, soft (flexible) terminations to 5 mm. Keep these parts away from board edges, break lines, screws and connectors, lay them parallel to a break line, or choose soft-termination parts. Lines whose text says soft or flexible terminations are not listed.`
    : '';
}

// ---------------------------------------------------------------------------
// Electrolytic capacitor life

const LIFE_CELLS = ['tech', 'hours', 'temp', 'rated', 'ripple', 'ratio', 'rise', 'rise0', 'role'];
const TECH_OPTIONS = [{ value: 'wet', label: 'Wet' }, { value: 'polymer', label: 'Polymer' }, { value: 'hybrid', label: 'Hybrid' }];
const ROLE_SHORT = { drift: 'yes', hard: 'no' };
const LIFE_MODELS = ['capacitor', 'mil-capacitor', 'fixed', 'vendor'];
const pctWorn = (f) => (f >= 0.995 ? 'all' : f < 1e-4 ? 'under 0.01 %' : `${fmt2(f * 100)} %`);
const describePart = (part) => MODELS[part.model].describe({ ...MODELS[part.model].defaults, ...part.params });
// In the life table a line is named by what was imported for it, else by its part type.
const lifeLineText = (part) => [part.source?.value, part.source?.description].filter(Boolean).join(' · ') || describePart(part);
// The table is rebuilt only when its rows or their cells change, so typing is not interrupted.
let lifeShown = null;
const lifeSignature = (life) => life.rows.map((r) => `${r.part.id}:${r.values.ripple}:${r.values.rated}:${typeTech(r.part) ?? ''}`).join('|');

function lifeRowHTML(r) {
  const { part, values: v } = r;
  const data = (key) => `data-bind="life" data-id="${part.id}" data-key="${key}"`;
  const num = (key, label) => `<input type="number" min="0" step="any" inputmode="decimal" aria-label="${label}" ${data(key)} value="${v[key] ?? ''}">`;
  const select = (key, label, opts) => `<select aria-label="${label}" ${data(key)}>${optionsHTML(opts, v[key])}</select>`;
  const valueKey = v.ripple === 'ratio' ? 'ratio' : v.ripple === 'rise' ? 'rise' : null;
  const dash = '<span class="muted">—</span>';
  return `<tr data-life="${part.id}">
    <td><b data-out="ref">${esc(part.ref)}</b> <span class="muted" data-out="desc"></span></td>
    <td data-cell="tech" title="${esc(Object.values(LIFE_RULES.rules).map((r) => r.label).join('; '))}">${select('tech', 'Kind', TECH_OPTIONS)}</td>
    <td data-cell="hours">${num('hours', 'Rated life, hours')}</td>
    <td data-cell="temp">${num('temp', 'Rated temperature, °C')}</td>
    <td data-cell="rated">${select('rated', 'Rated life is with', [{ value: 'dc', label: 'Voltage' }, { value: 'ripple', label: 'Ripple' }])}</td>
    <td data-cell="ripple">${select('ripple', 'Ripple heating', [{ value: 'none', label: 'None' }, { value: 'ratio', label: 'Current' }, { value: 'rise', label: 'Rise' }])}</td>
    <td data-cell="${valueKey ?? 'value'}">${valueKey ? num(valueKey, valueKey === 'ratio' ? 'Ripple current over the rated ripple' : 'Measured rise above ambient, °C') : dash}</td>
    <td data-cell="rise0">${v.ripple === 'ratio' || v.rated === 'ripple' ? num('rise0', 'Rise at rated ripple, °C') : dash}</td>
    <td data-cell="role">${select('role', 'Drift is a failure', [{ value: 'default', label: 'Default' }, { value: 'drift', label: 'Yes' }, { value: 'hard', label: 'No' }])}</td>
    <td class="num" data-out="life"></td>
    <td class="num" data-out="fit"></td>
    <td class="life-acts"><button type="button" class="icon" data-act="life-confirm" data-id="${part.id}" title="Confirm the guessed values" aria-label="Confirm the guessed values of ${esc(part.ref)}" hidden>✓</button>${typeTech(part) ? '' : `<button type="button" class="icon" data-act="life-del" data-id="${part.id}" aria-label="Stop checking ${esc(part.ref)}">✕</button>`}</td>
  </tr>`;
}

function renderCapLife(life) {
  const focus = document.activeElement?.closest?.('#life-lines') ? { id: document.activeElement.dataset.id, key: document.activeElement.dataset.key } : null;
  $('#life-role').value = state.caplife.defaultRole ?? '';
  $('#life-polymer').value = state.caplife.polymerRule;
  $('#life-lines').innerHTML = life.rows.length
    ? life.rows.map(lifeRowHTML).join('')
    : '<tr><td colspan="12" class="empty">No aluminium electrolytic capacitors yet. Wet aluminium lines appear here by themselves, as do lines whose description says aluminium, polymer or hybrid; add any other line below.</td></tr>';
  lifeShown = lifeSignature(life);
  if (focus) $(`#life-lines [data-id="${focus.id}"][data-key="${focus.key}"]`)?.focus();
}

// Outputs only, so typing is not interrupted.
function updateCapLife(life) {
  if (lifeSignature(life) !== lifeShown) renderCapLife(life);
  const s = state.caplife;
  const roleField = $('#life-role').closest('.field');
  const roleMissing = !s.defaultRole && life.rows.some((r) => r.values.role === 'default');
  markMissing(roleField, $('#life-role'), roleMissing);
  for (const r of life.rows) {
    const row = $(`#life-lines [data-life="${r.part.id}"]`);
    if (!row) continue;
    $('[data-out="ref"]', row).textContent = r.part.ref;
    $('[data-out="desc"]', row).textContent = lifeLineText(r.part);
    for (const key of LIFE_CELLS) {
      const cell = $(`[data-cell="${key}"]`, row);
      if (!cell) continue;
      const control = $('input, select', cell);
      markMissing(cell, control, r.missing.includes(key));
      cell.classList.toggle('inferred', Boolean(r.inferred[key]));
      if (control) control.title = r.inferred[key] ? `Guessed ${r.inferred[key]}` : r.confirmed[key] ? `Guessed ${r.confirmed[key]}; confirmed` : '';
    }
    $('[data-key="role"] option[value="default"]', row).textContent = `Default${s.defaultRole ? ` (${ROLE_SHORT[s.defaultRole]})` : ''}`;
    $('[data-act="life-confirm"]', row).hidden = !Object.keys(r.inferred).length;
    row.classList.toggle('worn', Boolean(r.lifeComplete && r.wornOut));
    $('[data-out="life"]', row).textContent = r.lifeComplete ? `${fmt2(r.alphaHours / 8760)} y${r.capped ? ' (cap)' : ''}` : '—';
    $('[data-out="fit"]', row).innerHTML = !r.lifeComplete || !r.role ? '<span class="bad">Missing</span>'
      : r.role === 'hard' ? '<span class="muted">not counted</span>' : fmt(r.fitEach);
    row.title = r.lifeComplete
      ? `${r.phases.map((ph) => `${ph.label}: ${fmt(ph.ambient)} °C${r.rise ? ` + ${fmt(r.rise)} °C ripple heating` : ''}, life ${fmt2(ph.hours)} h`).join('; ')}. ${pctWorn(r.fraction)} worn out by the end of the mission. End of life: ${END_OF_LIFE.criteria[r.values.tech]}.`
      : '';
  }
  const lines = [];
  const counted = life.rows.filter((r) => life.byPart.has(r.part.id));
  if (counted.length) {
    const sum = counted.reduce((t, r) => t + r.fitEach * r.part.qty, 0);
    lines.push(`${plural(counted.length, 'line counts', 'lines count')} wear-out: <b>${fmt(sum)} FIT</b>, averaged over the ${fmt(state.years)}-year mission and added to ${counted.length > 1 ? 'their lines' : 'its line'}.`);
  }
  for (const r of life.wornOut) {
    lines.push(`<b>${esc(r.part.ref)}</b> reaches end of life after ${fmt2(r.alphaHours / 8760)} years, before the end of the mission (${pctWorn(r.fraction)} worn out by then)${r.role === 'hard' ? '; not counted, since only shorts and opens matter for it' : ''}.`);
  }
  for (const r of life.rows.filter((x) => x.lifeComplete && x.hot)) {
    lines.push(`<b>${esc(r.part.ref)}</b> runs above its rated temperature in some phase, where the makers' rules do not apply.`);
  }
  if (life.pending) lines.push(`${plural(life.pending, 'line needs', 'lines need')} input (red) before ${life.pending > 1 ? 'their' : 'its'} wear-out can count.`);
  $('#life-result').innerHTML = (lines.length ? `<p>${lines.join(' ')}</p>` : '')
    + (life.problems.length ? `<ul class="problems">${life.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '');
  // Other capacitor lines, and lines with a rate entered by hand, can be checked too.
  const add = $('#life-add');
  if (document.activeElement !== add) {
    const others = state.parts.filter((p) => LIFE_MODELS.includes(p.model) && !life.rows.some((r) => r.part === p));
    add.innerHTML = `<option value="">${others.length ? 'Choose a line…' : 'No other capacitor lines'}</option>${others.map((p) => `<option value="${p.id}">${esc(p.ref)}: ${esc(describePart(p))}</option>`).join('')}`;
    add.disabled = !others.length;
  }
}

function renderAll() {
  undoProfile = null;
  forgetRemoved();
  renderBoardBar();
  renderPresets();
  renderPhases();
  renderAddModel();
  renderParts();
  renderPcb();
  renderSmt();
  lifeShown = null;
  update();
}

// Recompute everything and refresh outputs without touching the inputs.
// The phase cells a profile problem concerns are marked, and described by the problem.
function markProfileCells(issues) {
  const marks = new Map();
  issues.forEach((p, k) => p.cells.forEach(([i, key]) => marks.set(`${i}-${key}`, [...(marks.get(`${i}-${key}`) ?? []), `profile-problem-${k}`])));
  for (const input of $('#phases').querySelectorAll('input[data-key]')) {
    const ids = marks.get(`${input.dataset.i}-${input.dataset.key}`);
    input.closest('td').classList.toggle('invalid', Boolean(ids));
    if (ids) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', ids.join(' '));
    } else if (input.hasAttribute('aria-invalid')) {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }
}

// Writes that skip unchanged content: a keystroke then touches only what it changed.
const putHTML = (node, html) => { if (node && node.innerHTML !== html) node.innerHTML = html; };
const putText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };

// What each card last showed, so a card whose line did not change is not repainted.
const paintedAs = new WeakMap();

// One part card's figures and field states, from its line's result. Returns whether it has guesses.
// profileKey stands for the mission profile, which every card's figures depend on.
function paintCard(el, comp, result, phases, profileKey = JSON.stringify(phases)) {
  const guesses = guessCount(comp);
  const key = JSON.stringify([comp.ref, comp.model, comp.qty, comp.params, Object.keys(comp.inferred ?? {}), Object.keys(comp.confirmed ?? {}),
    result.complete, result.fit, result.total, result.qty, result.missing, result.errors, result.notices, result.wearOut, profileKey]);
  if (paintedAs.get(el) === key) return guesses > 0;
  paintedAs.set(el, key);
  const model = MODELS[comp.model];
  const p = { ...model.defaults, ...comp.params };
  el.classList.toggle('needs-input', !result.complete);
  el.classList.toggle('has-guesses', guesses > 0);
  putText($('[data-out="desc"]', el), model.describe(p));
  // A long reference list is cut off in its box: the whole list is shown under the description.
  putText($('[data-out="refs"]', el), comp.ref.length > 8 ? comp.ref : '');
  putHTML($('[data-out="flags"]', el), [
    result.missing.length ? `<span class="flag missing">${result.missing.length} missing</span>` : '',
    !result.missing.length && !result.complete ? '<span class="flag missing">check input</span>' : '',
    guesses ? `<span class="flag guessed">${guesses} guessed</span>` : '',
  ].join(''));
  putHTML($('[data-out="fit"]', el), !result.complete
    ? '<span class="bad">Needs input</span>'
    : `<div class="each">${fmt(result.fit)} FIT</div>${result.qty !== 1 ? `<div class="total">× ${fmt(result.qty)} = ${fmt(result.total)} FIT</div>` : ''}`);
  putHTML($('[data-out="errors"]', el), result.errors.map((e) => `<li>${esc(e)}</li>`).join(''));
  // Notices do not leave the line out of the total (a maker's MTBF stated for another environment).
  const notices = $('[data-out="notices"]', el);
  if (notices) putHTML(notices, (result.notices ?? []).map((n) => `<li>${esc(n)}</li>`).join(''));
  // Only open cards have a calculation panel (closed cards are just their head).
  const trace = $('[data-out="trace"]', el);
  if (trace) putHTML(trace, traceHTML(result, phases, failureModesFor(comp.model, p)));
  for (const wrap of el.querySelectorAll('[data-field]')) {
    const field = wrap.dataset.field;
    const missing = result.missing.includes(field);
    const guessed = Boolean(comp.inferred?.[field]);
    wrap.classList.toggle('missing', missing);
    wrap.classList.toggle('inferred', guessed && !missing);
    putText(wrap.querySelector('.state-tag'), missing ? 'Missing' : guessed ? 'Guessed' : '');
    wrap.querySelector('input, select')?.setAttribute('aria-invalid', String(missing));
    const note = wrap.querySelector('[data-guess-for]');
    if (note) note.hidden = !guessed;
    const confirmedNote = wrap.querySelector('[data-confirmed-for]');
    if (confirmedNote) confirmedNote.hidden = !comp.confirmed?.[field];
  }
  for (const f of model.fields) {
    if (typeof f.help === 'function') putText($(`[data-help-key="${f.key}"]`, el), f.help(p));
  }
  return guesses > 0;
}

// Repaint one card from the figures last computed (opening or closing it changes no figure).
function repaintPart(part) {
  const el = document.querySelector(`#parts > [data-part="${part.id}"]`);
  const item = lastFigures?.board.items.find((it) => it.comp.id === part.id);
  if (el && item) paintCard(el, part, item.result, lastFigures.board.prof.phases);
}

function update() {
  const years = isNum(state.years) ? state.years : 0;
  // Capacitor wear-out is added to the lines whose drift counts, before anything is summed.
  const life = evaluateCapLife(state.parts, state.caplife, state.profile, years);
  const board = withLife(computeBoard({ profile: state.profile, components: state.parts }), life);
  const issues = profileIssues(state.profile);
  const problems = issues.map((x) => x.text);

  $('#tau-summary').innerHTML = `τ<sub>on</sub> = <b>${fmt(board.prof.tauOn)}</b>, τ<sub>off</sub> = <b>${fmt(board.prof.tauOff)}</b>${state.profile.tauOff == null ? ' (1 − τ<sub>on</sub>)' : ''}`;
  setHTML($('#profile-problems'), issues.map((p, k) => `<li id="profile-problem-${k}">${esc(p.text)}${p.cells.length
    ? ` <button type="button" class="link" data-act="show-cell" data-i="${p.cells[0][0]}" data-key="${p.cells[0][1]}">Show</button>` : ''}</li>`).join(''));
  markProfileCells(issues);

  let guessedLines = 0;
  // One lookup for all the cards: a document query per line grows with lines × page size.
  const cards = new Map([...document.querySelectorAll('#parts > [data-part]')].map((c) => [c.dataset.part, c]));
  const profileKey = JSON.stringify(board.prof.phases);
  board.items.forEach(({ comp, result }) => {
    const el = cards.get(comp.id);
    if (el && paintCard(el, comp, result, board.prof.phases, profileKey)) guessedLines++;
  });

  updateCapLife(life);
  renderIcFamilies();
  const structure = refreshStructure(board.items, years);
  // With redundant blocks the board figures are averages over the mission.
  const redundancy = structure.redundancy;
  // Surface-mount solder joints: the weakest device's rate over the design life, in series with the rest.
  const smt = evaluateSmt(state.smt, state.profile, years);
  updateSmt(smt);
  const flex = flexRisks(state.parts);
  updateFlex(flex);
  const smtFit = state.smt.include && smt.worst ? smt.fit : 0;
  const smtPending = state.smt.include && state.smt.devices.length > 0 && (smt.incomplete > 0 || smt.problems.length > 0);
  // Circuit board: the weakest plated-hole size, likewise.
  const pcb = evaluateBoard(state.pcb, state.profile, years);
  updatePcb(pcb);
  const pcbFit = state.pcb.include && pcb.worst ? pcb.fit : 0;
  const pcbPending = state.pcb.include && state.pcb.holes.length > 0 && (pcb.incomplete > 0 || pcb.problems.length > 0);
  const wearFit = smtFit + pcbFit;
  const total = (redundancy ? structure.board.fit : board.total) + wearFit;
  const smtR = (t) => Math.exp(-wearFit * 1e-9 * t);
  const R = redundancy ? structure.survival(years * 8760) * smtR(years * 8760) : reliability(total, years);
  const mtbf = redundancy ? (wearFit ? meanTimeToFailure((t) => structure.survival(t) * smtR(t)) : structure.mttfHours) : mtbfHours(total);
  const pieces = board.items.reduce((s, it) => s + it.result.qty, 0);
  const warn = [];
  // Warnings about a check that needs input link to it (text → panel id).
  const warnPanel = new Map();
  if (problems.length) warn.push('The mission profile has problems (see above).');
  if (board.incomplete) warn.push(`${plural(board.incomplete, 'part line needs', 'part lines need')} more input; the total leaves ${board.incomplete > 1 ? 'them' : 'it'} out.`);
  // Makers' MTBFs by different prediction methods are summed but not comparable.
  const mtbfMethods = [...new Set(board.items.filter((it) => it.comp.model === 'vendor' && it.comp.params?.method === 'mtbf' && it.result.complete)
    .map((it) => VENDOR_MTBF.methods.find((m) => m.id === it.comp.params.predMethod)?.family).filter(Boolean))];
  if (mtbfMethods.length > 1) warn.push(`Makers' MTBFs here come from different prediction methods (${mtbfMethods.join(', ')}), which are not comparable: for the same unit MIL-HDBK-217F gives a 2–5× shorter MTBF than Telcordia SR-332.`);
  // With some devices complete, the weakest link so far is counted; the rest may be worse.
  const smtWaiting = smtPending && smt.worst && !smt.problems.length;
  if (pcb.cracked) warn.push(`${plural(pcb.cracked, 'plated hole size is', 'plated hole sizes are')} predicted to crack during assembly; see Circuit board.`);
  else if (pcbPending) {
    const what = settingsMissing(pcb.conditions.problems);
    warn.push(`The circuit-board check needs input${what.length ? `: ${what.join(', ')}` : ''}; the total leaves it out.`);
    warnPanel.set(warn.at(-1), 'pcb');
  }
  if (smtPending) {
    warn.push(smtWaiting
      ? `${plural(smt.incomplete, 'surface-mount device needs', 'surface-mount devices need')} input; until then the weakest link is taken from the others.`
      : `The surface-mount check needs input${settingsMissing(smt.conditions.problems).length ? `: ${settingsMissing(smt.conditions.problems).join(', ')}` : ''}; the total leaves it out.`);
    warnPanel.set(warn.at(-1), 'smt');
  }
  if (life.pending) {
    warn.push(`${plural(life.pending, 'capacitor life check needs', 'capacitor life checks need')} input; the total leaves ${life.pending > 1 ? 'their' : 'its'} wear-out out.`);
    warnPanel.set(warn.at(-1), 'caplife');
  }
  if (life.wornOut.length) warn.push(`${plural(life.wornOut.length, 'capacitor line reaches', 'capacitor lines reach')} end of life before the end of the mission; see Electrolytic capacitor life.`);
  const guessedGroups = [...structure.red].filter((id) => currentBlock(id)?.inferred?.shortPct).length;
  if (guessedLines) warn.push(`${plural(guessedLines, 'line uses', 'lines use')} guessed values; check and confirm them.`);
  if (life.guessed) warn.push(`${plural(life.guessed, 'capacitor life uses', 'capacitor lives use')} guessed values; check and confirm them.`);
  if (guessedGroups) warn.push(`${plural(guessedGroups, 'redundant block uses', 'redundant blocks use')} a guessed share of failures; check and confirm ${guessedGroups > 1 ? 'them' : 'it'}.`);
  // While lines are left out, the total is only a lower bound, so MTBF and
  // survival are upper bounds; say so and show fewer digits.
  const partial = board.incomplete > 0 || smtPending || pcbPending || life.pending > 0;
  const ge = partial ? '≥ ' : '';
  const le = partial ? '≤ ' : '';
  const pct = (r) => `${(r * 100).toFixed(r > 0.999 ? 3 : 1)}%`;
  const leftOut = [
    board.incomplete ? plural(board.incomplete, 'line') : '', pcbPending ? 'the circuit board' : '',
    smtPending ? (smtWaiting ? plural(smt.incomplete, 'surface-mount device') : 'the surface-mount check') : '',
    life.pending ? plural(life.pending, 'capacitor wear-out') : '',
  ].filter(Boolean).join(', ');
  // A link down to the results, naming what dominates the board.
  const largest = [...board.items].filter((it) => it.result.complete && it.result.total > 0).sort((a, b) => b.result.total - a.result.total)[0];
  const sumAll = board.total + wearFit;
  const shortRefs = (ref) => { const r = ref.split(/,\s*/); return r.length > 3 ? `${r.slice(0, 3).join(', ')}…` : ref; };
  const jump = `<p class="jump"><a href="#results-heading">Results by part</a>${largest && sumAll > 0 ? `: largest ${esc(shortRefs(largest.comp.ref))}, ${((100 * largest.result.total) / sumAll).toFixed(0)}%` : ''}</p>`;
  const boundNote = partial ? `<div class="sub">Lower bound: ${leftOut} left out</div>` : '';
  // The spreadsheet reports these same figures.
  lastFigures = { board, life, smt, pcb, total, sum: board.total + wearFit, R, mtbf, redundancy, partial, leftOut, pieces, warn, guessedLines };
  setHTML($('#summary'), `<div class="tiles${partial ? ' partial' : ''}">
    <div class="tile"><div class="label">${redundancy ? `Board failure rate, average over ${fmt(years)} years` : 'Board failure rate'}</div><div class="value">${ge}${fmt2(total)} FIT</div><div class="sub">${fmt(pieces)} pieces in ${state.parts.length} lines${redundancy ? ', with redundancy' : ''}</div>${boundNote}</div>
    <div class="tile bounded"><div class="label">${redundancy ? 'Mean time to failure' : 'MTBF'}</div><div class="value">${Number.isFinite(mtbf) ? `${le}${fmt2(mtbf)} h` : '—'}</div><div class="sub">${Number.isFinite(mtbf) ? `${le}${fmt2(mtbf / 8760)} years` : 'no failure rate yet'}</div></div>
    <div class="tile bounded"><div class="label">Survival over ${fmt(years)} years</div><div class="value">${le}${pct(R)}</div><div class="sub">${ge}${fmt2(1000 * (1 - R))} failures per 1000 boards</div></div>
    </div>${warn.length ? `<p class="warn">${warn.map((w) => (warnPanel.has(w) ? `<a href="#${warnPanel.get(w)}" data-goto="${warnPanel.get(w)}">${esc(w)}</a>` : esc(w))).join(' ')}</p>` : ''}
    <p class="scope">${redundancy
    ? 'Parts in redundant blocks count as set under Reliability structure; every other part counts in series.'
    : 'The total counts a failure of any listed part as a board failure, so parts wired in parallel still add up unless you group them under Reliability structure.'} ${smtFit
    ? 'Surface-mount solder joints count once more through their weakest device (MIL-HDBK-217F 16.2), on top of the IEC TR 62380 package terms, which already include joint fatigue for the parts they model.'
    : 'Solder joints are part of each IEC TR 62380 component\'s package term; MIL-HDBK-217F parts need the surface-mount check for theirs.'} ${pcbFit
    ? 'The circuit board counts through its weakest plated hole size.'
    : 'The bare circuit board is not included unless its plated holes are checked under Circuit board.'}${life.rows.length
    ? ' Aluminium electrolytic capacitors include their wear-out only where drift is a failure (Electrolytic capacitor life).' : ''}${flex.length
    ? ` Flex cracking of ${esc(flexText(flex))}, ceramic chips 1210 or larger, is not counted; see Surface-mount solder joints.` : ''} Anything not in the list is not included.</p>${jump}`);

  const sum = board.total + wearFit;
  const sorted = [...board.items].sort((a, b) => b.result.total - a.result.total || Number(a.result.complete) - Number(b.result.complete));
  setHTML($('#results'), sorted.length
    ? sorted.map(({ comp, result }, i) => {
      const model = MODELS[comp.model];
      // The largest contributor gets a small flame in the stylesheet.
      const top = i === 0 && sorted.length > 1 && result.complete && result.total > 0;
      const share = sum > 0 ? (100 * result.total) / sum : 0;
      const each = result.complete ? fmt(result.fit) : '<span class="bad">Missing</span>';
      const desc = `${model.describe({ ...model.defaults, ...comp.params })}${result.wearOut ? ', with wear-out' : ''}`;
      return `<tr${top ? ' class="top"' : ''}><td class="ref" data-desc="${esc(desc)}"><button type="button" class="link refs" data-act="goto-part" data-id="${comp.id}" title="${esc(comp.ref)}">${esc(comp.ref)}</button></td><td class="opt">${esc(desc)}</td><td class="num">${fmt(result.qty)}</td><td class="num opt">${each}</td><td class="num">${result.complete ? fmt(result.total) : '—'}</td><td class="num">${result.complete ? `${share.toFixed(1)}%` : '—'}</td></tr>`;
    }).join('')
      + (pcbFit ? `<tr class="smt-row"><td>Circuit board</td><td class="opt">Plated holes, weakest: ${esc(pcb.worst.hole.label || 'unnamed hole size')}</td><td></td><td class="opt"></td><td class="num">${fmt(pcbFit)}</td><td class="num">${sum > 0 ? `${((100 * pcbFit) / sum).toFixed(1)}%` : '—'}</td></tr>` : '')
      + (smtFit ? `<tr class="smt-row"><td>Solder joints</td><td class="opt">Surface mount, weakest link: ${esc(smt.worst.device.label || 'unnamed device')}</td><td></td><td class="opt"></td><td class="num">${fmt(smtFit)}</td><td class="num">${sum > 0 ? `${((100 * smtFit) / sum).toFixed(1)}%` : '—'}</td></tr>` : '')
      + (redundancy ? `<tr><td colspan="4">Sum of part rates (all in series)</td><td class="num">${fmt(sum)}</td><td class="num">100%</td></tr>` : '')
      + `<tr><td><strong>${redundancy ? `Board, with redundancy (average over ${fmt(years)} years)` : 'Board'}</strong></td><td class="opt"></td><td></td><td class="opt"></td><td class="num"><strong>${fmt(total)}</strong></td><td class="num">${redundancy ? '' : '100%'}</td></tr>`
    : '<tr><td colspan="6">No parts yet.</td></tr>');
}

// ---------------------------------------------------------------------------
// Files

// Write markup only when it changed: the summary is a live region, re-announced on every write,
// and rewriting the results table drops a selection in it.
const lastHTML = new WeakMap();
function setHTML(el, html) {
  if (lastHTML.get(el) === html) return;
  lastHTML.set(el, html);
  el.innerHTML = html;
}

function download(name, type, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const fileBase = () => (state.title || 'board').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'board';

// Quote every cell; prefix text that a spreadsheet would read as a formula.
function csvCell(v) {
  let s = String(v ?? '');
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

let lastFigures = null;

// The board as an .xlsx workbook: summary, parts, calculation, inputs, profile, structure.
function boardWorkbook() {
  const f = lastFigures;
  const text = (sel) => ($(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return xlsx(boardSheets({
    title: state.title, years: isNum(state.years) ? state.years : 0, generated: new Date(), url: (document.location?.href ?? '').split(/[?#]/)[0],
    notice: text('.notice'), scope: text('#summary .scope'), profile: state.profile,
    board: f.board, life: f.life, smt: f.smt, pcb: f.pcb, smtInclude: state.smt.include, pcbInclude: state.pcb.include,
    structure: currentStructure(), figures: f,
  }), { title: state.title });
}

function boardCSV() {
  const years = isNum(state.years) ? state.years : 0;
  const life = evaluateCapLife(state.parts, state.caplife, state.profile, years);
  const board = withLife(computeBoard({ profile: state.profile, components: state.parts }), life);
  const rows = [['Ref', 'Part type', 'Description', 'Qty', 'Lambda each (FIT)', 'Lambda total (FIT)', 'Share (%)', 'Breakdown (FIT)', 'Problems', 'Guessed values', 'Confirmed guesses', 'Manufacturer', 'MPN']];
  for (const { comp, result } of board.items) {
    const model = MODELS[comp.model];
    const p = { ...model.defaults, ...comp.params };
    const labels = (map) => Object.keys(map ?? {}).map((k) => fieldLabel(model.fields.find((f) => f.key === k) ?? { label: k }, p)).join('; ');
    rows.push([
      comp.ref, model.label, model.describe(p), result.qty,
      result.complete ? result.fit : '', result.complete ? result.total : '',
      result.complete && board.total > 0 ? ((100 * result.total) / board.total).toFixed(2) : '',
      result.complete ? result.parts.map(([k, v]) => `${k} ${+v.toPrecision(4)}`).join('; ') : '',
      result.errors.join(' '), labels(comp.inferred), labels(comp.confirmed), comp.source?.manufacturer ?? '', comp.source?.mpn ?? '',
    ]);
  }
  const smt = evaluateSmt(state.smt, state.profile, years);
  if (state.smt.devices.length) {
    rows.push(['Solder joints', 'Surface mount (MIL-HDBK-217F 16.2), weakest link', smt.worst ? smt.worst.device.label : '', '', '',
      smt.worst ? smt.fit : '', '', '', [...smt.problems, smt.incomplete ? `${smt.incomplete} devices need input.` : ''].filter(Boolean).join(' '),
      '', '', '', '']);
    for (const r of smt.devices) {
      rows.push([`  ${r.device.label}`, 'Surface-mount device', `${r.device.lead ?? ''} ${r.device.body ?? ''}, d ${r.device.d ?? ''} mm`, '', '', r.complete ? r.fit : '', '', '', r.complete ? '' : `Missing: ${r.missing.join(', ')}`, '', '', '', '']);
    }
  }
  const pcb = evaluateBoard(state.pcb, state.profile, years);
  if (state.pcb.holes.length) {
    rows.push(['Circuit board', 'Plated-hole fatigue (IPC-TR-579), weakest hole size', pcb.worst ? pcb.worst.hole.label : '', '', '',
      pcb.worst ? pcb.fit : '', '', '', [...pcb.problems, pcb.incomplete ? `${pcb.incomplete} hole sizes need input.` : ''].filter(Boolean).join(' '), '', '', '', '']);
    for (const r of pcb.holes) {
      rows.push([`  ${r.hole.label}`, 'Plated hole', `drill ${r.hole.drill ?? ''} mm, plating ${r.hole.plating ?? ''} µm`, '', '', r.complete && !r.cracked ? r.fit : '', '', '',
        r.cracked ? 'Cracks during assembly' : r.complete ? '' : `Missing: ${r.missing.join(', ')}`, '', '', '', '']);
    }
  }
  if (life.rows.length) {
    rows.push(['Capacitor life', 'Aluminium electrolytic wear-out (makers\' rules)', '', '', '', '', '', '', life.problems.join(' '), '', '', '', '']);
    for (const r of life.rows) {
      const v = r.values;
      rows.push([`  ${r.part.ref}`, `Capacitor life, ${v.tech ?? 'kind missing'}`, `${v.hours ?? '?'} h at ${v.temp ?? '?'} °C; life ${r.lifeComplete ? `${+(r.alphaHours / 8760).toPrecision(3)} years` : 'not worked out'}`,
        r.part.qty, life.byPart.has(r.part.id) ? r.fitEach : '', life.byPart.has(r.part.id) ? r.fitEach * r.part.qty : '', '', '',
        [r.missing.length ? `Missing: ${r.missing.join(', ')}` : '', r.role === 'hard' ? 'Not counted: only shorts and opens matter' : '', r.lifeComplete && r.wornOut ? 'Reaches end of life before the end of the mission' : ''].filter(Boolean).join('. '),
        Object.keys(r.inferred).join('; '), Object.keys(r.confirmed).join('; '), '', '']);
    }
  }
  const smtFit = (state.smt.include && smt.worst ? smt.fit : 0) + (state.pcb.include && pcb.worst ? pcb.fit : 0);
  rows.push(['Board', '', '', '', '', board.total + smtFit, '100', '', board.incomplete ? `Lower bound: ${board.incomplete} lines left out` : '', '', '']);
  // Blocks of the reliability structure, depth first, with their mission-average rates.
  const { rt, ev } = currentStructure();
  const blockRows = (id, depth) => {
    const n = rt.nodes.get(id);
    if (n.kind !== 'block') return;
    if (!n.fixed) {
      const st = ev.stats.get(id);
      const red = ev.red.has(id);
      rows.push([`${'  '.repeat(depth)}${structureLabel(rt, id)}`, red ? 'Redundant block' : n.mode === 'kofn' ? 'Redundant block, counted in series' : 'Series block',
        red ? `${n.need} of ${structureMembers(rt, id)} must work; ${n.shortPct}% of failures break it anyway` : '',
        st.pieces, '', st.fit, '', '', ev.prob.get(id).join(' '), n.inferred?.shortPct ? 'Share of failures' : '', '']);
    }
    n.children.forEach((c) => blockRows(c, depth + (n.fixed ? 0 : 1)));
  };
  blockRows(ROOT, 0);
  if (ev.redundancy) rows.push([`Board with redundancy, average over ${state.years} years`, '', '', '', '', ev.board.fit, '', '', '', '', '']);
  return rows.map((r) => [...r, ...Array(rows[0].length - r.length).fill('')].map(csvCell).join(',')).join('\r\n');
}

// Netlists are usually plain ASCII, but values such as "10µF" may be in a
// Windows code page rather than UTF-8.
async function readText(file) {
  return decodeText(new Uint8Array(await file.arrayBuffer()));
}

// The toolbar button that opened the file picker, where Dismiss returns the focus.
let reportOpener = null;
function showReport(html) {
  const box = $('#import-report');
  const attention = document.querySelector('#parts .part.needs-input, #parts .part.has-guesses');
  const ics = !$('#ic-review').hidden;
  box.innerHTML = `<p>${html}</p><p class="report-actions">${attention ? '<button type="button" data-act="attention">Show only the lines that need attention</button> ' : ''}${
    ics ? '<button type="button" data-act="review-ics">Review ICs by part number</button> ' : ''}<button type="button" data-act="dismiss-report">Dismiss</button></p>`;
  box.hidden = false;
  box.scrollIntoView?.({ block: 'nearest' });
  box.focus({ preventScroll: true });
}

// Open a part line, show it and put the focus on it (from the results or the structure).
function showPart(part) {
  part.open = true;
  if ($('#attention-only').checked && !$(`[data-part="${part.id}"]`)?.matches('.needs-input, .has-guesses')) {
    $('#attention-only').checked = false;
    $('#parts').classList.remove('attention-only');
  }
  rerenderPart(part);
  repaintPart(part);
  $(`#${part.id}-ref`)?.scrollIntoView?.({ block: 'center' });
  $(`[data-act="toggle"][data-id="${part.id}"]`)?.focus();
  save();
}

// ---------------------------------------------------------------------------
// Events

function markCustomProfile() {
  state.profile.preset = null;
  $('#preset').value = '';
}

function nextRef(model) {
  const prefix = REF_PREFIX[model] ?? 'X';
  const re = new RegExp(`(?:^|[^A-Za-z])${prefix}(\\d+)`, 'g');
  let max = 0;
  for (const p of state.parts) for (const m of p.ref.matchAll(re)) max = Math.max(max, Number(m[1]));
  return `${prefix}${max + 1}`;
}

// A capacitor life value the user entered: no longer a guess, confirmed or not.
function setLife(part, key, value) {
  part.life = { ...part.life, [key]: value };
  if (part.life.confirmed?.[key]) delete part.life.confirmed[key];
}

// An edited value is the user's own, no longer a guess, confirmed or not.
function clearGuess(part, key) {
  if (part.inferred?.[key]) delete part.inferred[key];
  if (part.confirmed?.[key]) delete part.confirmed[key];
}

document.addEventListener('input', (e) => {
  const el = e.target;
  const bind = el.dataset?.bind;
  if (!bind || el.tagName === 'SELECT' || el.type === 'checkbox') return;
  // Applied on change, to every line of the part number: applied while typing, the list would redraw under the cursor.
  if (bind === 'ic-rja') return;
  // The name feeds no figure: save it without recomputing the board.
  if (bind === 'title') { state.title = el.value; save(); return; }
  if (bind === 'years') state.years = numOrNull(el.value);
  else if (bind === 'tauOff') state.profile.tauOff = numOrNull(el.value);
  else if (bind === 'phase') {
    const ph = state.profile.phases[Number(el.dataset.i)];
    ph[el.dataset.key] = el.dataset.key === 'name' ? el.value : numOrNull(el.value);
    if (el.dataset.key !== 'name') markCustomProfile();
    if (undoProfile) { undoProfile = null; renderProfileUndo(); }
  } else if (bind === 'pcb') {
    const key = el.dataset.key;
    if (key.startsWith('custom.')) state.pcb.custom[key.slice(7)] = numOrNull(el.value);
    else state.pcb[key] = numOrNull(el.value);
    delete state.pcb.inferred?.[key];
  } else if (bind === 'pcb-hole') {
    const hole = state.pcb.holes[Number(el.dataset.i)];
    hole[el.dataset.key] = el.dataset.key === 'label' ? el.value : numOrNull(el.value);
    delete hole.inferred?.[el.dataset.key];
  } else if (bind === 'smt-dev') {
    const dev = state.smt.devices[Number(el.dataset.i)];
    const key = el.dataset.key;
    dev[key] = key === 'label' ? el.value : numOrNull(el.value);
    if (dev.inferred?.[key]) { delete dev.inferred[key]; el.removeAttribute('title'); }
  } else if (bind === 'life') {
    setLife(findPart(el.dataset.id), el.dataset.key, numOrNull(el.value));
  } else if (bind === 'part') {
    const part = findPart(el.dataset.id);
    const key = el.dataset.key;
    if (key === 'ref') part.ref = el.value;
    else if (key === 'qty') part.qty = numOrNull(el.value) ?? 0;
    else {
      part.params[key] = el.type === 'number' ? numOrNull(el.value) : el.value;
      clearGuess(part, key);
    }
  }
  save();
  update();
});

document.addEventListener('change', (e) => {
  const el = e.target;
  const bind = el.dataset?.bind;
  if (el.id === 'attention-only') {
    $('#parts').classList.toggle('attention-only', el.checked);
    return;
  }
  if (el.id === 'remember') { setRemember(el.checked); return; }
  if (!bind && el.id !== 'life-add') return;
  if (bind === 'pcb' && (el.tagName === 'SELECT' || el.type === 'checkbox')) {
    if (el.type === 'checkbox') state.pcb.include = el.checked;
    else { state.pcb.laminate = el.value || null; delete state.pcb.inferred?.laminate; }
  } else if (bind === 'smt') {
    const key = el.dataset.key;
    state.smt[key] = el.type === 'checkbox' ? el.checked : el.value || null;
    if (key === 'cycling' && !state.smt.cycling) state.smt.cycling = 'profile';
  } else if (bind === 'smt-dev' && el.tagName === 'SELECT') {
    const i = Number(el.dataset.i);
    const dev = state.smt.devices[i];
    dev[el.dataset.key] = el.value || null;
    if (dev.inferred?.[el.dataset.key]) delete dev.inferred[el.dataset.key];
    // Leaded parts use the handbook's 8-mil joint height, so the row's cells change.
    $(`#smt-devices [data-smt="${i}"]`).outerHTML = smtRowHTML(dev, i);
    $(`#smt-devices [data-smt="${i}"] [data-key="${el.dataset.key}"]`)?.focus();
  } else if (bind === 'life' && el.tagName === 'SELECT') {
    setLife(findPart(el.dataset.id), el.dataset.key, el.value || null);
  } else if (bind === 'caplife') {
    state.caplife[el.dataset.key] = el.value || null;
    state.caplife.polymerRule ??= 'majority';
  } else if (el.id === 'life-add') {
    const part = findPart(el.value);
    if (part) part.life = { ...part.life, listed: true };
    el.blur();
  } else if (bind === 'env217f') {
    state.profile.env217f = el.value;
  } else if (bind === 'preset') {
    if (!el.value) return;
    const before = state.profile;
    state.profile = presetProfile(el.value, state.profile.env217f);
    if (before.preset == null) undoProfile = before;
    renderPhases();
  } else if (bind === 'phase' && el.type === 'checkbox') {
    state.profile.phases[Number(el.dataset.i)].addRise = el.checked;
    markCustomProfile();
  } else if (bind === 'part-model') {
    // A new type starts from its own defaults; reference, quantity and netlist data stay.
    const part = findPart(el.dataset.id);
    part.model = el.value;
    part.params = clone(MODELS[part.model].defaults);
    if ('note' in part.params && part.source?.value) part.params.note = part.source.value;
    part.inferred = {};
    part.confirmed = {};
    rerenderPart(part, null);
    $(`#${part.id}-model`)?.focus();
  } else if (bind === 'part' && el.tagName === 'SELECT') {
    const part = findPart(el.dataset.id);
    part.params[el.dataset.key] = el.value || null;
    clearGuess(part, el.dataset.key);
    rerenderPart(part, el.dataset.key);
  } else if (bind === 'ic-family') {
    // Every line of the part number takes the family, as if chosen on each card.
    const key = el.dataset.icKey;
    if (!el.value) return;
    for (const part of icGroupOf(key)?.parts ?? []) {
      part.params.family = el.value;
      clearGuess(part, 'family');
      rerenderPart(part);
    }
    save();
    update();
    focusIcRow(key, 'select');
    return;
  } else if (bind === 'ic-rja') {
    const key = el.dataset.icKey;
    for (const part of icGroupOf(key)?.parts ?? []) {
      part.params.rja = numOrNull(el.value);
      clearGuess(part, 'rja');
      rerenderPart(part);
    }
    save();
    update();
    focusIcRow(key, 'input');
    return;
  } else {
    return;
  }
  save();
  update();
});

// A block copied from a spreadsheet fills the phase table from the cell pasted into, adding
// phases as needed (name, t_ac, τ, n, ΔT, +ΔT/3). A single value is left to the browser.
const PHASE_COLS = ['name', 'tac', 'tau', 'n', 'dT', 'addRise'];
const cellNumber = (raw) => {
  const t = raw.replace(/[\u2212\u2013]/g, '-').replace(/\s*°?\s*C$/i, '').trim();
  return numOrNull(/^-?\d+,\d+$/.test(t) ? t.replace(',', '.') : t);
};
document.addEventListener('paste', (e) => {
  const el = e.target;
  if (el.dataset?.bind !== 'phase') return;
  const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r/g, '').replace(/\n+$/, '');
  if (!/[\t\n]/.test(text)) return;
  e.preventDefault();
  let rows = text.split('\n').map((r) => r.split('\t'));
  const col0 = PHASE_COLS.indexOf(el.dataset.key);
  const numeric = (cells) => cells.some((c, k) => !['name', 'addRise'].includes(PHASE_COLS[col0 + k]) && cellNumber(c) != null);
  if (rows.length > 1 && !numeric(rows[0])) rows = rows.slice(1); // a header row
  const start = Number(el.dataset.i);
  rows.forEach((cells, r) => {
    const i = start + r;
    while (state.profile.phases.length <= i) state.profile.phases.push({ name: `Phase ${state.profile.phases.length + 1}`, tac: 25, tau: 0, n: 0, dT: 0, addRise: false });
    const ph = state.profile.phases[i];
    cells.forEach((raw, k) => {
      const key = PHASE_COLS[col0 + k];
      if (key === 'name') ph.name = raw.trim();
      else if (key === 'addRise') ph.addRise = /^(1|y|yes|x|true|\u2713|\u2714)$/i.test(raw.trim());
      else if (key) ph[key] = cellNumber(raw);
    });
  });
  markCustomProfile();
  undoProfile = null;
  renderPhases();
  $(`#phases [data-i="${start}"][data-key="${el.dataset.key}"]`)?.focus();
  save();
  update();
});

// Enter in the solder-joint and hole tables: the same column on the next row; from the last row, a new row.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  const row = e.target.closest('#smt-devices tr[data-smt], #pcb-holes tr[data-hole]');
  if (!row) return;
  e.preventDefault();
  const next = row.nextElementSibling;
  if (next) ($(`[data-key="${e.target.dataset.key}"]`, next) ?? $('input, select', next))?.focus();
  else $(row.dataset.smt != null ? '[data-act="smt-add"]' : '[data-act="pcb-add"]').click();
});

// A "needs input" warning goes to the first missing control of that check.
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-goto]');
  if (!link) return;
  e.preventDefault();
  const panel = $(`#${link.dataset.goto}`);
  const target = panel.querySelector('.missing input, .missing select') ?? panel.querySelector('input, select');
  target?.scrollIntoView?.({ block: 'center' });
  target?.focus();
});

// <details> toggle does not bubble; listen in the capture phase.
document.addEventListener('toggle', (e) => {
  const el = e.target;
  if (el.tagName !== 'DETAILS' || !el.dataset.openKey) return;
  const part = findPart(el.dataset.id);
  if (!part) return;
  part[el.dataset.openKey] = el.open;
  save();
}, true);

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const part = btn.dataset.id ? findPart(btn.dataset.id) : null;
  // Set by an action whose button the redraw below replaces: where the focus goes next.
  let refocus = null;
  const replaceBoard = (next) => {
    if (state.parts.length && !confirm('Replace the current board? Export it first if you want to keep it.')) return;
    state = next;
    $('#import-report').hidden = true;
    resetStructureView();
    renderAll();
    save();
  };
  switch (act) {
    case 'new': replaceBoard(emptyBoard()); return;
    case 'example': replaceBoard(exampleBoard()); return;
    case 'import': reportOpener = btn; $('#import-file').click(); return;
    case 'import-netlist': reportOpener = btn; $('#netlist-file').click(); return;
    case 'import-bom': reportOpener = btn; $('#bom-file').click(); return;
    case 'goto-part': if (part) showPart(part); return;
    case 'attention': {
      $('#attention-only').checked = true;
      $('#parts').classList.add('attention-only');
      const first = $('#parts .part.needs-input, #parts .part.has-guesses');
      first?.scrollIntoView?.({ block: 'start' });
      $('[data-act="toggle"]', first ?? document)?.focus();
      return;
    }
    case 'review-ics':
      $('#ic-review').open = true;
      $('#ic-review').scrollIntoView?.({ block: 'start' });
      $('#ic-families select')?.focus();
      return;
    case 'import-board': reportOpener = btn; $('#board-file').click(); return;
    case 'dismiss-pcb-report':
      $('#pcb-report').hidden = true;
      $('[data-act="import-board"]').focus();
      return;
    case 'pcb-confirm': {
      // The guesses become the row's own values, with the reasons kept on record.
      const hole = state.pcb.holes[Number(btn.dataset.i)];
      hole.confirmed = { ...hole.confirmed, ...hole.inferred };
      hole.inferred = {};
      renderPcb();
      $(`#pcb-holes [data-hole="${btn.dataset.i}"] [data-act="pcb-del"]`)?.focus();
      break;
    }
    case 'ic-confirm': {
      const key = btn.dataset.icKey;
      for (const p of icGroupOf(key)?.parts ?? []) confirmIcFamily(p);
      refocus = () => focusIcRow(key, 'select');
      break;
    }
    case 'ic-confirm-all':
      for (const p of state.parts) if (p.model === 'ic') confirmIcFamily(p);
      refocus = () => $('#ic-families select')?.focus();
      break;
    case 'pcb-confirm-settings':
      state.pcb.confirmed = { ...state.pcb.confirmed, ...state.pcb.inferred };
      state.pcb.inferred = {};
      $('[data-act="pcb-add"]').focus();
      break;
    case 'pcb-add':
      state.pcb.holes.push({ label: '', drill: null, plating: null, inferred: {}, confirmed: {} });
      renderPcb();
      $(`#pcb-holes [data-hole="${state.pcb.holes.length - 1}"] input`)?.focus();
      break;
    case 'pcb-del': {
      // Focus stays in the table: the row now in that place, the last row, or Add.
      const i = Number(btn.dataset.i);
      state.pcb.holes.splice(i, 1);
      renderPcb();
      const dels = document.querySelectorAll('#pcb-holes [data-act="pcb-del"]');
      (dels[i] ?? dels[dels.length - 1] ?? $('[data-act="pcb-add"]')).focus();
      break;
    }
    case 'smt-add':
      state.smt.devices.push({ label: '', lead: null, body: null, d: null, h: null, rise: null, inferred: {} });
      renderSmt();
      $(`#smt-devices [data-smt="${state.smt.devices.length - 1}"] input`)?.focus();
      break;
    case 'smt-del': {
      const i = Number(btn.dataset.i);
      state.smt.devices.splice(i, 1);
      renderSmt();
      const dels = document.querySelectorAll('#smt-devices [data-act="smt-del"]');
      (dels[i] ?? dels[dels.length - 1] ?? $('[data-act="smt-add"]')).focus();
      break;
    }
    case 'smt-confirm': {
      // The guesses become the row's own values, with the reasons kept on record.
      const i = Number(btn.dataset.i);
      const dev = state.smt.devices[i];
      dev.confirmed = { ...dev.confirmed, ...dev.inferred };
      dev.inferred = {};
      $(`#smt-devices [data-smt="${i}"]`).outerHTML = smtRowHTML(dev, i);
      refocus = () => $(`#smt-devices [data-smt="${i}"] input`)?.focus();
      break;
    }
    case 'smt-chips': {
      // One row per chip size and kind; rows already there keep what the user entered.
      const found = chipCandidates(state.parts);
      let added = 0;
      for (const c of found) {
        const row = state.smt.devices.find((d) => d.auto === c.auto);
        if (!row) { state.smt.devices.push(c); added++; continue; }
        row.label = c.label;
        for (const k of Object.keys(c.inferred)) if (row.inferred?.[k]) { row[k] = c[k]; row.inferred[k] = c.inferred[k]; }
      }
      renderSmt();
      $('#smt-status').textContent = found.length
        ? `${plural(found.length, 'chip size')} found on the board${added ? `, ${added} added` : ', all already listed'}. Enter each solder joint height.`
        : 'No chip capacitors or resistors with a size code (such as 0603) in their footprint or description.';
      break;
    }
    case 'life-confirm': {
      // The guesses become the line's own values, with the reasons kept on record.
      const { values, inferred } = lifeInputs(part);
      part.life = { ...part.life, confirmed: { ...part.life?.confirmed, ...inferred } };
      for (const k of Object.keys(inferred)) part.life[k] = values[k];
      lifeShown = null;
      refocus = () => $(`#life-lines [data-life="${part.id}"] select, #life-lines [data-life="${part.id}"] input`)?.focus();
      break;
    }
    case 'life-del': {
      const i = [...document.querySelectorAll('#life-lines tr[data-life]')].indexOf(btn.closest('tr'));
      part.life = { ...part.life, listed: false };
      refocus = () => {
        const rows = document.querySelectorAll('#life-lines tr[data-life]');
        const row = rows[i] ?? rows[rows.length - 1];
        ((row && $('select, input', row)) ?? $('#life-add')).focus();
      };
      break;
    }
    case 'dismiss-report':
      $('#import-report').hidden = true;
      (reportOpener ?? $('[data-act="import-netlist"]')).focus();
      return;
    case 'export-json':
      download(`${fileBase()}.iec62380.json`, 'application/json', JSON.stringify(exportable(state), null, 2));
      changedSinceKept = false;
      return;
    case 'export-csv': download(`${fileBase()}.csv`, 'text/csv', boardCSV()); return;
    case 'export-xlsx': download(`${fileBase()}-FIT.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', boardWorkbook()); return;
    case 'add-phase':
      state.profile.phases.push({ name: `Phase ${state.profile.phases.length + 1}`, tac: 25, tau: 0, n: 0, dT: 0, addRise: false });
      markCustomProfile();
      renderPhases();
      $(`#phases [data-i="${state.profile.phases.length - 1}"][data-key="name"]`)?.select();
      $(`#phases [data-i="${state.profile.phases.length - 1}"][data-key="name"]`)?.focus();
      break;
    case 'del-phase': {
      const i = Number(btn.dataset.i);
      state.profile.phases.splice(i, 1);
      markCustomProfile();
      renderPhases();
      // Focus stays in the table: the remove button now in that place, or Add phase.
      const next = $(`#phases [data-act="del-phase"][data-i="${Math.min(i, state.profile.phases.length - 1)}"]`);
      (next && !next.disabled ? next : $('[data-act="add-phase"]')).focus();
      break;
    }
    case 'show-cell':
      $(`#phases [data-i="${btn.dataset.i}"][data-key="${btn.dataset.key}"]`)?.focus();
      return;
    case 'undo-profile':
      if (undoProfile) { state.profile = undoProfile; undoProfile = null; renderPhases(); }
      $('#preset').focus();
      break;
    case 'add-part': {
      const model = $('#add-model').value;
      const p = makePart(model, nextRef(model), 1, {}, { open: true });
      state.parts.push(p);
      forgetRemoved();
      renderParts();
      const ref = $(`#${p.id}-ref`);
      ref?.scrollIntoView({ block: 'nearest' });
      ref?.focus();
      break;
    }
    case 'toggle':
      // Opening or closing a card changes no figure: redraw that card only.
      part.open = !part.open;
      rerenderPart(part);
      repaintPart(part);
      $(`[data-act="toggle"][data-id="${part.id}"]`)?.focus();
      save();
      return;
    case 'confirm-guesses':
      part.confirmed = { ...part.confirmed, ...part.inferred };
      part.inferred = {};
      rerenderPart(part);
      $(`[data-act="toggle"][data-id="${part.id}"]`)?.focus();
      break;
    case 'split': {
      const singles = expandRefs(part.ref).map((ref) => ({ ...clone(part), id: newId(), ref, qty: 1, open: false }));
      state.parts.splice(state.parts.indexOf(part), 1, ...singles);
      forgetRemoved();
      renderParts();
      $(`[data-act="toggle"][data-id="${singles[0].id}"]`)?.focus();
      break;
    }
    case 'dup': {
      const copy = { ...clone(part), id: newId(), ref: `${part.ref} copy` };
      state.parts.splice(state.parts.indexOf(part) + 1, 0, copy);
      forgetRemoved();
      renderParts();
      $(`#${copy.id}-ref`)?.select();
      $(`#${copy.id}-ref`)?.focus();
      break;
    }
    case 'del': {
      // Removed at once, with Undo offered in its place.
      const i = state.parts.indexOf(part);
      state.parts.splice(i, 1);
      removedLine = { part, index: i };
      const model = MODELS[part.model];
      $('#parts-undo').innerHTML = `Removed <b>${esc(part.ref)}</b> (${esc(model.describe({ ...model.defaults, ...part.params }))}). <button type="button" data-act="undo-del">Undo</button>`;
      $('#parts-undo').hidden = false;
      renderParts();
      const near = state.parts[i] ?? state.parts[i - 1];
      (near ? $(`[data-act="toggle"][data-id="${near.id}"]`) : $('#add-model'))?.focus();
      break;
    }
    case 'undo-del': {
      if (!removedLine) return;
      const back = removedLine.part;
      state.parts.splice(Math.min(removedLine.index, state.parts.length), 0, back);
      forgetRemoved();
      renderParts();
      $(`[data-act="toggle"][data-id="${back.id}"]`)?.focus();
      break;
    }
    default: return;
  }
  save();
  update();
  refocus?.();
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { board, skipped } = sanitize(JSON.parse(await file.text()));
    if (state.parts.length && !confirm(`Replace the current board with “${board.title}”?`)) return;
    state = board;
    $('#import-report').hidden = true;
    resetStructureView();
    renderAll();
    save();
    if (skipped.length) alert(`Skipped ${skipped.length} part(s) of unknown type: ${[...new Set(skipped)].join(', ')}`);
  } catch (err) {
    alert(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
  }
});

// Reads and parses an imported file with a progress window: in a worker when the browser can start one,
// so a large file does not freeze the page, otherwise here. Resolves to the parsed result, or null if
// cancelled.
function importWithProgress(kind, file, title) {
  const stages = kind === 'board'
    ? { read: `Reading ${file.name}…`, parse: 'Reading the holes and the stackup…' }
    : { read: `Reading ${file.name}…`, parse: 'Reading the parts and nets…', sort: 'Sorting the parts into lines…' };
  const progress = openProgress({ title, text: stages.read });
  const here = async () => {
    const text = decodeText(await readBytes(file, (f) => progress.set(f * READ_SHARE, stages.read)));
    const rest = (f, stage) => progress.set(READ_SHARE + (1 - READ_SHARE) * f, stages[stage]);
    return kind === 'board' ? parseBoardFile(text, file.name, (f) => rest(f, 'parse')) : netlistToParts(text, rest);
  };
  return new Promise((resolve, reject) => {
    const finish = (fn, value) => { progress.close(); fn(value); };
    // Cancel settles the import as nothing; a parse still running here finishes unheard.
    progress.onCancel = () => resolve(null);
    let worker = null;
    try {
      worker = typeof Worker === 'function' ? new Worker(new URL('./importworker.js', import.meta.url), { type: 'module' }) : null;
    } catch {
      worker = null;
    }
    if (!worker) {
      here().then((r) => finish(resolve, r), (err) => finish(reject, err));
      return;
    }
    let heard = false;
    progress.onCancel = () => { worker.terminate(); resolve(null); };
    worker.onmessage = ({ data }) => {
      heard = true;
      if (data.type === 'progress') progress.set(data.fraction, stages[data.stage]);
      else { worker.terminate(); if (data.type === 'done') finish(resolve, data.result); else finish(reject, new Error(data.message)); }
    };
    // A browser without module workers fails before the worker says anything: parse here instead.
    worker.onerror = (e) => {
      worker.terminate();
      if (heard) finish(reject, new Error(e.message || 'the file could not be read'));
      else here().then((r) => finish(resolve, r), (err) => finish(reject, err));
    };
    worker.postMessage({ kind, file });
  });
}

// Fills the Circuit board check from a board file: one row per plated, round, through-hole size, the
// board thickness and the laminate, all Guessed with where they came from. Values typed in are kept.
function applyBoardFile(r, fileName) {
  const s = state.pcb;
  s.inferred ??= {};
  const mm = (x) => String(+x.toFixed(3));
  const count = (n, one) => `${n.toLocaleString('en')} ${n === 1 ? one : `${one}s`}`;
  const bySize = new Map();
  for (const h of r.holes.filter((x) => x.plated !== false && x.through && x.shape === 'round')) {
    const row = bySize.get(h.size) ?? { size: h.size, vias: 0, holes: 0 };
    if (h.kind === 'via') row.vias += h.count; else row.holes += h.count;
    bySize.set(h.size, row);
  }
  const rows = [...bySize.values()].sort((a, b) => a.size - b.size);
  if (rows.length && s.holes.length && !confirm(`Replace the ${plural(s.holes.length, 'hole size')} in the Circuit board check with the ${rows.length} from “${fileName}”? The other settings are kept.`)) return;
  if (rows.length) {
    s.holes = rows.map((x) => ({
      label: `${mm(x.size)} mm: ${[x.vias && count(x.vias, 'via'), x.holes && count(x.holes, 'hole')].filter(Boolean).join(', ')}`,
      drill: x.size,
      plating: null,
      inferred: { drill: `the finished hole size in ${fileName}; the drilled hole is larger by twice the plating` },
      confirmed: {},
    }));
  }
  const kept = [];
  if (r.thickness) {
    const why = r.thickness.from === 'stated' ? `stated in ${fileName}` : `the sum of the ${r.thickness.detail} of ${fileName}`;
    if (s.thickness == null || s.inferred.thickness) { s.thickness = r.thickness.mm; s.inferred.thickness = why; }
    else if (Math.abs(s.thickness - r.thickness.mm) > 1e-9) kept.push(`your board thickness, ${fmt(s.thickness)} mm (the file gives ${mm(r.thickness.mm)} mm)`);
  }
  const lam = laminateFor(r.materials);
  if (lam) {
    const why = `the dielectric ${r.materials.map((m) => `“${m}”`).join(', ')} in ${fileName}${lam === 'fr4' ? ', taken as standard FR-4' : ''}`;
    if (!s.laminate || s.inferred.laminate) { s.laminate = lam; s.inferred.laminate = why; }
    else if (s.laminate !== lam) kept.push('your laminate');
  }
  const sum = (pick) => r.holes.filter(pick).reduce((n, h) => n + h.count, 0);
  const left = [
    [sum((h) => h.plated === false), 'unplated hole', 'no barrel to crack'],
    [sum((h) => h.plated !== false && !h.through), 'blind or buried via', 'the model is for through holes'],
    [sum((h) => h.plated !== false && h.through && h.shape === 'slot'), 'plated slot', 'the model is for round holes'],
  ].filter(([n]) => n).map(([n, what, why]) => `${count(n, what)} (${why})`);
  const facts = [r.copperLayers && `${r.copperLayers} copper layers`, r.thickness && `${mm(r.thickness.mm)} mm`, r.materials.length && r.materials.join(', ')].filter(Boolean);
  renderPcb();
  update();
  save();
  const box = $('#pcb-report');
  box.innerHTML = `<p>Read “${esc(fileName)}” (${esc(r.format)}${facts.length ? `, ${esc(facts.join(', '))}` : ''}). ${rows.length
    ? `${plural(rows.length, 'plated hole size')} added: ${esc(s.holes.map((h) => h.label).join('; '))}.`
    : 'No plated through holes were found, so the hole sizes are unchanged.'}
    ${left.length ? `Left out: ${esc(left.join('; '))}.` : ''}
    ${r.thickness ? '' : 'The file has no layer stackup: enter the board thickness and laminate.'}
    ${kept.length ? `Kept ${esc(kept.join(' and '))}.` : ''}
    ${r.notes.length ? esc(r.notes.join(' ')) : ''}
    The file gives finished hole sizes, entered as the drill: the drilled hole is larger by twice the plating. Enter the plating thickness, which board files do not hold.</p>
    <p class="report-actions"><button type="button" data-act="dismiss-pcb-report">Dismiss</button></p>`;
  box.hidden = false;
  box.focus();
}

$('#board-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  let result;
  try {
    result = await importWithProgress('board', file, 'Import board file');
  } catch (err) {
    alert(`Could not read “${file.name}”: ${err.message}`);
    return;
  }
  if (result) applyBoardFile(result, file.name);
});

$('#netlist-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  let result;
  try {
    result = await importWithProgress('netlist', file, 'Import netlist');
  } catch (err) {
    alert(`Could not read “${file.name}”: ${err.message}`);
    return;
  }
  if (!result) return;
  if (state.parts.length && !confirm(`Replace the current parts with the ${result.lines.length} lines from “${file.name}”? The mission profile is kept.`)) return;
  state.parts = result.lines.map((l) => makePart(l.model, l.ref, l.qty, l.params, { inferred: { ...l.inferred }, source: l.source }));
  state.structure = {
    kind: 'block', id: ROOT,
    children: result.groups.map((g) => ({
      kind: 'block', name: `${g.refs} in parallel`, mode: 'series', proposed: g.proposed, nets: g.nets,
      // Parallel strings: one series block per string.
      children: g.strings ? g.strings.map((refs) => ({ kind: 'block', name: `${refs} in series`, mode: 'series', children: [{ kind: 'leaf', refs }] })) : [{ kind: 'leaf', refs: g.refs }],
    })),
  };
  if (['Untitled board', 'Example board', ''].includes(state.title)) state.title = file.name.replace(/\.[^.]+$/, '');
  resetStructureView();
  renderAll();
  save();
  const board = computeBoard({ profile: state.profile, components: state.parts });
  const guessed = state.parts.filter((p) => guessCount(p)).length;
  // One module drawn as several symbols (CM5's Module301 and Module302) would be rated twice.
  const moduleLines = new Map();
  for (const l of result.lines.filter((x) => x.model === 'vendor' && x.source?.value)) moduleLines.set(l.source.value, [...(moduleLines.get(l.source.value) ?? []), l.ref]);
  const splitModules = [...moduleLines].filter(([, refs]) => refs.length > 1).map(([value, refs]) => `${refs.join(', ')} (${value})`);
  showReport(`Read ${plural(result.components, 'component')} from “${esc(file.name)}” (${esc(result.format)}, ${plural(result.nets, 'net')}) into ${plural(result.lines.length, 'line')}.
    ${result.skippedCount ? `Skipped ${plural(result.skippedCount, 'part')} with no failure rate to count, such as holes, test points and solder jumpers (${esc(result.skipped)}).` : ''}
    ${result.notFittedCount ? `Left out ${plural(result.notFittedCount, 'part')} marked do not populate (${esc(result.notFitted)}).` : ''}
    ${splitModules.length ? `Modules with the same value on several lines: ${esc(splitModules.join('; '))}. If one module is drawn as several symbols, enter its MTBF on one line and remove the others.` : ''}
    ${result.duplicatesCount ? `<strong>${plural(result.duplicatesCount, 'designator is', 'designators are')} used more than once</strong> (${esc(result.duplicates)}): those parts are counted but not proposed in blocks, since their connections cannot be told apart. Annotate the schematic again to fix it.` : ''}
    <strong>${plural(board.incomplete, 'line needs', 'lines need')} input</strong> (red, “Missing”) and ${plural(guessed, 'line has', 'lines have')} guessed values (amber, “Guessed”).
    ${result.groups.length ? `Proposed ${plural(result.groups.length, 'block')} of parts wired in parallel under Reliability structure; they count in series until you mark them redundant.` : ''}`);
});

// A BOM: on an empty board it builds the parts; otherwise it adds part numbers,
// manufacturers and descriptions to the lines with the same designators.
$('#bom-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  let text;
  let bom;
  try {
    text = await readText(file);
    bom = parseBom(text);
  } catch (err) {
    alert(`Could not read “${file.name}”: ${err.message}`);
    return;
  }
  const columns = Object.values(bom.columns).map((c) => `“${esc(c)}”`).join(', ');
  const notes = [
    bom.notFitted.length ? `Left out ${plural(bom.notFitted.length, 'part')} marked not fitted (${esc(compressRefs(bom.notFitted))}).` : '',
    bom.quantityMismatch.length ? `The quantity column disagrees with the designators on ${plural(bom.quantityMismatch.length, 'row')} (${esc(bom.quantityMismatch.join('; '))}); the designators were used.` : '',
  ].join(' ');
  if (!state.parts.length) {
    const result = bomToParts(text);
    state.parts = result.lines.map((l) => makePart(l.model, l.ref, l.qty, l.params, { inferred: { ...l.inferred }, source: l.source }));
    state.structure = { kind: 'block', id: ROOT, children: [] };
    if (['Untitled board', 'Example board', ''].includes(state.title)) state.title = file.name.replace(/\.[^.]+$/, '');
    resetStructureView();
    renderAll();
    save();
    const board = computeBoard({ profile: state.profile, components: state.parts });
    const guessed = state.parts.filter((p) => guessCount(p)).length;
    showReport(`Read ${plural(bom.items.length, 'row')} from “${esc(file.name)}” (columns ${columns}) into ${plural(result.lines.length, 'line')} for ${plural(result.parts, 'part')}.
      ${result.skippedCount ? `Skipped ${plural(result.skippedCount, 'part')} with no failure rate to count, such as holes, test points and solder jumpers (${esc(result.skipped)}).` : ''} ${notes}
      <strong>${plural(board.incomplete, 'line needs', 'lines need')} input</strong> (red, “Missing”) and ${plural(guessed, 'line has', 'lines have')} guessed values (amber, “Guessed”).
      A BOM has no connections, so no parallel blocks are proposed; import the netlist too for those.`);
    return;
  }
  const { parts, report } = mergeBom(state.parts, bom, (m) => MODELS[m]?.defaults, newId);
  state.parts = parts;
  renderAll();
  save();
  showReport(`Matched ${plural(report.matched, 'line')} to “${esc(file.name)}” (columns ${columns}) and added part numbers and descriptions.
    ${report.retyped ? `${plural(report.retyped, 'line was', 'lines were')} given a better part type from the BOM.` : ''}
    ${report.improved ? `${plural(report.improved, 'line has', 'lines have')} better guesses.` : ''}
    ${report.split ? `Split ${plural(report.split, 'line')} whose parts have different BOM rows.` : ''}
    ${report.kept ? `${plural(report.kept, 'line', 'lines')} you had edited kept ${report.kept > 1 ? 'their' : 'its'} part type, though the BOM suggests another.` : ''}
    ${report.unmatchedCount ? `Not on the board: ${esc(report.unmatched)}.` : ''}
    ${report.notInBomCount ? `Not in the BOM: ${esc(report.notInBom)}.` : ''} ${notes}`);
});

mountStructure($('#structure'), {
  getSaved: () => state.structure,
  commit: (saved) => { state.structure = saved; save(); update(); },
  describe: (comp) => {
    const model = MODELS[comp.model];
    return model.describe({ ...model.defaults, ...comp.params });
  },
  modelOf: (comp) => ({ model: comp.model, params: { ...MODELS[comp.model].defaults, ...comp.params } }),
  openPart: (id) => {
    const part = findPart(id);
    if (part) showPart(part);
  },
});
renderAll();
showRemember();
initTooltips();
