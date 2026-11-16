# Architecture

> Filled in branch by branch; the final version is kept to one page.

## Stack and why

A **static site in plain HTML, CSS and JavaScript (ES modules)** with a `<canvas>` renderer. No backend, no framework, no build step.

- **Static:** free, instant hosting; a Level Designer needs only a link, and there is no server to keep alive.
- **No framework:** one screen whose work is data and drawing, not UI state. The code a reviewer reads is the code that runs.
- **Canvas, not SVG/DOM:** combined views draw tens of thousands of points at 60 fps during playback.
- **Parquet parsed in the browser:** new data drops can be added through the app, without an engineer re-running a pipeline.

## Dependencies: what is borrowed and what is written

The rule: use a library for solved, specialised problems (binary file formats); write everything that encodes knowledge about *this* game's data.

| Part | Source | Why this choice |
|---|---|---|
| Parquet decoding | **hyparquet**, vendored in `vendor/hyparquet/` (MIT) | Parquet is a complex binary format (Thrift metadata, Snappy compression, encodings). hyparquet is small, pure JavaScript, has no dependencies, and runs unchanged in the browser and Node. Writing a decoder would take days and add risk for no product value |
| Zip decoding | **fflate**, vendored in `vendor/fflate.js` (MIT) | Designers may upload the drop as a `.zip`; fflate is small, fast and dependency-free |
| Minimap images | LILA Games, `assets/minimaps/` | Originals are 4320², 2160×2158 and 9000² px; re-encoded to ~2048 px WebP so the page loads fast. Coordinates are mapped in 0–1 UV space, so image size does not matter |
| Data rules on top of the parsers | **Written for this project**, `js/` | Detect parquet by its `PAR1` bytes, decode event names from raw bytes, fix the `ts` unit (seconds, not ms), classify bots by events not IDs, dedupe files, group journeys into matches. This is where the data's real problems are |
| UI, rendering, playback, heatmaps | **Written for this project**, `js/`, `css/` | Plain DOM and Canvas 2D APIs |
| Developer and data tools | **Written for this project**, `tools/` | See below |

**Why vendored, not loaded from a CDN or npm:** the app works offline, has no install step, and cannot break if a CDN goes down or a package changes. The libraries are pinned by being copied; each keeps its LICENSE file.

## Tools written for this project

Data is processed by code tools in this repo, not by hand and not by AI. Each tool takes the data folder as an argument (works on any future drop), gives the same output for the same input, writes plain CSV/JSON, and exits non-zero when a critical check fails.

| Script | Reads | Writes | Status |
|---|---|---|---|
| `tools/serve.mjs` | the repo | serves it on `localhost:8000` | in repo |
| `tools/convert.mjs` | raw parquet folder | `data/default/dataset.json`, `out/convert-report.json` | in repo |
| `tools/extract.mjs` | raw parquet folder or zip | `files.csv`, `journeys.csv`, `matches.csv`, `events.csv` | planned |
| `tools/audit.mjs` | extract output | `audit.md`, `audit.json` | planned |
| `tools/compare.mjs` | two extract outputs | `compare.md`, `compare.csv` | planned |
| `tools/query.mjs` | extract output + filters | a filtered CSV | planned |

The tools import the same parsing module as the browser (`js/parse.js`), so the app and the audit can never disagree about the data.

## Data flow

```
raw drop: day folders of parquet files (*.nakama-0)
        │  tools/convert.mjs  (Node, run once per drop)
        ▼
js/data/parse.js        one file → one journey: PAR1 check, read with hyparquet,
                        decode event bytes, ts seconds/ms by magnitude, bot by events
        ▼
js/data/build-dataset.js  merge files of the same journey, drop repeated rows, group into
                        matches, date rule, counts, data-health report
        ▼
data/default/dataset.json  (≈1.8 MB, ≈600 KB gzipped; deterministic)
        │  fetch()
        ▼
browser: js/data/load-dataset.js → js/map/map-canvas.js + overlays → screen
```

Parsing happens once, ahead of time, so the first page load is a single JSON fetch instead of reading 1,243 binary files. The same two modules run in the browser too, so in-app upload of a new drop can reuse them unchanged.

**Dataset format** (`schema_version: 1`): `matches[]` each with `id`, `map`, `date`, `start` (Unix s), `duration` (s), `humans`, `bots`, `counts`, and `journeys[]` with `user_id`, `bot`, `id_conflict`, `path` (flat `[t, x, z, …]`, t in seconds from match start, x/z to 0.1) and `events` (`[event, t, x, z]`). `health` lists every anomaly found.

## Coordinate mapping

From the data README: `u = (x − originX) / scale`, `v = (z − originZ) / scale`, image pixel `= (u · width, (1 − v) · height)`. Settings per map live in `data/maps.json`.

- **`x` and `z` are the ground plane; `y` is height** and is ignored on the 2D map.
- **Image Y points down**, so `v` is flipped: the world origin is the image's bottom-left corner.
- **The images are not 1024 px.** The README assumes 1024×1024, but the originals are 4320², 2160×2158 and 9000² px, and the app uses ~2048 px WebP copies. So `js/map/mapping.js` stops at **UV (0–1)** and the canvas multiplies by the size the map is actually drawn at. Any image resolution, zoom level or screen size works with the same numbers.
- **Aspect ratio is kept** when fitting the map to the screen ("contain" fit), so distances are not stretched.
- **Proof:** `test/mapping.test.js` checks the README's worked example, (−301.45, −355.55) on Ambrose Valley → pixel (78, 890) on 1024 px, plus corner, flip and scale cases. In the app, `?check=mapping` draws the map frame, its world corners and the README point for a visual check.

## Assumptions about the data

| What we found | Evidence | How it is handled |
|---|---|---|
| `ts` is labelled milliseconds but holds Unix **seconds** | As ms, every match would be in Jan 1970 and last under a second; as seconds they fall on 10–14 Feb 2026 | Unit chosen by magnitude (< 1e11 = seconds); resolution is 1 s, so file order breaks ties |
| `event` is raw bytes | No UTF-8 annotation in the parquet schema | Decoded as UTF-8 text |
| Files have no `.parquet` extension | `*.nakama-0` | Detected by the `PAR1` header |
| A numeric ID does not always mean a bot | 17 journeys from numeric IDs log `Position` and `Loot` | Bot/human decided by movement events; ID rule only as fallback; each conflict listed in `health` |
| One file is duplicated | Same journey in `February_10` and `February_11`, 88 identical rows | Merged by (player, match); rows repeated across files dropped, repeats within one file kept |
| Day folders do not always match the UTC start date | 4 matches; 1 match spans two folders | Date = folder name, else earliest folder, else UTC start date; mismatches listed |
| Most matches are partial | 743 of 796 matches have one recorded journey | Kept, counted, and filterable |
| `match_id` ends in `.nakama-0` | README: server-instance suffix | Suffix removed so all files of a match group together |

## Trade-offs

| Considered | Decided | Why |
|---|---|---|
| React / a framework | Plain ES modules | One screen, mostly canvas; no build step, every line explainable |
| CDN or npm packages | Vendored copies | Works offline, no install, no supply-chain surprises |
| Writing a parquet decoder | hyparquet | Solved problem; time goes into the data rules instead |
| Python for data tools | Node.js | Same language as the app, so one parser serves both |
