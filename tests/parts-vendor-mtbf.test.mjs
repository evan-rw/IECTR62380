// A maker's MTBF on the page: an environment other than the board's is a notice on the card, and lines
// whose figures come from different prediction methods raise a board warning. Neither leaves a line out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './_page.mjs';

const { $, $$, click, choose, typeInto, open, refOf } = await openPage();
const warn = () => $('#summary .warn')?.textContent ?? '';

function addMtbfLine(method) {
  $('#add-model').value = 'vendor';
  click($('[data-act="add-part"]'));
  const card = open($$('.part').at(-1));
  const ref = refOf(card);
  choose($('[data-key="method"]', card), 'mtbf');
  const again = () => $$('.part').find((p) => refOf(p) === ref);
  typeInto($('[data-key="mtbfHours"]', again()), 1e6);
  choose($('[data-key="predMethod"]', again()), method);
  choose($('[data-key="statedEnv"]', again()), 'GB');
  choose($('[data-key="refPoint"]', again()), 'unstated');
  return again;
}

test('a maker\'s MTBF stated for another environment is a notice; mixed methods are a board warning', () => {
  const first = addMtbfLine('217f-stress');
  assert.equal($$('.field.missing', first()).length, 0, 'complete once the figure, method, environment and reference are in');
  assert.match($('[data-out="fit"] .each', first()).textContent, /^1,000 FIT$/);
  assert.doesNotMatch(warn(), /prediction methods/, 'one method so far');
  addMtbfLine('sr332');
  assert.match(warn(), /different prediction methods \(MIL-HDBK-217F, Telcordia SR-332\)/);
  // The board's environment differs from the figure's: a notice on the card, and the line still counts.
  assert.equal($('[data-out="notices"]', first()).textContent, '');
  choose($('#env217f'), 'GF');
  assert.match($('[data-out="notices"]', first()).textContent, /Stated for Ground, benign \(G_B\); this board is Ground, fixed \(G_F\)/);
  assert.match($('[data-out="fit"] .each', first()).textContent, /^1,000 FIT$/);
  assert.doesNotMatch(warn(), /need more input/, 'no line was left out');
});
