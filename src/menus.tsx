import { useCallback, useEffect, useRef, useState } from 'react';
import { type Design } from '../core/schema.ts';
import { shared } from './api.ts';
import { LAYOUTS, type LayoutKind } from './layout.ts';
import { type Editing, type Theme } from './format.ts';

export function useDismiss(active: boolean, onDismiss: () => void, ref?: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss();
    const onDown = (e: MouseEvent) => ref?.current && !ref.current.contains(e.target as HTMLElement) && onDismiss();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [active, onDismiss, ref]);
}

/** Text box over the canvas for renaming in place. Enter or leaving it saves; Esc cancels; Shift+Enter adds a line. */
export function InlineEdit({ at, value, multiline, onDone }: Editing & { onDone: (value: string | null) => void }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const finish = (x: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(x);
  };
  const props = {
    autoFocus: true,
    value: v,
    'aria-label': 'Edit text',
    className: 'inline-edit nodrag nopan nowheel',
    style: { transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.currentTarget.select(),
    onBlur: () => finish(v),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') finish(null);
      else if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
        e.preventDefault();
        finish(v);
      }
    },
  };
  return multiline ? <textarea rows={4} {...props} /> : <input {...props} />;
}

function Seg<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: readonly { key: T; title: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} role="radio" aria-checked={value === o.key} onClick={() => onPick(o.key)}>
          {o.title}
        </button>
      ))}
    </div>
  );
}

const THEMES = [
  { key: 'light', title: 'Light' },
  { key: 'dark', title: 'Dark' },
  { key: 'system', title: 'System' },
] as const;
const STYLES = [
  { key: 'sketch', title: 'Sketch' },
  { key: 'clean', title: 'Clean' },
] as const;

export function AppearanceMenu({
  sketch,
  onSketch,
  theme,
  onTheme,
  icon,
}: {
  sketch: boolean;
  onSketch: (s: boolean) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  icon: (d: string) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  return (
    <div className="switcher" ref={ref}>
      <button className="icon-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Appearance: theme and drawing style" aria-label="Appearance">
        {icon('M8 2.5v1.2M8 12.3v1.2M2.5 8h1.2M12.3 8h1.2M4.1 4.1l.85.85M11.05 11.05l.85.85M4.1 11.9l.85-.85M11.05 4.95l.85-.85M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z')}
      </button>
      {open && (
        <div className="menu menu-right menu-pad" role="dialog" aria-label="Appearance">
          <span className="field-label">Theme</span>
          <Seg label="Theme" value={theme} options={THEMES} onPick={onTheme} />
          <span className="field-label">Drawing style</span>
          <Seg label="Drawing style" value={sketch ? 'sketch' : 'clean'} options={STYLES} onPick={(v) => onSketch(v === 'sketch')} />
          <p className="menu-note">Sketch draws hand-made lines like a whiteboard; Clean draws crisp ones for docs.</p>
        </div>
      )}
    </div>
  );
}

/** Views of one model: everything, or only the parts with one tag. */
export function TagMenu({ design, tag, onPick }: { design: Design; tag: string | null; onPick: (tag: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const counts = new Map<string, number>();
  for (const c of design.components) for (const t of c.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  // A tag that no part carries any more (renamed, removed, another design) falls back to everything.
  useEffect(() => {
    if (tag && !counts.has(tag)) onPick(null);
  });
  if (!counts.size) return null;
  const pick = (t: string | null) => {
    setOpen(false);
    onPick(t);
  };
  return (
    <div className="switcher" ref={ref}>
      <button className="text-btn" aria-haspopup="menu" aria-expanded={open} aria-pressed={!!tag} onClick={() => setOpen((o) => !o)} title="Show only the parts with one tag">
        {tag ? `View: ${tag}` : 'View'}
      </button>
      {open && (
        <div className="menu menu-right" role="menu" aria-label="View">
          <button role="menuitemradio" aria-checked={!tag} className="menu-item" onClick={() => pick(null)}>
            <span className="menu-main">
              <span className="menu-title">Everything</span>
              <span className="menu-desc">Every part on the sheet</span>
            </span>
          </button>
          {[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => (
            <button key={t} role="menuitemradio" aria-checked={tag === t} className="menu-item" onClick={() => pick(t)}>
              <span className="menu-main">
                <span className="menu-title">{t}</span>
                <span className="menu-desc">
                  {n} {n > 1 ? 'parts' : 'part'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LayoutMenu({ disabled, selected, onPick }: { disabled: boolean; selected: number; onPick: (kind: LayoutKind, selectionOnly: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [onlySelected, setOnlySelected] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const scoped = onlySelected && selected > 1;
  return (
    <div className="switcher" ref={ref}>
      <button className="text-btn" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Re-arrange items automatically (Ctrl+Z undoes it)">
        Layout
      </button>
      {open && (
        <div className="menu menu-right" role="menu" aria-label="Layout">
          <label className={`check${selected > 1 ? '' : ' off'}`} title={selected > 1 ? undefined : 'Select two or more items first (Shift or Ctrl + click, or drag a box)'}>
            <input type="checkbox" checked={scoped} disabled={selected < 2} onChange={(e) => setOnlySelected(e.target.checked)} />
            Only the selected items{selected > 1 ? ` (${selected})` : ''}
          </label>
          {LAYOUTS.map((x) => (
            <button
              key={x.key}
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onPick(x.key, scoped);
              }}
            >
              <span className="menu-main">
                <span className="menu-title">{x.title}</span>
                <span className="menu-desc">{x.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const EXPORTS = [
  { kind: 'png', title: 'PNG image', desc: 'The sheet as it looks now, at 2× resolution' },
  { kind: 'svg', title: 'SVG image', desc: 'Scalable, for docs and slides' },
  { kind: 'mermaid', title: 'Mermaid diagram', desc: 'Flowchart text for Markdown, GitHub, Notion' },
  { kind: 'decisions', title: 'Decision record', desc: 'Every decision with why, alternatives and cost, as Markdown' },
  { kind: 'structurizr', title: 'Structurizr DSL', desc: 'C4 container model for Structurizr' },
  { kind: 'plantuml', title: 'C4-PlantUML', desc: 'C4 container diagram as PlantUML' },
  { kind: 'drawio', title: 'draw.io', desc: 'Editable diagram for diagrams.net, positions kept' },
  { kind: 'html', title: 'Shared HTML', desc: 'One file that opens anywhere: walk the steps, play flows; nothing is saved' },
] as const;

export type ExportKind = (typeof EXPORTS)[number]['kind'] | `plugin:${string}`;

export function ExportMenu({ disabled, extra, onPick }: { disabled: boolean; extra: { kind: string; name: string; extension: string }[]; onPick: (kind: ExportKind) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  return (
    <div className="switcher" ref={ref}>
      <button className="text-btn" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Export
      </button>
      {open && (
        <div className="menu menu-right" role="menu" aria-label="Export">
          {[...EXPORTS.filter((x) => !(shared && x.kind === 'html')), ...extra.map((x) => ({ kind: x.kind as ExportKind, title: x.name, desc: `From a plugin, as .${x.extension}` }))].map((x) => (
            <button
              key={x.kind}
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onPick(x.kind);
              }}
            >
              <span className="menu-main">
                <span className="menu-title">{x.title}</span>
                <span className="menu-desc">{x.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
