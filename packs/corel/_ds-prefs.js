// Draw Studio preferences that survive a reload (view switches and the Options dialog). Pure: cleanPrefs() whitelists whatever was stored,
// so a damaged or hostile value in localStorage can never reach the editor. The shell loads and saves them with lib/store.js.
export const PREF_KEY = 'ds-prefs'
const BOOLS = ['rulers', 'showGuides', 'lockGuides', 'showGrid', 'snap', 'snapGuides', 'snapObjects', 'snapPage', 'snapGrid', 'scaleStroke', 'lockRatio']
const RANGES = { dupOffset: [0, 100], nudge: [0.01, 100], gridStep: [1, 5000] }
export const PREF_DEFAULTS = { dupOffset: 5, nudge: 1, scaleStroke: false, wheel: 'zoom' }

/** The valid preferences found in `raw` (anything else is dropped). */
export function cleanPrefs(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const k of BOOLS) if (typeof raw[k] === 'boolean') out[k] = raw[k]
  for (const [k, [lo, hi]] of Object.entries(RANGES)) if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) out[k] = Math.min(hi, Math.max(lo, raw[k]))
  if (raw.wheel === 'zoom' || raw.wheel === 'scroll') out.wheel = raw.wheel
  return out
}
/** The part of the preferences worth saving. */
export const savedPrefs = (prefs) => cleanPrefs(prefs)
