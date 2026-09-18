# JamCrate Player (prototype)

Read-only companion to the JamCrate macOS app: import a `.jamcrate.zip`
(exactly the Backup ▸ Export format of v0.8.0), play with solo-marker loops.
Runs in any modern browser; installable PWA; everything stays on-device.

## Run locally

```sh
cd player
python3 -m http.server 8124 --bind 0.0.0.0
# open http://localhost:8124   (localhost counts as a secure context:
# OPFS, IndexedDB and the service worker all work without HTTPS)
```

For a phone on the same Wi-Fi use `http://<mac-ip>:8124` (iOS Safari tab is
the primary real-world path until player.jamcrate.app ships with TLS).

## Try it in one minute

1. Press **Import Set**.
2. Pick `fixtures/real-library.jamcrate.zip` — a bundle built by the *real*
   desktop exporter (3 songs, 2 setlists, Cyrillic names, m4a+wav, gains
   0.5/1.0/1.6, solo markers, one repeated song, one dangling reference).
3. Open *Friday Cafe Set* ▸ **Start** ▸ tap a ↻ chip on Now Playing → the
   1–2 s band loops forever. Kill the server, reload the page — still plays
   (service worker + OPFS).
4. Edge bundles: `evil-traversal` / `corrupt` / `toobig-index` /
   `no-manifest` / `missing-audio` must all refuse with a one-line reason;
   `zip-bomb` imports cleanly **without** inflating its 20 MB payload
   (the index never references it — whitelist skips it).

Regenerate fixtures after desktop model changes:

```sh
./tools/make_fixtures.sh
```

## Layout

| file | role |
|---|---|
| `index.html` / `app.css` | shell, mobile-first dark UI |
| `app.js` | screens (Sets / Setlist / Now), importer pipeline, `<audio>` engine, RU/EN |
| `zipimport.js` | dependency-free ZIP central-directory reader + `DecompressionStream('deflate-raw')`, ZIP64, size/path guards |
| `storage.js` | IndexedDB metadata + OPFS media, revision folders, orphan sweep |
| `sw.js` | app-shell cache (bump `V` when any file changes!) |
| `manifest.webmanifest` | PWA install metadata |

## Hosting

- **Mirror mode needs no hosting at all** — the client ships inside the Mac app
  and is served straight from the QR URL (`http://<mac>:8090/?k=…`). Offline
  *copy* buttons there are explained but limited: OPFS requires a secure
  context, so installs/imports live at **https://player.jamcrate.app**
  (repo `vitas/jamcrate-player`, GitHub Pages; sync via `tools/publish_player.sh`).
- DNS for the subdomain: `CNAME player → vitas.github.io` (GitHub issues TLS
  automatically once the record resolves).

Status: prototype for the v0.1 spec — see
[`docs/player-prototype-findings.md`](../docs/player-prototype-findings.md)
for what was verified and everything that went wrong while building it.
