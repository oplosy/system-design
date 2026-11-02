import { useCallback, useEffect, useRef, useState } from 'react';
import { type Design } from '../core/schema.ts';
import { shared, type LiveLoad, type Me } from './api.ts';
import { LAYOUTS, type LayoutKind } from './layout.ts';
import { type Editing, type Theme } from './format.ts';
import { CURRENCIES, Ed, Prop, type Change } from './fields.tsx';

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

export function DialogHead({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  return (
    <header className="dialog-head">
      <h2 id={id}>{title}</h2>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
        ×
      </button>
    </header>
  );
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
] as const;
const STYLES = [
  { key: 'clean', title: 'Clean' },
  { key: 'sketch', title: 'Sketch' },
] as const;

function Appearance({ sketch, onSketch, theme, onTheme }: { sketch: boolean; onSketch: (s: boolean) => void; theme: Theme; onTheme: (t: Theme) => void }) {
  // Until one is picked the page follows the system, so show what that came to.
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <div className="menu-form">
      <Seg label="Theme" value={dark ? 'dark' : 'light'} options={THEMES} onPick={onTheme} />
      <Seg label="Drawing style" value={sketch ? 'sketch' : 'clean'} options={STYLES} onPick={(v) => onSketch(v === 'sketch')} />
    </div>
  );
}

/** What belongs to the whole design rather than to a step. */
function DesignSettings({ design, change }: { design: Design; change: Change }) {
  return (
    <div className="menu-form">
      <Prop label="Repo">
        <Ed
          label="Repo"
          placeholder="https://…"
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
    </div>
  );
}

function tagCounts(design: Design | null) {
  const counts = new Map<string, number>();
  for (const c of design?.components ?? []) for (const t of c.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/** Views of one model: everything, or only the parts with one tag. */
function TagList({ counts, tag, onPick }: { counts: Map<string, number>; tag: string | null; onPick: (tag: string | null) => void }) {
  return (
    <>
      <button role="menuitemradio" aria-checked={!tag} className="menu-row" onClick={() => onPick(null)}>
        Everything
      </button>
      {[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => (
        <button key={t} role="menuitemradio" aria-checked={tag === t} className="menu-row" onClick={() => onPick(t)}>
          {t}
          <span className="menu-hint">{n}</span>
        </button>
      ))}
    </>
  );
}

function LayoutList({ selected, onPick }: { selected: number; onPick: (kind: LayoutKind, selectionOnly: boolean) => void }) {
  const [onlySelected, setOnlySelected] = useState(false);
  const scoped = onlySelected && selected > 1;
  return (
    <>
      {selected > 1 && (
        <label className="check">
          <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />
          Only the selected items
        </label>
      )}
      {LAYOUTS.map((x) => (
        <button key={x.key} role="menuitem" className="menu-row" title={x.desc} onClick={() => onPick(x.key, scoped)}>
          {x.title}
        </button>
      ))}
    </>
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

function ExportList({ extra, onPick }: { extra: { kind: string; name: string; extension: string }[]; onPick: (kind: ExportKind) => void }) {
  return [...EXPORTS.filter((x) => !(shared && x.kind === 'html')), ...extra.map((x) => ({ kind: x.kind as ExportKind, title: x.name, desc: `From a plugin, as .${x.extension}` }))].map((x) => (
    <button key={x.kind} role="menuitem" className="menu-row" title={x.desc} onClick={() => onPick(x.kind)}>
      {x.title}
    </button>
  ));
}

type MoreMenuProps = {
  design: Design | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: (back: boolean) => void;
  onFind: () => void;
  tag: string | null;
  onTag: (tag: string | null) => void;
  live: LiveLoad | null;
  liveOn: boolean;
  onLiveToggle: () => void;
  selectedCount: number;
  onArrange: (kind: LayoutKind, selectionOnly: boolean) => void;
  exportExtras: { kind: string; name: string; extension: string }[];
  onExport: (kind: ExportKind) => void;
  onPresent: () => void;
  minimap: boolean;
  onMinimap: (on: boolean) => void;
  sketch: boolean;
  onSketch: (sketch: boolean) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  change: Change;
  onConnections?: () => void;
  user: Me;
};

/** Everything that is not the sheet: one menu, with longer lists unfolding in place. */
export function MoreMenu(p: MoreMenuProps) {
  const { design, tag, onTag } = p;
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<'view' | 'layout' | 'export' | 'settings' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setPage(null);
  }, []);
  useDismiss(open, close, ref);
  const counts = tagCounts(design);
  // A tag that no part carries any more (renamed, removed, another design) falls back to everything.
  useEffect(() => {
    if (tag && !counts.has(tag)) onTag(null);
  });
  /** Closes the menu, then acts. */
  const act = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => {
    close();
    fn(...args);
  };
  const action = (name: string, onClick: () => void, keys?: string, disabled?: boolean) => (
    <button role="menuitem" className="menu-row" title={keys} disabled={disabled} onClick={act(onClick)}>
      {name}
    </button>
  );
  const sub = (name: string, to: NonNullable<typeof page>, hint?: string, disabled?: boolean) => (
    <>
      <button role="menuitem" className="menu-row" aria-expanded={page === to} disabled={disabled} onClick={() => setPage(page === to ? null : to)}>
        {name}
        <span className="menu-hint" aria-hidden="true">
          {hint} <span className="menu-chevron">›</span>
        </span>
      </button>
      {page === to && <div className="menu-sub">{pages[to]}</div>}
    </>
  );
  const check = (name: string, on: boolean, onClick: () => void, title?: string) => (
    <button role="menuitemcheckbox" aria-checked={on} className="menu-row" title={title} onClick={onClick}>
      {name}
      {on && <span className="menu-hint" aria-hidden="true">On</span>}
    </button>
  );
  const pages = {
    view: <TagList counts={counts} tag={tag} onPick={act(onTag)} />,
    layout: <LayoutList selected={p.selectedCount} onPick={act(p.onArrange)} />,
    export: <ExportList extra={p.exportExtras} onPick={act(p.onExport)} />,
    settings: design && <DesignSettings design={design} change={p.change} />,
  };
  return (
    <div className="switcher" ref={ref}>
      <button className="icon-btn float" aria-haspopup="menu" aria-expanded={open} aria-label="More" title="More" onClick={() => (open ? close() : setOpen(true))}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8h.01M8 8h.01M13 8h.01" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="menu menu-right" role="menu" aria-label="More">
          <Appearance sketch={p.sketch} onSketch={p.onSketch} theme={p.theme} onTheme={p.onTheme} />
          <hr className="menu-rule" />
          <div className="menu-pair">
            {action('Undo', () => p.onUndo(true), 'Ctrl+Z', !p.canUndo)}
            {action('Redo', () => p.onUndo(false), 'Ctrl+Shift+Z', !p.canRedo)}
          </div>
          {action('Find', p.onFind, 'Ctrl+F', !design)}
          {action('Present', p.onPresent, undefined, !design)}
          <hr className="menu-rule" />
          {counts.size > 0 && sub('View', 'view', tag ?? undefined)}
          {sub('Layout', 'layout', undefined, !design)}
          {sub('Export', 'export', undefined, !design)}
          {sub('Design settings', 'settings', undefined, !design)}
          <hr className="menu-rule" />
          {design && !shared && check('Live load', p.liveOn, act(p.onLiveToggle), [p.live?.unmatched.length && `No line for: ${p.live.unmatched.join(', ')}`, p.live?.failed?.length && `Not answering: ${p.live.failed.join('; ')}`].filter(Boolean).join('. ') || 'Show measured load and latency on the lines')}
          {check('Overview map', p.minimap, () => p.onMinimap(!p.minimap))}
          {p.onConnections && action('Connections', p.onConnections)}
          {p.user && (
            <a role="menuitem" className="menu-row" href="/auth/logout" title={p.user.email}>
              Sign out
            </a>
          )}
        </div>
      )}
    </div>
  );
}
