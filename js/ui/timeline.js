// timeline.js: playback. Play/pause, speed, scrubber with event ticks, keyboard keys.
//
// The clock runs on requestAnimationFrame: each frame adds (real seconds elapsed x speed)
// to the playhead, so playback speed does not depend on the screen's refresh rate.
// In multi-match view the same playhead means "this far into each match".

import { eventTimes } from '../data/select.js'
import { formatClock } from '../data/events.js'
import { EVENT_TYPES } from '../data/events.js'

const $ = id => document.getElementById(id)
const TICK_TYPES = ['Kill', 'BotKill', 'Killed', 'BotKilled', 'KilledByStorm']
let frame = 0
let last = 0
let ticksKey = ''

export function init (app) {
  $('btn-play').addEventListener('click', () => toggle(app))
  $('scrub').addEventListener('input', e => {
    if (app.state.playing) stop(app)
    app.setTime(Number(e.target.value))
  })
  $('scrub').addEventListener('change', () => app.writeUrl())
  $('speed').addEventListener('change', e => app.set({ speed: Number(e.target.value) }, { url: false }))
  $('trail').addEventListener('change', e => app.set({ trail: e.target.checked }, { url: false }))
  new ResizeObserver(() => { ticksKey = ''; render(app) }).observe($('time-ticks'))

  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    const el = e.target instanceof Element ? e.target : document.body
    const tag = el.tagName
    const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.isContentEditable
    if (typing && el.id !== 'scrub') return
    if (document.querySelector('dialog[open]')) return
    // Arrow keys, Home and End keep their own meaning inside the match list and on the scrubber.
    const free = !typing && !el.closest('.match-list')
    if (e.key === ' ' && tag !== 'BUTTON') {
      e.preventDefault()
      toggle(app)
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && free) {
      e.preventDefault()
      const step = (e.shiftKey ? 30 : 5) * (e.key === 'ArrowLeft' ? -1 : 1)
      app.setTime(Math.max(0, Math.min(app.duration, app.time + step)), { url: true })
    } else if (e.key === 'Home' && free) {
      app.setTime(0, { url: true })
    } else if (e.key === 'End' && free) {
      app.set({ t: null, playing: false })
    }
  })
}

function toggle (app) {
  if (app.state.playing) stop(app)
  else play(app)
}

function play (app) {
  if (app.view.length === 0) return
  // From the end, start again at 0; otherwise continue from the playhead.
  const start = app.state.t == null || app.time >= app.duration ? 0 : app.time
  app.set({ playing: true, t: start }, { url: false })
  last = performance.now()
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(now => tick(app, now))
}

function stop (app) {
  cancelAnimationFrame(frame)
  frame = 0
  app.set({ playing: false })
}

function tick (app, now) {
  if (!app.state.playing) return
  const dt = Math.min(0.1, (now - last) / 1000) // a background tab can pause for seconds; don't jump
  last = now
  const t = app.time + dt * app.state.speed
  if (t >= app.duration) {
    app.setTime(app.duration)
    stop(app)
    return
  }
  app.setTime(t)
  frame = requestAnimationFrame(next => tick(app, next))
}

export function render (app) {
  const s = app.state
  const has = app.view.length > 0
  const scrub = $('scrub')
  scrub.disabled = !has
  $('btn-play').disabled = !has
  $('speed').disabled = !has
  $('trail').checked = s.trail
  $('speed').value = String(s.speed)
  scrub.max = String(Math.ceil(app.duration))
  scrub.value = String(app.time)
  scrub.setAttribute('aria-valuetext', `${formatClock(app.time)} of ${formatClock(app.duration)}`)
  $('time-now').textContent = formatClock(app.time)
  $('time-end').textContent = formatClock(app.duration)
  const play = $('btn-play')
  play.textContent = s.playing ? '❚❚' : '▶'
  play.setAttribute('aria-label', s.playing ? 'Pause' : 'Play')
  $('time-mode').textContent = !has ? 'No match selected'
    : s.match ? 'Time into the match · ticks mark kills and deaths'
      : `Time into each match: all ${app.view.length} matches start together`
  drawTicks(app)
}

/** Kill and death times as thin coloured ticks above the scrubber. Redrawn only when the view changes. */
function drawTicks (app) {
  const c = $('time-ticks')
  const key = [app.state.map, app.state.date, app.state.match, app.state.minPlayers, app.state.search, c.clientWidth].join('|')
  if (key === ticksKey) return
  ticksKey = key
  const dpr = window.devicePixelRatio || 1
  c.width = Math.round(c.clientWidth * dpr)
  c.height = Math.round(c.clientHeight * dpr)
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  if (!app.view.length) return
  // Many matches: draw faint ticks so dense periods show up as brighter bands.
  ctx.globalAlpha = app.view.length > 1 ? 0.25 : 0.9
  for (const { type, t } of eventTimes(app.view, TICK_TYPES)) {
    ctx.fillStyle = EVENT_TYPES[type].color
    const x = Math.round((t / app.duration) * (c.width - 2 * dpr)) + dpr
    ctx.fillRect(x, 0, Math.max(1, dpr), c.height)
  }
}
