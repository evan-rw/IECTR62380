// The board as a workbook for a reliability engineer: a summary, one row per
// part line with its rates, the calculation factors, the inputs and whether each
// was entered, guessed or is missing, the mission profile, the reliability
// structure, and the board-level checks. Values only, no formulas. Pure: the page
// passes in what it has computed (the same figures it shows).

import { MODELS, fieldLabel } from './models.js';
import { failureModesFor } from './failuremodes.js';
import { ENVIRONMENTS, SMT_217F } from './tables217f.js';
import { MISSION_PROFILES } from './tables.js';
import { ROOT, label as structureLabel, members as structureMembers } from './structure.js';
import { compressRefs } from './netlist.js';

const head = (...labels) => labels.map((v) => ({ v, style: 'head' }));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// A value the calculation shows as text ("1.053", "3.300e-3") becomes a number.
const asNumber = (v) => (typeof v === 'string' && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v.trim()) ? Number(v) : v);
const two = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;

const paramsOf = (comp) => ({ ...MODELS[comp.model].defaults, ...comp.params });
const guessed = (comp) => Object.keys(comp.inferred ?? {}).length > 0;

function optionLabel(f, value) {
  const o = (f.options ?? []).find((x) => String(x.value) === String(value));
  return o ? o.label : value;
}

// The shown inputs of a part line, in the order of its form.
function inputsOf(comp, result) {
  const model = MODELS[comp.model];
  const p = paramsOf(comp);
  return model.fields.filter((f) => !f.show || f.show(p)).flatMap((f) => {
    const v = p[f.key];
    const missing = result.missing.includes(f.key);
    // Advanced and optional inputs only when set.
    if ((f.advanced || f.optional) && (v == null || v === '') && !missing) return [];
    const reason = comp.inferred?.[f.key] ?? comp.confirmed?.[f.key] ?? '';
    const status = missing ? 'Missing' : comp.inferred?.[f.key] ? 'Guessed' : comp.confirmed?.[f.key] ? 'Guessed, confirmed' : 'Set';
    const value = v == null || v === '' ? null : f.type === 'select' ? optionLabel(f, v) : f.type === 'number' ? num(Number(v)) ?? String(v) : String(v);
    return [{ label: fieldLabel(f, p), value, unit: f.unit ?? '', status, reason }];
  });
}

function summarySheet(s) {
  const f = s.figures;
  const years = s.years;
  const preset = MISSION_PROFILES.rows.find((r) => r.id === s.profile.preset);
  const env = ENVIRONMENTS.find((e) => e.id === s.profile.env217f);
  const bound = (text) => (f.partial ? text : '');
  const rows = [
    [{ v: 'Failure rate prediction', style: 'title' }],
    ['Board', { v: s.title || 'Untitled board', style: 'bold' }],
    ['Generated', stamp(s.generated)],
    ['Calculator', 'IEC TR 62380 calculator', '', s.url],
    ['Mission length', num(years), 'years'],
    ['Mission profile', preset ? `${preset.label} (${preset.ref})` : 'Custom'],
    ['MIL-HDBK-217F environment', env ? env.label : ''],
    [],
    head('Result', 'Value', 'Unit', 'Note'),
    [f.redundancy ? `Board failure rate, average over ${years} years` : 'Board failure rate', { v: num(f.total), style: 'fitBold' }, 'FIT',
      [bound(`Lower bound: ${f.leftOut} left out.`), f.redundancy ? 'With the redundant blocks under Structure.' : ''].filter(Boolean).join(' ')],
  ];
  if (f.redundancy) rows.push(['Sum of part rates, all in series', { v: num(f.sum), style: 'fit' }, 'FIT', 'Every part counted in series, as if there were no redundancy.']);
  rows.push(
    [f.redundancy ? 'Mean time to failure' : 'MTBF', { v: num(f.mtbf), style: 'int' }, 'h', bound('Upper bound.')],
    [f.redundancy ? 'Mean time to failure, in years' : 'MTBF, in years', { v: num(f.mtbf / 8760), style: 'fit' }, 'years', bound('Upper bound.')],
    [`Survival over ${years} years`, { v: num(f.R), style: 'pct3' }, '', bound('Upper bound.')],
    [`Failures per 1000 boards over ${years} years`, { v: num(1000 * (1 - f.R)), style: 'fit' }, '', bound('Lower bound.')],
    ['Part lines', { v: s.board.items.length, style: 'int' }],
    ['Pieces', { v: f.pieces, style: 'int' }],
    ['Lines that need input (left out of the total)', { v: s.board.incomplete, style: 'int' }],
    ['Lines with guessed values', { v: f.guessedLines, style: 'int' }],
  );
  if (s.smt.devices.length) {
    rows.push(['Surface-mount solder joints (MIL-HDBK-217F 16.2)', { v: s.smt.worst ? s.smt.fit : null, style: 'fit' }, 'FIT',
      s.smt.worst ? `Weakest device: ${s.smt.worst.device.label || 'unnamed'}. ${s.smtInclude ? 'In the total.' : 'Not in the total.'}` : 'Needs input.']);
  }
  if (s.pcb.holes.length) {
    rows.push(['Circuit board, plated holes (IPC-TR-579)', { v: s.pcb.worst ? s.pcb.fit : null, style: 'fit' }, 'FIT',
      s.pcb.worst ? `Weakest hole size: ${s.pcb.worst.hole.label || 'unnamed'}. ${s.pcbInclude ? 'In the total.' : 'Not in the total.'}` : s.pcb.cracked ? 'A hole size cracks during assembly.' : 'Needs input.']);
  }
  if (s.life.rows.length) {
    const wear = s.board.items.reduce((sum, it) => sum + (it.result.wearOut ?? 0) * it.result.qty, 0);
    const n = s.life.rows.length;
    rows.push(['Aluminium capacitor wear-out, in the lines above', { v: wear, style: 'fit' }, 'FIT', `${n} ${n === 1 ? 'line' : 'lines'} checked; counted where drift is a failure.`]);
  }
  if (f.warn.length) rows.push([], head('Warnings'), ...f.warn.map((w) => [w]));
  rows.push([], head('What the total includes'), [s.scope], [], head('Read this first'), [s.notice]);
  return { name: 'Summary', columns: [{ width: 46 }, { width: 16 }, { width: 8 }, { width: 70 }], rows };
}

// One row per part line, then the board-level checks and the total.
function partsSheet(s) {
  const f = s.figures;
  const labels = [];
  for (const { result } of s.board.items) for (const [label] of result.parts ?? []) if (!labels.includes(label)) labels.push(label);
  const rows = [head('Ref', 'Qty', 'Part type', 'Method', 'Clause', 'Description', 'Manufacturer', 'MPN', 'λ each (FIT)', 'λ total (FIT)', 'Share of total',
    ...labels.map((l) => `${l} (FIT each)`), 'Status', 'Problems', 'Guessed values', 'Failure modes (MIL-HDBK-338B)')];
  for (const { comp, result } of s.board.items) {
    const model = MODELS[comp.model];
    const p = paramsOf(comp);
    const parts = new Map(result.complete ? result.parts : []);
    const fm = failureModesFor(comp.model, p);
    const reasons = Object.entries(comp.inferred ?? {}).map(([k, why]) => {
      const field = model.fields.find((x) => x.key === k);
      return `${field ? fieldLabel(field, p) : k}: ${why}`;
    });
    rows.push([
      comp.ref, { v: result.qty, style: 'int' }, model.label, model.group ?? '', model.clause ?? '', `${model.describe(p)}${result.wearOut ? ', with wear-out' : ''}`,
      comp.source?.manufacturer ?? '', comp.source?.mpn ?? '',
      result.complete ? result.fit : null, result.complete ? result.total : null,
      { v: result.complete && f.sum > 0 ? result.total / f.sum : null, style: 'pct' },
      ...labels.map((l) => num(parts.get(l))),
      result.complete ? (guessed(comp) ? 'Complete, with guessed values' : 'Complete') : 'Needs input (left out)',
      result.errors.join(' '), reasons.join('; '),
      fm ? fm.modes.map(([mode, a]) => `${mode} ${Math.round(a * 100)}%`).join(', ') : '',
    ]);
  }
  const width = rows[0].length;
  const extra = (ref, type, desc, fit, included, note) => {
    const row = Array(width).fill(null);
    Object.assign(row, { 0: ref, 2: type, 5: desc, 9: included ? fit : null, 10: { v: included && f.sum > 0 ? fit / f.sum : null, style: 'pct' } });
    row[11 + labels.length] = included ? 'In the total' : 'Not in the total';
    row[12 + labels.length] = note;
    return row;
  };
  if (s.smt.devices.length) {
    rows.push(extra('Solder joints', 'Surface mount (MIL-HDBK-217F 16.2), weakest link', s.smt.worst?.device.label ?? '', s.smt.fit, s.smtInclude && s.smt.worst,
      [...s.smt.problems, s.smt.incomplete ? `${s.smt.incomplete} devices need input.` : ''].filter(Boolean).join(' ')));
  }
  if (s.pcb.holes.length) {
    rows.push(extra('Circuit board', 'Plated-hole fatigue (IPC-TR-579), weakest hole size', s.pcb.worst?.hole.label ?? '', s.pcb.fit, s.pcbInclude && s.pcb.worst,
      [...s.pcb.problems, s.pcb.incomplete ? `${s.pcb.incomplete} hole sizes need input.` : ''].filter(Boolean).join(' ')));
  }
  const total = Array(width).fill(null);
  Object.assign(total, { 0: { v: 'Board, all in series', style: 'bold' }, 1: { v: f.pieces, style: 'int' }, 9: { v: f.sum, style: 'fitBold' }, 10: { v: 1, style: 'pct' } });
  total[12 + labels.length] = f.partial ? `Lower bound: ${f.leftOut} left out.` : '';
  rows.push(total);
  if (f.redundancy) {
    const red = Array(width).fill(null);
    Object.assign(red, { 0: { v: `Board with redundancy, average over ${s.years} years`, style: 'bold' }, 9: { v: f.total, style: 'fitBold' } });
    rows.push(red);
  }
  return {
    name: 'Parts',
    columns: [{ width: 22 }, { width: 6, style: 'int' }, { width: 26 }, { width: 18 }, { width: 9 }, { width: 40 }, { width: 18 }, { width: 18 },
      { width: 12, style: 'fit' }, { width: 12, style: 'fit' }, { width: 9, style: 'pct' }, ...labels.map(() => ({ width: 13, style: 'fit' })),
      { width: 24 }, { width: 40 }, { width: 40 }, { width: 34 }],
    rows,
    freeze: 1,
    filter: true,
  };
}

// The factors behind each complete line, as the page's "Show the calculation".
function calculationSheet(s) {
  const rows = [head('Ref', 'Part type', 'Quantity', 'Value', 'Note')];
  for (const { comp, result } of s.board.items) {
    if (!result.complete) continue;
    const label = MODELS[comp.model].label;
    for (const [name, v] of result.parts) rows.push([comp.ref, label, `${name}, FIT each`, v, '']);
    for (const [name, v, note] of result.values) rows.push([comp.ref, label, name, asNumber(v), note ?? '']);
  }
  return { name: 'Calculation', columns: [{ width: 22 }, { width: 26 }, { width: 34 }, { width: 16 }, { width: 70 }], rows, freeze: 1, filter: true };
}

// Per phase: the temperature factor while working, and the thermal-cycling terms.
function phasesSheet(s) {
  const phaseName = (i) => s.profile.phases[i]?.name || `Phase ${i + 1}`;
  const rows = [head('Ref', 'Phase', 'Temperature', 'Temperature (°C)', 'Factor', 'Factor value', 'Time share τ', 'Cycles per year n', 'π_n', 'ΔT (°C)', 'π_n·ΔT^0.68')];
  for (const { comp, result } of s.board.items) {
    if (!result.complete) continue;
    const by = new Map();
    for (const o of result.operating) by.set(o.phase, { o });
    for (const c of result.cycling) by.set(c.phase, { ...by.get(c.phase), c });
    for (const [i, { o, c }] of [...by].sort((a, b) => a[0] - b[0])) {
      rows.push([comp.ref, phaseName(i), o ? result.tempLabel ?? '' : '', o ? num(o.t) : null, o ? result.operatingLabel ?? 'π_t' : '', o ? num(o.piT) : null,
        o ? num(o.tau) : null, c ? num(c.n) : null, c ? num(c.piN) : null, c ? num(c.dT) : null, c ? num(c.term) : null]);
    }
  }
  return { name: 'Phases by part', columns: [{ width: 22 }, { width: 26 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 10 }, { width: 14 }], rows, freeze: 1, filter: true };
}

function inputsSheet(s) {
  const rows = [head('Ref', 'Part type', 'Input', 'Value', 'Unit', 'Status', 'Why it was guessed')];
  for (const { comp, result } of s.board.items) {
    const label = MODELS[comp.model].label;
    for (const x of inputsOf(comp, result)) rows.push([comp.ref, label, x.label, x.value, x.unit, x.status, x.reason]);
  }
  return { name: 'Inputs', columns: [{ width: 22 }, { width: 26 }, { width: 36 }, { width: 30 }, { width: 10 }, { width: 18 }, { width: 60 }], rows, freeze: 1, filter: true };
}

function profileSheet(s) {
  const preset = MISSION_PROFILES.rows.find((r) => r.id === s.profile.preset);
  const env = ENVIRONMENTS.find((e) => e.id === s.profile.env217f);
  const rows = [
    ['Profile', preset ? `${preset.label} (${preset.ref})` : 'Custom'],
    ['MIL-HDBK-217F environment', env ? env.label : ''],
    ['Mission length (years)', num(s.years)],
    [],
    head('Phase', 'Ambient temperature (°C)', 'Time share τ', 'Thermal cycles per year n', 'Cycle amplitude ΔT (°C)', 'ΔT adds the part\'s own rise'),
    ...s.profile.phases.map((ph, i) => [ph.name || `Phase ${i + 1}`, num(ph.tac), num(ph.tau), num(ph.n), num(ph.dT), ph.addRise ? 'Yes' : 'No']),
  ];
  if (num(s.profile.tauOff) != null) rows.push(['Time switched off, τ_off', null, s.profile.tauOff]);
  return { name: 'Mission profile', columns: [{ width: 30 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 }], rows, freeze: 5 };
}

// The reliability structure, depth first: blocks and the parts in them.
function structureSheet(s) {
  const { rt, ev } = s.structure;
  const rows = [head('Level', 'Block or parts', 'Kind', 'Must keep working', 'Members', 'Share of failures that break it (%)', 'Pieces', 'FIT', 'Parts', 'Problems')];
  const walk = (id, depth) => {
    const n = rt.nodes.get(id);
    const st = ev.stats.get(id);
    if (n.kind === 'leaf') {
      const line = n.lineId ? rt.lines.get(n.lineId) : null;
      rows.push([depth, `${'   '.repeat(depth)}${structureLabel(rt, id)}`, line ? line.label : 'Not in the parts list', null, null, null,
        { v: st?.pieces ?? null, style: 'int' }, { v: st ? st.fit : null, style: 'fit' }, line?.whole ? n.refs[0] : compressRefs(n.refs), '']);
      return;
    }
    const red = ev.red.has(id);
    const kind = n.fixed ? (id === ROOT ? 'Board, in series' : 'Everything else, in series')
      : n.proposed ? 'Proposed by the netlist, counted in series' : red ? 'Redundant (k of n)' : n.mode === 'kofn' ? 'Redundant, incomplete: counted in series' : 'Series';
    rows.push([depth, { v: `${'   '.repeat(depth)}${structureLabel(rt, id)}`, style: 'bold' }, kind,
      n.mode === 'kofn' ? num(n.need) : null, n.mode === 'kofn' ? structureMembers(rt, id) : null, n.mode === 'kofn' ? num(n.shortPct) : null,
      { v: st.pieces, style: 'int' }, { v: st.fit, style: id === ROOT ? 'fitBold' : 'fit' }, '',
      [...(ev.prob.get(id) ?? []), n.proposed ? `Proposed: ${n.proposed}.` : '', id === ROOT && s.figures.total !== st.fit ? 'Parts only: the summary adds the solder joints and circuit board.' : ''].filter(Boolean).join(' ')]);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(ROOT, 0);
  return {
    name: 'Structure',
    columns: [{ width: 6, style: 'int' }, { width: 40 }, { width: 30 }, { width: 10, style: 'int' }, { width: 9, style: 'int' }, { width: 12 }, { width: 8, style: 'int' }, { width: 12, style: 'fit' }, { width: 30 }, { width: 60 }],
    rows,
    freeze: 1,
  };
}

function solderSheet(s) {
  const lead = (id) => SMT_217F.leads.find((r) => r.id === id)?.label ?? id ?? '';
  const body = (id) => SMT_217F.bodies.find((r) => r.id === id)?.label ?? id ?? '';
  const rows = [head('Devices', 'Leads', 'Body', 'd, centre to furthest joint (mm)', 'h, joint height (mm)', 'Rise from own power (°C)', 'Characteristic life (years)', 'λ (FIT)', 'Weakest', 'Missing')];
  for (const r of s.smt.devices) {
    const d = r.device;
    rows.push([d.label ?? '', lead(d.lead), body(d.body), num(d.d), d.lead && d.lead !== 'leadless' ? '8 mils (leaded)' : num(d.h), num(d.rise),
      r.complete ? num(r.alphaHours / 8760) ?? '∞' : null, r.complete ? r.fit : null, r === s.smt.worst ? 'Yes' : '', r.complete ? '' : (r.missing ?? []).join(', ')]);
  }
  rows.push([], [s.smtInclude ? 'The weakest device is added to the board total.' : 'Not added to the board total.'], ...s.smt.problems.map((p) => [p]));
  return { name: 'Solder joints', columns: [{ width: 24 }, { width: 28 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14, style: 'fit' }, { width: 12, style: 'fit' }, { width: 9 }, { width: 30 }], rows, freeze: 1 };
}

function boardSheet(s) {
  const rows = [head('Hole size', 'Drill (mm)', 'Plating (µm)', 'Assembly uses (share of life)', 'Characteristic life (years)', 'λ (FIT)', 'Weakest', 'Problems')];
  for (const r of s.pcb.holes) {
    const h = r.hole;
    rows.push([h.label ?? '', num(h.drill), num(h.plating), { v: r.complete ? Math.min(1, r.used ?? 0) : null, style: 'pct' },
      r.complete && !r.cracked ? num(r.alphaHours / 8760) ?? '∞' : r.cracked ? 'Cracks during assembly' : null,
      r.complete && !r.cracked ? r.fit : null, r === s.pcb.worst ? 'Yes' : '',
      r.complete ? (r.problem ?? '') : r.missing?.length ? `Missing: ${r.missing.join(', ')}` : 'Waits for the board settings below']);
  }
  rows.push([], [s.pcbInclude ? 'The weakest hole size is added to the board total.' : 'Not added to the board total.'], ...s.pcb.problems.map((p) => [p]));
  return { name: 'Circuit board', columns: [{ width: 22 }, { width: 10 }, { width: 12 }, { width: 14 }, { width: 14, style: 'fit' }, { width: 12, style: 'fit' }, { width: 9 }, { width: 60 }], rows, freeze: 1 };
}

function lifeSheet(s) {
  const role = { drift: 'Yes', hard: 'No: only shorts and opens' };
  const kind = { wet: 'Wet', polymer: 'Polymer', hybrid: 'Hybrid' };
  const ripple = { none: 'None', ratio: 'From the ripple current ratio', rise: 'Measured rise' };
  const rows = [head('Ref', 'Qty', 'Kind', 'Rated life (h)', 'At (°C)', 'Ripple heating', 'Rise used (°C)', 'Drift is a failure', 'Life (years)', 'λ wear-out (FIT each)', 'Counted in the total', 'Notes')];
  for (const r of s.life.rows) {
    const v = r.values;
    const counted = s.life.byPart.has(r.part.id);
    rows.push([r.part.ref, { v: r.part.qty, style: 'int' }, kind[v.tech] ?? '', num(v.hours), num(v.temp), ripple[v.ripple] ?? '', r.lifeComplete ? num(r.rise) : null, role[r.role] ?? 'Missing',
      r.lifeComplete ? num(r.alphaHours / 8760) : null, counted ? r.fitEach : null, counted ? 'Yes' : 'No',
      [r.missing.length ? `Missing: ${r.missing.join(', ')}` : '', r.lifeComplete && r.capped ? 'Life capped at 15 years' : '',
        r.lifeComplete && r.wornOut ? 'Reaches end of life before the end of the mission' : '', Object.keys(r.inferred).length ? `Guessed: ${Object.keys(r.inferred).join(', ')}` : ''].filter(Boolean).join('. ')]);
  }
  if (s.life.problems.length) rows.push([], ...s.life.problems.map((p) => [p]));
  return { name: 'Capacitor life', columns: [{ width: 22 }, { width: 6 }, { width: 10 }, { width: 12 }, { width: 8 }, { width: 14 }, { width: 12 }, { width: 22 }, { width: 12, style: 'fit' }, { width: 14, style: 'fit' }, { width: 10 }, { width: 60 }], rows, freeze: 1 };
}

export function boardSheets(s) {
  return [
    summarySheet(s), partsSheet(s), calculationSheet(s), phasesSheet(s), inputsSheet(s), profileSheet(s), structureSheet(s),
    ...(s.smt.devices.length ? [solderSheet(s)] : []),
    ...(s.pcb.holes.length ? [boardSheet(s)] : []),
    ...(s.life.rows.length ? [lifeSheet(s)] : []),
  ];
}
