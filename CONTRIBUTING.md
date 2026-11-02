# Contributing

## Setup

Requires Node 24+, which runs TypeScript directly.

```bash
npm ci
npx playwright install chromium
npm run dev
```

The app opens on http://localhost:5180.

## Before a pull request

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`npm run test:coverage` prints line coverage for the unit tests.

## Where things go

- `core/` holds what the app, the MCP server and the CLI share. It must not import from `src/`.
- `src/` is the React app. Keep pure logic in `.ts` files, so `node --test` can cover it without a browser.
- `server/`, `mcp/` and `cli/` are thin layers over `core/`.
- `e2e/` holds the browser tests. They run on their own data folder, never on your designs.

## Conventions

- Add a test with every fix or feature, and a line in `CHANGELOG.md` under Unreleased.
- Commit subjects use the imperative mood and stay under 72 characters.
- Ask in an issue before adding a dependency.

## Reporting a security problem

See [SECURITY.md](SECURITY.md). Don't open a public issue for it.
