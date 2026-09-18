// JamCrate Player — prototype per docs/JamCrate_Player_Spec_v0.1.docx.
// Vanilla ES modules, no build step. Everything is local: no fetch of user
// data, ever. This file owns model normalization, screens and audio.

import { openZip, safeName, LIMITS, ZipError } from './zipimport.js';
import { meta, media } from './storage.js';
import { esc, cnt, sha256hex, decodeDate, pairFragments, normalizeBundle, setLabels, numOrNull } from './model.js';

// ─── i18n ──────────────────────────────────────────────────────────────────
const STR = {
  en: {
    appTitle: 'JamCrate Player', sets: 'Sets', importSet: 'Import Set',
    firstRun: 'This player never leaves your device. Export a set from JamCrate on your Mac, send the .jamcrate.zip to this device, and import it here.',
    empty: 'No sets yet', songs: 'songs', setlists: 'setlists',
    delete: 'Delete', deleteAsk: 'Delete this set and free its space?',
    importing: 'Importing…', importFailed: 'Import failed',
    start: 'Start', back: 'Back', nowPlaying: 'Now playing',
    fragments: 'Fragments', fullSong: 'Full song', loopOn: 'Loop',
    autoAdvance: 'Auto advance to next song', keepAwake: 'Keep screen awake', volume: 'Volume',
    language: 'Language', storage: 'Storage used', close: 'Close',
    keepZip: 'Keep your original .jamcrate.zip — browsers can clear local data.',
    demoSet: 'Try a demo set', demoLoading: 'Loading demo…',
    noManifest: 'No manifest.json — is this a JamCrate bundle?',
    noIndex: 'No index.json in the bundle.',
    tooBigIndex: 'index.json exceeds the size limit.',
    traversal: 'Bundle contains a path outside itself — rejected before any file was written.',
    missingAudio: 'missing file', ambiguity: 'Two songs share the same identity — cannot resolve.',
    corrupt: 'The file could not be read as a JamCrate bundle.',
    quota: 'Not enough storage space on this device.',
    imported: 'Set imported', offlineHint: 'Works offline once imported.',
    gainNote: 'volume normalized to safe range',
    live: 'playing from your Mac — nothing stored here', playOnMac: '▶ on Mac', listenHere: 'Listen here',
    refresh: 'refresh', macPlaying: 'Mac is playing', macPaused: 'Mac: paused',
    macTip: 'At home it is easier to play straight from the Mac: Phone ▸ Open on Your Phone in the JamCrate app.',
    httpWarn: 'Heads up: this page streams from the Mac over plain http, and some phones refuse to store files from a page like that. If the import failed — the set still plays while the Mac is nearby; for an offline copy go to play.jamcrate.app.',
    mirrorIntro: 'This set plays live from your Mac. Nothing is stored on this device.',
    offlineTitle: 'Take the set with you', offlineText: 'Import a copy of the set from a file — it gets saved on this device and plays offline: no Mac needed at all. What only works with the Mac nearby is the live audio stream, not the page itself.',
  },
  ru: {
    appTitle: 'JamCrate Player', sets: 'Сеты', importSet: 'Импортировать сет',
    firstRun: 'Этот плеер никуда не отправляет данные. Экспортируй сет из JamCrate на Mac, передай файл .jamcrate.zip на это устройство и импортируй здесь.',
    empty: 'Пока нет сетов', songs: 'песен', setlists: 'сет-листов',
    delete: 'Удалить', deleteAsk: 'Удалить этот сет и освободить место?',
    importing: 'Импорт…', importFailed: 'Импорт не удался',
    start: 'Играть', back: 'Назад', nowPlaying: 'Играет сейчас',
    fragments: 'Фрагменты', fullSong: 'Вся песня', loopOn: 'Луп',
    autoAdvance: 'Автопереход к следующей песне', keepAwake: 'Не гасить экран', volume: 'Громкость',
    language: 'Язык', storage: 'Занято памяти', close: 'Закрыть',
    keepZip: 'Храни исходный .jamcrate.zip — браузер может очистить локальные данные.',
    demoSet: 'Попробовать демо-сет', demoLoading: 'Грузим демо…',
    noManifest: 'Нет manifest.json — это бандл JamCrate?',
    noIndex: 'В бандле нет index.json.',
    tooBigIndex: 'index.json превышает лимит размера.',
    traversal: 'Бандл содержит путь наружу — отклонён до записи файлов.',
    missingAudio: 'файл отсутствует', ambiguity: 'Две песни делят один идентификатор — не разрешить.',
    corrupt: 'Файл не читается как бандл JamCrate.',
    quota: 'На устройстве не хватит места.',
    imported: 'Сет импортирован', offlineHint: 'После импорта работает офлайн.',
    gainNote: 'громкость приведена к безопасному диапазону',
    live: 'играет с твоего Mac — здесь ничего не сохранено', playOnMac: '▶ на Mac', listenHere: 'Слушать здесь',
    refresh: 'обновить', macPlaying: 'На Mac играет', macPaused: 'Mac: пауза',
    macTip: 'Дома удобнее играть прямо с Mac: в приложении меню «Телефон» ▸ «Открыть на телефоне».',
    httpWarn: 'Тонкость: страница идёт с Mac по незащищённому http, и некоторые телефоны не дают сохранять с неё файлы. Если импорт не вышел — сет поиграешь с Mac, а офлайн-копию сделай на play.jamcrate.app.',
    mirrorIntro: 'Этот сет играет живьём с Mac. На устройстве ничего не сохраняется.',
    offlineTitle: 'Взять сет с собой', offlineText: 'Импортируй копию сета из файла — она сохранится на устройстве и будет играть офлайн, вообще без Mac. Рядом с Mac работает аудиострим: играет звук прямо с него.',
  },
};
let LANG = 'en';
const t = k => (STR[LANG][k] ?? STR.en[k] ?? k);
// ─── model ─────────────────────────────────────────────────────────────────
// ─── import ────────────────────────────────────────────────────────────────
async function importFile(file) {
  const zip = await openZip(file);
  const manRaw = zip.byName.get('manifest.json');
  const idxRaw = zip.byName.get('index.json');
  if (!manRaw) { const e = new Error(t('noManifest')); e.code = 'nomani'; throw e; }
  if (!idxRaw) { const e = new Error(t('noIndex')); e.code = 'noindex'; throw e; }
  if (manRaw.usize > LIMITS.maxManifest) { const e = new Error(t('corrupt')); e.code = 'big'; throw e; }
  if (idxRaw.usize > LIMITS.maxIndex) { const e = new Error(t('tooBigIndex')); e.code = 'big'; throw e; }

  // quota gate before extraction (spec 8.2)
  const need = zip.entries.reduce((s, e) => s + e.usize, 0);
  const est = await media.usage();
  if (est && est.quota && (est.usage || 0) + need > est.quota * 0.92) {
    const e = new Error(t('quota')); e.code = 'quota'; throw e;
  }

  const man = JSON.parse(await (await zip.extract(manRaw)).text());
  const idx = JSON.parse(await (await zip.extract(idxRaw)).text());
  if (man.formatVersion !== 2 || idx.version !== 3) {
    const e = new Error(t('corrupt')); e.code = 'ver'; throw e;
  }

  // fail-closed path audit (spec §10.3): every entry must be files/… or one of
  // the two root JSONs; any traversal shape rejects the WHOLE bundle up front
  for (const en of zip.entries) {
    const ok = safeName(en.name);
    if (!ok || !(ok.startsWith('files/') || ok === 'manifest.json' || ok === 'index.json')) {
      const e = new Error(t('traversal')); e.code = 'path'; throw e;
    }
  }

  // whitelist of what gets extracted: only files the index references (+ their
  // sidecar folders) — everything else is never even written (spec 5.2)
  const wanted = new Map();   // zipName → relName
  const sidecars = new Map(); // audioRel → parsed sidecar doc
  const dirOf = p => p.split('/').slice(0, -1).join('/');
  const stems = new Set();
  for (const s of idx.songs || []) {
    for (const rel of [s.audioPath, s.sheetPath]) {
      if (!rel) continue;
      const ok = safeName(rel);
      if (!ok || !ok.startsWith('files/')) { const e = new Error(t('traversal')); e.code = 'path'; throw e; }
      if (zip.byName.get(ok)) wanted.set(ok, ok);
      const stem = ok.slice(0, ok.lastIndexOf('.'));
      stems.add(stem); stems.add(dirOf(ok));
    }
  }
  for (const name of zip.byName.keys()) {
    const ok = safeName(name);
    if (!ok || !ok.startsWith('files/')) continue;
    if (ok.endsWith('song.jamc.json') && stems.has(dirOf(ok))) wanted.set(ok, ok);
    else if (ok.endsWith('.jamc.json') && stems.has(ok.slice(0, ok.lastIndexOf('.')))) wanted.set(ok, ok);
  }

  // FR 002/004: every referenced audio file must actually exist in the zip —
  // a dangling audioPath fails the whole import, never a silently-skipped track
  for (const s of idx.songs || []) {
    if (s.audioPath && !zip.byName.get(safeName(s.audioPath))) {
      const e = new Error(`${s.title || 'song'}: ${t('missingAudio')}`); e.code = 'missing'; throw e;
    }
  }

  const importTag = crypto.randomUUID();
  const bundlePreviewID = (man.bundleID || '').toUpperCase()
    || (await sha256hex((idx.songs || []).map(s => s.uid || s.audioPath).sort().join('|'))).slice(0, 32);

  try {
    for (const [name] of wanted) {
      const entry = zip.byName.get(name);
      const blob = await zip.extract(entry);
      await media.storeFile(bundlePreviewID, importTag, name.slice('files/'.length), blob);
    }
  } catch (e) {
    await media.dropBundle(bundlePreviewID).catch(() => {});
    throw e;
  }

  async function sidecarOf(audioRel) {
    const rel = audioRel.slice('files/'.length);
    const dir = rel.split('/').slice(0, -1).join('/');
    for (const cand of [`${dir}/song.jamc.json`, `${rel.slice(0, rel.lastIndexOf('.'))}.jamc.json`]) {
      try {
        const doc = JSON.parse(await (await media.bundleFile(bundlePreviewID, importTag, cand)).text());
        return doc;
      } catch { /* next candidate */ }
    }
    return null;
  }
  const bundle = await normalizeBundle(man, idx, sidecarOf, file.name, file.size);
  bundle.mediaTag = importTag;
  // FR 015 replacement semantics: newer revision of same id replaces the old dir after publish
  await meta.putBundle(bundle);   // publish point — single record flip
  // FR 015: the superseded revision is NOT deleted here. An open session may
  // still be playing through it (next track resolves by the OLD mediaTag),
  // and the reviewer was right: immediate cleanup can eat live audio. The
  // boot sweep already reaps every unreferenced folder — deferred by design.
  return bundle;
}

// ─── state ─────────────────────────────────────────────────────────────────
const audio = new window.Audio();
audio.preservesPitch = false;
let bundles = [];
let view = { screen: 'sets', bundle: null, setlist: null, queue: null, qi: -1 };
let loop = null;              // {s, e, fragIdx}
let loopTimer = null;
let autoAdvance = false;
// device-local mixer: user volume multiplies the per-song gain; remembered here only
const storedVol = localStorage.getItem('jc-vol');
let userVol = storedVol === null ? 1 : Number(storedVol);
if (!Number.isFinite(userVol) || userVol < 0 || userVol > 1) userVol = 1;
let volBase = 1; // normalized song gain, set at load
const applyVol = () => { audio.volume = Math.min(1, volBase * userVol); };
let wakeLock = null;
const mirrorK = new URLSearchParams(location.search).get('k');
let macState = null;
let es = null;

// ─── audio engine ──────────────────────────────────────────────────────────
function clearLoopWatch() { if (loopTimer) { clearInterval(loopTimer); loopTimer = null; } }

function startLoopWatch() {
  clearLoopWatch();
  // 50 ms poll of currentTime + rewind seek — the <audio>-only loop, chosen
  // deliberately: WebAudio graphs break iOS background playback (see research doc)
  loopTimer = setInterval(() => {
    if (!loop || audio.paused) return;
    if (audio.currentTime >= loop.e - 0.05) audio.currentTime = loop.s;
  }, 50);
}

async function playSong(song) {
  const b = view.bundle;
  loop = null; clearLoopWatch();
  let url;
  if (b.kind === 'mirror') {
    url = new URL(`api/audio/${song.uid}?k=${mirrorK}`, location.href).href;
  } else {
    try { url = await media.fileURL(b.id, b.mediaTag, (song.audioRel || '').slice('files/'.length)); }
    catch { toast(`${song.title} — ${t('missingAudio')}`); return; }
  }
  audio.src = url;
  const base = song.gain * b.scale;
  volBase = Number.isFinite(base) ? Math.min(1, Math.max(0, base)) : 1;
  applyVol();
  await audio.play().catch(e => toast(String(e.name || '') === 'NotAllowedError' ? '▶ first tap (autoplay policy)' : e.message));
  if (loop) startLoopWatch();
  updateNow();
  publishMediaSession(song);
}

audio.addEventListener('ended', () => {
  if (loop) return;               // loops never reach 'ended'
  if (autoAdvance && view.queue) next(true);
});
audio.addEventListener('play', () => { if (loop) startLoopWatch(); updateNow(); });
audio.addEventListener('pause', () => { updateNow(); });
audio.addEventListener('ended', () => { updateNow(); });
audio.addEventListener('timeupdate', () => updateScrub());

function prev() {
  if (view.qi > 0 && (audio.currentTime < 3 || !view.queue)) { view.qi--; }
  else view.qi = Math.max(0, view.qi); // restart-then-back iPhone rule (spec 7.4)
  playSong(view.queue[view.qi]);
}
function next(auto = false) {
  if (view.qi + 1 < view.queue.length) { view.qi++; playSong(view.queue[view.qi]); }
  else if (!auto) { audio.pause(); audio.currentTime = 0; }
}

function publishMediaSession(song) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: song.artist, album: view.bundle.title });
    const h = { play: () => audio.play(), pause: () => audio.pause(),
                previoustrack: prev, nexttrack: () => next() };
    for (const [k, fn] of Object.entries(h)) { try { navigator.mediaSession.setActionHandler(k, fn); } catch {} }
  } catch { /* best effort per FR 012 */ }
}

// ─── screens (render-on-demand, hash-free tiny router) ────────────────────
const $ = sel => document.querySelector(sel);

function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => el.hidden = true, 3200); }

function render() {
  document.documentElement.lang = LANG;
  $('#app-title').textContent = t('appTitle');
  if (view.screen === 'sets') renderSets();
  else if (view.screen === 'set') renderSet();
  else renderNow();
}

function renderSets() {
  const el = $('#screen');
  if (!bundles.length) {
    el.innerHTML = `
      <div class="firstrun">
        <div class="bigicon">♬</div>
        <h2>${esc(t('empty'))}</h2>
        <p>${esc(t('firstRun'))}</p>
        <button class="cta" id="btn-import">${esc(t('importSet'))}</button>
        <p><button class="ghost sm" id="btn-demo">${esc(t('demoSet'))}</button></p>
        <p class="dim small">${esc(t('offlineHint'))}</p>
        <p class="dim small">${esc(t('macTip'))}</p>
      </div>`;
  } else {
    el.innerHTML = `<div class="cards">` + bundles.map(b => `
      <div class="card" data-b="${esc(b.id)}">
        <div class="card-title">${esc(b.title)}</div>
        <div class="dim small">${cnt(b.songs.length, 'song', 'песня', 'песни', 'песен')} · ${cnt(b.setlists.length, 'setlist', 'сет-лист', 'сет-листа', 'сет-листов')} · ${(b.byteSize / 1e6).toFixed(1)} MB</div>
        ${b.kind === 'mirror' ? `<div class="dim xs">📡 ${esc(t('live'))}</div>` : ''}
        ${b.scaled ? `<div class="dim xs">${esc(t('gainNote'))} ×${b.scale.toFixed(2)}</div>` : ''}
        <div class="card-actions">
          <button class="cta sm" data-open="${esc(b.id)}">${esc(t('start'))}</button>
          ${b.kind === 'mirror'
            ? `<button class="ghost sm" id="btn-refresh">${esc(t('refresh'))}</button>`
            : `<button class="ghost sm" data-del="${esc(b.id)}">${esc(t('delete'))}</button>`}
        </div>
        ${b.setlists.map(s => `<button class="setline" data-set="${esc(b.id)}" data-sid="${esc(s.id)}">▶ ${esc(s.name)} <span class="dim">(${s.songUIDs.length})</span></button>`).join('')}
      </div>`).join('') + `</div>
      ${bundles.some(x => x.kind === 'mirror') ? `
      <div class="offlinebox">
        <div class="offline-head">✈️ ${esc(t('offlineTitle'))}</div>
        <p class="dim small">${esc(t('offlineText'))}</p>
        ${window.isSecureContext ? '' : `<p class="dim xs">${esc(t('httpWarn'))}</p>`}
        <div class="row"><button class="cta sm" id="btn-import">${esc(t('importSet'))}</button>
        <button class="ghost sm" id="btn-settings">⚙</button></div>
        <p class="dim xs">${esc(t('keepZip'))}</p>
      </div>` : `
      <div class="row"><button class="cta" id="btn-import">${esc(t('importSet'))}</button>
      <button class="ghost" id="btn-settings">⚙</button></div>
      <p class="dim small keep">${esc(t('keepZip'))}</p>`}`;
  }
  $('#btn-import')?.addEventListener('click', () => $('#file').click());
  $('#btn-demo')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true; ev.target.textContent = t('demoLoading');
    try {
      const r = await fetch('fixtures/real-library.jamcrate.zip');
      if (!r.ok) throw new Error('fixture unavailable');
      await importFile(new File([await r.blob()], 'real-library.jamcrate.zip'));
      bundles = await meta.allBundles(); render();
    } catch (e) { toast(String(e.message || e)); render(); }
  });
  $('#btn-settings')?.addEventListener('click', renderSettings);
  $('#btn-refresh')?.addEventListener('click', () => mirrorBoot(true));
  el.querySelectorAll('[data-open]').forEach(btn => btn.addEventListener('click', () => {
    const b = bundles.find(x => x.id === btn.dataset.open);
    openSetlist(b, b.setlists[0] ?? { id: 'all', name: b.title,
      songUIDs: b.songs.filter(x => x.audioRel !== undefined || b.kind === 'mirror').map(x => x.uid) });
  }));
  el.querySelectorAll('[data-set]').forEach(btn => btn.addEventListener('click', () => {
    const b = bundles.find(x => x.id === btn.dataset.set);
    openSetlist(b, b.setlists.find(s => s.id === btn.dataset.sid));
  }));
  el.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm(t('deleteAsk'))) return;
    const id = btn.dataset.del;
    const b = bundles.find(x => x.id === id);
    await meta.deleteBundle(id); await media.dropBundle(id);
    bundles = bundles.filter(x => x.id !== id); render();
  }));
}

function openSetlist(b, set) {
  if (!set || !set.songUIDs.length) { toast(t('empty')); return; }
  view.bundle = b;
  view.setlist = set;
  view.queue = set.songUIDs.map(uid => b.songs.find(s => s.uid === uid)).filter(Boolean);
  view.qi = 0;
  view.screen = 'set';
  render();
}

function renderSet() {
  const b = view.bundle;
  const el = $('#screen');
  el.innerHTML = `
    <button class="back" id="b-back">‹ ${esc(t('sets'))}</button>
    <h2>${esc(view.setlist.name)}</h2>
    <ol class="songlist">` +
    view.queue.map((s, i) => `
      <li data-i="${i}" class="${i === view.qi ? 'current' : ''}">
        <span class="idx">${i + 1}</span>
        <span class="ttl">${esc(s.title)}</span>
        <span class="dim">${esc(s.artist)}${s.duration ? ' · ' + fmt(s.duration) : ''}</span>
        ${b.kind === 'mirror' ? `<button class="macbtn" data-mac="${esc(s.uid)}" title="${esc(t('playOnMac'))}">${esc(t('playOnMac'))}</button>` : ''}
      </li>`).join('') + `
    </ol>
    <div class="row"><button class="cta" id="b-play">${esc(t('start'))} ▸</button></div>`;
  $('#b-back').addEventListener('click', () => { view.screen = 'sets'; render(); });
  $('#b-play').addEventListener('click', () => { view.screen = 'now'; render(); playSong(view.queue[view.qi]); });
  el.querySelectorAll('li').forEach(li => li.addEventListener('click', () => {
    if (li.querySelector('.macbtn')?.dataset.hit) return;
    view.qi = Number(li.dataset.i); view.screen = 'now'; render(); playSong(view.queue[view.qi]);
  }));
  el.querySelectorAll('[data-mac]').forEach(btn => btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    btn.dataset.hit = '1';
    fetch(`api/cmd?k=${mirrorK}&load=${btn.dataset.mac}&play=1`).catch(() => {});
    setTimeout(() => btn.dataset.hit = '', 800);
  }));
}

function fmt(sec) { sec = Math.max(0, sec | 0); return `${(sec / 60) | 0}:${String(sec % 60).padStart(2, '0')}`; }

function renderNow() {
  const b = view.bundle, s = view.queue[view.qi];
  const frags = (s.fragments || []);
  $('#screen').innerHTML = `
    <button class="back" id="n-back">‹ ${esc(t('sets'))}</button>
    <div class="now">
      <div class="ntitle">${esc(s.title)}</div>
      <div class="dim">${esc(s.artist)}${s.key ? ' · ' + esc(s.key) : ''}${s.bpm ? ' · ' + esc(s.bpm) + ' bpm' : ''}</div>
      <input type="range" id="scrub" min="0" max="1000" value="0">
      <div class="times"><span id="t-cur">0:00</span><span class="dim" id="t-dur">${s.duration ? fmt(s.duration) : ''}</span></div>
      <div class="controls">
        <button id="c-prev">⏮</button>
        <button id="c-play" class="playbtn">▶</button>
        <button id="c-next">⏭</button>
      </div>
      <div class="row volrow"><span class="dim small">${esc(t('volume'))}</span><input type="range" id="vol" min="0" max="100" value="${Math.round(userVol * 100)}" aria-label="${esc(t('volume'))}"><span class="dim small" id="volpct">${Math.round(userVol * 100)}%</span></div>
      <div class="frags">
        <button class="chip ${!loop ? 'on' : ''}" data-f="-1">${esc(t('fullSong'))}</button>
        ${frags.map((f, i) => f.open
          ? `<button class="chip pt" data-p="${esc(f.s.toFixed(2))}">• ${esc(f.label)} ${fmt(f.s)}</button>`
          : `<button class="chip ${loop && loop.fragIdx === i ? 'on' : ''}" data-f="${i}">↻ ${esc(f.label)} ${fmt(f.s)}–${fmt(f.e)}</button>`).join('')}
      </div>
      <div class="row spread small dim">
        <label><input type="checkbox" id="c-auto" ${autoAdvance ? 'checked' : ''}> ${esc(t('autoAdvance'))}</label>
        <label><input type="checkbox" id="c-wake" ${wakeLock ? 'checked' : ''}> ${esc(t('keepAwake'))}</label>
      </div>
    </div>`;
  $('#n-back').addEventListener('click', () => { view.screen = 'sets'; render(); });
  $('#c-play').addEventListener('click', () => { if (audio.paused) audio.play(); else audio.pause(); });
  $('#c-prev').addEventListener('click', prev);
  $('#c-next').addEventListener('click', () => next());
  $('#vol').addEventListener('input', e => {
    userVol = e.target.value / 100;
    localStorage.setItem('jc-vol', String(userVol));
    applyVol();
    $('#volpct').textContent = e.target.value + '%';
  });
  $('#scrub').addEventListener('input', e => {
    if (s.duration) {
      audio.currentTime = (e.target.value / 1000) * (audio.duration || s.duration);
      if (loop) { loop = null; clearLoopWatch(); renderNow(); } // seek-out cancels loop (spec 7.3 rec.)
    }
  });
  $('#c-auto').addEventListener('change', e => { autoAdvance = e.target.checked; meta.setSetting('autoAdvance', autoAdvance); });
  $('#c-wake').addEventListener('change', async e => {
    if (e.target.checked && 'wakeLock' in navigator) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch { e.target.checked = false; } }
    else if (wakeLock) { await wakeLock.release().catch(() => {}); wakeLock = null; }
  });
  document.querySelectorAll('[data-f]').forEach(ch => ch.addEventListener('click', () => {
    const i = Number(ch.dataset.f);
    if (i < 0) { loop = null; clearLoopWatch(); }
    else { loop = { s: frags[i].s, e: frags[i].e, fragIdx: i }; audio.currentTime = frags[i].s; startLoopWatch(); }
    if (audio.paused) audio.play().catch(() => {});   // tapping a fragment on a stopped track starts it
    renderNow();
  }));
  document.querySelectorAll('[data-p]').forEach(ch => ch.addEventListener('click', () => {
    audio.currentTime = Number(ch.dataset.p) + 0.01; if (loop) { loop = null; clearLoopWatch(); }
    if (audio.paused) audio.play().catch(() => {});
    renderNow();
  }));
  updateNow();
}

function updateNow() {
  const pb = $('#c-play'); if (pb) pb.textContent = audio.paused ? '▶' : '⏸';
}
function updateScrub() {
  const el = $('#scrub'); if (!el) return;
  const dur = audio.duration || (view.queue && view.queue[view.qi]?.duration) || 0;
  if (dur) el.value = String(Math.round((audio.currentTime / dur) * 1000));
  const tc = $('#t-cur'); if (tc) tc.textContent = fmt(audio.currentTime);
}

// ─── settings sheet ────────────────────────────────────────────────────────
function renderSettings() {
  const el = $('#settings');
  el.hidden = false;
  el.innerHTML = `
    <div class="sheet">
      <h3>${esc(t('language'))}</h3>
      <select id="s-lang">
        <option value="system">—</option><option value="en">English</option><option value="ru">Русский</option>
      </select>
      <h3>${esc(t('autoAdvance'))}</h3><input type="checkbox" id="s-auto" ${autoAdvance ? 'checked' : ''}>
      <h3 id="s-stor-h">${esc(t('storage'))}</h3><div id="s-stor" class="dim">…</div>
      <button class="cta" id="s-close">${esc(t('close'))}</button>
    </div>`;
  media.usage().then(u => { $('#s-stor').textContent = u ? `${(u.usage / 1e6).toFixed(1)} / ${(u.quota / 1e6).toFixed(0)} MB` : '?'; });
  const sel = $('#s-lang');
  meta.getSetting('lang').then(v => sel.value = v || 'system');
  sel.addEventListener('change', async () => {
    await meta.setSetting('lang', sel.value);
    await applyLang(); render();
  });
  $('#s-auto').addEventListener('change', e => { autoAdvance = e.target.checked; meta.setSetting('autoAdvance', autoAdvance); });
  $('#s-close').addEventListener('click', () => el.hidden = true);
}

async function applyLang() {
  const pref = await meta.getSetting('lang');
  LANG = (pref && pref !== 'system') ? pref : ((navigator.language || 'en').startsWith('ru') ? 'ru' : 'en');
  setLabels(t, LANG);
}

// ─── mirror mode ───────────────────────────────────────────────────────────
async function mirrorBoot(isRefresh = false) {
  try {
    const r = await fetch(`api/index?k=${mirrorK}`);
    if (!r.ok) throw new Error(r.status === 401 ? 'bad token' : String(r.status));
    const j = await r.json();
    const songs = j.songs.map(sd => ({
      uid: sd.uid, title: sd.title, artist: sd.artist,
      audioRel: null, duration: numOrNull(sd.duration), gain: Number.isFinite(sd.gain) ? sd.gain : 1.0,
      key: sd.key ?? null, bpm: numOrNull(sd.bpm), fragments: pairFragments(sd.markers),
    }));
    const byUid = new Map(songs.map(x => [x.uid, x]));
    const setlists = (j.setlists || []).map(st => ({
      id: st.id, name: st.name, songUIDs: (st.songUIDs || []).filter(u => byUid.has(u)),
    })).filter(x => x.songUIDs.length);
    const maxGain = Math.max(1e-6, ...songs.map(x => Math.min(Math.max(x.gain, 0), 4)));
    const scale = maxGain > 1.0 ? 1.0 / maxGain : 1.0;
    const bundle = {
      id: 'mirror', kind: 'mirror', title: j.libraryTitle || 'JamCrate',
      importedAt: j.generatedAt || new Date().toISOString(), byteSize: 0,
      scale, scaled: scale < 1.0, songs, setlists, srcName: 'live',
    };
    bundles = [bundle];
    if (!isRefresh) {
      view.screen = bundle.setlists.length ? 'sets' : 'sets';
      if (!bundle.songs.length) toast('empty library');
    } else if (view.setlist) {                    // live-refresh keeps the open set in sync
      const fresh = bundle.setlists.find(s => s.name === view.setlist.name);
      if (fresh) { const q = fresh.songUIDs.map(u => byUid.get(u)).filter(Boolean); view.queue = q; if (view.qi >= q.length) view.qi = 0; }
    }
    render();
    if (!es) {
      es = new EventSource(`api/stream?k=${mirrorK}`);
      es.addEventListener('state', ev => { try { macState = JSON.parse(ev.data); renderMacBar(); } catch {} });
      es.onerror = () => { /* server gone — badge freezes */ };
    }
  } catch (e) {
    document.querySelector('#screen').innerHTML =
      `<div class="firstrun"><div class="bigicon">📡</div><h2>${esc(t('importFailed'))}</h2><p>${esc(e.message === '401' || String(e).includes('bad token') ? 'bad token — scan the QR again' : 'Mac unreachable')}</p></div>`;
  }
}

function renderMacBar() {
  let bar = document.querySelector('#macbar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'macbar'; document.body.appendChild(bar); }
  if (!macState) { bar.hidden = true; return; }
  const on = macState.playing;
  bar.hidden = false;
  bar.innerHTML = `🖥 ${esc(on ? t('macPlaying') : t('macPaused'))} <b>${esc(macState.title || '')}</b> <span class="dim">${fmt(macState.pos || 0)}/${fmt(macState.dur || 0)}</span>`;
}

// ─── boot ──────────────────────────────────────────────────────────────────
async function boot() {
  if (mirrorK) {                       // mirror: nothing local, straight to live
    await applyLang();
    await mirrorBoot();
    return;
  }
  await applyLang();
  bundles = await meta.allBundles();
  autoAdvance = !!(await meta.getSetting('autoAdvance'));
  const live = new Set(bundles.map(b => `${b.id}/${b.mediaTag}`));
  await media.sweepOrphans(live);
  $('#file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    toast(t('importing'));
    try {
      await importFile(f);
      bundles = await meta.allBundles();
      toast(t('imported'));
      render();
    } catch (err) {
      console.warn(err);
      toast(`${t('importFailed')}: ${err.code === 'ver' ? 'format ' + (err.message || '') : err.message || t('corrupt')}`);
    }
    e.target.value = '';
  });
  render();
}

window.__jc = { get bundles() { return bundles; }, get audio() { return audio; }, get loop() { return loop; }, get view() { return view; }, importFile, normalizeBundle };
boot();

// service worker: only meaningful in a secure context; on the mirror's
// http://IP origin register() rejects — swallow it (was an unhandled rejection)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
