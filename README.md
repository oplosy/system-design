# System design

A local canvas for system and architecture designs that agents build and you review step by step.

- Every component type has its own shape (cloud for CDN, shield for WAF, cylinder for databases, pipe for queues, ...).
- Three part kits: **System** (cloud architecture), **Network** (routers, switches, PCs, printers, ...) and **Software** (use cases, classes, ports and adapters, DDD / CQRS, activity and state flows). Lines can be UML relations: inheritance, implementation, composition, aggregation, «include», «extend».
- **Boundaries** (region, zone, VPC, subnet, VLAN, site, cluster, system boundary, bounded context, swimlane, ...) wrap their members and nest; drop a part into a box to group it.
- Two looks for the same data: **Sketch** (hand-drawn, rough.js) and **Clean**.
- Designs are built in **steps**. Each step carries its components, connections, notes and decisions (why, alternatives, trade-offs).
- **Review queue:** steps added by an agent start unseen. You walk them in order and cannot jump past the first unseen step.
- Everything is a JSON file in `designs/`, so changes are versioned and diffable.

## Run

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5180. Create a design from the **Twitter from scratch** or **Three-tier web app** template, or start blank.

Edit by hand: drag shapes from the palette, drag between nodes to connect them (drag from a note or decision to a component to attach it), select an item to edit it on the right, and press Delete to remove it.

## Agents (MCP)

`mcp/server.ts` is a stdio MCP server over the same files. The open app updates live when an agent writes.

Inside this repo, Claude Code picks it up from `.mcp.json`. To use it from any project:

```bash
claude mcp add system-design -s user -- node C:/Users/mesut/Desktop/workspace/A-projects/system-design/mcp/server.ts
```

Main tool: `add_step` adds one reviewable change (components, connections, notes, decisions) in a single write. Smaller tools: `create_design`, `add_component`, `connect`, `add_note`, `add_decision`, `update_component`, `remove_item`, `get_design`, `list_designs`, `list_templates`.

## Layout

| Path | What |
| --- | --- |
| `core/` | Schema (zod), file store, shared edit functions, tests |
| `server/api.ts` | JSON API and change events, mounted in the Vite dev server |
| `mcp/server.ts` | MCP server for agents |
| `src/` | React Flow canvas, shapes, panels |
| `templates/` | Starting designs |
| `designs/` | Your designs |

Checks: `npm test`, `npm run typecheck`. Requires Node 24+ (runs TypeScript directly).
