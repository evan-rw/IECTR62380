// Reads and parses an imported file away from the page's thread, so a large file does not freeze the
// page. In: { kind, file }. Out: { type: 'progress', fraction, stage } as it goes, then
// { type: 'done', result } or { type: 'error', message }.

import { netlistToParts } from './netlist.js';
import { parseBoardFile } from './boardfile.js';
import { readBytes, decodeText, READ_SHARE } from './readfile.js';

self.onmessage = async ({ data }) => {
  let last = -1;
  const report = (fraction, stage) => {
    const percent = Math.floor(fraction * 100);
    if (percent === last) return;
    last = percent;
    self.postMessage({ type: 'progress', fraction, stage });
  };
  try {
    const text = decodeText(await readBytes(data.file, (f) => report(f * READ_SHARE, 'read')));
    const rest = (f, stage) => report(READ_SHARE + (1 - READ_SHARE) * f, stage);
    let result;
    if (data.kind === 'netlist') result = netlistToParts(text, rest);
    else if (data.kind === 'board') result = parseBoardFile(text, data.file.name ?? '', (f) => rest(f, 'parse'));
    else throw new Error(`Unknown import: ${data.kind}`);
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) });
  }
};
