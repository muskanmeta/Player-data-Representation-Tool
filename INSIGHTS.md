# Three things the tool shows about LILA BLACK

## Before you read

**The game.** LILA BLACK is an extraction shooter. Players drop into a map, collect loot, fight, and must reach an extraction point before the storm closes the playable area. A player who dies loses the run and everything they collected.

**The data.** The telemetry covers 5 days (Feb 10–14, 2026) on three maps: 796 matches, 798 human journeys and 444 bot journeys. A **journey** is one player's session in one match: the path they walked, plus their kills, deaths, loot pickups and storm deaths.

**How to read the numbers.** We treat this drop as a test sample, not full production telemetry. The numbers show patterns that are strong enough to act on. Before setting targets, re-run the same tools on a full drop to confirm the baselines.

**Terms used in this document**

| Term | Meaning |
|---|---|
| Run with no death | A journey that ends without a logged death. This is most likely a successful extraction, but the data has no explicit extraction event |
| First match | A player's first match **in this sample**, used as a proxy for the early-player (onboarding) experience |
| Median | The middle value. It's used instead of the mean so a few extreme runs don't skew the result |
| Time-to-death | Minutes from the start of the match to the player's death |
| Central ninth | The middle square of a 3 × 3 grid laid over the map, about 11% of its area |
| Cell | One square of the 64 × 64 heatmap grid (about 14 m on Ambrose Valley and 9 m on Grand Rift) |
| Reachable ground | Cells that any player, human or bot, walked through in at least one match |
| Requeue rate | The share of players who start another match within 30 minutes of finishing one |

**Maps.** The sample has 566 matches on Ambrose Valley (71%), 171 on Lockdown (21%) and 59 on Grand Rift (7%). Grand Rift has the smallest sample, so its numbers carry the most uncertainty.

**Opening a view.** Each insight ends with **See it in the tool**. Add the text shown to the tool's URL (for example `…/?map=Lockdown&heat=storm`) to open the same screen.

**At a glance**

| # | What the data shows | Impact on the game |
|---|---|---|
| 1 | Most runs end early, to bots, in the map centre, and the first match is the hardest | The centre sets each map's difficulty curve, and new players feel it most |
| 2 | Storm deaths come from staying too long, not from looting more, mostly on Lockdown and Grand Rift | Late-match wayfinding is weak, and it lowers the requeue rate |
| 3 | Movement and loot concentrate on a few routes, and 13% of Grand Rift is never visited by a human | Built content goes unused, and routes become predictable |

---

## 1. Most runs end early, to bots, in the map centre, and the first match is the hardest

**What caught my eye.** With the Death zones heatmap on, almost every death marker is "Killed by a bot", and the markers cluster in the middle of each map. When I played matches one by one on the timeline, that death usually came well before the halfway point of the match.

**Evidence**

Bots end about half of all human runs: 52% on Ambrose Valley, 47% on Lockdown and 41% on Grand Rift. These deaths come early. The median time-to-death for a bot death is **4 minutes**, while runs with no death last a median **8.3–8.6 minutes**. In other words, a player killed by a bot usually loses the run at about the halfway point.

These players also die before the run pays off. At the moment of death they have collected only **5–9 items**, while players who finish the run with no death collect **17–23 items**.

The deaths are concentrated in space as well as in time. The central ninth of each map covers only about 11% of the area, yet it holds 54% of human deaths on Ambrose Valley, 49% on Lockdown and 73% on Grand Rift.

The first match is the hardest. In their first match in the sample, **62%** of players die to a bot, compared with **45%** in later matches, and **35%** die to a bot within the first 5 minutes of their first match, compared with 27% later. This drop could be survivorship bias, where weaker players churn and only stronger players remain. To control for that, I looked at a fixed cohort: the 44 players who played 5 or more matches. In match 1, 61% of them died to a bot. In matches 2 to 5, the rate was 36–50%. Because the cohort is the same group of people, the drop shows a real learning curve.

One retention signal is worth monitoring, but it is not a causal claim: 43% of players played only one match. In this sample, a bot death in the first match does not predict whether a player returns on a later day (18% returned, against 20% after a first match with no death).

**Actions and the metrics they move**

The first action is to reduce early pressure in the centre of each map: add cover, break up long sight lines, and open a second route into the central area. The second is to retune bot density, placement and accuracy in the centre for the first 4–5 minutes of a match, and to A/B test a softer bot setup for a player's first few matches as part of onboarding.

**Metrics:** early-death rate (deaths before 5:00), first-match survival rate, median loot per run, and the share of players who play a second match.

**Instrumentation ask:** log an explicit extraction event and a match result. Survival can then be measured directly, instead of being inferred from the absence of a death.

**Why a level designer should care.** The centre is where each map's difficulty actually sits. Changes to central cover, routes and bot placement will move survival more than any change at the edges of the map, and new players are the ones who feel the difference most.

**See it in the tool**
1. Open `?map=AmbroseValley&heat=deaths`. The bright area in the centre is the death cluster.
2. Open `?map=GrandRift&heat=deaths` to compare. On this map, 73% of deaths are central.
3. Open any single match and press play. Watch where the "Killed by a bot" marker lands on the timeline.

---

## 2. Storm deaths come from staying too long, not looting more, mostly on Lockdown and Grand Rift

**What caught my eye.** In the Storm deaths heatmap, Lockdown and Grand Rift light up far more than their size would suggest. In single matches, the storm death marker usually sits at the end of a long, wandering path.

**Evidence**

The storm-death rate is about three times higher on the two smaller maps. On Lockdown, **9.9%** of human runs end in the storm, and on Grand Rift **8.5%** do, compared with **3.0%** on Ambrose Valley. These rates come from 17, 5 and 17 storm deaths respectively.

The natural assumption would be that storm victims die because they stay longer to collect more loot. The data does not support that. Storm victims collect **17–23 items**, the same as players who finish with no death on each map. What differs is session length: storm victims stay a median **12–13 minutes**, about 4 minutes longer than the 8.3–8.6 minutes of runs with no death. They are not greedy; they are late, most likely because they are still looking for an extraction point when the storm reaches them.

The problem has a location. On Lockdown, 35% of all storm deaths happen in the middle-east of the map.

Storm deaths also affect re-engagement. After a storm death, **39%** of players start another match within 30 minutes. After a run with no death, the requeue rate is **53%**. This is plausible, because a storm death costs the player their longest run.

The sample is small: there are 39 storm deaths in total, and only 5 on Grand Rift. This is a strong lead, not a confirmed rate.

**Actions and the metrics they move**

The main action is to improve late-match wayfinding on Lockdown and Grand Rift. That means clear sight lines from the late-game areas to extraction, signs and landmarks. On Lockdown specifically, move or add an extraction point closer to the middle-east, or open a faster route out of that area. A systems-side option is an in-world warning when a player is far from the nearest extraction as the storm advances.

**Metrics:** storm-death rate per map (with Ambrose Valley's 3% as the target), extraction rate, median time-to-extract, and requeue rate after a storm death.

**Instrumentation ask:** log the current storm phase and the player's distance to the nearest extraction with each position sample. "Lost on the way out" can then be measured directly instead of being read from the paths.

**Why a level designer should care.** A storm death after 12 minutes wipes out the player's biggest investment in a match. When the way out was not clear, the loss feels unfair, and the requeue rate drops. Wayfinding is a level design problem, and these two maps show where to start.

**See it in the tool**
1. Open `?map=Lockdown&heat=storm` and note the cluster in the middle-east.
2. Open `?map=GrandRift&heat=storm` for the second map.
3. Open a match that ends in a storm death and play it. Follow the path in the last few minutes before the ▲ storm marker.

---

## 3. Movement and loot concentrate on a few routes, and 13% of Grand Rift is never visited by a human

**What caught my eye.** With all matches overlaid, the Human traffic heatmap shows a few bright corridors and a lot of dim space. On Grand Rift, the Ignored areas layer hatches pockets of the map that only bots walk through.

**Evidence**

Player movement is heavily concentrated. On Ambrose Valley, the busiest **10% of cells hold 48% of all human movement and 55% of all loot pickups**. If players spread out evenly, those cells would hold about 10%. On Lockdown the concentration is a little lower: the busiest 10% of cells hold 41% of movement and 41% of loot.

Some ground goes unused entirely. On Grand Rift, **13.4% of reachable ground (152 of 1,137 cells) is never visited by a human player**, compared with 2.4% on Ambrose Valley and 8.5% on Lockdown. These pockets are reachable, because bots walk through them, so they are not walls or out-of-bounds areas.

**Actions and the metrics they move**

For Grand Rift, give the unvisited pockets a reason to be visited, such as loot, an objective or a useful shortcut, or cut them and tighten the map. For Ambrose Valley, redistribute high-value loot away from the main corridors to spread routes out.

**Metrics:** share of movement in the busiest 10% of cells (lower means better map utilisation), share of reachable ground never visited, loot per run, and the spread of deaths across the map, which links back to insight 1.

**Instrumentation ask:** export each map's walkable area (navmesh) with the data. Unused ground can then be measured against what is really playable, not only against where someone happened to walk.

**Why a level designer should care.** Space that nobody visits still costs art and QA time but returns no gameplay. Concentrated routes also make matches predictable, and they funnel players into the central fights described in insight 1.

**See it in the tool**
1. Open `?map=GrandRift&heat=ignored`. The hatched areas are never visited by a human. Pick a single date to see what one day's players skipped.
2. Open `?map=AmbroseValley&heat=traffic`, then `?map=AmbroseValley&heat=loot`. The same corridors light up in both.

---

## Data notes for the next drop

These are telemetry issues found while building the tool. They don't change the three insights, but fixing them would make the next analysis more precise.

| What we saw | Why it matters | Suggested fix |
|---|---|---|
| There is no extraction or match-result event | Survival can only be inferred as "no death" | Log extraction and the match result |
| 794 of 796 matches record one human, and bot paths exist in only 52 matches, although most other matches log bot kills or deaths | Heatmaps show the recorded players, not everyone in the match | Confirm how the sample was cut, and record every player in a full drop |
| All 1,243 files store seconds in a column labelled as milliseconds | Times read 1,000× too short if taken at face value | Fix the unit at the source, or rename the column |
| 17 journeys with bot-style numeric IDs log human events | The ID rule alone misclassifies some players | Add an explicit `is_bot` field |
| 172 journeys log one or two positions after the death | Paths look as if the player moved after dying | Stop position logging at death |
| 1 file is duplicated, and 3 files have timestamps running backwards | Minor; the tool merges and sorts them | Deduplicate and sort at export |

## Reproduce the numbers

Every number above comes from the repo's tools:

```bash
node tools/extract.mjs <player_data> --out out/feb   # CSV tables from the raw files
node tools/audit.mjs out/feb                         # data notes
node tools/stats.mjs                                 # per-map numbers (insights 1–3)
node tools/players.mjs out/feb                       # first match, cohort, requeue, matches per player
node tools/query.mjs out/feb --table events --event KilledByStorm --group-by map_id
```
