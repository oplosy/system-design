import type { ComponentProps } from 'react';
import type { Design } from '../core/schema.ts';
import { shared, type LiveLoad, type Me, type Summary } from './api.ts';
import { FindBox } from './bars.tsx';
import { DesignSwitcher } from './designs.tsx';
import type { Theme } from './format.ts';
import type { LayoutKind } from './layout.ts';
import { AppearanceMenu, ExportMenu, LayoutMenu, TagMenu, type ExportKind } from './menus.tsx';
import type { Docks } from './use-prefs.ts';

const icon = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export type TopBarProps = {
  design: Design | null;
  designs: Summary[];
  currentId: string | null;
  me: Me;
  docks: Docks;
  onToggleDock: (side: keyof Docks) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: (back: boolean) => void;
  tag: string | null;
  onTag: (tag: string | null) => void;
  live: LiveLoad | null;
  liveOn: boolean;
  onLiveToggle: () => void;
  selectedCount: number;
  onArrange: (kind: LayoutKind, selectionOnly: boolean) => void;
  exportExtras: ComponentProps<typeof ExportMenu>['extra'];
  onExport: (kind: ExportKind) => void;
  onPresent: () => void;
  sketch: boolean;
  onSketch: (sketch: boolean) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onCreate: () => void;
  onPickDesign: (id: string) => void;
  onBrowse: () => void;
  onConnections: () => void;
  find: ComponentProps<typeof FindBox> | null;
};

/** The bar across the top: design switcher, find, undo, view and export menus, present, appearance and New design. */
export function TopBar(p: TopBarProps) {
  const { design, docks, me } = p;
  const dockToggle = (k: keyof Docks) => (
    <button
      className="icon-btn"
      aria-pressed={docks[k].open}
      onClick={() => p.onToggleDock(k)}
      title={`${docks[k].open ? 'Hide' : 'Show'} the ${k === 'left' ? 'parts' : 'details'} panel`}
      aria-label={`${k === 'left' ? 'Parts' : 'Details'} panel`}
    >
      {icon(k === 'left' ? 'M2.5 3.5h11v9h-11zM6.5 3.5v9' : 'M2.5 3.5h11v9h-11zM9.5 3.5v9')}
    </button>
  );
  return (
    <header className="topbar">
      <div className="bar">
        {design && dockToggle('left')}
        <span className="wordmark">
          system<span>/</span>design
        </span>
        {p.designs.length > 0 && (
          <DesignSwitcher
            designs={p.designs}
            current={p.currentId}
            onPick={p.onPickDesign}
            onAll={shared ? undefined : p.onBrowse}
            onConnections={shared || me ? undefined : p.onConnections}
            user={me}
            meta={design ? `rev ${design.rev} · ${design.components.length} parts · ${design.decisions.length} decisions` : undefined}
          />
        )}
      </div>
      {p.find && <FindBox {...p.find} />}
      <div className="bar">
        <button className="icon-btn" disabled={!p.canUndo} onClick={() => p.onUndo(true)} title="Undo (Ctrl+Z)" aria-label="Undo">
          {icon('M5.5 3 2.5 6l3 3M3 6h6.5a4 4 0 0 1 0 8H7')}
        </button>
        <button className="icon-btn" disabled={!p.canRedo} onClick={() => p.onUndo(false)} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          {icon('M10.5 3l3 3-3 3M13 6H6.5a4 4 0 0 0 0 8H9')}
        </button>
        <span className="vrule" />
        {design && <TagMenu design={design} tag={p.tag} onPick={p.onTag} />}
        {design && !shared && (
          <button
            className="text-btn"
            aria-pressed={p.liveOn}
            onClick={p.onLiveToggle}
            title={[p.live?.unmatched.length && `No line for: ${p.live.unmatched.join(', ')}`, p.live?.failed?.length && `Not answering: ${p.live.failed.join('; ')}`].filter(Boolean).join('. ') || 'Show measured load and latency on the lines'}
          >
            Live
          </button>
        )}
        <LayoutMenu disabled={!design} selected={p.selectedCount} onPick={p.onArrange} />
        <ExportMenu disabled={!design} extra={p.exportExtras} onPick={p.onExport} />
        <button className="text-btn" disabled={!design} onClick={p.onPresent} title="Walk through the steps full screen">
          Present
        </button>
        <span className="vrule" />
        <AppearanceMenu sketch={p.sketch} onSketch={p.onSketch} theme={p.theme} onTheme={p.onTheme} icon={icon} />
        {design && dockToggle('right')}
        {shared ? (
          <span className="shared-tag" title="Opened from a shared file. You can walk the steps and try changes, but nothing is saved.">
            Shared copy
          </span>
        ) : me?.canEdit === false ? (
          <span className="shared-tag" title="You have view access on this hub. You can walk the steps and try changes, but nothing is saved.">
            View only
          </span>
        ) : (
          <button className="btn ink" onClick={p.onCreate}>
            New design
          </button>
        )}
      </div>
    </header>
  );
}
