const PATHS = {
  sun: 'M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M8 1.5V3 M8 13v1.5 M1.5 8H3 M13 8h1.5 M3.4 3.4l1 1 M11.6 11.6l1 1 M3.4 12.6l1-1 M11.6 4.4l1-1',
  moon: 'M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5Z',
  clean: 'M3 3h10v10H3z',
  sketch: 'M3 13l1-3.5L10.5 3 13 5.5 6.5 12z M9 4.5 11.5 7',
  undo: 'M6 4 3 7l3 3 M3 7h7a3 3 0 0 1 0 6H8',
  redo: 'M10 4l3 3-3 3 M13 7H6a3 3 0 0 0 0 6h2',
  find: 'M11 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M10 10l3.5 3.5',
  present: 'M5 3.5v9l7.5-4.5z',
  view: 'M2.5 2.5h5l6 6-5 5-6-6z',
  layout: 'M2.5 3h11v10h-11z M6.5 3v10 M6.5 8h7',
  export: 'M8 2.5v7 M5 6.5l3 3 3-3 M3 11v2.5h10V11',
  settings: 'M3 5h6 M12 5h1 M3 11h1 M7 11h6 M10.5 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z M5.5 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  live: 'M2 8h3l2-4.5 2.5 9L11 8h3',
  map: 'M2.5 4 6 2.5 10 4l3.5-1.5V12L10 13.5 6 12l-3.5 1.5z M6 2.5V12 M10 4v9.5',
  connections: 'M6 2v3 M10 2v3 M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0z M8 11v3',
  signout: 'M6 13.5H3v-11h3 M10.5 5l3 3-3 3 M13.5 8h-7',
  // Layouts.
  layered: 'M4 2.5h8v3H4z M4 10.5h8v3H4z M8 5.5v5',
  tiers: 'M2.5 3h11 M2.5 8h11 M2.5 13h11',
  flow: 'M2.5 6H6v4H2.5z M10 6h3.5v4H10z M6 8h4',
  tree: 'M6 2.5h4v3H6z M2.5 10.5h4v3h-4z M9.5 10.5h4v3h-4z M8 5.5V8 M4.5 10.5V8h7v2.5',
  radial: 'M10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z M8 2v2 M8 12v2 M2 8h2 M12 8h2',
  organic: 'M3.5 4 8 6l4.5-2.5 M8 6l-2.5 6.5 M8 6l4.5 5.5 M5.5 12.5l7-1',
  grid: 'M3 3h4v4H3z M9 3h4v4H9z M3 9h4v4H3z M9 9h4v4H9z',
  // Export formats.
  image: 'M2.5 3.5h11v9h-11z M2.5 10.5l3-3 3 3 2-2 3 3',
  vector: 'M3 3h3v3H3z M10 10h3v3h-3z M6 4.5h2.5a3 3 0 0 1 3 3V10',
  code: 'M6 5 3 8l3 3 M10 5l3 3-3 3',
  doc: 'M4 2.5h6L12.5 5v8.5H4z M6 8h4.5 M6 10.5h4.5',
  layers: 'M8 2.5l5.5 3L8 8.5l-5.5-3z M2.5 8.5l5.5 3 5.5-3',
  globe: 'M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z M2.5 8h11 M8 2.5c-3 3-3 8 0 11 M8 2.5c3 3 3 8 0 11',
} as const;

export type IconName = keyof typeof PATHS;

/** A small line icon that takes the colour of the text beside it. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
