// The pages carry a Content-Security-Policy: they run only their own files and may not send anything
// anywhere, so a board saved in the browser cannot leave it even through a bug. These checks keep the
// source inside what that policy allows; the policy itself is enforced by the browser, not by jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const PAGES = ['index.html', 'sources.html'];
const SCRIPTS = readdirSync(new URL('assets/', root)).filter((f) => f.endsWith('.js')).map((f) => `assets/${f}`);

const policyOf = (html) => {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  return m && Object.fromEntries(m[1].split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
};

test('each page has the policy before anything it governs, with no network and no inline code', () => {
  for (const page of PAGES) {
    const html = read(page);
    const policy = policyOf(html);
    assert.ok(policy, `${page} has a policy`);
    assert.ok(html.indexOf('Content-Security-Policy') < html.search(/<link|<script|<style/), `${page}: the policy comes first`);
    assert.deepEqual(policy['default-src'], ["'none'"]);
    assert.deepEqual(policy['connect-src'], ["'none'"], 'nothing can be sent');
    assert.deepEqual(policy['script-src'], ["'self'"]);
    assert.deepEqual(policy['style-src'], ["'self'"]);
    assert.deepEqual(policy['form-action'], ["'none'"]);
    assert.ok(!/unsafe-|https?:|\*/.test(Object.values(policy).flat().join(' ')), `${page}: no unsafe or outside sources`);
  }
});

test('the source stays inside the policy: no style attributes, inline scripts or handlers', () => {
  for (const file of [...PAGES, ...SCRIPTS.filter((f) => f !== 'assets/xlsx.js')]) {
    const text = read(file);
    assert.doesNotMatch(text, /\sstyle=["'$]/, `${file}: a style attribute is blocked; set it through element.style`);
    assert.doesNotMatch(text, /\son[a-z]+=["'$]/, `${file}: an inline handler is blocked`);
    assert.doesNotMatch(text, /javascript:/i, file);
    assert.doesNotMatch(text, /<script(?![^>]*\ssrc=)[^>]*>/, `${file}: an inline script is blocked`);
  }
});

test('no code that sends data: the policy would block it, so none should be written', () => {
  for (const file of SCRIPTS) {
    assert.doesNotMatch(read(file), /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|\beval\(|new Function\(/, file);
  }
});
