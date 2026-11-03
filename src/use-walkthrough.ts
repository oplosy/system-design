import { useState } from 'react';
import * as review from '../core/review.ts';
import type { Design } from '../core/schema.ts';
import type { useDesignStore } from './use-design-store.ts';

type Options = {
  design: Design | null;
  change: ReturnType<typeof useDesignStore>['change'];
  setSelected: (id: string | null) => void;
  setError: (message: string | null) => void;
};

/** Which step is on the sheet and how the reviewer moves on: nothing past the first step still waiting for review can be reached. */
export function useWalkthrough({ design, change, setSelected, setError }: Options) {
  const [viewIndex, setViewIndex] = useState(0);
  const firstUnseen = design ? design.steps.findIndex((s) => !s.seen) : -1;
  const maxIndex = design ? (firstUnseen >= 0 ? firstUnseen : design.steps.length - 1) : 0;
  const view = Math.min(viewIndex, maxIndex);
  const current = design?.steps[view];
  // A step that needs reading or a choice opens with its details; the reviewer's own choice for a step stands after that.
  const [stepOpen, setStepOpen] = useState<Record<string, boolean>>({});
  const detailsOpen = !!current && (stepOpen[current.id] ?? (!!current.options || design!.decisions.some((x) => x.step === current.id)));
  const setDetailsOpen = (open: boolean) => current && setStepOpen((o) => ({ ...o, [current.id]: open }));

  const goTo = (i: number) => {
    setSelected(null);
    setViewIndex(Math.max(0, Math.min(i, maxIndex)));
  };
  const seenNext = () => {
    if (!design || !current) return;
    if (current.seen) return goTo(view + 1);
    if (current.options) return setError('Pick one of this step’s options first.');
    change((d) => {
      d.steps[view].seen = true;
    });
    setSelected(null);
    setViewIndex(Math.min(view + 1, design.steps.length - 1));
  };
  const requestChanges = (text: string) => {
    if (!design || !current) return;
    const wasSeen = current.seen;
    change((d) => review.requestChanges(d, current.id, text));
    setSelected(null);
    if (!wasSeen) setViewIndex(Math.min(view + 1, design.steps.length - 1));
  };

  return { view, maxIndex, current, setViewIndex, detailsOpen, setDetailsOpen, goTo, seenNext, requestChanges };
}
