import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url);

test('every image the stylesheet uses exists', () => {
  const css = readFileSync(new URL('assets/style.css', root), 'utf8');
  const urls = [...css.matchAll(/url\((?!["']?data:)["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 5, urls.join(' '));
  for (const u of urls) assert.ok(existsSync(new URL(`assets/${u}`, root)), `assets/${u}`);
});
