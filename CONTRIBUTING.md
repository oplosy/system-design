# Contributing

## Setup

Requires Node 24+, which runs TypeScript directly.

```bash
npm ci
npx playwright install chromium firefox webkit
npm run dev
```

The app opens on http://localhost:5180.

## Before a pull request

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`npm run test:coverage` prints coverage for the unit tests and fails below the thresholds in `package.json`. The first browser run needs `npx playwright install chromium firefox webkit`.

## Where things go

- `core/` holds what the app, the MCP server and the CLI share. It must not import from `src/`.
- `src/` is the React app. Keep pure logic in `.ts` files, so `node --test` can cover it without a browser.
- `server/`, `mcp/` and `cli/` are thin layers over `core/`.
- `e2e/` holds the browser tests. They run on their own data folder, never on your designs.

## Conventions

- Add a test with every fix or feature, and a line in `CHANGELOG.md` under Unreleased.
- Commit subjects use the imperative mood and stay under 72 characters.
- Ask in an issue before adding a dependency.
- `html-to-image` stays at 1.11.11: later versions draw the export wrong. Dependabot is told to leave it.
- Lint warnings fail the build. An effect that runs on a chosen trigger, or a mouse-only handler with a keyboard path elsewhere, says so at the line with a `biome-ignore` and its reason.

## Reporting a security problem

See [SECURITY.md](SECURITY.md). Don't open a public issue for it.
