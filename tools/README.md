# Data tools

Code tools process the data, not people and not AI. Every tool:

- **takes the data folder as an argument**, so a new drop runs with the same command;
- **is deterministic**: the same input gives byte-identical output;
- **writes plain CSV and JSON** with a header row or a `schema_version`;
- **chains**: extract → audit → query, compare or stats;
- **exits with code 1** when a critical check fails, so a build stops on bad data;
- **prints a one-screen summary**, with the details in files.

All of them use the app's own `js/data/parse.js` and `js/data/build-dataset.js`.

```bash
node tools/extract.mjs <player_data folder> --out out/feb     # 1. tables
node tools/audit.mjs out/feb                                  # 2. checks (exit 1 on critical)
node tools/convert.mjs <player_data folder>                   # 3. refresh data/default/dataset.json
node tools/stats.mjs                                          # 4. per-map numbers for INSIGHTS.md
node tools/query.mjs out/feb --table events --event KilledByStorm --map Lockdown
node tools/compare.mjs out/feb out/mar                        # when a new drop arrives
node tools/serve.mjs                                          # local web server, port 8000
```

`out/` is git-ignored. Raw data never enters the repo.

## extract.mjs → `files.csv`, `journeys.csv`, `matches.csv`, `events.csv`

Lists are `;`-separated. Booleans are `1`/`0`. Times are UTC ISO strings or seconds.

| File | One row per | Columns |
|---|---|---|
| `files.csv` | raw file | `path`, `folder`, `bytes`, `sha256`, `user_id`, `match_id`, `map_ids` (every map the file names), `ts_unit` (`s`/`ms` as stored), `rows`, `ts_backwards` (rows where time goes backwards in file order), `event_types`, `parsed_ok`, `error` |
| `journeys.csv` | player in a match | `user_id`, `match_id`, `map_id`, `date`, `bot` (final decision), `bot_by_id`, `bot_by_events` (empty = no movement events), `id_conflict`, `start_utc`, `end_utc`, `duration_s`, `positions`, `loot`, `kills` (PvP), `bot_kills`, `killed_by_player`, `killed_by_bot`, `storm_death`, `points_outside` (off the minimap), `moves_after_death`, `files` (files it came from), `repeated_rows`, `folders` |
| `matches.csv` | match | `match_id`, `map_id`, `date` (tool's date rule), `start_utc`, `end_utc`, `duration_s`, `folder_dates`, `journeys`, `humans`, `bots`, `kills`, `bot_kills`, `killed_by_player`, `killed_by_bot`, `storm_deaths`, `loot` |
| `events.csv` | non-movement event | `match_id`, `map_id`, `date`, `user_id`, `bot`, `t_s` (seconds from match start), `event` (raw name), `x`, `z` (world), `u`, `v` (0–1 on the minimap, v already flipped) |

## audit.mjs → `audit.md`, `audit.json`

`audit.json`: `{ schema_version, totals, passed, checks: [{ id, title, severity, count, meaning, examples (≤ 20) }] }`. Severity is `critical` (exit 1), `warning` or `info`.

| # | Check (`id`) | Severity | Feb 10–14 drop |
|---|---|---|---:|
| 1 | Unreadable files (`parse_failures`) | critical | 0 |
| 2 | Byte-identical files (`identical_files`) | warning | 1 |
| 3 | Journeys spread over several files, duplicate or split (`repeated_journeys`) | warning | 1 |
| 4 | Bot by ID ≠ bot by events (`bot_id_conflicts`) | warning | 17 |
| 5 | Seconds stored in the ms column (`ts_seconds`); time running backwards (`time_backwards`) | info / warning | 1,243 / 3 |
| 6 | Folder date ≠ UTC start (`folder_date_mismatch`); match in several folders (`multi_folder_matches`) | info | 4 / 1 |
| 7 | Points outside the minimap (`points_outside_map`) | warning | 0 |
| 8 | Unknown map IDs (`unknown_maps`); unknown event types (`unknown_events`) | critical / warning | 0 / 0 |
| 9 | No movement (`no_movement`); movement after death (`moves_after_death`) | warning / info | 0 / 172 |
| 10 | Matches with one recorded journey (`single_journey_matches`) | info | 743 |
| 11 | A file or match naming two maps (`mixed_maps`) | critical | 0 |

## query.mjs → a filtered CSV

`--table events|journeys|matches`, `--map`, `--date`, `--match`, `--event a,b`, `--bot 0|1`, `--min-humans n`, `--from s --to s` (events only), `--group-by column` (counts instead of rows), `--out file` (default: print).

## compare.mjs → `compare.md`, `compare.csv`

`compare.csv`: `match_id`, `status` (`added`, `removed`, `changed` or `same`), `map_id`, `date`, `journeys_old`, `journeys_new`, `humans_old`, `humans_new`. `compare.md` holds the totals per map and per date, and the counts of new and returning human players.

## stats.mjs → `out/stats/stats.json`, `stats.md`

Per map:
- matches and journeys;
- median match length;
- how human journeys ended (survived, or killed by bots, the storm or players);
- kills per match third;
- storm deaths, with their median time and zone;
- loot per journey, and the share of loot in the busiest 10% of cells;
- traffic concentration, and reachable cells never visited by humans.

It uses the app's own heatmap grid code, so "ignored" means the same thing in the tool and in the report.

## convert.mjs → `data/default/dataset.json`, `out/convert-report.json`

Builds the dataset the app loads (`schema_version: 1`; format in ARCHITECTURE.md). Exits 1 when:
- a file fails to parse;
- a map has no entry in `data/maps.json`;
- a match names two maps.
