# Three things the tool shows about LILA BLACK

Numbers come from the 5-day sample (Feb 10–14, 2026; 798 human journeys, 444 bot journeys) and are reproducible:

```bash
node tools/extract.mjs <player_data> --out out/feb
node tools/stats.mjs
node tools/query.mjs out/feb --table events --event KilledByStorm --group-by map_id
```

Each insight lists a **view**: add it after the tool's URL (`…/?map=…`) to open the same screen.
Caveat for all three: 743 of 796 matches have only one recorded journey, so these are patterns across many partial matches, not complete matches.

---

## 1. Bots, not players, decide who survives, and they do it early in the map centre

**What caught my eye.** With the Kill zones and Death zones heatmaps on, I expected PvP hot spots. Instead, almost every marker is "Killed a bot" or "Killed by a bot".

**Evidence**
- **PvP is almost absent:** 3 player kills in 5 days, against 2,240 bots killed by humans.
- **Bots end about half of all human journeys:** 52% on Ambrose Valley, 41% on Grand Rift, 47% on Lockdown. Bots killed 403 humans; other players killed 3.
- **Those deaths come early:** the median human killed by a bot dies **4 minutes** in, while survivors last **8.3–8.6 minutes**. Bot victims have picked up **5–9 items, against 17–23** for survivors.
- **Deaths cluster in the centre:** 54% of human deaths on Ambrose Valley, 73% on Grand Rift and 49% on Lockdown fall in the central ninth of the map.

**Actions and the metrics they move**
- Tune bot density and accuracy in the central areas for the first 4–5 minutes, or give the central approach more cover. **Metrics:** early-death rate (deaths before 5:00), extraction or survival rate per map, median loot per journey.
- Check whether the low PvP count is real or a logging gap. If matches really are mostly bots, matchmaking or player counts matter more than PvP layout. **Metric:** human journeys per match.

**Why a level designer should care.** The centre is where the map's difficulty actually happens. Changes to central layout and spawns will move survival more than anything at the edges.

**Views:** `?map=AmbroseValley&heat=deaths` · `?map=GrandRift&heat=deaths`, then play any match and watch the "Killed by a bot" ticks bunch up early on the timeline.

---

## 2. The storm catches players who stay too long, not players who loot more, and mostly on the smaller maps

**What caught my eye.** In the Storm deaths heatmap, Lockdown and Grand Rift light up far more than their size suggests.

**Evidence**
- **Share of human journeys ending in the storm:** **9.9% on Lockdown and 8.5% on Grand Rift, against 3.0% on Ambrose Valley** (17, 5 and 17 deaths).
- **Storm victims stay about 4 minutes longer than survivors:** median **12–13 minutes**, against 8.3–8.6 minutes for players with no logged death.
- **They loot the same amount:** 17–23 items, identical to survivors on each map. They are not greedier; they are late.
- **On Lockdown, 35% of storm deaths are in the middle-east zone.**
- The sample is small (39 storm deaths), so treat this as a strong lead, not a proven rate.

**Actions and the metrics they move**
- Make the route to extraction readable from the late-game areas on Lockdown and Grand Rift: sight lines, signage, or an extraction closer to the middle-east of Lockdown.
- Add an in-world warning when a player is far from the nearest extraction as the storm advances.
- **Metrics:** storm-death share per map (target near Ambrose Valley's 3%), extraction rate, median time to extract.

**Why a level designer should care.** A storm death after 12 minutes of play costs the player their whole run. It feels unfair when the way out is unclear, which hurts retention more than a fair death does.

**Views:** `?map=Lockdown&heat=storm` · `?map=GrandRift&heat=storm`. In a single match, the Storm death ▲ marker usually sits at the end of a long, wandering path.

---

## 3. Traffic and loot concentrate on a few routes, and part of Grand Rift goes unused

**What caught my eye.** All matches overlaid with the Human traffic heatmap show a few bright corridors. On Grand Rift, the Ignored areas layer hatches pockets that only bots ever walk through.

**Evidence** (64 × 64 grid; one cell is about 14 m on Ambrose Valley and 9 m on Grand Rift)
- **Ambrose Valley:** the busiest **10% of cells hold 48% of human movement and 55% of loot pickups**.
- **Lockdown:** 41% of movement and 41% of loot in the busiest 10% of cells.
- **Grand Rift:** **13.4% of reachable ground (152 of 1,137 cells) is never visited by a human**, against 2.4% on Ambrose Valley and 8.5% on Lockdown. Bots walk there, so it is reachable.

**Actions and the metrics they move**
- Put a loot or objective reason into Grand Rift's never-visited pockets, or cut them and tighten the map.
- Spread high-value loot on Ambrose Valley away from the main corridors to pull routes apart.
- **Metrics:** share of traffic in the busiest 10% of cells (lower means more of the map is used), share of reachable ground never visited, loot per journey, and encounter spread, which ties back to insight 1.

**Why a level designer should care.** Space nobody uses is level-art and testing cost with no gameplay return. Over-concentrated routes make matches predictable, and they also feed the central death cluster in insight 1.

**Views:** `?map=GrandRift&heat=ignored` (pick a single date to see what one day's players skipped) · `?map=AmbroseValley&heat=traffic` · `?map=AmbroseValley&heat=loot`
