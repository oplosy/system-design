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
- **Paste anything:** paste a Mermaid flowchart, sequence, C4 or architecture-beta diagram, C4-PlantUML, a draw.io diagram (a `.drawio` file's text or shapes copied out of draw.io), a Structurizr DSL workspace, a docker-compose file, Kubernetes manifests, `terraform show -json` output, a CloudFormation / CDK template, a Pulumi stack export, a Backstage catalog, an OpenAPI or AsyncAPI document or traces straight onto the sheet; it becomes a new step, reusing the parts the design already has (same name), so a paste extends a design instead of copying into it. Or drop the file itself (`.drawio`, `.dsl`, `.mmd`, compose, manifests…) on the sheet. A sequence diagram becomes a flow. Agents do the same with `import_diagram`. Copying parts puts them on the clipboard as a Mermaid flowchart for other apps; pasted back here they keep every detail.
- **Export to other tools:** **Export** also writes Structurizr DSL and C4-PlantUML (C4 container level: users become people, third parties external systems, datastores and queues get their shapes, boundaries become groups) and a draw.io file that keeps the sheet's positions. Agents get the same text with `export_design`.
- **Share:** **Export → Shared HTML** (or `npm run share -- <design id> [out.html]`) writes one self-contained file with the app and the design baked in, plus every design its parts open. It opens from disk or any static host (a PR attachment, GitHub Pages) with no server: readers walk the steps, use the diff, play flows and open drill-downs; their changes stay in that tab. It is built from `dist/`, so run `npm run build` first, and again after app changes.
- **Drift:** check a design against the infrastructure it describes (compose, Kubernetes, Terraform JSON, CloudFormation, Pulumi, a Backstage catalog, OpenAPI / AsyncAPI or traces). `npm run drift -- <design id or .json path> <infra file>` lists the parts and lines the infrastructure has and the design lacks, and the imported parts the infrastructure no longer has, and exits 1 when there are any, so it can fail a CI job; `--write` brings the design in line as one new step for review (removals show in its diff and revert like any other). Agents do the same with `sync_infra` (`dry_run` to only look). Imported parts remember where they came from, so renaming one in the design keeps it matched; hand-drawn parts and parts from another file type are never removed. With traces, drift also reports lines whose drawn qps or latency is missing or more than a quarter off what was measured (`~ line`), and flows seen in the traces (`+ flow`); traces are a sample, so they never remove parts.
- **Tag views:** tag parts by concern (**Tags** in the inspector, `tags` for agents: "payments", "pii", a team). **View** in the top bar then shows one tag at a time: the other parts, their lines and notes, and boxes left empty step aside, so one model gives a payments view, a PII view, a per-team view.
- **Capacity and failure:** a part can carry the requests per second it can take (**Capacity** in the inspector, `capacity` for agents). The inspector shows the load on the lines into it as of the step on the sheet, and lint flags it at 80% and past 100%. **If it fails** shows the flows that pass through the part and the parts users and clients could no longer reach; agents ask the same with `simulate_failure`.
- **Lint:** amber badges flag likely smells (isolated parts, a balancer with one target, a datastore in a public network or reached straight from clients, a one-sided queue, a part near or over its capacity, an unlinked decision). Hover a badge to read it.
- Everything is a JSON file in your data folder (`%APPDATA%system-designdesigns` on Windows, `~/Library/Application Support/system-design/designs` on macOS, `~/.local/share/system-design/designs` on Linux), outside the app, so updating or reinstalling it never touches your designs; set `SYSTEM_DESIGN_DIR` to keep them elsewhere, for example in a repo to version them with git. The app, the MCP server and the CLI all use the same folder, so what an agent writes is what you review. Designs from older versions, which kept them in `designs/` next to the code, are copied over on first start (the originals stay). **Designs** (in the design menu, and shown at start when there is no design to reopen) lists them all with search: open, rename, copy, download as `.json`, add one from a `.json` file, or delete; deleted designs go to a `.trash` folder and come back with **Restore**. The app reopens the design you last worked on.
- Files are versioned and diffable. Each file carries the format `version` it was written in; older files are migrated when read, and a file from a newer version is refused rather than misread.

## Run

Without cloning (Node 24+), from npm once a release is published there, or straight from GitHub (the first run builds it):

```bash
npx -y system-design
```

```bash
npx -y github:oplosy/system-design
```

`system-design help` lists the commands: `start` (the app), `mcp` (the MCP server), `drift`, `diff`, `share`, `adr` and `svg`.

From a clone:

```bash
npm install
npm run dev
```

Without Vite, build once and serve the built app and the API from one Node server (`PORT` and `HOST` override `5180` and `127.0.0.1`; the API answers only requests addressed to this machine or to `HOST`, and refuses writes from other sites; to open it from another machine by name or address, start it with that `HOST`, or `HOST=0.0.0.0` for any):

```bash
npm run build
npm start
```

Open http://127.0.0.1:5180. Create a design from the **Twitter from scratch** or **Three-tier web app** template, start blank, or bring a diagram from another tool: a Mermaid flowchart's nodes, arrows and subgraphs become parts, lines and boundaries, a sequence diagram's participants and messages become parts, lines and a flow, and C4 diagrams (Mermaid's or C4-PlantUML) and architecture-beta bring their people, containers, stores and boundaries. A draw.io diagram keeps its arrangement: shapes become parts typed from their icon (the AWS, Azure, GCP and Kubernetes libraries) or shape (actor, cylinder), a shape that holds others (nested, or drawn around them) becomes a boundary, arrows become lines; compressed files are read too, and only the first page. A Structurizr workspace is read at the container level: a software system with containers becomes a system boundary around them, groups become boundaries, a component's relationships move to its container, and dynamic views become flows. Elsewhere part types come from shapes and names, head word first ("PostgreSQL" → SQL DB, "Kafka consumer" → worker). Whatever it leaves out is listed before anything is created; styling lines (`classDef`, `style`) are ignored. Or paste a docker-compose file or Kubernetes manifests: services and workloads become parts (typed from their image), `depends_on`, Ingress backends and environment values that address another service (a URL, `host:port`, a cluster DNS name, or a variable named like `DB_HOST` or `API_URL`) become lines, and more than one network or namespace becomes boundaries. Kinds that draw nothing (ConfigMap, Secret…) are listed before anything is created. Helm templates need rendering first (`helm template`). Terraform works from `terraform show -json` output (state, or a saved plan): known resources (EC2, Lambda, ECS, RDS, S3, SQS, load balancers… and their GCP and Azure counterparts) become parts, `depends_on` and, in a plan, configuration references become lines (also through undrawn resources: a load balancer reaches its services through listeners and target groups, a queue its consumer through the event source mapping), and more than one module becomes boundaries; IAM, security groups and other plumbing are listed as left out. A CloudFormation template (YAML with `!Ref`/`!GetAtt`/`!Sub`, or JSON, so `cdk synth` output too, where parts take their construct names) and a `pulumi stack export` (AWS, Google Cloud, Azure classic and the common azure-native types) are read the same way: each resource maps to its Terraform counterpart, references and dependencies become lines, and Pulumi component resources become boxes, nested, around what they hold. A Backstage catalog (`catalog-info.yaml`, one or many entities) brings Components and Resources as parts with their descriptions and source links, Systems as boundaries around them (inside their Domains and subdomains), `dependsOn` as lines, and an API one component provides and another consumes as a line between the two, named after the API. An OpenAPI document adds its service with the endpoints in its description (or fills in the description of the service already drawn under that name), plus the sign-in provider its OAuth / OpenID Connect schemes name and its webhooks; an AsyncAPI document (2.x or 3.x) adds its application and each channel as a queue, topic or stream (from the server protocol), with async lines for what it sends and receives. Recorded traces work too: OTLP JSON (the OpenTelemetry collector's file exporter, one object per line) or a Jaeger JSON download. Services become parts, client spans to databases, queues and outside hosts add those (typed from `db.system` and `messaging.system`), calls become lines with the measured rate (calls over the capture window) and one-way latency (half the caller's median), queue hops are async, and each kind of request becomes a flow walked from one sample trace.

When you and an agent change the same design at once, your edits are replayed onto the agent's version instead of being dropped; where you both changed the same field, yours wins and the message says which.

Edit by hand: drag shapes from the palette, drag between nodes to connect them (drag from a note or decision to a component to attach it), select an item to edit it on the right, and press Delete to remove it.

## Agents (MCP)

`mcp/server.ts` is a stdio MCP server over the same files. The open app updates live when an agent writes.

Inside this repo, Claude Code picks it up from `.mcp.json`. To use it from any project:

```bash
claude mcp add system-design -s user -- npx -y github:oplosy/system-design mcp
```

## Pull requests (GitHub Action)

The action checks a design against the repository's infrastructure files and keeps one comment on each pull request up to date: what the infrastructure has that the design lacks (and the reverse), and, when the pull request changes the design file, the steps, parts, lines and decisions it adds and the parts and lines it removes. The same report goes to the job summary. Keep the design in the repository: download it from **Designs** (or point `SYSTEM_DESIGN_DIR` at a folder in the repo).

```yaml
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  design:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oplosy/system-design@v1
        with:
          design: docs/architecture.json
          infra: |
            docker-compose.yml
            k8s/all.yaml
          fail-on-drift: false
```

A pull request with nothing to report gets no comment. Names from the files are shown as code and `@` mentions are defused, so a comment can't ping or link anyone. Pull requests from forks get a read-only token: the report still lands in the job summary, and the comment is skipped with a warning. Locally, `system-design drift <design> <file> --markdown` and `system-design diff <before.json> <after.json> --markdown` print the same report. [`examples/shop`](examples/shop) is a design that leaves out the compose file's cache on purpose; this repository's CI runs the action on it.

Main tool: `add_step` adds one reviewable change (components, connections, notes, decisions) in a single write, and can carry flows. Smaller tools: `create_design`, `update_design`, `add_component`, `connect`, `add_boundary`, `place_in`, `add_note`, `add_decision`, `update_component`, `remove_item`, `add_flow`, `update_connection`, `pick_option`, `sync_infra`, `import_diagram`, `sync_adrs`, `export_design`, `simulate_failure`, `get_feedback`, `resolve_feedback`, `lint`, `get_design`, `list_designs`, `list_templates`.

## Decision records

`system-design adr <design> docs/adr` writes each decision as a Markdown record (`0001-use-postgresql.md`: status, the parts it affects, context, considered options, consequences), numbered after the folder's own. A marker in each file ties it to its decision, so running it again rewrites only what changed. `--read` goes the other way: the folder's other records (Nygard or MADR, status in a section, a list item or front matter) come in as decisions in one step for review, linked to the parts they name; rejected, deprecated and superseded ones are left out. Agents do the same with `sync_adrs`.

## Live load

Set `PROMETHEUS_URL` (Prometheus or anything with its query API: Mimir, Thanos, VictoriaMetrics) before `start`, and **Live** in the top bar replaces the designed numbers on the lines with measured ones every 15 seconds: requests per second, one-way latency (half the caller's median) and the share of failed calls; a line with 5% or more failures turns red. It reads the service graph metrics (`traces_service_graph_*`) that the OpenTelemetry collector's servicegraph connector and Tempo write. A service matches the part whose **Links** has an `otel` entry with its name, else the part imported from its traces, else the part with its name; the button's tooltip lists the pairs no line matched.

## Connections

**Connections** in the design menu lists the webhooks and the addresses other tools and agents use. Each part's **Links** holds typed references (repo, docs, runbook, dashboard, ticket, owner, oncall, slo, otel, k8s, cloud, backstage, link) that tie it to the same thing elsewhere; agents set them with `refs` on `add_component`, `add_step` and `update_component`. `#<design>/<item>` after the app's address opens a design with a part, line, step or decision selected, and the address follows the selection, so any link can be pasted into a ticket or chat.

The API is versioned under `/api/v1` (`/api` stays as an alias). `/api/v1/openapi.json` is its OpenAPI 3.1 document, for generating a client or importing into Postman, n8n or Zapier, and `/api/v1/schema/design.json` is the JSON Schema of a design file. Both are built from the schemas the server validates with.

Webhooks get every change, whether made in the app, by an agent or by a command: one POST per write, as a JSON array of [CloudEvents](https://cloudevents.io) (`application/cloudevents-batch+json`) of the types `system-design.design.*`, `step.*`, `part.*`, `line.*`, `boundary.*`, `note.*`, `decision.*`, `flow.*` and `comment.*`, each with `actor` (`app` or `agent`), a link to the item and the item itself. Moving things on the canvas sends nothing. A hook can be limited to event groups and designs; with a secret it carries `X-System-Design-Signature: sha256=<HMAC-SHA256 of the body>`. Network errors, 429 and 5xx are retried twice, and a webhook that fails never fails the write. The **chat** format posts "New step in “Shop”: Add a cache. 2 waiting for review" to Slack, Discord or Teams when an agent or a sync adds steps. Hooks live in `hooks.json` in the user's app folder (`SYSTEM_DESIGN_HOOKS` moves it), never next to the designs, so secrets stay out of git; manage them in the dialog or at `/api/v1/hooks`. `SYSTEM_DESIGN_WEBHOOK` still works as a chat hook for new steps, and `SYSTEM_DESIGN_URL` sets the links' address (default `http://127.0.0.1:5180`).

## Plugins

A plugin teaches the app a new format, metric source or link target with no change here. It is one JavaScript module (`.mjs` or `.js`) in the `plugins` folder of the user's app folder (`SYSTEM_DESIGN_PLUGINS` moves it), and the app and the MCP server load it when they start. Plugins run as code with your rights, so they load from that folder only, never from a design, a repository or the API; add only what you trust. [`examples/plugins/service-list.mjs`](examples/plugins/service-list.mjs) has one of each kind:

```js
export default {
  name: 'my-tools', // lowercase, unique
  importers: [{ id, name, matches: (text) => boolean, read: (text) => diagram }],
  exporters: [{ id, name, extension, render: (design) => text }],
  metrics: [{ name, read: (design) => ({ qps, failed, latency }) }],
  links: [{ kind, url: (value) => address }],
};
```

Each function may be async.

- **Importers** are asked first, for anything pasted, dropped, given to a new design or sent to `import_diagram`. `read` returns `{ nodes: [{ key, label?, type?, tech?, description?, group? }], groups?: [{ key, label, parent?, kind? }], edges?: [{ from, to, label?, async? }], flows?: [{ title, path }], leftOut?: [] }`; the result is checked, and comes in as a step for review like any import.
- **Exporters** appear in the **Export** menu, in `export_design` as `<plugin>.<id>`, and at `/api/v1/designs/<id>/export/<plugin>.<id>`.
- **Metrics** feed **Live**, alongside Prometheus if it is set. Each list holds `{ client, server, value }`, matched to parts as in [Live load](#live-load): `qps` and `failed` per second, `latency` in round-trip seconds.
- **Links** turn a part's plain value of one kind (a ticket number) into the address it opens, or nothing.

**Connections** lists what is installed, and why a plugin that failed to load did; `/api/v1/plugins` gives the same. A plugin that fails to load leaves the others working. After adding or changing one, restart the app and the agent's MCP server. Log to stderr, never stdout: the MCP server's stdout is its protocol.

## Pictures for docs

`system-design svg <design> docs/architecture.svg --badge docs/design-badge.svg` draws the design (boundaries, parts, lines and their load; light and dark) and a badge with its part count and steps waiting for review; with `--infra docker-compose.yml` the badge says whether the design matches that file. Run it in CI or a pre-commit hook and commit the files, so a README or wiki shows the current design:

```markdown
![design](docs/design-badge.svg)
![architecture](docs/architecture.svg)
```

## Layout

| Path | What |
| --- | --- |
| `core/` | Schema (zod), file store, shared edit functions, imports and exports, tests |
| `server/api.ts` | JSON API and change events, mounted in the Vite dev server |
| `server/main.ts` | Production server: the built app from `dist/` plus the API |
| `server/share.ts` | Builds the shared HTML file |
| `cli/` | The `system-design` command (`main.ts`): drift check, design diff, shared HTML, decision records, SVG and badge; built to `dist-cli/` |
| `action.yml`, `action/` | GitHub Action for pull requests |
| `examples/` | Example design and compose file the action is tested on |
| `mcp/server.ts` | MCP server for agents |
| `src/` | React Flow canvas, shapes, panels |
| `templates/` | Starting designs |
| `designs/` | Where designs lived before the data folder; read once to copy them over, then ignored |

Checks: `npm test`, `npm run typecheck`. Requires Node 24+ (runs TypeScript directly).

## Releasing

Set `version` in `package.json`, commit, and push a matching tag (`git tag v1.1.0 && git push origin v1.1.0`). The release workflow runs the checks, publishes to npm when the `NPM_TOKEN` secret (an npm automation token) is set, and moves the major tag (`v1`) that action users pin to.

## License

MIT
