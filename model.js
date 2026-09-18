// DOM-free core: normalization, marker pairing, escaping, number coercion.
// Split out of app.js so tools/player_smoke.mjs can exercise the import
// boundary under Node (XSS review: bpm arriving as HTML from a foreign zip).
// Keep browser-only code OUT of this file.
let _t = k => k;
let _lang = 'en';
export function setLabels(fn, lang) { _t = fn; if (lang) _lang = lang; }

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/// Coerce numeric fields at the parse boundary: Number("120") keeps a legit
/// string tempo, Number("<img…>") is NaN → null. After this layer no
/// non-number can reach the DOM — the sink still escapes (defense in depth).
export function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ru needs proper Slavic plural agreement; en just ±s
export function cnt(n, enOne, one, few, many) {
  if (_lang !== 'ru') return n + ' ' + (n === 1 ? enOne : enOne + 's');
  const m10 = n % 10, m100 = n % 100;
  return n + ' ' + (m10 === 1 && m100 !== 11 ? one : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many));
}

export async function sha256hex(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function decodeDate(v) {
  if (typeof v === 'number') return new Date((v + 978307200) * 1000); // Apple 2001 epoch
  const d = new Date(v); return isNaN(d) ? null : d;
}

export function pairFragments(markers) {
  const ms = (markers || []).slice().sort((a, b) => a.t - b.t);
  const out = [];
  for (let i = 0; i + 1 < ms.length; i += 2) out.push({ s: ms[i].t, e: ms[i + 1].t, label: ms[i].label });
  if (ms.length % 2 === 1) out.push({ s: ms[ms.length - 1].t, e: null, label: ms[ms.length - 1].label, open: true });
  return out;
}
// normalizeBundle turns a validated manifest+index+sidecars into the player
// model. Accepts uid keys AND legacy path keys for setlists (spec A.4).
export async function normalizeBundle(man, idx, sidecarOf, srcName, byteSize) {
  const uidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const songs = (idx.songs || []).map(s => {
    const uid = s.uid && uidRe.test(s.uid) ? s.uid.toUpperCase() : null;
    return {
      uid: uid || s.audioPath || s.title,
      title: s.title || 'Untitled',
      artistID: s.artistID,
      audioRel: s.audioPath || null,
      sheetRel: s.sheetPath || null,
      duration: typeof s.duration === 'number' ? s.duration : null,
      gain: Number.isFinite(s.gain) ? s.gain : 1.0,
      key: s.key || null, bpm: numOrNull(s.bpm),
    };
  });
  // ambiguity: two songs resolving to one identity is fatal for the import (A.4)
  const seen = new Set();
  for (const s of songs) {
    if (seen.has(s.uid)) { const e = new Error(_t('ambiguity')); e.code = 'ambiguity'; throw e; }
    seen.add(s.uid);
  }
  const byUid = new Map(songs.map(s => [s.uid, s]));
  const byRel = new Map(songs.filter(s => s.audioRel).map(s => [s.audioRel.normalize('NFC'), s]));
  const artists = new Map((idx.artists || []).map(a => [a.id, a.name]));
  // attach markers from sidecars (resolved by song folder)
  for (const s of songs) {
    s.artist = artists.get(s.artistID) || 'JamCrate';
    const sc = s.audioRel ? await sidecarOf(s.audioRel) : null;
    const frag = sc ? pairFragments(sc.markers) : [];
    s.fragments = frag;
  }
  // gain pre-scale: element.volume caps at 1.0 — scale the whole set so the
  // loudest song lands at 1.0 and relative mix survives (findings: no GainNode on iOS)
  const maxGain = Math.max(1e-6, ...songs.map(s => Math.min(Math.max(s.gain, 0), 4)));
  const scale = maxGain > 1.0 ? 1.0 / maxGain : 1.0;
  const setlists = (idx.setlists || []).map(set => {
    const ids = [];
    for (const kRaw of set.songIDs || []) {
      const k = String(kRaw);
      const s = byUid.get(k.toUpperCase()) || (byUid.has(k) ? byUid.get(k) : null) || byRel.get(k.normalize('NFC'));
      if (s) ids.push(s.uid);           // dangling keys are dropped, order kept
    }
    return { id: set.id || (set.name || 'set'), name: set.name || 'Set', songUIDs: ids };
  }).filter(s => s.songUIDs.length > 0);

  const bundleID = (man.bundleID && String(man.bundleID).toUpperCase())
    || (await sha256hex(songs.map(s => s.uid).sort().join('|'))).slice(0, 32);
  return {
    id: bundleID,
    revision: Number.isFinite(man.revision) ? man.revision : 0,
    title: man.title || (man.scope === 'band' ? (man.bandName || 'JamCrate') : 'JamCrate Library'),
    importedAt: new Date().toISOString(),
    sourceCreatedAt: (decodeDate(man.createdAt) || new Date()).toISOString(),
    byteSize, scale, songs, setlists, scaled: scale < 1.0,
    srcName,
  };
}

