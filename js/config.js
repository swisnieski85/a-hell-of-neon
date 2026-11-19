// Dev switches, in one place. All false for release (see README — Dev mode).

// The DEBUG menu (reload-resume, day skip, thread levels, ending skip). When
// false the menu is hidden and a page reload always lands on the title.
export const DEV_DEBUG_MENU = false;

// Appends a per-page-load query string to every portrait/scene/map URL, so an
// overwritten image never shows stale from the HTTP cache. Leaving it on in a
// release makes players re-download all art on every visit.
export const DEV_ART_BUST = false;
