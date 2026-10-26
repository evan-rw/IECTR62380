import {
  MODELS, PENDING_FAMILIES, computeBoard, profileProblems, mtbfHours, reliability, byId, fieldLabel,
} from './models.js';
import { MISSION_PROFILES, ALL_TABLES, SOURCES, STATUS } from './tables.js';
import { netlistToParts } from './netlist.js';

const STORAGE_KEY = 'iec62380.board.v1';
const FORMAT = 'iec62380-board';
const REF_PREFIX = { ic: 'U', diode: 'D', transistor: 'Q', capacitor: 'C', resistor: 'R', inductor: 'L', fixed: 'X' };

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (x) => JSON.parse(JSON.stringify(x));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (s) => (s === '' || s == null || !Number.isFinite(Number(s)) ? null : Number(s));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

let seq = 0;
const newId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

const nf = new Intl.NumberFormat('en', { maximumSignificantDigits: 3 });
function fmt(x) {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  if (Math.abs(x) < 0.001) return x.toExponential(2);
  return nf.format(x);
}

// ---------------------------------------------------------------------------
// Board state. A part is { id, ref, qty, model, params, inferred, source, open }:
// `inferred` maps a parameter to the reason it was guessed (cleared when the
// user edits or confirms it); `source` keeps what the netlist said.

function makePart(model, ref, qty = 1, params = {}, extra = {}) {
  return { id: newId(), ref, qty, model, params: { ...clone(MODELS[model].defaults), ...params }, inferred: {}, source: null, open: false, ...extra };
}

function presetProfile(id) {
  const row = byId(MISSION_PROFILES, id);
  return { preset: row.id, phases: clone(row.phases), tauOff: null };
}

function emptyBoard() {
  return { format: FORMAT, version: 1, title: 'Untitled board', years: 10, profile: presetProfile('geo-permanent'), parts: [] };
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
    for (const key of Object.keys(params)) {
      const v = p.params?.[key];
      if (v === null || typeof v === 'number' || typeof v === 'string') params[key] = v;
      if (typeof p.inferred?.[key] === 'string') inferred[key] = p.inferred[key];
    }
    const source = p.source && typeof p.source === 'object'
      ? { value: str(p.source.value), footprint: str(p.source.footprint), description: str(p.source.description) }
      : null;
    parts.push({ id: newId(), ref: str(p.ref), qty: isNum(p.qty) ? p.qty : 1, model: p.model, params, inferred, source, open: Boolean(p.open), advOpen: Boolean(p.advOpen), traceOpen: Boolean(p.traceOpen) });
  }
  const phases = raw.profile.phases.map((ph) => ({
    name: str(ph?.name),
    tac: isNum(ph?.tac) ? ph.tac : 25,
    tau: isNum(ph?.tau) ? ph.tau : 0,
    n: isNum(ph?.n) ? ph.n : 0,
    dT: isNum(ph?.dT) ? ph.dT : 0,
    addRise: Boolean(ph?.addRise),
  }));
  const preset = MISSION_PROFILES.rows.some((r) => r.id === raw.profile.preset) ? raw.profile.preset : null;
  return {
    board: {
      format: FORMAT, version: 1,
      title: str(raw.title) || 'Untitled board',
      years: isNum(raw.years) ? raw.years : 10,
      profile: { preset, phases, tauOff: isNum(raw.profile.tauOff) ? raw.profile.tauOff : null },
      parts,
    },
    skipped,
  };
}

function exportable(board) {
  return {
    format: FORMAT, version: 1, title: board.title, years: board.years,
    profile: board.profile,
    parts: board.parts.map(({ ref, qty, model, params, inferred, source }) => ({
      ref, qty, model, params,
      ...(Object.keys(inferred ?? {}).length ? { inferred } : {}),
      ...(source ? { source } : {}),
    })),
  };
}

function load() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? sanitize(JSON.parse(s)).board : null;
  } catch {
    return null;
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode or storage blocked */ }
  }, 250);
}

let state = load() ?? exampleBoard();
const findPart = (id) => state.parts.find((p) => p.id === id);
const guessCount = (part) => Object.keys(part.inferred ?? {}).length;

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
  const guessHTML = guess ? `<p class="guess" data-guess-for="${f.key}">Guessed ${esc(guess)}.</p>` : '';
  return `<div class="field${f.wide ? ' wide' : ''}" data-field="${f.key}"><label for="${id}">${esc(label)}${unit}<span class="state-tag"></span></label>${control}${guessHTML}${helpHTML}</div>`;
}

function sourceHTML(source) {
  if (!source) return '';
  const bits = [['Value', source.value], ['Footprint', source.footprint], ['Description', source.description]]
    .filter(([, v]) => v).map(([k, v]) => `${k}: <b>${esc(v)}</b>`);
  return bits.length ? `<p class="source-line">From the netlist. ${bits.join(' · ')}</p>` : '';
}

function partHTML(part) {
  const model = MODELS[part.model];
  const p = { ...model.defaults, ...part.params };
  const main = model.fields.filter((f) => !f.advanced).map((f) => fieldHTML(part, f, p)).join('');
  const adv = model.fields.filter((f) => f.advanced).map((f) => fieldHTML(part, f, p)).join('');
  return `
    <article class="part" data-part="${part.id}">
      <div class="part-head">
        <div class="ref"><label class="visually-hidden" for="${part.id}-ref">Reference</label>
          <input id="${part.id}-ref" type="text" value="${esc(part.ref)}" data-bind="part" data-id="${part.id}" data-key="ref" autocomplete="off"></div>
        <div class="part-kind"><div class="model">${esc(model.label)} <span class="flags" data-out="flags"></span></div><div class="desc" data-out="desc"></div></div>
        <div class="qty"><label class="visually-hidden" for="${part.id}-qty">Quantity</label>
          <input id="${part.id}-qty" type="number" min="0" step="1" inputmode="numeric" value="${esc(part.qty)}" data-bind="part" data-id="${part.id}" data-key="qty" title="Quantity"></div>
        <div class="part-fit" data-out="fit"></div>
        <div class="part-actions">
          <button type="button" class="icon" data-act="toggle" data-id="${part.id}" aria-expanded="${part.open}" aria-controls="${part.id}-body">${part.open ? 'Close' : 'Edit'}</button>
          <button type="button" class="icon" data-act="dup" data-id="${part.id}" title="Duplicate">Copy</button>
          <button type="button" class="icon" data-act="del" data-id="${part.id}" title="Remove">✕</button>
        </div>
      </div>
      <div class="part-body" id="${part.id}-body"${part.open ? '' : ' hidden'}>
        ${sourceHTML(part.source)}
        <div class="fields">${main}</div>
        ${guessCount(part) ? `<p class="guess-bar">Amber fields were guessed from the netlist. <button type="button" data-act="confirm-guesses" data-id="${part.id}">Confirm guesses</button></p>` : ''}
        ${adv ? `<details class="advanced" data-id="${part.id}" data-open-key="advOpen"${part.advOpen ? ' open' : ''}><summary>Override table values</summary><div class="fields">${adv}</div></details>` : ''}
        <ul class="part-errors" data-out="errors"></ul>
        <details class="trace" data-id="${part.id}" data-open-key="traceOpen"${part.traceOpen ? ' open' : ''}><summary>Show the calculation</summary><div class="trace-body" data-out="trace"></div></details>
        <p class="status-line">Clause ${esc(model.clause)}. ${esc(model.status)}</p>
      </div>
    </article>`;
}

function traceHTML(r, phases) {
  if (!r.complete) return '<p class="help">Fill in the missing values to see the calculation.</p>';
  const breakdown = r.parts.map(([label, v]) => `<span>${esc(label)}: ${fmt(v)} FIT</span>`).join('');
  const values = r.values.length
    ? `<dl class="values">${r.values.map(([k, v, note]) => `<dt>${esc(k)}</dt><dd>${esc(v)}${note ? `<span class="note">${esc(note)}</span>` : ''}</dd>`).join('')}</dl>`
    : '';
  const name = (i) => esc(phases[i]?.name || `Phase ${i + 1}`);
  const op = r.operating.length
    ? `<div class="table-scroll"><table class="trace-table"><caption>Working phases</caption><thead><tr><th>Phase</th><th class="num">${esc(r.tempLabel)} °C</th><th class="num">π_t</th><th class="num">τ</th></tr></thead><tbody>${
      r.operating.map((o) => `<tr><td>${name(o.phase)}</td><td class="num">${fmt(o.t)}</td><td class="num">${fmt(o.piT)}</td><td class="num">${fmt(o.tau)}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  const cyc = r.cycling.length
    ? `<div class="table-scroll"><table class="trace-table"><caption>Thermal cycles</caption><thead><tr><th>Phase</th><th class="num">n</th><th class="num">π_n</th><th class="num">ΔT °C</th><th class="num">π_n·ΔT^0.68</th></tr></thead><tbody>${
      r.cycling.map((c) => `<tr><td>${name(c.phase)}</td><td class="num">${fmt(c.n)}</td><td class="num">${fmt(c.piN)}</td><td class="num">${fmt(c.dT)}</td><td class="num">${fmt(c.term)}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  return `<div class="breakdown">${breakdown}</div>${values}${op}${cyc}`;
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
    const num = (key, label, attrs = '') => `<td><input type="number" step="any" inputmode="decimal" ${attrs} aria-label="${label}, phase ${i + 1}" value="${esc(ph[key] ?? '')}" ${d(key)}></td>`;
    return `<tr>
      <td><input type="text" aria-label="Phase ${i + 1} name" value="${esc(ph.name)}" ${d('name')}></td>
      ${num('tac', 't_ac')}${num('tau', 'τ', 'min="0" max="1"')}${num('n', 'n', 'min="0"')}${num('dT', 'ΔT', 'min="0"')}
      <td class="check"><input type="checkbox" aria-label="Add a third of the part's temperature rise, phase ${i + 1}"${ph.addRise ? ' checked' : ''} ${d('addRise')}></td>
      <td><button type="button" class="icon" data-act="del-phase" data-i="${i}" title="Remove phase"${state.profile.phases.length < 2 ? ' disabled' : ''}>✕</button></td>
    </tr>`;
  }).join('');
  $('#tau-off').value = state.profile.tauOff ?? '';
  $('#preset').value = state.profile.preset ?? '';
}

function renderAddModel() {
  $('#add-model').innerHTML = optionsHTML(Object.entries(MODELS).map(([id, m]) => ({ value: id, label: m.label })), 'ic');
}

function renderParts() {
  $('#parts').innerHTML = state.parts.length
    ? state.parts.map(partHTML).join('')
    : '<p class="empty">No parts yet. Import a netlist, or choose a part type and add it.</p>';
}

function rerenderPart(part, focusKey) {
  const el = $(`[data-part="${part.id}"]`);
  if (!el) return;
  el.outerHTML = partHTML(part);
  if (focusKey) $(`[data-id="${part.id}"][data-key="${focusKey}"]`)?.focus();
}

function renderSources() {
  const link = (key) => {
    const s = SOURCES[key];
    return s.url ? `<a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a>` : esc(s.label);
  };
  const rows = ALL_TABLES.map((t) => `<tr>
      <td>${esc(t.title)}<br><span class="unit">${esc(t.ref)}</span></td>
      <td><span class="badge ${t.status === 'single' ? 'no' : 'ok'}">${esc(STATUS[t.status])}</span></td>
      <td>${t.sources.map(link).join('<br>')}${t.note ? `<p class="help">${esc(t.note)}</p>` : ''}</td>
    </tr>`).join('');
  const models = Object.values(MODELS).map((m) => `<li><strong>${esc(m.label)}</strong> (clause ${esc(m.clause)}): ${esc(m.status)}</li>`).join('');
  const pending = PENDING_FAMILIES.map((f) => `<li>${esc(f)}</li>`).join('');
  $('#source-list').innerHTML = `
    <p class="hint">The values are inferred from public sources, not copied from the standard. Each table says how many independent sources agree on it. The mission profiles come from the publisher's free preview of the standard.</p>
    <div class="table-scroll"><table class="source-table"><thead><tr><th>Table</th><th>Status</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h3>Models</h3><ul>${models}</ul>
    <h3>Not modelled yet</h3>
    <p class="hint">Add these as “Other part (failure rate entered)” with a rate from a datasheet or a vendor reliability report.</p>
    <ul>${pending}</ul>`;
}

function renderAll() {
  renderBoardBar();
  renderPresets();
  renderPhases();
  renderAddModel();
  renderParts();
  renderSources();
  update();
}

// Recompute everything and refresh outputs without touching the inputs.
function update() {
  const board = computeBoard({ profile: state.profile, components: state.parts });
  const problems = profileProblems(state.profile);

  $('#tau-summary').innerHTML = `τ<sub>on</sub> = <b>${fmt(board.prof.tauOn)}</b>, τ<sub>off</sub> = <b>${fmt(board.prof.tauOff)}</b>${state.profile.tauOff == null ? ' (1 − τ<sub>on</sub>)' : ''}`;
  $('#profile-problems').innerHTML = problems.map((p) => `<li>${esc(p)}</li>`).join('');

  let guessedLines = 0;
  board.items.forEach(({ comp, result }) => {
    const el = $(`[data-part="${comp.id}"]`);
    if (!el) return;
    const model = MODELS[comp.model];
    const p = { ...model.defaults, ...comp.params };
    const guesses = guessCount(comp);
    if (guesses) guessedLines++;
    el.classList.toggle('needs-input', !result.complete);
    el.classList.toggle('has-guesses', guesses > 0);
    $('[data-out="desc"]', el).textContent = model.describe(p);
    $('[data-out="flags"]', el).innerHTML = [
      result.missing.length ? `<span class="flag missing">${result.missing.length} missing</span>` : '',
      !result.missing.length && !result.complete ? '<span class="flag missing">check input</span>' : '',
      guesses ? `<span class="flag guessed">${guesses} guessed</span>` : '',
    ].join('');
    $('[data-out="fit"]', el).innerHTML = !result.complete
      ? '<span class="bad">Needs input</span>'
      : `<div class="each">${fmt(result.fit)} FIT</div>${result.qty !== 1 ? `<div class="total">× ${fmt(result.qty)} = ${fmt(result.total)} FIT</div>` : ''}`;
    $('[data-out="errors"]', el).innerHTML = result.errors.map((e) => `<li>${esc(e)}</li>`).join('');
    $('[data-out="trace"]', el).innerHTML = traceHTML(result, board.prof.phases);
    for (const wrap of el.querySelectorAll('[data-field]')) {
      const key = wrap.dataset.field;
      const missing = result.missing.includes(key);
      const guessed = Boolean(comp.inferred?.[key]);
      wrap.classList.toggle('missing', missing);
      wrap.classList.toggle('inferred', guessed && !missing);
      wrap.querySelector('.state-tag').textContent = missing ? 'Missing' : guessed ? 'Guessed' : '';
      wrap.querySelector('input, select')?.setAttribute('aria-invalid', String(missing));
      const note = wrap.querySelector('[data-guess-for]');
      if (note) note.hidden = !guessed;
    }
    for (const f of model.fields) {
      if (typeof f.help !== 'function') continue;
      const h = $(`[data-help-key="${f.key}"]`, el);
      if (h) h.textContent = f.help(p);
    }
  });

  const total = board.total;
  const years = isNum(state.years) ? state.years : 0;
  const R = reliability(total, years);
  const mtbf = mtbfHours(total);
  const pieces = board.items.reduce((s, it) => s + it.result.qty, 0);
  const warn = [];
  if (problems.length) warn.push('The mission profile has problems (see above).');
  if (board.incomplete) warn.push(`${plural(board.incomplete, 'part line needs', 'part lines need')} more input; the total leaves ${board.incomplete > 1 ? 'them' : 'it'} out.`);
  if (guessedLines) warn.push(`${plural(guessedLines, 'line uses', 'lines use')} guessed values; check and confirm them.`);
  $('#summary').innerHTML = `<div class="tiles">
    <div class="tile"><div class="label">Board failure rate</div><div class="value">${fmt(total)} FIT</div><div class="sub">${fmt(pieces)} pieces in ${state.parts.length} lines</div></div>
    <div class="tile"><div class="label">MTBF</div><div class="value">${Number.isFinite(mtbf) ? `${fmt(mtbf)} h` : '—'}</div><div class="sub">${Number.isFinite(mtbf) ? `${fmt(mtbf / 8760)} years` : 'no failure rate yet'}</div></div>
    <div class="tile"><div class="label">Survival over ${fmt(years)} years</div><div class="value">${(R * 100).toFixed(R > 0.999 ? 3 : 1)}%</div><div class="sub">${fmt(1000 * (1 - R))} failures per 1000 boards</div></div>
    </div>${warn.length ? `<p class="warn">${warn.map(esc).join(' ')}</p>` : ''}`;

  const sorted = [...board.items].sort((a, b) => b.result.total - a.result.total || Number(a.result.complete) - Number(b.result.complete));
  $('#results').innerHTML = sorted.length
    ? sorted.map(({ comp, result }) => {
      const model = MODELS[comp.model];
      const share = total > 0 ? (100 * result.total) / total : 0;
      const each = result.complete ? fmt(result.fit) : '<span class="bad">Missing</span>';
      return `<tr><td>${esc(comp.ref)}</td><td class="opt">${esc(model.describe({ ...model.defaults, ...comp.params }))}</td><td class="num">${fmt(result.qty)}</td><td class="num opt">${each}</td><td class="num">${result.complete ? fmt(result.total) : '—'}</td><td class="num">${result.complete ? `${share.toFixed(1)}%` : '—'}</td></tr>`;
    }).join('') + `<tr><td><strong>Board</strong></td><td class="opt"></td><td></td><td class="opt"></td><td class="num"><strong>${fmt(total)}</strong></td><td class="num">100%</td></tr>`
    : '<tr><td colspan="6">No parts yet.</td></tr>';
}

// ---------------------------------------------------------------------------
// Files

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

function boardCSV() {
  const board = computeBoard({ profile: state.profile, components: state.parts });
  const rows = [['Ref', 'Part type', 'Description', 'Qty', 'Lambda each (FIT)', 'Lambda total (FIT)', 'Share (%)', 'Breakdown (FIT)', 'Problems', 'Guessed values']];
  for (const { comp, result } of board.items) {
    const model = MODELS[comp.model];
    const p = { ...model.defaults, ...comp.params };
    const guessed = Object.keys(comp.inferred ?? {}).map((k) => fieldLabel(model.fields.find((f) => f.key === k) ?? { label: k }, p));
    rows.push([
      comp.ref, model.label, model.describe(p), result.qty,
      result.complete ? result.fit : '', result.complete ? result.total : '',
      result.complete && board.total > 0 ? ((100 * result.total) / board.total).toFixed(2) : '',
      result.complete ? result.parts.map(([k, v]) => `${k} ${+v.toPrecision(4)}`).join('; ') : '',
      result.errors.join(' '), guessed.join('; '),
    ]);
  }
  rows.push(['Board', '', '', '', '', board.total, '100', '', board.incomplete ? `${board.incomplete} lines left out` : '', '']);
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// Netlists are usually plain ASCII, but values such as "10µF" may be in a
// Windows code page rather than UTF-8.
async function readText(file) {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function showReport(html) {
  const box = $('#import-report');
  box.innerHTML = `${html} <button type="button" class="link" data-act="dismiss-report">Dismiss</button>`;
  box.hidden = false;
}

// ---------------------------------------------------------------------------
// Events

function markCustomProfile() {
  state.profile.preset = null;
  $('#preset').value = '';
}

function nextRef(model) {
  const prefix = REF_PREFIX[model];
  const re = new RegExp(`(?:^|[^A-Za-z])${prefix}(\\d+)`, 'g');
  let max = 0;
  for (const p of state.parts) for (const m of p.ref.matchAll(re)) max = Math.max(max, Number(m[1]));
  return `${prefix}${max + 1}`;
}

function clearGuess(part, key) {
  if (part.inferred?.[key]) delete part.inferred[key];
}

document.addEventListener('input', (e) => {
  const el = e.target;
  const bind = el.dataset?.bind;
  if (!bind || el.tagName === 'SELECT' || el.type === 'checkbox') return;
  if (bind === 'title') state.title = el.value;
  else if (bind === 'years') state.years = numOrNull(el.value);
  else if (bind === 'tauOff') state.profile.tauOff = numOrNull(el.value);
  else if (bind === 'phase') {
    const ph = state.profile.phases[Number(el.dataset.i)];
    ph[el.dataset.key] = el.dataset.key === 'name' ? el.value : numOrNull(el.value);
    if (el.dataset.key !== 'name') markCustomProfile();
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
  if (!bind) return;
  if (bind === 'preset') {
    if (!el.value) return;
    state.profile = presetProfile(el.value);
    renderPhases();
  } else if (bind === 'phase' && el.type === 'checkbox') {
    state.profile.phases[Number(el.dataset.i)].addRise = el.checked;
    markCustomProfile();
  } else if (bind === 'part' && el.tagName === 'SELECT') {
    const part = findPart(el.dataset.id);
    part.params[el.dataset.key] = el.value || null;
    clearGuess(part, el.dataset.key);
    rerenderPart(part, el.dataset.key);
  } else {
    return;
  }
  save();
  update();
});

// <details> toggle does not bubble; listen in the capture phase.
document.addEventListener('toggle', (e) => {
  const el = e.target;
  if (el.tagName !== 'DETAILS' || !el.dataset.openKey) return;
  const part = findPart(el.dataset.id);
  if (part) { part[el.dataset.openKey] = el.open; save(); }
}, true);

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const part = btn.dataset.id ? findPart(btn.dataset.id) : null;
  const replaceBoard = (next) => {
    if (state.parts.length && !confirm('Replace the current board? Export it first if you want to keep it.')) return;
    state = next;
    $('#import-report').hidden = true;
    renderAll();
    save();
  };
  switch (act) {
    case 'new': replaceBoard(emptyBoard()); return;
    case 'example': replaceBoard(exampleBoard()); return;
    case 'import': $('#import-file').click(); return;
    case 'import-netlist': $('#netlist-file').click(); return;
    case 'dismiss-report': $('#import-report').hidden = true; return;
    case 'export-json': download(`${fileBase()}.iec62380.json`, 'application/json', JSON.stringify(exportable(state), null, 2)); return;
    case 'export-csv': download(`${fileBase()}.csv`, 'text/csv', boardCSV()); return;
    case 'add-phase':
      state.profile.phases.push({ name: `Phase ${state.profile.phases.length + 1}`, tac: 25, tau: 0, n: 0, dT: 0, addRise: false });
      markCustomProfile();
      renderPhases();
      break;
    case 'del-phase':
      state.profile.phases.splice(Number(btn.dataset.i), 1);
      markCustomProfile();
      renderPhases();
      break;
    case 'add-part': {
      const model = $('#add-model').value;
      const p = makePart(model, nextRef(model), 1, {}, { open: true });
      state.parts.push(p);
      renderParts();
      const ref = $(`#${p.id}-ref`);
      ref?.scrollIntoView({ block: 'nearest' });
      ref?.focus();
      break;
    }
    case 'toggle':
      part.open = !part.open;
      rerenderPart(part);
      $(`[data-act="toggle"][data-id="${part.id}"]`)?.focus();
      break;
    case 'confirm-guesses':
      part.inferred = {};
      rerenderPart(part);
      break;
    case 'dup': {
      const copy = { ...clone(part), id: newId(), ref: `${part.ref} copy` };
      state.parts.splice(state.parts.indexOf(part) + 1, 0, copy);
      renderParts();
      break;
    }
    case 'del':
      state.parts.splice(state.parts.indexOf(part), 1);
      renderParts();
      break;
    default: return;
  }
  save();
  update();
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
    renderAll();
    save();
    if (skipped.length) alert(`Skipped ${skipped.length} part(s) of unknown type: ${[...new Set(skipped)].join(', ')}`);
  } catch (err) {
    alert(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
  }
});

$('#netlist-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  let result;
  try {
    result = netlistToParts(await readText(file));
  } catch (err) {
    alert(`Could not read “${file.name}”: ${err.message}`);
    return;
  }
  if (state.parts.length && !confirm(`Replace the current parts with the ${result.lines.length} lines from “${file.name}”? The mission profile is kept.`)) return;
  state.parts = result.lines.map((l) => makePart(l.model, l.ref, l.qty, l.params, { inferred: { ...l.inferred }, source: l.source }));
  if (['Untitled board', 'Example board', ''].includes(state.title)) state.title = file.name.replace(/\.[^.]+$/, '');
  renderAll();
  save();
  const board = computeBoard({ profile: state.profile, components: state.parts });
  const guessed = state.parts.filter((p) => guessCount(p)).length;
  showReport(`Read ${plural(result.components, 'component')} from “${esc(file.name)}” (${esc(result.format)}, ${plural(result.nets, 'net')}) into ${plural(result.lines.length, 'line')}.
    ${result.skippedCount ? `Skipped ${result.skippedCount} mechanical items (${esc(result.skipped)}).` : ''}
    <strong>${plural(board.incomplete, 'line needs', 'lines need')} input</strong> (red, “Missing”) and ${plural(guessed, 'line has', 'lines have')} guessed values (amber, “Guessed”).
    Tick “Only parts that need attention” to work through them.`);
});

renderAll();
