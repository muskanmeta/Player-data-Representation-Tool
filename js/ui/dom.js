// dom.js: one tiny helper for building elements.
//
// Why not innerHTML: match and player IDs come from uploaded files, so they are untrusted
// text. Building nodes and setting textContent can never turn that text into markup.

/**
 * h('button', { class: 'chip', onclick: fn, 'aria-pressed': 'true' }, 'Feb 13', child, ...)
 * Attributes starting with "on" become event listeners; false/null attributes are skipped.
 */
export function h (tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value)
    else if (key === 'class') el.className = value
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value)
    else el.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return el
}

/** Replaces all children of an element. */
export function replace (el, ...children) {
  el.replaceChildren(...children.flat().filter(c => c !== null && c !== undefined && c !== false))
}

/** Thousands separators: 12866 -> "12,866". */
export const fmt = n => Number(n).toLocaleString('en-US')

/** A short message at the bottom of the screen that disappears by itself. */
export function toast (text) {
  const el = document.getElementById('toast')
  el.textContent = text
  el.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { el.hidden = true }, 2600)
}

/** plural(1, 'match') -> "1 match"; plural(3, 'match') -> "3 matches". */
export const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : /(s|x|ch|sh)$/.test(word) ? 'es' : 's'}`
