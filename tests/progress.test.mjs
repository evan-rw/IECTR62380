// The import progress window (assets/progress.js) and the import worker (assets/importworker.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, root, fixture } from './_page.mjs';

const { $, $$, click, importNetlist } = await openPage();
const { blocksFor, openProgress, BLOCKS } = await import(new URL('assets/progress.js', root).href);
const { netlistToParts } = await import(new URL('assets/netlist.js', root).href);

test('one dark blue block per 5 %: finished blocks are solid, the one being worked on blinks', () => {
  assert.equal(BLOCKS, 20);
  assert.deepEqual(blocksFor(0), { done: 0, current: 0, percent: 0 });
  assert.deepEqual(blocksFor(0.05), { done: 1, current: 1, percent: 5 });
  assert.deepEqual(blocksFor(0.37), { done: 7, current: 7, percent: 37 });
  assert.deepEqual(blocksFor(0.999), { done: 19, current: 19, percent: 99 });
  assert.deepEqual(blocksFor(1), { done: 20, current: null, percent: 100 }, 'finished: all solid, nothing blinks');
  assert.deepEqual(blocksFor(7), blocksFor(1));
  assert.deepEqual(blocksFor(-1), blocksFor(0));
});

test('the progress window shows the blocks and the stage, and Cancel closes it', () => {
  let cancelled = 0;
  const p = openProgress({ title: 'Import netlist', text: 'Reading x.net…', onCancel: () => cancelled++ });
  const win = $('.progress-window');
  assert.equal($('h2', win).textContent, 'Import netlist');
  const spans = $$('.progress-bar > span', win);
  assert.equal(spans.length, 20);
  p.set(0.37, 'Reading the parts and nets…');
  assert.equal($$('.progress-bar > span.done', win).length, 7);
  assert.deepEqual($$('.progress-bar > span.current', win), [spans[7]], 'the eighth block, 35–40 %, blinks');
  assert.equal($('.progress-bar', win).getAttribute('aria-valuenow'), '37');
  assert.equal($('.progress-text', win).textContent, 'Reading the parts and nets…');
  p.set(1);
  assert.equal($$('.progress-bar > span.done', win).length, 20);
  assert.equal($$('.progress-bar > span.current', win).length, 0);
  click($('[data-act="cancel-import"]', win));
  assert.equal(cancelled, 1);
  assert.equal($('.progress-window'), null);
});

test('netlist parsing reports steady progress that ends at 1, for KiCad and Protel', () => {
  for (const name of ['tree-board.net', 'tree-board-protel.net']) {
    const seen = [];
    netlistToParts(fixture(name), (f, stage) => seen.push([f, stage]));
    assert.ok(seen.length >= 2, name);
    assert.ok(seen.every(([f], i) => f >= 0 && f <= 1 && (i === 0 || f >= seen[i - 1][0])), `${name}: ${JSON.stringify(seen)}`);
    assert.deepEqual(seen.at(-1), [1, 'sort']);
    assert.ok(seen.some(([, s]) => s === 'parse'), name);
  }
});

test('the import worker reads, parses and answers as netlistToParts does', async () => {
  const messages = [];
  globalThis.self = { postMessage: (m) => messages.push(m) };
  await import(new URL('assets/importworker.js', root).href);
  const text = fixture('tree-board.net');
  await globalThis.self.onmessage({ data: { kind: 'netlist', file: new Blob([text]) } });
  const progress = messages.filter((m) => m.type === 'progress');
  assert.ok(progress.length >= 2);
  assert.ok(progress.every((m, i) => i === 0 || m.fraction >= progress[i - 1].fraction));
  assert.equal(progress[0].stage, 'read');
  const done = messages.at(-1);
  assert.equal(done.type, 'done');
  assert.deepEqual(done.result, netlistToParts(text));
  messages.length = 0;
  await globalThis.self.onmessage({ data: { kind: 'board', file: new Blob(['x']) } });
  assert.deepEqual(messages.at(-1), { type: 'error', message: 'Unknown import: board' });
  messages.length = 0;
  await globalThis.self.onmessage({ data: { kind: 'netlist', file: new Blob(['not a netlist']) } });
  assert.equal(messages.at(-1).type, 'error');
});

test('a netlist import goes through the progress window and closes it when done', async () => {
  await importNetlist('tree-board.net', fixture('tree-board.net'));
  assert.ok($$('.part').length >= 10, 'the parts arrived');
  assert.equal($('.progress-window'), null);
});
