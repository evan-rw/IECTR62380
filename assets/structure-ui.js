// The reliability structure editor: a tree and a zoomable block diagram that
// edit the same nested structure, plus a side panel for the selection.
// Engine and editing operations live in structure.js; this module only draws
// and handles input. Every structural edit is saved through ctx.commit, which
// rebuilds the structure from the saved form and calls refresh() again.

import {
  ROOT, REST, buildStructure, serializeStructure, evaluateStructure, reindex, isAncestor, topLevel, members, label,
  groupNodes, ungroupNodes, moveNodes, splitLeaves, reorderNode, selectRefs, pieces,
} from './structure.js';
import { compressRefs, expandRefs } from './netlist.js';
import { suggestedShortShare } from './failuremodes.js';
import { esc } from './html.js';

const $ = (s, el = document) => el.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const plural = (n, a, b = `${a}s`) => `${n} ${n === 1 ? a : b}`;
const numOrNull = (s) => (s === '' || s == null || !Number.isFinite(Number(s)) ? null : Number(s));
const fmt = (v) => (!Number.isFinite(v) ? '∞' : v === 0 ? '0' : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v >= 0.01 ? v.toFixed(2) : v.toExponential(1));

// ctx: { getSaved(), commit(saved), describe(comp), modelOf(comp) -> { model, params }, openPart(lineId) }
let ctx;
let el = {};
let rt = null;
let ev = null;
let lastItems = [];
let lastYears = 0;
let selection = new Set();
// "Select several" (for touch): a plain tap acts as Ctrl+click.
let multi = false;
let focusId = ROOT;
let anchor = null;
let visible = [];
let match = new Set();
// Collapsed blocks that hold a Find match, so the match shows without opening them.
let matchIn = new Set();
let inspectorKey = '';
let pendingSelection = null;
// The diagram's size, kept by its ResizeObserver: reading it while drawing would force a
// layout of the whole page right after the tree was rebuilt.
let pane = null;
// What the diagram holds, so an identical redraw (a selection, a keystroke elsewhere) is skipped.
let lastMarkup = '';
// A redraw skipped while the diagram is hidden behind the Tree tab on a phone.
let diagramDirty = false;
// Top-level block names drawn at screen size while zoomed out, where the drawing's own text is too small.
let names = [];
let topIds = new Set();
// Whether the structure panel is on screen (or near it), from an IntersectionObserver; a
// refresh while it is off screen is drawn when it comes back.
let onScreen = true;
let drawingStale = false;

// ---------------------------------------------------------------------------
// Refresh and commit

export function refreshStructure(items, years) {
  lastItems = items;
  lastYears = years;
  rt = buildStructure(ctx.getSaved(), items, ctx.describe);
  ev = evaluateStructure(rt, years);
  if (pendingSelection) {
    selection = new Set(pendingSelection.filter((id) => rt.nodes.has(id)));
    focusId = [...selection][0] ?? focusId;
    pendingSelection = null;
  }
  selection = new Set([...selection].filter((id) => rt.nodes.has(id)));
  if (!rt.nodes.has(focusId)) focusId = ROOT;
  // The board figures need only the evaluation; the tree and diagram wait until on screen.
  if (onScreen) render(); else drawingStale = true;
  return ev;
}

// Earlier saved structures, for Undo; cleared when a new board is loaded.
let history = [];
// record: false for changes of view (a block opened or closed), which Undo skips.
function commit(selectIds, { record = true } = {}) {
  pendingSelection = selectIds ?? [...selection];
  if (record) {
    history.push(ctx.getSaved());
    if (history.length > 50) history.shift();
  }
  ctx.commit(serializeStructure(rt));
}
function undo() {
  if (!history.length) return say('Nothing to undo.');
  pendingSelection = [...selection];
  ctx.commit(history.pop());
  say('Undone.');
}

const say = (msg) => { el.status.textContent = msg; };

function render(fullInspector = false) {
  renderTree();
  renderDiagram();
  renderMoveTo();
  renderGoto();
  const undoBtn = el.section.querySelector('[data-st="undo"]');
  if (undoBtn) undoBtn.disabled = history.length === 0;
  const key = [...selection].sort().join(',') + '|' + [...selection].map((id) => {
    const n = rt.nodes.get(id);
    return n ? `${n.kind}${n.mode ?? ''}${n.proposed ? 'p' : ''}` : '';
  }).join(',');
  if (fullInspector || key !== inspectorKey) {
    inspectorKey = key;
    renderInspector();
  } else renderInspectorOut();
}

// ---------------------------------------------------------------------------
// Editing

function suggestShort(id) {
  const n = rt.nodes.get(id);
  const memberLines = [];
  const walk = (nid) => {
    const k = rt.nodes.get(nid);
    if (k.kind === 'leaf') {
      const line = k.lineId && rt.lines.get(k.lineId);
      if (line) memberLines.push({ ...ctx.modelOf(line.comp), fit: line.fit ?? 0 });
    } else if (!(k.mode === 'kofn' && k.id !== id)) k.children.forEach(walk);
  };
  walk(id);
  const s = suggestedShortShare(memberLines);
  if (!s) return;
  n.shortPct = s.pct;
  n.inferred = { shortPct: `from 1991 data (MIL-HDBK-338B Table 7.8-1): shorts are ${s.pct}% of failures of ${s.devices.map((d) => d.toLowerCase()).join(' and ')}` };
}

function group(mode) {
  const ids = topLevel(rt, selection).filter((id) => !rt.nodes.get(id).fixed);
  if (!ids.length) return say('Select parts or blocks first: click, Ctrl+click, Shift+click, Find, or lasso in the diagram.');
  const id = groupNodes(rt, ids, mode);
  if (mode === 'kofn') suggestShort(id);
  commit([id]);
  say(`Grouped ${plural(ids.length, 'item')} as ${mode === 'kofn' ? 'a redundant block. Now say how many must keep working.' : 'a series block.'}`);
  if (mode === 'kofn') $('#st-need', el.inspector)?.focus();
}

function ungroup(only) {
  const ids = (only ? [only] : topLevel(rt, selection)).filter((id) => rt.nodes.get(id)?.kind === 'block' && !rt.nodes.get(id).fixed);
  if (!ids.length) return say('Select a block to ungroup.');
  const freed = ungroupNodes(rt, ids);
  commit(freed);
  say(`Ungrouped ${plural(ids.length, 'block')}; the parts went back where the block was.`);
}

function move(ids, target) {
  const moved = moveNodes(rt, ids, target);
  if (!moved) return say('Nothing to move there.');
  commit([target]);
  say(`Moved ${plural(moved, 'item')} into ${label(rt, target)}.`);
}

function split() {
  const made = splitLeaves(rt, [...selection]);
  if (!made.length) return say('Select a line with more than one reference to split it.');
  commit(made);
  say(`Split into ${plural(made.length, 'single part')}. Drag or move the ones you need.`);
}

function reorder(dir) {
  if (reorderNode(rt, focusId, dir)) commit([focusId]);
}

function indent() {
  reindex(rt);
  const p = rt.parent.get(focusId);
  if (!p) return;
  const c = rt.nodes.get(p).children;
  const prev = c.slice(0, c.indexOf(focusId)).reverse().find((x) => rt.nodes.get(x).kind === 'block' && x !== REST);
  if (prev) move(selection.has(focusId) ? [...selection] : [focusId], prev); else say('No block above to move into.');
}

function outdent() {
  reindex(rt);
  const p = rt.parent.get(focusId);
  if (!p || p === ROOT) return say('Already at the top level.');
  move(selection.has(focusId) ? [...selection] : [focusId], p === REST ? ROOT : rt.parent.get(p) ?? ROOT);
}

// Select what Find names, show it and put the focus on it, so P or S comes next. No commit:
// rebuilding would put "Everything else" back as whole lines and drop the parts split off.
function selectMatches() {
  const found = selectRefs(rt, el.find.value);
  if (!found.ids.length) {
    // A net name (+3V3) finds the blocks proposed on it.
    const tokens = new Set(el.find.value.split(/[\s,]+/).map((t) => t.toUpperCase()).filter(Boolean));
    const blocks = [...rt.nodes.values()].filter((b) => b.kind === 'block' && b.nets?.some((x) => tokens.has(x.toUpperCase()))).map((b) => b.id);
    if (!blocks.length) return say('No parts match.');
    found.ids = blocks;
    found.count = blocks.reduce((t, id) => t + pieces(rt, id), 0);
    found.unknown = [];
  }
  match = new Set();
  matchIn = new Set();
  // The parts split off are new nodes: work out their figures before drawing them.
  ev = evaluateStructure(rt, lastYears);
  selection = new Set(found.ids);
  [anchor] = found.ids;
  [focusId] = found.ids;
  for (const id of found.ids) for (let p = rt.parent.get(id); p; p = rt.parent.get(p)) rt.nodes.get(p).expanded = true;
  render(true);
  if (!diagramHidden()) frameIds([...selection]);
  const row = document.getElementById(`st-t-${focusId}`);
  row?.focus();
  row?.scrollIntoView?.({ block: 'nearest' });
  say(`Selected ${plural(found.count, 'part')}${found.unknown.length ? `; not on the board: ${found.unknown.join(', ')}` : ''}. Press P to group them as parallel, S as series.`);
}

// Reviewing an import's proposals one after another.
// The first proposal after `id` in tree order, wrapping round (null if none other is left).
function proposalAfter(id) {
  const order = [];
  const walk = (x) => {
    const n = rt.nodes.get(x);
    if (n.kind !== 'block') return;
    order.push(x);
    n.children.forEach(walk);
  };
  walk(ROOT);
  const i = Math.max(0, order.indexOf(id));
  return [...order.slice(i + 1), ...order.slice(0, i + 1)].find((x) => x !== id && rt.nodes.get(x).proposed) ?? null;
}
const proposalCount = () => [...rt.nodes.values()].filter((x) => x.proposed).length;
function focusRow(id) {
  const row = document.getElementById(`st-t-${id}`);
  row?.focus();
  row?.scrollIntoView?.({ block: 'nearest' });
}
function nextProposal() {
  const next = proposalAfter([...selection][0] ?? ROOT);
  if (!next) return say('No proposals left to review.');
  selection = new Set([next]);
  anchor = next;
  focusId = next;
  for (let p = rt.parent.get(next); p; p = rt.parent.get(p)) rt.nodes.get(p).expanded = true;
  render(true);
  focusRow(next);
  return say(`${label(rt, next)}: Mark redundant, or Dismiss to count its parts in series. ${plural(proposalCount(), 'proposal')} to review.`);
}

// ---------------------------------------------------------------------------
// Tree

const lineOf = (n) => (n.kind === 'leaf' && n.lineId ? rt.lines.get(n.lineId) : null);
const guessedLine = (line) => line && Object.keys(line.comp.inferred ?? {}).length > 0;

function modeBadge(n) {
  if (n.proposed) return '<span class="st-badge proposed">proposed</span>';
  if (n.mode === 'kofn') return `<span class="st-badge kofn${ev.red.has(n.id) ? '' : ' bad'}" title="${esc(ev.prob.get(n.id).join(' ') || 'k of n must keep working')}">${n.need ?? '?'} of ${members(rt, n.id)}</span>`;
  return '<span class="st-badge">series</span>';
}

function chips(n, st) {
  if (n.kind === 'leaf') {
    const line = lineOf(n);
    if (!line) return '<span class="st-chips"><span class="st-chip miss">Not in parts list</span></span>';
    return `<span class="st-chips">${line.fit == null ? '<span class="st-chip miss">Missing</span>' : guessedLine(line) ? '<span class="st-chip guess">Guessed</span>' : ''}</span>`;
  }
  return `<span class="st-chips">${st.missing ? `<span class="st-chip miss">${st.missing} missing</span>` : ''}${st.guessed ? `<span class="st-chip guess">${st.guessed} guessed</span>` : ''}</span>`;
}

function rowHTML(n, level) {
  const st = ev.stats.get(n.id);
  const isBlock = n.kind === 'block';
  const kids = isBlock && n.children.length > 0;
  const sel = selection.has(n.id);
  const cls = ['st-row', isBlock ? 'blockrow' : 'leafrow', n.proposed ? 'proposed' : '', sel ? 'sel' : '', st.inRed ? 'inred' : '', match.has(n.id) ? 'match' : '',
    isBlock && !n.expanded && matchIn.has(n.id) ? 'has-match' : ''].join(' ');
  const line = lineOf(n);
  const name = isBlock
    ? `<span class="st-nm">${esc(n.id === REST ? `Everything else, in series (${st.pieces})` : n.id === ROOT ? 'Board' : label(rt, n.id))}</span>`
    : `<span class="st-nm"><b>${esc(label(rt, n.id))}</b> <span class="muted">${esc(line?.label ?? '')}</span></span>`;
  const fitText = !isBlock && (st.missing || st.unknown) ? '<span class="bad">—</span>' : fmt(st.fit);
  const title = isBlock && st.red ? ` title="${fmt(st.sfit)} FIT if everything in it were in series"` : '';
  return `<li role="treeitem" id="st-t-${esc(n.id)}" data-id="${esc(n.id)}" aria-level="${level}" aria-selected="${sel}"${kids ? ` aria-expanded="${n.expanded}"` : ''} tabindex="${n.id === focusId ? 0 : -1}">
    <div class="${cls}" data-lvl="${level - 1}">
      <span class="st-handle${n.fixed ? ' off' : ''}" aria-hidden="true">${n.fixed ? '' : '⠿'}</span>
      <span class="st-twisty" aria-hidden="true">${kids ? (n.expanded ? '▾' : '▸') : ''}</span>
      <span class="st-main">${isBlock ? (n.fixed ? '<span class="st-badge">series</span>' : modeBadge(n)) : `<span class="st-qty">×${st.pieces}</span>`}${name}${isBlock && n.nets?.length ? `<span class="st-nets muted">${esc(n.nets.join(' / '))}</span>` : ''}${chips(n, st)}</span>
      <span class="st-fit"${title}>${fitText}</span>
      <span class="st-bar" aria-hidden="true">${!st.inRed && st.share > 0 ? `<i data-share="${Math.max(3, st.share * 100).toFixed(1)}"></i>` : ''}</span>
    </div>${n.proposed && sel && selection.size === 1 ? `
    <div class="st-rowacts" data-lvl="${level - 1}"><button type="button" class="primary" data-st="accept" tabindex="-1">Mark redundant</button><button type="button" data-st="dismiss" tabindex="-1">Dismiss</button></div>` : ''}`;
}

function renderTree() {
  const hadFocus = el.tree.contains(document.activeElement);
  const out = [];
  visible = [];
  const walk = (id, level) => {
    const n = rt.nodes.get(id);
    visible.push(id);
    out.push(rowHTML(n, level));
    if (n.kind === 'block' && n.expanded && n.children.length) {
      out.push('<ul role="group">');
      n.children.forEach((c) => walk(c, level + 1));
      out.push('</ul>');
    }
    out.push('</li>');
  };
  walk(ROOT, 1);
  if (!visible.includes(focusId)) {
    let p = rt.parent.get(focusId);
    while (p && !visible.includes(p)) p = rt.parent.get(p);
    focusId = p ?? ROOT;
  }
  el.tree.innerHTML = out.join('');
  // Indents and bars go through the style object: the page's security policy blocks style attributes.
  for (const r of el.tree.querySelectorAll('[data-lvl]')) r.style.setProperty('--lvl', r.dataset.lvl);
  for (const b of el.tree.querySelectorAll('[data-share]')) b.style.width = `${b.dataset.share}%`;
  const f = document.getElementById(`st-t-${focusId}`);
  if (f) {
    f.tabIndex = 0;
    if (hadFocus) f.focus({ preventScroll: false });
  }
}

function setExpanded(id, on) {
  const n = rt.nodes.get(id);
  if (n.kind !== 'block' || n.expanded === on) return;
  n.expanded = on;
  commit(undefined, { record: false });
}

function setFocus(id, extend) {
  focusId = id;
  if (extend) selection.add(id);
  else if (selection.size <= 1) { selection = new Set([id]); anchor = id; }
  render();
  document.getElementById(`st-t-${id}`)?.scrollIntoView?.({ block: 'nearest' });
}

function select(id, e = {}) {
  if (multi && !e.shiftKey) e = { ...e, ctrlKey: true };
  if (e.shiftKey && anchor && visible.includes(anchor) && visible.includes(id)) {
    const [a, b] = [visible.indexOf(anchor), visible.indexOf(id)].sort((x, y) => x - y);
    visible.slice(a, b + 1).forEach((v) => selection.add(v));
  } else if (e.ctrlKey || e.metaKey) {
    if (selection.has(id)) selection.delete(id); else selection.add(id);
    anchor = id;
  } else {
    selection = new Set([id]);
    anchor = id;
  }
  focusId = id;
  render();
}

// ---------------------------------------------------------------------------
// Drag (tree handles, diagram boxes and block headers), with pointer events

function markDrop(id, on) {
  if (!id) return;
  document.querySelectorAll(`#st-tree [data-id="${CSS.escape(id)}"] > .st-row, #st-rbd [data-id="${CSS.escape(id)}"]`).forEach((x) => x.classList.toggle('drop', on));
}

function dropTargetAt(cx, cy, ids) {
  const hit = document.elementFromPoint?.(cx, cy);
  if (!hit) return null;
  let id = null;
  if (hit.closest('#st-rbd')) {
    const r = el.svg.getBoundingClientRect();
    const [lx, ly] = toLayout([cx - r.left, cy - r.top]);
    id = deepestBlockAt(lx, ly, ids) ?? ROOT;
  } else {
    const row = hit.closest('#st-tree [data-id]');
    if (!row) return null;
    id = row.dataset.id;
    if (rt.nodes.get(id).kind === 'leaf') id = rt.parent.get(id);
  }
  if (!id || ids.some((d) => d === id || isAncestor(rt, d, id))) return null;
  return id;
}

function beginNodePointer(e, id, fromDiagram) {
  e.preventDefault();
  reindex(rt);
  const start = [e.clientX, e.clientY];
  let dragging = false;
  let target = null;
  const ids = selection.has(id) ? topLevel(rt, selection).filter((x) => !rt.nodes.get(x).fixed) : [id];
  // Only the pointer that picked the item up moves it (a second finger is not a drag).
  const pid = e.pointerId;
  const mine = (ev2) => pid == null || ev2.pointerId == null || ev2.pointerId === pid;
  const onMove = (ev2) => {
    if (!mine(ev2)) return;
    if (!dragging) {
      if (Math.hypot(ev2.clientX - start[0], ev2.clientY - start[1]) < 6 || rt.nodes.get(id).fixed) return;
      dragging = true;
      el.ghost.hidden = false;
      document.body.classList.add('st-dragging');
      const parts = ids.reduce((s, x) => s + ev.stats.get(x).pieces, 0);
      el.ghost.textContent = ids.length === 1 ? `${label(rt, ids[0])} (${plural(parts, 'part')})` : `${ids.length} items, ${plural(parts, 'part')}`;
    }
    el.ghost.style.transform = `translate(${ev2.clientX + 14}px, ${ev2.clientY + 10}px)`;
    const t = dropTargetAt(ev2.clientX, ev2.clientY, ids);
    if (t !== target) {
      markDrop(target, false);
      target = t;
      markDrop(target, true);
      say(target ? `Drop into ${target === ROOT ? 'the board' : label(rt, target)}` : 'Not a place to drop');
    }
  };
  const onUp = (ev2) => {
    if (!mine(ev2)) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    el.ghost.hidden = true;
    document.body.classList.remove('st-dragging');
    markDrop(target, false);
    if (dragging) { if (target) move(ids, target); else say('Move cancelled.'); } else if (ev2.type === 'pointerup') select(id, fromDiagram ? { ctrlKey: ev2.ctrlKey || ev2.metaKey || ev2.shiftKey } : ev2);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

// ---------------------------------------------------------------------------
// Diagram layout: series left to right, k-of-n stacked between a split and a
// voting join; big series blocks (order does not matter in series) wrap into a grid.

const LW = 132, LH = 42, CW = 176, CH = 52, GX = 26, GY = 12, PAD = 12, HEAD = 24, RAIL = 18, RG = 44;
let view = { k: 1, x: 20, y: 20 };
let fitted = false;
let lassoMode = false;
const geo = new Map();
function paneSize() {
  if (!pane) pane = { w: el.svg.clientWidth, h: el.svg.clientHeight };
  return pane;
}

function lay(id) {
  const n = rt.nodes.get(id);
  const g = { grid: null };
  geo.set(id, g);
  if (n.kind === 'leaf') { Object.assign(g, { w: LW, h: LH, port: LH / 2 }); return g; }
  g.collapsed = id !== ROOT && (!n.expanded || !n.children.length);
  if (g.collapsed) { Object.assign(g, { w: CW, h: CH, port: CH / 2 }); return g; }
  const kids = n.children.map((c) => lay(c));
  const head = id === ROOT ? 0 : HEAD;
  g.par = id !== ROOT && n.mode === 'kofn';
  if (id === ROOT) {
    const pack = (target) => {
      const rows = [];
      let cur = [];
      let w = 0;
      n.children.forEach((c, i) => {
        const k = kids[i];
        if (cur.length && w + GX + k.w > target) { rows.push(cur); cur = []; w = 0; }
        w += (cur.length ? GX : 0) + k.w;
        cur.push(c);
      });
      rows.push(cur);
      const out = rows.map((r) => {
        const gs = r.map((c) => geo.get(c));
        return { ids: r, w: gs.reduce((s, k) => s + k.w, 0) + GX * (r.length - 1), above: Math.max(...gs.map((k) => k.port)), below: Math.max(...gs.map((k) => k.h - k.port)) };
      });
      const W = PAD * 2 + GX * 2 + Math.max(...out.map((r) => r.w));
      const H = PAD * 2 + out.reduce((s, r) => s + r.above + r.below, 0) + RG * (out.length - 1);
      return { rows: out, W, H };
    };
    // Row widths from the widest block to one long row: keep the one Fit shows largest in this pane,
    // so a board of many blocks fills a wide desktop pane and a tall phone pane alike.
    const PW = paneSize().w || 640;
    const PH = paneSize().h || 480;
    const widest = Math.max(...kids.map((k) => k.w));
    const total = kids.reduce((t, k) => t + k.w + GX, 0);
    let best = null;
    for (let t = widest; ; t *= 1.12) {
      const r = pack(Math.min(t, total));
      const k = Math.min((PW - 40) / (r.W + 16), (PH - 40) / (r.H + 16));
      if (!best || k > best.k * 1.0001) best = { ...r, k };
      if (t >= total) break;
    }
    g.rows = best.rows;
    g.w = PAD * 2 + GX * 2 + Math.max(...g.rows.map((r) => r.w));
    g.h = PAD * 2 + g.rows.reduce((s, r) => s + r.above + r.below, 0) + RG * (g.rows.length - 1);
    g.port = PAD + g.rows[0].above;
  } else if (g.par) {
    const inner = kids.reduce((s, k) => s + k.h, 0) + GY * (kids.length - 1);
    Object.assign(g, { w: PAD * 2 + RAIL * 2 + Math.max(...kids.map((k) => k.w)), h: head + PAD * 2 + inner, port: head + PAD + inner / 2 });
  } else if (kids.length > 8) {
    // Very large grids (a long "Everything else") take the pane's shape too.
    const cw0 = Math.max(...kids.map((k) => k.w)) + 10;
    const ch0 = Math.max(...kids.map((k) => k.h)) + GY;
    const cols = kids.length > 40
      ? Math.max(1, Math.min(kids.length, Math.round(Math.sqrt(kids.length * (ch0 / cw0) * ((paneSize().w || 640) / (paneSize().h || 480))))))
      : Math.ceil(Math.sqrt(kids.length * 2.5));
    const rows = Math.ceil(kids.length / cols);
    const cw = Math.max(...kids.map((k) => k.w));
    const ch = Math.max(...kids.map((k) => k.h));
    g.grid = { cols, cw, ch };
    Object.assign(g, { w: PAD * 2 + cols * cw + (cols - 1) * 10, h: head + PAD * 2 + rows * ch + (rows - 1) * GY });
    g.port = g.h / 2;
  } else {
    const above = Math.max(...kids.map((k) => k.port));
    const below = Math.max(...kids.map((k) => k.h - k.port));
    Object.assign(g, { w: PAD * 2 + kids.reduce((s, k) => s + k.w, 0) + GX * (kids.length - 1), h: head + PAD * 2 + above + below, port: head + PAD + above });
  }
  return g;
}

function place(id, x, y) {
  const n = rt.nodes.get(id);
  const g = geo.get(id);
  Object.assign(g, { x, y, shown: true });
  if (n.kind === 'leaf' || g.collapsed) return;
  const head = id === ROOT ? 0 : HEAD;
  if (id === ROOT) {
    let ry = y + PAD;
    for (const row of g.rows) {
      row.py = ry + row.above;
      row.x0 = x + PAD + GX;
      let cx = row.x0;
      for (const c of row.ids) { const k = geo.get(c); place(c, cx, row.py - k.port); cx += k.w + GX; }
      row.x1 = cx - GX;
      ry += row.above + row.below + RG;
    }
  } else if (g.par) {
    let cy = y + head + PAD;
    for (const c of n.children) { place(c, x + PAD + RAIL, cy); cy += geo.get(c).h + GY; }
  } else if (g.grid) {
    const { cols, cw, ch } = g.grid;
    n.children.forEach((c, i) => place(c, x + PAD + (i % cols) * (cw + 10), y + head + PAD + Math.floor(i / cols) * (ch + GY)));
  } else {
    let cx = x + PAD;
    const py = y + g.port;
    for (const c of n.children) { const k = geo.get(c); place(c, cx, py - k.port); cx += k.w + GX; }
  }
}

function headText(n, g, st) {
  const name = n.id === REST ? 'Everything else' : label(rt, n.id);
  const max = Math.floor((g.w - 20) / 6.6);
  const badge = n.proposed ? 'proposed' : n.mode === 'kofn' ? `${n.need ?? '?'} of ${members(rt, n.id)} must work` : 'series';
  const full = `${name} · ${badge} · ${fmt(st.fit)} FIT`;
  if (full.length <= max) return [name, ` · ${badge} · ${fmt(st.fit)} FIT`, full];
  if (`${name} · ${fmt(st.fit)} FIT`.length <= max) return [name, ` · ${fmt(st.fit)} FIT`, full];
  return [name.length > max ? `${name.slice(0, Math.max(3, max - 1))}…` : name, '', full];
}

function draw(id, L, inRed) {
  const n = rt.nodes.get(id);
  const g = geo.get(id);
  const st = ev.stats.get(id);
  // Selection and Find marks are classes set by paintMarks(), not part of the markup.
  const sel = '';
  const m = '';
  const did = esc(id);
  if (n.kind === 'leaf' || g.collapsed) {
    const leafy = n.kind === 'leaf';
    const line = leafy ? lineOf(n) : null;
    const miss = leafy && (!line || line.fit == null);
    const title = leafy ? label(rt, id) : n.id === REST ? 'Everything else' : label(rt, id);
    const sub = leafy ? (!line ? 'Not in parts list' : miss ? 'Missing input' : `${st.pieces > 1 ? `×${st.pieces} · ` : ''}${fmt(st.fit)} FIT`)
      : `${n.proposed ? 'proposed' : n.mode === 'kofn' ? `${n.need ?? '?'} of ${members(rt, id)}` : 'series'} · ${st.pieces} parts · ${fmt(st.fit)} FIT`;
    if (topIds.has(id)) names.push({ id, x: g.x, y: g.y, w: g.w, text: title });
    L.boxes.push(`<g class="st-box${leafy ? ' leaf' : ' collapsed'}${miss ? ' missing' : ''}${n.proposed ? ' proposed' : ''}${sel}${m}" data-id="${did}" data-drag="1" transform="translate(${g.x} ${g.y})">`
      + (leafy && st.pieces > 1 ? `<rect class="stack" x="4" y="-4" width="${g.w}" height="${g.h}" rx="5"/>` : '')
      + `<rect class="face" width="${g.w}" height="${g.h}" rx="${leafy ? 5 : 8}"/>`
      + `<text class="t1" x="8" y="${leafy ? 17 : 20}">${esc(title.length > 20 ? `${title.slice(0, 19)}…` : title)}</text>`
      + `<text class="sub" x="8" y="${leafy ? 33 : 38}">${esc(sub)}</text>`
      + (leafy && guessedLine(line) && !miss ? `<circle class="gdot" cx="${g.w - 9}" cy="9" r="4"><title>Guessed values</title></circle>` : '')
      + (!inRed && st.share > 0 ? `<rect class="share" x="0" y="${g.h - 3}" width="${Math.max(2, g.w * st.share).toFixed(1)}" height="3"/>` : '')
      + `<title>${esc(title)}: ${esc(sub)}${line ? ` (${esc(line.label)})` : ''}</title></g>`);
    return;
  }
  const py = g.y + g.port;
  const red = ev.red.has(id);
  if (id !== ROOT) {
    const [nm, rest, full] = headText(n, g, st);
    if (topIds.has(id)) names.push({ id, x: g.x, y: g.y, w: g.w, text: n.id === REST ? 'Everything else' : label(rt, id) });
    L.frames.push(`<rect class="frame${g.par ? ' par' : ''}${n.proposed ? ' proposed' : ''}${n.mode === 'kofn' && !red ? ' invalid' : ''}${sel}" data-id="${did}" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="8"/>`
      + `<rect class="hband" data-id="${did}"${n.fixed ? '' : ' data-drag="1"'} x="${g.x}" y="${g.y}" width="${g.w}" height="${HEAD}"><title>${esc(full)}. ${n.fixed ? '' : 'Drag to move. '}Double-click to zoom.</title></rect>`);
    L.labels.push(`<text class="head" x="${g.x + 10}" y="${g.y + 16}">${esc(nm)}<tspan class="m">${esc(rest)}</tspan></text>`);
  }
  const kids = n.children.map((c) => geo.get(c));
  if (id === ROOT) {
    const left = g.x + PAD;
    const right = g.x + g.w - PAD;
    g.rows.forEach((row, i) => {
      const rk = row.ids.map((c) => geo.get(c));
      for (let j = 0; j + 1 < rk.length; j++) L.wires.push(`M${rk[j].x + rk[j].w} ${row.py}H${rk[j + 1].x}`);
      if (i === 0) L.wires.push(`M${left} ${row.py}H${row.x0}`);
      else {
        const prev = g.rows[i - 1];
        const gy = prev.py + prev.below + RG / 2;
        L.wires.push(`M${prev.x1} ${prev.py}H${right}V${gy}H${left}V${row.py}H${row.x0}`);
      }
      if (i === g.rows.length - 1) L.wires.push(`M${row.x1} ${row.py}H${right}`);
    });
    L.labels.push(`<circle class="term" cx="${left}" cy="${g.rows[0].py}" r="4"/><circle class="term" cx="${right}" cy="${g.rows[g.rows.length - 1].py}" r="4"/>`);
  } else if (g.par) {
    const sx = g.x + PAD;
    const jx = g.x + g.w - PAD;
    L.wires.push(`M${g.x} ${py}H${sx}M${jx} ${py}H${g.x + g.w}`);
    for (const k of kids) { const ky = k.y + k.port; L.wires.push(`M${sx} ${py}V${ky}H${k.x}M${k.x + k.w} ${ky}H${jx}V${py}`); }
    L.labels.push(`<g class="vote${red ? '' : ' bad'}"><circle cx="${jx}" cy="${py}" r="12"/><text x="${jx}" y="${py}">${n.need ?? '?'}/${members(rt, id)}</text><title>${esc(red ? `${n.need} of ${members(rt, id)} must keep working; ${n.shortPct}% of failures break it anyway` : ev.prob.get(id).join(' '))}</title></g>`);
  } else if (g.grid) {
    L.wires.push(`M${g.x - 1} ${py}H${g.x + PAD / 2}M${g.x + g.w - PAD / 2} ${py}H${g.x + g.w + 1}`);
  } else {
    const first = kids[0];
    const last = kids[kids.length - 1];
    L.wires.push(`M${g.x} ${py}H${first.x}M${last.x + last.w} ${py}H${g.x + g.w}`);
    for (let i = 0; i + 1 < kids.length; i++) L.wires.push(`M${kids[i].x + kids[i].w} ${py}H${kids[i + 1].x}`);
  }
  n.children.forEach((c) => draw(c, L, inRed || red));
}

const diagramHidden = () => el.panes.dataset.tab === 'tree' && typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
function renderDiagram(force = false) {
  if (!force && diagramHidden()) { diagramDirty = true; return; }
  diagramDirty = false;
  geo.clear();
  names = [];
  topIds = new Set(rt.nodes.get(ROOT).children);
  lay(ROOT);
  place(ROOT, 0, 0);
  const L = { frames: [], wires: [], boxes: [], labels: [] };
  draw(ROOT, L, false);
  const markup = `${L.frames.join('')}<path class="wire" d="${L.wires.join('')}"/>${L.boxes.join('')}${L.labels.join('')}`;
  if (markup !== lastMarkup) {
    el.vp.innerHTML = markup;
    lastMarkup = markup;
    el.names.innerHTML = names.map((nm) => `<g data-id="${esc(nm.id)}"><rect height="15"/><text y="11"></text></g>`).join('');
  }
  paintMarks();
  applyView();
  if (!fitted) fit(false);
}
function paintMarks() {
  for (const node of el.vp.querySelectorAll('.frame, .st-box')) {
    node.classList.toggle('sel', selection.has(node.dataset.id));
    if (node.classList.contains('st-box')) node.classList.toggle('match', match.has(node.dataset.id));
  }
}

function deepestBlockAt(lx, ly, exclude = []) {
  let best = null;
  const walk = (id) => {
    const n = rt.nodes.get(id);
    const g = geo.get(id);
    if (n.kind !== 'block' || exclude.includes(id) || !g?.shown) return;
    if (lx < g.x || ly < g.y || lx > g.x + g.w || ly > g.y + g.h) return;
    best = id;
    if (!g.collapsed) n.children.forEach(walk);
  };
  walk(ROOT);
  return best;
}

function nodeAt(lx, ly) {
  let best = null;
  const walk = (id) => {
    const n = rt.nodes.get(id);
    const g = geo.get(id);
    if (!g?.shown || lx < g.x || ly < g.y || lx > g.x + g.w || ly > g.y + g.h) return;
    best = id;
    if (n.kind === 'block' && !g.collapsed) n.children.forEach(walk);
  };
  walk(ROOT);
  return best;
}

// Pan and zoom
function applyView() {
  el.vp.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  el.svg.classList.toggle('lod', view.k < 0.55);
  el.svg.classList.toggle('lod2', view.k < 0.3);
  // Zoomed out, each top-level block is named in a tooltip-style label at a readable size.
  const show = view.k < 0.55;
  el.names.style.display = show ? '' : 'none';
  if (show) {
    names.forEach((nm, i) => {
      const node = el.names.children[i];
      if (!node) return;
      const wpx = nm.w * view.k;
      const max = Math.floor((wpx - 8) / 6.2);
      if (max < 3) { node.style.display = 'none'; return; }
      node.style.display = '';
      const text = nm.text.length > max ? `${nm.text.slice(0, max - 1)}…` : nm.text;
      if (node.lastChild.textContent !== text) node.lastChild.textContent = text;
      node.setAttribute('transform', `translate(${(nm.x * view.k + view.x).toFixed(1)} ${(nm.y * view.k + view.y + 1).toFixed(1)})`);
      node.firstChild.setAttribute('width', Math.min(wpx, text.length * 6.2 + 8).toFixed(1));
    });
  }
  el.zoomlvl.textContent = `${Math.round(view.k * 100)}%`;
}
const svgPoint = (e) => { const r = el.svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const toLayout = ([px, py]) => [(px - view.x) / view.k, (py - view.y) / view.k];
function zoomAt(px, py, f) {
  const k = clamp(view.k * f, 0.06, 4);
  const r = k / view.k;
  view = { k, x: px - (px - view.x) * r, y: py - (py - view.y) * r };
  applyView();
}
let anim = 0;
function animateTo(to) {
  const from = { ...view };
  const t0 = performance.now();
  const dur = matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 260;
  const id = ++anim;
  const step = (now) => {
    if (id !== anim) return;
    const u = dur ? Math.min(1, (now - t0) / dur) : 1;
    const e = 1 - (1 - u) ** 3;
    view = { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
    applyView();
    if (u < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function frameBox(x, y, w, h, animate) {
  const r = el.svg.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const k = clamp(Math.min((r.width - 40) / w, (r.height - 40) / h), 0.06, 1.6);
  const to = { k, x: (r.width - w * k) / 2 - x * k, y: (r.height - h * k) / 2 - y * k };
  if (animate) animateTo(to); else { view = to; applyView(); }
  return true;
}
// Frame items, or the nearest drawn block holding each; with onlyIfHidden, only when they are off screen or tiny.
function frameIds(ids, onlyIfHidden) {
  reindex(rt);
  const shown = (id) => { let x = id; while (x && !geo.get(x)?.shown) x = rt.parent.get(x); return x; };
  const gs = [...new Set(ids.map(shown))].filter((x) => x && x !== ROOT).map((x) => geo.get(x));
  if (!gs.length) return;
  const x0 = Math.min(...gs.map((g) => g.x));
  const y0 = Math.min(...gs.map((g) => g.y));
  const x1 = Math.max(...gs.map((g) => g.x + g.w));
  const y1 = Math.max(...gs.map((g) => g.y + g.h));
  if (onlyIfHidden) {
    const r = el.svg.getBoundingClientRect();
    const [sx0, sy0, sx1, sy1] = [x0 * view.k + view.x, y0 * view.k + view.y, x1 * view.k + view.x, y1 * view.k + view.y];
    if (sx0 >= 0 && sy0 >= 0 && sx1 <= r.width && sy1 <= r.height && view.k >= 0.55) return;
  }
  frameBox(x0 - 12, y0 - 12, x1 - x0 + 24, y1 - y0 + 24, true);
}
// The diagram's block list, for finding a block without panning.
function renderGoto() {
  if (!el.goto || diagramHidden()) return;
  const opts = ['<option value="">Go to…</option>'];
  const walk = (id, depth) => {
    const n = rt.nodes.get(id);
    if (n.kind !== 'block') return;
    if (id !== ROOT) opts.push(`<option value="${esc(id)}">${'\u00a0\u00a0'.repeat(depth - 1)}${esc(id === REST ? 'Everything else' : label(rt, id))}</option>`);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(ROOT, 0);
  const html = opts.join('');
  if (html !== el.goto.dataset.html) { el.goto.innerHTML = html; el.goto.dataset.html = html; }
}
function fit(animate) {
  const g = geo.get(ROOT);
  if (g) fitted = frameBox(g.x - 8, g.y - 8, g.w + 16, g.h + 16, animate) || fitted;
}
function zoomTo(id) {
  for (let p = rt.parent.get(id); p; p = rt.parent.get(p)) rt.nodes.get(p).expanded = true;
  if (rt.nodes.get(id).kind === 'block') rt.nodes.get(id).expanded = true;
  if (diagramHidden()) showTab('diagram');
  renderTree();
  renderDiagram(true);
  const g = geo.get(id);
  if (!g?.shown) return;
  if (getComputedStyle(el.diagramPane).display === 'none') showTab('diagram');
  frameBox(g.x - 12, g.y - 12, g.w + 24, g.h + 24, true);
}

// ---------------------------------------------------------------------------
// Side panel

function renderInspector() {
  const ids = [...selection].filter((id) => rt.nodes.has(id));
  if (!ids.length || (ids.length === 1 && ids[0] === ROOT)) {
    el.inspector.innerHTML = `<h3>Board</h3><div id="st-insp-out"></div>
      <ul class="st-howto">
        <li><b>Select</b>: click a row or box; Ctrl/⌘+click adds; Shift+click a range; Shift+drag (or Lasso) on the diagram boxes a set.</li>
        <li><b>Find</b>: type references such as <i>C1–C8, Q1</i> and press Enter to select exactly those parts.</li>
        <li><b>Group</b>: <kbd>P</kbd> parallel (k of n), <kbd>S</kbd> series, <kbd>U</kbd> ungroup, <kbd>L</kbd> split a line, <kbd>M</kbd> move to a block.</li>
        <li><b>Move</b>: drag a row by ⠿, or a box or block header in the diagram, onto any block (on a touch screen, press and hold a box first; a swipe pans). In the tree, Alt+→ moves into the block above, Alt+← moves out, Alt+↑/↓ reorders.</li>
        <li><b>Zoom</b>: wheel or pinch; drag the background to pan; double-click a block to zoom to it; <kbd>0</kbd> fits.</li>
      </ul>`;
    return renderInspectorOut();
  }
  if (ids.length > 1) {
    const parts = topLevel(rt, ids).reduce((s, id) => s + ev.stats.get(id).pieces, 0);
    el.inspector.innerHTML = `<h3>${ids.length} selected</h3><p class="muted">${plural(parts, 'part')}. Group them, or drag them onto a block.</p>
      <div class="st-btns"><button type="button" class="primary" data-st="group-kofn">Group as parallel</button><button type="button" data-st="group-series">Group as series</button></div><div id="st-insp-out"></div>`;
    return renderInspectorOut();
  }
  const n = rt.nodes.get(ids[0]);
  if (n.kind === 'leaf') {
    const line = lineOf(n);
    el.inspector.innerHTML = `<h3>${esc(label(rt, n.id))}</h3>
      <p class="muted">${line ? `${esc(line.label)}; part line ${esc(line.comp.ref)}.` : 'Not in the parts list.'}</p>
      ${line && line.fit == null ? `<p class="st-note miss">Missing input under Parts: ${esc(line.result.errors.join(' '))} Left out of every total until it is filled in.</p>` : ''}
      ${guessedLine(line) ? '<p class="st-note guess">Has guessed values; check or confirm them under Parts.</p>' : ''}
      <div id="st-insp-out"></div>
      <div class="st-btns">${n.refs.length > 1 && !(line?.whole) ? '<button type="button" data-st="split">Split into single parts</button>' : ''}${line ? '<button type="button" data-st="open-part">Edit the part</button>' : ''}<button type="button" data-st="zoom">Show in diagram</button></div>`;
    return renderInspectorOut();
  }
  const m = members(rt, n.id);
  const allLeaves = n.children.every((c) => rt.nodes.get(c).kind === 'leaf');
  el.inspector.innerHTML = `<h3>${n.fixed ? esc(n.id === REST ? 'Everything else' : 'Board') : 'Block'}</h3>
    ${n.proposed ? `<div class="st-proposal"><p><b>Proposed by the netlist import:</b> ${esc(n.proposed)}. It counts in series until you accept it.</p>
      <div class="st-btns"><button type="button" class="primary" data-st="accept">Mark redundant</button><button type="button" data-st="dismiss">Dismiss</button></div></div>` : ''}
    ${n.fixed ? `<p class="muted">${n.id === REST ? 'Every part not placed in a block. Always in series.' : 'The board: its top level is always in series.'}</p>` : `
    <div class="st-field"><label for="st-name">Name</label><input id="st-name" data-k="name" type="text" value="${esc(n.name)}" autocomplete="off"></div>
    <div class="st-field"><label for="st-mode">How failures count</label><select id="st-mode" data-k="mode">
      <option value="series"${n.mode === 'series' ? ' selected' : ''}>Series: any failure fails it</option>
      <option value="kofn"${n.mode === 'kofn' ? ' selected' : ''}>Redundant: some may fail</option></select></div>`}
    ${n.mode === 'kofn' ? `
    <div class="st-field${n.need == null ? ' missing' : ''}" data-f="need"><label for="st-need">Must keep working <span class="st-tag">${n.need == null ? 'Missing' : ''}</span></label>
      <div class="st-kn"><button type="button" data-st="need-" aria-label="One fewer">−</button><input id="st-need" data-k="need" type="number" min="1" max="${m}" step="1" inputmode="numeric" value="${n.need ?? ''}"><button type="button" data-st="need+" aria-label="One more">+</button><span class="muted">of ${m} ${allLeaves ? 'parts' : 'members'}</span></div></div>
    <div class="st-field${n.shortPct == null ? ' missing' : n.inferred?.shortPct ? ' inferred' : ''}" data-f="shortPct"><label for="st-short">Failures that break it anyway (%) <span class="st-tag">${n.shortPct == null ? 'Missing' : n.inferred?.shortPct ? 'Guessed' : ''}</span></label>
      <input id="st-short" data-k="shortPct" type="number" min="0" max="100" step="any" inputmode="decimal" value="${n.shortPct ?? ''}">
      ${n.inferred?.shortPct ? `<p class="st-note guess" data-guess="1">Guessed ${esc(n.inferred.shortPct)}. <button type="button" class="link" data-st="confirm">Confirm</button></p>` : ''}
      <p class="help">For example shorts. Counts for the parts directly in this block and in series blocks inside it; a redundant block inside counts as one member.</p></div>` : ''}
    ${n.nets?.length ? `<p class="muted">Nets: ${esc(n.nets.join(', '))}</p>` : ''}
    <div id="st-insp-out"></div>
    <div class="st-btns">${n.fixed ? '' : '<button type="button" data-st="ungroup">Ungroup</button>'}<button type="button" data-st="zoom">Show in diagram</button></div>`;
  renderInspectorOut();
}

function renderInspectorOut() {
  const out = $('#st-insp-out', el.inspector);
  if (!out) return;
  const ids = [...selection].filter((id) => rt.nodes.has(id));
  const id = ids.length === 1 ? ids[0] : ids.length ? null : ROOT;
  if (!id) { out.innerHTML = ''; return; }
  const n = rt.nodes.get(id);
  const st = ev.stats.get(id);
  const rows = [[st.red ? 'Mission-average rate' : 'Failure rate', `${fmt(st.fit)} FIT`]];
  if (st.red) rows.push(['If all in series', `${fmt(st.sfit)} FIT`], ['Redundancy saves', `${fmt(st.sfit - st.fit)} FIT`]);
  if (id !== ROOT) rows.push(['Share of board', st.inRed ? 'inside a redundant block' : `${(st.share * 100).toFixed(1)}%`]);
  if (n.kind === 'block') rows.push(['Parts', String(st.pieces)]);
  const prob = n.kind === 'block' ? ev.prob.get(id) : [];
  const proposals = [...rt.nodes.values()].filter((x) => x.proposed).length;
  out.innerHTML = `<dl class="st-nums">${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>
    ${st.inRed && id !== ROOT ? '<p class="help">Shown on its own: inside a redundant block it does not add straight to the board total.</p>' : ''}
    ${prob.length ? `<ul class="st-problems">${prob.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>${n.mode === 'kofn' ? '<p class="help">Counts in series until these are fixed.</p>' : ''}` : ''}
    ${id === ROOT && st.missing ? `<p class="help">${plural(st.missing, 'line')} with missing input ${st.missing === 1 ? 'is' : 'are'} left out, so the total is a lower bound.</p>` : ''}
    ${proposals - (n.proposed ? 1 : 0) > 0 ? `<p class="st-next">${plural(proposals - (n.proposed ? 1 : 0), 'proposal')} ${n.proposed ? 'more ' : ''}left to review. <button type="button" data-st="next-proposal" aria-keyshortcuts="N">Next proposal (N)</button></p>` : ''}`;
}

function renderMoveTo() {
  reindex(rt);
  const sel = topLevel(rt, selection);
  const opts = ['<option value="">Move to… (M)</option>'];
  const walk = (id, depth) => {
    const n = rt.nodes.get(id);
    if (n.kind !== 'block' || sel.some((s) => s === id || isAncestor(rt, s, id))) return;
    opts.push(`<option value="${esc(id)}">${'  '.repeat(depth)}${esc(id === ROOT ? 'Board (top level)' : id === REST ? 'Everything else' : label(rt, id))}</option>`);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(ROOT, 0);
  el.moveto.innerHTML = opts.join('');
  el.moveto.disabled = !sel.length || sel.every((s) => rt.nodes.get(s).fixed);
}

function showTab(tab) {
  el.panes.dataset.tab = tab;
  el.section.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  if (tab === 'diagram' && diagramDirty && rt) renderDiagram(true);
  if (tab === 'diagram') {
    renderGoto();
    requestAnimationFrame(() => {
      if (!fitted) fit(false);
      // What was just picked in the tree is brought into view.
      const ids = [...selection].filter((id) => id !== ROOT && rt.nodes.has(id));
      if (ids.length) frameIds(ids, true);
    });
  }
}

// ---------------------------------------------------------------------------
// Wiring

export function mountStructure(section, context) {
  ctx = context;
  el = {
    section,
    tree: $('#st-tree', section),
    svg: $('#st-rbd', section),
    vp: $('#st-vp', section),
    lasso: $('#st-lasso', section),
    zoomlvl: $('#st-zoomlvl', section),
    names: $('#st-names', section),
    goto: $('#st-goto', section),
    inspector: $('#st-inspector', section),
    status: $('#st-status', section),
    moveto: $('#st-moveto', section),
    find: $('#st-find', section),
    panes: $('#st-panes', section),
    diagramPane: $('.st-diagram-pane', section),
    ghost: $('#st-ghost'),
  };
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      if (onScreen && drawingStale && rt) { drawingStale = false; render(true); }
    }, { rootMargin: '300px' }).observe(section);
  }

  el.tree.addEventListener('click', (e) => {
    const li = e.target.closest('[data-id]');
    if (!li || e.target.closest('.st-handle, [data-st]')) return;
    const id = li.dataset.id;
    const n = rt.nodes.get(id);
    if (e.target.closest('.st-twisty') && n.kind === 'block') { focusId = id; setExpanded(id, !n.expanded); return; }
    select(id, e);
  });
  el.tree.addEventListener('dblclick', (e) => {
    const li = e.target.closest('[data-id]');
    if (!li || e.target.closest('.st-twisty, .st-handle')) return;
    if (rt.nodes.get(li.dataset.id).kind === 'block') zoomTo(li.dataset.id);
  });
  el.tree.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.st-handle:not(.off)');
    if (h && e.button === 0) beginNodePointer(e, h.closest('[data-id]').dataset.id, false);
  });
  el.tree.addEventListener('keydown', (e) => {
    const i = visible.indexOf(focusId);
    const n = rt.nodes.get(focusId);
    if (e.altKey && e.key === 'ArrowLeft') outdent();
    else if (e.altKey && e.key === 'ArrowRight') indent();
    else if (e.altKey && e.key === 'ArrowUp') reorder(-1);
    else if (e.altKey && e.key === 'ArrowDown') reorder(1);
    else {
      switch (e.key) {
        case 'ArrowDown': if (i < visible.length - 1) setFocus(visible[i + 1], e.shiftKey); break;
        case 'ArrowUp': if (i > 0) setFocus(visible[i - 1], e.shiftKey); break;
        case 'Home': setFocus(visible[0]); break;
        case 'End': setFocus(visible[visible.length - 1]); break;
        case 'ArrowRight': if (n.kind === 'block' && n.children.length) { if (!n.expanded) setExpanded(focusId, true); else setFocus(visible[i + 1]); } break;
        case 'ArrowLeft': if (n.kind === 'block' && n.expanded && n.children.length) setExpanded(focusId, false); else if (rt.parent.get(focusId)) setFocus(rt.parent.get(focusId)); break;
        case ' ': if (selection.has(focusId)) selection.delete(focusId); else selection.add(focusId); anchor = focusId; render(); break;
        case 'Enter': selection = new Set([focusId]); anchor = focusId; render(); break;
        default: return;
      }
    }
    e.preventDefault();
  });

  // Diagram: pan, pinch, lasso, drag, zoom.
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = 0;
    new ResizeObserver(() => {
      const w = el.svg.clientWidth;
      const h = el.svg.clientHeight;
      if (w && h) pane = { w, h };
      if (w && Math.abs(w - lastW) > 40 && rt) { lastW = w; lastMarkup = ''; renderDiagram(); fitted = false; }
      if (!fitted && rt) fit(false);
    }).observe(el.svg);
  }
  el.svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(...svgPoint(e), Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015))); }, { passive: false });
  const pointers = new Map();
  let gesture = null;
  el.svg.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-drag]');
    // On touch a finger on a box pans and pinches like one on the background; a press and
    // hold picks the box up. A mouse or pen picks it up at once.
    const touch = e.pointerType === 'touch';
    if (handle && e.button === 0 && pointers.size === 0 && !touch && !lassoMode && !e.shiftKey) { beginNodePointer(e, handle.dataset.id, true); return; }
    try { el.svg.setPointerCapture?.(e.pointerId); } catch { /* the pointer may already be gone */ }
    pointers.set(e.pointerId, svgPoint(e));
    const pts = [...pointers.values()];
    if (pts.length === 2) {
      if (gesture?.hold) clearTimeout(gesture.hold);
      const [a, b] = pts;
      gesture = { type: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v0: { ...view } };
      return;
    }
    if (pts.length > 2) return;
    const p = svgPoint(e);
    gesture = lassoMode || e.shiftKey
      ? { type: 'lasso', p0: p, p1: p, add: e.shiftKey || e.ctrlKey || e.metaKey, handle: handle?.dataset.id }
      : { type: 'pan', p0: p, v0: { ...view }, moved: false, handle: touch ? handle?.dataset.id : undefined };
    if (gesture.handle && gesture.type === 'pan' && !rt.nodes.get(gesture.handle)?.fixed) {
      const g = gesture;
      const pid = e.pointerId;
      const start = [e.clientX, e.clientY];
      g.hold = setTimeout(() => {
        if (gesture !== g || g.moved || pointers.size !== 1) return;
        pointers.delete(pid);
        gesture = null;
        try { el.svg.releasePointerCapture?.(pid); } catch { /* already released */ }
        beginNodePointer({ preventDefault() {}, clientX: start[0], clientY: start[1], pointerId: pid }, g.handle, true);
        say('Picked up: drag it onto a block to move it.');
      }, 450);
    }
  });
  el.svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, svgPoint(e));
    if (!gesture) return;
    const p = svgPoint(e);
    if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const k = clamp(gesture.v0.k * d / gesture.d, 0.06, 4);
      const r = k / gesture.v0.k;
      view = { k, x: mid[0] - (gesture.mid[0] - gesture.v0.x) * r, y: mid[1] - (gesture.mid[1] - gesture.v0.y) * r };
      applyView();
    } else if (gesture.type === 'pan') {
      const dx = p[0] - gesture.p0[0];
      const dy = p[1] - gesture.p0[1];
      if (Math.hypot(dx, dy) > (gesture.handle ? 8 : 3)) gesture.moved = true;
      view = { ...gesture.v0, x: gesture.v0.x + dx, y: gesture.v0.y + dy };
      applyView();
    } else if (gesture.type === 'lasso') {
      gesture.p1 = p;
      const [x0, y0] = gesture.p0;
      el.lasso.style.display = 'inline';
      el.lasso.setAttribute('x', Math.min(x0, p[0]));
      el.lasso.setAttribute('y', Math.min(y0, p[1]));
      el.lasso.setAttribute('width', Math.abs(p[0] - x0));
      el.lasso.setAttribute('height', Math.abs(p[1] - y0));
    }
  });
  const finishLasso = (g) => {
    el.lasso.style.display = 'none';
    // A Shift-click on a box (no drag) still adds it to the selection.
    if (g.handle && Math.hypot(g.p1[0] - g.p0[0], g.p1[1] - g.p0[1]) < 4) { select(g.handle, { ctrlKey: true }); return; }
    const [ax, ay] = toLayout(g.p0);
    const [bx, by] = toLayout(g.p1);
    const [x0, x1, y0, y1] = [Math.min(ax, bx), Math.max(ax, bx), Math.min(ay, by), Math.max(ay, by)];
    const hits = [];
    const walk = (id) => {
      const n = rt.nodes.get(id);
      const gg = geo.get(id);
      if (!gg?.shown) return;
      if (!n.fixed && gg.x >= x0 && gg.y >= y0 && gg.x + gg.w <= x1 && gg.y + gg.h <= y1) { hits.push(id); return; }
      if (n.kind === 'block' && !gg.collapsed) n.children.forEach(walk);
    };
    walk(ROOT);
    if (!g.add) selection = new Set();
    hits.forEach((h) => selection.add(h));
    focusId = hits[0] ?? focusId;
    anchor = focusId;
    render();
    say(hits.length ? `Lasso selected ${plural(hits.length, 'item')}. P groups them as parallel, S as series.` : 'Nothing fully inside the lasso.');
  };
  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const g = gesture;
    if (g?.hold) clearTimeout(g.hold);
    if (pointers.size === 0) gesture = null; else if (g?.type === 'pinch') { gesture = null; return; }
    if (!g || e.type === 'pointercancel') return;
    if (g.type === 'pan' && !g.moved && g.handle) select(g.handle, { ctrlKey: e.ctrlKey || e.metaKey });
    else if (g.type === 'pan' && !g.moved) {
      const hit = deepestBlockAt(...toLayout(svgPoint(e)));
      if (hit && hit !== ROOT) select(hit, { ctrlKey: e.ctrlKey || e.metaKey }); else { selection = new Set(); render(); }
    } else if (g.type === 'lasso') finishLasso(g);
  };
  el.svg.addEventListener('pointerup', endPointer);
  el.svg.addEventListener('pointercancel', endPointer);
  el.svg.addEventListener('dblclick', (e) => {
    const id = nodeAt(...toLayout(svgPoint(e)));
    if (!id || id === ROOT) return fit(true);
    zoomTo(rt.nodes.get(id).kind === 'block' ? id : rt.parent.get(id));
  });
  el.svg.addEventListener('keydown', (e) => {
    const r = el.svg.getBoundingClientRect();
    const c = [r.width / 2, r.height / 2];
    const pan = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[e.key];
    if (e.key === '+' || e.key === '=') zoomAt(...c, 1.25);
    else if (e.key === '-' || e.key === '_') zoomAt(...c, 0.8);
    else if (e.key === '0') fit(true);
    else if (pan) { view = { ...view, x: view.x + pan[0], y: view.y + pan[1] }; applyView(); }
    else if (e.key === 'Enter' && selection.size) zoomTo([...selection][0]);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  // Side panel fields: typing updates the block without redrawing the panel.
  el.inspector.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k || k === 'mode') return;
    const n = rt.nodes.get([...selection][0]);
    if (k === 'name') n.name = e.target.value;
    else {
      n[k] = numOrNull(e.target.value);
      if (k === 'shortPct' && n.inferred?.shortPct) { n.inferred = {}; $('[data-guess]', el.inspector)?.remove(); }
      const f = e.target.closest('.st-field');
      f.classList.toggle('missing', n[k] == null);
      f.classList.remove('inferred');
      $('.st-tag', f).textContent = n[k] == null ? 'Missing' : '';
    }
    commit();
  });
  el.inspector.addEventListener('change', (e) => {
    if (e.target.dataset.k !== 'mode') return;
    const n = rt.nodes.get([...selection][0]);
    n.mode = e.target.value;
    n.proposed = null;
    if (n.mode === 'kofn' && n.shortPct == null) suggestShort(n.id);
    inspectorKey = '';
    commit();
    $('#st-mode', el.inspector)?.focus();
  });

  section.addEventListener('click', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (tab) return showTab(tab.dataset.tab);
    const btn = e.target.closest('[data-st]');
    if (!btn) return;
    const n = rt.nodes.get([...selection][0]);
    const r = el.svg.getBoundingClientRect();
    switch (btn.dataset.st) {
      case 'group-kofn': return group('kofn');
      case 'group-series': return group('series');
      case 'ungroup': return ungroup();
      case 'split': return split();
      case 'accept':
        n.proposed = null; n.mode = 'kofn'; n.need = null;
        suggestShort(n.id);
        inspectorKey = '';
        commit();
        say('Marked redundant. Say how many must keep working.');
        return $('#st-need', el.inspector)?.focus();
      case 'dismiss': {
        const next = proposalAfter(n.id);
        const name = label(rt, n.id);
        // Parallel strings go back to parts in series, not to loose string blocks.
        ungroupNodes(rt, n.children.filter((c) => rt.nodes.get(c).kind === 'block' && rt.nodes.get(c).mode === 'series'));
        ungroupNodes(rt, [n.id]);
        commit(next ? [next] : []);
        focusRow(next ?? focusId);
        return say(`Dismissed ${name}: its parts count in series again.${next ? ` Next: ${label(rt, next)}.` : ' No proposals left to review.'}`);
      }
      case 'next-proposal': return nextProposal();
      case 'undo': return undo();
      case 'multi':
        multi = !multi;
        btn.setAttribute('aria-pressed', String(multi));
        return say(multi ? 'Select several: each tap adds an item or takes it away. Tap the button again to stop.' : 'Taps select one item again.');
      case 'confirm': n.inferred = {}; inspectorKey = ''; commit(); return say('Confirmed.');
      case 'need-': case 'need+':
        n.need = clamp((n.need ?? members(rt, n.id)) + (btn.dataset.st === 'need+' ? 1 : -1), 1, members(rt, n.id));
        inspectorKey = '';
        commit();
        return $('#st-need', el.inspector)?.focus();
      case 'open-part': return ctx.openPart(rt.lines.get(n.lineId)?.comp.id);
      case 'zoom': return zoomTo(n.kind === 'leaf' ? rt.parent.get(n.id) : n.id);
      case 'fit': return fit(true);
      case 'zin': return zoomAt(r.width / 2, r.height / 2, 1.25);
      case 'zout': return zoomAt(r.width / 2, r.height / 2, 0.8);
      case 'lasso':
        lassoMode = !lassoMode;
        btn.setAttribute('aria-pressed', String(lassoMode));
        return say(lassoMode ? 'Lasso on: drag on the diagram background to select.' : 'Lasso off: dragging the background pans.');
      case 'select-matches': return selectMatches();
      default:
    }
  });
  // Shortcuts work while focus is inside the structure editor, outside text fields.
  section.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'p') group('kofn');
    else if (k === 's') group('series');
    else if (k === 'u') ungroup();
    else if (k === 'l') split();
    else if (k === 'm') { if (!el.moveto.disabled) el.moveto.focus(); }
    else if (k === 'n') nextProposal();
    else if (e.key === 'Escape') { selection = new Set(); render(); }
    else return;
    e.preventDefault();
  });
  el.moveto.addEventListener('change', (e) => { const t = e.target.value; if (t) move([...selection], t); });
  el.goto?.addEventListener('change', (e) => {
    const t = e.target.value;
    e.target.value = '';
    if (!t || !rt.nodes.has(t)) return;
    selection = new Set([t]);
    focusId = t;
    anchor = t;
    zoomTo(t);
    render();
  });
  el.find.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    match = new Set();
    if (q) {
      const want = new Set(expandRefs(q).map((s) => s.toUpperCase()));
      for (const n of rt.nodes.values()) {
        if (n.kind !== 'leaf' || !n.lineId) continue;
        const line = rt.lines.get(n.lineId);
        if (n.refs.some((r) => want.has(r.toUpperCase())) || line.label.toLowerCase().includes(q.toLowerCase()) || compressRefs(n.refs).toUpperCase().includes(q.toUpperCase())) match.add(n.id);
      }
    }
    matchIn = new Set();
    for (const id of match) for (let p = rt.parent.get(id); p; p = rt.parent.get(p)) matchIn.add(p);
    const parts = [...match].reduce((s, id) => s + pieces(rt, id), 0);
    say(q ? (match.size ? `${plural(parts, 'part matches', 'parts match')}; Enter selects them.` : 'No parts match.') : '');
    renderTree();
    paintMarks();
  });
  el.find.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); selectMatches(); } });
  say('Try: type C1–C3 in Find and press Enter, then P. Or drag a ⠿ handle onto a block.');
}

// A new board (import, New, example) is framed whole the next time the diagram is drawn,
// and the structure edits of the previous board cannot be undone onto it.
export function resetStructureView() {
  fitted = false;
  history = [];
}

// For tests and the page: the current evaluation.
export const currentStructure = () => ({ rt, ev });
