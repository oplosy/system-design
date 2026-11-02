import type { ComponentProps } from 'react';
import type { Design } from '../core/schema.ts';
import { shared, type Me, type Summary } from './api.ts';
import { FindBox } from './bars.tsx';
import { DesignSwitcher } from './designs.tsx';
import { MoreMenu } from './menus.tsx';

export type TopBarProps = ComponentProps<typeof MoreMenu> & {
  design: Design | null;
  designs: Summary[];
  currentId: string | null;
  me: Me;
  onCreate: () => void;
  onPickDesign: (id: string) => void;
  onBrowse: () => void;
  onConnections: () => void;
  find: ComponentProps<typeof FindBox> | null;
};

/** Two small pieces over the sheet: the design on the left, everything else behind a menu on the right. */
export function TopBar(p: TopBarProps) {
  const { me } = p;
  const viewOnly = me?.canEdit === false;
  return (
    <header className="topbar">
      <div className="bar">
        {p.designs.length > 0 ? (
          <DesignSwitcher
            designs={p.designs}
            current={p.currentId}
            onPick={p.onPickDesign}
            onCreate={shared || viewOnly ? undefined : p.onCreate}
            onAll={shared ? undefined : p.onBrowse}
            onConnections={shared || me ? undefined : p.onConnections}
            user={me}
          />
        ) : (
          <span className="wordmark">system design</span>
        )}
        {shared ? (
          <span className="shared-tag" title="Opened from a shared file. You can walk the steps and try changes, but nothing is saved.">
            Shared copy
          </span>
        ) : (
          viewOnly && (
            <span className="shared-tag" title="You have view access on this hub. You can walk the steps and try changes, but nothing is saved.">
              View only
            </span>
          )
        )}
      </div>
      {p.find && <FindBox {...p.find} />}
      <div className="bar">
        <MoreMenu {...p} />
      </div>
    </header>
  );
}
