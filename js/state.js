// Game state + persistence. Single localStorage key. Autosave is the
// caller's responsibility: every mutation path in engine.js ends in save().

const KEY = 'hon_save';

// Bump when the save's shape changes in a way loadInto() must migrate.
// Saves from before versioning have no `version` and are treated as 1.
export const SAVE_VERSION = 1;

export let state = null;

export function reset() {
  state = {
    version: SAVE_VERSION,
    screen: 'title',
    vignette: null,
    map: null, // which content/maps.yaml entry the map screen shows
    scene: null,
    node: null,
    flags: {},
    lenses_worn: false,
    visited: {},
    intro_seen: {},
    seen_terms: {},
    clock_min: 0,   // stakeout clock — minutes elapsed past the vignette's time
    clock_fired: 0, // how many of the vignette's timed events have fired
    map_datetime: null, // last vignette's date/time — shown on the map's bar
    // Day system (mid-game): the current day number, how many of its vignette
    // slots are spent, its budget, the day each persistent flag was set on
    // (for day_after gates), and the last authored date seen (vignettes
    // without a `date` of their own — slot vignettes playable on any day —
    // inherit it for the status bar).
    day: 0,
    slots_used: 0,
    slot_budget: 0,
    slot_times: null,   // the day's slot clock (from the dawn bookend)
    flag_days: {},
    date_display: null,
    time_display: null, // stamped per slot — slot vignettes carry no time
    open_hotspot: null,
    // The dialogue box's finished transcript for this vignette (the history,
    // as HTML), so a reload or Continue shows everything already read.
    transcript: '',
    // True once the player has toggled the lenses for the first time; until
    // then the status bar nudges them toward the portrait button.
    lens_hint_done: false,
    entry_snapshot: null,
  };
}

// Storage can be full, blocked, or missing (some private-browsing modes). A
// failed save must not stop the game: keep playing without persistence, and
// say so once in the console.
let saveWarned = false;

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    if (!saveWarned) {
      saveWarned = true;
      console.warn('A Hell of Neon: saving failed; progress will not persist.', err);
    }
  }
}

// The end of the game: the save is wiped outright so the next visitor (or the same
// one) starts clean from the title.
export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* storage unavailable: nothing to clear */ }
}

// Endings reached, kept in their own key: the save is wiped at every end card
// (above), and this must outlive it. Only Options > Clear saved data erases it.
const ENDINGS_KEY = 'hon_endings';

export function endingsReached() {
  try {
    const list = JSON.parse(localStorage.getItem(ENDINGS_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordEnding(id) {
  const list = endingsReached();
  if (list.includes(id)) return;
  list.push(id);
  try {
    localStorage.setItem(ENDINGS_KEY, JSON.stringify(list));
  } catch { /* storage unavailable: the row just won't fill */ }
}

// Options > Clear saved data: the current game and the endings record.
export function clearAllData() {
  clearSave();
  try {
    localStorage.removeItem(ENDINGS_KEY);
  } catch { /* storage unavailable: nothing to clear */ }
}

export function loadRaw() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

// Schema validation gates the Continue button. A save that fails here is
// treated as absent. Besides the shape, it checks that the vignette, node,
// scene and map the save points at still exist in the content: a node renamed
// between releases would otherwise throw on Continue.
export function validate(s, content) {
  if (!s || typeof s !== 'object') return false;
  if (typeof s.version === 'number' && s.version > SAVE_VERSION) return false; // from a newer build
  if (!['title', 'vignette', 'map'].includes(s.screen)) return false;
  if (!s.flags || typeof s.flags !== 'object') return false;
  if (typeof s.lenses_worn !== 'boolean') return false;
  if (!content) return true;
  if (s.screen === 'vignette') {
    if (typeof s.vignette !== 'string') return false;
    if (!content.manifest.vignettes.includes(s.vignette)) return false;
    const v = content.vignettes[s.vignette];
    if (!v || v.kind === 'fragment') return false;
    if (s.node && !nodeExists(content, v, s.node)) return false;
    if (s.scene && !(v.scenes && v.scenes[s.scene])) return false;
  }
  if (s.screen === 'map' && s.map && !(content.maps && content.maps[s.map])) return false;
  return true;
}

function nodeExists(content, v, id) {
  if ((v.nodes || []).some((n) => n.id === id)) return true;
  return Object.values(content.vignettes).some(
    (f) => f.kind === 'fragment' && (f.nodes || []).some((n) => n.id === id)
  );
}

export function loadInto(s) {
  state = s;
  state.version = SAVE_VERSION; // saves before versioning carry none
  if (!state.visited) state.visited = {};
  if (!state.intro_seen) state.intro_seen = {};
  if (!state.seen_terms) state.seen_terms = {};
  if (!state.flag_days) state.flag_days = {};
  if (typeof state.transcript !== 'string') state.transcript = ''; // older saves
  if (typeof state.lens_hint_done !== 'boolean') state.lens_hint_done = false;
}

function deepCopy(o) {
  return JSON.parse(JSON.stringify(o));
}

// on entering any vignette, deep-copy the entire game state. Stored
// inside the save so a death survives a page reload mid-fade.
export function takeSnapshot() {
  const { entry_snapshot, ...rest } = state;
  state.entry_snapshot = deepCopy(rest);
}

// restore wholesale. The restored state keeps itself as its own
// entry snapshot so a second death in the same vignette rewinds identically.
export function restoreSnapshot() {
  const snap = deepCopy(state.entry_snapshot);
  snap.entry_snapshot = deepCopy(snap);
  state = snap;
  save();
}
