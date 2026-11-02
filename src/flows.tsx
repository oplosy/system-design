import { useState } from 'react';
import { type Design } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import { type FlowAt, type Change, timeText } from './fields.tsx';

export function Flows({
  design,
  inOption,
  stepId,
  flow,
  onFlow,
  recording,
  onRecording,
  onSequence,
  change,
}: {
  design: Design;
  inOption: (x: { step: string; option?: string }) => boolean;
  stepId: string;
  flow: FlowAt | null;
  onFlow: (f: FlowAt | null) => void;
  recording: string[] | null;
  onRecording: (r: string[] | null) => void;
  onSequence: (id: string) => void;
  change: Change;
}) {
  const [title, setTitle] = useState('');
  const idx = m.stepIndex(design);
  const flows = design.flows.filter((f) => idx.get(f.step)! <= idx.get(stepId)! && inOption(f));
  const labelOf = (id: string) => design.components.find((c) => c.id === id)?.label ?? id;
  const save = () => {
    if (!recording || recording.length < 2 || !title.trim()) return;
    change((d) => m.addFlow(d, { title: title.trim(), path: recording, step: stepId, reopen: false }));
    setTitle('');
    onRecording(null);
  };
  return (
    <section className="insp-sec">
      <h3 className="rule-head">
        Flows
        {flows.length > 0 && <span className="rule-count">{flows.length}</span>}
      </h3>
      {recording ? (
        <form
          className="flow-record"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input className="ed" autoFocus value={title} placeholder="Flow name" aria-label="Flow title" onChange={(e) => setTitle(e.target.value)} />
          <p className="quiet">{recording.length ? recording.map(labelOf).join(' → ') : 'Click connected parts in order.'}</p>
          <div className="pop-foot">
            <button type="button" className="text-btn" onClick={() => recording.length && onRecording(recording.slice(0, -1))} disabled={!recording.length}>
              Undo stop
            </button>
            <button type="button" className="text-btn" onClick={() => (setTitle(''), onRecording(null))}>
              Cancel
            </button>
            <button type="submit" className="btn ink" disabled={recording.length < 2 || !title.trim()}>
              Save flow
            </button>
          </div>
        </form>
      ) : (
        <button className="list-row" onClick={() => onRecording([])} title="Draw a request path by clicking parts in order">
          <span className="flow-play" aria-hidden="true">
            +
          </span>
          <span className="list-main quiet">New flow</span>
        </button>
      )}
      {flows.map((f) => {
        const at = flow?.id === f.id ? flow.at : null;
        const hops = f.path.length - 1;
        return (
          <div key={f.id} className={`flow-entry${at !== null ? ' on' : ''}`}>
            <button className="list-row" aria-pressed={at !== null} onClick={() => onFlow(at !== null ? null : { id: f.id, at: 0 })} title={at !== null ? 'Stop' : 'Play hop by hop'}>
              <span className="flow-play" aria-hidden="true">
                {at !== null ? '■' : '▶'}
              </span>
              <span className="list-main">{f.title}</span>
              <span className="list-meta">
                {hops} hops{timeText(design, f)}
              </span>
            </button>
            {at !== null && (
              <div className="flow-steps">
                <button className="btn" disabled={at === 0} onClick={() => onFlow({ id: f.id, at: at - 1 })} aria-label="Previous hop">
                  ←
                </button>
                <span className="flow-hop">
                  <span className="mono">
                    {at + 1}/{hops}
                  </span>{' '}
                  {labelOf(f.path[at])} → {labelOf(f.path[at + 1])}
                </span>
                <button className="btn" disabled={at === hops - 1} onClick={() => onFlow({ id: f.id, at: at + 1 })} aria-label="Next hop">
                  →
                </button>
                <button className="text-btn" onClick={() => onSequence(f.id)} title="Show as a sequence diagram">
                  Sequence
                </button>
                <button
                  className="text-btn danger"
                  onClick={() => {
                    onFlow(null);
                    change((d) => m.removeItem(d, f.id));
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
