import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import * as m from '../core/mutations.ts';
import type { Design } from '../core/schema.ts';
import type { FlowAt } from './fields.tsx';
import { TEXT_ENTRY } from './use-clipboard.ts';

const FORWARD = ['ArrowRight', ' ', 'PageDown'];
const BACK = ['ArrowLeft', 'PageUp'];

type Options = {
  /** A dialog has the keyboard. */
  blocked: boolean;
  presenting: boolean;
  design: Design | null;
  view: number;
  selected: string | null;
  flow: FlowAt | null;
  setFlow: (f: FlowAt | null) => void;
  goTo: (i: number) => void;
  seenNext: () => void;
  present: (on: boolean) => void;
  undo: (back: boolean) => void;
  duplicate: () => void;
  onClipKey: (key: string) => void;
  onFind: () => void;
  onAdd: () => void;
  /** Esc: drop the selection and whatever is drawn over the sheet. */
  onEscape: () => void;
};

/** While presenting, the keys walk the steps, or the hops of a playing flow. */
function presentKey(e: KeyboardEvent, { design, view, flow, setFlow, goTo, present }: Options) {
  const forward = FORWARD.includes(e.key), back = BACK.includes(e.key);
  const playing = flow && design?.flows.find((f) => f.id === flow.id && m.stepIndex(design).get(f.step)! <= view);
  if (playing && flow) {
    if (forward) setFlow({ ...flow, at: Math.min(flow.at + 1, playing.path.length - 2) });
    else if (back) setFlow({ ...flow, at: Math.max(flow.at - 1, 0) });
    else if (e.key === 'Escape') setFlow(null);
    else return;
  } else if (forward) goTo(view + 1);
  else if (back) goTo(view - 1);
  else if (e.key === 'Escape') present(false);
  else return;
  e.preventDefault();
}

/** ← and → walk the steps while nothing is selected (with a selection, arrows move nodes). Esc clears the selection. */
export function useShortcuts(o: Options) {
  const { zoomIn, zoomOut } = useReactFlow();
  const editKey = (e: KeyboardEvent, key: string) => {
    if (key === 'z') o.undo(!e.shiftKey);
    else if (key === 'y') o.undo(false);
    else if (key === 'd') o.duplicate();
    else if (o.design && (key === '+' || key === '=')) void zoomIn({ duration: 150 });
    else if (o.design && key === '-') void zoomOut({ duration: 150 });
    else if (key === 'c' || key === 'x' || key === 'v') return o.onClipKey(key);
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (o.blocked) return;
      if (o.presenting) return presentKey(e, o);
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (mod && key === 'f' && o.design) {
        e.preventDefault();
        return o.onFind();
      }
      if ((e.target as HTMLElement).closest(TEXT_ENTRY)) return;
      if (mod) return editKey(e, key);
      if (e.altKey) return;
      if (e.key === 'Escape') o.onEscape();
      if (e.key === '/' && o.design) {
        e.preventDefault();
        return o.onAdd();
      }
      if (o.selected) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        o.seenNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        o.goTo(o.view - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}
