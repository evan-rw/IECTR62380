// Renders the data sources page (sources.html + assets/sources.js) in jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { ALL_TABLES, SOURCES } from '../assets/tables.js';
import { TABLES_217F, SOURCES_217F } from '../assets/tables217f.js';
import { FAILURE_MODES } from '../assets/failuremodes.js';
import { MODELS, PENDING_FAMILIES } from '../assets/models.js';

const root = new URL('..', import.meta.url);

test('the data sources page lists every table, source, model and failure mode', async () => {
  const dom = new JSDOM(readFileSync(new URL('sources.html', root), 'utf8'), { url: 'http://localhost/sources.html' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  await import(new URL('assets/sources.js', root).href);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  assert.equal($('.site-nav [aria-current="page"]').textContent, 'Data sources');
  assert.equal($('.site-nav a[href="./"]').textContent, 'Calculator');

  // One row per table, under its own method.
  assert.equal($$('#method-tables-62380 tbody tr').length, ALL_TABLES.length);
  assert.equal($$('#method-tables-217f tbody tr').length, TABLES_217F.length);
  assert.match($('#method-tables-217f').textContent, /MIL-HDBK-217F Notice 2, section 13\.1/);
  assert.match($('#method-tables-62380').textContent, /Table 16 of IEC TR 62380, according to the source/);

  // Every source appears once in the bibliography, linked, with what it was used for.
  const bib = $$('#bibliography li');
  assert.equal(bib.length, Object.keys(SOURCES).length + Object.keys(SOURCES_217F).length + 1);
  for (const li of bib) {
    assert.ok(li.querySelector('a[href^="https://"]'), li.id);
    assert.match(li.textContent, /Used for: /, li.id);
  }
  assert.match($('#src-kicad').textContent, /λ1 and λ2 for integrated circuit families/);
  assert.match($('#src-tiSloa294').textContent, /vendor IEC 62380 FIT report rescaling/);

  // Models grouped by method; failure modes complete; pending families listed.
  assert.deepEqual($$('#model-list h3').map((h) => h.textContent), ['IEC TR 62380 approach', 'MIL-HDBK-217F', 'Vendor data', 'Other']);
  assert.equal($$('#model-list li').length, Object.keys(MODELS).length);
  assert.equal($$('#failure-mode-table tbody tr').length, FAILURE_MODES.size);
  assert.match($('#failure-mode-table').textContent, /Capacitor, Ceramic.*Short 49% · Change in Value 29% · Open 22%/);
  assert.equal($$('#pending-list li').length, PENDING_FAMILIES.length);
  assert.match($('#licence-heading').parentElement.textContent, /MIT licence/);
});
