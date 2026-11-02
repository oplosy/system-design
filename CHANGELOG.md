# Changelog

Newest first. Versions follow [semantic versioning](https://semver.org).

## Unreleased

### Added

- A failed sheet or app render now shows what happened and a way back instead of a blank window.
- Dialogs keep Tab inside, close on Escape and give focus back.
- The production server sends a Content Security Policy and other security headers.
- `npm run lint` (Biome) and coverage thresholds run in CI.
- Browser tests also run on Firefox and WebKit.
- Browser tests scan the sheet, menu, selected part and Designs dialog with axe in both themes.
- Panels and bars are translucent over the sheet.
- Box text follows one format: headings start with a capital, descriptions with a small letter.
- On a phone, a selected item's card sits at the bottom of the sheet.

### Changed

- Rarely used dialogs load on first use, and libraries ship in their own chunks so a release leaves them cached.
- Design files are flushed to disk before they replace the old file.
- Quiet text has enough contrast in both themes.
- Type sizes and corner radii use one scale.
- `src/styles.css` and the core tests are split by area.

### Fixed

- Unfolding a step's details moves the parts out from under them.
- Copying and pasting parts in Firefox no longer adds them as a new step.
- The theme and style choices in the menu use valid menu roles.
- Each panel landmark has its own name for screen readers.

## 1.1.0 - 2026-10-30

Hub sign-in, plugins, MCP servers, webhooks, Slack approval and the GitHub Action hardening. See the tag for the full list of commits.

## 1.0.0 - 2026-10-28

First release: the canvas, reviewable steps over MCP, drift checks, imports and exports.
