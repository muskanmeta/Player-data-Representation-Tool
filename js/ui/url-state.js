// url-state.js: the current view <-> the page URL, so any view can be shared as a link.
//
//   ?map=AmbroseValley&date=2026-02-13&match=…&heat=kills&t=192&min=2&off=bots,Loot
//
// Only values that differ from the defaults are written, so links stay short. Reading is
// forgiving: an unknown or malformed value falls back to the default instead of failing.
// Pure functions over URLSearchParams, so Node tests can check the round trip.

import { HEATMAP_ORDER } from '../data/events.js'
import { SORTS } from '../data/select.js'

export const DEFAULT_VIEW = {
  map: null,          // first map in the data when null
  date: 'all',
  match: null,
  heat: 'none',
  t: null,            // null = end of the timeline (show everything)
  minPlayers: 1,
  sort: 'humans',
  off: []             // layers switched off: 'humans', 'bots', 'paths', or an event type
}

/** View -> query string (without "?"). */
export function viewToQuery (view) {
  const p = new URLSearchParams()
  if (view.map) p.set('map', view.map)
  if (view.date !== DEFAULT_VIEW.date) p.set('date', view.date)
  if (view.match) p.set('match', view.match)
  if (view.heat !== DEFAULT_VIEW.heat) p.set('heat', view.heat)
  if (view.t != null) p.set('t', String(Math.round(view.t)))
  if (view.minPlayers !== DEFAULT_VIEW.minPlayers) p.set('min', String(view.minPlayers))
  if (view.sort !== DEFAULT_VIEW.sort) p.set('sort', view.sort)
  if (view.off.length) p.set('off', [...view.off].sort().join(','))
  return p.toString()
}

/** Query string -> view. Values are checked here; whether a map or match exists is checked by the app. */
export function queryToView (query) {
  const p = new URLSearchParams(query)
  const view = { ...DEFAULT_VIEW, off: [] }
  if (p.get('map')) view.map = p.get('map')
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.get('date') ?? '')) view.date = p.get('date')
  if (p.get('match')) view.match = p.get('match')
  if (HEATMAP_ORDER.includes(p.get('heat'))) view.heat = p.get('heat')
  const t = Number(p.get('t'))
  if (p.has('t') && Number.isFinite(t) && t >= 0) view.t = t
  if (p.get('min') === '2') view.minPlayers = 2
  if (p.get('sort') in SORTS) view.sort = p.get('sort')
  if (p.get('off')) view.off = p.get('off').split(',').filter(Boolean)
  return view
}
