// Ambient loops + UI sfx. Ambient beds run on the Web Audio API: decoded
// buffers looped by AudioBufferSourceNode, which is sample-accurate — no
// seek gap at the loop point like HTMLAudio's `loop`, and MP3 encoder
// padding is trimmed by the browser when the file carries gapless metadata.
// Fades are scheduled gain ramps. Sfx stay fire-and-forget HTMLAudio clones.
//
// Vignette ambience is data-driven: a vignette declares
//   ambient:
//     - distant_explosions
// and the engine calls syncAmbient() with that list. Names resolve to
// assets/audio/ambient/{name}.mp3, then .ogg, then .wav — looked up in the
// asset index (tools/build-art.py), so only the file that exists is fetched.

import { bust, indexedAsset } from './render.js'; // bust: dev cache-buster — see README, Dev mode

const AUDIO_EXTS = ['mp3', 'ogg', 'wav'];

const AMBIENT_DIR = 'assets/audio/ambient/';
const SFX_DIR = 'assets/audio/sound-effects/';
const AMBIENT_VOL = 0.45;
const SFX_VOL = 0.5;
const FADE_IN_MS = 1800;
const FADE_OUT_MS = 800;

let ctx = null;

// Master volume (the status bar's sound control). Ambient beds, sfx and the
// UI click all play through it. A player preference, kept in its own
// localStorage key: Options > Clear saved data leaves it alone.
const VOLUME_KEY = 'hon_volume';
let volume = 1; // 0..1, the slider's position
let muted = false;
let master = null; // GainNode, created with the context

try {
  const pref = JSON.parse(localStorage.getItem(VOLUME_KEY));
  if (pref && typeof pref.volume === 'number') volume = Math.min(1, Math.max(0, pref.volume));
  if (pref && typeof pref.muted === 'boolean') muted = pref.muted;
} catch { /* storage blocked or junk: defaults */ }

// Slider position -> gain, squared so the slider's travel sounds even.
function masterLevel() {
  return muted ? 0 : volume * volume;
}

function context() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = masterLevel();
    master.connect(ctx.destination);
  }
  return ctx;
}

function applyVolume() {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted }));
  } catch { /* storage unavailable: the setting lasts this page load */ }
  if (master) master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.02);
}

export function getVolume() {
  return { volume, muted };
}

// Moving the slider above zero also unmutes.
export function setVolume(v) {
  volume = Math.min(1, Math.max(0, v));
  if (volume > 0) muted = false;
  applyVolume();
}

export function setMuted(on) {
  muted = !!on;
  applyVolume();
}

// Autoplay unlock: contexts created outside a user gesture start suspended;
// the first gesture resumes them (and everything scheduled starts together).
document.addEventListener(
  'pointerdown',
  () => {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  },
  true
);

// extensionless path -> Promise<AudioBuffer|null>, decoded once per session
const buffers = new Map();

function bufferFor(base) {
  if (buffers.has(base)) return buffers.get(base);
  const p = (async () => {
    // With the index: fetch only the listed file (none listed: no sound).
    // Without it: try each extension in turn.
    const known = indexedAsset(base.slice('assets/'.length), AUDIO_EXTS);
    if (known === null) return null;
    const urls = known ? [`assets/${known}`] : AUDIO_EXTS.map((ext) => `${base}.${ext}`);
    for (const url of urls) {
      try {
        const res = await fetch(bust(url));
        if (!res.ok) continue;
        return await context().decodeAudioData(await res.arrayBuffer());
      } catch {
        // decode failure or missing file — try the next extension
      }
    }
    return null;
  })();
  buffers.set(base, p);
  return p;
}

const live = new Map(); // name -> track

function applyFade(t, target, ms) {
  const g = t.gain.gain;
  const now = context().currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  if (ms <= 0) {
    g.setValueAtTime(target, now);
  } else {
    g.linearRampToValueAtTime(target, now + ms / 1000);
  }
}

function fadeTo(t, target, ms) {
  t.target = target;
  t.fadeMs = ms;
  if (t.gain) applyFade(t, target, ms);
  clearTimeout(t.killTimer);
  if (target === 0) {
    t.killTimer = setTimeout(() => {
      if (t.target !== 0) return; // rescued mid-fade
      t.dead = true;
      try { if (t.source) t.source.stop(); } catch { /* already stopped */ }
      if (t.gain) t.gain.disconnect();
      live.delete(t.name);
    }, ms + 60);
  }
}

function startLoop(name, fadeMs) {
  let t = live.get(name);
  if (t) {
    fadeTo(t, AMBIENT_VOL, fadeMs); // rescued from a pending fade-out
    return;
  }
  t = { name, gain: null, source: null, target: AMBIENT_VOL, fadeMs, killTimer: null, dead: false };
  live.set(name, t);
  bufferFor(`${AMBIENT_DIR}${name}`).then((buf) => {
    if (!buf || t.dead) return;
    const c = context();
    t.gain = c.createGain();
    t.gain.gain.value = 0;
    t.gain.connect(master);
    t.source = c.createBufferSource();
    t.source.buffer = buf;
    t.source.loop = true; // gapless — the whole point of the buffer route
    t.source.connect(t.gain);
    t.source.start();
    applyFade(t, t.target, t.fadeMs);
  });
}

// Bring the ambient bed to exactly `names`: fade out what no longer belongs,
// fade in what's new, leave the rest alone. Idempotent — safe to call on
// every render.
export function syncAmbient(names, fadeInMs = FADE_IN_MS, fadeOutMs = FADE_OUT_MS) {
  const want = new Set(names || []);
  for (const [name, t] of live) {
    if (!want.has(name) && t.target !== 0) fadeTo(t, 0, fadeOutMs);
  }
  for (const name of want) {
    const t = live.get(name);
    if (!t || t.target === 0) startLoop(name, fadeInMs);
  }
}

// For tests: names currently playing or fading in.
export function activeAmbient() {
  return [...live.values()].filter((t) => t.target > 0).map((t) => t.name);
}

// One-shot sfx by name (assets/audio/sound-effects/{name}.mp3/.ogg/.wav),
// decoded once and played through the same context as the ambient bed. A
// block declares `sfx: gunshot` and the engine calls this on its reveal.
// Triggers always follow a user gesture, so autoplay policy is satisfied.
export function playSfx(name) {
  bufferFor(`${SFX_DIR}${name}`).then((buf) => {
    if (!buf) return;
    const c = context();
    const g = c.createGain();
    g.gain.value = SFX_VOL;
    g.connect(master);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    src.addEventListener('ended', () => g.disconnect());
    src.start();
  });
}

const clickBase = new Audio(`${SFX_DIR}click.mp3`);
clickBase.preload = 'auto';

export function sfxClick() {
  const level = masterLevel();
  if (!level) return;
  const a = clickBase.cloneNode();
  a.volume = SFX_VOL * level;
  a.play().catch(() => {});
}
