// Aluminium electrolytic capacitor life: the makers' wear-out rules for wet,
// polymer and hybrid capacitors, worked out over the mission profile. End of
// life is a drift limit (capacitance, ESR), so a line's wear-out counts as a
// failure only where its circuit role makes drift matter: each line says so,
// or follows the board's default. Pure functions; times in hours.
//
// The life inputs live on the part line (part.life), so they travel with it
// when it is split, copied or merged with a BOM. Values the line's text can
// give (kind, rated life and temperature) are guessed from it whenever the
// user has not entered them, so a BOM merged later improves the guesses.

import { LIFE_RULES, POLYMER_SLOW, LIFE_LIMITS, WEAROUT } from './tablescaplife.js';

const HOURS_PER_YEAR = 8760;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const LIFE_KEYS = ['tech', 'hours', 'temp', 'rated', 'ripple', 'ratio', 'rise', 'rise0', 'role'];
export const TECHS = Object.keys(LIFE_RULES.rules);

export const ruleFor = (tech, polymerRule) => (tech === 'polymer' && polymerRule === 'slow' ? POLYMER_SLOW.rule : LIFE_RULES.rules[tech]);

// Life in operating hours at one condition, before the 15-year cap. The
// ambient is taken as at least 40 °C; ripple heating above the rated
// condition's counts with the rule's own ripple step.
export function lifeHours({ rule, hours, temp, ambient, rise = 0, ratedRise = 0 }) {
  const ta = Math.max(ambient, LIFE_LIMITS.floor);
  return hours * rule.base ** ((temp - ta) / rule.step + (ratedRise - rise) / rule.rippleStep);
}

// Complementary error function, fractional error below 1.2 × 10⁻⁷ everywhere
// (the Chebyshev fit of Numerical Recipes' erfcc).
export function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806
    + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

// Share worn out by the end of the mission, and the average rate over it:
// wear-out times are normal around 1.2 × the life, with deviation 0.1 × the life.
export function wearRate(lifeHours, lcHours) {
  const z = (lcHours - WEAROUT.meanFactor * lifeHours) / (WEAROUT.sdFactor * lifeHours);
  // Each tail from the side where it is small, so neither loses its digits.
  const fraction = z < 0 ? 0.5 * erfc(-z / Math.SQRT2) : 1 - 0.5 * erfc(z / Math.SQRT2);
  const survives = z < 0 ? 1 - fraction : 0.5 * erfc(z / Math.SQRT2);
  // A survival too small for a double (a part certain to wear out within the
  // mission) is taken as the smallest one, so the rate stays finite.
  const logSurvival = z < 0 ? Math.log1p(-fraction) : Math.log(Math.max(survives, Number.MIN_VALUE));
  return { fraction, perHour: -logSurvival / lcHours };
}

// The kind follows from the part type for wet aluminium lines.
export function typeTech(part) {
  if (part.model === 'capacitor' && part.params?.type === 'aluminium-wet') return 'wet';
  if (part.model === 'mil-capacitor' && ['CU', 'CE'].includes(part.params?.style)) return 'wet';
  return null;
}

// Lines whose part type leaves the kind open: an untyped capacitor, or a rate entered by hand.
const OPEN_TYPE = (part) => (part.model === 'capacitor' && !part.params?.type)
  || (part.model === 'mil-capacitor' && !part.params?.style)
  || part.model === 'fixed' || part.model === 'vendor';

const TANTALUM = /TANT|POSCAP|KO-?CAP|\bT5[2-9]\d|NIOB|OXICAP/;
const HYBRID = /HYBRID/;
const POLYMER = /POLYMER|ALUM(?:INUM|INIUM)?\s+POLY|POLY\s+ALUM|OS-?CON|SP-?CAP/;
const WET = /ALUM|ELECTROLYTIC|\bELEC\b|\bELCO\b/;

// The kind of aluminium capacitor a part's text names (upper case), or null;
// polymer tantalum parts (POSCAP, KO-CAP) are not aluminium.
export function aluminiumKindOf(text) {
  if (TANTALUM.test(text)) return null;
  return HYBRID.test(text) ? 'hybrid' : POLYMER.test(text) ? 'polymer' : WET.test(text) ? 'wet' : null;
}
const COUNT = '(\\d{1,3}(?:,\\d{3})+|\\d+)';
const HRS = '(?:H|HRS?|HOURS?)';
const DEG = '(\\d{2,3})\\s*(?:°|º|DEG)?\\s*C';
const HOURS_FIRST = new RegExp(`(?:^|[^\\d.])${COUNT}\\s*${HRS}\\b\\s*(?:@|AT\\b|/|,)?\\s*${DEG}\\b`);
const TEMP_FIRST = new RegExp(`(?:^|[^\\d.])${DEG}\\b\\s*(?:@|/|,)?\\s*${COUNT}\\s*${HRS}\\b`);

// A rated life written as "2000H 105C", "2000 Hrs @ 105°C" or "105°C 5000h".
export function ratedLifeOf(text) {
  const s = String(text ?? '').toUpperCase();
  const a = HOURS_FIRST.exec(s);
  const b = a ? null : TEMP_FIRST.exec(s);
  const hours = Number((a ? a[1] : b?.[2] ?? '').replace(/,/g, ''));
  const temp = Number(a ? a[2] : b?.[1]);
  return hours >= 100 && hours <= 1e6 && temp >= 60 && temp <= 175 ? { hours, temp } : null;
}

// What the line's text says: { values, reasons } for tech, hours and temp.
export function lifeGuess(part) {
  const src = part.source ?? {};
  const said = [src.value, src.description].filter(Boolean).join(' ');
  const text = `${said} ${src.footprint ?? ''}`.toUpperCase();
  const values = {};
  const reasons = {};
  const tech = !typeTech(part) && OPEN_TYPE(part) && said ? aluminiumKindOf(text) : null;
  if (tech) { values.tech = tech; reasons.tech = `from “${said}”`; }
  for (const t of [src.description, src.value]) {
    const r = ratedLifeOf(t);
    if (!r) continue;
    Object.assign(values, r);
    reasons.hours = reasons.temp = `from “${t}”`;
    break;
  }
  return { values, reasons };
}

// The line's inputs: entered, from the part type, or guessed (with the reason).
export function lifeInputs(part) {
  const life = part.life ?? {};
  const guess = lifeGuess(part);
  const fromType = typeTech(part);
  const values = {};
  const inferred = {};
  for (const k of LIFE_KEYS) {
    if (life[k] != null) values[k] = life[k];
    else if (k === 'tech' && fromType) values.tech = fromType;
    else if (guess.values[k] != null) { values[k] = guess.values[k]; inferred[k] = guess.reasons[k]; }
    else values[k] = k === 'role' ? 'default' : null;
  }
  return { values, inferred, confirmed: life.confirmed ?? {} };
}

// Wet aluminium lines are always checked; others when their text says
// aluminium, or when the user lists them.
export function isListed(part) {
  if (typeTech(part)) return true;
  if (part.life?.listed != null) return part.life.listed;
  return Boolean(lifeGuess(part).values.tech);
}

// The mission: working phases (life is used up while working) and the design life.
export function lifeConditions(profile, years) {
  const problems = [];
  const phases = (profile.phases ?? []).filter((ph) => ph.tau > 0 && isNum(ph.tac))
    .map((ph, i) => ({ label: ph.name || `Phase ${i + 1}`, ambient: ph.tac, tau: ph.tau }));
  if (!phases.length) problems.push('The mission profile has no working phase with a temperature, so no capacitor life is used up.');
  const lcHours = (isNum(years) ? years : 0) * HOURS_PER_YEAR;
  if (!(lcHours > 0)) problems.push('Set the mission length: it is the design life the wear-out is averaged over.');
  return { phases, lcHours, problems };
}

// One line: what is missing, its role, and its life and rate per piece.
export function evaluateLine(part, settings, conditions) {
  const { values: v, inferred, confirmed } = lifeInputs(part);
  const role = v.role === 'default' ? settings.defaultRole ?? null : v.role;
  const missing = [];
  if (!TECHS.includes(v.tech)) missing.push('tech');
  if (!(v.hours > 0)) missing.push('hours');
  if (!isNum(v.temp)) missing.push('temp');
  if (!['none', 'ratio', 'rise'].includes(v.ripple)) missing.push('ripple');
  // A blank is null, and null >= 0 is true: test for a number first.
  const atLeast0 = (x) => isNum(x) && x >= 0;
  if (v.ripple === 'ratio' && !atLeast0(v.ratio)) missing.push('ratio');
  if (v.ripple === 'rise' && !atLeast0(v.rise)) missing.push('rise');
  if (['ratio', 'rise'].includes(v.ripple) && !['dc', 'ripple'].includes(v.rated)) missing.push('rated');
  if ((v.ripple === 'ratio' || (v.ripple === 'rise' && v.rated === 'ripple')) && !atLeast0(v.rise0)) missing.push('rise0');
  if (!['drift', 'hard'].includes(role)) missing.push('role');
  const base = { values: v, inferred, confirmed, role, missing };
  const lifeMissing = missing.filter((k) => k !== 'role');
  if (lifeMissing.length || conditions.problems.length) return { ...base, complete: false };
  const rule = ruleFor(v.tech, settings.polymerRule);
  const rise = v.ripple === 'ratio' ? v.rise0 * v.ratio ** 2 : v.ripple === 'rise' ? v.rise : 0;
  // With rated ripple in the rating, only the heating beyond it shortens the life;
  // when that rise is not known, none is credited.
  const ratedRise = v.rated === 'ripple' && isNum(v.rise0) ? v.rise0 : 0;
  const phases = conditions.phases.map((ph) => ({ ...ph, hours: lifeHours({ rule, hours: v.hours, temp: v.temp, ambient: ph.ambient, rise, ratedRise }) }));
  const damagePerHour = phases.reduce((s, ph) => s + ph.tau / ph.hours, 0);
  const capHours = LIFE_LIMITS.capYears * HOURS_PER_YEAR;
  const uncapped = 1 / damagePerHour;
  const alphaHours = Math.min(uncapped, capHours);
  const { fraction, perHour } = wearRate(alphaHours, conditions.lcHours);
  return {
    ...base,
    complete: role != null && lifeMissing.length === 0,
    lifeComplete: true,
    rise, ratedRise, phases, alphaHours, capped: uncapped > capHours, fraction,
    fitEach: perHour * 1e9,
    wornOut: alphaHours < conditions.lcHours,
    hot: phases.some((ph) => ph.ambient > v.temp),
  };
}

// Every listed line. `byPart` holds the wear-out FIT per piece of the lines
// whose drift counts; `pending` the lines that may count but cannot yet.
export function evaluateCapLife(parts, settings, profile, years) {
  const conditions = lifeConditions(profile, years);
  const rows = parts.filter(isListed).map((part) => ({ part, ...evaluateLine(part, settings, conditions) }));
  const byPart = new Map(rows.filter((r) => r.role === 'drift' && r.complete).map((r) => [r.part.id, r.fitEach]));
  return {
    conditions,
    problems: rows.length ? conditions.problems : [],
    rows,
    byPart,
    pending: rows.filter((r) => r.role !== 'hard' && !r.complete).length,
    wornOut: rows.filter((r) => r.lifeComplete && r.wornOut),
    guessed: rows.filter((r) => Object.keys(r.inferred).length).length,
  };
}

// Add the counted wear-out to each line's rate, so totals, shares and
// redundant blocks include it. Lines still missing inputs stay out.
export function withLife(board, life) {
  const items = board.items.map(({ comp, result }) => {
    const w = life.byPart.get(comp.id);
    if (!w || !result.complete) return { comp, result };
    const fit = result.fit + w;
    return { comp, result: { ...result, fit, total: fit * result.qty, wearOut: w, parts: [...result.parts, ['Wear-out', w]] } };
  });
  return { ...board, items, total: items.reduce((s, it) => s + it.result.total, 0) };
}
