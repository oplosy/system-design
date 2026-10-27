import { flowSequence, toMermaidSequence } from '../core/export.ts';
import type { Design, Flow } from '../core/schema.ts';

const COL = 170, BOX_W = 140, BOX_H = 34, PAD = 24, ROW = 46, TOP = BOX_H + 44;

/** A flow drawn as a sequence diagram: lifelines per component, one numbered message per hop; `at` lights the playing hop. */
export function SequenceView({ design, flow, at, onClose }: { design: Design; flow: Flow; at?: number; onClose: () => void }) {
  const { participants, messages } = flowSequence(design, flow);
  const x = new Map(participants.map((p, i) => [p.id, PAD + BOX_W / 2 + i * COL]));
  const w = PAD * 2 + BOX_W + (participants.length - 1) * COL;
  const h = TOP + messages.length * ROW + 10;
  return (
    <div className="sequence" role="dialog" aria-label={`Sequence: ${flow.title}`}>
      <header className="sequence-head">
        <strong>{flow.title}</strong>
        <span className="quiet">Sequence</span>
        <button className="text-btn" onClick={() => navigator.clipboard?.writeText(toMermaidSequence(design, flow))} title="Copy as a Mermaid sequence diagram">
          Copy Mermaid
        </button>
        <button className="text-btn" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </header>
      <div className="sequence-body">
        <svg width={w} height={h} role="img" aria-label={`${messages.length} messages between ${participants.map((p) => p.label).join(', ')}`}>
          <defs>
            {/* Markers can't take the line's colour reliably, so each colour gets its own pair. */}
            {(['ink-2', 'signal'] as const).map((c) => (
              <g key={c}>
                <marker id={`seq-solid-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10z" style={{ fill: `var(--${c})` }} />
                </marker>
                <marker id={`seq-open-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10" style={{ fill: 'none', stroke: `var(--${c})`, strokeWidth: 1.5 }} />
                </marker>
              </g>
            ))}
          </defs>
          {participants.map((p) => (
            <g key={p.id}>
              <line x1={x.get(p.id)} x2={x.get(p.id)} y1={BOX_H + 10} y2={h} className="seq-life" />
              <rect x={x.get(p.id)! - BOX_W / 2} y={10} width={BOX_W} height={BOX_H} rx={6} className="seq-box" />
              <text x={x.get(p.id)} y={10 + BOX_H / 2} className="seq-name">
                {p.label}
              </text>
            </g>
          ))}
          {messages.map((m, i) => {
            const y = TOP + i * ROW, x1 = x.get(m.from)!, x2 = x.get(m.to)!;
            const on = i === at;
            return (
              <g key={i} className={`seq-msg${on ? ' on' : ''}${m.missing ? ' missing' : ''}`}>
                <line x1={x1} x2={x2 + (x2 > x1 ? -2 : 2)} y1={y} y2={y} strokeDasharray={m.reply ? '6 4' : undefined} markerEnd={`url(#seq-${m.async || m.reply ? 'open' : 'solid'}-${on ? 'signal' : 'ink-2'})`} />
                <text x={(x1 + x2) / 2} y={y - 7} className="seq-label">
                  {i + 1}. {m.label ?? (m.reply ? 'reply' : '')}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
