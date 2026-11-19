// Vignette runner: linear chains, location scenes, hotspots, choices, lens
// toggle, death/rewind. Every state mutation ends in S.save() (autosave).

import * as S from './state.js';
import * as UI from './ui.js';
import * as R from './render.js';
import { evalCond } from './conditions.js';
import { initGlossary } from './glossary.js';
import { syncAmbient, playSfx } from './audio.js';

const $ = (id) => document.getElementById(id);

let content = null;
let pendingAdvance = null; // timer for choice-less nodes with a node-level goto

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Beat-to-beat transition: fade the text panel out, swap content, fade back
// in. Full-screen changes (goto_vignette / goto_screen) use the big fade
// instead, never both.
// Beat transition. With the running transcript, the text already on screen
// stays put (it becomes history); only the pinned choice bar veils, and the
// incoming node fades in on its own (.reveal on #transcript-current).
// While the veil is down, the old hotspots are still on screen: a second
// click (or Enter) on one would act twice, e.g. advance the stakeout clock
// twice. `repainting` makes clickHotspot ignore them until the repaint lands.
let repainting = false;

async function fadeRepaint() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    renderCurrent();
    return;
  }
  const bar = $('choice-bar');
  bar.classList.add('veiled');
  repainting = true;
  try {
    await sleep(190);
    renderCurrent();
  } finally {
    repainting = false;
    bar.classList.remove('veiled');
  }
}

// ---------- Transcript (split layout) ----------
//
// The dialogue box keeps a running transcript of the whole vignette:
// #transcript-history holds everything already read (the scene intro, every
// node opened so far, in order); #transcript-current holds the node that is
// open now, re-rendered in place on stepped reveals and lens toggles.
// Choices render into the pinned #choice-bar, never into the transcript.
// Entering a vignette (or a death rewind) empties it.
//
// The history is saved with the game (state.transcript, as HTML) every time
// a node is committed to it, and put back on a reload or Continue — exactly
// as it was read, independent of what flags or lens state say now. The open
// node isn't part of it; it re-renders from its first line, as before.
let renderedNodeId = null; // node drawn in #transcript-current, or null

function clearTranscript() {
  $('transcript-history').innerHTML = '';
  $('transcript-current').innerHTML = '';
  $('choice-bar').innerHTML = '';
  renderedNodeId = null;
  if (S.state) S.state.transcript = '';
}

// Move whatever is in #transcript-current into the history, as one entry,
// and save the history.
function commitCurrent() {
  const cur = $('transcript-current');
  if (cur.childNodes.length) {
    const entry = document.createElement('div');
    entry.className = 'entry';
    while (cur.firstChild) entry.appendChild(cur.firstChild);
    // A restored transcript shouldn't replay the stepped-reveal fade.
    for (const el of entry.querySelectorAll('.reveal')) el.classList.remove('reveal');
    $('transcript-history').appendChild(entry);
    S.state.transcript = $('transcript-history').innerHTML;
    S.save();
  }
  cur.classList.remove('reveal');
  renderedNodeId = null;
}

// The player's own action — a hotspot clicked, a choice taken — joins the
// transcript as its own line (bold, behind a ">" — see p.player-action),
// after whatever was open. Saved with the rest of the history.
function echoAction(text) {
  if (!text) return;
  commitCurrent();
  const entry = document.createElement('div');
  entry.className = 'entry action';
  const p = document.createElement('p');
  p.className = 'player-action';
  p.textContent = text;
  entry.appendChild(p);
  $('transcript-history').appendChild(entry);
  S.state.transcript = $('transcript-history').innerHTML;
  S.save();
}

// Which choices get echoed: anything the player decides, but not the ">>>"
// continue clicks, and not choices that only close a node back to the scene
// ("Step back", "Look away") — the next hotspot click says what happened.
function echoesChoice(c) {
  if (c.label === '>>>') return false;
  if (c.goto_screen === 'end') return false; // closing the game, not a story action
  return !!(c.goto || c.goto_scene || c.goto_vignette || c.goto_map
    || c.goto_screen || c.death || c.end_vignette);
}

// On a fresh page (reload, Continue), put the saved history back.
function restoreTranscript() {
  const hist = $('transcript-history');
  if (renderedNodeId === null && !hist.childNodes.length && S.state.transcript) {
    hist.innerHTML = S.state.transcript;
    const panel = $('node-panel');
    panel.scrollTop = panel.scrollHeight; // land at the end, where play resumes
  }
}

// Restart the fade-in on the current section (a newly opened node).
function revealCurrent() {
  const cur = $('transcript-current');
  cur.classList.remove('reveal');
  void cur.offsetWidth; // reflow so the animation restarts
  cur.classList.add('reveal');
}

// 'start': bring the top of the newly opened node into view — from the
//          player's action line, if that's what opened it.
// 'end':   show the newest line (a stepped reveal).
function scrollTranscript(mode) {
  const panel = $('node-panel');
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const last = $('transcript-history').lastElementChild;
  const anchor = last && last.classList.contains('action') ? last : $('transcript-current');
  const top = mode === 'start'
    ? Math.max(0, anchor.offsetTop - 12)
    : panel.scrollHeight;
  panel.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}

// Scene-less nodes (text-only vignettes, hide_scene) widen the dialogue box.
// Scene art resolves asynchronously, so an older render could land after a
// newer one and put stale art up. Each render takes a token; only the latest
// one may touch the scene box. Hiding the scene counts as a newer render.
let artToken = 0;

function setSceneShown(shown) {
  if (!shown) artToken++;
  $('scene-box').classList.toggle('hidden', !shown);
  $('screen-vignette').classList.toggle('no-scene', !shown);
}

// Fragments (kind: fragment) are node libraries, not places: their nodes are
// pooled here and resolvable from ANY vignette — the Rose thread's chained
// conversations live in one file but fire inside whichever apartment bookend
// the player opens them from. A fragment is never entered as a vignette.
let fragmentNodes = new Map(); // node id -> node

export function init(c) {
  content = c;
  fragmentNodes = new Map();
  for (const v of Object.values(c.vignettes)) {
    if (v.kind !== 'fragment') continue;
    for (const n of v.nodes || []) fragmentNodes.set(n.id, n);
  }
  R.initRender(c.characters);
  R.initArt(c.artIndex);
  initGlossary(c.glossary);
  $('lens-toggle').addEventListener('click', toggleLenses);
  document.addEventListener('keydown', onAdvanceKey);
}

export function firstVignette() {
  return content.manifest.vignettes[0];
}

function vignetteData() {
  return content.vignettes[S.state.vignette];
}

function nodeById(v, id) {
  const node = (v.nodes || []).find((n) => n.id === id) || fragmentNodes.get(id);
  if (!node) throw new Error(`Unknown node: ${id}`);
  return node;
}

function findHotspot(v, id) {
  const scene = v.scenes && v.scenes[S.state.scene];
  if (!scene) return null;
  return (scene.hotspots || []).find((h) => h.id === id) || null;
}

function isDual(h) {
  return !!(h && h.node_off && h.node_on);
}

// ---------- Flow ----------

export function startNewGame() {
  S.reset();
  return enterVignette(firstVignette());
}

// Continue / reload-resume: load the scene's art first, like a vignette entry.
export async function resume() {
  const st = S.state;
  if (st.screen === 'vignette') {
    const v = vignetteData();
    if (v) await preloadSceneArt(v, st.scene || v.entry_scene);
  }
  renderCurrent();
}

// Exported for js/debug.js (the dev day/ending skips).
export async function enterVignette(file) {
  const v = content.vignettes[file];
  if (!v) throw new Error(`Unknown vignette: ${file}`);
  if (v.kind === 'fragment') throw new Error(`Fragment is not enterable: ${file}`);
  const st = S.state;
  st.screen = 'vignette';
  st.vignette = file;
  // Day system: a vignette can advance the day (`day: N` — dawn bookends),
  // set the day's slot budget (`slot_budget: N`), and/or cost a slot
  // (`slot: true` — the selectable case vignettes). All happen before the
  // entry snapshot so a death-rewind neither refunds nor double-charges.
  if (typeof v.day === 'number' && v.day !== st.day) {
    st.day = v.day;
    st.slots_used = 0;
  }
  if (typeof v.slot_budget === 'number') st.slot_budget = v.slot_budget;
  if (Array.isArray(v.slot_times)) st.slot_times = v.slot_times;
  if (v.slot) {
    st.slots_used = (st.slots_used || 0) + 1;
    // Slot vignettes play at fixed hours regardless of what fills them:
    // the day's Nth slot gets the Nth entry of the dawn bookend's slot_times.
    const t = (st.slot_times || [])[st.slots_used - 1];
    if (t) st.time_display = t;
  }
  if (v.date) st.date_display = v.date;
  if (v.time) st.time_display = v.time;
  st.scene = null;
  st.node = v.opening_node || (v.nodes && v.nodes[0] && v.nodes[0].id) || null;
  st.open_hotspot = null;
  st.clock_min = 0;
  st.clock_fired = 0;
  // Entering a vignette restarts it clean: underscore-prefixed flags are
  // vignette-local and reset here (unprefixed flags persist for the whole
  // game — has_lenses etc.), and this vignette's visited markers and scene
  // intros are forgotten so a replay isn't half-spent.
  for (const k of Object.keys(st.flags)) {
    if (k.startsWith('_')) delete st.flags[k];
  }
  for (const store of [st.visited, st.intro_seen]) {
    for (const k of Object.keys(store)) {
      if (k.startsWith(`${file}|`)) delete store[k];
    }
  }
  // Authored arrival lens state (entry_lenses: "on"/"off") — otherwise the
  // state persists from wherever the player just was. Bare on/off in YAML
  // may parse as booleans, so both spellings are accepted.
  if (v.entry_lenses !== undefined) {
    st.lenses_worn = v.entry_lenses === 'on' || v.entry_lenses === true;
  }
  stepProgress.clear(); // stepped progress does not survive vignette re-entry
  clearTranscript();    // each vignette starts with an empty dialogue box
  S.takeSnapshot(); // deep copy of the entire game state at entry
  S.save();
  // The previous vignette's art must not linger (it would cross-fade into
  // this one's), and this one's should be fully loaded before the screen
  // fades in — even its arrival text shows over it.
  $('scene-image').innerHTML = '';
  await preloadSceneArt(v, v.entry_scene);
  renderCurrent();
}

// Load and decode a scene's art (for the current lens state) so it's ready
// before anything is shown. Gives up after a few seconds rather than hang.
async function preloadSceneArt(v, sceneId) {
  if (!v || v.kind !== 'location' || !sceneId || !v.scenes || !v.scenes[sceneId]) return;
  const base = sceneImageBase(v.scenes[sceneId]);
  if (!base) return;
  const ready = (async () => {
    const pair = await R.resolveScenePair(base);
    const url = S.state.lenses_worn ? pair.on : pair.off;
    if (!url) return;
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { /* broken art falls back to the placeholder */ }
  })();
  await Promise.race([ready, sleep(3000)]);
}

function defaultMapId() {
  return Object.keys(content.maps || {})[0];
}

function enterMap(id) {
  const st = S.state;
  const map = content.maps[id] || content.maps[defaultMapId()];
  // A map can declare `redirect:` — ordered { requires, goto_vignette }
  // entries checked on entry; the first that holds routes there instead of
  // showing the map. This is how Day 5 hands off to the endgame: once the
  // last slot is spent, the map is never seen again.
  for (const r of map.redirect || []) {
    if (!r.requires || evalCond(r.requires, st)) {
      return enterVignette(r.goto_vignette);
    }
  }
  // The map's bar shows the moment the player left behind — capture it
  // before the vignette reference is cleared. Slot vignettes carry no date
  // of their own (they play on whatever day they're picked) — fall back to
  // the last authored date seen.
  const v = st.vignette ? content.vignettes[st.vignette] : null;
  if (v) {
    st.map_datetime = {
      date: v.date || st.date_display,
      time: UI.clockTime(v) || st.time_display,
    };
  }
  st.screen = 'map';
  st.map = content.maps[id] ? id : defaultMapId();
  st.vignette = null;
  st.scene = null;
  st.node = null;
  st.open_hotspot = null;
  S.save();
  renderCurrent();
}

export function renderCurrent() {
  if (pendingAdvance) {
    clearTimeout(pendingAdvance);
    pendingAdvance = null;
  }
  UI.applyLensClass();
  const st = S.state;
  if (st.screen === 'map') {
    syncAmbient([]); // the map is silent
    const map = content.maps[st.map] || content.maps[defaultMapId()];
    UI.showMap(map, (pin) => UI.fade(() => enterVignette(pin.goto_vignette)));
    return;
  }
  if (st.screen !== 'vignette') {
    return; // title is handled by main.js
  }
  const v = vignetteData();
  let node = st.node ? nodeById(v, st.node) : null;
  // Branch nodes (`branch:` — ordered { requires, goto } entries) are
  // routers, not content: resolve to the first entry whose condition holds
  // and land on its node. Stateless and re-entrant — a reload mid-branch
  // just re-routes. No entry matching closes back to the scene.
  let hops = 0;
  while (node && node.branch) {
    if (++hops > 10) throw new Error(`Branch loop at node: ${node.id}`);
    const entry = node.branch.find((e) => !e.requires || evalCond(e.requires, st));
    if (!entry) {
      closeNodeToScene(null);
      return;
    }
    if (!entry.goto) throw new Error(`Branch entry without goto in: ${node.id}`);
    st.node = entry.goto;
    node = nodeById(v, entry.goto);
    S.save();
  }
  // A node can pin the stakeout clock forward (clock_min: 59) when its prose
  // names a time later than the clicks account for. Monotonic — never rewinds.
  if (node && typeof node.clock_min === 'number' && (st.clock_min || 0) < node.clock_min) {
    st.clock_min = node.clock_min;
    S.save();
  }
  syncAmbient(ambientFor(v, node));
  UI.applyLensClass(!!(node && node.bare_eyed));
  // Blackout nodes (blackout: true) take the screen to black; see renderNode.
  $('screen-vignette').classList.toggle('blackout', !!(node && node.blackout));
  UI.updateStatusBar(v, node);
  UI.showScreen('vignette');
  restoreTranscript();
  if (node) {
    renderNode(v, node);
  } else {
    renderScene(v);
  }
}

// ---------- Choices ----------

function visibleChoices(node) {
  return (node.choices || []).filter((c) => !c.requires || evalCond(c.requires, S.state));
}

async function takeChoice(choice) {
  // A choice can fire a one-shot on its click — e.g. the death ">>>" that
  // lands the heavy's shot, where the sound belongs on the click, not on a
  // block reveal.
  if (choice.sfx) playSfx(choice.sfx);
  if (echoesChoice(choice)) echoAction(choice.label);
  if (choice.set) {
    for (const [k, val] of Object.entries(choice.set)) {
      S.state.flags[k] = val;
      // Record the day a persistent flag was first set — day_after gates
      // (institutional waits: subpoenas, reports, appointments) read this.
      if (val && !k.startsWith('_') && S.state.flag_days[k] === undefined) {
        S.state.flag_days[k] = S.state.day || 0;
      }
    }
  }
  if (choice.death) {
    S.save();
    return doDeath(choice);
  }
  return advance(choice);
}

// The last image of an ending lingers: the text and choices fade away, the
// art holds alone for a moment, then it fades to black before the end card.
async function lingerOut() {
  const screen = $('screen-vignette');
  for (const b of document.querySelectorAll('#choice-bar button')) b.disabled = true;
  screen.classList.add('closing-text');
  await sleep(2400);   // 1.4s text fade, then the image alone
  screen.classList.add('closing-image');
  await sleep(2600);   // 2s image fade, then a beat of black
}

// `d` is a choice or a node carrying node-level goto fields.
async function advance(d) {
  const st = S.state;
  if (d.goto_vignette) {
    S.save();
    await UI.fade(() => enterVignette(d.goto_vignette));
    return;
  }
  if (d.goto_screen === 'end') {
    // End card. The save is kept until the player clicks through —
    // main.js wipes it there and hands back to the title. The ending itself
    // is recorded now, in its own key, for the title screen's row.
    if (d.ending) S.recordEnding(d.ending);
    S.save();
    await lingerOut();
    await UI.fade(() => {
      $('screen-vignette').classList.remove('closing-text', 'closing-image');
      UI.showEnd();
    });
    return;
  }
  if (d.goto_map || d.goto_screen === 'map') {
    // goto_map names a content/maps.yaml entry; the legacy goto_screen: map
    // form lands on the first map defined there.
    S.save();
    await UI.fade(() => enterMap(d.goto_map || defaultMapId()));
    return;
  }
  if (d.goto_scene) {
    closeNodeToScene(d.goto_scene);
    return;
  }
  if (d.goto) {
    st.node = d.goto;
    S.save();
    await fadeRepaint();
    return;
  }
  if (d.end_vignette) {
    S.save();
    return; // terminal
  }
  // No target: in a location vignette, the choice closes the node back to
  // the scene (e.g. [Close handheld]).
  closeNodeToScene(null);
}

function visitedKey(h) {
  const st = S.state;
  const base = `${st.vignette}|${st.scene}|${h.id}`;
  // per-state visited tracking for dual hotspots, single otherwise.
  return isDual(h) ? `${base}|${st.lenses_worn ? 'on' : 'off'}` : base;
}

function closeNodeToScene(targetScene) {
  const st = S.state;
  const v = vignetteData();
  if (st.open_hotspot) {
    const h = findHotspot(v, st.open_hotspot);
    if (h) st.visited[visitedKey(h)] = true;
    st.open_hotspot = null;
  }
  st.node = null;
  if (targetScene) {
    st.scene = targetScene;
  } else if (!st.scene) {
    st.scene = v.entry_scene;
  }
  S.save();
  fadeRepaint();
}

// ---------- Death and rewind ----------

async function doDeath(choice) {
  const st = S.state;
  const v = vignetteData();
  if (choice.goto) {
    st.node = choice.goto;
    S.save();
    const node = nodeById(v, choice.goto);
    renderBlocksOnly(v, node); // 1. render the death node's prose
  }
  await new Promise((r) => setTimeout(r, 1500));
  await UI.fade(() => {
    S.restoreSnapshot(); // 3. restore the vignette-entry snapshot wholesale
    stepProgress.clear(); //   ...and the stepped-reveal progress, which lives
                          //   outside the save — or every node replays read-through
    clearTranscript();    //   ...and the transcript: the vignette starts over
    renderCurrent();     // 4. fade in at the vignette's first node
  });
}

// ---------- Node rendering ----------

// A block may carry `requires:` (same condition language as choices and
// hotspots); blocks whose condition fails are skipped as if absent. Flags only
// change on choices, so a node's visible blocks are stable while it is open —
// except for a `lenses_on` condition, which a lens toggle can flip mid-node.
function visibleBlocks(node) {
  return (node.blocks || []).filter((b) => !b.requires || evalCond(b.requires, S.state));
}

// The death node: its prose joins the transcript (no choices) before the rewind.
function renderBlocksOnly(v, node) {
  commitCurrent();
  const cur = $('transcript-current');
  for (const block of visibleBlocks(node)) {
    cur.appendChild(R.blockEl(block, S.state.lenses_worn));
  }
  $('choice-bar').innerHTML = '';
  renderedNodeId = node.id;
  revealCurrent();
  requestAnimationFrame(() => scrollTranscript('start'));
}

// Stepped nodes (stepped: true) reveal their blocks one per click, stacking
// up, with a ">>>" choice between reveals. Progress is tracked per node id
// and kept for the life of the vignette, so a node once read through shows
// fully on revisits. It is not saved — a reload restarts open nodes.
const stepProgress = new Map(); // node id -> highest revealed block index
const CHOICE_FREEZE_MS = 500;    // see the choice bar in renderNode
let revealStep = false; // true only on the render right after a ">>>" click

function renderNode(v, node) {
  const st = S.state;

  // In a location vignette with a scene open, the scene stays visible behind
  // the node ("still at the mirror, still in the bathroom"); hotspots
  // go inert until the node closes. A node can opt out (hide_scene: true) —
  // e.g. V03 once Brand leaves the perch, the rooftop view no longer applies.
  // Before the player reaches the scene (arrival text), its art is already
  // up — inert, with no hotspots — so the layout never jumps mid-vignette.
  // A node can also name its own art (image: <base>, in any vignette kind):
  // shown alone, with no hotspots, while the node is open — e.g. the endings'
  // codas, which leave the scene they started in.
  // `bare_eyed: true` draws the node as if the lenses were off, whatever the
  // player is wearing, and the toggle goes inert (V90: the room after the
  // generator dies has no color left in it).
  const worn = st.lenses_worn && !node.bare_eyed;
  if (node.blackout) {
    // leave the art as it is; CSS fades it (and the transcript) to black
  } else if (node.image) {
    renderNodeImage(node.image, worn);
  } else if (v.kind === 'location' && !node.hide_scene && (st.scene || v.entry_scene)) {
    renderSceneBox(v, true, st.scene || v.entry_scene, !st.scene);
  } else {
    setSceneShown(false);
  }

  // A different node than the one on screen: the old one becomes history,
  // and this one fades in below it. The same node again (a stepped reveal, a
  // lens toggle, a reload) re-renders in place.
  const isNew = renderedNodeId !== node.id;
  if (isNew) commitCurrent();
  // A blackout is a cut: once the screen is dark, what was read before it
  // is gone, and the next node starts a fresh transcript.
  if (node.blackout) {
    setTimeout(() => {
      if (renderedNodeId !== node.id) return;
      $('transcript-history').innerHTML = '';
      S.state.transcript = '';
      S.save();
    }, 250);
  }
  renderedNodeId = node.id;

  const cur = $('transcript-current');
  const bar = $('choice-bar');
  const blocks = visibleBlocks(node);
  const stepped = !!node.stepped && blocks.length > 1;
  const stepIndex = stepped
    ? Math.min(stepProgress.get(node.id) || 0, blocks.length - 1)
    : 0;
  const animateLast = revealStep;
  revealStep = false;

  cur.innerHTML = '';
  const shown = stepped ? blocks.slice(0, stepIndex + 1) : blocks;
  shown.forEach((block, i) => {
    const el = R.blockEl(block, worn);
    if (stepped && i === stepIndex && animateLast) {
      el.classList.add('reveal');
      // A block's sfx fires once, at the ">>>" reveal that lands it — not on
      // revisits or full re-renders (lens toggle, reload), which show the
      // node already read through.
      if (block.sfx) playSfx(block.sfx);
    }
    cur.appendChild(el);
  });
  if (isNew) revealCurrent();
  // Screen readers hear what just appeared: the whole node when it's new, the
  // newest line on a ">>>" reveal, nothing on an in-place re-render.
  if (isNew) announce([...cur.children]);
  else if (stepped && animateLast) announce([cur.lastElementChild]);
  // Scroll only after the choice bar below is filled in and laid out: the bar
  // changes height (empty -> ">>>" -> a list of choices), and measuring the
  // transcript before that leaves the last lines hidden under it.
  const scrollMode = isNew ? 'start' : (animateLast ? 'end' : null);
  const scrollAfterLayout = () => {
    if (scrollMode) requestAnimationFrame(() => scrollTranscript(scrollMode));
  };

  // Was the bar showing ">>>" until now? Then a fast clicker's next click is
  // already on its way to the spot where the first real choice will appear.
  const replacingAdvance = !!bar.querySelector('[data-advance]');
  bar.innerHTML = '';
  if (stepped && stepIndex < blocks.length - 1) {
    const box = document.createElement('div');
    box.className = 'choices';
    box.appendChild(R.choiceButton('>>>', () => {
      stepProgress.set(node.id, stepIndex + 1);
      revealStep = true;
      renderNode(v, node);
    }));
    bar.appendChild(box);
    focusAdvance(bar);
    scrollAfterLayout();
    return;
  }

  const choices = visibleChoices(node);
  if (choices.length > 0) {
    const box = document.createElement('div');
    box.className = 'choices';
    // Real choices replacing a ">>>" ignore clicks for half a second, so
    // clicking through the text stops at the choice instead of taking
    // whichever option landed under the cursor (e.g. V03's "Go after him").
    const lone = choices.length === 1 && choices[0].label === '>>>';
    const frozenUntil = replacingAdvance && !lone ? performance.now() + CHOICE_FREEZE_MS : 0;
    if (frozenUntil) box.classList.add('arriving');
    // One pick per render: the pointer veil (fadeRepaint) doesn't stop a
    // second Enter on a focused button, which would take the choice twice.
    let taken = false;
    for (const c of choices) {
      box.appendChild(R.choiceButton(c.label, () => {
        if (taken || performance.now() < frozenUntil) return;
        taken = true;
        takeChoice(c);
      }));
    }
    bar.appendChild(box);
    focusAdvance(bar);
  } else if (node.goto || node.goto_vignette || node.goto_screen) {
    // Node-level goto: auto-advance after a beat.
    pendingAdvance = setTimeout(() => advance(node), 1500);
  }
  scrollAfterLayout();
}

function announce(els) {
  const live = $('sr-live');
  const text = els.filter(Boolean).map((el) => el.innerText.trim()).join('\n');
  if (!live || !text) return;
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = text; });
}

// Keyboard advance. When the only thing on the bar is ">>>", focus it so
// Space/Enter press it. Real choices are never focused automatically, so a
// player tapping Space through the text can't pick one by accident.
function focusAdvance(bar) {
  const buttons = bar.querySelectorAll('button');
  if (buttons.length === 1 && buttons[0].hasAttribute('data-advance')) {
    buttons[0].focus({ preventScroll: true });
  }
}

// Fallback for when nothing has focus (e.g. after a click on the art):
// Space/Enter still press a lone ">>>".
function onAdvanceKey(e) {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
  const active = document.activeElement;
  if (active && active !== document.body) return;
  const bar = $('choice-bar');
  if (!bar.offsetParent) return; // vignette screen not showing
  const buttons = bar.querySelectorAll('button');
  if (buttons.length !== 1 || !buttons[0].hasAttribute('data-advance')) return;
  e.preventDefault();
  buttons[0].click();
}

// ---------- Scene rendering ----------

// A scene's `image` is either a single base name or a list of
// { image, requires } stage variants — the first entry whose condition
// holds wins, so order most-specific first. The -off/-on suffix resolution
// then applies to whichever base is chosen.
function sceneImageBase(scene) {
  if (!Array.isArray(scene.image)) return scene.image;
  for (const e of scene.image) {
    if (!e.requires || evalCond(e.requires, S.state)) return e.image;
  }
  return null;
}

// The ambient bed: a node's own `ambient:` list wins; otherwise the open
// scene's; otherwise the vignette's. An empty list is silence. Lets one
// vignette change its sound mid-way (V90: the server room's cooler runs from
// the door until the generator is shot).
function ambientFor(v, node) {
  if (node && Array.isArray(node.ambient)) return node.ambient;
  const scene = S.state.scene && v.scenes && v.scenes[S.state.scene];
  if (scene && Array.isArray(scene.ambient)) return scene.ambient;
  return v.ambient || [];
}

// A node's own art (node-level `image:`): the -off/-on pair for that base,
// no hotspots.
async function renderNodeImage(base, worn = S.state.lenses_worn) {
  const token = ++artToken;
  setSceneShown(true);
  const pair = await R.resolveScenePair(base);
  if (token !== artToken) return; // a newer render took over
  const url = worn ? pair.on : pair.off;
  $('scene-image').classList.toggle('shared-art', !!url && pair.off === pair.on);
  R.fillImageBox($('scene-image'), url, `${base} — lenses ${worn ? 'on' : 'off'}`,
    'placeholder — real art lands at the same fractional coords');
  $('hotspot-layer').innerHTML = '';
}

// `sceneId` defaults to the open scene; `preview` shows the art alone (the
// arrival text before the player has entered the scene — no hotspots yet).
async function renderSceneBox(v, inert, sceneId = S.state.scene, preview = false) {
  const st = S.state;
  const scene = v.scenes[sceneId];
  const token = ++artToken;
  setSceneShown(true);

  const base = sceneImageBase(scene);
  const pair = base ? await R.resolveScenePair(base) : { off: null, on: null };
  if (token !== artToken) return; // a newer render took over
  const url = st.lenses_worn ? pair.on : pair.off;
  // One art file serving both lens states can't carry its own bare-eyed
  // grading — flag it so CSS applies a stronger wash (see main.css).
  $('scene-image').classList.toggle('shared-art', !!url && pair.off === pair.on);
  R.fillImageBox(
    $('scene-image'),
    url,
    `${base} — lenses ${st.lenses_worn ? 'on' : 'off'}`,
    'placeholder — real art lands at the same fractional coords'
  );

  const layer = $('hotspot-layer');
  layer.classList.toggle('inert', !!inert);
  layer.innerHTML = '';
  if (preview) return;
  for (const h of scene.hotspots || []) {
    if (!hotspotVisible(h)) continue;
    layer.appendChild(hotspotEl(h));
  }
}

function hotspotVisible(h) {
  const st = S.state;
  if (h.requires && !evalCond(h.requires, st)) return false;
  const vis = h.visible || 'always';
  if (vis === 'lenses_on') return st.lenses_worn;
  if (vis === 'lenses_off') return !st.lenses_worn;
  return true;
}

function hotspotEl(h) {
  const st = S.state;
  const btn = document.createElement('button');
  btn.type = 'button';
  // `keep_lit: true` hotspots never dim: they lead somewhere new each time
  // (the Rose hotspots open the rose_next router, so after Beat 2a the same
  // spot opens 2b), and a dimmed marker would tell the player it's spent.
  const visited = !h.keep_lit && !!st.visited[visitedKey(h)];
  btn.className = `hotspot ${visited ? 'visited' : 'unvisited'}`;
  btn.style.left = `${h.coords.x * 100}%`;
  btn.style.top = `${h.coords.y * 100}%`;
  btn.style.width = `${h.coords.w * 100}%`;
  btn.style.height = `${h.coords.h * 100}%`;
  if (h.tooltip) {
    btn.dataset.tip = h.tooltip; // custom tooltip chrome — see main.css
    btn.setAttribute('aria-label', h.tooltip);
  }
  const marker = document.createElement('img');
  marker.className = 'marker';
  marker.src = 'assets/icons/hotspot.png';
  marker.alt = ''; // decorative; the button's aria-label names it
  btn.appendChild(marker);
  R.onTapOrClick(btn, () => clickHotspot(h));
  return btn;
}

// Stakeout clock (vignette-level `clock:`): every hotspot click costs `step`
// minutes. When the next event's time is reached, the event interrupts the
// click — its node opens instead of the hotspot's. The clock stops once
// every event has fired.
function advanceClock(v) {
  const st = S.state;
  const c = v.clock;
  const fired = st.clock_fired || 0;
  if (!c || !Array.isArray(c.events) || fired >= c.events.length) return false;
  st.clock_min = (st.clock_min || 0) + (c.step || 5);
  const ev = c.events[fired];
  if (st.clock_min >= ev.at && (!ev.requires || evalCond(ev.requires, st))) {
    st.clock_fired = fired + 1;
    st.open_hotspot = null;
    st.node = ev.node;
    S.save();
    fadeRepaint();
    return true;
  }
  S.save();
  return false;
}

function clickHotspot(h) {
  if (repainting) return; // a stale hotspot from the scene being replaced
  const st = S.state;
  echoAction(h.tooltip); // "> Talk to Droz" — before a timed event can interrupt
  if (advanceClock(vignetteData())) return; // a timed event interrupted the click
  if (h.goto_scene) {
    st.visited[visitedKey(h)] = true;
    st.scene = h.goto_scene;
    st.node = null;
    S.save();
    fadeRepaint();
    return;
  }
  const nodeId = isDual(h) ? (st.lenses_worn ? h.node_on : h.node_off) : h.node;
  if (!nodeId) return;
  st.open_hotspot = h.id;
  st.node = nodeId;
  S.save();
  fadeRepaint();
}

function renderScene(v) {
  const st = S.state;
  if (!st.scene) st.scene = v.entry_scene;
  renderSceneBox(v, false);

  // Back at the scene: the node that was open joins the history, and the
  // choice bar empties (the hotspots are the interface now). Scene-entry
  // prose renders once on first entry and then stays in the transcript.
  commitCurrent();
  $('choice-bar').innerHTML = '';
  const scene = v.scenes[st.scene];
  const introKey = `${st.vignette}|${st.scene}`;
  if (scene.intro && !st.intro_seen[introKey]) {
    $('transcript-current').appendChild(R.blockEl({ prose: scene.intro }, st.lenses_worn));
    announce([...$('transcript-current').children]);
    st.intro_seen[introKey] = true;
    S.save();
    revealCurrent();
    requestAnimationFrame(() => scrollTranscript('start'));
  }
}

// ---------- Lens toggle ----------

export function toggleLenses() {
  const st = S.state;
  const v = vignetteData();
  if (!v || v.kind !== 'location') return;
  if (v.lens_toggle === 'locked') return;
  if (!st.flags.has_lenses) return;
  const open = st.node ? nodeById(v, st.node) : null;
  if (open && open.bare_eyed) return;

  st.lenses_worn = !st.lenses_worn;
  st.lens_hint_done = true; // the first-use cue has done its job

  // re-render the current node from its first block. A dual hotspot
  // node swaps to its counterpart for the new state (mirror-off → mirror-on).
  if (st.node && st.open_hotspot) {
    const h = findHotspot(v, st.open_hotspot);
    if (isDual(h)) {
      st.node = st.lenses_worn ? h.node_on : h.node_off;
    } else if (h && !hotspotVisible(h)) {
      // The hotspot that opened this node doesn't exist in the new lens
      // state (e.g. the entoptic readout, bare-eyed) — the node terminates
      // rather than lingering to resume on the next toggle.
      closeNodeToScene(null);
      return;
    }
  }
  S.save();
  fadeRepaint();
}
