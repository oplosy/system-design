import type { Design } from '../core/schema.ts';
import { money, stepCostChange } from '../core/export.ts';
import * as m from '../core/mutations.ts';
import { BOUNDARY_SPECS } from './boundaries.ts';
import type { Change, FlowAt } from './fields.tsx';
import { BoundaryPreview, ShapePreview } from './palette.tsx';
import { Flows } from './flows.tsx';
import { Comments } from './bars.tsx';
import { asDetail, asTitle } from './format.ts';
import { Icon } from './icons.tsx';

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
        <button type="button" className="chip" aria-pressed={diff} onClick={onDiff} title="Outline what this step added or changed, show what it removed, and dim the rest">
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
                      <button type="button" className="list-row" aria-pressed={on} onClick={() => onOption(stepId, o.id)} title="Show this option on the sheet">
                        <span className="flow-play" aria-hidden="true">
                          {on ? '●' : '○'}
                        </span>
                        <span className="list-main">{o.title}</span>
                        <span className="list-meta">{design.components.filter((c) => c.option === o.id && c.step === stepId).length} parts</span>
                      </button>
                      {o.summary && <p className="option-why">{o.summary}</p>}
                      {on && (
                        <div className="flow-steps">
                          <button type="button" className="btn ink" onClick={() => onPickOption(stepId, o.id)}>
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
                  <button type="button" key={x.id} className="decision-entry" onClick={() => onSelect(x.id)}>
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
                  <button type="button" key={n.id} className="note-entry" onClick={() => onSelect(n.id)}>
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
                <button type="button" key={b.id} className="list-row" onClick={() => onSelect(b.id)}>
                  <BoundaryPreview kind={b.kind} />
                  <span className="list-text">
                    <span className="list-main">{asTitle(b.label)}</span>
                    <span className="list-meta">{asDetail(b.detail ?? BOUNDARY_SPECS[b.kind].name)}</span>
                  </span>
                </button>
              ))}
              {components.map((c) => (
                <button type="button" key={c.id} className="list-row" onClick={() => onSelect(c.id)}>
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
                <button type="button" key={`${c.id}:${c.field}`} className="list-row change-row" onClick={() => onSelect(c.id)} disabled={!labelOf(c.id)}>
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
              type="button"
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
