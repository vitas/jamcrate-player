// Persistence: metadata in IndexedDB, media in OPFS under a revision folder.
// Import publishes by flipping one IDB record — media never moves, so a
// crash mid-import leaves only an orphaned staging folder (swept on boot),
// never a half-known bundle (§5.2 / NFR 05).

const DB_NAME = 'jamcrate-player';
const DB_VERSION = 1;

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('bundles')) db.createObjectStore('bundles', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function tx(store, mode, fn) {
  return idb().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && out.__p ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

function get(store, key) {
  return idb().then(db => new Promise((res, rej) => {
    const r = db.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

export const meta = {
  allBundles: () => tx('bundles', 'readonly', s => { const r = s.getAll(); r.__p = 1; return r; }),
  putBundle: b => tx('bundles', 'readwrite', s => s.put(b)),
  getBundle: id => get('bundles', id),
  deleteBundle: id => tx('bundles', 'readwrite', s => s.delete(id)),
  getSetting: k => get('settings', k),
  setSetting: (k, v) => tx('settings', 'readwrite', s => s.put(v, k)),
  allSettings: () => tx('settings', 'readonly', s => { const r = s.getAll(); r.keys = undefined; r.__p = 1; return r; }),
  settingsKeys: () => idb().then(db => new Promise((res, rej) => {
    const r = db.transaction('settings').objectStore('settings').getAllKeys();
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  })),
};

export const media = {
  root: () => navigator.storage.getDirectory(),
  // bundles/<id>/<revTag>/… — the revTag is the import id; pointer lives in IDB
  async bundleDir(id, revTag, create = true) {
    const r = await this.root();
    const b = await r.getDirectoryHandle('bundles', { create: true });
    const i = await b.getDirectoryHandle(id, { create: true });
    return i.getDirectoryHandle(revTag, { create });
  },
  async storeFile(id, revTag, relPath, blob) {
    const parts = relPath.split('/');
    let dir = await this.bundleDir(id, revTag);
    for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true });
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  },
  async bundleFile(id, revTag, relPath) {
    const parts = relPath.split('/');
    let dir = await this.bundleDir(id, revTag, false);
    for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg);
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    return fh.getFile();
  },
  async fileURL(id, revTag, relPath) {
    return URL.createObjectURL(await this.bundleFile(id, revTag, relPath));
  },
  async dropBundle(id) {
    const r = await this.root();
    try { await r.getDirectoryHandle('bundles').then(b => b.removeEntry(id, { recursive: true })); } catch { /* already gone */ }
  },
  // remove staging/* leftovers from interrupted imports; bundles referenced
  // in IDB are untouched
  async sweepOrphans(liveTags) {
    try {
      const r = await this.root();
      const b = await r.getDirectoryHandle('bundles');
      const live = new Set(liveTags);
      const ids = [];
      for await (const [name] of b.entries()) ids.push(name);
      for (const id of ids) {
        const i = await b.getDirectoryHandle(id);
        const tags = [];
        for await (const [tag] of i.entries()) tags.push(tag);
        for (const tag of tags) if (!live.has(`${id}/${tag}`)) await i.removeEntry(tag, { recursive: true });
      }
    } catch { /* nothing staged */ }
  },
  async usage() {
    if (!navigator.storage?.estimate) return null;
    return navigator.storage.estimate();
  },
};
