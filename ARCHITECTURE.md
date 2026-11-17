# Architecture

## What it is built with, and why

A **static site in plain HTML, CSS and JavaScript (ES modules)** that draws on `<canvas>`. There is no backend, no framework and no build step. Node.js runs only the data tools and tests.

- **Static:** hosting is free and instant, a Level Designer needs only a link, and there is no server to keep alive.
- **No framework:** the tool is one screen whose work is data and drawing, not UI state. One-way data flow (`app.set(patch)` → state → derived view → panels + canvas) keeps it predictable, and the code a reviewer reads is the code that runs.
- **Canvas, not SVG or DOM elements:** a day view draws about 70,000 path points and 12,000 markers.
- **Parquet parsed in the browser** (hyparquet, vendored): a new data drop can be added through the app without an engineer.
- **The same parser in Node and the browser:** the data tools, the bundled sample and in-app uploads all go through `js/data/parse.js` and `js/data/build-dataset.js`, so they can never disagree.

## Data flow

```
raw drop (day folders of *.nakama-0 parquet)          designer drops files/folders/.zip in the app
        │ tools/convert.mjs (Node, once per drop)               │ Web Worker (js/data/import-worker.js)
        ▼                                                       ▼
parse.js        one file → one journey: PAR1 check, hyparquet, event bytes → text,
                ts unit by magnitude, bot by events (ID rule as fallback)
build-dataset.js  merge files of one journey, drop repeated rows, group into matches,
                date rule, counts, data-health report
        ▼                                                       ▼
data/default/dataset.json (1.8 MB, 0.6 MB gzipped)      merge.js → IndexedDB (survives reloads)
        └──────────────────────► app.js (state) ◄───────────────┘
                 select.js (filters, playhead) · heatmap.js (grids) · URL ⇄ state (share links)
                                     ▼
            map-canvas.js: cached base layer (minimap) + overlays redrawn per frame
            (heatmap → bot paths → human paths → markers → player heads)
```

The sample is pre-converted, so the first load is one JSON fetch rather than 1,243 binary files. The `tools/` scripts (extract → audit → query/compare/stats) write plain CSV and JSON for each drop. Every number in INSIGHTS.md comes from them, not from reading data by hand.

## Coordinate mapping: world → minimap

From the data README: `u = (x − originX) / scale` and `v = (z − originZ) / scale`, with scale and origin per map in `data/maps.json`.

1. **The ground plane is `x` and `z`.** `y` is height and is ignored on the 2D map.
2. **The image's Y axis points down**, so the app draws `(u, 1 − v)`. The world origin is the image's bottom-left corner.
3. **The images are not 1024 px.** The README assumes 1024 px, but the originals are 4320², 2160×2158 and 9000², and the app ships about 2048 px WebP copies. So `mapping.js` stops at **UV (0–1)**, and the canvas multiplies by the rectangle the map is drawn in. Zoom, pan, screen size and image resolution then never touch the mapping, and a non-square image still works.
4. **The aspect ratio is kept** (a "contain" fit), so distances are not stretched.
5. **Proof:**
   - A test runs the README's worked example, (−301.45, −355.55) on Ambrose Valley → pixel (78, 890) at 1024 px, plus corner and flip cases.
   - The audit counts points outside 0–1: zero in this drop.
   - `?check=mapping` draws the map frame and the README point on screen for a visual check.

## Assumptions where the data was ambiguous

| What we ran into | Evidence | What we did |
|---|---|---|
| `ts` is labelled ms but holds Unix **seconds** | As ms, every match is in Jan 1970 and lasts under 1 s | Unit by magnitude (< 1e11 = seconds) |
| `event` is raw bytes; files have no `.parquet` extension | Parquet schema; `*.nakama-0` names | Decode UTF-8; detect parquet by its `PAR1` header |
| A numeric ID does not always mean a bot | 17 journeys from IDs 1429, 1402 and 1379 log `Position` and `Loot` | Bot or human decided by movement events; the ID rule is only a fallback; conflicts are shown in Data health |
| Bots log `BotKill` and `BotKilled` too; the README defines them only for humans | A bot's `BotKilled` coincides with a human's `BotKill` in 19 of 20 cases where both are recorded; a bot's `BotKill` with a human's `BotKilled` in 3 of 3 | Events describe the journey's owner: "Bot was killed" and "Bot killed a player". Kill and death **heatmaps count human journeys only**, so mirrored events are not counted twice |
| One file is duplicated; one match spans two day folders | Byte-identical file in `February_10` and `February_11` | Merged by (player, match); rows repeated across files dropped |
| Day folders do not always match the UTC start date | 4 matches start just before midnight but sit in the next folder | Date = folder name, else earliest folder, else UTC date |
| Most matches are partial | 743 of 796 matches have one recorded journey | Kept and counted; a "2+ players only" filter |
| 172 journeys keep moving after a death | 170 of them have exactly 1 position sample after it | Treated as a final position write and drawn as recorded |
| No walkability data for "ignored areas" | — | "Reachable" = any cell (64×64 grid) someone, human or bot, walked through in any match on that map. "Ignored" = reachable, but no human sample in or next to it in the current view |

## Trade-offs

| Considered | Decided | Why |
|---|---|---|
| React or another framework | Plain ES modules, one-way state | One screen, mostly canvas; no build step; every line explainable |
| Server or database | Static site + IndexedDB | Nothing to run or secure; uploads never leave the designer's browser. Cost: data is per browser, and a share link reproduces the view only on data the other person also has |
| Parse parquet at page load | Pre-converted sample, browser parsing for uploads | First load is one JSON fetch (0.6 MB gzipped); new drops still need no engineer |
| Parse on the main thread | Web Worker, main-thread fallback | One day (166 files) parses in about 75 ms without blocking the page; a full month stays responsive |
| Redraw everything every frame | Cached minimap layer, sprite-stamped markers, no markers while panning | All 566 Ambrose Valley matches: 32 ms per full redraw → 1 ms per frame while panning; single-match playback about 1 ms per frame |
| One colour per human everywhere | Per-player colours in one match; one colour with density-aware opacity when overlaid | 500 colours are noise; fading by 1/√n makes busy routes brighter than rare ones |
| Heatmap over the whole match | Heatmaps follow the playhead (time into each match) | Shows early-game vs late-game fights across many matches |
| Python for data tools | Node.js | Same language and parser as the app: one set of rules |
| CDN or npm packages | Vendored hyparquet and fflate (MIT) | Works offline, no install step, no supply-chain surprises |
