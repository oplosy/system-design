# Changelog

Newest first. Versions follow [semantic versioning](https://semver.org).

## 1.2.2 - 2026-11-04

### Changed

- The npm package is `system-design-mcp`: npm refused `system-design`, a name another account unpublished in 2022. Run it with `npx -y system-design-mcp`; the command it installs is still `system-design`.

## 1.2.1 - 2026-11-04 (not published)

### Changed

- The build runs before packing (`prepack`) instead of on install (`prepare`), so installing the package from npm runs no install script and npm 12 shows no blocked-script warning. In a clone, run `npm run build` before `npm start` or `share`.
- The README installs from npm. npm 12 refuses git packages by default, so `npx github:oplosy/system-design` no longer works there.

## 1.2.0 - 2026-11-03

### Added

- A failed sheet or app render now shows what happened and a way back instead of a blank window.
- Dialogs keep Tab inside, close on Escape and give focus back.
- The production server sends a Content Security Policy and other security headers.
- `npm run lint` (Biome) and coverage thresholds run in CI.
- Browser tests also run on Firefox and WebKit.
- Browser tests scan the sheet, menu, selected part and Designs dialog with axe in both themes.
- Panels and bars are translucent over the sheet.
- Unit tests drive the MCP server over stdio, as an agent does.
- Screen readers hear which option of a list is active while arrow keys move through it.
- CI runs `npm audit`, and a release runs the same checks as CI, browser tests included.
- Browser tests cover the phone layout on Chromium and WebKit.
- Box text follows one format: headings start with a capital, descriptions with a small letter.
- On a phone, a selected item's card sits at the bottom of the sheet.

### Changed

- Rarely used dialogs load on first use, and libraries ship in their own chunks so a release leaves them cached.
- Design files are flushed to disk before they replace the old file.
- Quiet text has enough contrast in both themes.
- Type sizes and corner radii use one scale.
- `src/styles.css` and the core tests are split by area.
- React, React Flow and html-to-image are build-time dependencies, so installing the command no longer pulls them in.
- The cloud readers (Terraform, CloudFormation, Pulumi) live in `core/infra-cloud.ts`, review feedback in `core/review.ts`, copy and paste in `core/clipboard.ts`, and the step details in `src/step-details.tsx`.

### Fixed

- On a phone, the fit button no longer sits on the review bar, the selected item's card is opaque, and a part the card would cover moves up into view.
- Unfolding a step's details moves the parts out from under them.
- Copying and pasting parts in Firefox no longer adds them as a new step.
- The theme and style choices in the menu use valid menu roles.
- Each panel landmark has its own name for screen readers.

## 1.1.0 - 2026-10-30

Hub sign-in, plugins, MCP servers, webhooks, Slack approval and the GitHub Action hardening. See the tag for the full list of commits.

## 1.0.0 - 2026-10-28

First release: the canvas, reviewable steps over MCP, drift checks, imports and exports.
