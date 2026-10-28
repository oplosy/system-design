# System design

A local canvas for system and architecture designs that agents build and you review step by step.

- Every component type has its own shape (cloud for CDN, shield for WAF, cylinder for databases, pipe for queues, ...).
- Three part kits: **System** (cloud architecture), **Network** (routers, switches, PCs, printers, ...) and **Software** (use cases, classes, ports and adapters, DDD / CQRS, activity and state flows). Lines can be UML relations: inheritance, implementation, composition, aggregation, «include», «extend».
- **Boundaries** (region, zone, VPC, subnet, VLAN, site, cluster, system boundary, bounded context, swimlane, ...) wrap their members and nest; drop a part into a box to group it.
- Two looks for the same data: **Sketch** (hand-drawn, rough.js) and **Clean**.
- Designs are built in **steps**. Each step carries its components, connections, notes and decisions (why, alternatives, trade-offs).
- **Review queue:** steps added by an agent start unseen. You walk them in order and cannot jump past the first unseen step.
- **Step diff:** outlines what a step added (orange) or changed (amber, with old and new values in the step panel), and draws what it removed as a struck-out ghost. Agent edits through `update_component`, `place_in` and `remove_item` are recorded on the step they land in (latest by default), which reopens for review. **Revert step** puts back what the step removed or changed.
- **Request changes:** send a step back to the agent with a comment, or comment on one item in it; items with open comments get a badge. The agent reads them with `get_feedback`, fixes the step and answers with `resolve_feedback`, which hands the step back for review.
- **Options:** an agent can offer alternatives in one step (Redis vs CDN). Switch between them in the step panel to compare them on the sheet, then pick one: the others go, and a decision records the pick with the rest as alternatives. A step with options can't be marked seen until one is picked.
- **Flows:** a request path ("User logs in") through the components. Play it hop by hop from the step panel or while presenting: the path lights up and each hop is numbered. Draw one with **New flow** by clicking connected parts in order. **Sequence** shows a flow as a sequence diagram (replies dashed) and copies it as Mermaid.
- **Drill-down:** a part can open another design that shows its insides (C4-style). Link one under **Opens**, or start an empty one with **New inside**; the badge on the part opens it and a breadcrumb leads back.
- **Code links:** a part can say where its code lives under **Code**: a web address, or a path that opens against the design's **Repo** (set under **Design** in the step panel, e.g. `https://github.com/acme/shop/tree/main`). Parts with a link get a `</>` badge that opens it in a new tab. Agents set `code` on parts and `repo` with `update_design`; a compose import fills `code` from each service's `build` path.
- **Cost:** a part can carry its monthly cost (**Cost** in the inspector, `cost` for agents) in the design's currency, USD unless changed under **Design**. The part shows the cost as of the step on the sheet; the step panel shows the total so far and how much the step moves it, counting the parts it adds, cost edits (yours and the agent's) and removals. An edit in the inspector is recorded on the step on the sheet without reopening it; a cost a later step changed is shown read-only there.
- **Capacity notes:** a line can carry its load (requests per second) and one-way latency (ms). Both show under the line, and a flow adds up its hops' latency (a reply counts its line again).
- **Export to other tools:** **Export** also writes Structurizr DSL and C4-PlantUML (C4 container level: users become people, third parties external systems, datastores and queues get their shapes, boundaries become groups) and a draw.io file that keeps the sheet's positions. Agents get the same text with `export_design`.
- **Share:** **Export → Shared HTML** (or `npm run share -- <design id> [out.html]`) writes one self-contained file with the app and the design baked in, plus every design its parts open. It opens from disk or any static host (a PR attachment, GitHub Pages) with no server: readers walk the steps, use the diff, play flows and open drill-downs; their changes stay in that tab. It is built from `dist/`, so run `npm run build` first, and again after app changes.
- **Drift:** check a design against the infrastructure it describes (compose, Kubernetes or Terraform JSON). `npm run drift -- <design id or .json path> <infra file>` lists the parts and lines the infrastructure has and the design lacks, and the imported parts the infrastructure no longer has, and exits 1 when there are any, so it can fail a CI job; `--write` brings the design in line as one new step for review (removals show in its diff and revert like any other). Agents do the same with `sync_infra` (`dry_run` to only look). Imported parts remember where they came from, so renaming one in the design keeps it matched; hand-drawn parts and parts from another file type are never removed.
- **Capacity and failure:** a part can carry the requests per second it can take (**Capacity** in the inspector, `capacity` for agents). The inspector shows the load on the lines into it as of the step on the sheet, and lint flags it at 80% and past 100%. **If it fails** shows the flows that pass through the part and the parts users and clients could no longer reach; agents ask the same with `simulate_failure`.
- **Lint:** amber badges flag likely smells (isolated parts, a balancer with one target, a datastore in a public network or reached straight from clients, a one-sided queue, a part near or over its capacity, an unlinked decision). Hover a badge to read it.
- Everything is a JSON file in `designs/`, so changes are versioned and diffable. Each file carries the format `version` it was written in; older files are migrated when read, and a file from a newer version is refused rather than misread.

## Run

```bash
npm install
npm run dev
```

Without Vite, build once and serve the built app and the API from one Node server (`PORT` and `HOST` override `5180` and `127.0.0.1`):

```bash
npm run build
npm start
```

Open http://127.0.0.1:5180. Create a design from the **Twitter from scratch** or **Three-tier web app** template, start blank, or paste a Mermaid flowchart: its nodes, arrows and subgraphs become parts, lines and boundaries, with part types taken from node shapes and names, head word first ("PostgreSQL" → SQL DB, "Kafka consumer" → worker). Lines it can’t read are listed before anything is created; styling lines (`classDef`, `style`) are ignored. Or paste a docker-compose file or Kubernetes manifests: services and workloads become parts (typed from their image), `depends_on`, Ingress backends and environment values that address another service (a URL, `host:port`, a cluster DNS name, or a variable named like `DB_HOST` or `API_URL`) become lines, and more than one network or namespace becomes boundaries. Kinds that draw nothing (ConfigMap, Secret…) are listed before anything is created. Helm templates need rendering first (`helm template`). Terraform works from `terraform show -json` output (state, or a saved plan): known resources (EC2, Lambda, ECS, RDS, S3, SQS, load balancers… and their GCP and Azure counterparts) become parts, `depends_on` and, in a plan, configuration references become lines (also through undrawn resources: a load balancer reaches its services through listeners and target groups, a queue its consumer through the event source mapping), and more than one module becomes boundaries; IAM, security groups and other plumbing are listed as left out.

Edit by hand: drag shapes from the palette, drag between nodes to connect them (drag from a note or decision to a component to attach it), select an item to edit it on the right, and press Delete to remove it.

## Agents (MCP)

`mcp/server.ts` is a stdio MCP server over the same files. The open app updates live when an agent writes.

Inside this repo, Claude Code picks it up from `.mcp.json`. To use it from any project:

```bash
claude mcp add system-design -s user -- node C:/Users/mesut/Desktop/workspace/A-projects/system-design/mcp/server.ts
```

Main tool: `add_step` adds one reviewable change (components, connections, notes, decisions) in a single write, and can carry flows. Smaller tools: `create_design`, `update_design`, `add_component`, `connect`, `add_boundary`, `place_in`, `add_note`, `add_decision`, `update_component`, `remove_item`, `add_flow`, `update_connection`, `pick_option`, `sync_infra`, `export_design`, `simulate_failure`, `get_feedback`, `resolve_feedback`, `lint`, `get_design`, `list_designs`, `list_templates`.

## Layout

| Path | What |
| --- | --- |
| `core/` | Schema (zod), file store, shared edit functions, imports and exports, tests |
| `server/api.ts` | JSON API and change events, mounted in the Vite dev server |
| `server/main.ts` | Production server: the built app from `dist/` plus the API |
| `server/share.ts` | Builds the shared HTML file |
| `cli/drift.ts`, `cli/share.ts` | Drift check for CI, shared HTML from the command line |
| `mcp/server.ts` | MCP server for agents |
| `src/` | React Flow canvas, shapes, panels |
| `templates/` | Starting designs |
| `designs/` | Your designs |

Checks: `npm test`, `npm run typecheck`. Requires Node 24+ (runs TypeScript directly).
