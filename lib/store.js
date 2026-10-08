// Tiny localStorage wrapper for tools that keep data on this device (lists, trackers, settings).
// Never throws: private mode / blocked storage just means nothing persists.
const NS = 'tools:'

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function remove(key) {
  try { localStorage.removeItem(NS + key) } catch { /* ignore */ }
}

/** persisted('todo', []) -> {get(), set(v), update(fn)} */
export function persisted(key, fallback) {
  let value = load(key, fallback)
  return {
    get: () => value,
    set(v) { value = v; save(key, v); return v },
    update(fn) { return this.set(fn(value)) },
  }
}
