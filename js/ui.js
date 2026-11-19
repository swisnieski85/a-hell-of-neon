// Screen chrome: screen switching, status bar (hardcoded), fade
// primitive, modal, title and map screens.

import * as S from './state.js';
import { resolveSingle, fillImageBox, bust, onTapOrClick } from './render.js';
import { DEV_DEBUG_MENU } from './config.js';
import { evalCond } from './conditions.js';
import { syncAmbient } from './audio.js';
import { DEBUG_THREADS } from './debug-threads.js';

const $ = (id) => document.getElementById(id);

const SCREENS = ['screen-title', 'screen-vignette', 'screen-map', 'screen-end'];

export function applyLensClass() {
  document.body.classList.toggle('lenses-on', !!(S.state && S.state.lenses_worn));
  document.body.classList.toggle('lenses-off', !(S.state && S.state.lenses_worn));
}

export function showScreen(name) {
  for (const id of SCREENS) $(id).classList.toggle('hidden', id !== `screen-${name}`);
  document.body.dataset.screen = name; // lets CSS scope chrome per screen
}

// ---------- Status bar ----------

// Stakeout clock: vignettes with a `clock:` advance time as hotspots are
// clicked (engine keeps clock_min). The bar shows base time + elapsed
// minutes; without a clock (or a parseable time) it shows time as written.
export function clockTime(vignette) {
  const base = String(vignette.time || '').trim();
  const extra = (S.state && S.state.clock_min) || 0;
  if (!extra) return base;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i.exec(base);
  if (!m) return base;
  let h = parseInt(m[1], 10) % 12;
  if (/pm/i.test(m[3])) h += 12;
  const total = (h * 60 + (m[2] ? parseInt(m[2], 10) : 0) + extra) % 1440;
  const h24 = Math.floor(total / 60);
  const disp = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${disp}:${String(total % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

// Present in vignettes (icon only in `location` kind), absent on title and
// map. Fields are code, not data — the one sanctioned exception.
// "21 October 2554" -> "Monday, 21 October 2554". The story's dates follow
// the real Gregorian calendar (Day 5, 23 October 2554, is the Wednesday the
// update ships), so the weekday is computed rather than authored. Anything
// that doesn't parse (a TODO placeholder) is shown as written.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
  'Friday', 'Saturday'];

export function withWeekday(date) {
  const m = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(String(date || '').trim());
  if (!m) return date || '';
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return date;
  const d = new Date(0);
  d.setUTCFullYear(Number(m[3]), month, Number(m[1]));
  return `${WEEKDAYS[d.getUTCDay()]}, ${date}`;
}

// `node` (optional): a node can override the bar's location, date and time
// while it's open (location: / date: / time: on the node) — for a scene that
// jumps elsewhere inside one vignette, like V90's codas.
export function updateStatusBar(vignette, node = null) {
  const bar = $('status-bar');
  if (!vignette) {
    bar.classList.add('hidden');
    document.body.classList.remove('has-bar');
    return;
  }
  bar.classList.remove('hidden');
  document.body.classList.add('has-bar');
  // Slot vignettes play on whatever day/slot the player picks them — they
  // carry no `date`/`time` of their own and inherit the day's date (from the
  // dawn bookend) and the slot's hour (stamped by the engine per slot_times).
  const date = (node && node.date) || vignette.date || (S.state && S.state.date_display) || '';
  const time = (node && node.time) || clockTime(vignette) || (S.state && S.state.time_display) || '';
  const location = (node && node.location) || vignette.location;
  const dt = `${withWeekday(date)} · ${time}`;
  $('bar-datetime').textContent = (location ? `${location} · ${dt}` : dt).toUpperCase();

  const toggle = $('lens-toggle');
  const icon = $('lens-icon');
  if (vignette.kind !== 'location') {
    toggle.classList.add('hidden'); // absent entirely in linear vignettes
    return;
  }
  toggle.classList.remove('hidden');

  const has = !!S.state.flags.has_lenses;
  const worn = !!S.state.lenses_worn;
  const locked = vignette.lens_toggle === 'locked';
  icon.src = worn ? 'assets/icons/brand_icon_on.png' : 'assets/icons/brand_icon_off.png';
  const live = has && !locked;
  toggle.classList.toggle('inert', !live);
  toggle.disabled = !live;
  // First-use cue: pulse the button and label it until the player first
  // uses the lenses (state.lens_hint_done, set in engine.toggleLenses).
  const nudge = live && !S.state.lens_hint_done;
  toggle.classList.toggle('nudge', nudge);
  $('lens-hint').classList.toggle('hidden', !nudge);
  const tip = !has
    ? ''
    : worn
      ? 'Click to remove entoptic lenses'
      : 'Click to put on entoptic lenses';
  if (tip) toggle.dataset.tip = tip;
  else delete toggle.dataset.tip;
}

// ---------- Debug menu ----------

// One DEBUG button (top right) opens a panel of dev controls: the
// reload-resume toggle, the day skip, the thread-progress rows, and the
// ending skip.
// DEV_DEBUG_MENU (js/config.js) gates the whole menu: false hides it and
// makes reloads always land on the title.
const DEBUG_KEY = 'hon_debug_resume';

export function initDebugMenu(onSkip, onEnding) {
  const menu = $('debug-menu');
  if (!DEV_DEBUG_MENU) {
    menu.hidden = true;
    return;
  }
  const open = $('debug-open');
  const panel = $('debug-panel');
  const setOpen = (on) => {
    panel.hidden = !on;
    open.setAttribute('aria-expanded', String(on));
  };
  open.addEventListener('click', () => setOpen(panel.hidden));
  // Close on a click anywhere outside the menu, or on Escape.
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !menu.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) setOpen(false);
  });
  initReloadToggle();
  // A day skip changes screens, so it also closes the menu.
  initDaySkip((day) => {
    setOpen(false);
    onSkip(day);
  });
  initThreadLevels();
  initEndingSkip((ending) => {
    setOpen(false);
    onEnding(ending);
  });
}

// Reload-resume: dev convenience for iterating on hotspot coords. When on,
// a page reload drops straight back into the saved node instead of the title
// screen. Lives in its own localStorage key — a dev preference, not save data.
export function debugResume() {
  return DEV_DEBUG_MENU && localStorage.getItem(DEBUG_KEY) === '1';
}

function initReloadToggle() {
  const btn = $('debug-reload');
  const sync = () => {
    const on = debugResume();
    btn.textContent = on ? 'RESUME HERE' : 'GO TO TITLE';
    btn.classList.toggle('on', on);
    btn.title = on
      ? 'Debug: reloading the page resumes at the current node'
      : 'Debug: reloading the page returns to the title screen';
  };
  btn.addEventListener('click', () => {
    localStorage.setItem(DEBUG_KEY, debugResume() ? '0' : '1');
    sync();
  });
  sync();
}

// Day skip: jump to any day's dawn bookend with the canonical prior state
// applied (see DAY_SKIP_PRESETS in debug.js). Available on the title screen
// too, so a fresh page can skip straight into the mid-game.
function initDaySkip(onSkip) {
  const box = $('debug-days');
  for (const day of [2, 3, 4, 5]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `D${day}`;
    btn.title = `Debug: skip to Day ${day} dawn (canonical flags)`;
    btn.addEventListener('click', () => onSkip(day));
    box.appendChild(btn);
  }
}

// Dev thread-progress selectors, applied on the next day skip: one row per
// thread in DEBUG_THREADS. The "–" button keeps the day preset's flags for
// that thread; the others set how far the thread has got (e.g. Day 4 with
// H1, or Day 3 with H2). Each row is a dev preference in its own
// localStorage key (hon_debug_<id>), like the reload toggle.
const threadKey = (id) => `hon_debug_${id}`;

function debugThreadLevel(id) {
  let v = null;
  try { v = localStorage.getItem(threadKey(id)); } catch { /* storage blocked */ }
  return v === null || v === '' ? null : Number(v);
}

// { threadId: levelIndex | null } for debugSkipToDay.
export function debugThreadLevels() {
  const out = {};
  if (!DEV_DEBUG_MENU) return out;
  for (const t of DEBUG_THREADS) out[t.id] = debugThreadLevel(t.id);
  return out;
}

function initThreadLevels() {
  const panel = $('debug-panel');
  for (const thread of DEBUG_THREADS) {
    const row = document.createElement('div');
    row.className = 'debug-row';
    const label = document.createElement('span');
    label.className = 'debug-label';
    label.textContent = thread.label;
    const box = document.createElement('div');
    box.className = 'debug-buttons';
    row.append(label, box);
    panel.appendChild(row);

    const buttons = [];
    const sync = () => {
      const cur = debugThreadLevel(thread.id);
      for (const [index, btn] of buttons) btn.classList.toggle('on', index === cur);
    };
    const options = [[null, `${thread.levels[0].code[0]}–`, 'use the day preset'],
      ...thread.levels.map((l, i) => [i, l.code, l.tip])];
    for (const [index, code, tip] of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = code;
      btn.title = `Debug: ${thread.label}: ${tip}. Applies on the next day skip.`;
      btn.addEventListener('click', () => {
        try {
          localStorage.setItem(threadKey(thread.id), index === null ? '' : String(index));
        } catch { /* ignore */ }
        sync();
      });
      buttons.push([index, btn]);
      box.appendChild(btn);
    }
    sync();
  }
}

// Ending skip: jump straight into one of the four endings on Day 5. The
// thread rows above apply (for the optional-thread payoff lines); the engine
// then forces whatever the chosen cell requires (see debugSkipToEnding).
function initEndingSkip(onEnding) {
  const panel = $('debug-panel');
  const row = document.createElement('div');
  row.className = 'debug-row';
  const label = document.createElement('span');
  label.className = 'debug-label';
  label.textContent = 'Ending';
  const box = document.createElement('div');
  box.className = 'debug-buttons';
  row.append(label, box);
  panel.appendChild(row);
  const endings = [
    ['redemption', 'RED', 'Redemption (stopped Wormwood, confessed)'],
    ['quietism', 'QUI', 'Quietism (stopped Wormwood, did not confess)'],
    ['tragedy', 'TRA', 'Tragedy (did not stop Wormwood, confessed)'],
    ['nihilism', 'NIH', 'Nihilism (did not stop Wormwood, did not confess)'],
  ];
  for (const [id, code, tip] of endings) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = code;
    btn.title = `Debug: play ${tip}. The thread rows apply; the ending's own requirements override them.`;
    btn.addEventListener('click', () => onEnding(id));
    box.appendChild(btn);
  }
}

// ---------- Fade (400ms out, 200ms hold, 400ms in) ----------

// If the work done under the black overlay throws (a save pointing at a node
// that no longer exists, a content typo), the overlay must still lift. The
// handler (main.js) puts the title back up so the game isn't left on black.
let fadeErrorHandler = null;

export function onFadeError(fn) {
  fadeErrorHandler = fn;
}

export function fade(during) {
  const overlay = $('fade-overlay');
  return new Promise((resolve) => {
    overlay.classList.add('active');
    setTimeout(async () => {
      try {
        await during();
      } catch (err) {
        console.error('A Hell of Neon:', err);
        try {
          if (fadeErrorHandler) fadeErrorHandler(err);
        } catch (err2) {
          console.error('A Hell of Neon: error handler failed:', err2);
        }
      }
      setTimeout(() => {
        overlay.classList.remove('active');
        setTimeout(resolve, 400);
      }, 200);
    }, 400);
  });
}

// ---------- Modal ----------

export function confirmModal(text, okLabel, cancelLabel) {
  return new Promise((resolve) => {
    $('modal-text').textContent = text;
    const ok = $('modal-ok');
    const cancel = $('modal-cancel');
    ok.textContent = `[${okLabel}]`;
    cancel.textContent = `[${cancelLabel}]`;
    const backdrop = $('modal-backdrop');
    const done = (result) => {
      backdrop.classList.add('hidden');
      ok.onclick = cancel.onclick = null;
      resolve(result);
    };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    backdrop.classList.remove('hidden');
  });
}

// ---------- Title ----------

// The sign floats in alone on black. The first gesture (click or key) wakes
// it: the hum starts — a user gesture, so autoplay policy allows it — and the
// menu appears. Once per page load; afterwards the title shows fully formed.
let titleAwake = false;

// ---------- Endings row (content/endings.yaml) ----------

let endingDefs = [];

export function initEndings(defs) {
  endingDefs = Array.isArray(defs) ? defs : [];
}

// One box per ending, in endings.yaml order. Hidden entirely until the first
// ending is reached, and until the menu is up (not over the intro note).
function renderEndingsRow() {
  const row = $('endings-row');
  const reached = S.endingsReached();
  row.innerHTML = '';
  if (!reached.length) {
    row.classList.add('hidden');
    return;
  }
  for (const e of endingDefs) {
    const got = reached.includes(e.id);
    const box = document.createElement('div');
    box.className = got ? 'ending-box reached' : 'ending-box';
    box.tabIndex = 0;
    box.setAttribute('role', 'listitem');
    box.setAttribute('aria-label', got ? `${e.name}: ${e.description}` : `${e.name}, not reached`);
    const tip = document.createElement('div');
    tip.className = 'ending-tip';
    tip.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'ending-name';
    name.textContent = e.name;
    tip.appendChild(name);
    if (got) {
      const desc = document.createElement('span');
      desc.className = 'ending-desc';
      desc.textContent = e.description;
      tip.appendChild(desc);
    }
    box.appendChild(tip);
    row.appendChild(box);
  }
  row.classList.toggle('hidden', !titleAwake);
}

// The title menu and the Options menu share one spot; `which` picks one.
export function showTitleMenu(which) {
  const menu = document.querySelector('#screen-title .title-menu');
  const options = document.querySelector('#screen-title .title-options');
  menu.classList.toggle('hidden', which === 'options');
  options.classList.toggle('hidden', which !== 'options');
}

export function showTitle(canContinue) {
  updateStatusBar(null);
  $('btn-continue').disabled = !canContinue;
  const menu = document.querySelector('#screen-title .title-menu');
  const intro = document.querySelector('#screen-title .title-intro');
  showTitleMenu('main');
  showScreen('title');
  renderEndingsRow();

  if (titleAwake) {
    intro.classList.add('hidden');
    menu.classList.remove('unlit');
    syncAmbient(['neon_hum'], 2500); // the sign hums; fades out when play starts
    return;
  }

  menu.classList.add('unlit');
  const wake = () => {
    titleAwake = true;
    document.removeEventListener('pointerdown', wake, true);
    document.removeEventListener('keydown', wake, true);
    syncAmbient(['neon_hum'], 0); // snaps on with the sign — no fade-in
    intro.classList.add('out');
    menu.classList.remove('unlit');
    menu.classList.add('wake');
    if ($('endings-row').childElementCount) $('endings-row').classList.remove('hidden');
  };
  document.addEventListener('pointerdown', wake, true);
  document.addEventListener('keydown', wake, true);
}

// ---------- The end ----------

// The game's last card, after every ending: reached by `goto_screen: end`
// on a choice (the engine lets the ending's last image linger first). Bar and
// ambience drop away; the click-through (wired in main.js) wipes the save
// and returns to the title.
export function showEnd() {
  updateStatusBar(null);
  syncAmbient([]);
  showScreen('end');
}

// ---------- Map (content/maps.yaml) ----------

// A separate screen type, not a vignette. No lens states, but the bar stays:
// portrait icon (inert) and the date/time of the vignette just left — no
// location field. Maps are authored in content/maps.yaml; pins may be gated
// by `requires` and lead to a vignette. A pin with no goto_vignette (a
// destination not written yet) shows the Coming Soon overlay instead.

function mapStatusBar() {
  const bar = $('status-bar');
  bar.classList.remove('hidden');
  document.body.classList.add('has-bar');
  const dt = S.state.map_datetime;
  $('bar-datetime').textContent = dt ? `${withWeekday(dt.date)} · ${dt.time}`.toUpperCase() : '';
  const toggle = $('lens-toggle');
  toggle.classList.remove('hidden');
  $('lens-icon').src = S.state.lenses_worn
    ? 'assets/icons/brand_icon_on.png'
    : 'assets/icons/brand_icon_off.png';
  toggle.classList.add('inert'); // no lens states on the map — display only
  toggle.disabled = true;
  toggle.classList.remove('nudge');
  $('lens-hint').classList.add('hidden');
  delete toggle.dataset.tip;
}

let pinPicked = false; // reset each time the map is shown

function pinEl(pin, onPin) {
  const spot = document.createElement('button');
  spot.type = 'button';
  spot.className = 'hotspot map-pin';
  spot.style.left = `${pin.coords.x * 100}%`;
  spot.style.top = `${pin.coords.y * 100}%`;
  spot.style.width = `${(pin.coords.w || 0.07) * 100}%`;
  spot.style.height = `${(pin.coords.h || 0.12) * 100}%`;
  if (pin.tooltip) {
    spot.dataset.tip = pin.tooltip;
    spot.setAttribute('aria-label', pin.tooltip);
  }
  const face = document.createElement('img');
  face.className = 'pin-face';
  face.src = bust(pin.portrait
    ? `assets/portraits/${pin.portrait}`
    : 'assets/icons/hotspot.png'); // portrait-less pins fall back to the marker
  face.alt = '';
  spot.appendChild(face);
  const tail = document.createElement('div');
  tail.className = 'pin-tail'; // the pin's point — ::after is taken by the tooltip
  spot.appendChild(tail);
  // One pick per visit to the map: a second press (double-click, or Enter
  // during the fade) would enter the vignette twice and spend two slots.
  onTapOrClick(spot, () => {
    if (!pin.goto_vignette) {
      $('coming-soon').classList.remove('hidden');
      return;
    }
    if (pinPicked) return;
    pinPicked = true;
    onPin(pin);
  });
  return spot;
}

export async function showMap(map, onPin) {
  pinPicked = false;
  mapStatusBar();
  showScreen('map');

  const url = await resolveSingle(`assets/map/${map.image}.webp`);
  fillImageBox($('map-image'), url, `${map.image} — city map`, 'placeholder');

  const layer = $('map-hotspots');
  layer.innerHTML = '';
  for (const pin of map.pins || []) {
    if (pin.requires && !evalCond(pin.requires, S.state)) continue;
    layer.appendChild(pinEl(pin, onPin));
  }

  $('coming-soon').onclick = () => $('coming-soon').classList.add('hidden');
}
