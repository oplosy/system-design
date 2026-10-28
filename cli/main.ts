#!/usr/bin/env node
// One command for everything: `npx github:oplosy/system-design <command>`. Built to dist-cli/ (npm run build:cli),
// because Node does not run TypeScript from inside node_modules.

const HELP = `usage: system-design <command>

  start                                   Open the app at http://127.0.0.1:5180 (PORT and HOST change it)
  mcp                                     MCP server over stdio, for agents
  drift <design> <infra file> [--write] [--markdown]
                                          Check a design (id or .json path) against compose, Kubernetes, Terraform,
                                          CloudFormation, Pulumi, Backstage, OpenAPI, AsyncAPI or traces; exits 1 on drift
  diff <before.json> <after.json> [--markdown]
                                          What a change to a design file adds and removes, step by step
  share <design id> [out.html]            One read-only HTML file that opens anywhere
  adr <design> <folder> [--read]          Write each decision as a record in a folder (docs/adr), or read the folder's
                                          other records into the design as one step
  svg <design> <out.svg> [--badge <badge.svg>] [--infra <file>]
                                          Draw the design as an SVG for a README, with a status badge (drift against
                                          the infrastructure file, or parts and steps waiting for review)

Designs are kept in your data folder; set SYSTEM_DESIGN_DIR to use another.`;

const COMMANDS: Record<string, () => Promise<unknown>> = {
  start: () => import('../server/main.ts'),
  mcp: () => import('../mcp/server.ts'),
  drift: () => import('./drift.ts'),
  diff: () => import('./diff.ts'),
  share: () => import('./share.ts'),
  adr: () => import('./adr.ts'),
  svg: () => import('./svg.ts'),
};

const [command = 'start', ...rest] = process.argv.slice(2);
const run = COMMANDS[command];
if (!run) {
  console.log(HELP);
  process.exit(command === 'help' || command === '--help' || command === '-h' ? 0 : 2);
}
// Each command reads its own arguments from argv, as it does when run on its own.
process.argv = [process.argv[0], command, ...rest];
void run();
