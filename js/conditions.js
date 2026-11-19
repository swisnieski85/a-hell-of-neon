// minimal declarative condition language: all / any / not, nestable.
// Flags are booleans in a flat namespace. `lenses_on` is a reserved token
// resolved from live state, not the flag store.
//
// Day-system extensions (mid-game):
//   'slots_exhausted'      — reserved token: the current day's vignette slots
//                            are spent (slots_used >= slot_budget).
//   { day_is: N }          — it is day N.
//   { day_at_least: N }    — it is day N or later.
//   { day_after: 'flag' }  — at least one day has passed since `flag` was
//                            set (false while the flag is unset). Institutional
//                            gates — records, subpoenas, other people's
//                            calendars — use this; person-gates don't.

export function evalCond(cond, state) {
  if (cond == null) return true;
  if (typeof cond === 'string') {
    if (cond === 'lenses_on') return !!state.lenses_worn;
    if (cond === 'slots_exhausted') {
      return (state.slots_used || 0) >= (state.slot_budget || 0);
    }
    return !!state.flags[cond];
  }
  if (Array.isArray(cond)) return cond.every((c) => evalCond(c, state));
  if (cond.all !== undefined) return cond.all.every((c) => evalCond(c, state));
  if (cond.any !== undefined) return cond.any.some((c) => evalCond(c, state));
  if (cond.not !== undefined) return !evalCond(cond.not, state);
  if (cond.day_is !== undefined) return (state.day || 0) === cond.day_is;
  if (cond.day_at_least !== undefined) return (state.day || 0) >= cond.day_at_least;
  if (cond.day_after !== undefined) {
    const setOn = (state.flag_days || {})[cond.day_after];
    return setOn !== undefined && (state.day || 0) > setOn;
  }
  return false;
}
