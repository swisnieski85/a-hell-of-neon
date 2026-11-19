// Dev-only: the DEBUG menu's day skip and ending skip (js/config.js
// DEV_DEBUG_MENU). Builds a plausible state for the chosen day or ending,
// then enters it through the engine.

import * as S from './state.js';
import { DEBUG_THREADS } from './debug-threads.js';
import { enterVignette } from './engine.js';

// Canonical state at the start of each day, assuming the mandatory pace plus
// the Rose chain on schedule. Each flag maps to the day it was set (that
// feeds flag_days, which the day_after gates read — get these wrong and the
// institutional pins won't light). EDIT FREELY while testing: e.g. drop
// rose3_done to see the pre-confession filler, or add car_done: 3 to arrive
// at Day 5 already qualified. Optional-thread flags (car/heavy/shred) are
// deliberately absent so skipped-to days still have a full map to play.
const DAY_SKIP_PRESETS = {
  2: { vignette: 'bookend-d2-dawn.yaml', flags: { has_lenses: 1 } },
  3: { vignette: 'bookend-d3-dawn.yaml', flags: {
    has_lenses: 1,
    autopsy1_done: 2, rose1_done: 2, rose_living_with_brand: 2,
    rose2a_done: 2, rose2b_done: 2,
  } },
  4: { vignette: 'bookend-d4-dawn.yaml', flags: {
    has_lenses: 1,
    autopsy1_done: 2, rose1_done: 2, rose_living_with_brand: 2,
    rose2a_done: 2, rose2b_done: 2,
    facematch_done: 3, autopsy2_done: 3, rose3_done: 3,
  } },
  5: { vignette: 'bookend-d5-dawn.yaml', flags: {
    has_lenses: 1,
    autopsy1_done: 2, rose1_done: 2, rose_living_with_brand: 2,
    rose2a_done: 2, rose2b_done: 2,
    facematch_done: 3, autopsy2_done: 3, rose3_done: 3,
    autopsy3_done: 4,
  } },
};

// levels: { threadId: levelIndex | null } from the debug panel (see
// DEBUG_THREADS). null (or absent) keeps the day preset's flags for that
// thread; an index replaces them with that level's flags. Overridden flags are
// dated the day before the skip (Day 2 at the earliest), so day_after gates on
// the next beat are already open — e.g. A2 on a Day 3 skip lights Autopsy 3.
export function debugSkipToDay(day, levels = {}) {
  if (!DAY_SKIP_PRESETS[day]) return;
  debugBuildState(day, levels);
  return enterVignette(DAY_SKIP_PRESETS[day].vignette);
}

// Day preset + thread-row overrides, without entering anything.
function debugBuildState(day, levels) {
  const preset = DAY_SKIP_PRESETS[day];
  S.reset();
  const st = S.state;
  st.lens_hint_done = true; // skipped-to days assume the player knows the lenses
  for (const [flag, setOn] of Object.entries(preset.flags)) debugSetFlag(flag, setOn);
  const setOn = Math.max(2, day - 1);
  for (const thread of DEBUG_THREADS) {
    const level = thread.levels[levels[thread.id]];
    if (!level) continue; // null / absent: keep the preset
    for (const l of thread.levels) for (const flag of l.flags) debugClearFlag(flag);
    if (level.flags.length) {
      for (const flag of thread.prereq || []) if (!st.flags[flag]) debugSetFlag(flag, setOn);
    }
    for (const flag of level.flags) debugSetFlag(flag, setOn);
  }
}

function debugSetFlag(flag, setOn) {
  S.state.flags[flag] = true;
  S.state.flag_days[flag] = setOn;
}

function debugClearFlag(flag) {
  delete S.state.flags[flag];
  delete S.state.flag_days[flag];
}

// Debug: jump straight into an ending. Builds the Day 5 state with the
// thread rows applied (so optional-thread payoff lines can be checked), then
// forces only what the ending's cell requires:
//   - stopped (Redemption/Quietism): the full Autopsy spine + an Echo route
//     (Car, unless the rows already give Car or Heavy 2);
//   - not stopped (Tragedy/Nihilism): no Echo route (Car and Heavy 2 cleared);
//   - confessed (Redemption/Tragedy): Rose's chain through Beat 4, told;
//   - not confessed (Quietism/Nihilism): Beat 4 and the aftermath cleared
//     (a Rose row of RX, "said nothing", is kept).
const DEBUG_ENDINGS = {
  redemption: { file: '90-finale-server-room.yaml', stopped: true, confessed: true },
  quietism: { file: '90-finale-server-room.yaml', stopped: true, confessed: false },
  tragedy: { file: '91-ending-tragedy.yaml', stopped: false, confessed: true },
  nihilism: { file: '92-ending-nihilism.yaml', stopped: false, confessed: false },
};

export function debugSkipToEnding(ending, levels = {}) {
  const cell = DEBUG_ENDINGS[ending];
  if (!cell) return;
  debugBuildState(5, levels);
  const st = S.state;
  const on = 4;
  const set = (flags) => { for (const f of flags) if (!st.flags[f]) debugSetFlag(f, on); };
  const clear = (flags) => { for (const f of flags) debugClearFlag(f); };
  if (cell.stopped) {
    set(['autopsy1_done', 'autopsy2_done', 'autopsy3_done']);
    if (!st.flags.car_done && !st.flags.heavy2_done) set(['car_done']);
  } else {
    clear(['car_done', 'heavy2_done']);
  }
  if (cell.confessed) {
    set(['autopsy3_done', 'rose1_done', 'rose_living_with_brand', 'rose2a_done',
         'rose2b_done', 'rose3_done', 'rose4_done', 'confessed']);
    clear(['confession_declined']);
  } else {
    clear(['rose4_done', 'confessed', 'rose_aftermath_done']);
  }
  // Day 5, the morning slot spent: where the map's endgame redirect fires.
  st.day = 5;
  st.slot_budget = 1;
  st.slots_used = 1;
  return enterVignette(cell.file);
}

