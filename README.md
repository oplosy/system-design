# System design

A local canvas for system and architecture designs that coding agents build and you review step by step.

An agent working on your project records each architectural change as one reviewable step: the parts it adds, how they connect, and why it chose them. You walk those steps on a canvas, compare alternatives, send a step back with a comment, and the agent reads your comment and fixes it. Designs are plain JSON files, so they version in git, and the same files can be checked against your real infrastructure in CI.

Everything runs on your machine. There is no account and no cloud service; a design leaves your computer only if you share, sync or connect it yourself.

## Contents

- [Status](#status)
- [Who it is for](#who-it-is-for)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [What a design holds](#what-a-design-holds)
- [Reviewing steps](#reviewing-steps)
- [Working on the canvas](#working-on-the-canvas)
- [Understanding a design](#understanding-a-design)
- [Bringing things in](#bringing-things-in)
- [Taking things out](#taking-things-out)
- [Drift: design against reality](#drift-design-against-reality)
- [Where designs are stored](#where-designs-are-stored)
- [Agents (MCP)](#agents-mcp)
- [Command line](#command-line)
- [Pull requests (GitHub Action)](#pull-requests-github-action)
- [Decision records](#decision-records)
- [Pictures for docs](#pictures-for-docs)
- [Live load](#live-load)
- [Connections](#connections)
- [Working as a team](#working-as-a-team)
- [MCP servers](#mcp-servers)
- [Plugins](#plugins)
- [Configuration](#configuration)
- [What happens when…](#what-happens-when)
- [Security](#security)
- [Known limits](#known-limits)
- [Layout of this repository](#layout-of-this-repository)
- [Development](#development)
- [License](#license)

## Status

Version 1.1.0. The features below are complete, and active development is paused as of 2026-10-30.

The last full check ran that day from a clean clone against the built command: type check, unit tests, every CLI command, the API, webhooks, plugins, the MCP client, every MCP tool, hub sign-in against a local provider that really signs tokens, Slack clicks with real signatures, and a walk through the app in a browser. All of it passed. What has not been tried is listed under [Known limits](#known-limits).

The package is not on npm yet, so install it from GitHub as shown below.

## Who it is for

- **You work with coding agents** and want to see and approve what they decide about architecture, rather than discover it in a diff.
- **You own a system's architecture** and want a design that is checked against the infrastructure instead of going stale in a wiki.
- **Your team reviews design changes** in pull requests, in a shared browser app, or from Slack.
- **You already have diagrams or infrastructure code** and want them in one model without redrawing them.

## Quick start

You need Node 24 or newer.

Run it straight from GitHub (the first run builds it):

```bash
npx -y github:oplosy/system-design
```

Once a release is published to npm, this works too:

```bash
npx -y system-design
```

Open http://127.0.0.1:5180. Create a design from the **Twitter from scratch** or **Three-tier web app** template, start blank, or bring a diagram or infrastructure file from another tool.

To let Claude Code work on your designs from any project:

```bash
claude mcp add system-design -s user -- npx -y github:oplosy/system-design mcp
```

Other MCP clients take the same command and arguments in their own configuration.

From a clone, with live reload:

```bash
npm install
npm run dev
```

Without Vite, build once and serve the built app and the API from one Node server:

```bash
npm run build
npm start
```

`PORT` and `HOST` override `5180` and `127.0.0.1`. The API answers only requests addressed to this machine or to `HOST`, and refuses writes from other sites. To open it from another machine by name or address, start it with that `HOST`, or `HOST=0.0.0.0` for any. Read [Security](#security) first: without sign-in, anyone who reaches the server can read and change every design, and the server warns you about this at start.

## How it works

```
 Agent  ──MCP──▶  MCP server ─┐
                              ├──▶  JSON files in your data folder  ──▶  git, CI, shared HTML
 You    ──────▶   App + API  ─┘         (one source of truth)
                     ▲
                     └── live updates whenever a file changes
```

The app, the MCP server and the command line all read and write the same folder, so what an agent writes is what you review. The open app updates live when an agent writes.

A typical round:

1. The agent calls `add_step` with the parts, lines, notes and decisions of one change.
2. The step appears in the app as unseen, and the design shows how many steps wait for you.
3. You walk it. The step's additions are outlined, and its decisions explain why.
4. You mark it seen and move on, or send it back with a comment.
5. The agent reads your comment with `get_feedback`, fixes the step and answers with `resolve_feedback`, which hands the step back to you.

## What a design holds

| Item | What it is |
|---|---|
| **Step** | One reviewable change. Each step carries its components, connections, notes and decisions |
| **Component (part)** | One of 159 types, each with its own shape: cloud for CDN, shield for WAF, cylinder for databases, pipe for queues, and so on |
| **Connection (line)** | A link between two parts, sync or async, with an optional label, load (req/s), one-way latency (ms), route (curve, straight, elbow) and UML kind (inheritance, implementation, composition, aggregation, «include», «extend») |
| **Boundary** | A box around parts: region, zone, data center, VPC, subnet, VLAN, cluster, site, system, bounded context, swimlane or group. Boundaries nest, and a box sizes itself to its members |
| **Note** | A short explanation, free or attached to a part |
| **Decision** | What was decided, why, the alternatives and the trade-offs, linked to the parts it affects |
| **Flow** | A request path through the parts, such as "User logs in", that can be played hop by hop |
| **Option** | One of several alternatives inside a step, such as Redis or a CDN, for you to compare and pick |
| **Comment** | Your review remark on a step or on one item in it |

A part can also carry a technology, description, monthly cost, capacity (req/s), tags, code link, typed links to other tools, and a link to another design that shows its insides.

The palette has three kits:

- **System**: cloud architecture.
- **Network**: routers, switches, PCs, printers, racks, links.
- **Software**: use cases, classes, ports and adapters, DDD and CQRS, activity and state flows.

## Reviewing steps

**Review queue.** Steps added by an agent start unseen. You walk them in order and cannot jump past the first unseen step. **Mark seen** moves to the next one.

**Step diff.** **Diff** outlines what a step added (orange) or changed (amber, with old and new values in the step panel), and draws what it removed as a struck-out ghost. Agent edits through `update_component`, `update_connection`, `place_in` and `remove_item` are recorded on the step they land in (the latest by default), which reopens that step for review. **Revert step** undoes the whole step: it removes what the step added, puts back what the step removed or changed, and the step goes too, unless it is the only one. Ctrl+Z brings it back.

**Request changes.** Send a step back to the agent with a comment, or comment on one item in it. Items with open comments get a badge. The agent reads them with `get_feedback`, fixes the step and answers with `resolve_feedback`, which hands the step back for review.

**Options.** An agent can offer alternatives in one step. Switch between them in the step panel to compare them on the sheet, then pick one: the others go, and a decision records the pick with the rest as alternatives. A step with options can't be marked seen until one is picked. If you told the agent your choice, it can apply it with `pick_option`.

**Presenting.** **Present** walks the steps full screen, for a meeting or a walkthrough. Flows can be played there too.

## Working on the canvas

- **Add** a part by dragging it from the palette or clicking it. Search the palette with words like `kafka`, `redis` or `s3`.
- **Connect** by dragging between two parts. Drag from a note or decision to a part to attach it.
- **Group** by dropping a part into a box.
- **Edit** by selecting an item and using the panel on the right. Double-click to rename. Press Delete or Backspace to remove.
- **Find** anything on the sheet with **Find on sheet** (Ctrl+F).
- **Layout** arranges the sheet: Layered, Tiers, Flow, Tree, Radial, Organic or Grid, for everything or only the selected items.
- **Appearance** switches the theme (light, dark, system) and the drawing style. **Sketch** is hand-drawn, for a whiteboard feel; **Clean** is crisp, for docs. Both draw the same data.
- **Drill down.** A part can open another design that shows its insides, C4-style. Link one under **Opens**, or start an empty one with **New inside**. The badge on the part opens it and a breadcrumb leads back.
- **Code links.** Under **Code**, a part can say where its code lives: a web address, or a path that opens against the design's **Repo** (set under **Design** in the step panel, such as `https://github.com/acme/shop/tree/main`). Parts with a link get a `</>` badge. Agents set `code` on parts and `repo` with `update_design`; a compose import fills `code` from each service's `build` path.
- **Tag views.** Tag parts by concern under **Tags**: "payments", "pii", a team. **View** in the top bar then shows one tag at a time, and the other parts, their lines and notes, and boxes left empty step aside. One model gives a payments view, a PII view and a per-team view.

Edits save themselves. If you and an agent change the same design at once, your edits are replayed onto the agent's version instead of being dropped; where you both changed the same field, yours wins and a message says which.

### Keyboard

| Keys | Action |
|---|---|
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y | Redo |
| Ctrl/Cmd+C, X, V | Copy, cut, paste. Copied parts also reach other apps as a Mermaid flowchart |
| Ctrl/Cmd+D | Duplicate |
| Ctrl/Cmd+F | Find on the sheet |
| Delete, Backspace | Remove the selected item |
| Right arrow | Mark the step seen and go to the next one |
| Left arrow | Previous step |
| Esc | Clear the selection, or close the open panel or dialog |
| Ctrl/Cmd+Enter | Send a comment |

While presenting: Right, Space or Page Down go forward, Left or Page Up go back, Esc exits. With a flow playing, the same keys move hop by hop, and Esc stops the flow.

## Understanding a design

**Flows.** Play a flow from the step panel or while presenting: the path lights up and each hop is numbered. Draw one with **New flow** by clicking connected parts in order. **Sequence** shows a flow as a sequence diagram, with replies dashed, and copies it as Mermaid.

**Capacity notes.** A line can carry its load (requests per second) and one-way latency (ms). Both show under the line, and a flow adds up its hops' latency. A reply counts its line again.

**Capacity and failure.** A part can carry the requests per second it can take (**Capacity**, `capacity` for agents). The inspector shows the load on the lines into it as of the step on the sheet. **If it fails** shows the flows that pass through the part and the parts users and clients could no longer reach. Agents ask the same with `simulate_failure`.

**Cost.** A part can carry its monthly cost (**Cost**, `cost` for agents) in the design's currency, USD unless changed under **Design**. The part shows the cost as of the step on the sheet. The step panel shows the total so far and how much the step moves it, counting the parts it adds, cost edits (yours and the agent's) and removals. An edit in the inspector is recorded on the step on the sheet without reopening it; a cost a later step changed is shown read-only there.

**Lint.** Amber badges flag likely problems. Hover a badge to read it. Agents run the same checks with `lint`.

| Rule | Flags |
|---|---|
| `isolated` | A part that isn't connected to anything |
| `single-target` | A load balancer with one target, a single point of failure |
| `one-sided` | A queue or topic with only one side connected |
| `public-datastore` | A datastore in a public network |
| `client-to-datastore` | Clients reaching a datastore with no service in between |
| `near-capacity`, `over-capacity` | A part at 80% or past 100% of its capacity |
| `unlinked-decision` | A decision not linked to any part |

## Bringing things in

Paste any of these onto the sheet, or drop the file itself. It becomes a new step for review, and it reuses the parts the design already has (same name), so a paste extends a design instead of copying into it. Whatever is left out is listed before anything is created. Agents do the same with `import_diagram`, and a new design can start from any of them.

| Source | What comes in |
|---|---|
| **Mermaid** flowchart | Nodes, arrows and subgraphs become parts, lines and boundaries. Styling (`classDef`, `style`) is ignored |
| **Mermaid** sequence | Participants and messages become parts, lines and a flow |
| **Mermaid** C4, architecture-beta, **C4-PlantUML** | People, containers, stores and boundaries |
| **draw.io** (`.drawio`, or shapes copied out of it) | Keeps the arrangement. Shapes are typed from their icon (AWS, Azure, GCP and Kubernetes libraries) or shape (actor, cylinder). A shape holding others, nested or drawn around them, becomes a boundary. Compressed files are read, first page only |
| **Structurizr DSL** | Read at container level. A software system with containers becomes a boundary around them, groups become boundaries, a component's relationships move to its container, dynamic views become flows |
| **docker-compose** | Services become parts typed from their image. `depends_on` and environment values that address another service become lines. More than one network becomes boundaries |
| **Kubernetes** manifests | Workloads become parts. Ingress backends and service addresses become lines. More than one namespace becomes boundaries. Kinds that draw nothing (ConfigMap, Secret…) are listed. Render Helm first with `helm template` |
| **Terraform** (`terraform show -json`, state or saved plan) | Known resources on AWS, GCP and Azure become parts. `depends_on` and, in a plan, configuration references become lines, also through undrawn resources: a load balancer reaches its services through listeners and target groups, a queue its consumer through the event source mapping. More than one module becomes boundaries. IAM, security groups and other plumbing are listed as left out |
| **CloudFormation** / **CDK** | YAML with `!Ref`, `!GetAtt`, `!Sub`, or JSON, so `cdk synth` output too, where parts take their construct names. Each resource maps to its Terraform counterpart |
| **Pulumi** (`pulumi stack export`) | AWS, Google Cloud, Azure classic and the common azure-native types. Component resources become nested boxes around what they hold |
| **Backstage** catalog | Components and Resources become parts with descriptions and source links, Systems become boundaries inside their Domains, `dependsOn` becomes lines, and an API one component provides and another consumes becomes a line named after the API |
| **OpenAPI** | Adds the service with its endpoints in its description, or fills in the description of the service already drawn under that name, plus the sign-in provider its OAuth or OpenID Connect schemes name and its webhooks |
| **AsyncAPI** 2.x, 3.x | Adds the application and each channel as a queue, topic or stream, from the server protocol, with async lines for what it sends and receives |
| **Traces** (OTLP JSON, one object per line, or a Jaeger JSON download) | Services become parts. Client spans to databases, queues and outside hosts add those, typed from `db.system` and `messaging.system`. Calls become lines with the measured rate and one-way latency (half the caller's median). Queue hops are async. Each kind of request becomes a flow walked from one sample trace |

Service-to-service lines in compose and Kubernetes also come from environment values: a URL, `host:port`, a cluster DNS name, or a variable named like `DB_HOST` or `API_URL`.

Where a source gives no type, part types come from shapes and names, head word first: "PostgreSQL" becomes SQL DB, "Kafka consumer" becomes worker.

Copied parts pasted back into the app keep every detail. A [plugin](#plugins) can add any other format.

## Taking things out

**Export** in the top bar:

| Format | Notes |
|---|---|
| PNG | The sheet as it looks now, at 2× resolution |
| SVG | Scalable, for docs and slides |
| Mermaid | Flowchart text for Markdown, GitHub, Notion |
| Decision record | Every decision with why, alternatives and cost, as Markdown |
| Structurizr DSL | C4 container level: users become people, third parties external systems, datastores and queues get their shapes, boundaries become groups |
| C4-PlantUML | Same model as Structurizr |
| draw.io | An editable file that keeps the sheet's positions |
| Shared HTML | One self-contained file, described below |

Agents get the text formats with `export_design`, and exporter [plugins](#plugins) appear in this menu too.

**Shared HTML** (or `system-design share <design id> [out.html]`) writes one file with the app and the design baked in, plus every design its parts open. It opens from disk or any static host, such as a PR attachment or GitHub Pages, with no server. Readers walk the steps, use the diff, play flows and open drill-downs; their changes stay in that tab. It is built from `dist/`, so in a clone run `npm run build` first, and again after app changes.

## Drift: design against reality

Check a design against the infrastructure it describes: compose, Kubernetes, Terraform JSON, CloudFormation, Pulumi, a Backstage catalog, OpenAPI, AsyncAPI or traces.

```bash
system-design drift <design id or .json path> <infra file>
```

It lists the parts and lines the infrastructure has and the design lacks, and the imported parts the infrastructure no longer has. It exits 1 when there are any, so it can fail a CI job.

- `--write` brings the design in line as one new step for review. Removals show in its diff and revert like any other.
- `--markdown` prints the report for a pull request.
- Agents do the same with `sync_infra` (`dry_run` to only look).

Imported parts remember where they came from, so renaming one in the design keeps it matched. Hand-drawn parts and parts from another file type are never removed.

With traces, drift also reports lines whose drawn qps or latency is missing or more than a quarter off what was measured (`~ line`), and flows seen in the traces (`+ flow`). Traces are a sample, so they never remove parts.

## Where designs are stored

Everything is a JSON file in your data folder, outside the app, so updating or reinstalling never touches your designs:

| System | Folder |
|---|---|
| Windows | `%APPDATA%\system-design\designs` |
| macOS | `~/Library/Application Support/system-design/designs` |
| Linux | `~/.local/share/system-design/designs` (or under `XDG_DATA_HOME`) |

Set `SYSTEM_DESIGN_DIR` to keep them elsewhere, for example in a repository to version them with git. Designs from older versions, which kept them in `designs/` next to the code, are copied over on first start, and the originals stay.

**Designs** in the design menu lists them all with search, and shows at start when there is no design to reopen. From there you can open, rename, copy, download as `.json`, add one from a `.json` file, or delete. Deleted designs go to a `.trash` folder and come back with **Restore**. The app reopens the design you last worked on.

Files are diffable, and each carries the format `version` it was written in. Older files are migrated when read, and a file from a newer version is refused rather than misread.

## Agents (MCP)

`mcp/server.ts` is a stdio MCP server over the same files. Inside this repository, Claude Code picks it up from `.mcp.json`. Elsewhere, add it as shown in [Quick start](#quick-start).

The server tells agents how to work: one reviewable change per step, a decision for every non-obvious choice, options when there is a real choice, `lint` after a step, and `get_feedback` before continuing a design.

| Tool | What it does |
|---|---|
| `list_designs` | Designs with their count of unreviewed steps |
| `list_templates` | Templates a design can start from |
| `get_design` | Read a full design |
| `create_design` | Create a design, empty or copied from a template |
| `update_design` | Change a design's title, description, repository or currency |
| `add_step` | **The main tool.** One reviewable change in a single write: components, connections, boundaries, notes, decisions, flows, or options to choose between |
| `add_component`, `connect`, `add_boundary`, `add_note`, `add_decision`, `add_flow` | Add one item to a step |
| `place_in` | Move a part or boundary into a boundary, or out of all of them |
| `update_component`, `update_connection` | Change an item. The change is recorded on the step, with old values, for review |
| `remove_item` | Remove an item, recorded on the step for review. A boundary's contents move to its parent |
| `pick_option` | Pick an option the reviewer told you about |
| `get_feedback` | Steps sent back, with their open comments |
| `resolve_feedback` | Mark feedback handled, with an optional reply. The steps return to the review queue |
| `lint` | Check for likely problems |
| `simulate_failure` | What breaks if a part goes down |
| `import_diagram` | Bring in a diagram or other source as a step |
| `sync_infra` | Compare with infrastructure files, and optionally sync as a step |
| `sync_adrs` | Write decisions to a records folder, or read records into a step |
| `export_design` | Mermaid, Structurizr, C4-PlantUML, draw.io, decisions, or a plugin format |

Run tool calls on one design one after another, not at the same time.

## Command line

`system-design help` lists the commands. From a clone, `npm run drift`, `npm run diff` and `npm run share` run the same code.

| Command | What it does | Exit code |
|---|---|---|
| `start` | Open the app | 1 if `dist/` is missing or the sign-in settings are incomplete |
| `mcp` | MCP server over stdio, for agents | |
| `drift <design> <infra file> [--write] [--markdown]` | Check a design against infrastructure | 0 no drift, 1 drift, 2 error |
| `diff <before.json> <after.json> [--markdown]` | What a change adds and removes, step by step. A missing or empty before file means a new design | 0, or 2 on error |
| `share <design id> [out.html]` | One self-contained HTML file | 1 on error |
| `adr <design> <folder> [--read]` | Write or read decision records | 2 on error |
| `merge <base> <ours> <theirs>` | Git merge driver | 1 on a real clash |
| `svg <design> <out.svg> [--badge <badge.svg>] [--infra <file>]` | Draw the design and a badge | 2 on error |

## Pull requests (GitHub Action)

The action checks a design against the repository's infrastructure files and keeps one comment on each pull request up to date: what the infrastructure has that the design lacks, and the reverse, and, when the pull request changes the design file, the steps, parts, lines and decisions it adds and the parts and lines it removes. The same report goes to the job summary. Keep the design in the repository: download it from **Designs**, or point `SYSTEM_DESIGN_DIR` at a folder in the repo.

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

| Input | Default | Meaning |
|---|---|---|
| `design` | required | Path of the design `.json` file |
| `infra` | empty | Files to check against, one per line |
| `comment` | `true` | Comment on pull requests; needs `pull-requests: write` |
| `fail-on-drift` | `false` | Fail the job when the design differs |
| `share` | `false` | Attach a read-only HTML copy to the run as `design-review`, and link it from the comment |
| `token` | `github.token` | Token used to comment |

The output `drifted` is `"true"` when the design differs from any file.

- A pull request with nothing to report gets no comment.
- Names from the files are shown as code and `@` mentions are defused, so a comment can't ping or link anyone.
- Pull requests from forks get a read-only token: the report still lands in the job summary, and the comment is skipped with a warning.
- A missing design file or an unreadable infrastructure file fails the job.

Locally, `system-design drift <design> <file> --markdown` and `system-design diff <before.json> <after.json> --markdown` print the same report. [`examples/shop`](examples/shop) is a design that leaves out the compose file's cache on purpose; this repository's CI runs the action on it.

## Decision records

`system-design adr <design> docs/adr` writes each decision as a Markdown record (`0001-use-postgresql.md`: status, the parts it affects, context, considered options, consequences), numbered after the folder's own. A marker in each file ties it to its decision, so running it again rewrites only what changed.

`--read` goes the other way: the folder's other records (Nygard or MADR, with the status in a section, a list item or front matter) come in as decisions in one step for review, linked to the parts they name. Rejected, deprecated and superseded ones are left out. Agents do the same with `sync_adrs`.

## Pictures for docs

```bash
system-design svg <design> docs/architecture.svg --badge docs/design-badge.svg
```

This draws the design (boundaries, parts, lines and their load; light and dark) and a badge with its part count and the steps waiting for review. With `--infra docker-compose.yml`, the badge says whether the design matches that file. Run it in CI or a pre-commit hook and commit the files, so a README or wiki shows the current design:

```markdown
![design](docs/design-badge.svg)
![architecture](docs/architecture.svg)
```

## Live load

Set `PROMETHEUS_URL` (Prometheus or anything with its query API: Mimir, Thanos, VictoriaMetrics) before `start`, and **Live** in the top bar replaces the designed numbers on the lines with measured ones every 15 seconds: requests per second, one-way latency (half the caller's median) and the share of failed calls. A line with 5% or more failures turns red.

It reads the service graph metrics (`traces_service_graph_*`) that the OpenTelemetry collector's servicegraph connector and Tempo write. A service matches the part whose **Links** has an `otel` entry with its name, else the part imported from its traces, else the part with its name. The button's tooltip lists the pairs no line matched. A metrics [plugin](#plugins) can feed Live too, with or without Prometheus.

## Connections

**Connections** in the design menu lists the webhooks, MCP servers, plugins, and the addresses other tools and agents use.

**Typed links.** Each part's **Links** holds references that tie it to the same thing elsewhere: `repo`, `docs`, `runbook`, `dashboard`, `ticket`, `owner`, `oncall`, `slo`, `otel`, `k8s`, `cloud`, `backstage` and `link`. Agents set them with `refs` on `add_component`, `add_step` and `update_component`.

**Deep links.** `#<design>/<item>` after the app's address opens a design with a part, line, step or decision selected. The address follows the selection, so any link can be pasted into a ticket or chat.

### API

The API is versioned under `/api/v1`, and `/api` stays as an alias. `/api/v1/openapi.json` is its OpenAPI 3.1 document, for generating a client or importing into Postman, n8n or Zapier, and `/api/v1/schema/design.json` is the JSON Schema of a design file. Both are built from the schemas the server validates with.

| Route | Purpose |
|---|---|
| `GET, POST /designs` | List; create blank, from a template, as a copy, or from a file |
| `GET, PUT, DELETE /designs/{id}` | Read, replace, move to the trash |
| `POST /designs/{id}/comments` | Add a review comment |
| `GET /designs/{id}/share` | Shared HTML |
| `GET /designs/{id}/live` | Measured load |
| `GET /designs/{id}/export/{exporter}` | Text from an exporter plugin |
| `GET /templates` | Templates |
| `GET /trash`, `POST /trash/{entry}` | Trash, and restoring from it |
| `GET, POST /hooks`, `DELETE /hooks/{hook}`, `POST /hooks/{hook}/test` | Webhooks |
| `GET /plugins`, `POST /plugins/read`, `POST /plugins/links` | Plugins |
| `GET /mcp`, `POST /mcp/queries`, `POST /mcp/run`, `POST /mcp/{server}/test` | MCP servers |
| `GET /events` | Server-sent events: `data: {"id": "<design>"}` whenever a design file changes |
| `GET /me` | Who is signed in to a hub |
| `POST /slack/actions` | Slack button clicks |

Request bodies are limited to 5 MB. A `PUT` with an out-of-date `rev` is refused with 409 rather than overwriting newer work.

### Webhooks

Webhooks get every change, whether made in the app, by an agent or by a command: one POST per write.

| Format | Sends |
|---|---|
| **CloudEvents** | A JSON array of [CloudEvents](https://cloudevents.io) (`application/cloudevents-batch+json`), each with `actor` (`app` or `agent`), a link to the item and the item itself |
| **Chat** | "New step in “Shop”: Add a cache. 2 waiting for review" to Slack, Discord or Teams, when an agent or a sync adds steps |
| **Slack** | New steps from agents with Approve and Send back buttons, at most 10 per message. See [From Slack](#working-as-a-team) |

Event types are `system-design.` followed by:

| Group | Types |
|---|---|
| `design.*` | `created`, `changed`, `deleted`, `restored` |
| `step.*` | `added`, `removed`, `approved`, `reopened`, `sent_back` |
| `part.*`, `line.*`, `boundary.*`, `note.*`, `decision.*`, `flow.*` | `added`, `changed`, `removed` |
| `comment.*` | `added`, `resolved` |

- Moving things on the canvas sends nothing.
- A hook can be limited to event types, groups (`step.*`) and designs.
- With a secret of 8 or more characters, it carries `X-System-Design-Signature: sha256=<HMAC-SHA256 of the body>`.
- Network errors, 429 and 5xx are retried twice, after 1 and 4 seconds. A webhook that fails never fails the write.
- Hooks live in `hooks.json` in the user's app folder (`SYSTEM_DESIGN_HOOKS` moves it), never next to the designs, so secrets stay out of git. Manage them in the dialog or at `/api/v1/hooks`, which never returns secrets.
- `SYSTEM_DESIGN_WEBHOOK` still works as a chat hook for new steps, and `SYSTEM_DESIGN_URL` sets the links' address (default `http://127.0.0.1:5180`).

## Working as a team

**In git.** Keep design files in the repository, and the [action](#pull-requests-github-action) reports each pull request's changes. Every save moves `rev`, so two branches that change a design would always clash. This merge driver merges them item by item instead, and leaves a real clash (both sides changed the same field) as a normal git conflict. Each clone runs:

```bash
git config merge.system-design.driver "npx -y github:oplosy/system-design merge %O %A %B"
```

and the repository's `.gitattributes` names the files:

```
docs/architecture.json merge=system-design
```

**On a shared server (hub).** Point one server at the team's OpenID Connect provider (Google, Okta, Entra ID, Keycloak…) and everyone reviews the same designs in the browser, with live updates, concurrent edits merged and their name on each comment. Register `<SYSTEM_DESIGN_URL>/auth/callback` as the redirect address, then set these before `start`:

| Variable | Value |
|---|---|
| `SYSTEM_DESIGN_OIDC_ISSUER` | The provider's issuer URL |
| `SYSTEM_DESIGN_OIDC_CLIENT_ID`, `SYSTEM_DESIGN_OIDC_CLIENT_SECRET` | From registering the app with the provider |
| `SYSTEM_DESIGN_URL` | The hub's public address, `https` unless it is local |
| `SYSTEM_DESIGN_ALLOWED` | Who gets in, comma-separated: `ann@example.com, @example.com` |
| `SYSTEM_DESIGN_EDITORS` | Optional, same form: who may change things. Everyone else allowed in can view and comment |
| `SYSTEM_DESIGN_SESSION_SECRET` | Optional, 32+ characters: keeps people signed in across restarts, and lets several servers share sessions |

Start it with `HOST=0.0.0.0` behind a TLS proxy that keeps the `Host` header, since the API refuses writes whose origin doesn't match it. A half-finished configuration refuses to start.

| Who | Can do |
|---|---|
| Not signed in | Nothing. Pages lead to sign-in, and the API answers 401 |
| Signed in, not in `SYSTEM_DESIGN_ALLOWED` | Nothing. Refused at sign-in |
| Viewer | Walk steps, comment, try changes on the sheet. Only comments are saved |
| Editor (everyone allowed, when there is no editors list) | Everything except webhooks and MCP servers |
| The machine's owner, on disk | Webhooks, MCP servers and plugins, since they hold the host's secrets or run as code |

ID tokens are checked against the provider's published keys (RS256 or ES256), along with issuer, audience, expiry and nonce, and the sign-in uses PKCE. An unverified email is refused. An address with `#design/item` still opens that item after sign-in. Sessions last 12 hours; without a session secret they end when the server restarts. The server sets the name on each new comment from the session, and keeps it on saved ones, so a comment's author can't be forged. Without these variables nothing changes.

**From Slack.** A webhook in the **Slack** format posts new steps from agents with Approve and Send back buttons. Create a Slack app, enable Interactivity with the request address `<SYSTEM_DESIGN_URL>/api/v1/slack/actions`, and set `SYSTEM_DESIGN_SLACK_SECRET` to the app's signing secret. The server must be reachable from Slack. The signature is what's checked, and it must be under 5 minutes old, so everyone in that channel can review, whatever `SYSTEM_DESIGN_EDITORS` says. An agent reads a send-back as a comment.

**Without the app.** `share: true` on the [action](#pull-requests-github-action) attaches a read-only HTML copy of the design to the run as `design-review`, and links the run from the pull request comment.

## MCP servers

This is the other direction from [Agents](#agents-mcp): the app asks the MCP servers you already run (GitHub, Jira, Datadog and so on) about a part, right in its panel. List them in `mcp-servers.json` in the user's app folder (`SYSTEM_DESIGN_MCP` moves it). It takes the usual `mcpServers` shape, so entries can be copied from another client, plus `queries`:

```json
{
  "mcpServers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ${GITHUB_TOKEN}" },
      "queries": [{ "title": "Open pull requests", "tool": "search_pull_requests", "args": { "query": "repo:{repo} is:open" } }]
    },
    "tickets": {
      "command": "node",
      "args": ["examples/mcp/tickets-server.mjs", "stdio"],
      "queries": [{ "title": "Open tickets", "tool": "list_tickets", "args": { "service": "{label}" } }]
    }
  }
}
```

A query names a tool and its arguments. Strings may hold `{id}`, `{label}`, `{tech}`, `{tag}` (the first tag) or a link kind such as `{repo}` or `{otel}`, filled from the part. A part shows only the queries it has everything for, and a query runs when you click it. `${NAME}` in `url`, `headers`, `args` and `env` comes from the environment, so tokens need not sit in the file.

Access is read-only by default: a tool is called only if it declares `readOnlyHint`, or if its server's `allow` list names it. Answers are shown as plain text, at most 20,000 characters, are never acted on, and a call gives up after 15 seconds. The file can run commands, so it can only be edited on disk, never through a design or the API. **Connections** shows the servers and tests each one; `/api/v1/mcp` gives the same, without commands, addresses or headers. Servers using OAuth, or the older SSE transport, aren't supported yet. Restart after editing the file.

## Plugins

A plugin teaches the app a new format, metric source or link target with no change here. It is one JavaScript module (`.mjs` or `.js`) in the `plugins` folder of the user's app folder (`SYSTEM_DESIGN_PLUGINS` moves it), and the app and the MCP server load it when they start. Plugins run as code with your rights, so they load from that folder only, never from a design, a repository or the API. Add only what you trust. [`examples/plugins/service-list.mjs`](examples/plugins/service-list.mjs) has one of each kind:

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

- **Importers** are asked first, for anything pasted, dropped, given to a new design or sent to `import_diagram`. `read` returns `{ nodes: [{ key, label?, type?, tech?, description?, group? }], groups?: [{ key, label, parent?, kind? }], edges?: [{ from, to, label?, async? }], flows?: [{ title, path }], leftOut?: [] }`. The result is checked, and comes in as a step for review like any import.
- **Exporters** appear in the **Export** menu, in `export_design` as `<plugin>.<id>`, and at `/api/v1/designs/<id>/export/<plugin>.<id>`.
- **Metrics** feed **Live**, alongside Prometheus if it is set. Each list holds `{ client, server, value }`, matched to parts as in [Live load](#live-load): `qps` and `failed` per second, `latency` in round-trip seconds.
- **Links** turn a part's plain value of one kind (a ticket number) into the address it opens, or nothing.

**Connections** lists what is installed, and why a plugin that failed to load did; `/api/v1/plugins` gives the same. A plugin that fails to load leaves the others working. After adding or changing one, restart the app and the agent's MCP server. A call that takes more than 10 seconds is given up on, and a metrics source that fails leaves the others showing, with the failure in **Live**'s tooltip. The MCP server sends `console.log` to stderr, so stray logs can't reach its protocol; writing to `process.stdout` directly still would.

## Configuration

All settings are environment variables, and all are optional.

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `5180` | Server port |
| `HOST` | `127.0.0.1` | Address to listen on, and the host name the API answers to |
| `SYSTEM_DESIGN_DIR` | data folder | Where designs live |
| `SYSTEM_DESIGN_HOOKS` | `hooks.json` in the app folder | Webhook file |
| `SYSTEM_DESIGN_MCP` | `mcp-servers.json` in the app folder | MCP servers file |
| `SYSTEM_DESIGN_PLUGINS` | `plugins` in the app folder | Plugins folder |
| `SYSTEM_DESIGN_URL` | `http://127.0.0.1:5180` | The address used in links; on a hub, its public address |
| `SYSTEM_DESIGN_WEBHOOK` | | One chat hook for new steps |
| `SYSTEM_DESIGN_SLACK_SECRET` | | Slack app signing secret |
| `PROMETHEUS_URL` | | Turns on measured load |
| `SYSTEM_DESIGN_OIDC_*`, `SYSTEM_DESIGN_ALLOWED`, `SYSTEM_DESIGN_EDITORS`, `SYSTEM_DESIGN_SESSION_SECRET` | | [Hub](#working-as-a-team) sign-in |

The app folder is the parent of the data folder: `%APPDATA%\system-design` on Windows, and likewise on the others.

## What happens when…

| Situation | Result |
|---|---|
| You and an agent edit the same design | Your edits are replayed onto the agent's version. On the same field yours wins, and a message says which |
| An API client saves an old `rev` | Refused with 409 |
| Two branches change one design | The merge driver merges by item. Both changing the same field is a git conflict |
| A file comes from a newer version | Refused, with a request to update the app |
| A file comes from an older version | Migrated when read |
| A design is deleted | Moved to `.trash`, restorable from **Designs** |
| An agent edits a step you already reviewed | The step reopens for review, with old values shown |
| A step has unpicked options | It can't be marked seen |
| An import has things it can't draw | They are listed before anything is created |
| A webhook endpoint is down | Retried twice, then dropped. The write still succeeds |
| A plugin fails to load | The others keep working, and **Connections** says why |
| A plugin call hangs | Given up on after 10 seconds, unless it blocks the event loop |
| An MCP server's tool isn't marked read-only | It isn't called, unless the `allow` list names it |
| The app is on a non-local `HOST` with no sign-in | The server warns at start |
| Sign-in settings are incomplete | The server refuses to start |
| The server restarts with no session secret | Everyone signs in again |
| A pull request comes from a fork | The report goes to the job summary, and the comment is skipped |
| A shared HTML reader changes something | It stays in that tab |

## Security

- **Local by default.** The server listens on `127.0.0.1`. It answers only requests addressed to this machine or to `HOST`, and refuses writes from other sites.
- **No sign-in without a hub.** On a non-local `HOST` with no sign-in, anyone who reaches the server can read and change designs.
- **Files that run code stay on disk.** Plugins and `mcp-servers.json` can't be set through a design, a repository, the API or the app.
- **Secrets.** Webhook secrets are in `hooks.json`, outside the designs folder, and are never returned by the API. Tokens for MCP servers can come from `${NAME}` in the environment. Keep the app folder private, and never commit `hooks.json` or `mcp-servers.json`.
- **Slack clicks** are checked by signature, and only `hooks.slack.com` gets a reply.
- **Pull request comments** defuse mentions and show file names as code.

## Known limits

- **Not tried against the real thing:** Slack, a real OpenID Connect provider, a TLS proxy, and real GitHub, Jira or Datadog MCP servers. Slack clicks, sign-in and MCP were tested with local stand-ins that follow the same protocols; a TLS proxy was not tested at all.
- **Slack approval** belongs to everyone in the channel, not to `SYSTEM_DESIGN_EDITORS`.
- **Webhooks** have no durable queue: an event that fails its retries is lost, including across a restart.
- **Secrets** in `hooks.json` and `mcp-servers.json` are plain text on disk.
- **`readOnlyHint`** is the MCP server's own claim. A server that lies about it isn't caught.
- **Plugins** can't be stopped if they block the event loop, since they run in the app's process.
- **MCP servers** using OAuth or the older SSE transport aren't supported.
- **Phone width** has no layout of its own. At about 375px wide the parts and details panels open over each other; hide one with the buttons in the top bar. The app is meant for a desktop window.
- **Imports:** draw.io reads the first page only, Helm needs rendering first, and Structurizr is read at container level.

## Layout of this repository

| Path | What |
|---|---|
| `core/` | Schema (zod), file store, shared edit functions, imports and exports, plugins, MCP client, tests |
| `server/api.ts` | JSON API and change events, mounted in the Vite dev server |
| `server/main.ts` | Production server: the built app from `dist/` plus the API |
| `server/auth.ts` | Hub sign-in and permissions |
| `server/openapi.ts` | OpenAPI document |
| `server/share.ts` | Builds the shared HTML file |
| `cli/` | The `system-design` command (`main.ts`): drift, diff, share, decision records, merge, SVG and badge; built to `dist-cli/` |
| `action.yml`, `action/` | GitHub Action for pull requests |
| `examples/` | Example design and compose file the action is tested on, an example plugin and an example MCP server |
| `mcp/server.ts` | MCP server for agents |
| `src/` | React Flow canvas, shapes, panels |
| `templates/` | Starting designs |
| `designs/` | Where designs lived before the data folder; read once to copy them over, then ignored |

## Development

Requires Node 24+, which runs TypeScript directly.

```bash
npm test
npm run typecheck
npm run build
npm run build:cli
```

To release, set `version` in `package.json`, commit, and push a matching tag (`git tag v1.1.0 && git push origin v1.1.0`). The release workflow runs the checks, publishes to npm when the `NPM_TOKEN` secret (an npm automation token) is set, and moves the major tag (`v1`) that action users pin to.

## License

MIT
