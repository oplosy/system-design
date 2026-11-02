import { BOUNDARY_KINDS, COMPONENT_TYPES, CONNECTION_KINDS, type BoundaryKind, type ComponentType, type ConnectionKind, type Design } from '../core/schema.ts';
import { codeUrl, costAt, money, stepCostChange } from '../core/export.ts';
import { failureImpact, loadOf } from '../core/lint.ts';
import * as m from '../core/mutations.ts';
import { BOUNDARY_SPECS } from './boundaries.ts';
import { GROUPS, SHAPES } from './shapes.ts';
import { type FlowAt, type Change, Prop, Ed, CURRENCIES, Num, RefsEditor, Connected, InsideSelect, RELATION_NAMES, Block } from './fields.tsx';
import { pad } from './format.ts';
import { BoundaryPreview, ShapePreview } from './palette.tsx';
import { Flows } from './flows.tsx';
import { Comments } from './bars.tsx';

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
  return (
    <aside className="inspector" key={item.id}>
      <header className="insp-head">
        <div className="insp-tagline">
          <span className="tag">{kind}</span>
          <span className="mono quiet">{item.id}</span>
          <button className="text-btn close" onClick={() => onSelect(null)} title="Close">
            Close <kbd>Esc</kbd>
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
        {note && <h2 className="insp-title">Note</h2>}
      </header>

      <section className="insp-sec props">
        {component && (
          <>
            <Prop label="Type">
              <select className="ed" value={component.type} onChange={(e) => edit((d: Design) => d.components, { type: e.target.value as ComponentType })} aria-label="Type">
                {GROUPS.map((g) => (
                  <optgroup key={g.key} label={g.title}>
                    {COMPONENT_TYPES.filter((t) => SHAPES[t].group === g.key).map((t) => (
                      <option key={t} value={t}>
                        {SHAPES[t].name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Prop>
            <Prop label="Technology">
              <Ed label="Technology" placeholder="e.g. Redis" value={component.tech} onCommit={(v) => edit((d: Design) => d.components, { tech: v })} />
            </Prop>
            <Prop label="Cost">
              {costEditedAfter ? (
                // A later step changed it; editing here would overwrite that change.
                <span className="quiet">
                  {(() => {
                    const at = costAt(design, component, stepId);
                    return at === undefined ? '—' : `${money(at, design.currency)}/mo`;
                  })()}{' '}
                  · changed in step {pad(stepNo(costEditedAfter))}
                </span>
              ) : (
                // Recorded on the step on the sheet, so its cost change counts it; the step stays reviewed.
                <Num
                  label="Cost per month"
                  unit={`${design.currency ?? 'USD'}/mo`}
                  value={component.cost}
                  onCommit={(v) => change((d) => m.updateTracked(d, component.id, { cost: v }, stepId, false))}
                />
              )}
            </Prop>
            <Prop label="Tags">
              <Ed
                label="Tags"
                placeholder="e.g. payments, pii"
                value={component.tags?.join(', ')}
                onCommit={(v) => {
                  const tags = [...new Set((v ?? '').split(',').map((t) => t.trim()).filter(Boolean))];
                  edit((d: Design) => d.components, { tags: tags.length ? tags : undefined });
                }}
              />
            </Prop>
            <Prop label="Links">
              <RefsEditor refs={component.refs} onChange={(refs) => edit((d: Design) => d.components, { refs })} />
            </Prop>
            <Connected part={component} />
            <Prop label="Capacity">
              <Num label="Capacity" unit="req/s" value={component.capacity} onCommit={(v) => edit((d: Design) => d.components, { capacity: v })} />
              {(() => {
                const { load, capacity } = loadOf(sheet, component.id);
                if (!load) return null;
                return <span className="quiet">gets {load}{capacity ? ` · ${Math.round((load / capacity) * 100)}%` : ''}</span>;
              })()}
            </Prop>
            {sheet.connections.length > 0 && (
              <Prop label="If it fails">
                {(() => {
                  const { flows, cutOff } = failureImpact(sheet, component.id);
                  if (!flows.length && !cutOff.length) return <span className="quiet">No flow breaks and every part stays reachable.</span>;
                  return (
                    <span>
                      {flows.length > 0 && <>Breaks {flows.length > 1 ? 'flows' : 'flow'} {flows.map((f) => `“${f}”`).join(', ')}. </>}
                      {cutOff.length > 0 && <>Cuts off {cutOff.join(', ')}.</>}
                    </span>
                  );
                })()}
              </Prop>
            )}
            <Prop label="Code">
              <Ed label="Code" placeholder={design.repo ? 'Path in the repo or URL' : 'URL, or a path once the design has a repo'} value={component.code} onCommit={(v) => edit((d: Design) => d.components, { code: v })} />
              {/* Only web links open; anything else (javascript:, a path with no repo) stays text. */}
              {codeUrl(design, component.code) && (
                <a className="ref" href={codeUrl(design, component.code)} target="_blank" rel="noreferrer noopener" title="Open the code in a new tab">
                  Open ↗
                </a>
              )}
            </Prop>
            {design.boundaries.length > 0 && (
              <Prop label="Inside">
                <InsideSelect design={design} value={component.boundary} onPick={placeIn} />
              </Prop>
            )}
            <Prop label="Opens">
              {component.detail ? (
                <>
                  <button className="ref" onClick={() => onOpenInside(component)} title="Open the design of what is inside">
                    {designs.find((x) => x.id === component.detail)?.title ?? component.detail} ↗
                  </button>
                  <button className="text-btn" onClick={() => edit((d: Design) => d.components, { detail: undefined })}>
                    Unlink
                  </button>
                </>
              ) : (
                <>
                  <select className="ed" value="" onChange={(e) => e.target.value && edit((d: Design) => d.components, { detail: e.target.value })} aria-label="Design that shows the inside">
                    <option value="">Nothing</option>
                    {designs
                      .filter((x) => x.id !== design.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.title}
                        </option>
                      ))}
                  </select>
                  <button className="text-btn" onClick={() => onCreateInside(component.id)} title="Start an empty design for what is inside and open it">
                    New inside
                  </button>
                </>
              )}
            </Prop>
          </>
        )}
        {boundary && (
          <>
            <Prop label="Kind">
              <select className="ed" value={boundary.kind} onChange={(e) => edit((d: Design) => d.boundaries, { kind: e.target.value as BoundaryKind })} aria-label="Kind">
                {BOUNDARY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {BOUNDARY_SPECS[k].name}
                  </option>
                ))}
              </select>
            </Prop>
            <Prop label="Detail">
              <Ed label="Detail" placeholder="e.g. 10.0.1.0/24, VLAN 20, us-east-1" value={boundary.detail} onCommit={(v) => edit((d: Design) => d.boundaries, { detail: v })} />
            </Prop>
            <Prop label="Inside">
              <InsideSelect design={design} value={boundary.parent} exclude={m.boundaryTree(design, boundary.id)} onPick={placeIn} />
            </Prop>
            <Prop label="Holds">
              {design.components.some((c) => c.boundary === boundary.id) ? (
                design.components.filter((c) => c.boundary === boundary.id).map((c) => ref(c.id))
              ) : (
                <span className="quiet">Drag parts into the box</span>
              )}
            </Prop>
          </>
        )}
        {connection && (
          <>
            <Prop label="Label">
              <Ed label="Label" placeholder="e.g. HTTPS" value={connection.label} onCommit={(v) => edit((d: Design) => d.connections, { label: v })} />
            </Prop>
            <Prop label="Relation">
              <select
                className="ed"
                value={connection.kind ?? ''}
                onChange={(e) => edit((d: Design) => d.connections, { kind: (e.target.value || undefined) as ConnectionKind | undefined })}
                aria-label="Relation"
              >
                <option value="">Arrow</option>
                {CONNECTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {RELATION_NAMES[k]}
                  </option>
                ))}
              </select>
            </Prop>
            <Prop label="Load">
              <Num label="Requests per second" unit="req/s" value={connection.qps} onCommit={(v) => edit((d: Design) => d.connections, { qps: v })} />
              <Num label="Latency" unit="ms" value={connection.latency} onCommit={(v) => edit((d: Design) => d.connections, { latency: v })} />
            </Prop>
            <Prop label="Mode">
              <div className="toggle" role="radiogroup" aria-label="Mode">
                <button role="radio" aria-checked={!connection.async} onClick={() => edit((d: Design) => d.connections, { async: undefined })}>
                  Sync
                </button>
                <button role="radio" aria-checked={!!connection.async} onClick={() => edit((d: Design) => d.connections, { async: true })}>
                  Async
                </button>
              </div>
            </Prop>
            <Prop label="Line">
              <div className="toggle" role="radiogroup" aria-label="Line">
                {(['curve', 'straight', 'elbow'] as const).map((r) => (
                  <button key={r} role="radio" aria-checked={(connection.route ?? 'curve') === r} onClick={() => edit((d: Design) => d.connections, { route: r === 'curve' ? undefined : r, bend: undefined })}>
                    {r[0].toUpperCase() + r.slice(1)}
                  </button>
                ))}
              </div>
              {connection.bend !== undefined && (
                <button className="text-btn" onClick={() => edit((d: Design) => d.connections, { bend: undefined })}>
                  Reset bend
                </button>
              )}
            </Prop>
          </>
        )}
        {decision && <Prop label="Affects">{decision.links.length ? decision.links.map(ref) : <span className="quiet">Drag from the decision to a component</span>}</Prop>}
        {note && <Prop label="Attached to">{note.attachTo ? ref(note.attachTo) : <span className="quiet">Drag from the note to a component</span>}</Prop>}
        <Prop label="Step">
          <span className="mono">{pad(stepNo(item.step))}</span>
          <span className="prop-text">{stepTitle(item.step)}</span>
        </Prop>
      </section>

      <section className="insp-sec">
        {component && (
          <Block label="Description">
            <Ed label="Description" multiline placeholder="What it does and why it is here" value={component.description} onCommit={(v) => edit((d: Design) => d.components, { description: v })} />
          </Block>
        )}
        {boundary && (
          <>
            <Block label="Description">
              <Ed label="Description" multiline placeholder="What this boundary separates and why" value={boundary.description} onCommit={(v) => edit((d: Design) => d.boundaries, { description: v })} />
            </Block>
            <p className="quiet">Drag the label tab to move the box with everything in it. Deleting it keeps its parts.</p>
          </>
        )}
        {note && (
          <Block label="Text">
            <Ed label="Text" required multiline value={note.text} onCommit={(v) => edit((d: Design) => d.notes, { text: v })} />
          </Block>
        )}
        {decision && (
          <>
            <Block label="Why">
              <Ed label="Why" required multiline value={decision.why} onCommit={(v) => edit((d: Design) => d.decisions, { why: v })} />
            </Block>
            <Block label="Instead of">
              <Ed
                label="Alternatives"
                multiline
                placeholder="One alternative per line"
                value={decision.alternatives?.join('\n')}
                onCommit={(v) => edit((d: Design) => d.decisions, { alternatives: v?.split('\n').map((s) => s.trim()).filter(Boolean) })}
              />
            </Block>
            <Block label="Cost">
              <Ed label="Trade-offs" multiline placeholder="What this choice gives up" value={decision.tradeoffs} onCommit={(v) => edit((d: Design) => d.decisions, { tradeoffs: v })} />
            </Block>
          </>
        )}
        {connection && (
          <p className="quiet">
            Async connections are drawn dashed: queues, events and other fire-and-forget flows. Drag the middle of a selected line (or its label) to bend it; double-click it to edit the label.
          </p>
        )}
      </section>

      <Comments design={design} step={item.step} target={item.id} change={change} onSelect={onSelect} />

      <footer className="insp-foot">
        <button className="text-btn danger" onClick={() => onDelete(item.id)}>
          Delete {kind.toLowerCase()}
        </button>
      </footer>
    </aside>
  );
}

/** One step: what it says, what it changed, and everything a reviewer does with it. */
export function StepDetails({
  design,
  stepId,
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
  const fieldText = (field: string, v: string | undefined) => (v === undefined ? '—' : field === 'boundary' || field === 'parent' ? (labelOf(v) ?? v) : v);
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
    <aside className="inspector">
      <header className="insp-head">
        <div className="insp-tagline">
          <span className="tag">Step {pad(stepNo(step.id))}</span>
          {step.changesRequested ? (
            <span className="state new">Changes requested</span>
          ) : (
            <span className={`state${step.seen ? '' : ' new'}`}>{step.seen ? 'Reviewed' : 'Not reviewed'}</span>
          )}
        </div>
        <h2 className="insp-title">{step.title}</h2>
        {step.summary && <p className="insp-lead">{step.summary}</p>}
        {changes.some((c) => c !== 0) && (
          <p className="insp-cost">
            {money(sofar, design.currency)}/mo so far{delta !== 0 && <> · {delta > 0 ? '+' : '−'}{money(Math.abs(delta), design.currency)} in this step</>}
          </p>
        )}
      </header>

      {step.options && (
        <section className="insp-sec">
          <h3 className="rule-head">Options</h3>
          <p className="quiet pad">Compare them on the sheet, then pick one. The others go, and a decision records the choice.</p>
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
          <h3 className="rule-head">Decisions</h3>
          {decisions.map((x, i) => (
            <button key={x.id} className="decision-entry" onClick={() => onSelect(x.id)}>
              <span className="decision-no">D{i + 1}</span>
              <span className="decision-body">
                <strong>{x.title}</strong>
                <span className="decision-why">{x.why}</span>
                {x.alternatives?.length ? (
                  <span className="decision-line">
                    <em>instead of</em> {x.alternatives.join(' · ')}
                  </span>
                ) : null}
                {x.tradeoffs && (
                  <span className="decision-line">
                    <em>cost</em> {x.tradeoffs}
                  </span>
                )}
              </span>
            </button>
          ))}
        </section>
      )}

      {notes.length > 0 && (
        <section className="insp-sec">
          <h3 className="rule-head">Notes</h3>
          {notes.map((n) => (
            <button key={n.id} className="note-entry" onClick={() => onSelect(n.id)}>
              {n.text}
            </button>
          ))}
        </section>
      )}

      {components.length + boundaries.length > 0 && (
        <section className="insp-sec">
          <h3 className="rule-head">Added</h3>
          {boundaries.map((b) => (
            <button key={b.id} className="list-row" onClick={() => onSelect(b.id)}>
              <BoundaryPreview kind={b.kind} />
              <span className="list-main">{b.label}</span>
              <span className="list-meta">{b.detail ?? BOUNDARY_SPECS[b.kind].name}</span>
            </button>
          ))}
          {components.map((c) => (
            <button key={c.id} className="list-row" onClick={() => onSelect(c.id)}>
              <ShapePreview type={c.type} width={30} height={20} />
              <span className="list-main">{c.label}</span>
              {c.tech && <span className="list-meta">{c.tech}</span>}
            </button>
          ))}
        </section>
      )}

      {!!step.changed?.length && (
        <section className="insp-sec">
          <h3 className="rule-head">Changed</h3>
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
          <h3 className="rule-head">Removed</h3>
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

      <section className="insp-sec">
        <h3 className="rule-head">Design</h3>
        <Prop label="Repo">
          <Ed
            label="Repo"
            placeholder="https://github.com/org/repo/tree/main"
            value={design.repo}
            check={(v) => (/^https?:\/\/\S+$/i.test(v) ? undefined : 'Use an http(s) address')}
            onCommit={(v) => change((d) => void (d.repo = v?.trim()))}
          />
        </Prop>
        <Prop label="Currency">
          <select className="ed" value={design.currency ?? 'USD'} onChange={(e) => change((d) => void (d.currency = e.target.value === 'USD' ? undefined : e.target.value))} aria-label="Currency of costs">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Prop>
      </section>

      <footer className="insp-foot">
        <button
          className="text-btn danger"
          title="Remove everything this step added (Ctrl+Z brings it back)"
          onClick={() =>
            confirm(`Revert step ${pad(stepNo(step.id))} “${step.title}”? Everything it added is removed.${design.steps.length > 1 ? ' The step goes too.' : ''}`) &&
            change((d) => m.revertStep(d, stepId))
          }
        >
          Revert step
        </button>
      </footer>
    </aside>
  );
}
