// Dev-only: per-thread progress for the debug day skip. Leaf module, shared by
// engine.js (applies the flags) and ui.js (draws one button row per thread).
//
// Each thread lists its levels in order. A level's `flags` are the COMPLETE
// set for that level (not a delta), so a level can also be a branch, like
// Rose's "said nothing." The stored selection is the level's index, so append
// new levels at the end to keep saved selections meaning the same thing.
// Selecting a level first clears every flag any level of that thread sets,
// then sets the chosen level's flags. `prereq` flags are set alongside any
// non-empty level (e.g. Rose's chain presumes she moved in).

export const DEBUG_THREADS = [
  {
    id: 'autopsy', label: 'Autopsy',
    levels: [
      { code: 'A0', tip: 'no Autopsy beats done', flags: [] },
      { code: 'A1', tip: 'Autopsy 1 done', flags: ['autopsy1_done'] },
      { code: 'A2', tip: 'Autopsy 1-2 done', flags: ['autopsy1_done', 'autopsy2_done'] },
      { code: 'A3', tip: 'Autopsy 1-3 done (spine complete)',
        flags: ['autopsy1_done', 'autopsy2_done', 'autopsy3_done'] },
    ],
  },
  {
    id: 'car', label: 'Car',
    levels: [
      { code: 'C0', tip: 'Corporate Car not done', flags: [] },
      { code: 'C1', tip: 'Corporate Car done', flags: ['car_done'] },
    ],
  },
  {
    id: 'heavy', label: 'Heavy',
    prereq: ['facematch_done'],
    levels: [
      { code: 'H0', tip: 'no Heavy beats done', flags: [] },
      { code: 'H1', tip: 'Heavy 1 done (motel located)', flags: ['heavy1_done', 'heavy_located'] },
      { code: 'H2', tip: 'Heavy 1-2 done',
        flags: ['heavy1_done', 'heavy_located', 'heavy2_done'] },
    ],
  },
  {
    id: 'shred', label: 'Shred',
    levels: [
      { code: 'S0', tip: 'no Shred beats done', flags: [] },
      { code: 'S1', tip: 'Shred 1 (Wu) done', flags: ['shred1_done'] },
      { code: 'S2', tip: 'Shred 1-2 done',
        flags: ['shred1_done', 'shred2_done'] },
    ],
  },
  {
    // Indexes 0-5 match the old R0-R5 selector, so a stored choice survives.
    id: 'rose', label: 'Rose',
    prereq: ['rose1_done', 'rose_living_with_brand'],
    levels: [
      { code: 'R0', tip: 'no chain beats done (2a next)', flags: [] },
      { code: 'R1', tip: '2a done (2b next)', flags: ['rose2a_done'] },
      { code: 'R2', tip: '2a-2b done (Beat 3 next)', flags: ['rose2a_done', 'rose2b_done'] },
      { code: 'R3', tip: 'through Beat 3 (confession next, once Autopsy 3 is done)',
        flags: ['rose2a_done', 'rose2b_done', 'rose3_done'] },
      { code: 'R4', tip: 'confessed (aftermath next)',
        flags: ['rose2a_done', 'rose2b_done', 'rose3_done', 'rose4_done', 'confessed'] },
      { code: 'R5', tip: 'aftermath done (chain finished)',
        flags: ['rose2a_done', 'rose2b_done', 'rose3_done', 'rose4_done', 'confessed',
                'rose_aftermath_done'] },
      { code: 'RX', tip: 'said nothing at Beat 4 (column closed; rose_closed next)',
        flags: ['rose2a_done', 'rose2b_done', 'rose3_done', 'confession_declined'] },
    ],
  },
];
