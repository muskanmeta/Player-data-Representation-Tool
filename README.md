# LILA BLACK — Player Journeys

A browser tool for Level Designers: see where players move, fight, loot and die to the storm on each LILA BLACK map.

**Live:** _link added once the site is deployed_

> Work in progress. This README is filled in feature by feature.

## Tech stack

Plain HTML, CSS and JavaScript (ES modules). No framework, no build step. Node.js (20.11+) is used only for the data tools and tests.

## Dependencies

**Nothing to install.** There is no `npm install` step: the two third-party libraries are copied into `vendor/` (vendored), so the app runs offline and cannot break if a CDN or package registry changes.

| Dependency | Kind | Used for | Licence | Status |
|---|---|---|---|---|
| Any modern browser (Chrome, Edge, Firefox, Safari) | runtime | runs the app | — | — |
| [Node.js](https://nodejs.org/) 20.11+ | dev only | data tools, tests, local server | MIT | required for development |
| [hyparquet](https://github.com/hyparam/hyparquet) | vendored, `vendor/hyparquet/` | reading parquet files in the browser and in Node | MIT | in repo |
| [fflate](https://github.com/101arrowz/fflate) | vendored, `vendor/fflate.js` | opening `.zip` uploads in the browser | MIT | added with data upload |
| Minimap images | asset, `assets/minimaps/` | map backgrounds: 2048 px WebP copies of the minimaps in the data drop | © LILA Games | in repo |

Each vendored library keeps its original LICENSE file next to it; exact versions are recorded when it is added.

**Written for this project** (no third-party code):

| Script | What it does |
|---|---|
| `tools/serve.mjs` | Local web server for development (`npm run serve`) |
| `tools/convert.mjs` | Converts a raw parquet drop into `data/default/dataset.json`, the file the app loads, and prints a data-health summary |
| `tools/extract.mjs`, `tools/audit.mjs`, `tools/compare.mjs`, `tools/query.mjs` | Data tools: CSV tables, audit report, drop comparison, filtered slices. Planned |

## Convert new data

```bash
node tools/convert.mjs path/to/player_data
```

Reads every day folder, writes `data/default/dataset.json` and `out/convert-report.json`, and prints a summary. Exits with code 1 if a file cannot be read or a map has no entry in `data/maps.json`. The same input always produces the same bytes.

See [ARCHITECTURE.md](ARCHITECTURE.md) for why each was chosen.

## Run it locally

```bash
npm run serve
```

Then open http://localhost:8000. (Browsers block ES modules on `file://`, so the folder must be served.)

## Tests

```bash
npm test
```

Uses Node's built-in test runner (`node:test`); no dependencies to install. Tests that read real data files run when `LILA_DATA` points to the raw `player_data` folder, and are skipped otherwise:

```bash
LILA_DATA=path/to/player_data npm test
```

## Environment variables

None.

## Licence

© 2026 Muskan Chauhan. All rights reserved. Shared for evaluation only; see [LICENSE](LICENSE).
