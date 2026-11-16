// stage-state.js: shows exactly one screen over the map: loading, empty, error, or none (ready).
//
// Every later feature reports through this one function instead of toggling elements itself,
// so there is no way to end up with two state screens visible at once, or a blank map.

const STATES = ['loading', 'empty', 'error']

/**
 * @param {'loading' | 'empty' | 'error' | 'ready'} state  'ready' hides every state screen
 * @param {{ title?: string, text?: string }} [message]    text for the empty or error screen
 */
export function setStageState (state, message = {}) {
  if (state !== 'ready' && !STATES.includes(state)) {
    throw new Error(`Unknown stage state: ${state}`)
  }

  for (const name of STATES) {
    document.getElementById(`state-${name}`).hidden = name !== state
  }

  if (state === 'empty') {
    document.getElementById('state-empty-title').textContent = message.title ?? 'No data to show'
    document.getElementById('state-empty-text').textContent = message.text ?? ''
  }

  if (state === 'error') {
    document.getElementById('state-error-text').textContent = message.text ?? ''
  }
}
