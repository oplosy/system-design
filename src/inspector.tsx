import { BOUNDARY_KINDS, COMPONENT_TYPES, CONNECTION_KINDS, type ConnectionKind, type Design } from '../core/schema.ts';
import { codeUrl, costAt, money, stepCostChange } from '../core/export.ts';
import { failureImpact, loadOf } from '../core/lint.ts';
import * as m from '../core/mutations.ts';
import { BOUNDARY_SPECS } from './boundaries.ts';
import { GROUPS, SHAPES } from './shapes.ts';
import { type FlowAt, type Change, Prop, Ed, Num, RefsEditor, Connected, InsideSelect, RELATION_NAMES } from './fields.tsx';
import { BoundaryPreview, ShapePreview } from './palette.tsx';
import { Select } from './select.tsx';
import { Flows } from './flows.tsx';
import { Comments } from './bars.tsx';
import { asDetail, asTitle } from './format.ts';
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
    <button key={id} className="ref" onClick={() => onSelect(id)}>
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
          <button className="icon-btn close" onClick={() => onSelect(null)} aria-label="Close" title="Close (Esc)">
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
                  <button className="ref" onClick={() => onOpenInside(component)} title="Open the design of what is inside">
                    {designs.find((x) => x.id === component.detail)?.title ?? component.detail}
                  </button>
                  <button className="text-btn" onClick={() => edit((d: Design) => d.components, { detail: undefined })}>
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
              <button role="radio" aria-checked={!connection.async} onClick={() => edit((d: Design) => d.connections, { async: undefined })}>
                <Icon name="sync" />
                Sync
              </button>
              <button role="radio" aria-checked={!!connection.async} onClick={() => edit((d: Design) => d.connections, { async: true })}>
                <Icon name="async" />
                Async
              </button>
            </div>
          </Prop>
          <Prop label="Line">
            <div className="toggle" role="radiogroup" aria-label="Line">
              {(['curve', 'straight', 'elbow'] as const).map((r) => (
                <button key={r} role="radio" aria-checked={(connection.route ?? 'curve') === r} onClick={() => edit((d: Design) => d.connections, { route: r === 'curve' ? undefined : r, bend: undefined })}>
                  <Icon name={r as IconName} />
                  {r[0].toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
            {connection.bend !== undefined && (
              <button className="text-btn" onClick={() => edit((d: Design) => d.connections, { bend: undefined })}>
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
        <button className="text-btn danger" onClick={() => onDelete(item.id)}>
          <Icon name="trash" />
          Delete
        </button>
      </footer>
    </aside>
  );
}

/** One step: what it says, what it changed, and everything a reviewer does with it. */
export function StepDetails({
  design,
  stepId,
  diff,
  onDiff,
  flow,
  onFlow,
  recording,
  onRecording,
  onSequence,
  inOption,
  optionView,
  onOption,
  onPickOption,
  change,
  onSelect,
}: {
  design: Design;
  stepId: string;
  diff: boolean;
  onDiff: () => void;
  flow: FlowAt | null;
  onFlow: (f: FlowAt | null) => void;
  recording: string[] | null;
  onRecording: (r: string[] | null) => void;
  onSequence: (id: string) => void;
  /** Whether an item belongs to the option on the sheet (always true without options). */
  inOption: (x: { step: string; option?: string }) => boolean;
  optionView: Record<string, string>;
  onOption: (step: string, option: string) => void;
  onPickOption: (step: string, option: string) => void;
  change: Change;
  onSelect: (id: string | null) => void;
}) {
  const labelOf = (id: string) => [...design.components, ...design.boundaries].find((c) => c.id === id)?.label;
  const fieldText = (field: string, v: string | undefined) => (v === undefined ? 'None' : field === 'boundary' || field === 'parent' ? (labelOf(v) ?? v) : v);
  const stepNo = (id: string) => design.steps.findIndex((s) => s.id === id) + 1;
  const step = design.steps.find((s) => s.id === stepId)!;
  const decisions = design.decisions.filter((x) => x.step === stepId && inOption(x));
  const notes = design.notes.filter((n) => n.step === stepId && inOption(n));
  const components = design.components.filter((c) => c.step === stepId && inOption(c));
  const boundaries = design.boundaries.filter((b) => b.step === stepId && inOption(b));
  const viewed = optionView[stepId] ?? step.options?.[0].id;
  const at = stepNo(stepId);
  const changes = design.steps.slice(0, at).map((s) => stepCostChange(design, s.id, inOption));
  const sofar = changes.reduce((t, c) => t + c, 0);
  const delta = changes[at - 1];
  return (
    <aside className="inspector" aria-label="Step details">
      <header className="step-head">
        <div className="step-lead">
          {step.summary && <p className="insp-lead">{step.summary}</p>}
          {changes.some((c) => c !== 0) && (
            <p className="insp-cost">
              {money(sofar, design.currency)} a month so far{delta !== 0 && <>, {delta > 0 ? '+' : '−'}{money(Math.abs(delta), design.currency)} in this step</>}
            </p>
          )}
        </div>
        <button className="chip" aria-pressed={diff} onClick={onDiff} title="Outline what this step added or changed, show what it removed, and dim the rest">
          <Icon name="diff" />
          Show changes
        </button>
      </header>

      <div className="step-cols">
        {(step.options || decisions.length > 0 || notes.length > 0) && (
          <div className="step-col">
            {step.options && (
              <section className="insp-sec">
                <h3 className="rule-head"><Icon name="layers" />Options</h3>
                {step.options.map((o) => {
                  const on = o.id === viewed;
                  return (
                    <div key={o.id} className={`option-entry${on ? ' on' : ''}`}>
                      <button className="list-row" aria-pressed={on} onClick={() => onOption(stepId, o.id)} title="Show this option on the sheet">
                        <span className="flow-play" aria-hidden="true">
                          {on ? '●' : '○'}
                        </span>
                        <span className="list-main">{o.title}</span>
                        <span className="list-meta">{design.components.filter((c) => c.option === o.id && c.step === stepId).length} parts</span>
                      </button>
                      {o.summary && <p className="option-why">{o.summary}</p>}
                      {on && (
                        <div className="flow-steps">
                          <button className="btn ink" onClick={() => onPickOption(stepId, o.id)}>
                            <Icon name="check" />
                            Pick {o.title}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            {decisions.length > 0 && (
              <section className="insp-sec">
                <h3 className="rule-head"><Icon name="branch" />Decisions</h3>
                {decisions.map((x) => (
                  <button key={x.id} className="decision-entry" onClick={() => onSelect(x.id)}>
                    <span className="decision-body">
                      <strong>{asTitle(x.title)}</strong>
                      <span className="decision-why">{asDetail(x.why)}</span>
                      {x.alternatives?.length ? (
                        <span className="decision-line">
                          <em>Instead of</em> {x.alternatives.join(', ')}
                        </span>
                      ) : null}
                      {x.tradeoffs && (
                        <span className="decision-line">
                          <em>Cost</em> {x.tradeoffs}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </section>
            )}

            {notes.length > 0 && (
              <section className="insp-sec">
                <h3 className="rule-head"><Icon name="note" />Notes</h3>
                {notes.map((n) => (
                  <button key={n.id} className="note-entry" onClick={() => onSelect(n.id)}>
                    {asDetail(n.text)}
                  </button>
                ))}
              </section>
            )}
          </div>
        )}

        <div className="step-col">
          {components.length + boundaries.length > 0 && (
            <section className="insp-sec">
              <h3 className="rule-head"><Icon name="plus" />Added</h3>
              {boundaries.map((b) => (
                <button key={b.id} className="list-row" onClick={() => onSelect(b.id)}>
                  <BoundaryPreview kind={b.kind} />
                  <span className="list-text">
                    <span className="list-main">{asTitle(b.label)}</span>
                    <span className="list-meta">{asDetail(b.detail ?? BOUNDARY_SPECS[b.kind].name)}</span>
                  </span>
                </button>
              ))}
              {components.map((c) => (
                <button key={c.id} className="list-row" onClick={() => onSelect(c.id)}>
                  <ShapePreview type={c.type} width={30} height={20} />
                  <span className="list-text">
                    <span className="list-main">{asTitle(c.label)}</span>
                    {c.tech && <span className="list-meta">{asDetail(c.tech)}</span>}
                  </span>
                </button>
              ))}
            </section>
          )}

          {!!step.changed?.length && (
            <section className="insp-sec">
              <h3 className="rule-head"><Icon name="sketch" />Changed</h3>
              {step.changed.map((c) => (
                <button key={`${c.id}:${c.field}`} className="list-row change-row" onClick={() => onSelect(c.id)} disabled={!labelOf(c.id)}>
                  <span className="list-main">
                    {labelOf(c.id) ?? c.id} <span className="quiet">{c.field}</span>
                  </span>
                  <span className="list-meta">
                    <s>{fieldText(c.field, c.from)}</s> → {fieldText(c.field, c.to)}
                  </span>
                </button>
              ))}
            </section>
          )}

          {!!step.removed?.length && (
            <section className="insp-sec">
              <h3 className="rule-head"><Icon name="minus" />Removed</h3>
              {step.removed.map((r) => (
                <div key={r.id} className="list-row removed-row">
                  {r.type && <ShapePreview type={r.type} width={30} height={20} />}
                  <s className="list-main">{r.label}</s>
                </div>
              ))}
            </section>
          )}

          <Flows design={design} inOption={inOption} stepId={stepId} flow={flow} onFlow={onFlow} recording={recording} onRecording={onRecording} onSequence={onSequence} change={change} />

          <Comments design={design} step={stepId} change={change} onSelect={onSelect} />

          <footer className="insp-foot">
            <button
              className="text-btn danger"
              title="Remove everything this step added (Ctrl+Z brings it back)"
              onClick={() =>
                confirm(`Revert step ${stepNo(step.id)} “${step.title}”? Everything it added is removed.${design.steps.length > 1 ? ' The step goes too.' : ''}`) &&
                change((d) => m.revertStep(d, stepId))
              }
            >
              <Icon name="undo" />
              Revert step
            </button>
          </footer>
        </div>
      </div>
    </aside>
  );
}
