// sidebar.js: renders the sidebar panels and the top bar from the app state, and turns
// clicks into app.set() calls. Nothing here keeps its own copy of the state.

import { h, replace, fmt, plural, toast } from './dom.js'
import { SORTS, countByDate, countByMap, summarize } from '../data/select.js'
import { EVENT_TYPES, EVENT_ORDER, HEATMAPS, HEATMAP_ORDER, formatClock, formatDay, playerName } from '../data/events.js'
import { RAMP_CSS } from '../data/heatmap.js'
import { markerIcon } from '../render/markers.js'
import { BOT_COLOR } from '../render/layers.js'
import { loadDataset } from '../data/load-dataset.js'
import { clearSaved } from '../data/storage.js'
import * as upload from './upload.js'

const $ = id => document.getElementById(id)

/** Binds the controls that exist once in the HTML. */
export function init (app) {
  $('match-list').removeAttribute('tabindex') // items carry the tab stop (roving tabindex)
  replace($('match-sort'), Object.entries(SORTS).map(([k, s]) => h('option', { value: k }, s.label)))
  replace($('heat-mode'), HEATMAP_ORDER.map(k => h('option', { value: k }, HEATMAPS[k].label)))

  $('min-players').addEventListener('change', e => app.set({ minPlayers: e.target.checked ? 2 : 1, match: null }))
  $('match-sort').addEventListener('change', e => app.set({ sort: e.target.value }))
  let searchTimer
  $('match-search').addEventListener('input', e => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => app.set({ search: e.target.value }), 150)
  })
  $('heat-mode').addEventListener('change', e => app.set({ heat: e.target.value }))
  $('heat-opacity').addEventListener('input', e => app.set({ heatOpacity: Number(e.target.value) }, { url: false }))
  $('match-list').addEventListener('keydown', e => moveInList(e))

  $('btn-share').addEventListener('click', () => copyLink(app))
  $('btn-export').addEventListener('click', () => exportDataset(app))
  $('btn-add-data').addEventListener('click', () => upload.open(app))
  $('btn-reset-data').addEventListener('click', async () => {
    await clearSaved()
    app.setDataset(await loadDataset(), 'sample')
    toast('Back to the bundled sample data')
  })
  for (const id of ['btn-share', 'btn-export', 'btn-add-data']) $(id).disabled = false
}

// ---------- filters: map, date, match ----------

export function renderFilters (app) {
  const s = app.state
  const ds = app.dataset

  const mapCounts = countByMap(ds)
  replace($('map-switcher'), ds.maps.map(id => h('button', {
    type: 'button',
    'aria-pressed': String(id === s.map),
    onclick: () => app.set({ map: id })
  }, app.mapConfig(id).name.replace(' (no minimap)', ''), h('small', {}, plural(mapCounts[id], 'match')))))

  const dateCounts = countByDate(ds, s.map, s.minPlayers)
  const total = Object.values(dateCounts).reduce((a, b) => a + b, 0)
  const chip = (value, label, count) => h('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': String(s.date === value),
    disabled: count === 0 && s.date !== value,
    title: count === 0 ? 'No matches on this map on this date' : null,
    onclick: () => app.set({ date: value, match: null })
  }, label, h('small', {}, `${fmt(count)}`))
  replace($('date-chips'), chip('all', 'All dates', total), ds.dates.map(d => chip(d, formatDay(d), dateCounts[d] ?? 0)))

  $('min-players').checked = s.minPlayers > 1
  $('match-sort').value = s.sort
  if (document.activeElement !== $('match-search')) $('match-search').value = s.search

  const item = (m, label) => {
    const selected = m ? s.match === m.id : !s.match
    const kills = m ? m.counts.Kill + m.counts.BotKill : 0
    return h('button', {
      type: 'button',
      class: `match-item${m ? '' : ' match-item--all'}`,
      role: 'option',
      'aria-selected': String(selected),
      tabindex: selected ? '0' : '-1',
      'data-id': m?.id ?? '',
      onclick: () => app.set({ match: m ? m.id : null })
    },
    h('span', { class: 'match-item__id', title: m?.id }, label ?? m.id),
    h('span', { class: 'match-item__time' }, m ? formatClock(m.duration) : ''),
    h('span', { class: 'match-item__meta' }, m
      ? `${formatDay(m.date)} · ${m.humans} human${m.humans === 1 ? '' : 's'} · ${m.bots} bot${m.bots === 1 ? '' : 's'} · ${kills} kill${kills === 1 ? '' : 's'}`
      : 'Overlay every match in this list'))
  }
  const list = $('match-list')
  replace(list, app.list.length
    ? [item(null, `All ${fmt(app.list.length)} matches`), ...app.list.map(m => item(m))]
    : h('p', { class: 'match-list__empty' }, 'No matches for these filters.'))
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
}

/** Arrow keys move between matches; Enter/Space (native button) opens one. */
function moveInList (e) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const items = [...e.currentTarget.querySelectorAll('.match-item')]
  const i = items.indexOf(document.activeElement)
  const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key]
  const target = items[Math.max(0, Math.min(items.length - 1, next))]
  if (!target) return
  e.preventDefault()
  items.forEach(el => el.setAttribute('tabindex', '-1'))
  target.setAttribute('tabindex', '0')
  target.focus()
}

// ---------- layers and legend ----------

export function renderLayers (app) {
  const s = app.state
  const totals = summarize(app.view)
  const toggle = (key, swatch, label, count, help) => h('label', { class: 'layer', title: help },
    h('input', {
      type: 'checkbox',
      checked: !s.off.has(key),
      onchange: e => {
        const off = new Set(s.off)
        if (e.target.checked) off.delete(key); else off.add(key)
        app.set({ off })
      }
    }),
    swatch, h('span', {}, label), h('span', { class: 'layer__count' }, count == null ? '' : fmt(count)))

  replace($('layers'),
    h('div', { class: 'layer-group', role: 'group', 'aria-label': 'Players' },
      toggle('humans', h('span', { class: 'line-swatch' }), 'Humans', totals.humans, 'Solid lines. One colour per player when one match is open.'),
      toggle('bots', h('span', { class: 'line-swatch line-swatch--bot', style: { borderTopColor: BOT_COLOR } }), 'Bots', totals.bots, 'Dashed grey lines'),
      toggle('paths', h('span', {}), 'Movement paths', null, 'Turn off to see only events')),
    h('div', { class: 'layer-group', role: 'group', 'aria-label': 'Events' },
      EVENT_ORDER.map(type => {
        const spec = EVENT_TYPES[type]
        const help = spec.botLabel ? `${spec.label}. In a bot's journey: ${spec.botLabel.toLowerCase()}.` : spec.label
        return toggle(type, markerIcon(type), spec.label, totals.events[type] ?? 0, help)
      })))
  $('heat-mode').value = s.heat
  $('heat-help').textContent = HEATMAPS[s.heat].help ?? 'Pick a heatmap to see where things happen most.'
}

export function renderHeatLegend (app, result) {
  const legend = $('heat-legend')
  legend.hidden = !result
  if (!result) return
  const bar = $('heat-legend-bar')
  const spec = HEATMAPS[app.state.heat]
  if (spec.source === 'ignored') {
    bar.className = 'heat-legend__bar heat-legend__bar--hatch'
    bar.style.background = ''
    const share = result.reachable ? Math.round((result.ignored / result.reachable) * 100) : 0
    $('heat-legend-total').textContent = `${fmt(result.ignored)} of ${fmt(result.reachable)} reachable cells (${share}%)`
  } else {
    bar.className = 'heat-legend__bar'
    bar.style.background = RAMP_CSS
    $('heat-legend-total').textContent = `${fmt(result.total)} ${spec.source === 'path' ? 'position samples' : 'events'}`
  }
}

// ---------- players in the open match ----------

export function renderPlayers (app) {
  const s = app.state
  const panel = $('players-panel')
  const match = s.match ? app.view[0] : null
  panel.hidden = !match
  if (!match) return
  const journeys = [...match.journeys].sort((a, b) => a.bot - b.bot || a.user_id.localeCompare(b.user_id))
  replace($('player-list'), journeys.map(j => {
    const hidden = s.hidden.has(j.user_id)
    const focused = s.focus === j.user_id
    const count = type => j.events.filter(e => e[0] === type).length
    const death = j.events.find(e => ['Killed', 'BotKilled', 'KilledByStorm'].includes(e[0]))
    const bits = [
      count('Loot') && `${count('Loot')} loot`,
      (count('BotKill') + count('Kill')) && plural(count('BotKill') + count('Kill'), 'kill'),
      death ? (death[0] === 'KilledByStorm' ? 'storm death' : death[0] === 'Killed' ? 'killed by a player' : j.bot ? 'killed' : 'killed by a bot') : (j.bot ? '' : 'no death logged')
    ].filter(Boolean)
    return h('li', { class: `player${hidden ? ' player--hidden' : ''}${focused ? ' player--focus' : ''}` },
      h('span', { class: 'player__swatch', style: { background: j.bot ? '#c8ceda' : app.scene.colors.get(j.user_id) } }),
      h('button', {
        type: 'button',
        class: 'player__name',
        'aria-pressed': String(focused),
        title: `${j.user_id}${j.id_conflict ? ' (numeric ID, but logs human events: treated as human)' : ''}`,
        onclick: () => app.set({ focus: focused ? null : j.user_id }, { url: false })
      }, playerName(j), j.id_conflict ? ' *' : '', h('br'), h('small', {}, `${j.bot ? 'Bot' : 'Human'}${bits.length ? ' · ' + bits.join(' · ') : ''}`)),
      h('button', {
        type: 'button',
        class: 'player__eye',
        'aria-pressed': String(hidden),
        'aria-label': `${hidden ? 'Show' : 'Hide'} ${playerName(j)}`,
        title: hidden ? 'Show' : 'Hide',
        onclick: () => {
          const next = new Set(s.hidden)
          if (hidden) next.delete(j.user_id); else next.add(j.user_id)
          app.set({ hidden: next, focus: s.focus === j.user_id ? null : s.focus }, { url: false })
        }
      }, hidden ? '◌' : '◉'))
  }))
}

// ---------- summary ----------

let lastSummary = 0
export function renderSummary (app, { throttle = false } = {}) {
  const now = performance.now()
  if (throttle && now - lastSummary < 200) return
  lastSummary = now
  const s = app.state
  const t = app.time
  const players = summarize(app.view, t, s.hidden)
  // Kills, deaths and loot from the humans' point of view (see HEATMAPS in events.js).
  const humanOnly = app.view.map(m => ({ journeys: m.journeys.filter(j => !j.bot) }))
  const ev = summarize(humanOnly, t, s.hidden).events
  const n = type => ev[type] ?? 0
  const stat = (label, value, help) => h('div', { class: 'stat', title: help }, h('dt', {}, label), h('dd', {}, fmt(value)))
  replace($('summary'),
    h('dl', { class: 'stats' },
      stat('Matches', players.matches),
      stat('Humans', players.humans),
      stat('Bots', players.bots),
      stat('Kills', n('Kill') + n('BotKill'), `Humans killed ${n('BotKill')} bots and ${n('Kill')} players`),
      stat('Deaths', n('Killed') + n('BotKilled') + n('KilledByStorm'), `Humans killed by bots ${n('BotKilled')}, by players ${n('Killed')}, by the storm ${n('KilledByStorm')}`),
      stat('Storm deaths', n('KilledByStorm')),
      stat('Loot', n('Loot'))),
    h('p', { class: 'hint summary__note' },
      s.t == null || t >= app.duration
        ? 'Whole match. Counts are for human players.'
        : `Up to ${formatClock(t)} into ${s.match ? 'the match' : 'each match'}. Counts are for human players.`))
}

// ---------- data health ----------

const HEALTH = [
  ['failed_files', true, 'files could not be read', 'Not parquet or broken. Their journeys are missing.', e => `${e.file}: ${e.error}`],
  ['mixed_maps', true, 'matches name more than one map', 'Drawn on the first map; check the source data.', e => `${e.match_id}: ${e.map_ids.join(', ')}`],
  ['unknown_maps', true, 'maps have no minimap settings', 'Drawn on a grid until data/maps.json has an entry.', e => e],
  ['points_outside_map', true, 'positions fall outside the minimap', 'Not drawn. Usually a wrong scale or origin in data/maps.json.', null],
  ['id_conflicts', false, 'numeric IDs behave like humans', 'They log Position and Loot, so they are shown as humans (marked * in the player list).', e => `${e.user_id} in ${e.match_id.slice(0, 8)}: ${e.events.join(', ')}`],
  ['repeated_journeys', false, 'journeys arrived in more than one file', 'Merged into one; repeated rows were dropped, so nothing is counted twice.', e => `${e.user_id.slice(0, 8)} in ${e.match_id.slice(0, 8)} (${e.kind}): ${e.files.join(', ')}`],
  ['folder_date_mismatches', false, 'matches are filed under another day than their UTC start', 'Dated by their folder, which is how the data team splits days.', e => `${e.match_id.slice(0, 8)}: folder ${e.folder_date}, started ${e.utc_start_date}`],
  ['multi_folder_matches', false, 'matches are spread over several day folders', 'Dated by the earliest folder.', e => `${e.match_id.slice(0, 8)}: ${e.folder_dates.join(', ')}`],
  ['unknown_events', false, 'event types are new to this tool', 'Shown as white "Other event" markers.', e => e],
  ['single_journey_matches', false, 'matches have only one recorded player', 'Most of the drop is partial. Tick "2+ players only" to hide them.', null]
]

export function renderHealth (app) {
  const health = app.dataset.health ?? {}
  const clear = []
  const items = []
  for (const [key, warn, text, meaning, describe] of HEALTH) {
    const value = health[key]
    const count = Array.isArray(value) ? value.length : (value ?? 0)
    if (count === 0) { clear.push(text.replace(/^(\w+) /, '')); continue }
    items.push(h('details', { class: `health-item${warn ? ' health-item--warn' : ''}` },
      h('summary', {}, h('span', { class: 'health-item__count' }, fmt(count)), text),
      h('p', {}, meaning),
      Array.isArray(value) && describe ? h('ul', {}, value.slice(0, 8).map(e => h('li', {}, describe(e))), value.length > 8 ? h('li', {}, `… and ${value.length - 8} more`) : null) : null))
  }
  replace($('health'),
    items.length ? items : h('p', { class: 'hint' }, 'No problems found.'),
    clear.length ? h('p', { class: 'hint' }, `Checked and clear: ${clear.join('; ')}.`) : null)
}

export function renderDatasetChip (app) {
  const ds = app.dataset
  const journeys = ds.matches.reduce((n, m) => n + m.journeys.length, 0)
  const range = ds.dates.length ? `${formatDay(ds.dates[0])} – ${formatDay(ds.dates.at(-1))}` : 'no dates'
  $('dataset-chip').textContent =
    `${app.source === 'saved' ? 'Your data (saved in this browser)' : 'Sample data'} · ${fmt(ds.matches.length)} matches · ${fmt(journeys)} journeys · ${range}`
  $('btn-reset-data').hidden = app.source !== 'saved'
}

// ---------- top bar actions ----------

async function copyLink (app) {
  app.writeUrl()
  await new Promise(r => setTimeout(r, 300)) // let the debounced URL update land
  try {
    await navigator.clipboard.writeText(location.href)
    toast(app.source === 'saved'
      ? 'Link copied. It opens on the sample data unless the other person adds the same files.'
      : 'Link copied. It reopens this exact view.')
  } catch {
    window.prompt('Copy this link:', location.href)
  }
}

function exportDataset (app) {
  const blob = new Blob([JSON.stringify(app.dataset)], { type: 'application/json' })
  const a = h('a', { href: URL.createObjectURL(blob), download: `player-journeys-${app.dataset.dates[0] ?? 'data'}_to_${app.dataset.dates.at(-1) ?? ''}.json` })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  toast('Dataset exported. Drop it into "Add data" to load it again.')
}
