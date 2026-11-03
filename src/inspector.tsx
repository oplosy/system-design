import { BOUNDARY_KINDS, COMPONENT_TYPES, CONNECTION_KINDS, type ConnectionKind, type Design } from '../core/schema.ts';
import { codeUrl, costAt, money } from '../core/export.ts';
import { failureImpact, loadOf } from '../core/lint.ts';
import * as m from '../core/mutations.ts';
import { BOUNDARY_SPECS } from './boundaries.ts';
import { GROUPS, SHAPES } from './shapes.ts';
import { type Change, Prop, Ed, Num, RefsEditor, Connected, InsideSelect, RELATION_NAMES } from './fields.tsx';
import { BoundaryPreview, ShapePreview } from './palette.tsx';
import { Select } from './select.tsx';
import { Comments } from './bars.tsx';
import { Icon, type IconName } from './icons.tsx';

// The "Opens" choice that starts a new design; a design id is a slug, so it can't clash.
const NEW_INSIDE = '+new';

export function Inspector({
  design,
  selected,
  stepId,
  inOption,
  designs,
  onOpenInside,
  onCreateInside,
  change,
  onSelect,
  onDelete,
}: {
  design: Design;
  selected: string | null;
  stepId: string;
  /** Whether an item belongs to the option on the sheet (always true without options). */
  inOption: (x: { step: string; option?: string }) => boolean;
  designs: { id: string; title: string }[];
  onOpenInside: (c: Design['components'][number]) => void;
  onCreateInside: (componentId: string) => void;
  change: Change;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const component = design.components.find((c) => c.id === selected);
  const connection = design.connections.find((c) => c.id === selected);
  const note = design.notes.find((n) => n.id === selected);
  const decision = design.decisions.find((x) => x.id === selected);
  const boundary = design.boundaries.find((b) => b.id === selected);
  const item = component ?? connection ?? note ?? decision ?? boundary;
  // The design as the sheet shows it at this step, so load and failure match what is drawn (and what lint flags).
  const idx = m.stepIndex(design);
  const onSheet = <T extends { step: string; option?: string }>(xs: T[]) => xs.filter((x) => idx.get(x.step)! <= idx.get(stepId)! && inOption(x));
  const sheet = { ...design, components: onSheet(design.components), connections: onSheet(design.connections), flows: onSheet(design.flows) };
  const labelOf = (id: string) => [...design.components, ...design.boundaries].find((c) => c.id === id)?.label;
  const placeIn = (to: string | undefined) => change((d) => selected && m.placeIn(d, selected, to));
  const stepNo = (id: string) => design.steps.findIndex((s) => s.id === id) + 1;
  const stepTitle = (id: string) => design.steps.find((s) => s.id === id)?.title;
  const ref = (id: string) => (
    <button type="button" key={id} className="ref" onClick={() => onSelect(id)}>
      {labelOf(id) ?? id}
    </button>
  );
  const edit = <T extends { id: string }>(list: (d: Design) => T[], patch: Partial<NoInfer<T>>) =>
    change((d) => {
      const x = list(d).find((i) => i.id === selected);
      if (x) Object.assign(x, patch);
    });

  if (!item) return null;

  const costEditedAfter = component && design.steps.slice(stepNo(stepId)).find((t) => t.changed?.some((x) => x.id === component.id && x.field === 'cost'))?.id;
  const kind = component ? SHAPES[component.type].name : boundary ? BOUNDARY_SPECS[boundary.kind].name : connection ? 'Connection' : note ? 'Note' : 'Decision';
  const addedIn = (
    <Prop label="Step">
      {stepNo(item.step)}. {stepTitle(item.step)}
    </Prop>
  );
  return (
    <aside className="inspector" key={item.id} aria-label="Selected item">
      <header className="insp-head">
        <div className="insp-tagline">
          <span className="tag" title={item.id}>
            {kind}
          </span>
          <button type="button" className="icon-btn close" onClick={() => onSelect(null)} aria-label="Close" title="Close (Esc)">
            <Icon name="close" />
          </button>
        </div>
        {component && <Ed label="Label" required className="ed-title" value={component.label} onCommit={(v) => edit((d: Design) => d.components, { label: v })} />}
        {decision && <Ed label="Title" required multiline className="ed-title" value={decision.title} onCommit={(v) => edit((d: Design) => d.decisions, { title: v })} />}
        {boundary && <Ed label="Label" required className="ed-title" value={boundary.label} onCommit={(v) => edit((d: Design) => d.boundaries, { label: v })} />}
        {connection && (
          <h2 className="insp-title route">
            {ref(connection.from)}
            <span className="route-arrow">→</span>
            {ref(connection.to)}
          </h2>
        )}
      </header>

      {component && (
        <>
          <section className="insp-sec">
            <h3 className="rule-head"><Icon name="info" />General</h3>
            <Prop label="Type">
              <Select
                label="Type"
                value={component.type}
                onChange={(type) => edit((d: Design) => d.components, { type })}
                options={GROUPS.flatMap((g) => COMPONENT_TYPES.filter((t) => SHAPES[t].group === g.key).map((t) => ({ value: t, label: SHAPES[t].name, group: g.title, preview: <ShapePreview type={t} width={30} height={20} /> })))}
              />
            </Prop>
            <Prop label="Technology">
              <Ed label="Technology" value={component.tech} onCommit={(v) => edit((d: Design) => d.components, { tech: v })} />
            </Prop>
            {design.boundaries.length > 0 && (
              <Prop label="Inside">
                <InsideSelect design={design} value={component.boundary} onPick={placeIn} />
              </Prop>
            )}
            {addedIn}
            <Prop label="Description" wide>
              <Ed label="Description" multiline value={component.description} onCommit={(v) => edit((d: Design) => d.components, { description: v })} />
            </Prop>
          </section>

          <section className="insp-sec">
            <h3 className="rule-head"><Icon name="cost" />Cost and load</h3>
            <Prop label="Cost">
              {costEditedAfter ? (
                // A later step changed it; editing here would overwrite that change.
                <span>
                  {(() => {
                    const at = costAt(design, component, stepId);
                    return at === undefined ? 'None' : `${money(at, design.currency)} a month`;
                  })()}
                  , changed in step {stepNo(costEditedAfter)}
                </span>
              ) : (
                // Recorded on the step on the sheet, so its cost change counts it; the step stays reviewed.
                <Num
                  label="Cost per month"
                  unit={`${design.currency ?? 'USD'} a month`}
                  value={component.cost}
                  onCommit={(v) => change((d) => m.updateTracked(d, component.id, { cost: v }, stepId, false))}
                />
              )}
            </Prop>
            <Prop label="Capacity">
              <Num label="Capacity" unit="rps" value={component.capacity} onCommit={(v) => edit((d: Design) => d.components, { capacity: v })} />
              {(() => {
                const { load, capacity } = loadOf(sheet, component.id);
                if (!load) return null;
                return <span className="prop-note">Gets {load} rps{capacity ? `, ${Math.round((load / capacity) * 100)}% used` : ''}</span>;
              })()}
            </Prop>
            {(() => {
              if (!sheet.connections.length) return null;
              const { flows, cutOff } = failureImpact(sheet, component.id);
              if (!flows.length && !cutOff.length) return null;
              return (
                <Prop label="If it fails" wide>
                  <span>
                    {flows.length > 0 && <>Breaks {flows.length > 1 ? 'flows' : 'flow'} {flows.map((f) => `“${f}”`).join(', ')}. </>}
                    {cutOff.length > 0 && <>Cuts off {cutOff.join(', ')}.</>}
                  </span>
                </Prop>
              );
            })()}
          </section>

          <section className="insp-sec">
            <h3 className="rule-head"><Icon name="link" />Links</h3>
            <Prop label="Tags">
              <Ed
                label="Tags"
                placeholder="Comma separated"
                value={component.tags?.join(', ')}
                onCommit={(v) => {
                  const tags = [...new Set((v ?? '').split(',').map((t) => t.trim()).filter(Boolean))];
                  edit((d: Design) => d.components, { tags: tags.length ? tags : undefined });
                }}
              />
            </Prop>
            <Prop label="Code">
              <Ed label="Code" placeholder="URL or path" value={component.code} onCommit={(v) => edit((d: Design) => d.components, { code: v })} />
              {/* Only web links open; anything else (javascript:, a path with no repo) stays text. */}
              {codeUrl(design, component.code) && (
                <a className="ref" href={codeUrl(design, component.code)} target="_blank" rel="noreferrer noopener" title="Open the code in a new tab">
                  Open
                </a>
              )}
            </Prop>
            <Prop label="Opens">
              {component.detail ? (
                <>
                  <button type="button" className="ref" onClick={() => onOpenInside(component)} title="Open the design of what is inside">
                    {designs.find((x) => x.id === component.detail)?.title ?? component.detail}
                  </button>
                  <button type="button" className="text-btn" onClick={() => edit((d: Design) => d.components, { detail: undefined })}>
                    <Icon name="unlink" />
                    Unlink
                  </button>
                </>
              ) : (
                <Select
                  label="Design that shows the inside"
                  value=""
                  onChange={(v) => {
                    if (v === NEW_INSIDE) onCreateInside(component.id);
                    else if (v) edit((d: Design) => d.components, { detail: v });
                  }}
                  options={[{ value: '', label: 'Nothing' }, { value: NEW_INSIDE, label: 'New design…' }, ...designs.filter((x) => x.id !== design.id).map((x) => ({ value: x.id, label: x.title }))]}
                />
              )}
            </Prop>
            <Prop label="Other links" wide>
              <RefsEditor refs={component.refs} onChange={(refs) => edit((d: Design) => d.components, { refs })} />
            </Prop>
            <Connected part={component} />
          </section>
        </>
      )}

      {boundary && (
        <section className="insp-sec">
          <h3 className="rule-head"><Icon name="info" />General</h3>
          <Prop label="Kind">
            <Select label="Kind" value={boundary.kind} onChange={(kind) => edit((d: Design) => d.boundaries, { kind })} options={BOUNDARY_KINDS.map((k) => ({ value: k, label: BOUNDARY_SPECS[k].name, preview: <BoundaryPreview kind={k} /> }))} />
          </Prop>
          <Prop label="Detail">
            <Ed label="Detail" value={boundary.detail} onCommit={(v) => edit((d: Design) => d.boundaries, { detail: v })} />
          </Prop>
          <Prop label="Inside">
            <InsideSelect design={design} value={boundary.parent} exclude={m.boundaryTree(design, boundary.id)} onPick={placeIn} />
          </Prop>
          {design.components.some((c) => c.boundary === boundary.id) && <Prop label="Holds">{design.components.filter((c) => c.boundary === boundary.id).map((c) => ref(c.id))}</Prop>}
          {addedIn}
          <Prop label="Description" wide>
            <Ed label="Description" multiline value={boundary.description} onCommit={(v) => edit((d: Design) => d.boundaries, { description: v })} />
          </Prop>
        </section>
      )}

      {connection && (
        <section className="insp-sec">
          <h3 className="rule-head"><Icon name="info" />General</h3>
          <Prop label="Label">
            <Ed label="Label" value={connection.label} onCommit={(v) => edit((d: Design) => d.connections, { label: v })} />
          </Prop>
          <Prop label="Relation">
            <Select<ConnectionKind | ''>
              label="Relation"
              value={connection.kind ?? ''}
              onChange={(v) => edit((d: Design) => d.connections, { kind: v || undefined })}
              options={[{ value: '', label: 'Arrow' }, ...CONNECTION_KINDS.map((k) => ({ value: k, label: RELATION_NAMES[k] }))]}
            />
          </Prop>
          <Prop label="Load">
            <Num label="Requests per second" unit="rps" value={connection.qps} onCommit={(v) => edit((d: Design) => d.connections, { qps: v })} />
          </Prop>
          <Prop label="Latency">
            <Num label="Latency" unit="ms" value={connection.latency} onCommit={(v) => edit((d: Design) => d.connections, { latency: v })} />
          </Prop>
          <Prop label="Mode">
            <div className="toggle" role="radiogroup" aria-label="Mode">
              <button type="button" role="radio" aria-checked={!connection.async} onClick={() => edit((d: Design) => d.connections, { async: undefined })}>
                <Icon name="sync" />
                Sync
              </button>
              <button type="button" role="radio" aria-checked={!!connection.async} onClick={() => edit((d: Design) => d.connections, { async: true })}>
                <Icon name="async" />
                Async
              </button>
            </div>
          </Prop>
          <Prop label="Line">
            <div className="toggle" role="radiogroup" aria-label="Line">
              {(['curve', 'straight', 'elbow'] as const).map((r) => (
                <button type="button" key={r} role="radio" aria-checked={(connection.route ?? 'curve') === r} onClick={() => edit((d: Design) => d.connections, { route: r === 'curve' ? undefined : r, bend: undefined })}>
                  <Icon name={r as IconName} />
                  {r[0].toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
            {connection.bend !== undefined && (
              <button type="button" className="text-btn" onClick={() => edit((d: Design) => d.connections, { bend: undefined })}>
                <Icon name="undo" />
                Reset bend
              </button>
            )}
          </Prop>
          {addedIn}
        </section>
      )}

      {decision && (
        <section className="insp-sec">
          <h3 className="rule-head"><Icon name="info" />General</h3>
          {decision.links.length > 0 && <Prop label="Affects">{decision.links.map(ref)}</Prop>}
          {addedIn}
          <Prop label="Why" wide>
            <Ed label="Why" required multiline value={decision.why} onCommit={(v) => edit((d: Design) => d.decisions, { why: v })} />
          </Prop>
          <Prop label="Instead of" wide>
            <Ed
              label="Alternatives"
              multiline
              placeholder="One per line"
              value={decision.alternatives?.join('\n')}
              onCommit={(v) => edit((d: Design) => d.decisions, { alternatives: v?.split('\n').map((s) => s.trim()).filter(Boolean) })}
            />
          </Prop>
          <Prop label="Cost" wide>
            <Ed label="Trade-offs" multiline value={decision.tradeoffs} onCommit={(v) => edit((d: Design) => d.decisions, { tradeoffs: v })} />
          </Prop>
        </section>
      )}

      {note && (
        <section className="insp-sec">
          <h3 className="rule-head"><Icon name="info" />General</h3>
          {note.attachTo && <Prop label="Attached to">{ref(note.attachTo)}</Prop>}
          {addedIn}
          <Prop label="Text" wide>
            <Ed label="Text" required multiline value={note.text} onCommit={(v) => edit((d: Design) => d.notes, { text: v })} />
          </Prop>
        </section>
      )}

      <Comments design={design} step={item.step} target={item.id} change={change} onSelect={onSelect} />

      <footer className="insp-foot">
        <button type="button" className="text-btn danger" onClick={() => onDelete(item.id)}>
          <Icon name="trash" />
          Delete
        </button>
      </footer>
    </aside>
  );
}
