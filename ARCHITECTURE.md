# Architecture

**In one sentence:** the game's telemetry files are turned into one clean dataset, and a web page draws it on each map's minimap as paths, markers and heatmaps that follow a timeline.

A few words used throughout:
- **Journey:** one player (human or bot) in one match. The raw data has one file per journey.
- **Match:** all the journeys that share a match ID.
- **UV:** a position on the minimap written as two fractions from 0 to 1 (0 = one edge, 1 = the other), so it doesn't depend on the image's pixel size.

## What it is built with, and why

| Piece | Choice | Why |
|---|---|---|
| App | A static web page in plain HTML, CSS and JavaScript, no framework, no build step | A designer only needs a link. There's no server to run, and the code you read is the code that runs |
| Drawing | `<canvas>` (2D) | A day of data is about 70,000 path points and 12,000 markers, too many for SVG or HTML elements |
| Reading the data | [hyparquet](https://github.com/hyparam/hyparquet), a small parquet reader copied into `vendor/` | The raw files are parquet (a compressed table format). Reading them in the browser lets a designer load a new data drop without an engineer |
| Data tools and tests | Node.js, reusing the app's own `parse.js` and `build-dataset.js` | The tools, the bundled sample and in-app uploads all follow the same cleaning rules, so their numbers can't disagree |

The **Trade-offs** table at the end lists what each choice gave up.

## Data flow

How a parquet file becomes something on screen, in four steps:

1. **Read:** each raw file (one journey) is checked and read. Times are fixed to seconds, event names are decoded, and the journey is labelled human or bot.
2. **Combine:** journeys are grouped into matches. Repeated files and rows are removed, each match gets a date, and every oddity goes into a **Data health** report.
3. **Store:** the result is one dataset. The bundled 5-day sample was built ahead of time into `data/default/dataset.json`. Files a designer drops into the app are built in the browser and saved there (IndexedDB, the browser's built-in database).
4. **Show:** the filters (map, date, match, players, playhead time) pick what's in view. The canvas draws the minimap, then the heatmap, bot paths, human paths, markers and player heads on top.

```
raw drop (day folders of *.nakama-0 parquet)          designer drops files/folders/.zip in the app
        │ tools/convert.mjs (Node, once per drop)               │ Web Worker (background thread)
        ▼                                                       ▼
parse.js          one file → one journey: PAR1 check, read columns, event bytes → text,
                  ts unit by magnitude, bot by events (ID rule as fallback)
build-dataset.js  merge files of one journey, drop repeated rows, group into matches,
                  date rule, counts, data-health report
        ▼                                                       ▼
data/default/dataset.json (1.8 MB, 0.6 MB gzipped)      merge.js → IndexedDB (survives reloads)
        └──────────────────────► app.js (state) ◄───────────────┘
                 select.js (filters, playhead) · heatmap.js (grids) · URL ⇄ state (share links)
                                     ▼
            map-canvas.js: cached minimap layer + overlays redrawn each frame
```

The app state changes in one place only (`app.set(patch)`), and the panels and canvas redraw from it. The same state is written into the URL, which is how share links work. Every number in INSIGHTS.md comes from the `tools/` scripts, which write CSV and JSON for each drop, not from reading the data by hand.

## Coordinate mapping: world → minimap

**The idea.** Each map covers a square of the game world. The data README gives the square's size (`scale`, in world units) and its bottom-left corner (`originX`, `originZ`). To place a player, we ask how far across that square they are, as a fraction. That fraction is the UV position, and it can then be drawn at any image size. The settings for each map are in `data/maps.json`.

**Step by step:**

1. **Use the ground plane.** The world is 3D. The map is a top-down view, so it uses `x` (east–west) and `z` (north–south). `y` is height and is ignored.
2. **Turn world units into fractions (UV):** `u = (x − originX) / scale`, `v = (z − originZ) / scale`. A point on the map gives values from 0 to 1.
3. **Flip the vertical axis.** In the world, `z` grows towards the top of the map; in an image, rows are counted from the top down. So the app draws at `(u, 1 − v)`.
4. **Scale to the image as it's actually drawn:** pixel = (left + u × drawn width, top + (1 − v) × drawn height). The README assumes 1024 px images, but the originals are 4320², 2160×2158 and 9000², and the app ships ~2048 px WebP copies. Stopping at UV means image resolution, zoom, pan and screen size never affect the mapping, and a non-square image still works.
5. **Keep the aspect ratio** when fitting the map on screen, so distances aren't stretched.

**Worked example** (from the data README): a player at x = −301.45, z = −355.55 on Ambrose Valley (scale 900, origin −370, −473).

| Step | Calculation | Result |
|---|---|---|
| u | (−301.45 − (−370)) / 900 = 68.55 / 900 | 0.076 |
| v | (−355.55 − (−473)) / 900 = 117.45 / 900 | 0.130 |
| Pixel on a 1024 px image | x = 0.076 × 1024, y = (1 − 0.130) × 1024 | **(78, 890)**, matching the README |

**How it's checked:**
- A test runs this example, plus the corner and flip cases (`test/mapping.test.js`).
- The audit counts points that land outside 0–1: zero in this drop.
- Adding `?check=mapping` to the URL draws the map frame and the README point on screen, for a check by eye.
- A map missing from `maps.json` still draws, on a grid fitted around the data, with a warning that positions are only relative.

## Assumptions where the data was ambiguous

| What was unclear | What the data showed | What I decided |
|---|---|---|
| `ts` is labelled milliseconds | Read as ms, every match falls in Jan 1970 and lasts under 1 s, so the values are Unix **seconds** | Pick the unit by size (< 1e11 = seconds) |
| Files have no `.parquet` extension, and `event` is raw bytes | Parquet schema; files are named `*.nakama-0` | Recognise parquet by its first bytes (`PAR1`); decode events as UTF-8 text |
| A numeric user ID is supposed to mean a bot | 17 journeys from IDs 1429, 1402 and 1379 log human events (`Position`, `Loot`) | Decide bot or human by the movement events logged; use the ID rule only as a fallback; list conflicts in Data health |
| The README defines `BotKill` and `BotKilled` only for humans, but bots log them too | A bot's `BotKilled` lines up with a human's `BotKill` in 19 of 20 cases where both exist; a bot's `BotKill` with a human's `BotKilled` in 3 of 3 | Read each event from the journey owner's side ("Bot was killed", "Bot killed a player"). Kill and death **heatmaps count human journeys only**, so the same fight isn't counted twice |
| Duplicate data | One file appears byte-for-byte in both `February_10` and `February_11`; one match spans two day folders | Merge by (player, match) and drop repeated rows |
| Which day a match belongs to | 4 matches start just before midnight UTC but sit in the next day's folder | Date = the folder name; if several, the earliest; if none, the UTC start date |
| Most matches are incomplete | 743 of 796 matches have one recorded journey and 794 record one human; 690 of the 744 with no bot journeys still log bot kills or deaths | Treated as a test sample: heatmaps show the recorded players, not everyone in the match. Keep and count every match, add a "2+ players only" filter, and list it under "Data notes" in INSIGHTS.md |
| Players moving after death | 172 journeys move after a death; 170 of them have exactly one position after it | Treat it as a final position write and draw it as recorded |
| "Ignored areas" need to know where players *can* walk, and there is no walkability data | — | Reachable = any cell of a 64×64 grid that anyone, human or bot, crossed in any match on that map. Ignored = reachable, but no human in or next to it in the current view |

## Trade-offs

| Considered | Decided | Why | What it costs |
|---|---|---|---|
| React or another framework | Plain JavaScript modules, state changes in one place | One screen, mostly canvas; no build step | Panel updates are hand-written; no component library |
| A server and database | Static site, uploads kept in the browser (IndexedDB) | Nothing to run or secure; data never leaves the designer's machine | Data is per browser: a share link shows the same view only if the other person has the same data |
| Parse every parquet file at page load | Sample pre-converted to JSON; browser parsing only for uploads | First load is one 0.6 MB fetch, not 1,243 files | The sample must be rebuilt (one command) when the bundled drop changes |
| Parse on the main thread | Web Worker (background thread), main-thread fallback | One day (166 files) parses in ~75 ms without freezing the page | Two code paths to keep working |
| Redraw everything every frame | Minimap drawn once and cached; markers stamped from pre-drawn images; markers hidden while panning | All 566 Ambrose Valley matches: 32 ms per full redraw, 1 ms per frame while panning | Markers briefly disappear while dragging |
| One colour per human everywhere | Own colour per player in a single match; one colour, faded by 1/√(number of paths), when many matches overlap | 500 colours are noise; fading makes busy routes brighter than rare ones | In the overlay you see routes, not individual players |
| Heatmap over the whole match | Heatmaps follow the playhead (time into each match) | Separates early-game from late-game fights across many matches | Seeing the whole match needs the playhead at the end (<kbd>End</kbd>) |
| Python for the data tools | Node.js | Same language and parser as the app: one set of rules | No pandas or notebooks; ad-hoc analysis works from the CSV outputs |
| CDN or npm packages | Libraries copied into `vendor/` (MIT) | Works offline, nothing to install, can't break when a package changes | Library updates are manual |
