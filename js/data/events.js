// events.js: everything the app knows about event types, in one place.
//
// The raw names (BotKilled, KilledByStorm, ...) never reach the screen. Each event gets a
// designer-language label, a colour AND a shape, so markers stay distinguishable in a
// greyscale screenshot or for colour-blind users. No DOM here: Node tests can import it.
//
// Perspective: every event is logged in one player's journey and describes what happened
// to THAT player. The README defines them for humans ("BotKilled = a human player was killed
// by a bot"), but bots log BotKill and BotKilled too. The audit showed what those mean: a
// bot's BotKilled lands at the same time and place as a human's BotKill (19 of 20 cases
// where both sides were recorded), and a bot's BotKill matches a human's BotKilled (3 of 3).
// So for a bot, BotKilled = "this bot was killed" and BotKill = "this bot killed a player".

export const EVENT_TYPES = {
  Loot:          { label: 'Loot pickup',        shape: 'diamond',  color: '#f2c94c', group: 'loot' },
  BotKill:       { label: 'Killed a bot',       botLabel: 'Bot killed a player', shape: 'cross',  color: '#ff9f43', group: 'kill' },
  Kill:          { label: 'Killed a player',    shape: 'star',     color: '#ff4d6d', group: 'kill' },
  BotKilled:     { label: 'Killed by a bot',    botLabel: 'Bot was killed',      shape: 'square', color: '#c792ea', group: 'death' },
  Killed:        { label: 'Killed by a player', shape: 'circle',   color: '#ff6b81', group: 'death' },
  KilledByStorm: { label: 'Storm death',        shape: 'triangle', color: '#5ce1e6', group: 'death' }
}

/** Order used by the legend, layer toggles and summary. */
export const EVENT_ORDER = ['Loot', 'BotKill', 'Kill', 'BotKilled', 'Killed', 'KilledByStorm']

/**
 * Heatmap modes: what each one counts. `source` is 'path' (movement samples) or 'events'.
 * Event heatmaps count HUMAN journeys only: a bot's BotKill/BotKilled mirrors a human's
 * event at the same spot, so counting both would double the hot spots where both sides
 * were recorded. Bots' own events still appear as markers.
 */
export const HEATMAPS = {
  none:          { label: 'Off' },
  traffic:       { label: 'Human traffic',  source: 'path', bots: false, help: 'Where humans spend time (position samples)' },
  botTraffic:    { label: 'Bot traffic',    source: 'path', bots: true,  help: 'Where bots spend time' },
  kills:         { label: 'Kill zones',     source: 'events', types: ['Kill', 'BotKill'], help: 'Where players got kills' },
  deaths:        { label: 'Death zones',    source: 'events', types: ['Killed', 'BotKilled', 'KilledByStorm'], help: 'Where players died, any cause' },
  storm:         { label: 'Storm deaths',   source: 'events', types: ['KilledByStorm'], help: 'Where the storm caught players' },
  loot:          { label: 'Loot',           source: 'events', types: ['Loot'], help: 'Where items were picked up' },
  ignored:       { label: 'Ignored areas',  source: 'ignored', help: 'Reachable ground (someone walked there in any match on this map) that humans barely visit in this view' }
}

export const HEATMAP_ORDER = ['none', 'traffic', 'botTraffic', 'kills', 'deaths', 'storm', 'loot', 'ignored']

/** Label for an event, from the point of view of whoever logged it (human or bot). */
export function eventLabel (type, bot = false) {
  const spec = EVENT_TYPES[type]
  if (!spec) return `Other event (${type})`
  return (bot && spec.botLabel) || spec.label
}

/** "3:12" for 192 seconds; "1:02:05" past an hour. */
export function formatClock (seconds) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "2026-02-13" -> "Feb 13". Dates are calendar days, so read them as UTC to avoid TZ shifts. */
export function formatDay (iso) {
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .split(' ').reverse().join(' ')
}

/** Short, readable player name: humans get "Player 3f2a", bots "Bot 1440". */
export function playerName (journey) {
  return journey.bot ? `Bot ${journey.user_id}` : `Player ${journey.user_id.slice(0, 4)}`
}
