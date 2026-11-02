import { useCallback, useEffect, useRef, useState } from 'react';
import { applyNodeChanges, type Node, type NodeChange } from '@xyflow/react';
import type { deriveSheet } from './derive.ts';
import { carriedAlong, landDragged } from './sheet-edits.ts';
import type { useDesignStore } from './use-design-store.ts';

type Store = Pick<ReturnType<typeof useDesignStore>, 'designRef' | 'change'>;

/** The nodes React Flow draws: rebuilt from the design, but holding the live selection and drag positions it needs in between. */
export function useSheetNodes(sheet: ReturnType<typeof deriveSheet>, selected: string | null, { designRef, change }: Store) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const lastSelected = useRef(selected);
  // Ids to select once they are on the sheet (what was just pasted).
  const pendingSelect = useRef<Set<string> | null>(null);
  // Rebuild nodes from the design, keeping a multi-selection (shift-drag or ctrl-click) across edits.
  useEffect(() => {
    const keep = lastSelected.current === selected;
    lastSelected.current = selected;
    const pending = pendingSelect.current;
    if (pending && sheet.nodes.some((n) => pending.has(n.id))) pendingSelect.current = null;
    setNodes((prev) => {
      if (pending) return sheet.nodes.map((n) => ({ ...n, selected: pending.has(n.id) }));
      if (!keep) return sheet.nodes;
      const sel = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      return sheet.nodes.map((n) => (sel.has(n.id) && !n.selected ? { ...n, selected: true } : n));
    });
  }, [sheet.nodes, selected]);
  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns)), []);

  // Dragging a boundary by its tab carries everything inside it along.
  const carried = useRef(new Map<string, { x: number; y: number }>());
  const drag = {
    onNodeDragStart: (_: unknown, __: Node, dragged: Node[]) => {
      const d = designRef.current;
      carried.current = d ? carriedAlong(d, nodes, dragged) : new Map();
    },
    onNodeDrag: (_: unknown, __: Node, dragged: Node[]) => {
      const lead = dragged.find((n) => carried.current.has(n.id));
      if (!lead) return;
      const start = carried.current.get(lead.id)!;
      const dx = lead.position.x - start.x, dy = lead.position.y - start.y;
      setNodes((ns) => ns.map((n) => (carried.current.has(n.id) && !dragged.some((g) => g.id === n.id) ? { ...n, position: { x: carried.current.get(n.id)!.x + dx, y: carried.current.get(n.id)!.y + dy } } : n)));
    },
    onNodeDragStop: (_: unknown, __: Node, dragged: Node[]) => {
      change((d) => landDragged(d, { dragged, carried: carried.current, boxes: sheet.boxes }));
      carried.current = new Map();
    },
  };

  /** Selects these ids as soon as the next rebuild shows them. */
  const selectNext = (ids: string[]) => {
    pendingSelect.current = new Set(ids);
  };
  const clearSelection = () => setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
  return { nodes, onNodesChange, drag, selectNext, clearSelection };
}
