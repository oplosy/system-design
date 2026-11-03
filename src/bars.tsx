import { useEffect, useState } from 'react';
import { api, type Me } from './api.ts';
import type { Design } from '../core/schema.ts';
import * as m from '../core/mutations.ts';
import * as review from '../core/review.ts';
import { BOUNDARY_SPECS } from './boundaries.ts';
import { SHAPES } from './shapes.ts';
import { type FlowAt, timeText, type Change } from './fields.tsx';
import { useHoverOpen } from './menus.tsx';
import { Icon } from './icons.tsx';
import { Select } from './select.tsx';

export function ReviewBar({
  design,
  viewIndex,
  maxIndex,
  onView,
  onSeenNext,
  onRequestChanges,
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
  /** Whether this step's details are unfolded above the bar. */
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const step = design.steps[viewIndex];
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState('');
  const hover = useHoverOpen(open, onToggle);
  const send = () => {
    onRequestChanges(why);
    setWhy('');
    setAsking(false);
  };
  return (
    <section className="review" aria-label="Step review" {...hover.area}>
      {open && (
        <div className="review-sheet" id="step-details">
          {children}
        </div>
      )}
      {asking && (
        <form
          className="review-ask"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label className="field-label" htmlFor="changes-why">
            What should change in step {viewIndex + 1}?
          </label>
          <textarea
            id="changes-why"
            className="ed"
            autoFocus
            rows={3}
            value={why}
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
              <Icon name="send" />
              Send to agent
            </button>
          </div>
        </form>
      )}
      <div className="review-bar">
        <div className="review-steps">
          {design.steps.map((s, i) => (
            <button
              type="button"
              key={s.id}
              className={`review-step${s.seen ? ' seen' : ''}${s.changesRequested ? ' changes' : ''}${i === viewIndex ? ' current' : ''}`}
              onClick={() => i <= maxIndex && onView(i)}
              aria-disabled={i > maxIndex}
              aria-current={i === viewIndex ? 'step' : undefined}
              aria-label={`Step ${i + 1}`}
              title={i > maxIndex ? `Step ${i + 1} opens once the earlier steps are approved` : `${i + 1}. ${s.title}`}
            />
          ))}
        </div>
        <div className="review-row">
          <button type="button" className="icon-btn" onClick={() => onView(viewIndex - 1)} disabled={viewIndex === 0} title="Previous step (←)" aria-label="Previous step">
            <Icon name="left" />
          </button>
          <div className="review-text">
            <span className="review-count">
              Step {viewIndex + 1} of {design.steps.length}
              {step.changesRequested ? ', changes requested' : step.seen ? ', approved' : ''}
            </span>
            <span className="review-name">{step.title}</span>
          </div>
          <button type="button" className="text-btn review-title" aria-expanded={open} aria-controls="step-details" {...hover.trigger} onClick={onToggle}>
            <Icon name="panel" />
            {open ? 'Hide details' : 'Details'}
          </button>
          <button type="button" className="text-btn" aria-expanded={asking} onClick={() => setAsking((a) => !a)} title="Send this step back to the agent with a comment">
            <Icon name="comment" />
            Request changes
          </button>
          {!step.seen ? (
            <button type="button" className="btn ink" onClick={onSeenNext} disabled={!!step.options} title={step.options ? 'Pick one of the options first' : 'Approve and go to the next step (→)'}>
              <Icon name="check" />
              Approve
            </button>
          ) : viewIndex < maxIndex ? (
            <button type="button" className="btn ink" onClick={() => onView(viewIndex + 1)} title="Next step (→)">
              Next
              <Icon name="right" />
            </button>
          ) : (
            <span className="review-done">
              <Icon name="check" />
              All approved
            </span>
          )}
        </div>
      </div>
    </section>
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
    <section className="present-bar" aria-label="Presentation">
      <span className="present-no">
        {(playing ? flow.at : viewIndex) + 1} <span>of {playing ? hops : design.steps.length}</span>
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
        <Select className="present-flows" label="Play a flow" value={playing?.id ?? ''} onChange={(v) => onFlow(v ? { id: v, at: 0 } : null)} options={[{ value: '', label: 'Flows' }, ...flows.map((f) => ({ value: f.id, label: f.title }))]} />
      )}
      {playing ? (
        <>
          <button type="button" className="icon-btn" onClick={() => onFlow({ id: playing.id, at: flow.at - 1 })} disabled={flow.at === 0} aria-label="Previous hop">
            <Icon name="left" />
          </button>
          <button type="button" className="icon-btn" onClick={() => onFlow({ id: playing.id, at: flow.at + 1 })} disabled={flow.at >= hops - 1} aria-label="Next hop">
            <Icon name="right" />
          </button>
        </>
      ) : (
        <>
          <button type="button" className="icon-btn" onClick={() => onView(viewIndex - 1)} disabled={viewIndex === 0} aria-label="Previous step">
            <Icon name="left" />
          </button>
          <button type="button" className="icon-btn" onClick={() => onView(viewIndex + 1)} disabled={viewIndex >= maxIndex} aria-label="Next step">
            <Icon name="right" />
          </button>
        </>
      )}
      <button type="button" className="text-btn" onClick={onExit}>
        <Icon name="signout" />
        Exit
      </button>
    </section>
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
              <button type="button" key={h.id} role="option" aria-selected={false} className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h.id)}>
                <span className="menu-main">
                  <span className="menu-title">{h.text}</span>
                </span>
                <span className="menu-meta">{h.kind}</span>
              </button>
            ))
          ) : (
            <p className="quiet pad">No match</p>
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
    change((d) => review.addComment(d, { step: target ? undefined : step, target, text, by: 'reviewer', author: me?.name }));
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
        <Icon name="comment" />
        Comments
        {open > 0 && <span className="rule-count">{open}</span>}
      </h3>
      {list.map((c) => (
        <div key={c.id} className={`comment${c.resolved ? ' resolved' : ''}${c.by === 'agent' ? ' agent' : ''}`}>
          <div className="comment-meta">
            <span className="comment-by">{c.by === 'agent' ? 'Agent' : (c.author ?? 'You')}</span>
            {!target && c.target && (
              <button type="button" className="ref" onClick={() => onSelect(c.target!)}>
                {label(c.target)}
              </button>
            )}
            <span className="comment-at">{when(c.at)}</span>
            {c.by === 'reviewer' && (
              <button type="button" className="text-btn" onClick={() => toggle(c.id)}>
                <Icon name={c.resolved ? 'undo' : 'check'} />
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
          <button type="button" className="btn" onClick={send} title="Ctrl+Enter">
            <Icon name="send" />
            Comment
          </button>
        )}
      </div>
    </section>
  );
}

/** The way back from a part's inside: the designs left to get here, outermost first. */
export function Trail({ trail, title, onBack }: { trail: { id: string; title: string; via: string }[]; title: string; onBack: (i: number) => void }) {
  return (
    <nav className="trail" aria-label="Opened from">
      {trail.map((t, i) => (
        <span key={`${t.id}-${i}`}>
          <button type="button" className="text-btn" onClick={() => onBack(i)} title={`Back to ${t.title}`}>
            {t.title}
          </button>
          {/* The part's name only when the design it opened is called something else. */}
          <span className="quiet">› {t.via !== (trail[i + 1]?.title ?? title) && `${t.via} ›`}</span>
        </span>
      ))}
      <strong>{title}</strong>
    </nav>
  );
}
