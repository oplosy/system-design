import { useId, useMemo } from 'react';
import type { PathInfo } from 'roughjs/bin/core';
import type { ComponentType } from '../core/schema.ts';
import { drawShape, insideOf, type ShapePath } from './shapes.ts';

/** Draws rough.js paths. `clip` names a clip path the hatching is kept inside; `width` and `fixed` draw thin, scale-proof lines for small previews. */
export function Paths({ paths, dashed, clip, width, fixed }: { paths: (PathInfo & { hatch?: boolean })[]; dashed?: boolean; clip?: string; width?: number; fixed?: boolean }) {
  return paths.map((p, i) => (
    <path
      key={i}
      d={p.d}
      style={{ stroke: p.stroke, strokeWidth: width ?? p.strokeWidth, fill: p.fill ?? 'none' }}
      strokeDasharray={dashed && p.stroke === 'currentColor' ? '7 5' : undefined}
      strokeLinecap="round"
      vectorEffect={fixed ? 'non-scaling-stroke' : undefined}
      clipPath={clip && p.hatch ? `url(#${clip})` : undefined}
    />
  ));
}

/**
 * A part's drawing. In the sketch style the hatching is rough, so its lines would run past the outline; they are clipped to
 * the exact inside of the shape, and the hand-drawn outline goes on top.
 */
export function ShapeDrawing({ type, sketch, seed, dashed, width, fixed }: { type: ComponentType; sketch: boolean; seed: number; dashed?: boolean; width?: number; fixed?: boolean }) {
  const clipId = `clip-${useId().replace(/\W/g, '')}`;
  const paths: ShapePath[] = useMemo(() => drawShape(type, sketch, seed), [type, sketch, seed]);
  const inside = useMemo(() => (sketch ? insideOf(type) : []), [type, sketch]);
  return (
    <>
      {inside.length > 0 && (
        <defs>
          <clipPath id={clipId}>
            {inside.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </clipPath>
        </defs>
      )}
      <Paths paths={paths} dashed={dashed} clip={inside.length ? clipId : undefined} width={width} fixed={fixed} />
    </>
  );
}
