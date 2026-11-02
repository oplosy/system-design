import { useEffect, useRef, type RefObject } from 'react';
import { useReactFlow, type FitViewOptions, type Node } from '@xyflow/react';
import type { Design } from '../core/schema.ts';

/** Share of the window the step details may take; the stylesheet's .review-sheet max-height matches. */
const DETAILS_HEIGHT = 0.42;

type Options = {
  design: Design | null;
  view: number;
  nodes: Node[];
  presenting: boolean;
  detailsOpen: boolean;
  canvasRef: RefObject<HTMLDivElement | null>;
};

/** Keeps the sheet framed: re-fits when a design opens, the walkthrough moves on, or presenting starts, ends or resizes. */
export function useAutoFit({ design, view, nodes, presenting, detailsOpen, canvasRef }: Options) {
  const { fitView, getNodes, getInternalNode } = useReactFlow();
  const fittedFor = useRef<string | null>(null);
  const fitOpts = useRef<FitViewOptions>({});
  // The bars float over the sheet, so fitting leaves room for them and for the details unfolded above the review bar.
  fitOpts.current = {
    padding: { left: '40px', right: '40px', top: presenting ? '40px' : '72px', bottom: !presenting && detailsOpen ? `${Math.round(window.innerHeight * DETAILS_HEIGHT) + 100}px` : '108px' },
    duration: 300,
    maxZoom: 1.2,
  };

  useEffect(() => {
    const key = design && `${design.id}:${view}:${presenting}`;
    if (!key || fittedFor.current === key || !nodes.length || nodes.some((n) => n.hidden)) return;
    fittedFor.current = key;
    // fitView skips nodes React Flow has not measured yet, so wait until every shown node has a size.
    const fit = (tries: number) => {
      const ready = getNodes().every((n) => n.hidden || n.width || getInternalNode(n.id)?.measured.width);
      if (!ready && tries > 0) return void setTimeout(() => fit(tries - 1), 50);
      void fitView(fitOpts.current);
    };
    // Entering full screen resizes the canvas a moment later.
    setTimeout(() => fit(40), presenting ? 250 : 60);
  }, [design, view, nodes, fitView, getNodes, getInternalNode, presenting]);

  // While presenting, re-fit whenever the canvas changes size (panels hide, full screen kicks in).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !presenting) return;
    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = window.setTimeout(() => fitView(fitOpts.current), 80);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [presenting, fitView, canvasRef]);

  // Unfolded details cover the lower part of the sheet, so the parts move up out from under them, and back when they fold.
  const hasDesign = !!design;
  useEffect(() => {
    if (!hasDesign || presenting) return;
    const t = setTimeout(() => fitView(fitOpts.current), 150);
    return () => clearTimeout(t);
  }, [detailsOpen, hasDesign, presenting, fitView]);

  /** Fits again after the next change of nodes, whatever was fitted last. */
  const refit = () => {
    fittedFor.current = null;
  };
  return { fitOpts, refit };
}
