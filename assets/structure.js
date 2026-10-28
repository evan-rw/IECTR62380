// Reliability structure: a tree of series and k-of-n blocks over the board's
// parts, as edited in the structure tree and the block diagram.
//
// The board is a series block. Parts not placed in any block sit in
// "Everything else", which is always in series. A k-of-n block survives while
// at least `need` of its members work; a member is a single part or a block
// inside it. A share `shortPct` of the failures of the parts in its scope (the
// parts directly in it and in series blocks inside it) breaks it at once, the
// rest are tolerated; a redundant block inside counts as one member with its
// own share. Each part fails once: with probability shortPct/100 that failure
// is critical, otherwise it only takes out its member (a capacitor that has
// failed open cannot short afterwards). Redundant blocks have no constant failure rate, so the board is
// evaluated over the mission time T: survival R(T), the mission-average rate
// −ln R(T)/T, and the mean time to failure ∫R(t)dt. Survival is carried as
// ln R so deeply nested redundancy does not round to zero. Pure functions.
//
// Saved form (board.structure): { kind: 'block', id, name, mode: 'series' |
// 'kofn', need, shortPct, inferred, proposed, nets, expanded, children } with
// leaves { kind: 'leaf', refs: 'C1–C8' }. Leaves are resolved to the parts
// list by designator each time the structure is built.

import { expandRefs, compressRefs } from './netlist.js';

export const ROOT = 'board';
export const REST = 'rest';
const HOURS_PER_YEAR = 8760;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Probability helpers

// Distribution of the number of failed members, member i failing with p[i].
function failureCounts(p) {
  let dist = [1];
  for (const pi of p) {
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((d, k) => {
      next[k] += d * (1 - pi);
      next[k + 1] += d * pi;
    });
    dist = next;
  }
  return dist;
}

// Probability that at most `allowed` members fail.
export function atMostFailing(p, allowed) {
  return failureCounts(p).slice(0, allowed + 1).reduce((s, d) => s + d, 0);
}

// Probability that more than `allowed` fail, summed directly so tiny values keep their digits.
// Capped at 1: when every member has almost surely failed, rounding can push the sum above it.
function moreThan(p, allowed) {
  return Math.min(1, failureCounts(p).slice(allowed + 1).reduce((s, d) => s + d, 0));
}

// One part over [0, t] with a critical share c of its failures: ln P(no critical
// failure), and ln P(still working | no critical failure).
export function partOdds(lambda, t, c) {
  const failed = -Math.expm1(-lambda * t);
  const noCritical = Math.log1p(-c * failed);
  return { noCritical, working: -lambda * t - noCritical };
}

// Survival of one flat k-of-n group of parts at time t (hours); rates in FIT.
export function groupSurvival(fits, need, shortPct, t) {
  const c = shortPct / 100;
  const odds = fits.map((f) => partOdds(f * 1e-9, t, c));
  const p = odds.map((o) => -Math.expm1(o.working));
  return Math.exp(odds.reduce((s, o) => s + o.noCritical, 0)) * atMostFailing(p, fits.length - need);
}

// ∫ R(t) dt from 0 to ∞, by Simpson's rule up to where R has decayed.
export function meanTimeToFailure(R) {
  let tMax = 1e4;
  while (R(tMax) > 1e-12 && tMax < 1e15) tMax *= 2;
  if (R(tMax) > 1e-12) return Infinity;
  // Adaptive Simpson: each R(t) walks the whole tree, so sample only where the curve
  // needs it (a few hundred points against a fixed 20 000). Sixteen panels to start, so a
  // coarse first estimate cannot hide the shape; each panel is refined to a relative 1e-9.
  const panels = 16;
  const h = tMax / panels;
  const f = Array.from({ length: 2 * panels + 1 }, (_, i) => R((i * h) / 2));
  let coarse = 0;
  for (let i = 0; i < panels; i++) coarse += (h / 6) * (f[2 * i] + 4 * f[2 * i + 1] + f[2 * i + 2]);
  const eps = 1e-9 * coarse / panels;
  const refine = (a, fa, m, fm, b, fb, whole, tol, depth) => {
    const lm = (a + m) / 2;
    const rm = (m + b) / 2;
    const flm = R(lm);
    const frm = R(rm);
    const left = ((m - a) / 6) * (fa + 4 * flm + fm);
    const right = ((b - m) / 6) * (fm + 4 * frm + fb);
    const diff = left + right - whole;
    if (depth <= 0 || Math.abs(diff) <= 15 * tol) return left + right + diff / 15;
    return refine(a, fa, lm, flm, m, fm, left, tol / 2, depth - 1) + refine(m, fm, rm, frm, b, fb, right, tol / 2, depth - 1);
  };
  let sum = 0;
  for (let i = 0; i < panels; i++) {
    const a = i * h;
    const whole = (h / 6) * (f[2 * i] + 4 * f[2 * i + 1] + f[2 * i + 2]);
    sum += refine(a, f[2 * i], a + h / 2, f[2 * i + 1], a + h, f[2 * i + 2], whole, eps, 40);
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Building the runtime tree from the saved form and the parts list

let idSeq = 0;
const newBlockId = (nodes) => {
  let id;
  do id = `b${Date.now().toString(36)}${(idSeq++).toString(36)}`; while (nodes.has(id));
  return id;
};

// items: [{ comp, result }] from computeBoard; describe(comp) labels a line.
export function buildStructure(saved, items, describe = (comp) => comp.ref) {
  const lines = new Map();
  const byRef = new Map();
  for (const { comp, result } of items) {
    const refs = expandRefs(comp.ref);
    // A line whose refs do not name each part once can only be placed whole.
    const whole = refs.length !== result.qty || new Set(refs).size !== refs.length;
    const line = { id: comp.id, refs: whole ? [comp.ref] : refs, whole, qty: result.qty, fit: result.complete ? result.fit : null, label: describe(comp), comp, result };
    lines.set(comp.id, line);
    for (const r of line.refs) if (!byRef.has(r)) byRef.set(r, comp.id);
  }

  const rt = { nodes: new Map(), lines, parent: new Map(), buildProblems: new Map() };
  // Claims are per line, so a designator on two lines is not taken from both.
  const claimed = new Set();
  const claim = (lineId, r) => `${lineId}\u0000${r}`;

  const addLeaves = (block, refsText) => {
    const text = String(refsText ?? '').trim();
    const wanted = byRef.has(text) && lines.get(byRef.get(text)).whole ? [text] : expandRefs(text);
    const perLine = new Map();
    const unknown = [];
    const twice = [];
    for (const r of wanted) {
      if (!byRef.has(r)) unknown.push(r);
      else if (claimed.has(claim(byRef.get(r), r))) twice.push(r);
      else {
        const lineId = byRef.get(r);
        claimed.add(claim(lineId, r));
        perLine.set(lineId, [...(perLine.get(lineId) ?? []), r]);
      }
    }
    for (const [lineId, refs] of perLine) addLeaf(block, lineId, refs);
    if (unknown.length) addLeaf(block, null, unknown);
    if (twice.length) {
      const list = rt.buildProblems.get(block.id) ?? [];
      list.push(`Also placed elsewhere, so left out here: ${compressRefs(twice)}.`);
      rt.buildProblems.set(block.id, list);
    }
  };
  const addLeaf = (block, lineId, refs) => {
    let id = `${block.id}|${compressRefs(refs)}`;
    while (rt.nodes.has(id)) id += "'";
    rt.nodes.set(id, { id, kind: 'leaf', lineId, refs });
    block.children.push(id);
  };
  // A saved block without an id (a fresh import) gets one from its place in the build, so
  // every rebuild gives it the same id and a selection survives until the first save.
  const taken = new Set();
  const collect = (b) => {
    if (typeof b?.id === 'string') taken.add(b.id);
    if (Array.isArray(b?.children)) b.children.forEach(collect);
  };
  collect(saved);
  let seq = 0;
  const builtId = () => {
    let id;
    do id = `u${++seq}`; while (taken.has(id) || rt.nodes.has(id));
    return id;
  };
  const addBlock = (b, forcedId) => {
    const id = forcedId ?? (typeof b.id === 'string' && b.id && !rt.nodes.has(b.id) && b.id !== REST ? b.id : typeof b.id === 'string' && b.id ? newBlockId(rt.nodes) : builtId());
    const node = {
      id, kind: 'block',
      name: typeof b.name === 'string' ? b.name : '',
      mode: b.mode === 'kofn' ? 'kofn' : 'series',
      need: isNum(b.need) ? b.need : null,
      shortPct: isNum(b.shortPct) ? b.shortPct : null,
      inferred: typeof b.inferred?.shortPct === 'string' ? { shortPct: b.inferred.shortPct } : {},
      proposed: typeof b.proposed === 'string' ? b.proposed : null,
      nets: Array.isArray(b.nets) ? b.nets.map(String) : [],
      expanded: b.expanded !== false,
      children: [],
    };
    rt.nodes.set(id, node);
    for (const c of Array.isArray(b.children) ? b.children : []) {
      if (c?.kind === 'leaf') addLeaves(node, c.refs);
      else if (c && typeof c === 'object') node.children.push(addBlock(c));
    }
    return id;
  };

  const root = saved && typeof saved === 'object' ? saved : {};
  addBlock({ ...root, name: 'Board', mode: 'series' }, ROOT);
  const board = rt.nodes.get(ROOT);
  board.fixed = true;

  // Everything not placed: one leaf per line, always in series.
  const rest = { id: REST, kind: 'block', name: 'Everything else', mode: 'series', need: null, shortPct: null, inferred: {}, proposed: null, nets: [], expanded: root.restExpanded === true, children: [], fixed: true };
  rt.nodes.set(REST, rest);
  for (const line of lines.values()) {
    const refs = line.refs.filter((r) => !claimed.has(claim(line.id, r)));
    if (refs.length) addLeaf(rest, line.id, refs);
  }
  board.children.unshift(REST);
  reindex(rt);
  return rt;
}

export function serializeStructure(rt) {
  const ser = (id) => {
    const n = rt.nodes.get(id);
    if (n.kind === 'leaf') return { kind: 'leaf', refs: n.lineId && rt.lines.get(n.lineId)?.whole ? n.refs[0] : compressRefs(n.refs) };
    return {
      kind: 'block', id: n.id, name: n.name, mode: n.mode, need: n.need, shortPct: n.shortPct,
      ...(n.inferred?.shortPct ? { inferred: { shortPct: n.inferred.shortPct } } : {}),
      ...(n.proposed ? { proposed: n.proposed } : {}),
      ...(n.nets?.length ? { nets: n.nets } : {}),
      ...(n.expanded === false ? { expanded: false } : {}),
      children: n.children.filter((c) => c !== REST).map(ser),
    };
  };
  const out = ser(ROOT);
  delete out.name;
  delete out.mode;
  delete out.need;
  delete out.shortPct;
  if (rt.nodes.get(REST)?.expanded) out.restExpanded = true;
  return out;
}

// Version-1 boards kept a flat list of groups under the board.
export function migrateGroups(groups) {
  return {
    kind: 'block',
    id: ROOT,
    children: (Array.isArray(groups) ? groups : []).map((g) => ({
      kind: 'block',
      name: `${g.refs ?? ''} ${g.mode === 'redundant' ? 'in parallel' : 'group'}`.trim(),
      mode: g.mode === 'redundant' ? 'kofn' : 'series',
      need: isNum(g.need) ? g.need : null,
      shortPct: isNum(g.shortPct) ? g.shortPct : null,
      ...(typeof g.inferred?.shortPct === 'string' ? { inferred: { shortPct: g.inferred.shortPct } } : {}),
      ...(typeof g.proposed === 'string' ? { proposed: g.proposed } : {}),
      ...(Array.isArray(g.nets) ? { nets: g.nets } : {}),
      children: [{ kind: 'leaf', refs: g.refs ?? '' }],
    })),
  };
}

// ---------------------------------------------------------------------------
// Tree helpers

export function reindex(rt) {
  rt.parent = new Map();
  for (const n of rt.nodes.values()) if (n.kind === 'block') for (const c of n.children) rt.parent.set(c, n.id);
}
export const isAncestor = (rt, a, b) => {
  for (let p = rt.parent.get(b); p; p = rt.parent.get(p)) if (p === a) return true;
  return false;
};
export const topLevel = (rt, ids) => {
  const s = [...ids].filter((id) => rt.nodes.has(id));
  return s.filter((id) => !s.some((o) => o !== id && isAncestor(rt, o, id)));
};
const leafPieces = (rt, n) => (n.lineId && rt.lines.get(n.lineId)?.whole ? rt.lines.get(n.lineId).qty : n.refs.length);
export const pieces = (rt, id) => {
  const n = rt.nodes.get(id);
  return n.kind === 'leaf' ? leafPieces(rt, n) : n.children.reduce((s, c) => s + pieces(rt, c), 0);
};
// Members of a k-of-n block: each part in a leaf, and each block, counts once.
export const members = (rt, id) => rt.nodes.get(id).children.reduce((s, c) => s + (rt.nodes.get(c).kind === 'leaf' ? leafPieces(rt, rt.nodes.get(c)) : 1), 0);
export const label = (rt, id) => {
  const n = rt.nodes.get(id);
  if (n.kind === 'leaf') return n.lineId && rt.lines.get(n.lineId)?.whole ? n.refs[0] : compressRefs(n.refs);
  return n.name || (n.mode === 'kofn' ? 'Redundant block' : 'Series block');
};

// ---------------------------------------------------------------------------
// Evaluation

function blockProblems(rt, n, T) {
  const p = [...(rt.buildProblems.get(n.id) ?? [])];
  const unknown = n.children.map((c) => rt.nodes.get(c)).filter((c) => c.kind === 'leaf' && !c.lineId).flatMap((c) => c.refs);
  if (unknown.length) p.push(`Not in the parts list: ${compressRefs(unknown)}.`);
  if (!n.fixed && !n.children.length) p.push('Empty block.');
  if (n.mode !== 'kofn') return p;
  const m = members(rt, n.id);
  if (m < 2) p.push('A redundant block needs at least two members.');
  if (n.need == null) p.push('Missing: how many must keep working.');
  else if (!Number.isInteger(n.need) || n.need < 1 || n.need > m) p.push(`Must keep working has to be a whole number from 1 to ${m}.`);
  if (n.shortPct == null) p.push('Missing: share of failures that break it anyway.');
  else if (n.shortPct < 0 || n.shortPct > 100) p.push('The share of failures must be between 0 and 100%.');
  const missing = [];
  const walk = (id) => {
    const c = rt.nodes.get(id);
    if (c.kind === 'leaf') { if (c.lineId && rt.lines.get(c.lineId).fit == null) missing.push(...c.refs); } else c.children.forEach(walk);
  };
  walk(n.id);
  if (missing.length) p.push(`Members still need input: ${compressRefs(missing)}.`);
  if (T <= 0) p.push('Set the mission length to evaluate redundancy.');
  return p;
}

export function evaluateStructure(rt, years) {
  reindex(rt);
  const T = (isNum(years) ? years : 0) * HOURS_PER_YEAR;
  const prob = new Map();
  const red = new Set();
  for (const n of rt.nodes.values()) {
    if (n.kind !== 'block') continue;
    const p = blockProblems(rt, n, T);
    prob.set(n.id, p);
    if (n.mode === 'kofn' && !p.length) red.add(n.id);
  }
  const lam = (n) => (n.lineId && rt.lines.get(n.lineId).fit != null ? rt.lines.get(n.lineId).fit * 1e-9 : 0);
  // ln P(no critical failure) over the parts in a redundant block's scope with share c.
  const lnNoCritical = (id, t, c) => rt.nodes.get(id).children.reduce((s, cid) => {
    const k = rt.nodes.get(cid);
    if (k.kind === 'leaf') return s + leafPieces(rt, k) * partOdds(lam(k), t, c).noCritical;
    return s + (red.has(cid) ? 0 : lnNoCritical(cid, t, c));
  }, 0);

  // ln R(t) of a node. Inside a redundant block with share c, the parts in its
  // scope are taken given that none has failed critically (c = 0 elsewhere).
  const lnR = (id, t, c = 0) => {
    const n = rt.nodes.get(id);
    if (n.kind === 'leaf') return leafPieces(rt, n) * partOdds(lam(n), t, c).working;
    if (!red.has(id)) return n.children.reduce((sum, k) => sum + lnR(k, t, c), 0);
    const own = n.shortPct / 100;
    const q = [];
    for (const cid of n.children) {
      const k = rt.nodes.get(cid);
      if (k.kind === 'leaf') {
        const qi = -Math.expm1(partOdds(lam(k), t, own).working);
        for (let i = 0; i < leafPieces(rt, k); i++) q.push(qi);
      } else q.push(-Math.expm1(lnR(cid, t, own)));
    }
    return lnNoCritical(id, t, own) + Math.log1p(-moreThan(q, q.length - n.need));
  };

  const guessedLine = (line) => Object.keys(line.comp.inferred ?? {}).length > 0;
  const stats = new Map();
  const walk = (id, inRed) => {
    const n = rt.nodes.get(id);
    let st;
    if (n.kind === 'leaf') {
      const line = n.lineId ? rt.lines.get(n.lineId) : null;
      const sfit = line && line.fit != null ? line.fit * leafPieces(rt, n) : 0;
      st = { fit: sfit, sfit, missing: line && line.fit == null ? 1 : 0, unknown: line ? 0 : 1, guessed: line && line.fit != null && guessedLine(line) ? 1 : 0, red: false, pieces: leafPieces(rt, n) };
    } else {
      const kids = n.children.map((c) => walk(c, inRed || red.has(id)));
      const sum = (k) => kids.reduce((s, x) => s + x[k], 0);
      const hasRed = red.has(id) || kids.some((k) => k.red);
      const sfit = sum('sfit');
      st = {
        fit: hasRed && T > 0 ? (-lnR(id, T) / T) * 1e9 : sfit,
        sfit,
        missing: sum('missing'),
        unknown: sum('unknown'),
        guessed: sum('guessed') + (n.mode === 'kofn' && n.inferred?.shortPct ? 1 : 0),
        red: hasRed,
        pieces: sum('pieces'),
      };
    }
    st.inRed = inRed;
    stats.set(id, st);
    return st;
  };
  const board = walk(ROOT, false);
  for (const st of stats.values()) st.share = !st.inRed && board.fit > 0 ? st.fit / board.fit : 0;
  const survival = (t) => Math.exp(lnR(ROOT, t));
  return {
    T, stats, prob, red, board, survival,
    redundancy: red.size > 0,
    mttfHours: red.size ? meanTimeToFailure(survival) : (board.sfit > 0 ? 1e9 / board.sfit : Infinity),
  };
}

// ---------------------------------------------------------------------------
// Editing. Each operation changes rt in place; the caller serializes it and
// builds it again, which puts unplaced parts back in "Everything else".

const detach = (rt, id) => {
  const p = rt.parent.get(id);
  if (p) {
    const c = rt.nodes.get(p).children;
    c.splice(c.indexOf(id), 1);
  }
  rt.parent.delete(id);
};

// Put a leaf into a block, merging it with a leaf of the same line already there.
const mergeInto = (rt, target, leafId) => {
  const t = rt.nodes.get(target);
  const n = rt.nodes.get(leafId);
  const twin = t.children.map((c) => rt.nodes.get(c)).find((c) => c.kind === 'leaf' && c.lineId && c.lineId === n.lineId && c.id !== leafId && !rt.lines.get(c.lineId).whole);
  if (twin) {
    twin.refs = [...new Set([...twin.refs, ...n.refs])];
    rt.nodes.delete(leafId);
    return twin.id;
  }
  t.children.push(leafId);
  return leafId;
};

// Remove blocks left empty by an edit.
export function cleanup(rt) {
  let again = true;
  while (again) {
    again = false;
    reindex(rt);
    for (const n of [...rt.nodes.values()]) {
      if (n.kind === 'block' && !n.fixed && !n.children.length) {
        detach(rt, n.id);
        rt.nodes.delete(n.id);
        again = true;
      }
    }
  }
}

// Group items into a new block placed in the deepest block that holds them all.
export function groupNodes(rt, ids, mode) {
  reindex(rt);
  const list = topLevel(rt, ids).filter((id) => !rt.nodes.get(id).fixed);
  if (!list.length) return null;
  const chain = (id) => {
    const c = [];
    for (let p = rt.parent.get(id); p; p = rt.parent.get(p)) c.unshift(p);
    return c;
  };
  const chains = list.map(chain);
  let lca = ROOT;
  for (let i = 0; chains.every((c) => c[i] && c[i] === chains[0][i]); i++) lca = chains[0][i];
  const host = lca === REST ? ROOT : lca;
  const hc = rt.nodes.get(host).children;
  const at = hc.findIndex((c) => c === list[0] || isAncestor(rt, c, list[0]));
  const allLeaves = list.every((id) => rt.nodes.get(id).kind === 'leaf');
  const name = allLeaves
    ? `${compressRefs(list.flatMap((id) => rt.nodes.get(id).refs))} ${mode === 'kofn' ? 'in parallel' : 'in series'}`
    : mode === 'kofn' ? 'Redundant block' : 'Series block';
  const id = newBlockId(rt.nodes);
  rt.nodes.set(id, { id, kind: 'block', name, mode, need: null, shortPct: null, inferred: {}, proposed: null, nets: [], expanded: true, children: [] });
  if (at >= 0 && host !== REST) hc.splice(at, 0, id); else rt.nodes.get(ROOT).children.push(id);
  for (const m of list) {
    detach(rt, m);
    rt.nodes.get(id).children.push(m);
  }
  cleanup(rt);
  return id;
}

// Dissolve blocks: their contents take their place; leaves at the top level become unplaced.
export function ungroupNodes(rt, ids) {
  reindex(rt);
  const list = topLevel(rt, ids).filter((id) => rt.nodes.get(id)?.kind === 'block' && !rt.nodes.get(id).fixed);
  const freed = [];
  for (const id of list) {
    const n = rt.nodes.get(id);
    const p = rt.parent.get(id);
    const host = rt.nodes.get(p);
    const at = host.children.indexOf(id);
    const kids = [...n.children];
    if (p === ROOT) {
      const blocks = kids.filter((c) => rt.nodes.get(c).kind === 'block');
      host.children.splice(at, 1, ...blocks);
      freed.push(...blocks);
      for (const c of kids) if (rt.nodes.get(c).kind === 'leaf') freed.push(mergeInto(rt, REST, c));
    } else {
      host.children.splice(at, 1, ...kids);
      freed.push(...kids);
    }
    rt.nodes.delete(id);
  }
  cleanup(rt);
  return [...new Set(freed)].filter((c) => rt.nodes.has(c));
}

// Move items into a block. Leaves dropped on the board go to "Everything else".
export function moveNodes(rt, ids, target) {
  reindex(rt);
  if (!rt.nodes.get(target) || rt.nodes.get(target).kind !== 'block') return 0;
  const list = topLevel(rt, ids).filter((id) => !rt.nodes.get(id).fixed && id !== target && !isAncestor(rt, id, target));
  let moved = 0;
  for (const id of list) {
    const n = rt.nodes.get(id);
    let t = target;
    if (t === ROOT && n.kind === 'leaf') t = REST;
    if (t === REST && n.kind === 'block') t = ROOT;
    if (rt.parent.get(id) === t) continue;
    detach(rt, id);
    if (n.kind === 'leaf') mergeInto(rt, t, id); else rt.nodes.get(t).children.push(id);
    reindex(rt);
    moved++;
  }
  cleanup(rt);
  if (moved) rt.nodes.get(target).expanded = true;
  return moved;
}

// Split leaves into one leaf per part, so parts can be placed separately.
export function splitLeaves(rt, ids) {
  reindex(rt);
  const made = [];
  for (const id of ids) {
    const n = rt.nodes.get(id);
    if (n?.kind !== 'leaf' || n.refs.length < 2 || (n.lineId && rt.lines.get(n.lineId).whole)) continue;
    const p = rt.nodes.get(rt.parent.get(id));
    const singles = n.refs.map((r, i) => {
      const sid = `${p.id}|${r}|${i}`;
      rt.nodes.set(sid, { id: sid, kind: 'leaf', lineId: n.lineId, refs: [r] });
      return sid;
    });
    p.children.splice(p.children.indexOf(id), 1, ...singles);
    rt.nodes.delete(id);
    p.expanded = true;
    made.push(...singles);
  }
  return made;
}

export function reorderNode(rt, id, dir) {
  reindex(rt);
  const p = rt.parent.get(id);
  if (!p) return false;
  const c = rt.nodes.get(p).children;
  const i = c.indexOf(id);
  const j = i + dir;
  if (j < 0 || j >= c.length || c[j] === REST || id === REST) return false;
  [c[i], c[j]] = [c[j], c[i]];
  return true;
}

// Leaves matching a reference list ("C1–C8, Q1") or, failing that, a part
// description. With references, leaves are split so that exactly those parts
// are selected. Returns the selected leaf ids, the number of parts and any
// references that are not on the board.
export function selectRefs(rt, query) {
  reindex(rt);
  const q = String(query ?? '').trim();
  if (!q) return { ids: [], count: 0, unknown: [] };
  const leaves = [...rt.nodes.values()].filter((n) => n.kind === 'leaf' && n.lineId);
  const want = new Set(expandRefs(q).map((r) => r.toUpperCase()));
  const hits = leaves.filter((n) => n.refs.some((r) => want.has(r.toUpperCase())));
  if (!hits.length) {
    const lq = q.toLowerCase();
    const byText = leaves.filter((n) => rt.lines.get(n.lineId).label.toLowerCase().includes(lq));
    return { ids: byText.map((n) => n.id), count: byText.reduce((s, n) => s + leafPieces(rt, n), 0), unknown: [] };
  }
  const known = new Set(leaves.flatMap((n) => n.refs.map((r) => r.toUpperCase())));
  const picked = [];
  for (const n of hits) {
    const hit = n.refs.filter((r) => want.has(r.toUpperCase()));
    if (hit.length === n.refs.length || rt.lines.get(n.lineId).whole) { picked.push(n.id); continue; }
    n.refs = n.refs.filter((r) => !hit.includes(r));
    const p = rt.nodes.get(rt.parent.get(n.id));
    const id = `${p.id}|${compressRefs(hit)}|sel`;
    rt.nodes.set(id, { id, kind: 'leaf', lineId: n.lineId, refs: hit });
    p.children.splice(p.children.indexOf(n.id) + 1, 0, id);
    picked.push(id);
  }
  reindex(rt);
  return { ids: picked, count: picked.reduce((s, id) => s + leafPieces(rt, rt.nodes.get(id)), 0), unknown: [...want].filter((r) => !known.has(r)) };
}

// A list of refs cut to a length, at a comma so that no ref is cut in two.
const clip = (refs, max) => (refs.length <= max ? refs : refs.slice(0, refs.lastIndexOf(',', max)));

// Keep only known keys and types from a saved structure read from storage or a file.
export function sanitizeStructure(raw) {
  const clean = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > 32) return null;
    if (n.kind === 'leaf') return { kind: 'leaf', refs: clip(String(n.refs ?? ''), 200000) };
    return {
      kind: 'block',
      ...(typeof n.id === 'string' && n.id ? { id: n.id.slice(0, 80) } : {}),
      name: typeof n.name === 'string' ? n.name.slice(0, 200) : '',
      mode: n.mode === 'kofn' ? 'kofn' : 'series',
      need: isNum(n.need) ? n.need : null,
      shortPct: isNum(n.shortPct) ? n.shortPct : null,
      ...(typeof n.inferred?.shortPct === 'string' ? { inferred: { shortPct: n.inferred.shortPct.slice(0, 300) } } : {}),
      ...(typeof n.proposed === 'string' ? { proposed: n.proposed.slice(0, 300) } : {}),
      ...(Array.isArray(n.nets) ? { nets: n.nets.slice(0, 50).map((x) => String(x).slice(0, 80)) } : {}),
      ...(n.expanded === false ? { expanded: false } : {}),
      children: (Array.isArray(n.children) ? n.children.slice(0, 5000) : []).map((c) => clean(c, depth + 1)).filter(Boolean),
    };
  };
  const root = clean(raw, 0) ?? { kind: 'block', children: [] };
  return { kind: 'block', id: ROOT, children: root.children, ...(raw?.restExpanded === true ? { restExpanded: true } : {}) };
}
