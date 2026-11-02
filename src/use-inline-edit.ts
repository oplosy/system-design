import { useState } from 'react';
import type { Pt } from './edges.ts';
import type { Editing } from './format.ts';
import { labelOf, setLabel } from './sheet-edits.ts';
import type { useDesignStore } from './use-design-store.ts';

type Store = Pick<ReturnType<typeof useDesignStore>, 'designRef' | 'change'>;

/** The in-place editor for an item's name, a note's text or a connection's label. */
export function useInlineEdit({ designRef, change }: Store, locked: boolean) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const startEdit = (id: string, at: Pt) => {
    const d = designRef.current;
    if (!d || locked) return;
    const label = labelOf(d, id);
    if (label) setEditing({ id, at, ...label });
  };
  const finishEdit = (value: string | null) => {
    const e = editing;
    setEditing(null);
    if (!e || value === null || value.trim() === e.value.trim()) return;
    const v = value.trim();
    // Names, notes and titles can't be empty; a connection label can.
    if (!v && !designRef.current?.connections.some((x) => x.id === e.id)) return;
    change((d) => setLabel(d, e.id, v));
  };
  return { editing, startEdit, finishEdit, cancelEdit: () => setEditing(null) };
}
