// DOM builders for blocks, choices, and scene images. Leaf module — holds the
// character map, no game-state knowledge beyond what's passed in (glossary.js
// handles its own first-occurrence bookkeeping).

import { fillTermText } from './glossary.js';
import { DEV_ART_BUST } from './config.js';

const bootStamp = Date.now();

export function bust(url) {
  return DEV_ART_BUST && url ? `${url}?v=${bootStamp}` : url;
}

let characters = {};

export function initRender(ch) {
  characters = ch || {};
}

// speaker resolution. Lens-dependent pair, single portrait, or nothing.
export function portraitFor(speaker, lensesWorn) {
  const c = characters[speaker];
  if (!c) return null;
  if (c.portrait_off || c.portrait_on) {
    const file = lensesWorn
      ? (c.portrait_on || c.portrait_off)
      : (c.portrait_off || c.portrait_on);
    return file ? bust(`assets/portraits/${file}`) : null;
  }
  if (c.portrait) return bust(`assets/portraits/${c.portrait}`);
  return null;
}

export function blockEl(block, lensesWorn) {
  if (block.prose !== undefined) {
    const p = document.createElement('p');
    p.className = 'prose';
    fillTermText(p, String(block.prose).trim());
    return p;
  }
  if (block.dialogue) {
    const d = block.dialogue;
    const wrap = document.createElement('div');
    wrap.className = 'dialogue';
    // A dialogue block can opt out of its speaker's portrait (portrait: false)
    // — e.g. V00's young Brand, who doesn't yet look like his portrait.
    const src = d.portrait === false ? null : portraitFor(d.speaker, lensesWorn);
    if (src) {
      const img = document.createElement('img');
      img.className = 'portrait';
      img.src = src;
      img.alt = ''; // the nameplate already says who's speaking
      wrap.appendChild(img);
    }
    const body = document.createElement('div');
    const plate = document.createElement('div');
    plate.className = 'nameplate';
    plate.textContent = d.speaker;
    const text = document.createElement('div');
    text.className = 'dialogue-text';
    fillTermText(text, String(d.text).trim());
    body.appendChild(plate);
    body.appendChild(text);
    wrap.appendChild(body);
    return wrap;
  }
  return document.createElement('div');
}

export function choiceButton(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'choice';
  btn.textContent = `[${label}]`;
  if (label === '>>>') {
    // The advance button. engine.js focuses it so Space/Enter press it; a
    // held Enter (which repeats keydown clicks) can't race through the text,
    // and a second press during the transition can't fire it twice.
    btn.dataset.advance = '';
    btn.addEventListener('keydown', (e) => {
      if (e.repeat) e.preventDefault();
    });
    btn.addEventListener('click', (e) => {
      if (btn.disabled) return;
      btn.disabled = true;
      onClick(e);
    });
    return btn;
  }
  btn.addEventListener('click', onClick);
  return btn;
}

// ---------- Scene image resolution ----------

// The art and audio that exist, from assets/asset-index.json (written by
// tools/build-art.py): paths under assets/, e.g. "scenes/03-lot-on.webp".
// With it, resolving a file costs no requests and no 404s. Without it (the
// index missing), fall back to probing each candidate file.
let artFiles = null;

export function initArt(list) {
  artFiles = Array.isArray(list) ? new Set(list) : null;
}

// For audio.js: the first `${base}.${ext}` the index lists (base is under
// assets/, no extension), or null if none is listed. Undefined when there's
// no index, meaning the caller should probe.
export function indexedAsset(base, exts) {
  if (!artFiles) return undefined;
  const hit = exts.map((e) => `${base}.${e}`).find((p) => artFiles.has(p));
  return hit === undefined ? null : hit;
}

function artExists(path) {
  return artFiles ? Promise.resolve(artFiles.has(path)) : tryLoad(bust(`assets/${path}`));
}

function tryLoad(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

const pairCache = new Map();

// Given `image: 01-apartment`, try -off and -on. If -on is missing, -off
// serves both. If both suffixed forms are missing, the bare name serves both.
// If nothing exists, null → labeled placeholder rect (hotspots stay clickable).
export async function resolveScenePair(base) {
  if (pairCache.has(base)) return pairCache.get(base);
  const dir = 'assets/scenes/';
  const [offOk, onOk, bareOk] = await Promise.all([
    artExists(`scenes/${base}-off.webp`),
    artExists(`scenes/${base}-on.webp`),
    artExists(`scenes/${base}.webp`),
  ]);
  const off = offOk ? bust(`${dir}${base}-off.webp`) : (bareOk ? bust(`${dir}${base}.webp`) : null);
  const on = onOk ? bust(`${dir}${base}-on.webp`) : off;
  const pair = { off, on };
  pairCache.set(base, pair);
  return pair;
}

export async function resolveSingle(url) {
  const ok = url.startsWith('assets/') ? await artExists(url.slice(7)) : await tryLoad(bust(url));
  return ok ? bust(url) : null;
}

// Touch screens have no hover, so a hotspot's or pin's tooltip would never
// show and the first tap would act blind (on the map, spending a slot). There
// the first tap shows the tooltip and the second acts; a tap elsewhere hides
// it. Mouse and keyboard act on the first click, as before.
const noHover = window.matchMedia('(hover: none)');

document.addEventListener('click', (e) => {
  for (const el of document.querySelectorAll('.tip-shown')) {
    if (!el.contains(e.target)) el.classList.remove('tip-shown');
  }
}, true);

export function onTapOrClick(btn, act) {
  btn.addEventListener('click', (e) => {
    if (noHover.matches && btn.dataset.tip && e.detail > 0 && !btn.classList.contains('tip-shown')) {
      btn.classList.add('tip-shown');
      return;
    }
    btn.classList.remove('tip-shown');
    act(e);
  });
}

export function placeholderEl(label, sub) {
  const div = document.createElement('div');
  div.className = 'placeholder';
  const name = document.createElement('div');
  name.textContent = label;
  div.appendChild(name);
  if (sub) {
    const small = document.createElement('small');
    small.textContent = sub;
    div.appendChild(small);
  }
  return div;
}

export function fillImageBox(box, url, label, sub) {
  if (!url) {
    box.innerHTML = '';
    box.appendChild(placeholderEl(label, sub));
    return;
  }
  const imgs = box.querySelectorAll('img');
  const current = imgs.length ? imgs[imgs.length - 1] : null;
  if (current && current.getAttribute('src') === url) {
    current.alt = label; // same art (node re-renders over an open scene) — keep it
    return;
  }
  const img = document.createElement('img');
  img.src = url;
  img.alt = label;
  if (!current) {
    box.innerHTML = '';
    box.appendChild(img);
    return;
  }
  // Cross-fade: the new art fades in over the old, which lingers underneath
  // until the fade completes, then is dropped.
  img.classList.add('incoming');
  box.appendChild(img);
  void img.offsetWidth; // commit the transparent state before revealing
  img.classList.remove('incoming');
  setTimeout(() => {
    if (!box.contains(img)) return;
    while (box.firstChild !== img) box.firstChild.remove();
  }, 300);
}
