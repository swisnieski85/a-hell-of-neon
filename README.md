# A Hell of Neon — Demo of a Proof of Concept

A browser-only narrative game. Vanilla HTML/CSS/JavaScript, no build step, no
backend. The only dependency is [js-yaml](https://github.com/nodeca/js-yaml),
vendored as a single file in `vendor/`.

Mostly, this was a fun exercise in human-led agentic programming using Claude
Code and Fable 5.

## Running

Content is loaded with `fetch()`, so **the game will not run from `file://`**.
Serve the project root with the included script:

```
python tools/serve.py
```

It prints the address to open (<http://localhost:8000> by default). Pass a
port number to use a different one: `python tools/serve.py 8123`. Any other
static server also works, e.g. `python -m http.server` from the project root.

## Authoring

Adding a vignette never requires a code change:

1. Drop a YAML file into `content/vignettes/`.
2. Add one line to `content/manifest.yaml`.

That is the full workflow. Speaker portraits are mapped in
`content/characters.yaml`; a speaker with no entry (or an empty one) renders
as a nameplate only.

Flags come in two kinds by naming convention: flags prefixed with `_`
(e.g. `_khalil_here`) are **vignette-local** — cleared automatically whenever
any vignette is entered, so replaying a vignette restarts its internal state.
Unprefixed flags (e.g. `has_lenses`) persist for the whole game. Entering a
vignette also resets its hotspot visited-markers and scene intros.

A hotspot dims once its node has been read. One with `keep_lit: true` never
dims: use it for a hotspot that opens something new each time, like the
bookends' "Talk to Rose", which opens the `rose_next` router.

Hotspot `coords` are fractions of the 16:9 art (top-left origin) and must
stay inside it; `tools/validate-content.py` rejects a box that runs past an
edge. Exits with nothing to point at in the art go along the bottom edge,
"behind Brand": `{ x: 0.35, y: 0.90, w: 0.30, h: 0.09 }`.

Glossary terms (`content/glossary.yaml`) may list `aliases:`, other word
forms that count as the same term (`Cascadian` for `Cascadia`). The tooltip
shows once for the whole family.

In a location vignette, a node normally renders over the open scene's image;
a node with `hide_scene: true` drops the image while it is open (e.g. V03
once Brand leaves the perch — the rooftop view no longer applies). On an
arrival node it keeps the entry scene's art back until the scene opens (e.g.
V10, where the image would give away the heavy waiting in the chair).

Ambient sound follows the same layering. A vignette's `ambient:` list plays
by default. A scene's `ambient:` replaces it while that scene is open, and
nodes opened from the scene inherit it. A node's own `ambient:` replaces both
while the node is open. An empty list (`ambient: []`) is silence. V90 uses
this so the server room's cooler runs from the door until the generator is
shot.

A node with `blackout: true` is a cut to black: the art and the transcript
fade out almost at once, and after a beat only the choice bar comes back. What
was read before it is cleared, so the next node starts a fresh transcript and
fades in slowly. V90 uses one between Droz's gunshot and the hospital. A
blackout node usually has no blocks, just a `>>>` choice.

A node with `bare_eyed: true` is drawn as if the lenses were off (the `-off`
art, portraits and palette) even when the player is wearing them, and the
lens toggle is inert while it is open. V90 uses it for the server room after
the generator is shot, and through the blackout that follows.

A node can also set the status bar's `location:`, `date:` and `time:` while
it is open, for a vignette that moves somewhere else partway through (V90's
hospital and empty-apartment codas). Anything a node leaves out comes from the
vignette as usual.

A node can also name its own art with `image: <base>` (the same base name and
`-off`/`-on` pairing as a scene image). It shows that art, with no hotspots,
while the node is open, in any kind of vignette. The endings use it to leave
the scene they started in (V90's hospital and empty apartment).

Any block (a `prose:` or `dialogue:` entry in a node's `blocks:`) may carry a
`requires:` condition, in the same language as choices and hotspots. A block
whose condition fails is skipped, as if it weren't there, so one node can
carry lines that only some players see:

```yaml
- prose: |
    You know who wrote these orders now. Not his name. Just that he exists.
  requires: heavy2_done
```

In a `stepped:` node, skipped blocks take no click. Avoid `lenses_on` on blocks
inside stepped nodes: a lens toggle mid-node changes which blocks exist.

A vignette may declare `entry_lenses: "on"` or `"off"` in its frontmatter to
set Brand's lens state on arrival (otherwise it persists from wherever the
player just was).

A vignette may declare a stakeout clock in its frontmatter: every hotspot
click advances the status-bar time by `step` minutes, and when an event's
`at` (minutes elapsed) is reached, that click is interrupted and the event's
node opens instead. The clock stops after the last event fires.

```yaml
time: "11:00 PM"
clock:
  step: 5
  events:
    - at: 45
      node: t12_khalil_arrives
```

A vignette may declare an ambient soundscape in its frontmatter; tracks loop
for the whole vignette and crossfade on entry/exit:

```yaml
ambient:
  - distant_explosions
  - distant_gunfire
```

Names resolve to `assets/audio/ambient/{name}.mp3` (falling back to `.ogg`,
then `.wav`). All shipped audio is MP3, the one format every browser
(including Safari and iOS) plays. Loops play via the Web Audio API and are
sample-accurate as long as the MP3 carries LAME gapless metadata, which
ffmpeg writes by default. To convert a WAV or OGG master (keep masters in
`assets/master/audio/`):

```
ffmpeg -i master.wav -c:a libmp3lame -q:a 2 -ar 44100 assets/audio/ambient/name.mp3
```

Use `-q:a 4` for long loops where size matters. Then run
`python tools/build-art.py` to add the file to the asset index.

City maps are authored in `content/maps.yaml` — each top-level key is a map
id (different times get different maps), and a vignette sends the player
there with `goto_map: <id>` on a choice. Pins carry a portrait, a tooltip,
an optional `requires:` condition (same language as hotspots) that gates
when they appear, and a `goto_vignette:` target; a pin whose destination
isn't written yet omits the target and shows the Coming Soon overlay. Map
art lives at `assets/map/{image}.webp` (16:9, like scene art; PNG master in
`assets/master/map/`, built by `tools/build-art.py`).

## Assets

Scene art follows `assets/scenes/{vignetteNumber}-{sceneName}[-off|-on].webp`.
The game loads only WebP. The PNG masters live in `assets/master/scenes/`
and `assets/master/portraits/`; after adding or editing one, run
`python tools/build-art.py` (needs ImageMagick 7). Scenes convert at full
size; portraits are scaled to at most 384 px tall (they display at 76×114).
`assets/master/` (art and audio masters, GIMP files and scripts) is
gitignored: only the built WebP and MP3 files are in the repository, so keep
your own backup of the masters.
A scene's `image:` may also be a list of `{ image, requires }` stage variants
(most-specific first, unconditional fallback last); the first entry whose
condition holds is used, and the `-off`/`-on` rule applies to that base.
If `-on` is missing, `-off` serves both lens states; if both suffixed forms
are missing, the bare filename serves both; if nothing exists, the engine
renders a labeled placeholder rect at the same 16:9 box, so fractional
hotspot coordinates stay valid when real art lands.

All demo art is in place: off/on scene art for every scene, the Reseattle
map in `assets/map/`, portraits for Brand (both lens states), Frenk, Khalil,
Wash, and the Heavy in `assets/portraits/`, and Brand's status-bar icons
plus the hotspot marker in `assets/icons/`.

## Dev mode

Both dev switches live in `js/config.js`. **Set both to `false` for release.**

- **`DEV_ART_BUST`** appends a per-page-load query string to every scene,
  portrait, and map URL, so an overwritten image never shows stale. Leaving it
  on in a release makes players re-download all art on every visit.
- **`DEV_DEBUG_MENU`** shows a DEBUG button in the upper-right corner that
  opens the dev controls below. When it is `false` the button is gone and
  every reload lands on the title screen.

Content needs no switch: `js/content.js` fetches YAML with `cache: 'no-cache'`,
so the browser revalidates each file on load. An edit always shows up on a
plain reload, and an unchanged file costs only a 304. JS and CSS files are
*not* covered; after editing those, hard-refresh once (Ctrl+Shift+R).

Art and audio are looked up in `assets/asset-index.json`, which
`tools/build-art.py` rewrites on every run. A WebP or sound file added by hand
won't load until the index is rebuilt, so run the tool after adding audio too.

The debug controls:

- **On reload** — whether a page reload resumes at the current node or
  returns to the title screen. Handy when iterating on hotspot coordinates.
  Hidden on the title screen.
- **Skip to** — `D2`–`D5` start a fresh game at that day's dawn with a fixed
  set of flags for the earlier days (`DAY_SKIP_PRESETS` in `js/debug.js`).
- **Autopsy / Car / Heavy / Shred / Rose** — how far each thread has got when
  you next use Skip to, so you can e.g. skip to Day 4 with Heavy 1 done (`H1`)
  or to Day 3 with both Heavy beats done (`H2`). The `–` button in each row
  uses the day's preset for that thread; the others replace it. Rose runs
  `R0`–`R5` (2a, 2b, Beat 3, the confession, the morning after) plus `RX`,
  "said nothing" at the confession. Overridden flags are dated the day before
  the skip, so the next beat's day gate is already open. Each row is
  remembered in `localStorage` under `hon_debug_<thread>`. The rows and their
  flags are defined in `js/debug-threads.js`; add a thread there and it gets a
  row automatically.
- **Ending** — `RED` / `QUI` / `TRA` / `NIH` start a fresh game in that
  ending (Redemption, Quietism, Tragedy, Nihilism) on Day 5, with the morning
  slot spent. The thread rows apply, so you can check the optional-thread
  lines (e.g. `S2` for the Wash and Wu lines). Then the ending's own
  requirements override them: Redemption and Quietism get the full Autopsy
  spine and an Echo route (Car, unless the rows give Car or Heavy 2); Tragedy
  and Nihilism lose Car and Heavy 2; Redemption and Tragedy get Rose's chain
  through the confession; Quietism and Nihilism lose the confession (`RX`
  is kept). See `debugSkipToEnding` in `js/debug.js`.

The panel closes on a click outside it, on Escape, or when you skip to a day
or an ending.

## Save state

The game autosaves to `localStorage` under the single key `hon_save` on every
state change. "Continue" on the title screen is disabled if the save is absent
or fails validation. New Game over a populated save asks before overwriting.
Reaching the end of the game wipes the save and returns to the title screen.

Validation checks that the vignette, node, scene and map the save points at
still exist, so renaming a node between releases disables Continue for old
saves instead of breaking them. The save carries a `version` (`SAVE_VERSION`
in `js/state.js`); bump it, and migrate in `loadInto()`, when the save's shape
changes. If anything throws during a screen transition anyway, the game falls
back to the title instead of staying on black.

The save also carries the current vignette's dialogue transcript (everything
already read, as rendered HTML), so a reload or Continue restores the dialogue
box as it was. The node that's open re-renders from its first line. Entering
a vignette, or dying in one, empties the transcript.

Endings reached are kept separately, under `hon_endings`, so they survive the
end-of-game wipe. Each ending's End choice carries `ending: <id>` (the ids,
names and one-line descriptions are in `content/endings.yaml`; the validator
requires the tag on every `goto_screen: end`). The title screen shows one box
per ending along the bottom, but only once at least one has been reached.
**Options > Clear saved data** erases both `hon_save` and `hon_endings`.

## Credits

Audio attributions are listed in [CREDITS.md](CREDITS.md). Images were generated using Midjourney, mostly version 6.1.

## Rights

© 2026 Sean Wisnieski. All rights reserved. This is not open-source
software; see [LICENSE](LICENSE) for terms and third-party exceptions.
