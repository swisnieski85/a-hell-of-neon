// First-occurrence term annotation. Terms come from content/glossary.yaml;
// the first time one appears in play it gets a quiet underline and a
// definition tooltip, then never again. First-sightings persist in the save
// (seen_terms), keyed to where they happened so re-renders of the same node
// (lens toggles, stepped reveals, reloads) keep the highlight until the
// player moves on.
//
// The tooltip is a single floating element (#term-tip) on <body>, positioned
// in script — not a CSS pseudo-element on the term — so nothing that scrolls
// or clips (the dialogue box's transcript, the window edges) can cut it off.
// It sits above the word when there's room and flips below when there isn't,
// and is clamped inside the window horizontally.

import * as S from './state.js';

let terms = [];

// A term may list `aliases:` (other word forms: Cascadian for Cascadia).
// Any of them counts as the term's first occurrence; seen_terms is keyed by
// the main term, so the tooltip shows once for the whole family. Longest
// form first, so "crashout" isn't read as "crash" plus "out".
export function initGlossary(g) {
  terms = ((g && g.terms) || []).map((t) => {
    const forms = [t.term, ...(t.aliases || [])].sort((a, b) => b.length - a.length);
    return { ...t, re: new RegExp(`\\b(?:${forms.map(escapeRe).join('|')})\\b`) };
  });
  initTooltip();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Where the current text lives — the open node, or the scene intro.
function contextKey() {
  const st = S.state;
  return `${st.vignette}|${st.node || st.scene}`;
}

// Fill `el` with `text`, wrapping the first-ever occurrence of each glossary
// term in a definition span. Text without eligible terms lands as a single
// plain text node — the common case costs one regex probe per term.
export function fillTermText(el, text) {
  const st = S.state;
  if (!terms.length || !st || !st.seen_terms) {
    el.textContent = text;
    return;
  }
  const key = contextKey();
  const marks = [];
  for (const t of terms) {
    const seenAt = st.seen_terms[t.term];
    if (seenAt !== undefined && seenAt !== key) continue;
    const m = t.re.exec(text);
    if (m) marks.push({ start: m.index, end: m.index + m[0].length, t });
  }
  if (!marks.length) {
    el.textContent = text;
    return;
  }
  marks.sort((a, b) => a.start - b.start);
  let pos = 0;
  let dirty = false;
  for (const mk of marks) {
    if (mk.start < pos) continue; // overlapping terms — earliest wins
    el.appendChild(document.createTextNode(text.slice(pos, mk.start)));
    el.appendChild(termEl(text.slice(mk.start, mk.end), mk.t.definition));
    pos = mk.end;
    if (st.seen_terms[mk.t.term] === undefined) {
      st.seen_terms[mk.t.term] = key;
      dirty = true;
    }
  }
  el.appendChild(document.createTextNode(text.slice(pos)));
  if (dirty) S.save();
}

function termEl(word, definition) {
  const span = document.createElement('span');
  span.className = 'term';
  span.tabIndex = 0; // keyboard focus shows the tooltip too
  span.dataset.def = String(definition || '').trim();
  span.textContent = word;
  return span;
}

// ---------- The floating tooltip ----------

const SHOW_DELAY = 350; // ms — same beat as the old CSS transition-delay
const GAP = 10;         // space between the word and the tooltip
const EDGE = 8;         // minimum distance from the window edges
let tip = null;
let tipText = null;
let arrow = null;
let activeTerm = null;
let showTimer = null;

function initTooltip() {
  if (tip) return; // listeners are bound once
  tip = document.createElement('div');
  tip.id = 'term-tip';
  tip.setAttribute('role', 'tooltip');
  tipText = document.createElement('div');
  arrow = document.createElement('div');
  arrow.className = 'term-tip-arrow';
  tip.append(arrow, tipText);
  document.body.appendChild(tip);

  const termOf = (t) => (t && t.closest ? t.closest('.term') : null);
  document.addEventListener('mouseover', (e) => {
    const t = termOf(e.target);
    if (t && t !== activeTerm) schedule(t);
  });
  document.addEventListener('mouseout', (e) => {
    const t = termOf(e.target);
    if (t && !t.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('focusin', (e) => {
    const t = termOf(e.target);
    if (t) schedule(t);
  });
  document.addEventListener('focusout', (e) => {
    if (termOf(e.target)) hide();
  });
  // Anything scrolling (the transcript, the page) or resizing moves the word
  // out from under the tooltip — drop it rather than leave it adrift.
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}

function schedule(term) {
  clearTimeout(showTimer);
  activeTerm = term;
  showTimer = setTimeout(() => show(term), SHOW_DELAY);
}

function show(term) {
  if (!term.isConnected || !term.dataset.def) return;
  tipText.textContent = term.dataset.def;
  tip.classList.add('measuring');           // laid out but invisible, to measure
  const r = term.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Above the word if it fits, else below; if neither fits, whichever has
  // more room, clamped on screen.
  const roomAbove = r.top - GAP - EDGE;
  const roomBelow = vh - r.bottom - GAP - EDGE;
  const below = th > roomAbove && (th <= roomBelow || roomBelow > roomAbove);
  let top = below ? r.bottom + GAP : r.top - GAP - th;
  top = Math.max(EDGE, Math.min(top, vh - th - EDGE));

  const center = r.left + r.width / 2;
  let left = Math.max(EDGE, Math.min(center - tw / 2, vw - tw - EDGE));
  const arrowX = Math.max(12, Math.min(center - left, tw - 12));

  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
  arrow.style.left = `${Math.round(arrowX)}px`;
  tip.classList.toggle('below', below);
  tip.classList.remove('measuring');
  tip.classList.add('visible');
  term.setAttribute('aria-describedby', 'term-tip');
}

function hide() {
  clearTimeout(showTimer);
  showTimer = null;
  if (activeTerm) activeTerm.removeAttribute('aria-describedby');
  activeTerm = null;
  if (tip) tip.classList.remove('visible');
}
