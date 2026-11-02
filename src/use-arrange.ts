import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import * as m from '../core/mutations.ts';
import type { Design } from '../core/schema.ts';
import { errorText } from './format.ts';
import { layout, placeNew, type LayoutKind } from './layout.ts';
import { emptyBoundaries, placedItems } from './sheet-edits.ts';
import type { useDesignStore } from './use-design-store.ts';

type Pos = { x: number; y: number };
type Only = { ids: Set<string>; at: Map<string, Pos> };

/** Items a layout of the selection moves: what is picked, plus all that a picked boundary holds. */
function selectionLayout(d: Design, picked: Set<string>): Only {
  const boxes = new Set([...picked].filter((id) => d.boundaries.some((b) => b.id === id)).flatMap((id) => [...m.boundaryTree(d, id)]));
  const ids = new Set([
    ...[...d.notes, ...d.decisions].filter((x) => picked.has(x.id)).map((x) => x.id),
    ...d.components.filter((c) => picked.has(c.id) || (c.boundary && boxes.has(c.boundary))).map((c) => c.id),
  ]);
  const at = new Map([...d.components, ...d.notes, ...d.decisions].filter((x) => x.position).map((x) => [x.id, x.position!]));
  return { ids, at };
}

function applyLayout(d: Design, kind: LayoutKind, pos: Map<string, Pos>, only?: Only) {
  for (const x of placedItems(d)) if (pos.has(x.id)) x.position = pos.get(x.id);
  if (kind !== 'flow') return;
  // Flow draws right-angled lines; the other layouts keep each line as it was. Pushed-aside items keep theirs.
  const laid = only?.ids ?? pos;
  for (const c of d.connections) {
    if (laid.has(c.from) && laid.has(c.to)) {
      c.route = 'elbow';
      c.bend = undefined;
    }
  }
}

type Options = {
  store: Pick<ReturnType<typeof useDesignStore>, 'design' | 'designRef' | 'change'>;
  refit: () => void;
  setError: (message: string | null) => void;
};

/** Places items that arrive without a position, and offers re-arranging the sheet. */
export function useArrange({ store: { design, designRef, change }, refit, setError }: Options) {
  const { getNodes } = useReactFlow();

  // New items (from agents, templates or a paste) arrive without positions: lay them out once, clear of what is placed.
  useEffect(() => {
    if (!design) return;
    const unplaced = (d: Design) => [...d.components, ...d.notes, ...d.decisions, ...emptyBoundaries(d)].filter((x) => !x.position);
    if (!unplaced(design).length) return;
    let cancelled = false;
    layout(design)
      .then((pos) => {
        if (cancelled) return;
        change(
          (d) => {
            const at = placeNew(d, pos);
            for (const x of unplaced(d)) x.position = at.get(x.id);
          },
          { record: false },
        );
      })
      .catch((e) => setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [design, change, setError]);

  /** Re-arranges the whole sheet, or only the selected items (a selected boundary brings what it holds). */
  return (kind: LayoutKind, selectionOnly: boolean) => {
    const d = designRef.current;
    if (!d) return;
    const only = selectionOnly ? selectionLayout(d, new Set(getNodes().filter((n) => n.selected).map((n) => n.id))) : undefined;
    layout(d, kind, only)
      .then((pos) => {
        if (!only) refit();
        change((next) => applyLayout(next, kind, pos, only));
      })
      .catch((e) => setError(errorText(e)));
  };
}
