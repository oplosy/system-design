import { useEffect, useState } from 'react';
import { api, type Me } from './api.ts';
import { type Design } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import { BOUNDARY_SPECS } from './boundaries.ts';
import { SHAPES } from './shapes.ts';
import { pad } from './format.ts';
import { type FlowAt, timeText, type Change } from './fields.tsx';

export function ReviewBar({
  design,
  viewIndex,
  maxIndex,
  onView,
  onSeenNext,
  onRequestChanges,
  diff,
  onDiff,
  open,
  onToggle,
  children,
}: {
  design: Design;
  viewIndex: number;
  maxIndex: number;
  onView: (i: number) => void;
  onSeenNext: () => void;
  onRequestChanges: (text: string) => void;
  diff: boolean;
  onDiff: () => void;
  /** Whether this step's details are unfolded above the bar. */
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const step = design.steps[viewIndex];
  const seen = design.steps.filter((s) => s.seen).length;
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState('');
  const send = () => {
    onRequestChanges(why);
    setWhy('');
    setAsking(false);
  };
  return (
    <div className="review" role="region" aria-label="Step review">
      {open && (
        <div className="review-sheet" id="step-details">
          <div className="review-tools">
            <span className="dots">
              {design.steps.map((s, i) => (
                <button
                  key={s.id}
                  className={`dot${s.seen ? ' seen' : ''}${s.changesRequested ? ' changes' : ''}${i === viewIndex ? ' current' : ''}${i > maxIndex ? ' locked' : ''}`}
                  onClick={() => i <= maxIndex && onView(i)}
                  aria-disabled={i > maxIndex}
                  aria-current={i === viewIndex ? 'step' : undefined}
                  aria-label={`Step ${i + 1}`}
                  title={
                    i > maxIndex
                      ? `Step ${i + 1} is locked until the earlier steps are reviewed`
                      : `Step ${i + 1}: ${s.title}${s.seen ? ' (reviewed)' : ''}${s.changesRequested ? ' (changes requested)' : ''}`
                  }
                />
              ))}
            </span>
            <span className="review-seen">{seen} reviewed</span>
            <button className="chip" aria-pressed={diff} onClick={onDiff} title="Outline what this step added or changed, show what it removed, and dim the rest">
              Diff
            </button>
            <button className="text-btn" aria-expanded={asking} onClick={() => setAsking((a) => !a)} title="Send this step back to the agent with a comment">
              Request changes
            </button>
          </div>
          {asking && (
            <form
              className="review-ask"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <label className="field-label" htmlFor="changes-why">
                Send step {pad(viewIndex + 1)} back to the agent
              </label>
              <textarea
                id="changes-why"
                className="ed"
                autoFocus
                rows={3}
                value={why}
                placeholder="What should change? The agent reads this through get_feedback."
                onChange={(e) => setWhy(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setAsking(false);
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
                }}
              />
              <div className="pop-foot">
                <button type="button" className="text-btn" onClick={() => setAsking(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn ink">
                  Request changes
                </button>
              </div>
            </form>
          )}
          {children}
        </div>
      )}
      <div className="review-bar">
        <button className="icon-btn" onClick={() => onView(viewIndex - 1)} disabled={viewIndex === 0} title="Previous step (←)" aria-label="Previous step">
          ‹
        </button>
        <button className="review-title" aria-expanded={open} aria-controls="step-details" onClick={onToggle} title={`${open ? 'Hide' : 'Show'} this step's details`}>
          <span className="review-count">
            {viewIndex + 1} / {design.steps.length}
          </span>
          <span className="review-name">{step.title}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d={open ? 'M1.5 3.5 5 7l3.5-3.5' : 'M1.5 6.5 5 3l3.5 3.5'} fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
        {!step.seen ? (
          <button className="btn ink" onClick={onSeenNext} disabled={!!step.options} title={step.options ? 'Pick one of the options first (step details)' : 'Mark as seen and go to the next step (→)'}>
            Mark seen
          </button>
        ) : viewIndex < maxIndex ? (
          <button className="btn" onClick={() => onView(viewIndex + 1)} title="Next step (→)">
            Next
          </button>
        ) : (
          <span className="review-done">All reviewed ✓</span>
        )}
      </div>
    </div>
  );
}

/** While a flow plays, the arrows walk its hops instead of the steps. */
export function PresentBar({
  design,
  viewIndex,
  maxIndex,
  onView,
  onExit,
  flow,
  onFlow,
}: {
  design: Design;
  viewIndex: number;
  maxIndex: number;
  onView: (i: number) => void;
  onExit: () => void;
  flow: FlowAt | null;
  onFlow: (f: FlowAt | null) => void;
}) {
  const step = design.steps[viewIndex];
  const idx = m.stepIndex(design);
  const flows = design.flows.filter((f) => idx.get(f.step)! <= viewIndex);
  const playing = flow && flows.find((f) => f.id === flow.id);
  const labelOf = (id: string) => design.components.find((c) => c.id === id)?.label ?? id;
  const hops = playing ? playing.path.length - 1 : 0;
  return (
    <div className="present-bar" role="region" aria-label="Presentation">
      <span className="present-no">
        {pad((playing ? flow.at : viewIndex) + 1)}
        <span>/{pad(playing ? hops : design.steps.length)}</span>
      </span>
      <div className="present-text">
        {playing ? (
          <>
            <strong>{playing.title}</strong>
            <span>
              {labelOf(playing.path[flow.at])} → {labelOf(playing.path[flow.at + 1])}
              {timeText(design, playing)}
            </span>
          </>
        ) : (
          <>
            <strong>{step.title}</strong>
            {step.summary && <span>{step.summary}</span>}
          </>
        )}
      </div>
      {flows.length > 0 && (
        <select className="present-flows" value={playing?.id ?? ''} onChange={(e) => (onFlow(e.target.value ? { id: e.target.value, at: 0 } : null), e.target.blur())} aria-label="Play a flow">
          <option value="">Flows…</option>
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              ▶ {f.title}
            </option>
          ))}
        </select>
      )}
      {playing ? (
        <>
          <button className="icon-btn" onClick={() => onFlow({ id: playing.id, at: flow.at - 1 })} disabled={flow.at === 0} aria-label="Previous hop">
            ‹
          </button>
          <button className="icon-btn" onClick={() => onFlow({ id: playing.id, at: flow.at + 1 })} disabled={flow.at >= hops - 1} aria-label="Next hop">
            ›
          </button>
        </>
      ) : (
        <>
          <button className="icon-btn" onClick={() => onView(viewIndex - 1)} disabled={viewIndex === 0} aria-label="Previous step">
            ‹
          </button>
          <button className="icon-btn" onClick={() => onView(viewIndex + 1)} disabled={viewIndex >= maxIndex} aria-label="Next step">
            ›
          </button>
        </>
      )}
      <button className="text-btn" onClick={onExit}>
        Exit <kbd>Esc</kbd>
      </button>
    </div>
  );
}

/** Finds a visible item by name, technology, text or kind, and flies to it. */
export function FindBox({ design, visible, onPick, inputRef, onClose }: { design: Design; visible: string[]; onPick: (id: string) => void; inputRef: React.RefObject<HTMLInputElement | null>; onClose: () => void }) {
  const [q, setQ] = useState('');
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = new Set(visible);
  const all = [
    ...design.components.map((c) => ({ id: c.id, kind: SHAPES[c.type].name, text: c.label, extra: c.tech })),
    ...design.boundaries.map((b) => ({ id: b.id, kind: BOUNDARY_SPECS[b.kind].name, text: b.label, extra: b.detail })),
    ...design.decisions.map((x) => ({ id: x.id, kind: 'Decision', text: x.title, extra: x.why })),
    ...design.notes.map((n) => ({ id: n.id, kind: 'Note', text: n.text, extra: '' })),
    ...design.connections.filter((c) => c.label).map((c) => ({ id: c.id, kind: 'Connection', text: c.label!, extra: '' })),
  ];
  const hits = terms.length ? all.filter((x) => shown.has(x.id) && terms.every((t) => `${x.text} ${x.extra ?? ''} ${x.kind} ${x.id}`.toLowerCase().includes(t))).slice(0, 8) : [];
  const pick = (id: string) => {
    onPick(id);
    onClose();
  };
  return (
    <div className="find">
      <input
        ref={inputRef}
        autoFocus
        type="search"
        className="find-input"
        value={q}
        placeholder="Find on sheet"
        aria-label="Find on sheet"
        onChange={(e) => setQ(e.target.value)}
        onBlur={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) pick(hits[0].id);
          if (e.key === 'Escape') {
            e.currentTarget.blur();
          }
        }}
      />
      {terms.length > 0 && (
        <div className="menu menu-right find-menu" role="listbox" aria-label="Matches">
          {hits.length ? (
            hits.map((h) => (
              <button key={h.id} role="option" aria-selected={false} className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h.id)}>
                <span className="menu-main">
                  <span className="menu-title">{h.text}</span>
                </span>
                <span className="menu-meta">{h.kind}</span>
              </button>
            ))
          ) : (
            <p className="quiet pad">Nothing on this step matches “{q}”.</p>
          )}
        </div>
      )}
    </div>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Review comments on a step (`target` unset) or on one item, plus a box to add one for the agent. */
export function Comments({ design, step, target, change, onSelect }: { design: Design; step: string; target?: string; change: Change; onSelect: (id: string) => void }) {
  const [text, setText] = useState('');
  const [me, setMe] = useState<Me>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => void api.me().then(setMe, () => undefined), []);
  const list = design.comments.filter((c) => (target ? c.target === target : c.step === step));
  const open = list.filter((c) => !c.resolved && c.by === 'reviewer').length;
  const label =(id: string) => [...design.components, ...design.boundaries].find((x) => x.id === id)?.label ?? design.decisions.find((x) => x.id === id)?.title ?? id;
  const send = () => {
    if (!text.trim()) return;
    // A viewer's saves go nowhere, so the comment goes to the server on its own and comes back with the next update.
    if (me?.canEdit === false) {
      setErr(null);
      api.comment(design.id, { step: target ? undefined : step, target, text }).then(
        () => setText(''),
        (e) => setErr(e instanceof Error ? e.message : String(e)),
      );
      return;
    }
    change((d) => m.addComment(d, { step: target ? undefined : step, target, text, by: 'reviewer', author: me?.name }));
    setText('');
  };
  const toggle = (id: string) =>
    change((d) => {
      const c = d.comments.find((x) => x.id === id);
      if (c) c.resolved = c.resolved ? undefined : true;
    });
  return (
    <section className="insp-sec">
      <h3 className="rule-head">
        Comments
        {open > 0 && <span className="rule-count">{open}</span>}
      </h3>
      {list.map((c) => (
        <div key={c.id} className={`comment${c.resolved ? ' resolved' : ''}${c.by === 'agent' ? ' agent' : ''}`}>
          <div className="comment-meta">
            <span className="comment-by">{c.by === 'agent' ? 'Agent' : (c.author ?? 'You')}</span>
            {!target && c.target && (
              <button className="ref" onClick={() => onSelect(c.target!)}>
                {label(c.target)}
              </button>
            )}
            <span className="comment-at">{when(c.at)}</span>
            {c.by === 'reviewer' && (
              <button className="text-btn" onClick={() => toggle(c.id)}>
                {c.resolved ? 'Reopen' : 'Resolve'}
              </button>
            )}
          </div>
          <p className="comment-text">{c.text}</p>
        </div>
      ))}
      <div className="comment-new">
        {err && <em className="ed-error">{err}</em>}
        <textarea
          className="ed"
          rows={2}
          value={text}
          placeholder="Add a comment"
          aria-label="New comment"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && send()}
        />
        {text.trim() && (
          <button className="btn" onClick={send} title="Ctrl+Enter">
            Comment
          </button>
        )}
      </div>
    </section>
  );
}
