// Boot: load all content at startup, wire the title screen, hand off
// to the engine.

import { loadContent } from './content.js';
import * as S from './state.js';
import * as UI from './ui.js';
import * as engine from './engine.js';
import { debugSkipToDay, debugSkipToEnding } from './debug.js';
import { sfxClick } from './audio.js';

const $ = (id) => document.getElementById(id);

window.addEventListener('DOMContentLoaded', async () => {
  let content;
  try {
    content = await loadContent();
  } catch (err) {
    document.body.textContent =
      `Failed to load content: ${err.message}. ` +
      'A Hell of Neon must be served over HTTP (e.g. "python -m http.server"), not opened from file://.';
    return;
  }

  engine.init(content);
  UI.initEndings(content.endings);

  // One rule for the whole UI: every choice and hotspot clicks.
  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest('button.choice, .hotspot')) sfxClick();
    },
    true
  );

  const savedGame = () => {
    const raw = S.loadRaw();
    return S.validate(raw, content) ? raw : null;
  };

  // Something threw under the fade (see UI.fade): put the title back up
  // rather than leave the screen black. The save is left alone, but Continue
  // stays off for this page load so it can't loop into the same error.
  const recoverToTitle = () => {
    S.reset();
    UI.applyLensClass();
    UI.showTitle(false);
  };
  UI.onFadeError(recoverToTitle);

  $('btn-new').addEventListener('click', async () => {
    if (savedGame()) {
      const ok = await UI.confirmModal(
        'This will overwrite your previous game. Continue?',
        'Overwrite',
        'Cancel'
      );
      if (!ok) return;
    }
    UI.fade(() => engine.startNewGame());
  });

  $('btn-continue').addEventListener('click', () => {
    const saved = savedGame();
    if (!saved) return; // button is disabled in this case anyway
    S.loadInto(saved);
    if (S.state.screen === 'title') {
      UI.showTitle(true);
      return;
    }
    UI.fade(() => engine.resume());
  });

  // Options: for now, one setting — wipe everything saved in this browser
  // (the current game and the endings record).
  $('btn-options').addEventListener('click', () => UI.showTitleMenu('options'));
  $('btn-options-back').addEventListener('click', () => UI.showTitleMenu('main'));
  $('btn-clear-data').addEventListener('click', async () => {
    const ok = await UI.confirmModal(
      'Clear all saved data? This erases your current game and the endings you\'ve reached.',
      'Clear',
      'Cancel'
    );
    if (!ok) return;
    S.clearAllData();
    S.reset();
    UI.applyLensClass();
    UI.showTitle(false);
  });

  $('btn-end-title').addEventListener('click', () => {
    // Game over: wipe the save and return to the title, Continue grayed.
    S.clearSave();
    S.reset();
    UI.applyLensClass();
    UI.fade(() => UI.showTitle(false));
  });

  UI.initDebugMenu(
    (day) => UI.fade(() => debugSkipToDay(day, UI.debugThreadLevels())),
    (ending) => UI.fade(() => debugSkipToEnding(ending, UI.debugThreadLevels())),
  );

  S.reset();
  UI.applyLensClass();
  const saved = savedGame();
  if (UI.debugResume() && saved && saved.screen !== 'title') {
    // Debug reload-resume: skip the title, land on the saved node directly.
    S.loadInto(saved);
    engine.resume().catch((err) => {
      console.error('A Hell of Neon:', err);
      recoverToTitle();
    });
    return;
  }
  UI.showTitle(!!saved); // Continue grayed if save absent or invalid
});
