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
  // Actions.
  plus: 'M8 3v10 M3 8h10',
  minus: 'M3 8h10',
  close: 'M4 4l8 8 M12 4l-8 8',
  check: 'M3 8.5 6.5 12 13 4.5',
  left: 'M10 3.5 5.5 8l4.5 4.5',
  right: 'M6 3.5 10.5 8 6 12.5',
  stop: 'M4 4h8v8H4z',
  panel: 'M2.5 3h11v10h-11z M2.5 6.5h11',
  comment: 'M2.5 3h11v8H7l-3 2.5V11H2.5z',
  send: 'M2.5 7.5 13.5 3 9 13.5 7.5 9z M7.5 9l6-6',
  trash: 'M2.5 4h11 M6.5 4V2.5h3V4 M4 4l.7 9.5h6.6L12 4 M6.8 6.5v4.5 M9.2 6.5v4.5',
  copy: 'M5.5 5.5h8v8h-8z M10.5 5.5v-3h-8v8h3',
  upload: 'M8 10V3 M5 6l3-3 3 3 M3 11v2.5h10V11',
  folder: 'M2.5 4h4L8 5.5h5.5V13h-11z',
  sort: 'M5 3v10 M2.5 10.5 5 13l2.5-2.5 M11 13V3 M8.5 5.5 11 3l2.5 2.5',
  link: 'M6.5 9.5l3-3 M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1 M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1',
  unlink: 'M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1 M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1 M3 3l10 10',
  diff: 'M5.5 3v6 M2.5 6h6 M3 12.5h10',
  // Subjects.
  info: 'M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z M8 7.5V11 M8 5.2v.01',
  cost: 'M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z M8 4.5v7 M10 6H7a1 1 0 0 0 0 2h2a1 1 0 0 1 0 2H6',
  branch: 'M8 14V9 M8 9 4 5 M8 9l4-4 M2.5 6.5v-3h3 M13.5 6.5v-3h-3',
  note: 'M3 3h10v6.5L9.5 13H3z M9.5 13V9.5H13',
  route: 'M3 13h5a2.5 2.5 0 0 0 0-5H6a2.5 2.5 0 0 1 0-5h7',
  sequence: 'M4 2.5v11 M12 2.5v11 M4 6h8 M12 10H4',
  bolt: 'M9 2 3.5 9H8l-1 5 5.5-7H8z',
  cube: 'M8 2l5 2.8v6.4L8 14l-5-2.8V4.8z M3 4.8 8 7.5l5-2.7 M8 7.5V14',
  template: 'M3 3h10v3.5H3z M3 9h4v4H3z M10 9h3v4h-3z',
  // Lines.
  curve: 'M2.5 12.5C7 12.5 9 3.5 13.5 3.5',
  straight: 'M2.5 12.5l11-9',
  elbow: 'M2.5 12.5H8v-9h5.5',
  sync: 'M2 8h9 M9 5l3 3-3 3',
  async: 'M2 8h2 M6 8h2 M9 5l3 3-3 3',
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
