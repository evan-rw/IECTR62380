// Reading an imported file: its bytes, with progress as they arrive, then its text as UTF-8, or as
// Windows-1252 when it is not valid UTF-8 (older Protel and Altium exports). Used by the page and by
// the import worker.

// Reading the bytes is this share of an import's progress bar; parsing and sorting are the rest.
export const READ_SHARE = 0.3;

export async function readBytes(file, onProgress) {
  if (typeof file.stream !== 'function') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    onProgress?.(1);
    return bytes;
  }
  const reader = file.stream().getReader();
  const size = file.size || 1;
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(Math.min(1, got / size));
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
