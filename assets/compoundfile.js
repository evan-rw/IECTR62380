// Compound files ([MS-CFB], the container of a binary Altium .PcbDoc): a 512-byte header, a sector
// allocation table (FAT) found through the header's DIFAT list, a directory of 128-byte entries whose
// storages hold their children in a binary tree, and a mini stream of 64-byte sectors for streams under
// 4096 bytes. Written from the published [MS-CFB] layout; it reads, never writes, and stops on a chain
// that loops or leaves the file.

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const NO_ENTRY = 0xffffffff;
const MINI_CUTOFF = 4096;

export const isCompoundFile = (bytes) => bytes.length >= 512 && SIGNATURE.every((b, i) => bytes[i] === b);

const damaged = (why) => { throw new Error(`The file is damaged: ${why}.`); };

// A read past the end of a cut-short file is reported as damage, not as a bounds error.
const guarded = (fn) => (...args) => {
  try {
    return fn(...args);
  } catch (err) {
    if (err instanceof RangeError) damaged('it ends early');
    throw err;
  }
};

// readCompoundFile(bytes) -> { stream(path) }: the stream at a path such as 'Board6/Data' (any case), or
// null if there is none.
export const readCompoundFile = guarded((bytes) => {
  if (!isCompoundFile(bytes)) damaged('it is not a complete compound file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  const major = u16(26);
  const shift = u16(30);
  if (!((major === 3 && shift === 9) || (major === 4 && shift === 12))) damaged(`unknown compound file version ${major}`);
  const size = 1 << shift;
  const miniSize = 1 << u16(32);
  const per = size / 4;
  const sectors = Math.floor((bytes.length - size) / size) + ((bytes.length - size) % size ? 1 : 0);
  // Sector i follows the header, which takes one sector's room.
  const sector = (i) => {
    if (i >= sectors) damaged('a sector lies outside the file');
    return (i + 1) * size;
  };

  // The FAT: its sectors are listed in the header (109) and then in a chain of DIFAT sectors.
  const fatSectors = [];
  const fatCount = u32(44);
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) fatSectors.push(u32(76 + i * 4));
  for (let s = u32(68), seen = new Set(); fatSectors.length < fatCount; s = u32(sector(s) + size - 4)) {
    if (s === END_OF_CHAIN || seen.has(s)) damaged('the sector table is incomplete');
    seen.add(s);
    for (let i = 0; i < per - 1 && fatSectors.length < fatCount; i++) fatSectors.push(u32(sector(s) + i * 4));
  }
  const fat = new Uint32Array(fatSectors.length * per);
  fatSectors.forEach((s, k) => { for (let i = 0; i < per; i++) fat[k * per + i] = u32(sector(s) + i * 4); });

  // A chain of sectors in `table`, gathered into `length` bytes; `at` gives a sector's offset in `from`.
  const chain = (start, length, table, unit, from, at) => {
    const out = new Uint8Array(length);
    const seen = new Uint8Array(table.length);
    for (let s = start, pos = 0; pos < length; s = table[s]) {
      if (s >= table.length) damaged('a stream ends early');
      if (seen[s]) damaged('a stream loops');
      seen[s] = 1;
      const o = at(s);
      const n = Math.min(unit, length - pos, from.length - o);
      if (n <= 0) damaged('a stream lies outside the file');
      out.set(from.subarray(o, o + n), pos);
      pos += n;
    }
    return out;
  };
  const big = (start, length) => chain(start, length, fat, size, bytes, sector);

  // The directory, then the paths of its entries from the root's tree.
  const dirSectors = [];
  for (let s = u32(48), seen = new Set(); s !== END_OF_CHAIN; s = fat[s]) {
    if (s >= fat.length || seen.has(s)) damaged('the directory chain is broken');
    seen.add(s);
    dirSectors.push(s);
  }
  const entries = [];
  for (const s of dirSectors) {
    for (let o = sector(s); o + 128 <= Math.min(sector(s) + size, bytes.length); o += 128) {
      let name = '';
      for (let i = 0; i + 2 < Math.min(u16(o + 64), 64); i += 2) name += String.fromCharCode(u16(o + i));
      // Version 3 files may leave junk in the size's high word.
      entries.push({ name, type: bytes[o + 66], left: u32(o + 68), right: u32(o + 72), child: u32(o + 76), start: u32(o + 116), size: u32(o + 120) + (major === 4 ? u32(o + 124) * 2 ** 32 : 0) });
    }
  }
  if (entries[0]?.type !== 5) damaged('it has no root entry');
  const paths = new Map();
  const seen = new Uint8Array(entries.length);
  for (const todo = [[entries[0].child, '']]; todo.length;) {
    const [id, parent] = todo.pop();
    if (id === NO_ENTRY) continue;
    if (id >= entries.length || seen[id]) damaged('the directory tree is broken');
    seen[id] = 1;
    const e = entries[id];
    const path = parent ? `${parent}/${e.name}` : e.name;
    paths.set(path.toUpperCase(), e);
    todo.push([e.left, parent], [e.right, parent]);
    if (e.type === 1) todo.push([e.child, path]);
  }

  // The mini stream is the root entry's stream; its own table is a chain of ordinary sectors.
  let mini = null;
  const miniStream = () => {
    if (!mini) {
      const table = big(u32(60), u32(64) * size);
      const tv = new DataView(table.buffer);
      mini = { data: big(entries[0].start, entries[0].size), table: Uint32Array.from({ length: table.length / 4 }, (_, i) => tv.getUint32(i * 4, true)) };
    }
    return mini;
  };
  return {
    stream: guarded((path) => {
      const e = paths.get(path.toUpperCase());
      if (e?.type !== 2) return null;
      if (e.size === 0) return new Uint8Array(0);
      if (e.size >= MINI_CUTOFF) return big(e.start, e.size);
      const { data, table } = miniStream();
      return chain(e.start, e.size, table, miniSize, data, (i) => i * miniSize);
    }),
  };
});
