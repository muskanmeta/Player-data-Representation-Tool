# LILA BLACK — Player Journeys

A browser tool for Level Designers: see where players move, fight, loot and die to the storm on each LILA BLACK map, and which areas they ignore. No tables and no engineer needed.

**Live:** _add the Cloudflare Pages URL here after the first deploy_

- [ARCHITECTURE.md](ARCHITECTURE.md): stack, data flow, coordinate mapping, assumptions and trade-offs (one page)
- [INSIGHTS.md](INSIGHTS.md): three findings about the game, made with this tool
- [tools/README.md](tools/README.md): the data tools and every column they write

## What it does

| Brief | In the tool |
|---|---|
| Load and parse the parquet data | Bundled 5-day sample loads on open. **Add data** reads raw parquet files (any name), day folders, `.zip` drops, CSV or an exported dataset in a Web Worker, then adds to or replaces the data and keeps it in the browser (IndexedDB) |
| Journeys on the correct minimap | World x/z → UV (0–1) → drawn rectangle; checked against the README example and an audit of off-map points |
| Humans vs bots | Humans: solid lines, one colour per player in a single match. Bots: dashed grey. Bots are classified by what they log, not by ID |
| Kills, deaths, loot, storm deaths | Six marker types, each with its own **shape and colour** (readable in greyscale), counts in the legend, and a toggle each |
| Filter by map, date, match | Map switcher, date chips with counts, a searchable and sortable match list, a "2+ players only" toggle, and an "all matches" overlay |
| Timeline and playback | Play or pause, 1–60× speed, scrubber with kill and death ticks, moving player heads, an optional 30 s trail, keyboard keys. In multi-match view the playhead is "time into each match" |
| Heatmaps | Human traffic, bot traffic, kill zones, death zones, storm deaths, loot, and **Ignored areas**. All follow the playhead, with a legend and opacity control |
| Shareable link | Map, date, match, heatmap, time, filters and layers live in the URL; **Copy link to view** |

Also included:
- zoom and pan;
- hover tooltips in plain language ("Killed by a bot · 3:12 into the match");
- click a marker to open its match at that moment;
- a player list with focus and hide;
- a summary panel;
- a **Data health** panel listing every anomaly found in the data;
- designed loading, empty, error and first-visit screens.

**Keyboard:**

| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play or pause |
| <kbd>←</kbd> <kbd>→</kbd> | Back or forward 5 s (with <kbd>Shift</kbd>: 30 s) |
| <kbd>Home</kbd> / <kbd>End</kbd> | Go to the start or the end |
| <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd> | Zoom in, zoom out, reset the view |
| <kbd>Esc</kbd> | Clear the player focus |

## Tech stack

Plain HTML, CSS and JavaScript (ES modules) with Canvas 2D. No framework, no build step, no backend. Node.js 22+ runs the data tools and tests only.

| Dependency | Kind | Used for | Licence |
|---|---|---|---|
| [hyparquet](https://github.com/hyparam/hyparquet) | vendored, `vendor/hyparquet/` | reading parquet in the browser and Node | MIT |
| [fflate](https://github.com/101arrowz/fflate) | vendored, `vendor/fflate.js` | opening `.zip` uploads | MIT |
| Minimap images | `assets/minimaps/` | 2048 px WebP copies of the minimaps in the data drop | © LILA Games |

There's nothing to install: the libraries are copied into `vendor/`, so the app works offline and cannot break if a CDN or package changes.

## Setup and running locally

```bash
git clone <this repo> && cd <repo>
git config core.hooksPath .githooks   # once per clone: enables the repo's git hooks
npm run serve                         # http://localhost:8000
```

Browsers block ES modules on `file://`, so the folder must be served. `tools/serve.mjs` is a dependency-free static server.

## Tests

```bash
npm test                                         # node:test, no dependencies
LILA_DATA=path/to/player_data npm test           # also runs the tests that read real data files
```

The tests cover:
- coordinate mapping, including the README example;
- the data rules: ts unit, byte decoding, PAR1 sniffing, bot classification, duplicates, the date rule, one map per match;
- filters and playhead maths;
- heatmap binning and ignored areas;
- dataset merging;
- CSV import;
- share-link round trips.

## Refreshing the data

```bash
node tools/extract.mjs path/to/player_data --out out/feb   # CSV tables
node tools/audit.mjs out/feb                               # data checks; exit 1 on critical problems
node tools/convert.mjs path/to/player_data                 # rewrites data/default/dataset.json
```

Raw data is never committed (`.gitignore`); only the processed `data/default/dataset.json` is. A new map needs one entry in `data/maps.json` (scale, origin, image).

## Deploying

The site is static: the repo root is the site.

**Cloudflare Pages:** connect the repo, framework preset **None**, build command **empty**, output directory **`/`**. Every pushed branch gets a preview URL. Netlify, Vercel or any static host works the same way.

## Environment variables

None. There is no backend, API key or build step.

## Project structure

```
index.html            the one page
css/                  tokens (colours, spacing, type) → base → layout → components
js/main.js            startup: load maps + data, restore the view from the URL
js/app.js             state and the one place it changes (app.set)
js/data/              parse · build-dataset · select (filters) · heatmap · merge · import (+ worker) · storage · events
js/map/               mapping (world → UV) · map-config · map-canvas (zoom, pan, cached base layer)
js/render/            layers (heatmap, paths, markers, heads) · markers (shapes, sprites)
js/ui/                sidebar · timeline · inspect (zoom, hover, click) · upload · url-state · dom
tools/                data tools (see tools/README.md) and the local server
test/                 node:test suites
vendor/               hyparquet, fflate (MIT, with LICENSE files)
```

## Licence

© 2026 Muskan Chauhan. All rights reserved. Shared for evaluation only; see [LICENSE](LICENSE).
