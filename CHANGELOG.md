# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://www.semver.org/).

## \[1.1.0] - 2026-11-19

### Changed
* Improved descriptions for all four endings on the title screen.
* Rewrote the Nihilism ending.
* Leaving Rose for the garage after confessing now leads to Nihilism instead of Tragedy.

## \[1.0.2] - 2026-11-19

### Added
* Dialogue clarification for certain storylines added to one ending.

### Changed
* Some minor dialogue cleaning.

## \[1.0.1] - 2026-11-19

### Fixed
* Numerous small corrections throughout.

## \[1.0.0] - 2026-11-19 - Initial Release

First public release of **A Hell of Neon**, a browser-only narrative game.
Vanilla HTML/CSS/JavaScript with no build step and no backend; the only
dependency is a vendored copy of js-yaml.

### Added

* The complete story: the opening night and four days of investigation,
  with four endings.
* A map of ReSeattle for choosing where to go each day, with a limited
  number of visits per day.
* Scene art, character portraits, ambient sound and sound effects.
* Glossary tooltips for the setting's terms.
* Autosave with Continue, an Options menu with Clear saved data, and a
  record on the title screen of the endings you've reached.
* Content tools for authors: `tools/validate-content.py` checks the wiring,
  `tools/simulate-paths.py` plays the main routes through the real data,
  `tools/serve.py` serves the game locally, and `tools/build-art.py` builds
  the WebP art and the asset index.
* A debug menu for development (off in this release).
