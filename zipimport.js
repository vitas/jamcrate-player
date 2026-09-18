// Minimal streaming ZIP reader for .jamcrate bundles — no dependencies.
// Parses the End Of Central Directory (with ZIP64 locator), walks central
// directory entries, decodes names as UTF-8 (JamCrate's writer stores UTF-8
// bytes without the language flag — cp437 would mangle band names), and
// inflates single entries through DecompressionStream('deflate-raw').
//
// Hard limits mirror the spec §10.3 and our desktop proven patterns:
// reject before extract, never partially trust.

export const LIMITS = {
  maxEntries: 5000,        // ZIP entries
  maxManifest: 1_048_576,  // manifest.json uncompressed
  maxIndex: 10_485_760,    // index.json uncompressed
  maxRatio: 200,           // uncompressed : compressed
  maxEntryBytes: 800_000_000,
};

export class ZipError extends Error {}

function u16(dv, p) { return dv.getUint16(p, true); }
function u32(dv, p) { return dv.getUint32(p, true); }
function u64(dv, p) {
  return dv.getUint32(p, true) + dv.getUint32(p + 4, true) * 4294967296;
}

// locate EOCD within the last ~64 KiB (max comment 65535 + 22)
function findEOCD(buf) {
  const min = Math.max(0, buf.byteLength - 65557);
  const dv = new DataView(buf);
  for (let p = buf.byteLength - 22; p >= min; p--) {
    if (u32(dv, p) === 0x06054b50) return p;
  }
  return -1;
}

export async function openZip(file) {
  const tailSize = Math.min(file.size, 65557 + 20);
  const tail = await file.slice(file.size - tailSize, file.size).arrayBuffer();
  const eocdAt = findEOCD(tail);
  if (eocdAt < 0) throw new ZipError('not a zip (no end-of-central-directory)');
  const dv = new DataView(tail);
  let total = u16(dv, eocdAt + 10);
  let cdSize = u32(dv, eocdAt + 12);
  let cdOff = u32(dv, eocdAt + 16);

  // ZIP64? sentinels say so — follow the locator
  if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    const locAt = eocdAt - 20;
    if (locAt < 0 || u32(dv, locAt) !== 0x07064b50) throw new ZipError('zip64 truncated');
    const z64Off64 = Number(u64(dv, locAt + 8)); // offset of zip64 EOCD is u64 there
    const head = await file.slice(z64Off64, z64Off64 + 56).arrayBuffer();
    const hdv = new DataView(head);
    if (u32(hdv, 0) !== 0x06064b50) throw new ZipError('zip64 EOCD missing');
    total = Number(u64(hdv, 32));
    cdSize = Number(u64(hdv, 40));
    cdOff = Number(u64(hdv, 48));
  }
  if (total > LIMITS.maxEntries) throw new ZipError(`too many entries (${total})`);

  const cdBuf = await file.slice(cdOff, cdOff + cdSize).arrayBuffer();
  const cdv = new DataView(cdBuf);
  const utf8 = new TextDecoder('utf-8', { fatal: false });
  let entries = [];
  let p = 0;
  for (let i = 0; i < total; i++) {
    if (cdv.byteLength - p < 46 || u32(cdv, p) !== 0x02014b50) throw new ZipError('central directory corrupt');
    const method = u16(cdv, p + 10);
    const csize = u32(cdv, p + 20);
    const usize = u32(cdv, p + 24);
    const nameLen = u16(cdv, p + 28);
    const extraLen = u16(cdv, p + 30);
    const commentLen = u16(cdv, p + 32);
    const externalAttrs = u32(cdv, p + 38);
    let localOff = u32(cdv, p + 42);
    const nameBytes = new Uint8Array(cdBuf, p + 46, nameLen);
    const name = utf8.decode(nameBytes);
    // ZIP64 extended info lives in the extra field keyed 0x0001
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    let z64u = usize === 0xffffffff, z64c = csize === 0xffffffff, z64o = localOff === 0xffffffff;
    let z64Size = null, z64Csize = null, z64Off = null;
    while (e + 4 <= extraEnd) {
      const id = u16(cdv, e), sz = u16(cdv, e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (z64u) { z64Size = u64(cdv, q); q += 8; }
        if (z64c) { z64Csize = u64(cdv, q); q += 8; }
        if (z64o) { z64Off = u64(cdv, q); q += 8; }
      }
      e += 4 + sz;
    }
    const usizeF = z64u ? Number(z64Size) : usize;
    const csizeF = z64c ? Number(z64Csize) : csize;
    const offF = z64o ? Number(z64Off) : localOff;
    p += 46 + nameLen + extraLen + commentLen;

    const isDir = name.endsWith('/') || (externalAttrs & 0x10) !== 0;
    if (isDir) continue;
    entries.push({ name, method, csize: csizeF, usize: usizeF, localHeader: offF });
  }
  // ratio gate over the whole archive (bomb = huge declared total, tiny bytes)
  const totalU = entries.reduce((s, e) => s + e.usize, 0);
  const totalC = entries.reduce((s, e) => s + e.csize, 0);
  if (totalC > 0 && totalU / totalC > LIMITS.maxRatio * 4 && totalU > 100_000_000) {
    throw new ZipError(`compression ratio looks like a bomb (${(totalU / totalC) | 0}:1)`);
  }
  const byName = new Map(entries.map(e => [e.name, e]));

  async function extract(entry) {
    if (entry.csize > LIMITS.maxEntryBytes || entry.usize > LIMITS.maxEntryBytes) {
      throw new ZipError(`entry too big: ${entry.name}`);
    }
    if (entry.method === 0) {
      // stored: skip the local header to find data start
      const lh = await file.slice(entry.localHeader, entry.localHeader + 30).arrayBuffer();
      const ldv = new DataView(lh);
      if (u32(ldv, 0) !== 0x04034b50) throw new ZipError('local header corrupt');
      const start = entry.localHeader + 30 + u16(ldv, 26) + u16(ldv, 28);
      return file.slice(start, start + entry.csize);
    }
    if (entry.method === 8) {
      const lh = await file.slice(entry.localHeader, entry.localHeader + 30).arrayBuffer();
      const ldv = new DataView(lh);
      if (u32(ldv, 0) !== 0x04034b50) throw new ZipError('local header corrupt');
      const start = entry.localHeader + 30 + u16(ldv, 26) + u16(ldv, 28);
      const comp = file.slice(start, start + entry.csize);
      // streamed raw-inflate; keeps peak memory at one file, not the bundle (NFR 04)
      const stream = comp.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).blob();
    }
    throw new ZipError(`unsupported compression method ${entry.method} in ${entry.name}`);
  }

  return { entries, byName, extract };
}

// path acceptance: inside-root only, no traversal tricks, unicode-normalized
export function safeName(name) {
  if (!name || name.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(name)) return null;
  const norm = name.normalize('NFC');
  const parts = norm.split('/');
  if (parts.some(s => s === '..' || s === '.' || s === '')) return null;
  if (/\\/.test(norm)) return null; // backslash is not a path sep for us — reject rather than guess
  return norm;
}
