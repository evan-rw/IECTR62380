// The data sources page: where every table, model and failure-mode figure
// comes from, rendered from the same data modules the calculator uses.

import { ALL_TABLES, SOURCES, STATUS } from './tables.js';
import { TABLES_217F, SOURCES_217F } from './tables217f.js';
import { FAILURE_MODES, FAILURE_MODE_SOURCE } from './failuremodes.js';
import { MODELS, MODEL_GROUPS, PENDING_FAMILIES, clauseOf } from './models.js';
import { esc } from './html.js';

const $ = (sel) => document.querySelector(sel);
const ALL_SOURCES = { ...SOURCES, ...SOURCES_217F, failureModes: FAILURE_MODE_SOURCE };

// What each source supports beyond the tables that list it.
const OTHER_USES = {
  tiSloa294: ['the IC failure-rate formula (die + package + overstress)', 'the vendor IEC 62380 FIT report rescaling'],
  pmcTantalum: ['the capacitor model structure'],
  thurlbeck: ['the MOS transistor model structure (0.3 eV, 100 °C reference)'],
  failureModes: ['failure modes shown with each part', 'suggested critical shares for redundant blocks'],
};

const link = (key) => {
  const s = ALL_SOURCES[key];
  return s.url ? `<a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a>` : esc(s.label);
};

const refLabel = (t) => (t.ref.startsWith('MIL-HDBK') ? t.ref
  : t.status === 'excerpt' ? `IEC TR 62380 ${t.ref}` : `${t.ref} of IEC TR 62380, according to the source`);

function tablesHTML(tables) {
  const rows = tables.map((t) => `<tr>
      <td>${esc(t.title)}<br><span class="unit">${esc(refLabel(t))}</span></td>
      <td><span class="badge ${t.status === 'single' ? 'no' : 'ok'}">${esc(STATUS[t.status])}</span></td>
      <td>${t.sources.map(link).join('<br>')}${t.note ? `<p class="help">${esc(t.note)}</p>` : ''}</td>
    </tr>`).join('');
  return `<div class="table-scroll"><table class="source-table"><thead><tr><th>Table</th><th>Status</th><th>Sources and checks</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function bibliographyHTML() {
  const tables = [...ALL_TABLES, ...TABLES_217F];
  const items = Object.keys(ALL_SOURCES).map((key) => {
    const uses = [
      ...tables.filter((t) => t.sources.includes(key)).map((t) => t.title),
      ...(OTHER_USES[key] ?? []),
    ];
    return `<li id="src-${esc(key)}">${link(key)}${uses.length ? `<br><span class="unit">Used for: ${esc(uses.join('; '))}</span>` : ''}</li>`;
  });
  return `<ol class="bibliography">${items.join('')}</ol>`;
}

function modelsHTML() {
  return MODEL_GROUPS.map((group) => {
    const items = Object.values(MODELS).filter((m) => m.group === group)
      .map((m) => `<li><strong>${esc(m.label)}</strong> (${esc(clauseOf(m))}): ${esc(m.status)}</li>`).join('');
    return `<h3>${esc(group)}</h3><ul>${items}</ul>`;
  }).join('');
}

function failureModesHTML() {
  const rows = [...FAILURE_MODES].map(([device, modes]) => `<tr><td>${esc(device)}</td><td>${modes.map(([m, a]) => `${esc(m)} ${Math.round(a * 100)}%`).join(' · ')}</td></tr>`).join('');
  return `<details class="fm-details"><summary>Show all ${FAILURE_MODES.size} part types</summary>
    <div class="table-scroll"><table class="source-table"><thead><tr><th>Part type</th><th>Failure modes</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

$('#method-tables-62380').innerHTML = tablesHTML(ALL_TABLES);
$('#method-tables-217f').innerHTML = tablesHTML(TABLES_217F);
$('#bibliography').innerHTML = bibliographyHTML();
$('#model-list').innerHTML = modelsHTML();
$('#failure-mode-source').innerHTML = link('failureModes');
$('#failure-mode-table').innerHTML = failureModesHTML();
$('#pending-list').innerHTML = PENDING_FAMILIES.map((f) => `<li>${esc(f)}</li>`).join('');
