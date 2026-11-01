# Design Structure Notes

How a recorded design is organized in the system-design tool.

## Structure

- `designs/` — recorded designs, one per project, keyed by id.
- `core/` — the shared model of components, connections, and steps.
- `server/` and `mcp/` — surfaces that read and write designs.
- `templates/` — starting points for new designs.

## Conventions

- One design per project; project folder name, lowercased-dashed, as the id.
- Every change lands as one step linked to affected components, carrying its decision (why, alternatives, trade-offs).
- Notes are for short explanations; decisions stay inside the step.

This file is orientation for new contributors — behavior details live with `core/`.
